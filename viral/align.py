"""Kelime zamanlaması.

SSML mark zamanları varsa doğrudan kullanılır. Yoksa:
  1. Enerji zarfından konuşma başlangıcı/bitişi ve iç duraklamalar bulunur.
  2. Noktalama işaretleriyle ayrılan öbekler en belirgin duraklamalara eşlenir.
  3. Öbek içinde süre, Türkçe hece sayısıyla (ünlü sayısı) orantılı dağıtılır.
"""
from __future__ import annotations

import numpy as np

from .script import syllables

FRAME = 0.01  # 10 ms


def energy_db(audio: np.ndarray, sr: int) -> np.ndarray:
    hop = int(sr * FRAME)
    n = len(audio) // hop
    if n == 0:
        return np.zeros(1)
    a = audio[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(a * a, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    # hafif yumuşatma
    k = np.ones(3) / 3
    return np.convolve(db, k, mode="same")


def speech_bounds(audio: np.ndarray, sr: int, thresh_rel: float = -38.0) -> tuple[float, float]:
    db = energy_db(audio, sr)
    peak = np.percentile(db, 98)
    on = np.where(db > peak + thresh_rel)[0]
    if len(on) == 0:
        return 0.0, len(audio) / sr
    return on[0] * FRAME, (on[-1] + 1) * FRAME


def find_pauses(audio: np.ndarray, sr: int, min_len: float = 0.09, thresh_rel: float = -30.0) -> list[tuple[float, float]]:
    db = energy_db(audio, sr)
    peak = np.percentile(db, 98)
    quiet = db < peak + thresh_rel
    s, e = speech_bounds(audio, sr)
    pauses = []
    i0 = None
    for i, q in enumerate(quiet):
        t = i * FRAME
        if q and i0 is None:
            i0 = i
        elif not q and i0 is not None:
            a, b = i0 * FRAME, t
            if b - a >= min_len and a > s + 0.05 and b < e - 0.05:
                pauses.append((a, b))
            i0 = None
    return pauses


def _weight(word: str) -> float:
    clean = "".join(ch for ch in word if ch.isalnum() or ch in "'’")
    return syllables(clean) + 0.25 + 0.04 * len(clean)


def _ends_phrase(word: str) -> bool:
    return word.rstrip("\"'”»)").endswith((",", ".", ";", ":", "!", "?", "…"))


def align_words(audio: np.ndarray, sr: int, spoken: list[str], mark_starts: list[float] | None = None) -> list[tuple[float, float]]:
    """Her konuşulan kelime için (başlangıç, bitiş) saniye döndürür."""
    n = len(spoken)
    s, e = speech_bounds(audio, sr)
    if n == 0:
        return []
    if mark_starts and len(mark_starts) == n:
        starts = [max(0.0, float(x)) for x in mark_starts]
        out = []
        for i in range(n):
            end = starts[i + 1] - 0.02 if i + 1 < n else e
            out.append((starts[i], max(starts[i] + 0.06, end)))
        # ilk kelime gerçek konuşma başlangıcından önce başlamasın
        out[0] = (max(out[0][0], s - 0.02), out[0][1])
        return out

    # öbeklere böl
    phrases: list[list[int]] = [[]]
    for i, w in enumerate(spoken):
        phrases[-1].append(i)
        if _ends_phrase(w) and i < n - 1:
            phrases.append([])
    phrases = [p for p in phrases if p]
    pauses = find_pauses(audio, sr)
    k = len(phrases) - 1
    spans: list[tuple[float, float]]
    if k > 0 and len(pauses) >= k:
        # beklenen sınır zamanlarına en yakın, en uzun duraklamaları seç
        wsum = [sum(_weight(spoken[i]) for i in p) for p in phrases]
        total = sum(wsum)
        expected = []
        acc = 0.0
        for j in range(k):
            acc += wsum[j]
            expected.append(s + (e - s) * acc / total)
        chosen = []
        used = set()
        for j, ex in enumerate(expected):
            best, bscore = None, 1e9
            for pi, (a, b) in enumerate(pauses):
                if pi in used:
                    continue
                mid = (a + b) / 2
                if chosen and mid <= (chosen[-1][0] + chosen[-1][1]) / 2:
                    continue
                score = abs(mid - ex) - 0.8 * (b - a)
                if score < bscore:
                    best, bscore = pi, score
            if best is None:
                break
            used.add(best)
            chosen.append(pauses[best])
        if len(chosen) == k:
            bounds = [s] + [x for p in chosen for x in p] + [e]
            spans = [(bounds[2 * j], bounds[2 * j + 1]) for j in range(k + 1)]
        else:
            spans = None  # type: ignore
    else:
        spans = None  # type: ignore
    if spans is None:
        wsum = [sum(_weight(spoken[i]) for i in p) for p in phrases]
        total = sum(wsum)
        gap = 0.12
        dur = (e - s) - gap * (len(phrases) - 1)
        t = s
        spans = []
        for ws in wsum:
            d = dur * ws / total
            spans.append((t, t + d))
            t += d + gap

    out: list[tuple[float, float]] = [(0.0, 0.0)] * n
    for p, (a, b) in zip(phrases, spans):
        ws = [_weight(spoken[i]) for i in p]
        tot = sum(ws)
        t = a
        for i, w in zip(p, ws):
            d = (b - a) * w / tot
            out[i] = (t, t + d)
            t += d
    return out
