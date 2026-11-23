"""Seslendirme motorları.

  • edge   (varsayılan) Microsoft Edge nöral TTS — Türkçe "Emel" sesi (tr-TR-EmelNeural).
           Anahtar gerektirmez; kelime sınırları (WordBoundary) doğrudan servisten gelir,
           böylece altyazılar kelime kelime senkron olur.
  • google Google Cloud Text-to-Speech (Chirp3-HD / WaveNet) — API anahtarı gerekir.
  • espeak Yalnızca çevrimdışı önizleme (robotik ses).

Google kimlik doğrulama (öncelik sırasıyla):
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
EDGE_DEFAULT_VOICE = "tr-TR-EmelNeural"
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


class TTSAuthError(RuntimeError):
    pass


@dataclass
class TTSResult:
    audio: np.ndarray            # mono float32, SR Hz
    sr: int
    word_starts: list[float] | None  # SSML mark / WordBoundary zamanları (varsa)
    voice: str
    engine: str
    word_ends: list[float] | None = None


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


# ------------------------------------------------------------------ Microsoft Edge TTS
def _norm_tr(s: str) -> str:
    s = s.replace("İ", "i").replace("I", "ı").lower()
    return "".join(ch for ch in s if ch.isalnum())


def map_boundaries(words: list[str], bounds: list[tuple[float, float, str]]) -> tuple[list[float], list[float]]:
    """Servisin kelime sınırlarını (başlangıç, süre, metin) bizim konuşulan kelime listemize eşler.

    Her iki taraf harf dizisine indirgenir; sınırlar sırayla bu dizide aranır. Eşleşmeyen
    kelimeler komşuları arasında hece ağırlığıyla doldurulur.
    """
    from .script import syllables
    norm = [_norm_tr(w) for w in words]
    owner: list[int] = []
    for i, w in enumerate(norm):
        owner += [i] * len(w)
    A = "".join(norm)
    t_s: list[float | None] = [None] * len(A)
    t_e: list[float | None] = [None] * len(A)
    p = 0
    for off, dur, txt in bounds:
        b = _norm_tr(txt)
        if not b:
            continue
        j = A.find(b, p)
        if j < 0 or j - p > 24:
            continue
        for k in range(j, j + len(b)):
            t_s[k], t_e[k] = off, off + dur
        p = j + len(b)
    starts: list[float | None] = []
    ends: list[float | None] = []
    c = 0
    for w in norm:
        ss = [x for x in t_s[c:c + len(w)] if x is not None]
        ee = [x for x in t_e[c:c + len(w)] if x is not None]
        starts.append(min(ss) if ss else None)
        ends.append(max(ee) if ee else None)
        c += len(w)
    n = len(words)
    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        j = i
        while j < n and starts[j] is None:
            j += 1
        a = ends[i - 1] if i > 0 and ends[i - 1] is not None else (starts[i - 1] if i > 0 else 0.0)
        b = starts[j] if j < n else (a + 0.35 * (j - i))
        ws = [syllables(words[k]) + 0.3 for k in range(i, j)]
        tot = sum(ws)
        t = a
        for k, wgt in zip(range(i, j), ws):
            d = (b - a) * wgt / tot
            starts[k], ends[k] = t, t + d
            t += d
        i = j
    for k in range(n):
        if ends[k] is None or ends[k] <= starts[k]:
            ends[k] = starts[k] + 0.12
    return [float(x) for x in starts], [float(x) for x in ends]


def _edge_rate(rate: float) -> str:
    return f"{int(round((rate - 1.0) * 100)):+d}%"


def _edge_pitch(pitch) -> str:
    if isinstance(pitch, str):
        return pitch
    return f"{int(round(pitch or 0)):+d}Hz"


def _mp3_to_pcm(b: bytes, sr: int = SR) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", str(sr), "pipe:1"],
                       input=b, capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0


async def _edge_stream(text: str, voice: str, rate: str, pitch: str):
    import edge_tts
    proxy = os.environ.get("EDGE_TTS_PROXY") or os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary", proxy=proxy,
                               connect_timeout=20, receive_timeout=90)
    audio = bytearray()
    bounds: list[tuple[float, float, str]] = []
    async for ch in com.stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] == "WordBoundary":
            bounds.append((ch["offset"] / 1e7, ch["duration"] / 1e7, ch["text"]))
    return bytes(audio), bounds


def synthesize_edge(text: str, words: list[str], voice: str = EDGE_DEFAULT_VOICE, rate: float = 1.1, pitch=0) -> TTSResult:
    import asyncio
    import time as _time
    CACHE.mkdir(parents=True, exist_ok=True)
    key = _cache_key("e1", text, voice, round(rate, 3), _edge_pitch(pitch))
    mp3_p, meta_p = CACHE / f"{key}.mp3", CACHE / f"{key}.json"
    if mp3_p.exists() and meta_p.exists():
        b = mp3_p.read_bytes()
        bounds = [tuple(x) for x in json.loads(meta_p.read_text())["bounds"]]
    else:
        last = None
        for attempt in range(5):
            try:
                b, bounds = asyncio.run(_edge_stream(text, voice, _edge_rate(rate), _edge_pitch(pitch)))
                if not b:
                    raise RuntimeError("Edge TTS boş ses döndürdü")
                break
            except Exception as e:  # ağ kesintisi, hız sınırı vb.
                last = e
                _time.sleep(1.5 * (attempt + 1))
        else:
            raise RuntimeError(f"Edge TTS başarısız ({voice}): {last}")
        mp3_p.write_bytes(b)
        meta_p.write_text(json.dumps({"bounds": bounds, "voice": voice, "text": text}, ensure_ascii=False))
    audio = _mp3_to_pcm(b)
    starts, ends = map_boundaries(words, bounds) if bounds else (None, None)
    return TTSResult(audio, SR, starts, voice, "edge", ends)


def list_edge_voices(lang: str = "tr-TR") -> list[dict]:
    import asyncio
    import edge_tts

    async def go():
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        return await edge_tts.list_voices(proxy=proxy)
    return [v for v in asyncio.run(go()) if v.get("Locale") == lang]


def is_edge_voice(name: str | None) -> bool:
    return bool(name) and name.endswith("Neural") and "-Neural" not in name


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
    """Pipeline'ın kullandığı TTS cephesi.

    engine: auto (→ edge) | edge | google | espeak
    """

    def __init__(self, engine: str = "auto", voice: str | None = None, prefs: list[str] | None = None, pitch: float = 0.0, lang: str = "tr-TR"):
        self.engine = engine
        self.lang = lang
        self.pitch = pitch
        self.voice = voice
        self.prefs = prefs
        if engine == "auto" and (not voice or voice == "auto" or is_edge_voice(voice)):
            engine = "edge"
        if engine == "edge":
            self.engine = "edge"
            if not self.voice or self.voice == "auto" or not is_edge_voice(self.voice):
                self.voice = EDGE_DEFAULT_VOICE
        elif engine in ("auto", "google"):
            try:
                if not self.voice or self.voice == "auto":
                    self.voice = pick_voice(prefs, lang)
                self.engine = "google"
            except TTSAuthError:
                if engine == "google":
                    raise
                self.engine = "espeak"
                self.voice = "tr"
        print(f"[tts] motor={self.engine} ses={self.voice}")

    @property
    def max_rate(self) -> float:
        return {"edge": 1.4, "google": 1.3}.get(self.engine, 1.6)

    def say(self, text: str, words: list[str], rate: float) -> TTSResult:
        if self.engine == "edge":
            return synthesize_edge(text, words, self.voice, rate, self.pitch)
        if self.engine == "google":
            return synthesize_google(text, words, self.voice, rate, self.pitch, self.lang)
        return synthesize_espeak(text, rate)
