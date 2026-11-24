"""Seslendirme motorları.

  • ElevenLabs (birincil) — eleven_multilingual_v2, Türkçe. `/with-timestamps` uç noktası karakter
    düzeyinde zaman döndürür → altyazılar kelimesi kelimesine senkron olur.
    Anahtar: ELEVENLABS_API_KEY (GitHub Actions'ta repo secret'ı).
  • Google Cloud Text-to-Speech (alternatif) — Chirp3-HD / WaveNet.
  • espeak-ng — yalnızca anahtarsız yerel önizleme (robotik ses).

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


# ------------------------------------------------------------------ ElevenLabs
EL_API = "https://api.elevenlabs.io"
EL_DEFAULT_MODEL = "eleven_multilingual_v2"
# Hazır (premade) sesler: tüm hesaplarda bulunur ve multilingual_v2 ile Türkçe konuşur.
EL_DEFAULT_VOICES = [
    "nPczCjzI2devNBz1zQrb",  # Brian — derin, rezonanslı anlatıcı
    "pNInz6obpgDQGcFmaJgB",  # Adam
    "onwK4e9ZLuTAKqWW03F9",  # Daniel
]
_PUNCT = ".,;:!?\"“”«»()…—–'’"


def _el_key() -> str | None:
    for k in ("ELEVENLABS_API_KEY", "ELEVEN_API_KEY", "XI_API_KEY"):
        if os.environ.get(k):
            return os.environ[k].strip()
    return None


def elevenlabs_available() -> bool:
    return bool(_el_key()) or os.environ.get("VIRAL_ELEVENLABS_PROXY") == "1"


def _el_request(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(EL_API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("xi-api-key", _el_key() or "proxy-injected")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "replace")[:600]
        if e.code in (401, 403):
            raise TTSAuthError(f"ElevenLabs yetkilendirme hatası ({e.code}). ELEVENLABS_API_KEY'i kontrol edin.\n{msg}") from None
        raise RuntimeError(f"ElevenLabs HTTP {e.code}: {msg}") from None


def list_elevenlabs_voices() -> list[dict]:
    return _el_request("GET", "/v1/voices").get("voices", [])


def pick_elevenlabs_voice(pref: str | None = None) -> str:
    want = pref or os.environ.get("ELEVENLABS_VOICE_ID")
    if want and want != "auto":
        if len(want) >= 18 and " " not in want:   # doğrudan voice_id
            return want
        for v in list_elevenlabs_voices():       # ada göre ara
            if v.get("name", "").casefold().startswith(want.casefold()):
                return v["voice_id"]
        raise RuntimeError(f"ElevenLabs sesi bulunamadı: {want}")
    return EL_DEFAULT_VOICES[0]


def _word_times_from_alignment(text: str, al: dict) -> list[tuple[float, float]]:
    """Karakter hizalamasından boşlukla ayrılmış (noktalama-dışı) kelimelerin (başlangıç, bitiş) zamanları."""
    chars = al.get("characters") or []
    st = al.get("character_start_times_seconds") or []
    en = al.get("character_end_times_seconds") or []
    words: list[tuple[float, float]] = []
    cur: list[int] = []
    txt = "".join(chars)

    def flush():
        if cur:
            w = "".join(txt[i] for i in cur)
            if w.strip(_PUNCT):
                idx = [i for i in cur if txt[i] not in _PUNCT] or cur
                words.append((float(st[idx[0]]), float(en[idx[-1]])))
            cur.clear()

    for i, ch in enumerate(chars):
        if ch.isspace():
            flush()
        else:
            cur.append(i)
    flush()
    return words


def synthesize_elevenlabs(text: str, words: list[str], voice_id: str, rate: float = 1.0, *, model: str | None = None,
                          settings: dict | None = None, prev_text: str | None = None, next_text: str | None = None) -> TTSResult:
    CACHE.mkdir(parents=True, exist_ok=True)
    model = model or os.environ.get("ELEVENLABS_MODEL") or EL_DEFAULT_MODEL
    vs = {"stability": 0.42, "similarity_boost": 0.82, "style": 0.38, "use_speaker_boost": True}
    vs.update(settings or {})
    vs["speed"] = float(np.clip(rate, 0.7, 1.2))
    key = _cache_key("el2", text, voice_id, model, vs, prev_text, next_text)
    wav_p, meta_p = CACHE / f"{key}.wav", CACHE / f"{key}.json"
    if wav_p.exists() and meta_p.exists():
        a, sr = _decode_wav(wav_p.read_bytes())
        meta = json.loads(meta_p.read_text())
        return TTSResult(_resample(a, sr), SR, meta.get("word_starts"), voice_id, "elevenlabs")
    body: dict = {"text": text, "model_id": model, "voice_settings": vs}
    if prev_text:
        body["previous_text"] = prev_text
    if next_text:
        body["next_text"] = next_text
    # mp3_44100_128 tüm ElevenLabs paketlerinde var (pcm_44100 yalnızca Pro+); ffmpeg ile çözülür.
    fmt = os.environ.get("ELEVENLABS_FORMAT", "mp3_44100_128")
    resp = _el_request("POST", f"/v1/text-to-speech/{voice_id}/with-timestamps?output_format={fmt}", body)
    raw = base64.b64decode(resp["audio_base64"])
    if fmt.startswith("pcm_"):
        sr = int(fmt.split("_")[1])
        pcm = raw
    else:
        sr = 44100
        r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", str(sr), "pipe:1"],
                           input=raw, capture_output=True, check=True)
        pcm = r.stdout
    a = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    al = resp.get("alignment") or resp.get("normalized_alignment") or {}
    wt = _word_times_from_alignment(text, al)
    word_starts = [s for s, _ in wt] if len(wt) == len(words) else None
    if word_starts is None and al:
        print(f"[tts] uyarı: hizalama kelime sayısı {len(wt)} ≠ {len(words)}; sessizlik tabanlı hizalama kullanılacak")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm)
    wav_p.write_bytes(buf.getvalue())
    meta_p.write_text(json.dumps({"word_starts": word_starts, "voice": voice_id, "model": model}))
    return TTSResult(_resample(a, sr), SR, word_starts, voice_id, "elevenlabs")


class Voice:
    """Pipeline'ın kullandığı TTS cephesi.

    engine: auto | elevenlabs | google | espeak
      auto → ElevenLabs anahtarı varsa ElevenLabs, yoksa Google, o da yoksa espeak (önizleme).
    """

    def __init__(self, engine: str = "auto", voice: str | None = None, prefs: list[str] | None = None, pitch: float = 0.0,
                 lang: str = "tr-TR", settings: dict | None = None, model: str | None = None):
        self.engine = engine
        self.lang = lang
        self.pitch = pitch
        self.voice = voice
        self.prefs = prefs
        self.settings = settings or {}
        self.model = model
        if engine == "elevenlabs" or (engine == "auto" and elevenlabs_available()):
            self.engine = "elevenlabs"
            self.voice = pick_elevenlabs_voice(voice if voice and not str(voice).startswith("tr-TR") else None)
            print(f"[tts] motor=elevenlabs ses={self.voice} model={model or os.environ.get('ELEVENLABS_MODEL') or EL_DEFAULT_MODEL}")
            return
        if engine in ("auto", "google"):
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

    def say(self, text: str, words: list[str], rate: float, prev_text: str | None = None, next_text: str | None = None) -> TTSResult:
        if self.engine == "elevenlabs":
            return synthesize_elevenlabs(text, words, self.voice, rate, model=self.model, settings=self.settings,
                                         prev_text=prev_text, next_text=next_text)
        if self.engine == "google":
            return synthesize_google(text, words, self.voice, rate, self.pitch, self.lang)
        return synthesize_espeak(text, rate)
