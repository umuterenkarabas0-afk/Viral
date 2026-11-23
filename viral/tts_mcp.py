"""Google Cloud Text-to-Speech için MCP sunucusu (stdio).

    python -m viral mcp            # veya: python -m viral.tts_mcp

Araçlar:
  list_voices        sesleri listeler (dil / ad / cinsiyet filtresi)
  list_languages     dil kodlarını ses sayılarıyla listeler
  synthesize_speech  metin veya SSML → ses dosyası (MP3 / WAV / OGG Opus),
                     isteğe bağlı kelime zamanları; uzun metin otomatik bölünür

Kimlik doğrulama viral/tts.py ile aynıdır:
  GOOGLE_TTS_API_KEY → GOOGLE_TTS_ACCESS_TOKEN → `gcloud auth print-access-token`

Ayarlar (ortam değişkenleri):
  GOOGLE_TTS_MCP_OUTPUT_DIR  ses dosyalarının yazıldığı klasör (varsayılan: output/tts)
  GOOGLE_TTS_MCP_LANGUAGE    varsayılan dil (varsayılan: tr-TR)
  GOOGLE_TTS_MCP_VOICE       varsayılan ses (varsayılan: tts.DEFAULT_VOICE_PREFS sırası)
  GOOGLE_TTS_ENDPOINT        API uç noktası (ör. https://eu-texttospeech.googleapis.com)

Bu modülün çekirdeği `mcp` paketine bağlı değildir; paket yalnızca build_server() içinde yüklenir.
(`from __future__ import annotations` bilerek yok: araç imzalarındaki yerel `Field` çözülebilmeli.)
"""
import base64
import hashlib
import io
import json
import os
import re
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, Literal
from xml.sax.saxutils import escape

from . import tts

MAX_INPUT_BYTES = 5000          # Google: input.text / input.ssml başına üst sınır
CHUNK_BYTES = 4800              # bölme hedefi (güvenlik payı)
ENCODINGS = {"MP3": ".mp3", "LINEAR16": ".wav", "OGG_OPUS": ".ogg"}
AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".opus"}
_MARK_OVERHEAD = len('<mark name="w99999"/>')  # kelime başına SSML işareti maliyeti (üst sınır)

OUTPUT_DIR = Path(os.environ.get("GOOGLE_TTS_MCP_OUTPUT_DIR", "output/tts")).resolve()
DEFAULT_LANG = os.environ.get("GOOGLE_TTS_MCP_LANGUAGE", "tr-TR")
DEFAULT_VOICE = os.environ.get("GOOGLE_TTS_MCP_VOICE") or None
CACHE = Path(os.environ.get("VIRAL_CACHE", ".cache")) / "tts-mcp"


# --------------------------------------------------------------------------- sesler

def voice_language(voice: str) -> str | None:
    """'tr-TR-Chirp3-HD-Charon' → 'tr-TR'. Biçim tanınmazsa None."""
    parts = voice.split("-")
    return "-".join(parts[:2]) if len(parts) >= 3 else None


def voice_family(voice: str) -> str:
    """'tr-TR-Chirp3-HD-Charon' → 'Chirp3-HD', 'tr-TR-Wavenet-E' → 'Wavenet'."""
    rest = voice.split("-")[2:]
    if not rest:
        return voice
    return "-".join(rest[:-1]) or rest[0]


def _prefs_for(lang: str) -> list[str]:
    generic = [f"{lang}-Chirp3-HD-*", f"{lang}-Neural2-*", f"{lang}-Wavenet-*", f"{lang}-Standard-*", f"{lang}-*"]
    return (tts.DEFAULT_VOICE_PREFS if lang == "tr-TR" else []) + generic


def resolve_voice(voice: str | None, language_code: str | None, need_marks: bool) -> tuple[str, str]:
    """(ses, dil kodu) döndürür; ses verilmediyse dile göre en iyisini seçer."""
    if voice:
        lang = language_code or voice_language(voice)
        if not lang:
            raise ValueError(f"'{voice}' adından dil çıkarılamadı; language_code verin")
        return voice, lang
    lang = language_code or (voice_language(DEFAULT_VOICE) if DEFAULT_VOICE else None) or DEFAULT_LANG
    if DEFAULT_VOICE and voice_language(DEFAULT_VOICE) == lang and (not need_marks or tts.supports_marks(DEFAULT_VOICE)):
        return DEFAULT_VOICE, lang
    return tts.pick_voice(_prefs_for(lang), lang, require_marks=need_marks), lang


# --------------------------------------------------------------------------- metin bölme

def split_text(text: str, limit: int = CHUNK_BYTES, word_overhead: int = 0) -> list[list[str]]:
    """Metni kelime listelerine böler; her parçanın maliyeti `limit` baytı aşmaz.

    Önce cümle sınırları (. ! ? … ; :) korunur, sığmayan tek cümle kelime kelime bölünür.
    `word_overhead`: kelime başına ek bayt (ör. SSML <mark> etiketi).
    """
    def cost(words: list[str]) -> int:
        return sum(len(w.encode()) + 1 + word_overhead for w in words) + len("<speak></speak>")

    units: list[list[str]] = []
    for sent in re.split(r"(?<=[.!?…;:])\s+", text.strip()):
        words = sent.split()
        if not words:
            continue
        if cost(words) <= limit:
            units.append(words)
            continue
        cur: list[str] = []
        for w in words:
            if cost([w]) > limit:
                raise ValueError("Tek bir kelime istek sınırını aşıyor")
            if cur and cost(cur + [w]) > limit:
                units.append(cur)
                cur = []
            cur.append(w)
        if cur:
            units.append(cur)

    chunks: list[list[str]] = []
    for u in units:
        if chunks and cost(chunks[-1] + u) <= limit:
            chunks[-1] = chunks[-1] + u
        else:
            chunks.append(list(u))
    return chunks


def marked_ssml(words: list[str], start: int = 0) -> str:
    return "<speak>" + " ".join(f'<mark name="w{start + i}"/>{escape(w)}' for i, w in enumerate(words)) + "</speak>"


# --------------------------------------------------------------------------- ses kapları

_MP3_KBPS = {
    True: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],   # MPEG-1 Layer III
    False: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],      # MPEG-2/2.5 Layer III
}


def _skip_id3(b: bytes) -> int:
    if b[:3] == b"ID3" and len(b) >= 10:
        return 10 + ((b[6] & 0x7F) << 21 | (b[7] & 0x7F) << 14 | (b[8] & 0x7F) << 7 | (b[9] & 0x7F))
    return 0


def _mp3_frames(b: bytes):
    """(konum, uzunluk, örnek sayısı, örnekleme hızı) — MPEG Layer III çerçeveleri."""
    i = _skip_id3(b)
    while i + 4 <= len(b):
        h = int.from_bytes(b[i:i + 4], "big")
        ver, layer = (h >> 19) & 3, (h >> 17) & 3
        br_i, sr_i, pad = (h >> 12) & 0xF, (h >> 10) & 3, (h >> 9) & 1
        if (h >> 21) != 0x7FF or ver == 1 or layer != 1 or br_i in (0, 15) or sr_i == 3:
            i += 1  # çerçeve başı değil: yeniden eşitle
            continue
        mpeg1 = ver == 3
        sr = (44100, 48000, 32000)[sr_i] >> {3: 0, 2: 1, 0: 2}[ver]
        n = (144 if mpeg1 else 72) * _MP3_KBPS[mpeg1][br_i] * 1000 // sr + pad
        yield i, n, (1152 if mpeg1 else 576), sr
        i += n


def _is_xing(b: bytes, off: int) -> bool:
    """Xing/Info üst veri çerçevesi (ses taşımaz; çözücüler atlar)."""
    head = b[off + 4:off + 40]
    return b"Xing" in head or b"Info" in head


def mp3_duration(b: bytes) -> float | None:
    """Çerçeveleri sayarak süre (sn); baştaki Xing/Info çerçevesi sayılmaz."""
    samples, sr = 0, 0
    for k, (off, _, n, sr) in enumerate(_mp3_frames(b)):
        if not (k == 0 and _is_xing(b, off)):
            samples += n
    return samples / sr if sr else None


def _mp3_audio_frames(b: bytes) -> bytes:
    """ID3 etiketi ve Xing/Info çerçevesi olmadan ses çerçeveleri (birleştirme için)."""
    frames = list(_mp3_frames(b))
    if frames and _is_xing(b, frames[0][0]):
        frames = frames[1:]
    return b"".join(b[off:off + n] for off, n, _, _ in frames)


def ogg_opus_duration(b: bytes) -> float | None:
    """Son Ogg sayfasının granül konumu − pre-skip (48 kHz)."""
    k = b.rfind(b"OggS")
    if k < 0 or len(b) < k + 14:
        return None
    j = b.find(b"OpusHead")
    pre_skip = int.from_bytes(b[j + 10:j + 12], "little") if 0 <= j and len(b) >= j + 12 else 0
    gran = int.from_bytes(b[k + 6:k + 14], "little", signed=True)
    return max(0, gran - pre_skip) / 48000


def _wav_pcm(b: bytes) -> tuple[bytes, tuple]:
    with wave.open(io.BytesIO(b)) as w:
        params = w.getparams()
        return w.readframes(w.getnframes()), params


def wav_duration(b: bytes) -> float:
    pcm, p = _wav_pcm(b)
    return len(pcm) / (p.nchannels * p.sampwidth * p.framerate)


def audio_duration(b: bytes, encoding: str) -> float | None:
    try:
        if encoding == "LINEAR16":
            return wav_duration(b)
        if encoding == "MP3":
            return mp3_duration(b)
        if encoding == "OGG_OPUS":
            return ogg_opus_duration(b)
    except (wave.Error, EOFError, ValueError):
        return None
    return None


def concat_audio(parts: list[bytes], encoding: str) -> bytes:
    if len(parts) == 1:
        return parts[0]
    if encoding == "LINEAR16":
        pcm = []
        for b in parts:
            data, params = _wav_pcm(b)
            pcm.append(data)
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(params.nchannels)
            w.setsampwidth(params.sampwidth)
            w.setframerate(params.framerate)
            w.writeframes(b"".join(pcm))
        return out.getvalue()
    if encoding == "MP3":   # parça başlıkları (ID3, Xing) birleşik dosyada yanlış süre bildirirdi
        return b"".join(_mp3_audio_frames(b) for b in parts)
    raise ValueError(f"{encoding} parçaları birleştirilemez")


# --------------------------------------------------------------------------- sentez

@dataclass
class Synthesis:
    audio: bytes
    voice: str
    language_code: str
    encoding: str
    duration: float | None
    chunks: int
    timepoints: list[dict] | None = None
    cached_chunks: int = 0
    warnings: list[str] = field(default_factory=list)


def _call_synthesize(body: dict, timepoints: bool) -> tuple[dict, bool]:
    """Tek istek; yanıt diskte önbelleklenir (aynı istek tekrar ücretlendirilmez)."""
    path = "/v1beta1/text:synthesize" if timepoints else "/v1/text:synthesize"
    key = hashlib.sha256(json.dumps([path, body], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:32]
    cp = CACHE / f"{key}.json"
    if cp.exists():
        try:
            return json.loads(cp.read_text()), True
        except (OSError, ValueError):
            pass
    resp = tts._request("POST", path, body)
    if "audioContent" not in resp:
        raise RuntimeError(f"Google TTS yanıtında ses yok: {str(resp)[:300]}")
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        cp.write_text(json.dumps({"audioContent": resp["audioContent"], "timepoints": resp.get("timepoints", [])}))
    except OSError:
        pass
    return resp, False


def synthesize(
    text: str | None = None,
    ssml: str | None = None,
    voice: str | None = None,
    language_code: str | None = None,
    speaking_rate: float | None = None,
    pitch: float | None = None,
    volume_gain_db: float | None = None,
    audio_encoding: str = "MP3",
    sample_rate_hertz: int | None = None,
    effects_profile: str | None = None,
    word_timings: bool = False,
) -> Synthesis:
    text = text.strip() if text else None
    ssml = ssml.strip() if ssml else None
    if bool(text) == bool(ssml):
        raise ValueError("text veya ssml'den tam olarak biri verilmeli")
    enc = audio_encoding.upper()
    if enc not in ENCODINGS:
        raise ValueError(f"audio_encoding şunlardan biri olmalı: {', '.join(ENCODINGS)}")
    if ssml and word_timings and "<mark" not in ssml:
        raise ValueError("SSML girdisinde word_timings için kendi <mark name=\"...\"/> etiketlerinizi ekleyin")

    voice, lang = resolve_voice(voice, language_code, need_marks=word_timings)
    if word_timings and not tts.supports_marks(voice):
        raise ValueError(f"'{voice}' sesi SSML <mark> zaman noktalarını desteklemiyor (Chirp/Journey/Studio). "
                         "Wavenet / Neural2 / Standard bir ses seçin ya da voice'u boş bırakın.")

    cfg: dict[str, Any] = {"audioEncoding": enc}
    for k, v in (("speakingRate", speaking_rate), ("pitch", pitch), ("volumeGainDb", volume_gain_db),
                 ("sampleRateHertz", sample_rate_hertz)):
        if v is not None:
            cfg[k] = v
    if effects_profile:
        cfg["effectsProfileId"] = [effects_profile]
    voice_cfg = {"languageCode": lang, "name": voice}

    # girdileri hazırla: (input, kelimeler | None)
    requests: list[tuple[dict, list[str] | None]] = []
    if ssml:
        if len(ssml.encode()) > MAX_INPUT_BYTES:
            raise ValueError(f"SSML {len(ssml.encode())} bayt; Google sınırı {MAX_INPUT_BYTES}. "
                             "SSML'i bölün ya da düz metin verin (düz metin otomatik bölünür).")
        requests.append(({"ssml": ssml}, None))
    elif word_timings:
        n = 0
        for words in split_text(text, CHUNK_BYTES, _MARK_OVERHEAD):
            requests.append(({"ssml": marked_ssml(words, n)}, words))
            n += len(words)
    elif len(text.encode()) <= CHUNK_BYTES:
        requests.append(({"text": text}, None))
    else:
        requests += [({"text": " ".join(words)}, None) for words in split_text(text, CHUNK_BYTES)]

    if len(requests) > 1 and enc == "OGG_OPUS":
        raise ValueError(f"Metin {len(requests)} isteğe bölünmesi gerekiyor; OGG_OPUS parçaları birleştirilemez. "
                         "MP3 veya LINEAR16 kullanın.")

    parts: list[bytes] = []
    timepoints: list[dict] | None = [] if word_timings else None
    offset, cached, warnings = 0.0, 0, []
    for inp, words in requests:
        body = {"input": inp, "voice": voice_cfg, "audioConfig": cfg}
        if word_timings:
            body["enableTimePointing"] = ["SSML_MARK"]
        resp, hit = _call_synthesize(body, word_timings)
        cached += hit
        audio = base64.b64decode(resp["audioContent"])
        parts.append(audio)
        if word_timings:
            tp = {p["markName"]: offset + float(p["timeSeconds"]) for p in resp.get("timepoints", [])}
            if words is None:   # kullanıcının kendi SSML işaretleri
                timepoints += [{"mark": p["markName"], "start": round(offset + float(p["timeSeconds"]), 3)}
                               for p in resp.get("timepoints", [])]
            else:
                start = len(timepoints)
                timepoints += [{"word": w, "start": round(tp[f"w{start + i}"], 3) if f"w{start + i}" in tp else None}
                               for i, w in enumerate(words)]
        if len(requests) > 1:
            d = audio_duration(audio, enc)
            if d is None:
                warnings.append("Parça süresi okunamadı; sonraki parçaların kelime zamanları kayabilir")
                d = 0.0
            offset += d

    audio = concat_audio(parts, enc)
    if timepoints is not None and any(t.get("start") is None for t in timepoints):
        warnings.append("Bazı kelimeler için Google zaman noktası döndürmedi (start: null)")
    return Synthesis(audio, voice, lang, enc, audio_duration(audio, enc), len(requests), timepoints, cached, warnings)


def output_path(filename: str | None, encoding: str, audio: bytes) -> Path:
    """Dosya yolu her zaman OUTPUT_DIR altında kalır; uzantı kodlamaya göre düzeltilir."""
    ext = ENCODINGS[encoding]
    if not filename:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        return OUTPUT_DIR / f"tts-{stamp}-{hashlib.sha1(audio).hexdigest()[:8]}{ext}"
    p = Path(filename)
    if p.is_absolute() or ".." in p.parts or not p.name:
        raise ValueError(f"filename {OUTPUT_DIR} altında göreli bir yol olmalı (mutlak yol ve '..' yasak)")
    if p.suffix.lower() != ext:
        p = p.with_suffix(ext) if p.suffix.lower() in AUDIO_EXTS else p.with_name(p.name + ext)
    target = (OUTPUT_DIR / p).resolve()
    if not target.is_relative_to(OUTPUT_DIR):
        raise ValueError(f"filename {OUTPUT_DIR} dışına çıkamaz")
    return target


# --------------------------------------------------------------------------- MCP araçları

def tool_list_voices(language_code: str | None = None, name_contains: str | None = None,
                     gender: str | None = None, limit: int = 100) -> dict:
    lang = DEFAULT_LANG if language_code is None else language_code.strip()
    voices = tts.list_voices(lang)
    if name_contains:
        voices = [v for v in voices if name_contains.lower() in v["name"].lower()]
    if gender:
        voices = [v for v in voices if v.get("ssmlGender", "").upper() == gender.upper()]
    voices = sorted(voices, key=lambda v: v["name"])
    return {
        "language_code": lang or "*",
        "total": len(voices),
        "truncated": len(voices) > limit,
        "voices": [{
            "name": v["name"],
            "family": voice_family(v["name"]),
            "languages": v.get("languageCodes", []),
            "gender": v.get("ssmlGender"),
            "sample_rate_hertz": v.get("naturalSampleRateHertz"),
            "word_timings": tts.supports_marks(v["name"]),
        } for v in voices[:limit]],
    }


def tool_list_languages() -> dict:
    counts: dict[str, int] = {}
    for v in tts.list_voices(""):
        for code in v.get("languageCodes", []):
            counts[code] = counts.get(code, 0) + 1
    return {"total": len(counts), "languages": [{"code": c, "voices": n} for c, n in sorted(counts.items())]}


def tool_synthesize(filename: str | None = None, **kw) -> dict:
    s = synthesize(**kw)
    path = output_path(filename, s.encoding, s.audio)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(s.audio)
    out: dict[str, Any] = {
        "path": str(path),
        "voice": s.voice,
        "language_code": s.language_code,
        "audio_encoding": s.encoding,
        "duration_seconds": round(s.duration, 3) if s.duration is not None else None,
        "size_bytes": len(s.audio),
        "requests": s.chunks,
        "cached_requests": s.cached_chunks,
    }
    if s.timepoints is not None:
        out["word_timings"] = s.timepoints
    if s.warnings:
        out["warnings"] = s.warnings
    return out


INSTRUCTIONS = f"""Google Cloud Text-to-Speech. Ses dosyaları {OUTPUT_DIR} altına yazılır.
- Ses seçmek için önce list_voices (varsayılan dil {DEFAULT_LANG}); diğer diller için list_languages.
- synthesize_speech: voice boşsa dile göre en iyi ses seçilir (Türkçe: Chirp3-HD).
- word_timings=true kelime başlangıç zamanlarını döndürür; yalnızca Wavenet/Neural2/Standard seslerde çalışır
  (voice boşsa uygun ses otomatik seçilir). Chirp3-HD gibi seslerde pitch ve SSML desteği sınırlıdır.
- 5000 baytı aşan düz metin cümle sınırlarından bölünüp tek dosyada birleştirilir (MP3 / LINEAR16)."""


def build_server():
    from mcp.server.mcpserver import MCPServer
    from mcp.server.mcpserver.exceptions import ToolError
    from mcp.types import ToolAnnotations
    from pydantic import Field

    server = MCPServer("google-tts", instructions=INSTRUCTIONS)

    def run(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except (ValueError, RuntimeError, OSError) as e:   # TTSAuthError ⊂ RuntimeError
            raise ToolError(str(e)) from e

    read_only = ToolAnnotations(readOnlyHint=True, openWorldHint=True)

    @server.tool(annotations=read_only)
    def list_voices(
        language_code: Annotated[str | None, Field(description=f"BCP-47 dil kodu (ör. tr-TR, en-US). Boş bırakılırsa {DEFAULT_LANG}; \"\" tüm diller.")] = None,
        name_contains: Annotated[str | None, Field(description="Ad filtresi, ör. 'Chirp3-HD', 'Wavenet', 'Charon'")] = None,
        gender: Annotated[Literal["MALE", "FEMALE", "NEUTRAL"] | None, Field(description="Cinsiyet filtresi")] = None,
        limit: Annotated[int, Field(ge=1, le=1000, description="En fazla kaç ses döndürülsün")] = 100,
    ) -> dict[str, Any]:
        """Google TTS seslerini listeler. Her ses için aile (Chirp3-HD, Wavenet…), cinsiyet,
        doğal örnekleme hızı ve kelime zamanlaması (SSML <mark>) desteği döner."""
        return run(tool_list_voices, language_code, name_contains, gender, limit)

    @server.tool(annotations=read_only)
    def list_languages() -> dict[str, Any]:
        """Google TTS'in desteklediği dil kodlarını, her dildeki ses sayısıyla listeler."""
        return run(tool_list_languages)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True))
    def synthesize_speech(
        text: Annotated[str | None, Field(description="Seslendirilecek düz metin (ssml ile birlikte verilmez). Uzun metin otomatik bölünür.")] = None,
        ssml: Annotated[str | None, Field(description="<speak>…</speak> SSML girdisi (en fazla 5000 bayt).")] = None,
        voice: Annotated[str | None, Field(description="Ses adı, ör. tr-TR-Chirp3-HD-Charon. Boşsa dile göre seçilir.")] = None,
        language_code: Annotated[str | None, Field(description="Dil kodu. Boşsa ses adından çıkarılır.")] = None,
        speaking_rate: Annotated[float | None, Field(ge=0.25, le=4.0, description="Konuşma hızı (1.0 = normal)")] = None,
        pitch: Annotated[float | None, Field(ge=-20.0, le=20.0, description="Perde, yarım ton (Chirp3-HD desteklemez)")] = None,
        volume_gain_db: Annotated[float | None, Field(ge=-96.0, le=16.0, description="Ses kazancı (dB)")] = None,
        audio_encoding: Annotated[Literal["MP3", "LINEAR16", "OGG_OPUS"], Field(description="MP3, LINEAR16 (WAV) veya OGG_OPUS")] = "MP3",
        sample_rate_hertz: Annotated[int | None, Field(ge=8000, le=48000, description="Çıkış örnekleme hızı (Hz)")] = None,
        effects_profile: Annotated[str | None, Field(description="Cihaz profili, ör. headphone-class-device, small-bluetooth-speaker-class-device, telephony-class-application")] = None,
        word_timings: Annotated[bool, Field(description="Düz metinde her kelimenin başlangıç saniyesini, SSML'de kendi <mark> etiketlerinizin zamanlarını döndürür. Chirp/Journey/Studio seslerde çalışmaz.")] = False,
        filename: Annotated[str | None, Field(description="Çıkış klasörüne göreli dosya adı, ör. 'bolum1/giris.mp3'. Uzantı kodlamaya göre düzeltilir. Boşsa otomatik ad.")] = None,
    ) -> dict[str, Any]:
        """Metni veya SSML'i Google Cloud TTS ile seslendirir ve ses dosyasını diske yazar.
        Dosya yolu, süre, kullanılan ses ve (istenirse) kelime zamanlarını döndürür."""
        return run(tool_synthesize, filename=filename, text=text, ssml=ssml, voice=voice, language_code=language_code,
                   speaking_rate=speaking_rate, pitch=pitch, volume_gain_db=volume_gain_db,
                   audio_encoding=audio_encoding, sample_rate_hertz=sample_rate_hertz,
                   effects_profile=effects_profile, word_timings=word_timings)

    return server


def main() -> None:
    build_server().run("stdio")


if __name__ == "__main__":
    main()
