"""Piper — yerel (çevrimdışı) nöral TTS, Türkçe sesler.

Edge TTS ile aynı arayüzü döndürür (48 kHz mono float32 + kelime zamanları), böylece hikâye
hattı (altyazı, ağız animasyonu, @kelime ipuçları, el yazısı) motordan bağımsız çalışır.

Kelime zamanları tahmin değildir: model bellekte yamalanır (piper `include_alignments`) ve
süre tahmincisinin her fonem için ürettiği örnek sayıları okunur; fonemler boşluk/noktalama
sınırlarında kelimelere toplanır ve metindeki sözcüklere eşlenir.

Sesler (ilk kullanımda Hugging Face'ten .cache/piper/voices altına indirilir):
    dfki       rhasspy/piper-voices (resmî katalog)      — en anlaşılır erkek ses
    fahrettin  speaches-ai/piper-tr_TR-fahrettin-medium  — erkek
    fettah     speaches-ai/piper-tr_TR-fettah-medium     — erkek
    eren       99eren99/piper-turkish-tts                — topluluk modeli, erkek

    from viral.piper_tts import PiperTTS
    r = PiperTTS().say("Merhaba dünya", model="dfki", semitones=-2)
    r.audio, r.sr, r.words
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from .edge import EdgeResult, _ssl_context

SR = 48000
CACHE = Path(os.environ.get("VIRAL_CACHE", ".cache")) / "piper"
VOICES_DIR = CACHE / "voices"

HF = "https://huggingface.co/{repo}/resolve/main/{path}"
SOURCES = {
    "dfki": ("rhasspy/piper-voices", "tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx", "tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json"),
    "fahrettin": ("speaches-ai/piper-tr_TR-fahrettin-medium", "model.onnx", "config.json"),
    "fettah": ("speaches-ai/piper-tr_TR-fettah-medium", "model.onnx", "config.json"),
    "eren": ("99eren99/piper-turkish-tts", "model.onnx", "config.json"),
}

# konuşmanın RMS hedefi (dBFS): Edge/Ahmet replikleriyle aynı seviye → miks dengesi değişmez
TARGET_RMS_DB = -15.6
# fonem dizisinde kelime içi olmayan işaretler
_BREAK = set(" ,.!?;:…—–-\"'«»()[]")
_SPECIAL = {"^", "$", "_"}
# hizalama sesle ~20–70 ms içinde örtüşür (akustik başlangıç ölçümü); vurgunun sesten geri kalmaması için küçük öne alma
WORD_SHIFT = -0.03


def _download(url: str, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "viral-piper/1.0"})
    with urllib.request.urlopen(req, context=_ssl_context(), timeout=120) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    tmp.rename(dst)


def ensure_voice(name: str) -> Path:
    d = VOICES_DIR / name
    model, cfg = d / "model.onnx", d / "config.json"
    if not (model.exists() and cfg.exists()):
        if name not in SOURCES:
            raise ValueError(f"bilinmeyen Piper sesi: {name} (seçenekler: {', '.join(SOURCES)})")
        repo, mp, cp = SOURCES[name]
        _download(HF.format(repo=repo, path=cp), cfg)
        _download(HF.format(repo=repo, path=mp), model)
    return d


def _rms_db(x: np.ndarray, sr: int) -> float:
    """Konuşma bölgelerinin RMS'i (sessizlikleri saymadan)."""
    hop = int(0.02 * sr)
    n = len(x) // hop
    if n == 0:
        return -90.0
    fr = x[: n * hop].reshape(n, hop)
    e = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    thr = e.max() * 10 ** (-30 / 20)
    sel = e[e > thr]
    return float(20 * np.log10(np.sqrt((sel ** 2).mean()) + 1e-12))


def _pitch_shift(x: np.ndarray, semitones: float, sr: int = SR) -> np.ndarray:
    """ffmpeg rubberband: süre ve zamanlama korunur, yalnızca perde değişir."""
    ratio = 2 ** (semitones / 12)
    pad = int(0.25 * sr)  # filtre başlangıç/bitiş geçişlerini kırpmasın
    src = np.concatenate([np.zeros(pad, np.float32), x.astype(np.float32), np.zeros(pad, np.float32)])
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
                        "-af", f"rubberband=pitch={ratio:.5f}:formant=shifted:pitchq=quality:transients=smooth",
                        "-f", "f32le", "-ar", str(sr), "-ac", "1", "-"], input=src.tobytes(), capture_output=True, check=True)
    y = np.frombuffer(r.stdout, np.float32).copy()
    # gecikmeyi ölç ve düzelt (zarf çapraz ilintisi), sonra orijinal uzunluğa kırp
    env = lambda s: np.abs(s[: len(s) // 64 * 64]).reshape(-1, 64).max(axis=1)
    a, b = env(src), env(y)
    m = min(len(a), len(b))
    lags = range(-40, 41)
    best = max(lags, key=lambda k: float(np.dot(a[max(0, -k): m - max(0, k)], b[max(0, k): m - max(0, -k)])))
    start = pad + best * 64
    out = y[max(0, start): max(0, start) + len(x)]
    if len(out) < len(x):
        out = np.concatenate([out, np.zeros(len(x) - len(out), np.float32)])
    return out.astype(np.float32, copy=True)


def _limit(x: np.ndarray, ceil: float = 0.95) -> np.ndarray:
    """Yalnızca tepelere dokunan yumuşak sınırlayıcı (seviyeyi genel olarak düşürmez)."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    a = np.abs(x)
    if a.max() <= ceil:
        return x
    w = int(0.004 * SR)
    g = np.minimum(1.0, ceil / np.maximum(a, 1e-9))
    g = uniform_filter1d(minimum_filter1d(g, size=2 * w + 1), size=w)
    y = (x * g).astype(np.float32)
    return np.clip(y, -ceil, ceil)


_WHISPER = None


def _intelligibility(y: np.ndarray, text: str) -> float | None:
    """Karakter hata oranı (0 = kusursuz): Whisper (faster-whisper, 'small') ile yazıya dökülür.
    Rakamlar ve noktalama karşılaştırmadan çıkarılır (Whisper '08:47' yazabilir)."""
    global _WHISPER
    try:
        if _WHISPER is None:
            os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
            from faster_whisper import WhisperModel
            _WHISPER = WhisperModel(os.environ.get("VIRAL_WHISPER", "small"), device="cpu", compute_type="int8",
                                    download_root=str(CACHE.parent / "whisper"))
    except Exception:
        return None
    import difflib
    from .story import tnorm
    segs, _ = _WHISPER.transcribe(resample_poly(y, 1, 3).astype(np.float32), language="tr", beam_size=5)
    hyp = " ".join(s.text for s in segs)
    norm = lambda t: re.sub(r"[^a-zçğıöşü]", "", tnorm(re.sub(r"\d", "", t)))
    a, b = norm(text), norm(hyp)
    if not a:
        return 0.0
    return 1 - difflib.SequenceMatcher(None, a, b).ratio()


class PiperTTS:
    """Birden çok Piper sesini yöneten motor. Sentezler önbelleğe alınır (Piper gürültü örneklemesi
    nedeniyle her çağrı biraz farklı olur; önbellek bölümlerin tekrar üretiminde aynı sesi verir)."""

    engine = "piper"

    def __init__(self, default: str = "dfki"):
        self.default = default
        self.voice = f"piper:{default}"
        self._loaded: dict = {}

    def _load(self, name: str):
        if name not in self._loaded:
            from piper import PiperVoice
            d = ensure_voice(name)
            self._loaded[name] = PiperVoice.load(d / "model.onnx", config_path=d / "config.json", include_alignments=True)
        return self._loaded[name]

    # -------------------------------------------------------------- kelime sayımı / eşleme
    @staticmethod
    def _phoneme_words(phonemes: list[str]) -> int:
        n, inword = 0, False
        for p in phonemes:
            if p in _BREAK or p in _SPECIAL:
                inword = False
            elif not inword:
                n += 1
                inword = True
        return n

    def _token_counts(self, v, toks: list[str]) -> list[int]:
        out = []
        for t in toks:
            out.append(sum(self._phoneme_words(s) for s in v.phonemize(t)))
        return out

    @staticmethod
    def _assign(toks: list[str], counts: list[int], spans: list[tuple[float, float]]) -> list[tuple[str, float, float]]:
        words = []
        if spans and sum(counts) == len(spans):
            k = 0
            for t, c in zip(toks, counts):
                if c == 0:
                    continue
                words.append((t, spans[k][0], spans[k + c - 1][1]))
                k += c
            return words
        if len(toks) == len(spans):
            return [(t, s, e) for t, (s, e) in zip(toks, spans)]
        # yedek: harf uzunluğuna göre orantılı eşleme
        if not spans or not toks:
            return words
        lens = np.array([max(1, len(re.sub(r"\W", "", t))) for t in toks], float)
        cum = np.concatenate([[0], np.cumsum(lens)]) / lens.sum()
        N = len(spans)
        for i, t in enumerate(toks):
            a = min(N - 1, int(np.floor(cum[i] * N + 1e-6)))
            b = max(a, min(N - 1, int(np.ceil(cum[i + 1] * N - 1e-6)) - 1))
            words.append((t, spans[a][0], spans[b][1]))
        return words

    # -------------------------------------------------------------- sentez
    def _take(self, text: str, model: str, length: float, noise: float, noise_w: float, semitones: float, gain_db: float,
              pause: float) -> tuple[np.ndarray, list]:
        """Tek çekim: ses (48 kHz) + kelime zamanları (kaydırmasız)."""
        from piper import SynthesisConfig
        v = self._load(model)
        cfg = SynthesisConfig(length_scale=length, noise_scale=noise, noise_w_scale=noise_w, normalize_audio=False)
        chunks = list(v.synthesize(text, cfg, include_alignments=True))
        if not chunks:
            raise RuntimeError(f"Piper boş ses döndürdü: {text!r}")
        sr0 = chunks[0].sample_rate
        pieces, spans, off = [], [], 0
        for ci, c in enumerate(chunks):
            a = c.audio_float_array.astype(np.float32)
            al = c.phoneme_alignments or []
            tot = sum(int(x.num_samples) for x in al)
            if al and tot > 0:
                scale = len(a) / tot  # hizalama ↔ ses uzunluğu (normalde 1.0)
                pos, cur = 0.0, None
                for x in al:
                    n = int(x.num_samples) * scale
                    p = x.phoneme
                    if p in _SPECIAL or p in _BREAK:
                        if cur:
                            spans.append(((off + cur[0]) / sr0, (off + cur[1]) / sr0))
                            cur = None
                    else:
                        cur = [pos, pos + n] if cur is None else [cur[0], pos + n]
                    pos += n
                if cur:
                    spans.append(((off + cur[0]) / sr0, (off + cur[1]) / sr0))
            else:  # hizalama yok: cümleyi kelime sayısına bölerek yaklaşıkla
                nw = max(1, self._phoneme_words(c.phonemes))
                d = len(a) / sr0
                spans += [((off / sr0) + d * (0.1 + 0.8 * i / nw), (off / sr0) + d * (0.1 + 0.8 * (i + 1) / nw)) for i in range(nw)]
            pieces.append(a)
            off += len(a)
            if ci < len(chunks) - 1:
                gap = np.zeros(int(pause * sr0), np.float32)
                pieces.append(gap)
                off += len(gap)
        audio = np.concatenate(pieces)
        toks = [t for t in text.split() if any(ch.isalnum() for ch in t)]
        words = self._assign(toks, self._token_counts(v, toks), spans)

        # 22.05 kHz → 48 kHz, perde, seviye, kenar yumuşatma
        y = resample_poly(audio, SR, sr0).astype(np.float32)
        if abs(semitones) > 1e-3:
            y = _pitch_shift(y, semitones)
        y *= 10 ** ((TARGET_RMS_DB + gain_db - _rms_db(y, SR)) / 20)
        f = int(0.004 * SR)
        y[:f] *= np.linspace(0, 1, f, dtype=np.float32)
        y[-f:] *= np.linspace(1, 0, f, dtype=np.float32)
        return _limit(y), words

    def say(self, text: str, model: str | None = None, length: float = 1.0, noise: float = 0.6, noise_w: float = 0.7,
            semitones: float = 0.0, gain_db: float = 0.0, pause: float = 0.3, takes: int = 1) -> EdgeResult:
        """takes > 1: birkaç çekim üretip en anlaşılır olanı seçer (Whisper ile yazıya döküp karakter hata oranı;
        faster-whisper kurulu değilse ilk çekim kullanılır)."""
        model = model or self.default
        CACHE.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(json.dumps(["p3", model, text, round(length, 4), noise, noise_w, semitones, gain_db, pause, takes],
                                        ensure_ascii=False).encode()).hexdigest()[:24]
        fa, fm = CACHE / f"{key}.npy", CACHE / f"{key}.json"
        if fa.exists() and fm.exists():
            words = [(t, max(0.0, a + WORD_SHIFT), b + WORD_SHIFT) for t, a, b in json.loads(fm.read_text())["words"]]
            return EdgeResult(np.load(fa), SR, words, f"piper:{model}")

        args = (text, model, length, noise, noise_w, semitones, gain_db, pause)
        best, best_score, scores = None, 9.0, []
        for k in range(max(1, takes)):
            y, words = self._take(*args)
            if takes <= 1:
                best = (y, words)
                break
            sc = _intelligibility(y, text)
            if sc is None:          # Whisper yok → seçim yapılamaz
                best = (y, words)
                break
            scores.append(round(sc, 3))
            if sc < best_score:
                best, best_score = (y, words), sc
            if sc <= 0.02:          # neredeyse kusursuz: yeterli
                break
        y, words = best
        np.save(fa, y.astype(np.float32))
        fm.write_text(json.dumps({"words": words, "text": text, "model": model, "take_cer": scores}, ensure_ascii=False))
        return EdgeResult(y, SR, [(t, max(0.0, a + WORD_SHIFT), b + WORD_SHIFT) for t, a, b in words], f"piper:{model}")

    def say_cfg(self, text: str, cfg: dict, rate: str = "+0%") -> EdgeResult:
        """Hikâye hattı için: stil sözlüğü (model, length, noise, noise_w, semitones, gain_db, pause) +
        yüzde hız (\"+8%\" → daha hızlı = daha kısa fonemler)."""
        pct = float(str(rate).strip().rstrip("%") or 0)
        length = float(cfg.get("length", 1.0)) / (1 + pct / 100)
        return self.say(text, model=cfg.get("model", self.default), length=round(length, 4), noise=float(cfg.get("noise", 0.6)),
                        noise_w=float(cfg.get("noise_w", 0.7)), semitones=float(cfg.get("semitones", 0)),
                        gain_db=float(cfg.get("gain_db", 0)), pause=float(cfg.get("pause", 0.3)), takes=int(cfg.get("takes", 1)))
