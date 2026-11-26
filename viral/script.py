"""Senaryo YAML'ını yükler ve konuşma metnindeki işaretlemeyi ayrıştırır.

İşaretleme:
  *kelime*       altyazıda vurgulu
  !kelime!       altyazıda tehlike rengi
  {göster|oku}   altyazıda 'göster', seslendirmede 'oku'
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

TR_VOWELS = set("aeıioöuüâîûAEIİOÖUÜÂÎÛ")


@dataclass
class Unit:
    """Altyazıda tek bir 'kelime' olarak görünen birim."""
    display: str
    spoken: list[str]
    style: str | None = None  # None | 'emph' | 'danger'


@dataclass
class Segment:
    id: str
    kind: str  # hook | item | outro
    say: str
    units: list[Unit]
    speak_text: str
    data: dict[str, Any] = field(default_factory=dict)


_SWAP = re.compile(r"\{([^{}|]+)\|([^{}]+)\}")
_EMPH = re.compile(r"\*([^*]+)\*")
_DANGER = re.compile(r"(?<![\w!])!([^!\s][^!]*?)!(?=[\s.,;:?]|$)")
_PUNCT_STRIP = ".,;:!?\"“”«»()…—–"


def turkish_upper(s: str) -> str:
    return s.replace("i", "İ").replace("ı", "I").upper()


def syllables(word: str) -> int:
    """Türkçede hece sayısı ≈ ünlü sayısı (fonetik yazım)."""
    w = number_words(word)
    n = sum(1 for ch in w if ch in TR_VOWELS)
    return max(1, n)


_ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]


def _num_tr(n: int) -> str:
    if n == 0:
        return "sıfır"
    parts = []
    if n >= 1_000_000:
        parts.append(_num_tr(n // 1_000_000) + " milyon")
        n %= 1_000_000
    if n >= 1000:
        k = n // 1000
        parts.append(("" if k == 1 else _num_tr(k) + " ") + "bin")
        n %= 1000
    if n >= 100:
        h = n // 100
        parts.append(("" if h == 1 else _ONES[h] + " ") + "yüz")
        n %= 100
    if n >= 10:
        parts.append(_TENS[n // 10])
        n %= 10
    if n:
        parts.append(_ONES[n])
    return " ".join(p for p in parts if p)


def number_words(text: str) -> str:
    return re.sub(r"\d+", lambda m: _num_tr(int(m.group(0))), text)


def parse_markup(say: str) -> tuple[list[Unit], str]:
    """Konuşma metnini altyazı birimlerine ve TTS metnine ayırır."""
    # Önce işaretleri yer tutuculara çevir: (display, spoken, style) parçaları
    tokens: list[tuple[str, str | None, str | None]] = []  # (text, speak_alt, style)
    pos = 0
    pattern = re.compile(r"\{[^{}|]+\|[^{}]+\}|\*[^*]+\*|(?<![\w!])![^!\s][^!]*?!(?=[\s.,;:?]|$)")
    for m in pattern.finditer(say):
        if m.start() > pos:
            tokens.append((say[pos:m.start()], None, None))
        s = m.group(0)
        if s.startswith("{"):
            d, sp = _SWAP.fullmatch(s).groups()
            tokens.append((d, sp, "swap"))
        elif s.startswith("*"):
            tokens.append((s[1:-1], None, "emph"))
        else:
            tokens.append((s[1:-1], None, "danger"))
        pos = m.end()
    if pos < len(say):
        tokens.append((say[pos:], None, None))

    units: list[Unit] = []
    speak_parts: list[str] = []
    for text, alt, style in tokens:
        speak_parts.append(alt if alt is not None else text)
        if style == "swap":
            disp = text.strip()
            spoken = [w for w in (alt or "").split() if w.strip(_PUNCT_STRIP)]
            if disp:
                units.append(Unit(display=disp.strip(_PUNCT_STRIP), spoken=spoken or [disp]))
            continue
        for w in text.split():
            clean = w.strip(_PUNCT_STRIP)
            if not clean:
                continue
            units.append(Unit(display=clean, spoken=[w], style=style if style in ("emph", "danger") else None))
    speak = re.sub(r"\s+", " ", "".join(speak_parts)).strip()
    return units, speak


def load_script(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    data.setdefault("id", Path(path).stem)
    ref = data.get("cast_ref")
    if ref:
        rp = Path(path).parent / ref
        if rp.exists():
            with open(rp, "r", encoding="utf-8") as f:
                ser = yaml.safe_load(f) or {}
            cast = dict(ser.get("cast") or {})
            cast.update(data.get("cast") or {})
            data["cast"] = cast
    return data


def build_segments(script: dict[str, Any]) -> list[Segment]:
    segs: list[Segment] = []
    if script.get("format") == "story":
        for i, sc in enumerate(script.get("scenes", [])):
            u, sp = parse_markup(sc["say"])
            segs.append(Segment(sc.get("id") or f"s{i + 1}", "scene", sc["say"], u, sp, sc))
        return segs
    hook = script.get("hook")
    if hook:
        u, sp = parse_markup(hook["say"])
        segs.append(Segment("hook", "hook", hook["say"], u, sp, hook))
    for it in script.get("items", []):
        u, sp = parse_markup(it["say"])
        segs.append(Segment(it["id"], "item", it["say"], u, sp, it))
    out = script.get("outro")
    if out:
        u, sp = parse_markup(out["say"])
        segs.append(Segment("outro", "outro", out["say"], u, sp, out))
    return segs


def validate_script(script: dict[str, Any]) -> list[str]:
    """Basit şema kontrolü; hata listesini döndürür."""
    if script.get("format") == "story":
        return validate_story(script)
    errs = []
    if not script.get("title"):
        errs.append("title eksik")
    items = script.get("items") or []
    if not items:
        errs.append("items boş")
    ids = set()
    for i, it in enumerate(items):
        for k in ("id", "name", "say"):
            if not it.get(k):
                errs.append(f"items[{i}].{k} eksik")
        if it.get("id") in ids:
            errs.append(f"items[{i}].id tekrar ediyor: {it.get('id')}")
        ids.add(it.get("id"))
    hook = script.get("hook") or {}
    if hook.get("subject") and hook["subject"] not in ids:
        errs.append(f"hook.subject '{hook['subject']}' bir item id'si değil")
    return errs


STORY_SETS = {"sea", "deck", "harbor", "kiosk", "coffeehouse", "home", "lighthouse", "void", "black", "depot", "shop", "factory"}
STORY_GFX = {"title", "fact", "label", "stamp", "chapter", "cliff", "quote", "counter", "score",
             "hook", "notify", "chat", "peephole", "cctv", "live", "clock", "next"}


def validate_story(script: dict[str, Any]) -> list[str]:
    errs = []
    if not script.get("title"):
        errs.append("title eksik")
    ser = script.get("series") or {}
    for k in ("title", "episode", "total"):
        if not ser.get(k):
            errs.append(f"series.{k} eksik")
    scenes = script.get("scenes") or []
    if len(scenes) < 3:
        errs.append("en az 3 sahne (scenes) gerekli")
    ids = set()
    for i, sc in enumerate(scenes):
        if not sc.get("say"):
            errs.append(f"scenes[{i}].say eksik")
        if sc.get("set", "sea") not in STORY_SETS:
            errs.append(f"scenes[{i}].set geçersiz: {sc.get('set')} (geçerli: {', '.join(sorted(STORY_SETS))})")
        sid = sc.get("id") or f"s{i + 1}"
        if sid in ids:
            errs.append(f"scenes[{i}].id tekrar ediyor: {sid}")
        ids.add(sid)
        for j, g in enumerate(sc.get("gfx") or []):
            if g.get("type") not in STORY_GFX:
                errs.append(f"scenes[{i}].gfx[{j}].type geçersiz: {g.get('type')}")
            aw = g.get("at_word")
            if aw and aw.casefold()[:4] not in sc.get("say", "").casefold():
                errs.append(f"scenes[{i}].gfx[{j}].at_word '{aw}' say metninde yok")
    if scenes and not any(g.get("type") in ("cliff", "next") for g in (scenes[-1].get("gfx") or [])):
        errs.append("son sahnede 'cliff' ya da 'next' (merak kancası / sonraki bölüm) gfx'i olmalı")
    return errs
