"""Mini dizi (hikâye) üretim hattı.

    python -m viral series content/series/cebimdeki-not --ep 1
    python -m viral series content/series/cebimdeki-not --ep all
    python -m viral series content/series/cebimdeki-not --ep 3 --no-render --stills 2,10,20

Akış: dizi + bölüm YAML → Edge TTS (her replik ayrı, kelime zamanlı) → çekim zaman
çizelgesi (timeline.json) → kodla sentezlenen ses tasarımı → headless Chromium'da
deterministik 3D render (renderer/story.html) → H.264 + AAC.
"""
from __future__ import annotations

import copy
import json
import math
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from .edge import EdgeVoice
from .script import parse_markup, turkish_upper

ROOT = Path(__file__).resolve().parent.parent
FPS = 30
BPM = 96.0
GRID = 60.0 / BPM / 4           # 16'lık nota ızgarası (kesmeler ritme oturur)
END_CARD = 3.2                  # son kart süresi (sn)


def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def tnorm(s: str) -> str:
    s = s.replace("I", "ı").replace("İ", "i").lower()
    return "".join(ch for ch in s if ch.isalnum())


def strip_markup(say: str) -> str:
    s = re.sub(r"\{([^{}|]+)\|[^{}]+\}", r"\1", say)
    s = re.sub(r"\*([^*]+)\*", r"\1", s)
    s = re.sub(r"(?<![\w!])!([^!\s][^!]*?)!(?=[\s.,;:?]|$)", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------------ yükleme
def load_series(series_dir: str | Path) -> dict:
    d = Path(series_dir)
    with open(d / "series.yaml", encoding="utf-8") as f:
        s = yaml.safe_load(f)
    s["_dir"] = str(d)
    return s


def load_episode(series: dict, n: int) -> dict:
    p = Path(series["_dir"]) / f"ep{n:02d}.yaml"
    with open(p, encoding="utf-8") as f:
        ep = yaml.safe_load(f)
    ep.setdefault("episode", n)
    return ep


def normalize_shots(ep: dict) -> list[dict]:
    """`same`/`acts` mirasını çözer, `say` kısaltmasını `lines`'a çevirir."""
    out = []
    prev = None
    for i, sh in enumerate(ep["shots"]):
        sh = copy.deepcopy(sh)
        if sh.get("same") and prev is not None:
            base = copy.deepcopy(prev.get("cast", []))
            for c in base:  # yürüyüş bitmiş say: son noktada dur
                if c.get("walk"):
                    c["at"] = c["walk"][-1]
                    c.pop("walk")
                    if c.get("do") in ("walk", "run", "sneak", "push_cart"):
                        c["do"] = "idle"
            acts = sh.get("acts") or {}
            for c in base:
                c.update(acts.get(c["who"], {}))
            sh.setdefault("cast", base)
            for k in ("props", "extras", "crowd", "grade", "time"):
                if k not in sh and k in prev:
                    sh[k] = copy.deepcopy(prev[k])
        if "say" in sh and "lines" not in sh:
            sh["lines"] = [{"say": sh.pop("say")}]
        sh.setdefault("lines", [])
        sh.setdefault("cast", [])
        sh["idx"] = i
        out.append(sh)
        prev = sh
    return out


# ------------------------------------------------------------------ hizalama
def align_units(units, words: list[tuple[str, float, float]], total: float) -> list[tuple[float, float]]:
    """Altyazı birimlerini (Unit) Edge WordBoundary olaylarına eşler."""
    toks = []  # (unit_idx, norm)
    for ui, u in enumerate(units):
        for w in u.spoken:
            n = tnorm(w)
            if n:
                toks.append((ui, n))
    bnd = [(tnorm(t), s, e) for t, s, e in words if tnorm(t)]
    tok_span: list[tuple[float, float] | None] = [None] * len(toks)
    i = j = 0
    while i < len(toks) and j < len(bnd):
        A, B = toks[i][1], bnd[j][0]
        i2, j2 = i, j
        ok = True
        guard = 0
        while A != B and guard < 12:
            guard += 1
            if len(A) < len(B) and i2 + 1 < len(toks):
                i2 += 1; A += toks[i2][1]
            elif len(B) < len(A) and j2 + 1 < len(bnd):
                j2 += 1; B += bnd[j2][0]
            else:
                ok = False
                break
        if not ok or A != B:
            # uyuşmazlık: tek tek ilerle (kalanları orantılı dağıt)
            tok_span[i] = (bnd[j][1], bnd[j][2])
            i += 1; j += 1
            continue
        s0, e0 = bnd[j][1], bnd[j2][2]
        lens = [len(toks[k][1]) for k in range(i, i2 + 1)]
        tot = sum(lens) or 1
        t = s0
        for k, L in zip(range(i, i2 + 1), lens):
            d = (e0 - s0) * L / tot
            tok_span[k] = (t, t + d)
            t += d
        i, j = i2 + 1, j2 + 1
    # eksik kalanlar: son bilinen zamandan sona doğru dağıt
    last = 0.0
    missing = [k for k, v in enumerate(tok_span) if v is None]
    if missing:
        known_end = max([v[1] for v in tok_span if v] or [0.0])
        span = max(0.3, total - known_end)
        step = span / len(missing)
        for n, k in enumerate(missing):
            tok_span[k] = (known_end + n * step, known_end + (n + 1) * step)
    out = []
    for ui in range(len(units)):
        sp = [tok_span[k] for k, (u, _) in enumerate(toks) if u == ui]
        if sp:
            out.append((sp[0][0], sp[-1][1]))
            last = sp[-1][1]
        else:
            out.append((last, last + 0.15))
    return out


# ------------------------------------------------------------------ sentez
@dataclass
class LineClip:
    shot: int
    style: str
    by: str | None
    audio: np.ndarray
    units: list
    spans: list[tuple[float, float]]
    speech_start: float
    speech_end: float
    raw: dict
    display: str


def speech_bounds(a: np.ndarray, sr: int) -> tuple[float, float]:
    hop = int(sr * 0.01)
    n = len(a) // hop
    if n == 0:
        return 0.0, len(a) / sr
    rms = np.sqrt(np.mean(a[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    on = np.where(db > np.percentile(db, 98) - 40)[0]
    if len(on) == 0:
        return 0.0, len(a) / sr
    return on[0] * 0.01, (on[-1] + 1) * 0.01


def rate_shift(rate: str, delta: float) -> str:
    m = re.fullmatch(r"([+-]?\d+)%", rate.strip())
    v = int(m.group(1)) if m else 0
    v = int(round(v + delta))
    return f"{v:+d}%"


def synth_lines(shots: list[dict], series: dict, voice: EdgeVoice, rate_delta: float = 0.0) -> list[LineClip]:
    styles = series.get("voice", {}).get("styles", {})
    clips = []
    for sh in shots:
        for ln in sh["lines"]:
            st = ln.get("v", "n")
            cfg = styles.get(st, styles.get("n", {}))
            units, speak = parse_markup(ln["say"])
            rate = rate_shift(cfg.get("rate", "+0%"), rate_delta if st in ("n", "note") else rate_delta * 0.6)
            r = voice.say(speak, rate=rate, pitch=cfg.get("pitch", "+0Hz"), volume=cfg.get("volume", "+0%"))
            s, e = speech_bounds(r.audio, r.sr)
            spans = align_units(units, r.words, len(r.audio) / r.sr)
            if spans:  # ilk kelime gerçek konuşma başlangıcından önce başlamasın
                spans[0] = (max(spans[0][0], s - 0.04), max(spans[0][1], s + 0.1))
                spans[-1] = (spans[-1][0], max(spans[-1][1], min(e, spans[-1][1] + 0.25)))
            clips.append(LineClip(sh["idx"], st, ln.get("by"), r.audio, units, spans, s, e, ln, strip_markup(ln["say"])))
    return clips


def estimate(shots, clips) -> float:
    t = 0.12
    for sh in shots:
        cl = [c for c in clips if c.shot == sh["idx"]]
        t += sum(c.speech_end - c.speech_start for c in cl) + 0.2 * max(0, len(cl) - 1) + 0.3 + float(sh.get("hold", 0))
        if not cl:
            t += 1.0
    return t + END_CARD


# ------------------------------------------------------------------ zaman çizelgesi
def _grid(t: float) -> float:
    return math.ceil(t / GRID - 1e-6) * GRID


class TimeRef:
    def __init__(self, shot_rec: dict, words: list[dict]):
        self.s = shot_rec
        self.words = words

    def word(self, needle: str) -> dict | None:
        n = tnorm(needle)
        for w in self.words:
            if w["norm"].startswith(n):
                return w
        for w in self.words:
            if n in w["norm"]:
                return w
        return None

    def __call__(self, ref, delay: float = 0.0) -> float:
        st, en = self.s["start"], self.s["end"]
        if isinstance(ref, (int, float)):
            return round(st + float(ref) + delay, 3)
        ref = str(ref)
        if ref.startswith("@"):
            m = re.match(r"@([^+\-]+)([+-][\d.]+)?$", ref)
            needle, off = (m.group(1), float(m.group(2) or 0)) if m else (ref[1:], 0.0)
            w = self.word(needle)
            if w is None:
                log(f"  uyarı: '{needle}' kelimesi çekim {self.s['i']} içinde yok")
                return round(st + delay, 3)
            return round(w["s"] - 0.04 + off + delay, 3)
        if ref.endswith("%"):
            return round(st + (en - st) * float(ref[:-1]) / 100 + delay, 3)
        return round(st + float(ref) + delay, 3)


def _timed(val, tr: TimeRef, start: float):
    """'idle' veya [[zaman, değer], ...] → [[mutlak_t, değer], ...]"""
    if val is None:
        return None
    if isinstance(val, list) and val and isinstance(val[0], list):
        return [[tr(t), v] for t, v in val]
    return [[start, val]]


def build_timeline(series: dict, ep: dict, shots: list[dict], clips: list[LineClip]) -> tuple[dict, list[tuple[float, LineClip]]]:
    placements: list[tuple[float, LineClip]] = []
    words_out: list[dict] = []
    captions: list[dict] = []
    shots_out: list[dict] = []
    cues: list[dict] = []
    sfx_out: list[dict] = []
    cursor = 0.0
    n_shots = len(shots)
    for k, sh in enumerate(shots):
        cl = [c for c in clips if c.shot == sh["idx"]]
        start = cursor
        t = start + (0.1 if k == 0 else 0.05)
        line_recs = []
        shot_words = []
        prev_style = None
        for c in cl:
            if prev_style is not None:
                t += 0.32 if c.style != prev_style else 0.2
            off = t - c.speech_start
            placements.append((off, c))
            base = len(words_out)
            lw = []
            for u, (s, e) in zip(c.units, c.spans):
                w = {"text": u.display, "s": round(off + s, 3), "e": round(off + e, 3), "shot": k, "style": c.style}
                if u.style == "emph":
                    w["emph"] = True
                elif u.style == "danger":
                    w["tone"] = "danger"
                if c.by:
                    w["by"] = c.by
                lw.append(w)
            # zaman düzeltmesi: monoton artan
            for a, b in zip(lw, lw[1:]):
                if b["s"] < a["s"]:
                    b["s"] = a["s"] + 0.05
                if a["e"] > b["s"]:
                    a["e"] = b["s"]
            words_out.extend(lw)
            shot_words.extend([dict(w, norm=tnorm(w["text"])) for w in lw])
            vs, ve = off + c.speech_start, off + c.speech_end
            line_recs.append({"style": c.style, "by": c.by, "s": round(vs, 3), "e": round(ve, 3), "write": bool(c.raw.get("write")),
                              "w0": base, "w1": base + len(lw), "text": c.display})
            # altyazı grupları (en fazla 3 kelime / 16 karakter, noktalamada kır)
            group, chars = [], 0
            raw_tokens = c.raw["say"].split()

            def flush():
                nonlocal group, chars
                if group:
                    captions.append({"w": group[:], "style": c.style, "by": c.by})
                group, chars = [], 0
            disp_tokens = strip_markup(c.raw["say"]).split()
            for j, w in enumerate(lw):
                L = len(w["text"])
                limit = 18 if c.style in ("note", "twist") else 15
                if group and (len(group) >= 3 or chars + L > limit):
                    flush()
                group.append(base + j)
                chars += L + 1
                dt = disp_tokens[j] if j < len(disp_tokens) else ""
                if dt.rstrip("\"'”»)").endswith((",", ".", ";", ":", "!", "?", "…")):
                    flush()
            flush()
            _ = raw_tokens
            t = ve
            prev_style = c.style
        voice_start = line_recs[0]["s"] if line_recs else start
        voice_end = line_recs[-1]["e"] if line_recs else start
        tail = 0.2 + float(sh.get("hold", 0))
        if any(l["write"] for l in line_recs):
            tail += 0.15
        if not line_recs:
            tail = max(1.0, float(sh.get("hold", 1.0)))
        end = _grid(max(t, start + 0.8) + tail)
        is_last = k == n_shots - 1
        if is_last:
            end = _grid(voice_end + 0.55) + END_CARD
        rec: dict[str, Any] = {"i": k, "set": sh["set"], "time": sh.get("time", "day"), "grade": sh.get("grade", "normal"),
                               "mood": sh.get("mood", "mystery"), "cut": sh.get("cut", "cut"),
                               "start": round(start, 3), "end": round(end, 3), "vs": round(voice_start, 3), "ve": round(voice_end, 3),
                               "lines": line_recs, "extras": sh.get("extras", 0), "crowd": sh.get("crowd"),
                               "props": sh.get("props", []), "end_shot": bool(sh.get("end")) or is_last}
        tr = TimeRef(rec, shot_words)
        # oyuncular
        cast = []
        for c in sh.get("cast", []):
            cc = {"who": c["who"], "outfit": c.get("outfit"), "at": c.get("at"), "y": c.get("y", 0), "face": c.get("face", 0),
                  "onFerry": c.get("onFerry", False)}
            if cc["at"] is not None and len(cc["at"]) == 3:
                cc["at"], cc["z3"] = cc["at"][:2], cc["at"][2]
            for key in ("do", "expr", "look", "hold", "hold2", "pose"):
                if c.get(key) is not None:
                    cc[key] = _timed(c[key], tr, start)
            if c.get("walk"):
                cc["walk"] = c["walk"]
                dur_w = max(0.8, (voice_end if line_recs else end) - start)
                cc["walkT"] = [round(start, 3), round(start + min(dur_w * 0.92, (end - start) * 0.9), 3)]
                if cc["at"] is None:
                    cc["at"] = c["walk"][-1]
            # konuşma (ağız) aralıkları
            talk = [[l["s"], l["e"], l["w0"], l["w1"]] for l in line_recs if l["by"] == c["who"]]
            if talk:
                cc["talk"] = talk
            cast.append(cc)
        rec["cast"] = cast
        cam = dict(sh.get("cam") or {"shot": "wide"})
        if True in cam:  # YAML 1.1: 'on' anahtarı True olarak okunur
            cam["on"] = cam.pop(True)
        rec["cam"] = cam
        if sh.get("label"):
            rec["label"] = dict(sh["label"], t=round(start + 0.15, 3))
        if sh.get("tag"):
            rec["tag"] = dict(sh["tag"], t=round(start + 0.35, 3))
        if sh.get("bubble"):
            b = dict(sh["bubble"])
            b["t"] = tr("@" + b["at_word"]) if b.get("at_word") else round(start + 0.3, 3)
            rec["bubble"] = b
        if sh.get("overlay"):
            o = dict(sh["overlay"])
            for key in ("at_word", "glitch_word", "strike_word"):
                if o.get(key):
                    o[key.replace("_word", "") + "_t" if key != "at_word" else "t"] = tr("@" + o[key])
            o.setdefault("t", round(start + 0.1, 3))
            rec["overlay"] = o
        if sh.get("prop"):
            p = dict(sh["prop"])
            wl = [l for l in line_recs if l["write"]] or ([l for l in line_recs if l["style"] in ("note", "twist")] if p.get("type") in ("note", "pen_write", "book_margin") else [])
            if wl and not p.get("text"):
                l = wl[-1]
                p["text"] = l["text"]
                marks = []
                pos = 0
                for wi in range(l["w0"], l["w1"]):
                    w = words_out[wi]
                    idx = p["text"].find(w["text"], pos)
                    if idx < 0:
                        continue
                    endc = idx + len(w["text"])
                    # sonraki boşluğa kadar noktalamayı da dahil et
                    while endc < len(p["text"]) and p["text"][endc] not in " \n":
                        endc += 1
                    marks.append([idx, endc, w["s"], w["e"]])
                    pos = endc
                p["marks"] = marks
                p["reveal"] = True
            rec["prop"] = p
        for f in sh.get("fx", []) or []:
            ref = "@" + f["at_word"] if f.get("at_word") else f.get("at", 0)
            cue = {k2: v for k2, v in f.items() if k2 not in ("at_word", "at")}
            cue["t"] = tr(ref, f.get("delay", 0.0))
            cue["shot"] = k
            cues.append(cue)
        for f in sh.get("sfx", []) or []:
            ref = "@" + f["at_word"] if f.get("at_word") else f.get("at", 0)
            e2 = {k2: v for k2, v in f.items() if k2 not in ("at_word", "at")}
            e2["t"] = tr(ref, f.get("delay", 0.0))
            e2["shot"] = k
            sfx_out.append(e2)
        shots_out.append(rec)
        cursor = end

    # altyazı zamanları
    for k, c in enumerate(captions):
        ws = [words_out[i] for i in c["w"]]
        c["s"] = round(max(0.0, ws[0]["s"] - 0.05), 3)
        nxt = captions[k + 1] if k + 1 < len(captions) else None
        e = ws[-1]["e"] + 0.35
        if nxt:
            e = min(e, words_out[nxt["w"][0]]["s"] - 0.05)
        c["e"] = round(max(c["s"] + 0.3, e), 3)

    duration = round(cursor, 3)
    used = sorted({c["who"] for s in shots_out for c in s["cast"]})
    cast_defs = {k: v for k, v in (series.get("cast") or {}).items() if k in used or k in ("kerem", "defne", "nuri")}
    last = shots_out[-1]
    cliff = dict(ep.get("cliff") or {})
    cliff["t"] = round(_grid(last["ve"] + 0.45), 3)
    timeline = {
        "meta": {"mode": "story", "page": "story.html", "fps": FPS, "width": 1080, "height": 1920, "duration": duration, "bpm": BPM,
                 "series": series.get("title"), "seriesId": series.get("id"), "episode": ep["episode"], "episodes": series.get("episodes", 10),
                 "title": ep.get("title"), "id": f"{series.get('id')}-{ep['episode']:02d}"},
        "theme": series.get("theme", {}),
        "hook": {"text": ep.get("hook", ""), "t": 0.0},
        "cliff": cliff,
        "castDefs": cast_defs,
        "shots": shots_out,
        "words": words_out,
        "captions": captions,
        "cues": cues,
        "sfx": sfx_out,
    }
    return timeline, placements


def to_srt(tl: dict) -> str:
    def fmt(t):
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"
    out = []
    for i, c in enumerate(tl["captions"], 1):
        txt = " ".join(turkish_upper(tl["words"][j]["text"]) for j in c["w"])
        out.append(f"{i}\n{fmt(c['s'])} --> {fmt(c['e'])}\n{txt}\n")
    return "\n".join(out)


# ------------------------------------------------------------------ render + kodlama
def render(tl_path: Path, frames: Path, workers: int | None = None, stills: list[float] | None = None, out_dir: Path | None = None,
           scale: float | None = None):
    cmd = ["node", str(ROOT / "renderer" / "render.mjs"), "--timeline", str(tl_path)]
    if scale:
        cmd += ["--scale", str(scale)]
    if stills:
        cmd += ["--stills", ",".join(f"{t:.3f}" for t in stills), "--out-dir", str(out_dir)]
    else:
        cmd += ["--frames", str(frames)]
        if workers:
            cmd += ["--workers", str(workers)]
    subprocess.run(cmd, check=True)


def encode(frames: Path, audio: Path, out: Path, fps: int = FPS):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(fps), "-i", str(frames / "%05d.jpg"),
           "-i", str(audio), "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
           "-tune", "animation", "-maxrate", "9M", "-bufsize", "14M", "-g", str(fps * 2),
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest", str(out)]
    subprocess.run(cmd, check=True)


def make_episode(series_dir: str | Path, n: int, out_root: str | Path = "output", *, render_video: bool = True, workers: int | None = None,
                 stills: list[float] | None = None, keep_frames: bool = False, target: float = 45.0, scale: float | None = None) -> dict:
    from . import story_sound

    series = load_series(series_dir)
    ep = load_episode(series, n)
    shots = normalize_shots(ep)
    out_dir = Path(out_root) / series["id"] / f"ep{n:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    voice = EdgeVoice(series.get("voice", {}).get("name"))
    log(f"Bölüm {n}: {ep.get('title')} — {len(shots)} çekim, TTS ({voice.voice})")
    delta = 0.0
    clips = synth_lines(shots, series, voice, delta)
    est = estimate(shots, clips)
    for _ in range(2):
        if 40.5 <= est <= 49.5:
            break
        speech = sum(c.speech_end - c.speech_start for c in clips)
        want = speech - (est - target)
        factor = speech / max(5.0, want)
        nd = float(np.clip(delta + (factor - 1) * 100, -12, 22))
        if abs(nd - delta) < 1.5:
            break
        delta = nd
        log(f"  süre ~{est:.1f} sn → hız düzeltmesi {delta:+.0f}%")
        clips = synth_lines(shots, series, voice, delta)
        est = estimate(shots, clips)
    tl, placements = build_timeline(series, ep, shots, clips)
    tl["meta"]["voice"] = {"engine": "edge", "name": voice.voice, "rate_delta": delta}
    tl_path = out_dir / "timeline.json"
    tl_path.write_text(json.dumps(tl, ensure_ascii=False, indent=1))
    (out_dir / "captions.srt").write_text(to_srt(tl), encoding="utf-8")
    log(f"  zaman çizelgesi: {tl['meta']['duration']:.2f} sn, {len(tl['words'])} kelime, {len(tl['captions'])} altyazı")
    audio = story_sound.design(tl, placements, out_dir)
    log(f"  ses: {audio}")
    res = {"dir": str(out_dir), "duration": tl["meta"]["duration"], "timeline": str(tl_path), "audio": str(audio)}
    if stills:
        render(tl_path, out_dir / "frames", stills=stills, out_dir=out_dir / "stills", scale=scale)
    if render_video:
        frames = out_dir / "frames"
        log("  3D render başlıyor")
        render(tl_path, frames, workers=workers, scale=scale)
        name = f"{series['id']}-bolum-{n:02d}.mp4"
        video = out_dir / name
        log("  kodlama (H.264 + AAC)")
        encode(frames, audio, video)
        # kapak: kancanın en güçlü anı (ilk çekim ortası)
        fi = int(min(tl["meta"]["duration"] - 1, max(1.0, tl["shots"][0]["end"] * 0.6)) * FPS)
        src = frames / f"{fi:05d}.jpg"
        if src.exists():
            shutil.copy(src, out_dir / "cover.jpg")
        if not keep_frames:
            shutil.rmtree(frames, ignore_errors=True)
        res["video"] = str(video)
        log(f"  video hazır: {video}")
    seo = ep.get("seo", {})
    tags = list((series.get("seo") or {}).get("hashtags_base", []))
    meta = {"title": seo.get("title", f"{series['title']} · Bölüm {n}"), "description": seo.get("description", ""), "hashtags": tags,
            "duration": tl["meta"]["duration"]}
    (out_dir / "post.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "post.txt").write_text(f"{meta['title']}\n\n{meta['description']}\n\n{' '.join(tags)}\n", encoding="utf-8")
    return res
