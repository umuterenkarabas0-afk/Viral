"""Seslendirme: Google Cloud Text-to-Speech, Microsoft Edge nöral sesleri (edge-tts, anahtarsız)
ve espeak-ng (yalnızca önizleme).

Kimlik doğrulama (öncelik sırasıyla):
  1. GOOGLE_TTS_API_KEY ortam değişkeni → X-Goog-Api-Key başlığı
  2. GOOGLE_TTS_ACCESS_TOKEN / `gcloud auth print-access-token` → Bearer
  3. Başlıksız istek (ağ proxy'si anahtarı enjekte ediyorsa)

Kelime zamanlaması: SSML <mark> destekleyen seslerde (Wavenet/Standard/Neural2)
Google'ın döndürdüğü zaman noktaları kullanılır; Chirp3-HD gibi seslerde
align.py hece-ağırlıklı + sessizlik tabanlı hizalama yapar. Edge seslerinde
servisin WordBoundary olayları kelimelere eşlenir.

Edge (Microsoft) sesleri: tr-TR-AhmetNeural (erkek, varsayılan), tr-TR-EmelNeural (kadın).
Ses seçimi: VIRAL_EDGE_VOICE ortam değişkeni > senaryodaki voice.name (…Neural ise) > varsayılan.
Not: edge-tts WebSocket kullanır; WebSocket geçirmeyen proxy'lerin arkasında çalışmaz.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import time
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

EDGE_DEFAULT_VOICE = "tr-TR-AhmetNeural"


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
        if e.code in (401, 403) or (e.code == 400 and "API_KEY_INVALID" in msg):
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


def _norm_word(w: str) -> str:
    """Eşleştirme için: Türkçe küçük harf + yalnızca harf/rakam."""
    w = w.replace("İ", "i").replace("I", "ı").lower()
    return "".join(ch for ch in w if ch.isalnum())


def map_word_boundaries(words: list[str], boundaries: list[tuple[float, float, str]]) -> list[float] | None:
    """Edge'in (başlangıç sn, süre sn, metin) kelime sınırlarını senaryonun kelimelerine eşler.

    Eşleme harf düzeyinde yapılır; böylece servis bir kelimeyi bölse ("Akdeniz" + "de") ya da
    birleştirse de doğru zaman bulunur. Metinler uyuşmazsa ve sayılar eşit değilse None döner
    (align.py kendi hizalamasına düşer).
    """
    bnd = [(s, d, _norm_word(t)) for s, d, t in boundaries]
    bnd = [b for b in bnd if b[2]]
    wn = [_norm_word(w) for w in words]
    if not bnd or not words:
        return None
    if "".join(wn) != "".join(b[2] for b in bnd):
        return [b[0] for b in bnd] if len(bnd) == len(words) else None
    starts: list[float] = []
    k, kpos, pos = 0, 0, 0  # k: sınır indeksi, kpos: sınırın ilk harf konumu, pos: kelimenin ilk harf konumu
    for w in wn:
        while k < len(bnd) - 1 and pos >= kpos + len(bnd[k][2]):
            kpos += len(bnd[k][2])
            k += 1
        s, d, t = bnd[k]
        frac = min(1.0, (pos - kpos) / len(t))
        starts.append(s + frac * d)
        pos += len(w)
    return starts


async def _edge_stream(text: str, voice: str, rate: str) -> tuple[bytes, list[tuple[float, float, str]]]:
    import edge_tts

    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    audio = bytearray()
    bounds: list[tuple[float, float, str]] = []
    async for ch in com.stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] == "WordBoundary":
            bounds.append((ch["offset"] / 1e7, ch["duration"] / 1e7, ch["text"]))
    return bytes(audio), bounds


def _decode_mp3(b: bytes, sr: int = SR) -> np.ndarray:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("MP3 çözmek için ffmpeg gerekli (apt-get install ffmpeg)")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(sr), "pipe:1"],
                       input=b, capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def edge_rate(rate: float) -> str:
    """1.1 → '+10%' (edge-tts hız biçimi)."""
    return f"{round((rate - 1.0) * 100):+d}%"


def synthesize_edge(text: str, words: list[str], voice: str = EDGE_DEFAULT_VOICE, rate: float = 1.1) -> TTSResult:
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        raise RuntimeError("edge-tts kurulu değil: pip install edge-tts") from None
    CACHE.mkdir(parents=True, exist_ok=True)
    key = _cache_key("edge1", text, voice, edge_rate(rate))
    mp3_p, meta_p = CACHE / f"{key}.mp3", CACHE / f"{key}.json"
    if mp3_p.exists() and meta_p.exists():
        bounds = [tuple(b) for b in json.loads(meta_p.read_text())["boundaries"]]
        audio = mp3_p.read_bytes()
    else:
        err: Exception | None = None
        for attempt in range(4):
            try:
                audio, bounds = asyncio.run(_edge_stream(text, voice, edge_rate(rate)))
                if audio:
                    break
                err = RuntimeError("Edge TTS boş ses döndürdü")
            except Exception as e:  # ağ / servis hataları: kısa bekleyip yeniden dene
                err = e
            time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError(f"Edge TTS başarısız ({voice}): {err}") from err
        mp3_p.write_bytes(audio)
        meta_p.write_text(json.dumps({"voice": voice, "boundaries": bounds}, ensure_ascii=False))
    return TTSResult(_decode_mp3(audio), SR, map_word_boundaries(words, bounds), voice, "edge")


def list_edge_voices(lang: str = "tr-TR", timeout: float = 20.0) -> list[dict]:
    import edge_tts

    voices = asyncio.run(asyncio.wait_for(edge_tts.list_voices(), timeout))
    return [v for v in voices if v.get("Locale") == lang]


def _edge_usable() -> bool:
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        return False
    try:
        return bool(list_edge_voices())
    except Exception:
        return False


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

    def __init__(self, engine: str = "auto", voice: str | None = None, prefs: list[str] | None = None, pitch: float = 0.0, lang: str = "tr-TR"):
        self.engine = engine
        self.lang = lang
        self.pitch = pitch
        self.voice = voice
        self.prefs = prefs
        if engine in ("auto", "google"):
            try:
                if not self.voice or self.voice == "auto":
                    self.voice = pick_voice(prefs, lang)
                self.engine = "google"
            except TTSAuthError:
                if engine == "google":
                    raise
                # anahtar yok: önce ücretsiz Microsoft seslerini dene, olmazsa espeak
                self.engine = "edge" if _edge_usable() else "espeak"
        if self.engine == "edge":
            self.voice = os.environ.get("VIRAL_EDGE_VOICE") or (voice if voice and voice.endswith("Neural") else EDGE_DEFAULT_VOICE)
        elif self.engine == "espeak":
            self.voice = "tr"
        print(f"[tts] motor={self.engine} ses={self.voice}")

    def say(self, text: str, words: list[str], rate: float) -> TTSResult:
        if self.engine == "google":
            return synthesize_google(text, words, self.voice, rate, self.pitch, self.lang)
        if self.engine == "edge":
            return synthesize_edge(text, words, self.voice, rate)
        return synthesize_espeak(text, rate)
