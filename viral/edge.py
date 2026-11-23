"""Microsoft Edge TTS (çevrimiçi "Read Aloud" servisi) — Türkçe Neural sesler.

Varsayılan ses: tr-TR-AhmetNeural. Servis her kelime için WordBoundary olayı
döndürdüğünden altyazı zamanlaması doğrudan sentezden gelir (tahmin yok).

    from viral.edge import EdgeVoice
    v = EdgeVoice("tr-TR-AhmetNeural")
    r = v.say("Merhaba dünya", rate="+8%", pitch="-4Hz")
    r.audio (48 kHz mono float32), r.words [(metin, başlangıç, bitiş), ...]

Ağ notu: istekler HTTPS_PROXY üzerinden gider; özel bir CA paketi gerekiyorsa
SSL_CERT_FILE / REQUESTS_CA_BUNDLE ortam değişkenleri kullanılır.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import ssl
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SR = 48000
CACHE = Path(os.environ.get("VIRAL_CACHE", ".cache")) / "edge"
DEFAULT_VOICE = "tr-TR-AhmetNeural"
# WordBoundary zamanları çözülen sesten ~0.1 sn önde gelir (MP3 kodlayıcı gecikmesi + servis);
# ölçümle bulunan sabit kayma.
WORD_SHIFT = 0.12


@dataclass
class EdgeResult:
    audio: np.ndarray                       # mono float32 @ SR
    sr: int
    words: list[tuple[str, float, float]]   # (servisin kelimesi, başlangıç sn, bitiş sn)
    voice: str


def _ssl_context() -> ssl.SSLContext | None:
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        p = os.environ.get(var)
        if p and Path(p).exists():
            return ssl.create_default_context(cafile=p)
    for p in ("/root/.ccr/ca-bundle.crt",):
        if Path(p).exists():
            return ssl.create_default_context(cafile=p)
    return None


def _patch_ssl():
    import edge_tts.communicate as c
    ctx = _ssl_context()
    if ctx is not None:
        c._SSL_CTX = ctx


def _decode_mp3(b: bytes) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(b)
        src = f.name
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", src, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                             capture_output=True, check=True).stdout
    finally:
        os.unlink(src)
    return np.frombuffer(out, dtype=np.float32).copy()


async def _synth(text: str, voice: str, rate: str, pitch: str, volume: str):
    import edge_tts
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume, boundary="WordBoundary")
    audio = bytearray()
    words = []
    async for ch in com.stream():
        if ch["type"] == "audio":
            audio.extend(ch["data"])
        elif ch["type"] == "WordBoundary":
            s = ch["offset"] / 1e7
            words.append((ch["text"], s, s + ch["duration"] / 1e7))
    return bytes(audio), words


class EdgeVoice:
    def __init__(self, voice: str = DEFAULT_VOICE):
        self.voice = voice or DEFAULT_VOICE
        _patch_ssl()

    def say(self, text: str, rate: str = "+0%", pitch: str = "+0Hz", volume: str = "+0%", retries: int = 4) -> EdgeResult:
        CACHE.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(json.dumps(["e1", text, self.voice, rate, pitch, volume], ensure_ascii=False).encode()).hexdigest()[:24]
        mp3, meta = CACHE / f"{key}.mp3", CACHE / f"{key}.json"
        if not (mp3.exists() and meta.exists()):
            last = None
            for k in range(retries):
                try:
                    b, words = asyncio.run(_synth(text, self.voice, rate, pitch, volume))
                    if not b:
                        raise RuntimeError("boş ses döndü")
                    mp3.write_bytes(b)
                    meta.write_text(json.dumps({"words": words, "text": text}, ensure_ascii=False))
                    break
                except Exception as e:  # ağ hatası → tekrar dene
                    last = e
                    import time
                    time.sleep(1.5 * (k + 1))
            else:
                raise RuntimeError(f"Edge TTS başarısız: {last}")
        a = _decode_mp3(mp3.read_bytes())
        words = [(t, s + WORD_SHIFT, e + WORD_SHIFT) for t, s, e in json.loads(meta.read_text())["words"]]
        return EdgeResult(a, SR, words, self.voice)
