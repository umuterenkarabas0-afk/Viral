"""Seslendirme sürelerinden renderer'ın okuyacağı timeline.json'u kurar.

Segment sınırları (geçiş anları) müziğin 8'lik notalık ızgarasına oturtulur;
böylece her sıralama vurgusu (impact) ritimle çakışır.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .align import align_words, speech_bounds
from .script import Segment, turkish_upper


@dataclass
class VoiceClip:
    seg: Segment
    audio: np.ndarray
    sr: int
    word_spans: list[tuple[float, float]]  # konuşulan kelime başına (göreli)
    speech_start: float
    speech_end: float


def grid_ceil(t: float, step: float) -> float:
    return math.ceil(t / step - 1e-6) * step


def _find_word(seg_words: list[dict], needle: str | None) -> dict | None:
    if not needle:
        return None
    n = needle.casefold().replace("İ".casefold(), "i")
    for w in seg_words:
        txt = w["text"].casefold().replace("İ".casefold(), "i")
        if txt.startswith(n) or n in txt:
            return w
    return None


def build_timeline(script: dict[str, Any], clips: list[VoiceClip], *, bpm: float = 100.0, lead_in: float = 0.45,
                   gap_before: float = 0.16, gap_after: float = 0.14, outro_hold: float = 2.3, fps: int = 30,
                   handle: str | None = None) -> tuple[dict, list[tuple[float, VoiceClip]]]:
    e8 = 60.0 / bpm / 2
    placements: list[tuple[float, VoiceClip]] = []
    segs_out: list[dict] = []
    words_out: list[dict] = []
    captions: list[dict] = []
    cues: list[dict] = []

    t_cursor = lead_in
    prev_boundary = 0.0
    for i, clip in enumerate(clips):
        seg = clip.seg
        speech_at = t_cursor if i == 0 else prev_boundary + gap_before
        offset = speech_at - clip.speech_start
        placements.append((offset, clip))
        v_start, v_end = offset + clip.speech_start, offset + clip.speech_end
        if i < len(clips) - 1:
            boundary = grid_ceil(v_end + gap_after, e8)
        else:
            boundary = grid_ceil(v_end + outro_hold, e8 * 2)
        # kelimeler
        seg_words = []
        sp_idx = 0
        for u in seg.units:
            k = len(u.spoken)
            spans = clip.word_spans[sp_idx: sp_idx + k]
            sp_idx += k
            if not spans:
                continue
            w = {"text": u.display, "s": round(offset + spans[0][0], 3), "e": round(offset + spans[-1][1], 3), "seg": i}
            if u.style == "emph":
                w["emph"] = True
            elif u.style == "danger":
                w["tone"] = "danger"
            seg_words.append(w)
        base = len(words_out)
        words_out.extend(seg_words)

        # altyazı grupları
        group: list[int] = []
        chars = 0

        def flush():
            nonlocal group, chars
            if group:
                captions.append({"w": group[:], "style": "hook" if seg.kind == "hook" else ""})
            group, chars = [], 0

        raw_words = []
        for u in seg.units:
            raw_words.extend([u.spoken[-1]] if u.spoken else [u.display])
        for j, w in enumerate(seg_words):
            L = len(w["text"])
            if group and (len(group) >= 3 or chars + L > 14):
                flush()
            group.append(base + j)
            chars += L + 1
            rw = raw_words[j] if j < len(raw_words) else ""
            if rw.rstrip("\"'”»)").endswith((",", ".", ";", ":", "!", "?")):
                flush()
        flush()

        d = seg.data
        seg_rec: dict[str, Any] = {
            "id": seg.id, "kind": seg.kind,
            "start": round(prev_boundary, 3), "end": round(boundary, 3),
            "voiceStart": round(v_start, 3), "voiceEnd": round(v_end, 3),
        }
        if d.get("env"):
            seg_rec["env"] = d["env"]
        if d.get("camera"):
            seg_rec["camera"] = d["camera"]
        if d.get("transition"):
            seg_rec["transition"] = d["transition"]
        if seg.kind == "item":
            seg_rec.update({"rank": d.get("rank"), "name": d.get("name"), "latin": d.get("latin"), "chips": d.get("chips", [])})
            seg_rec["subject"] = {"ref": seg.id, **(d.get("subject") or {})}
            co = d.get("callout")
            if co:
                w = _find_word(seg_words, co.get("at_word"))
                t0 = (w["s"] - 0.1) if w else v_start + 1.0
                t1 = min(boundary - 0.45, t0 + co.get("dur", 2.4))
                seg_rec["callout"] = {"anchor": co.get("anchor", "head"), "text": co.get("text", ""), "icon": co.get("icon", "eye"),
                                      "t0": round(t0, 3), "t1": round(max(t0 + 0.8, t1), 3), "zoom": co.get("zoom", 0.6)}
        elif seg.kind == "hook":
            subj = d.get("subject")
            seg_rec["subject"] = {"ref": subj} if isinstance(subj, str) else (subj or {})
            if d.get("title"):
                w = _find_word(seg_words, d["title"].get("at_word"))
                seg_rec["title"] = {"kicker": d["title"].get("kicker", ""), "big": d["title"].get("big", ""),
                                    "at": round((w["s"] - 0.05) if w else v_start + 2.0, 3)}
        elif seg.kind == "outro":
            seg_rec["cta"] = d.get("cta", {})
            if d.get("carousel"):
                seg_rec["carousel"] = d["carousel"]
        for c in d.get("cues", []) or []:
            w = _find_word(seg_words, c.get("at_word"))
            t = (w["s"] - 0.05) if w else (v_start + float(c.get("at", 0)))
            cue = {k: v for k, v in c.items() if k not in ("at_word", "at")}
            cue["t"] = round(t, 3)
            cues.append(cue)
        segs_out.append(seg_rec)
        prev_boundary = boundary

    # altyazı zamanları
    for k, c in enumerate(captions):
        ws = [words_out[i] for i in c["w"]]
        c["s"] = round(max(0.0, ws[0]["s"] - 0.06), 3)
        nxt = captions[k + 1] if k + 1 < len(captions) else None
        end = ws[-1]["e"] + 0.3
        if nxt:
            nws = words_out[nxt["w"][0]]
            end = min(end, nws["s"] - 0.06)
        c["e"] = round(max(c["s"] + 0.25, end), 3)

    duration = prev_boundary
    subjects = {}
    for it in script.get("items", []):
        if it.get("fish"):
            subjects[it["id"]] = {"kind": "fish", "params": it["fish"]}
    timeline = {
        "meta": {"title": script.get("title"), "id": script.get("id"), "fps": fps, "width": 1080, "height": 1920,
                 "duration": round(duration, 3), "bpm": bpm, "handle": handle},
        "theme": script.get("theme", {}),
        "environment": script.get("environment", "ocean"),
        "segments": segs_out,
        "subjects": subjects,
        "words": words_out,
        "captions": captions,
        "cues": cues,
    }
    return timeline, placements


def to_srt(timeline: dict) -> str:
    def fmt(t):
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"
    out = []
    for i, c in enumerate(timeline["captions"], 1):
        txt = " ".join(turkish_upper(timeline["words"][j]["text"]) for j in c["w"])
        out.append(f"{i}\n{fmt(c['s'])} --> {fmt(c['e'])}\n{txt}\n")
    return "\n".join(out)
