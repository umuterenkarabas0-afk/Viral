"""Videoyu ElevenLabs ile yeniden seslendirir.

Akış:
  1. Orijinal sesi ElevenLabs Scribe ile yazıya döker (kelime zamanlarıyla).
     dub/segments.json varsa onu kullanır (elle düzeltilmiş metin için).
  2. Kelimeleri duraklamalara göre cümle parçalarına böler.
  3. Her parçayı ElevenLabs TTS (eleven_multilingual_v2) ile seslendirir.
  4. Parçaları orijinal zamanlarına oturtur (gerekirse hafifçe hızlandırır).
  5. Demucs ile orijinal sesten eski seslendirmeyi ayırıp müzik/efekt yatağını tutar.
  6. Yeni ses + müzik (ducking) → -14 LUFS → videoya ekler.

Kullanım: python dub/dub.py dub/input/video.mp4 dub/out
Ortam: ELEVENLABS_API_KEY, isteğe bağlı ELEVENLABS_VOICE_ID.
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

API = "https://api.elevenlabs.io/v1"
KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
PREFERRED_VOICES = ["Brian", "Adam", "Daniel", "George", "Bill", "Callum", "Liam", "Eric", "Chris"]


def run(cmd):
    print("+", " ".join(map(str, cmd)), flush=True)
    subprocess.run(list(map(str, cmd)), check=True)


def probe_duration(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]
    )
    return float(out.strip())


def api_json(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("xi-api-key", KEY)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def transcribe(audio, out_json):
    if out_json.exists():
        return json.loads(out_json.read_text())
    raw = subprocess.check_output([
        "curl", "-sS", "--fail-with-body", "-X", "POST", f"{API}/speech-to-text",
        "-H", f"xi-api-key: {KEY}",
        "--form-string", "model_id=scribe_v1",
        "--form-string", "language_code=tur",
        "--form-string", "timestamps_granularity=word",
        "--form-string", "tag_audio_events=false",
        "-F", f"file=@{audio}",
    ])
    data = json.loads(raw)
    out_json.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return data


def segment(words, gap=0.45):
    words = [w for w in words if w.get("type", "word") == "word" and w.get("text", "").strip()]
    segs, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if nxt is None:
            break
        pause = nxt["start"] - w["end"]
        sentence_end = w["text"].rstrip().endswith((".", "!", "?", "…", ":"))
        if pause > gap or (sentence_end and pause > 0.12) or (sentence_end and len(cur) >= 6):
            segs.append(cur)
            cur = []
    if cur:
        segs.append(cur)
    return [
        {"start": round(s[0]["start"], 3), "end": round(s[-1]["end"], 3),
         "text": " ".join(w["text"].strip() for w in s)}
        for s in segs
    ]


def pick_voice():
    vid = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
    if vid:
        return vid, vid
    voices = json.loads(api_json("GET", "/voices")).get("voices", [])
    by_name = {v["name"].split(" ")[0]: v for v in voices}
    for name in PREFERRED_VOICES:
        if name in by_name:
            return by_name[name]["voice_id"], by_name[name]["name"]
    if voices:
        return voices[0]["voice_id"], voices[0]["name"]
    return "nPczCjzI2devNBz1zQrb", "Brian (varsayılan)"


def tts(text, voice_id, prev_text, next_text, out_mp3):
    if out_mp3.exists():
        return
    body = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": {"stability": 0.42, "similarity_boost": 0.8, "style": 0.35,
                           "use_speaker_boost": True, "speed": 1.0},
    }
    if prev_text:
        body["previous_text"] = prev_text
    if next_text:
        body["next_text"] = next_text
    audio = api_json("POST", f"/text-to-speech/{voice_id}?output_format=mp3_44100_128", body)
    out_mp3.write_bytes(audio)


def trim_to_wav(src, dst):
    # Baştaki/sondaki sessizliği kırp, 48 kHz mono.
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,"
         "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse",
         "-ar", "48000", "-ac", "1", dst])


def separate_bed(orig_wav, work):
    """Demucs ile eski seslendirmeyi çıkar; müzik/efekt yatağını döndür (yoksa None)."""
    try:
        run([sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs",
             "-o", work / "sep", orig_wav])
        bed = work / "sep" / "htdemucs" / orig_wav.stem / "no_vocals.wav"
        return bed if bed.exists() else None
    except Exception as e:  # noqa: BLE001
        print("UYARI: demucs başarısız, müzik yatağı olmadan devam:", e, flush=True)
        return None


def main():
    if not KEY:
        sys.exit("ELEVENLABS_API_KEY yok")
    video = Path(sys.argv[1])
    out = Path(sys.argv[2])
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)
    total = probe_duration(video)

    orig_wav = work / "orig.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vn", "-ac", "2", "-ar", "44100", orig_wav])
    stt_mp3 = work / "orig_mono.mp3"
    run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", stt_mp3])

    override = Path(__file__).with_name("segments.json")
    if override.exists():
        segs = json.loads(override.read_text())
        print("dub/segments.json kullanılıyor", flush=True)
    else:
        data = transcribe(stt_mp3, out / "transcript.json")
        print("TRANSKRİPT:", data.get("text", ""), flush=True)
        segs = segment(data.get("words", []))
    if not segs:
        sys.exit("Konuşma bulunamadı; dub/segments.json ile metin verin.")
    (out / "segments.json").write_text(json.dumps(segs, ensure_ascii=False, indent=2))

    voice_id, voice_name = pick_voice()
    print(f"Ses: {voice_name} ({voice_id}) · model {MODEL}", flush=True)

    placed, cursor = [], 0.0
    for i, s in enumerate(segs):
        mp3 = work / f"seg{i:02d}.mp3"
        wav = work / f"seg{i:02d}.wav"
        prev_t = " ".join(x["text"] for x in segs[max(0, i - 2):i])
        next_t = segs[i + 1]["text"] if i + 1 < len(segs) else ""
        tts(s["text"], voice_id, prev_t, next_t, mp3)
        trim_to_wav(mp3, wav)
        dur = probe_duration(wav)
        start = max(s["start"], cursor + 0.06)
        slot_end = segs[i + 1]["start"] if i + 1 < len(segs) else total - 0.2
        avail = max(0.3, slot_end - start - 0.05)
        tempo = 1.0
        if dur > avail:
            tempo = min(dur / avail, 1.25)
            fast = work / f"seg{i:02d}_fast.wav"
            run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-af", f"atempo={tempo:.4f}", fast])
            wav, dur = fast, probe_duration(fast)
        placed.append({"i": i, "file": str(wav), "start": round(start, 3), "dur": round(dur, 3),
                       "tempo": round(tempo, 3), "text": s["text"]})
        cursor = start + dur
        print(f"[{i:02d}] {start:6.2f}s  {dur:5.2f}s  x{tempo:.2f}  {s['text']}", flush=True)
    (out / "placement.json").write_text(json.dumps(placed, ensure_ascii=False, indent=2))

    # Seslendirme kanalı
    voice_wav = out / "voice_elevenlabs.wav"
    cmd = ["ffmpeg", "-v", "error", "-y"]
    for p in placed:
        cmd += ["-i", p["file"]]
    chains = []
    for k, p in enumerate(placed):
        ms = int(p["start"] * 1000)
        chains.append(f"[{k}:a]adelay={ms}|{ms},apad[a{k}]")
    mix_in = "".join(f"[a{k}]" for k in range(len(placed)))
    chains.append(f"{mix_in}amix=inputs={len(placed)}:normalize=0:duration=longest,"
                  f"atrim=0:{total:.3f},aformat=channel_layouts=stereo[v]")
    cmd += ["-filter_complex", ";".join(chains), "-map", "[v]", "-ar", "48000", voice_wav]
    run(cmd)

    # Müzik yatağı + ducking + mastering
    # Orijinal ses yalnızca müzik/efekt ise (varsayılan) olduğu gibi yatak olur;
    # içinde eski bir seslendirme varsa DUB_SEPARATE=1 ile demucs ayırır.
    bed = separate_bed(orig_wav, work) if os.environ.get("DUB_SEPARATE") == "1" else orig_wav
    final_audio = out / "audio_final.wav"
    if bed:
        run(["ffmpeg", "-v", "error", "-y", "-i", voice_wav, "-i", bed, "-filter_complex",
             "[0:a]asplit=2[vo][sc];"
             "[1:a]aresample=48000,volume=0.6[bed];"
             "[bed][sc]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400[ducked];"
             "[vo]volume=1.6[vv];"
             f"[vv][ducked]amix=inputs=2:normalize=0:duration=first,atrim=0:{total:.3f},"
             "loudnorm=I=-14:TP=-1.0:LRA=11[out]",
             "-map", "[out]", "-ar", "48000", final_audio])
    else:
        run(["ffmpeg", "-v", "error", "-y", "-i", voice_wav, "-af",
             "loudnorm=I=-14:TP=-1.0:LRA=11", "-ar", "48000", final_audio])

    final_mp4 = out / f"{video.stem}_elevenlabs.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-i", video, "-i", final_audio, "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final_mp4])
    print("TAMAM:", final_mp4, flush=True)


if __name__ == "__main__":
    main()
