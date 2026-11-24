"""Seslendirme motorları:
  - google : Google Cloud Text-to-Speech (Chirp3-HD / WaveNet), API anahtarı gerekir
  - piper  : Piper (yerel, ücretsiz, anahtarsız nöral TTS; CPU'da gerçek zamandan ~8x hızlı)
  - espeak : espeak-ng (yalnızca robotik önizleme)

`auto` sırası: Google (anahtar varsa) → Piper → espeak.

Kimlik doğrulama (öncelik sırasıyla):
  1. GOOGLE_TTS_API_KEY ortam değişkeni → X-Goog-Api-Key başlığı
  2. GOOGLE_TTS_ACCESS_TOKEN / `gcloud auth print-access-token` → Bearer
  3. Başlıksız istek (ağ proxy'si anahtarı enjekte ediyorsa)

Kelime zamanlaması: SSML <mark> destekleyen seslerde (Wavenet/Standard/Neural2)
Google'ın döndürdüğü zaman noktaları kullanılır; Chirp3-HD gibi seslerde
align.py hece-ağırlıklı + sessizlik tabanlı hizalama yapar.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np

API = "https://texttospeech.googleapis.com"
CACHE = Path(os.environ.get("VIRAL_CACHE", ".cache")) / "tts"
SR = 48000

DEFAULT_VOICE_PREFS = [
    "tr-TR-Chirp3-HD-Charon",
    "tr-TR-Chirp3-HD-Puck",
    "tr-TR-Chirp3-HD-Orus",
    "tr-TR-Chirp3-HD-*",
    "tr-TR-Wavenet-E",
    "tr-TR-Wavenet-B",
    "tr-TR-Standard-E",
    "tr-TR-*",
]


PIPER_DIR = Path(os.environ.get("PIPER_VOICES_DIR", Path(os.environ.get("VIRAL_CACHE", ".cache")) / "piper"))
PIPER_DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "tr_TR-dfki-medium")
PIPER_SENTENCE_GAP = 0.15  # cümleler arası sessizlik (sn); align.py duraklama tespiti için de işe yarar


class TTSAuthError(RuntimeError):
    pass


@dataclass
class TTSResult:
    audio: np.ndarray            # mono float32, SR Hz
    sr: int
    word_starts: list[float] | None  # SSML mark zamanları (varsa)
    voice: str
    engine: str


def _auth_headers() -> dict[str, str]:
    key = os.environ.get("GOOGLE_TTS_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return {"X-Goog-Api-Key": key}
    tok = os.environ.get("GOOGLE_TTS_ACCESS_TOKEN")
    if not tok and shutil.which("gcloud") and os.environ.get("VIRAL_USE_GCLOUD", "1") == "1":
        try:
            tok = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, timeout=20).stdout.strip()
        except Exception:
            tok = None
    if tok and len(tok) > 20:
        h = {"Authorization": f"Bearer {tok}"}
        proj = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if proj:
            h["x-goog-user-project"] = proj
        return h
    return {}


def _request(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in _auth_headers().items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "replace")[:600]
        if e.code in (401, 403):
            raise TTSAuthError(
                f"Google TTS yetkilendirme hatası ({e.code}). GOOGLE_TTS_API_KEY ayarlayın ve projede "
                f"'Cloud Text-to-Speech API'nin etkin olduğundan emin olun.\n{msg}"
            ) from None
        raise RuntimeError(f"Google TTS HTTP {e.code}: {msg}") from None


_VOICES: list[dict] | None = None


def list_voices(lang: str = "tr-TR") -> list[dict]:
    global _VOICES
    if _VOICES is None:
        _VOICES = _request("GET", f"/v1/voices?languageCode={lang}").get("voices", [])
    return _VOICES


def pick_voice(prefs: list[str] | None = None, lang: str = "tr-TR") -> str:
    names = [v["name"] for v in list_voices(lang)]
    for p in prefs or DEFAULT_VOICE_PREFS:
        if p.endswith("*"):
            cands = sorted(n for n in names if n.startswith(p[:-1]))
            if cands:
                return cands[0]
        elif p in names:
            return p
    if not names:
        raise RuntimeError(f"{lang} için ses bulunamadı")
    return names[0]


def supports_marks(voice: str) -> bool:
    v = voice.lower()
    return not ("chirp" in v or "journey" in v or "studio" in v or "polyglot" in v)


def _decode_wav(b: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(b)) as w:
        sr = w.getframerate()
        n = w.getnframes()
        ch = w.getnchannels()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def _resample(a: np.ndarray, sr: int, to: int = SR) -> np.ndarray:
    if sr == to:
        return a
    from scipy.signal import resample_poly
    from math import gcd
    g = gcd(sr, to)
    return resample_poly(a, to // g, sr // g).astype(np.float32)


def _cache_key(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]


def synthesize_google(text: str, words: list[str], voice: str, rate: float = 1.1, pitch: float = 0.0, lang: str = "tr-TR") -> TTSResult:
    CACHE.mkdir(parents=True, exist_ok=True)
    marks = supports_marks(voice)
    key = _cache_key("g2", text, words if marks else None, voice, round(rate, 3), round(pitch, 2))
    wav_p, meta_p = CACHE / f"{key}.wav", CACHE / f"{key}.json"
    if wav_p.exists() and meta_p.exists():
        a, sr = _decode_wav(wav_p.read_bytes())
        meta = json.loads(meta_p.read_text())
        return TTSResult(_resample(a, sr), SR, meta.get("word_starts"), voice, "google")

    audio_cfg = {"audioEncoding": "LINEAR16", "sampleRateHertz": 48000, "speakingRate": rate}
    if marks:
        audio_cfg["pitch"] = pitch
        audio_cfg["effectsProfileId"] = ["headphone-class-device"]
        ssml = "<speak>" + " ".join(f'<mark name="w{i}"/>{escape(w)}' for i, w in enumerate(words)) + "</speak>"
        body = {"input": {"ssml": ssml}, "voice": {"languageCode": lang, "name": voice}, "audioConfig": audio_cfg, "enableTimePointing": ["SSML_MARK"]}
        resp = _request("POST", "/v1beta1/text:synthesize", body)
    else:
        body = {"input": {"text": text}, "voice": {"languageCode": lang, "name": voice}, "audioConfig": audio_cfg}
        try:
            resp = _request("POST", "/v1/text:synthesize", body)
        except RuntimeError as e:
            if "speaking" in str(e).lower() or "rate" in str(e).lower():
                audio_cfg.pop("speakingRate", None)
                resp = _request("POST", "/v1/text:synthesize", body)
            else:
                raise
    b = base64.b64decode(resp["audioContent"])
    word_starts = None
    if marks and resp.get("timepoints"):
        tp = {p["markName"]: p["timeSeconds"] for p in resp["timepoints"]}
        word_starts = [tp.get(f"w{i}") for i in range(len(words))]
        if any(x is None for x in word_starts):
            word_starts = None
    wav_p.write_bytes(b)
    meta_p.write_text(json.dumps({"word_starts": word_starts, "voice": voice}))
    a, sr = _decode_wav(b)
    return TTSResult(_resample(a, sr), SR, word_starts, voice, "google")


# ------------------------------------------------------------------ Piper
_PIPER_VOICES: dict[str, object] = {}


def _piper_model_path(voice: str) -> Path:
    """Ses adı (tr_TR-dfki-medium), yerel .onnx yolu ya da .onnx URL'si → yerel model yolu.

    Model yoksa indirilir (resmi sesler huggingface.co/rhasspy/piper-voices'tan; URL verilirse
    yanındaki .onnx.json ile birlikte o adresten).
    """
    if voice.startswith(("http://", "https://")):
        name = voice.split("?")[0].rsplit("/", 1)[-1]
        dest = PIPER_DIR / name
        if not dest.exists() or not Path(str(dest) + ".json").exists():
            PIPER_DIR.mkdir(parents=True, exist_ok=True)
            base, q = (voice.split("?", 1) + [""])[:2]
            for src, dst in ((voice, dest), (base + ".json" + ("?" + q if q else ""), Path(str(dest) + ".json"))):
                print(f"[tts] Piper modeli indiriliyor: {src}")
                tmp = dst.with_suffix(dst.suffix + ".part")
                with urllib.request.urlopen(src, timeout=120) as r, open(tmp, "wb") as f:
                    shutil.copyfileobj(r, f)
                tmp.replace(dst)
        return dest
    p = Path(voice)
    if p.suffix == ".onnx":
        if not p.exists():
            raise RuntimeError(f"Piper modeli bulunamadı: {p}")
        return p
    dest = PIPER_DIR / f"{voice}.onnx"
    if not dest.exists() or not Path(str(dest) + ".json").exists():
        from piper.download_voices import download_voice
        PIPER_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[tts] Piper sesi indiriliyor: {voice}")
        download_voice(voice, PIPER_DIR)
    return dest


def _piper_voice(voice: str):
    if voice not in _PIPER_VOICES:
        try:
            from piper import PiperVoice
        except ImportError:
            raise RuntimeError("Piper kurulu değil: pip install piper-tts onnx") from None
        # include_alignments: model bellekte yamanır (onnx paketi gerekir), fonem süreleri döner
        _PIPER_VOICES[voice] = PiperVoice.load(_piper_model_path(voice), include_alignments=True)
    return _PIPER_VOICES[voice]


def piper_word_starts(chunks: list[tuple[int, list[tuple[str, int]] | None]], sr: int, gap: float) -> list[float] | None:
    """Cümle parçalarının fonem hizalamalarından kelime başlangıçlarını (sn) çıkarır.

    chunks: her cümle için (örnek sayısı, [(fonem, örnek sayısı), ...] ya da None).
    Kelimeler fonem dizisindeki boşluklarla ayrılır; cümleler arasında `gap` sn sessizlik vardır.
    """
    starts: list[float] = []
    offset = 0
    gap_n = int(round(gap * sr))
    for n, aligns in chunks:
        if aligns is None:
            return None
        pos = offset
        in_word = False
        for ph, k in aligns:
            if ph in ("^", "$", "_"):
                in_word = False if ph == "^" else in_word
            elif ph == " ":
                in_word = False
            elif not in_word and ph.strip():
                starts.append(pos / sr)
                in_word = True
            pos += int(k)
        offset += n + gap_n
    return starts


def synthesize_piper(text: str, words: list[str], voice: str, rate: float = 1.1, speaker: int | None = None) -> TTSResult:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = _cache_key("p1", text, voice, round(rate, 3), speaker, PIPER_SENTENCE_GAP)
    wav_p, meta_p = CACHE / f"{key}.wav", CACHE / f"{key}.json"
    if wav_p.exists() and meta_p.exists():
        a, sr = _decode_wav(wav_p.read_bytes())
        meta = json.loads(meta_p.read_text())
        ws = meta.get("word_starts")
        return TTSResult(_resample(a, sr), SR, ws if ws and len(ws) == len(words) else None, voice, "piper")

    from piper import SynthesisConfig
    pv = _piper_voice(voice)
    sr = pv.config.sample_rate
    cfg = SynthesisConfig(speaker_id=speaker, length_scale=1.0 / max(0.3, rate))
    parts, info = [], []
    gap = np.zeros(int(round(PIPER_SENTENCE_GAP * sr)), dtype=np.float32)
    for i, ch in enumerate(pv.synthesize(text, cfg, include_alignments=True)):
        a = ch.audio_float_array.astype(np.float32) * 0.9
        if i:
            parts.append(gap)
        parts.append(a)
        al = [(x.phoneme, int(x.num_samples)) for x in ch.phoneme_alignments] if ch.phoneme_alignments else None
        info.append((len(a), al))
    audio = np.concatenate(parts) if parts else np.zeros(sr // 10, dtype=np.float32)
    ws = piper_word_starts(info, sr, PIPER_SENTENCE_GAP)
    if ws is not None and len(ws) != len(words):
        ws = None  # kelime sayısı tutmuyorsa align.py'ye bırak
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(wav_p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    meta_p.write_text(json.dumps({"word_starts": ws, "voice": voice}))
    return TTSResult(_resample(audio, sr), SR, ws, voice, "piper")


def list_piper_voices(lang: str = "tr_TR") -> list[str]:
    from piper.download_voices import VOICES_JSON
    with urllib.request.urlopen(VOICES_JSON, timeout=60) as r:
        d = json.load(r)
    return sorted(k for k in d if k.startswith(lang))


def synthesize_espeak(text: str, rate: float = 1.1, voice: str = "tr") -> TTSResult:
    """Yalnızca anahtarsız önizleme içindir (robotik ses)."""
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        raise RuntimeError("espeak-ng bulunamadı (önizleme için: apt-get install espeak-ng)")
    CACHE.mkdir(parents=True, exist_ok=True)
    key = _cache_key("es", text, rate, voice)
    p = CACHE / f"{key}.wav"
    if not p.exists():
        wpm = int(165 * rate)
        subprocess.run([exe, "-v", voice, "-s", str(wpm), "-p", "42", "-w", str(p), text], check=True, capture_output=True)
    a, sr = _decode_wav(p.read_bytes())
    return TTSResult(_resample(a, sr), SR, None, "espeak-" + voice, "espeak")


class Voice:
    """Pipeline'ın kullandığı TTS cephesi."""

    def __init__(self, engine: str = "auto", voice: str | None = None, prefs: list[str] | None = None, pitch: float = 0.0,
                 lang: str = "tr-TR", speaker: int | None = None):
        self.engine = engine
        self.lang = lang
        self.pitch = pitch
        self.voice = None if voice == "auto" else voice
        self.prefs = prefs
        self.speaker = speaker
        if engine in ("auto", "google"):
            try:
                if not self.voice or self.voice.startswith("tr_TR-") or self.voice.endswith(".onnx"):
                    self.voice = pick_voice(prefs, lang)
                self.engine = "google"
            except (TTSAuthError, OSError) as e:
                if engine == "google":
                    raise
                if not isinstance(e, TTSAuthError):
                    print(f"[tts] Google TTS'e ulaşılamadı ({e}); Piper'a geçiliyor")
                self.engine = "piper"
                self.voice = voice if voice and _is_piper_voice(voice) else None
        if self.engine == "piper":
            if not self.voice or not _is_piper_voice(self.voice):
                self.voice = PIPER_DEFAULT_VOICE
            try:
                _piper_voice(self.voice)
            except Exception as e:
                if engine == "piper":
                    raise
                print(f"[tts] Piper kullanılamadı ({e}); espeak önizlemesine düşülüyor")
                self.engine = "espeak"
        if self.engine == "espeak":
            self.voice = "tr"
        print(f"[tts] motor={self.engine} ses={self.voice}")

    @property
    def max_rate(self) -> float:
        return {"google": 1.3, "piper": 1.6}.get(self.engine, 1.6)

    def say(self, text: str, words: list[str], rate: float) -> TTSResult:
        if self.engine == "google":
            return synthesize_google(text, words, self.voice, rate, self.pitch, self.lang)
        if self.engine == "piper":
            return synthesize_piper(text, words, self.voice, rate, self.speaker)
        return synthesize_espeak(text, rate)


def _is_piper_voice(v: str) -> bool:
    return bool(v) and (v.endswith(".onnx") or ".onnx?" in v or "_" in v.split("-", 1)[0] and v.count("-") >= 2)
