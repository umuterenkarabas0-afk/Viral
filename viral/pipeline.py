"""Uçtan uca üretim: senaryo → TTS → zaman çizelgesi → ses tasarımı → 3D render → MP4."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np

from . import sound as S
from .align import align_words, speech_bounds
from .script import build_segments, load_script, validate_script
from .timeline import VoiceClip, build_timeline, to_srt
from .tts import Voice

ROOT = Path(__file__).resolve().parent.parent


def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def write_wav(path: Path, x: np.ndarray, sr: int = S.SR):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(pcm.shape[1] if pcm.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def synth_voice(segments, voice: Voice, rate: float) -> list[VoiceClip]:
    clips = []
    for seg in segments:
        spoken = [w for u in seg.units for w in u.spoken]
        r = voice.say(seg.speak_text, spoken, rate)
        spans = align_words(r.audio, r.sr, spoken, r.word_starts)
        s, e = speech_bounds(r.audio, r.sr)
        clips.append(VoiceClip(seg, r.audio, r.sr, spans, s, e))
    return clips


def estimate_duration(clips: list[VoiceClip], n_gaps: int, hold: float = 2.3) -> float:
    return 0.45 + sum(c.speech_end - c.speech_start for c in clips) + n_gaps * 0.48 + hold


# ------------------------------------------------------------------ ses tasarımı
def design_audio(timeline: dict, placements, out_dir: Path) -> Path:
    dur = timeline["meta"]["duration"]
    n = int(dur * S.SR)
    segs = timeline["segments"]
    bpm = timeline["meta"]["bpm"]
    log("Ses tasarımı: seslendirme yerleştiriliyor")
    vox = np.zeros(n)
    for off, clip in placements:
        i = int(off * S.SR)
        a = clip.audio
        j = min(n, i + len(a))
        if i < n:
            vox[max(0, i):j] += a[max(0, -i): j - i]
    vox_st = S.process_voice(vox)

    log("Ses tasarımı: müzik sentezleniyor")
    items = [s for s in segs if s["kind"] == "item"]
    first_item = items[0]["start"] if items else 0
    top = next((s for s in items if s.get("rank") == 1), None)
    outro = next((s for s in segs if s["kind"] == "outro"), None)
    bar = 60 / bpm * 4
    sections = [(0, first_item, "intro")]
    if top:
        brk = max(first_item, top["start"] - bar)
        sections += [(first_item, brk, "full"), (brk, top["start"], "break"), (top["start"], outro["start"] if outro else dur, "lift")]
    else:
        sections.append((first_item, outro["start"] if outro else dur, "full"))
    if outro:
        last_voice = outro["voiceEnd"]
        sections += [(outro["start"], last_voice + 0.3, "final"), (last_voice + 0.3, dur + 5, "end")]
    plan = S.MusicPlan(duration=dur, bpm=bpm, sections=sections)
    music, drums = S.render_music(plan)
    # son akor: uzun kuyruk
    if outro:
        root, chord = S.PROG[0]
        tail = S._pad([S.midi_hz(m) for m in chord] + [S.midi_hz(chord[0] + 12)], dur - outro["voiceEnd"] + 0.5, 6)
        S.add_at(music, S.reverb(tail, 0.5, 3.0), outro["voiceEnd"] - 0.2, 1.2)

    log("Ses tasarımı: efektler yerleştiriliyor")
    sfx = np.zeros((n, 2))
    amb = S.render_ambience(dur)
    S.add_at(sfx, S.sfx_splash(), 0.0, 0.75)
    for k, s in enumerate(segs):
        if s["kind"] == "hook" and s.get("title"):
            at = s["title"]["at"]
            S.add_at(sfx, S.sfx_riser(1.3), at - 1.3 + 0.05, 0.45)
            S.add_at(sfx, S.sfx_impact(1.1), at + 0.1, 0.8)
            S.add_at(sfx, S.sfx_sparkle(), at + 0.25, 0.5)
        if k > 0:
            b = s["start"]
            up = k % 2 == 0
            wh = S.sfx_whoosh(0.75, up=up, pan_from=-0.8 if up else 0.8, pan_to=0.8 if up else -0.8)
            S.add_at(sfx, wh, b - 0.52, 0.6)
            if s["kind"] == "item":
                power = 1.4 if s.get("rank") == 1 else 1.0
                S.add_at(sfx, S.sfx_impact(power), b, 0.6 if s.get("rank") != 1 else 0.85)
                S.add_at(sfx, S.sfx_bubbles(1.0, 10, seed=k), b + 0.05, 0.5)
                for ci, _ in enumerate(s.get("chips", [])[:3]):
                    S.add_at(sfx, S.sfx_pop(820 + ci * 180), b + 0.86 + ci * 0.18, 0.55)
                S.add_at(sfx, S.sfx_tick(2600), b + 0.52, 0.25)
                if s.get("callout"):
                    S.add_at(sfx, S.sfx_sparkle(seed=k), s["callout"]["t0"] + 0.1, 0.45)
                    S.add_at(sfx, S.sfx_whoosh(0.35, up=True, pan_from=0, pan_to=0.5, bright=1.6), s["callout"]["t0"], 0.25)
            if s["kind"] == "outro":
                S.add_at(sfx, S.sfx_pop(700), b + 0.45, 0.6)
                S.add_at(sfx, S.sfx_ding(), b + 0.95, 0.7)
        if s["kind"] == "item" and s.get("rank") == 1:
            S.add_at(sfx, S.sfx_riser(bar, 4200), s["start"] - bar, 0.55)
    for c in timeline.get("cues", []):
        if c["type"] == "dream":
            S.add_at(sfx, S.sfx_dream(c.get("dur", 1.5) + 1.2), c["t"] - 0.1, 0.7)
        elif c["type"] == "flash":
            S.add_at(sfx, S.sfx_sparkle(seed=9), c["t"], 0.5)

    log("Miks: ducking, pompalama, limiter")
    env = S.envelope_follow(vox, 0.03, 0.4)
    vthr = np.percentile(env[env > 1e-4], 60) if np.any(env > 1e-4) else 0.05
    duck = 1 - 0.55 * np.clip(env / (vthr + 1e-9), 0, 1)
    tt = np.arange(n) / S.SR
    beat = 60 / bpm
    pump = 1 - 0.28 * np.exp(-((tt % beat) / 0.11))
    music_bus = music * (duck * pump)[:, None] * 0.34 + drums * (0.6 + 0.4 * duck)[:, None] * 0.32
    amb_bus = amb * (0.6 + 0.4 * duck)[:, None] * 0.35
    sfx_bus = sfx * 0.62
    mix = vox_st * 1.0 + music_bus + amb_bus + sfx_bus
    mix = S.hp(mix, 30, 2)
    # fade in/out
    fi = int(0.3 * S.SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    fo = int(0.6 * S.SR)
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
    mix = S.limiter(mix * 0.9, 0.9)
    raw = out_dir / "audio_raw.wav"
    write_wav(raw, mix)
    # stem'ler (yeniden miks için)
    stems = out_dir / "stems"
    stems.mkdir(exist_ok=True)
    write_wav(stems / "voice.wav", np.clip(vox_st, -1, 1))
    write_wav(stems / "music.wav", np.clip(music_bus, -1, 1))
    write_wav(stems / "sfx.wav", np.clip(sfx_bus + amb_bus, -1, 1))
    # platform standardı: -14 LUFS, -1 dBTP
    final = out_dir / "audio.wav"
    loudnorm(raw, final)
    return final


def loudnorm(src: Path, dst: Path, target=-14.0):
    cmd = ["ffmpeg", "-hide_banner", "-y", "-i", str(src), "-af", f"loudnorm=I={target}:TP=-1.0:LRA=11:print_format=json", "-f", "null", "-"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    txt = r.stderr
    try:
        js = json.loads(txt[txt.rindex("{"): txt.rindex("}") + 1])
        af = (f"loudnorm=I={target}:TP=-1.0:LRA=11:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
              f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true")
    except Exception:
        af = f"loudnorm=I={target}:TP=-1.0:LRA=11"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", af, "-ar", "48000", str(dst)], check=True)


# ------------------------------------------------------------------ render + kodlama
def render_frames(timeline_path: Path, frames_dir: Path, workers: int | None = None, gpu: bool = False):
    cmd = ["node", str(ROOT / "renderer" / "render.mjs"), "--timeline", str(timeline_path), "--frames", str(frames_dir)]
    if workers:
        cmd += ["--workers", str(workers)]
    if gpu:
        cmd += ["--gpu"]
    subprocess.run(cmd, check=True)


def render_stills(timeline_path: Path, times: list[float], out_dir: Path):
    subprocess.run(["node", str(ROOT / "renderer" / "render.mjs"), "--timeline", str(timeline_path), "--stills",
                    ",".join(f"{t:.3f}" for t in times), "--out-dir", str(out_dir)], check=True)


def encode(frames_dir: Path, audio: Path, out: Path, fps: int = 30):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(fps), "-i", str(frames_dir / "%05d.jpg"),
           "-i", str(audio), "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-tune", "film",
           "-maxrate", "10M", "-bufsize", "16M", "-g", str(fps * 2), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
           "-movflags", "+faststart", "-shortest", str(out)]
    subprocess.run(cmd, check=True)


def make(script_path: str | Path, out_root: str | Path = "output", *, tts: str = "auto", workers: int | None = None,
         target: float = 60.0, render: bool = True, stills: list[float] | None = None, gpu: bool = False,
         handle: str | None = None, keep_frames: bool = False) -> dict[str, Any]:
    script = load_script(script_path)
    errs = validate_script(script)
    if errs:
        raise SystemExit("Senaryo hataları:\n  - " + "\n  - ".join(errs))
    out_dir = Path(out_root) / script["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    segs = build_segments(script)
    vcfg = script.get("voice", {}) or {}
    voice = Voice(engine=tts, voice=vcfg.get("name"), prefs=vcfg.get("prefs"), pitch=vcfg.get("pitch", 0.0), lang=script.get("language", "tr-TR"))

    # süreyi hedefe oturt (konuşma hızı ile)
    rate = float(vcfg.get("speaking_rate", 1.1))
    log(f"TTS: {len(segs)} segment, hız {rate:.2f}")
    clips = synth_voice(segs, voice, rate)
    est = estimate_duration(clips, len(segs) - 1)
    for _ in range(2):
        if abs(est - target) <= 3.0:
            break
        speech = sum(c.speech_end - c.speech_start for c in clips)
        other = est - speech
        want = max(10.0, target - other)
        hi = 1.3 if voice.engine == "google" else 1.6
        new_rate = float(np.clip(rate * speech / want, 0.9, hi))
        if abs(new_rate - rate) < 0.02:
            break
        rate = new_rate
        log(f"TTS: süre {est:.1f} sn → hız {rate:.2f} ile yeniden")
        clips = synth_voice(segs, voice, rate)
        est = estimate_duration(clips, len(segs) - 1)

    timeline, placements = build_timeline(script, clips, handle=handle or script.get("handle"))
    timeline["meta"]["voice"] = {"engine": voice.engine, "name": voice.voice, "rate": rate}
    tl_path = out_dir / "timeline.json"
    tl_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=1))
    (out_dir / "captions.srt").write_text(to_srt(timeline), encoding="utf-8")
    log(f"Zaman çizelgesi: {timeline['meta']['duration']:.2f} sn, {len(timeline['words'])} kelime, {len(timeline['captions'])} altyazı")

    audio = design_audio(timeline, placements, out_dir)
    log(f"Ses: {audio}")

    if stills:
        render_stills(tl_path, stills, out_dir / "stills")
    result = {"dir": str(out_dir), "timeline": str(tl_path), "audio": str(audio), "duration": timeline["meta"]["duration"], "voice": timeline["meta"]["voice"]}
    if render:
        frames = out_dir / "frames"
        log("3D render başlıyor")
        render_frames(tl_path, frames, workers, gpu)
        video = out_dir / f"{script['id']}.mp4"
        log("Kodlama (H.264 + AAC)")
        encode(frames, audio, video, timeline["meta"]["fps"])
        # kapak görseli: #1'in başlık anı
        top = next((s for s in timeline["segments"] if s.get("rank") == 1), None)
        ct = (top["start"] + 1.6) if top else timeline["meta"]["duration"] / 2
        fi = int(ct * timeline["meta"]["fps"])
        src = frames / f"{fi:05d}.jpg"
        if src.exists():
            shutil.copy(src, out_dir / "cover.jpg")
        if not keep_frames:
            shutil.rmtree(frames, ignore_errors=True)
        result["video"] = str(video)
        log(f"Video hazır: {video}")
    seo = script.get("seo", {})
    meta = {"title": seo.get("title", script.get("title")), "description": seo.get("description", ""),
            "hashtags": seo.get("hashtags", []), "duration": timeline["meta"]["duration"], "voice": timeline["meta"]["voice"]}
    (out_dir / "post.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "post.txt").write_text(f"{meta['title']}\n\n{meta['description']}\n\n{' '.join(meta['hashtags'])}\n", encoding="utf-8")
    return result
