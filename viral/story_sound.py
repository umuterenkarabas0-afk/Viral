"""Mini dizi ses tasarımı — tamamı kodla sentezlenir (hazır örnek yok).

Katmanlar:
  • Seslendirme: Edge TTS (Ahmet) satırları; karakter/not/bükülme stiline göre ayrı işlem
    (EQ, sıkıştırma, oda yankısı, ters yankı, sıcak doygunluk...)
  • Müzik: Re minör ortak akor ızgarası (Dm–B♭–F–C) üzerinde çekimin "mood"una göre
    değişen enstrümantasyon: Karplus-Strong pizzicato, FM müzik kutusu, yaylı pad, komik
    fagot, saat tıkırtısı, gerilim drone + tremolo + kalp atışı; son kartta riser + vuruş.
  • Ortam: mekâna göre (pazar uğultusu, iskele dalgası + martı + vapur motoru, cadde, yağmur,
    oda, sahaf, meydan, çay bahçesi + kaşık şıngırtısı, güverte rüzgârı...) çapraz geçişli.
  • Efektler: kâğıt hışırtısı, dolma kalem cızırtısı (kelime zamanlarına bağlı), daktilo,
    plak cızırtısı, vapur düdüğü, kilit, miyav, kitap yağmuru, güvercin kanadı, glitch...
  • Miks: konuşmaya göre ducking, limiter, -14 LUFS.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

from . import sound as S
from .sound import SR, add_at, bp, hp, lp, pan, pink, brown, white, reverb, stereo, soft_clip, sweep_bp, midi_hz

RNG = np.random.default_rng(77)


def T(d):
    return np.arange(int(d * SR)) / SR


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) + 1e-9
    return x * (peak / m)


# ======================================================================= SFX
def sfx_paper(dur=0.7, seed=1, density=1.0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    k = int(70 * dur * density)
    for _ in range(k):
        st = int(r.uniform(0, dur * 0.85) * SR)
        L = int(r.uniform(0.002, 0.018) * SR)
        if st + L >= n:
            continue
        b = r.standard_normal(L) * np.exp(-np.arange(L) / (L * 0.3)) * r.uniform(0.2, 1.0)
        out[st:st + L] += b
    out = bp(out, 1500, 9000) * 0.9 + lp(out, 900) * 0.25
    env = np.minimum(1, np.arange(n) / (0.02 * SR)) * np.exp(-np.arange(n) / (dur * 0.6 * SR))
    return reverb(pan(out * env, r.uniform(-0.3, 0.3)), 0.18, 0.9) * 0.8


def sfx_pen(words, t0, seed=3):
    """Dolma kalem cızırtısı: kelime aralıkları boyunca vuruşlu sürtünme."""
    if not words:
        return np.zeros((1, 2)), t0
    s0 = min(w["s"] for w in words) - 0.05
    e0 = max(w["e"] for w in words) + 0.1
    n = int((e0 - s0) * SR)
    r = np.random.default_rng(seed)
    tt = np.arange(n) / SR + s0
    gate = np.zeros(n)
    for w in words:
        a, b = int((w["s"] - s0) * SR), int((w["e"] - s0) * SR)
        gate[a:b] = 1
    gate = lfilter([0.002], [1, -0.998], gate)
    strokes = (0.5 + 0.5 * np.sin(2 * np.pi * (9 + 3 * np.sin(tt * 1.7)) * tt + r.uniform(0, 6))) ** 3
    nz = bp(r.standard_normal(n), 2500, 7000) * 0.5 + bp(r.standard_normal(n), 700, 1800) * 0.15
    x = nz * strokes * gate * 1.4
    return pan(x, 0.15), s0


def sfx_click(freq=2400, dur=0.05, seed=0):
    t = T(dur)
    r = np.random.default_rng(seed)
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t * 140) * 0.5 + hp(r.standard_normal(len(t)), 3000) * np.exp(-t * 400) * 0.6
    return x


def sfx_type_clicks(n, rate=0.035, seed=5):
    out = np.zeros(int((n * rate + 0.3) * SR))
    r = np.random.default_rng(seed)
    for i in range(n):
        c = sfx_click(r.uniform(1800, 2800), 0.05, seed + i)
        a = int(i * rate * SR)
        out[a:a + len(c)] += c * r.uniform(0.5, 1.0)
    return stereo(out) * 0.5


def sfx_scratch(dur=0.55):
    """Plak cızırtısı (dondurulmuş kare / 'evet bu benim' anı)."""
    t = T(dur)
    n = len(t)
    f = np.interp(t, [0, dur * 0.35, dur * 0.55, dur], [300, 2600, 900, 120])
    nz = sweep_bp(white(n), 400, 3000, q=2.5) * 0.6
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = sum(np.sin(ph * k) / k for k in range(1, 8)) * 0.35
    env = np.minimum(1, t / 0.01) * np.exp(-np.maximum(0, t - dur * 0.6) * 10)
    return stereo((nz + saw) * env) * 0.7


def sfx_horn(dur=2.6, f0=98.0):
    t = T(dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t)
    x = np.zeros(len(t))
    for fr, g in ((f0, 1.0), (f0 * 1.5 * 1.003, 0.6), (f0 * 2.0, 0.35)):
        ph = 2 * np.pi * np.cumsum(fr * vib) / SR
        x += sum(np.sin(ph * k) / k ** 1.2 for k in range(1, 12)) * g
    env = np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.5)
    x = lp(x * env, 1200) * 0.25
    return reverb(stereo(x), 0.45, 3.5, 2500)


def sfx_gull(seed=1, calls=3):
    r = np.random.default_rng(seed)
    out = np.zeros(int(2.2 * SR))
    for c in range(calls):
        d = r.uniform(0.22, 0.38)
        t = T(d)
        f = np.interp(t, [0, d * 0.25, d], [1500, 2300, 1200]) * r.uniform(0.85, 1.15)
        ph = 2 * np.pi * np.cumsum(f) / SR
        x = (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)) * np.sin(np.pi * t / d) ** 1.5
        x = bp(x, 900, 5000)
        a = int((c * 0.42 + r.uniform(0, 0.08)) * SR)
        out[a:a + len(x)] += x[: len(out) - a]
    return reverb(pan(out * 0.22, r.uniform(-0.8, 0.8)), 0.4, 2.5)


def sfx_lock():
    out = np.zeros(int(0.5 * SR))
    for i, (d, f) in enumerate(((0.0, 3800), (0.07, 5200), (0.09, 2600))):
        t = T(0.25)
        x = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.47 * t)) * np.exp(-t * 35) * 0.3
        x += hp(white(len(t)), 4000) * np.exp(-t * 300) * 0.5
        a = int(d * SR)
        out[a:a + len(t)] += x
    return reverb(stereo(out), 0.15, 0.8)


def sfx_tock(freq=1700, g=0.4):
    t = T(0.12)
    x = (np.sin(2 * np.pi * freq * t) * np.exp(-t * 60) + 0.3 * np.sin(2 * np.pi * freq * 2.4 * t) * np.exp(-t * 90)) * g
    return x


def sfx_meow():
    d = 0.75
    t = T(d)
    f0 = np.interp(t, [0, 0.15, 0.4, d], [420, 780, 700, 380])
    ph = 2 * np.pi * np.cumsum(f0) / SR
    src = sum(np.sin(ph * k) / k for k in range(1, 20))
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 0.7
    form = sweep_bp(src, 900, 2600, q=2.0) * 0.8 + sweep_bp(src, 2600, 1200, q=3) * 0.5
    return reverb(stereo(form * env * 0.35), 0.2, 1.2)


def sfx_purr(dur=1.6):
    t = T(dur)
    pulses = (0.5 + 0.5 * np.sin(2 * np.pi * 26 * t)) ** 4
    x = bp(white(len(t)), 80, 400) * pulses * np.minimum(1, t / 0.2) * np.minimum(1, (dur - t) / 0.3)
    return stereo(x * 0.9)


def sfx_hiss(dur=0.6):
    t = T(dur)
    x = hp(white(len(t)), 2500) * np.minimum(1, t / 0.03) * np.exp(-t * 4) * 0.5
    return stereo(x) + sfx_meow()[: len(t)] * 0.0


def sfx_thud(g=1.0, f=70):
    t = T(0.5)
    x = np.sin(2 * np.pi * np.cumsum(f + 60 * np.exp(-t * 30)) / SR) * np.exp(-t * 14) + lp(white(len(t)), 600) * np.exp(-t * 40) * 0.6
    return soft_clip(x * g, 1.3) * 0.7


def sfx_books(dur=1.6, seed=13):
    r = np.random.default_rng(seed)
    out = np.zeros((int((dur + 0.6) * SR), 2))
    for i in range(18):
        st = r.uniform(0, dur) ** 1.3 / dur ** 0.3
        add_at(out, pan(sfx_thud(r.uniform(0.4, 1.0), r.uniform(60, 140)), r.uniform(-0.6, 0.6)), st, 0.8)
        if r.random() < 0.5:
            add_at(out, sfx_paper(0.3, seed + i, 0.6), st + 0.02, 0.4)
    return reverb(out, 0.2, 1.2)


def sfx_heartbeat(dur=3.0, bpm=78):
    out = np.zeros(int(dur * SR) + SR)
    beat = 60 / bpm
    for k in range(int(dur / beat) + 1):
        for off, g in ((0.0, 1.0), (0.16, 0.7)):
            t = T(0.25)
            x = np.sin(2 * np.pi * np.cumsum(55 + 25 * np.exp(-t * 25)) / SR) * np.exp(-t * 18) * g
            a = int((k * beat + off) * SR)
            out[a:a + len(x)] += x
    return stereo(lp(out[: int(dur * SR)], 200) * 0.9)


def sfx_wings(dur=1.6, birds=10, seed=4):
    r = np.random.default_rng(seed)
    out = np.zeros((int((dur + 0.5) * SR), 2))
    for b in range(birds):
        st = r.uniform(0, 0.4)
        rate = r.uniform(9, 14)
        n = int(r.uniform(6, 14))
        for k in range(n):
            t = T(0.04)
            x = bp(white(len(t)), 300, 2500) * np.sin(np.pi * t / 0.04) * (1 - k / n) * 0.6
            add_at(out, pan(x, r.uniform(-0.8, 0.8)), st + k / rate)
    return reverb(out, 0.25, 1.5)


def sfx_spill():
    t = T(0.9)
    x = lp(white(len(t)), 1800) * np.exp(-t * 5) * np.minimum(1, t / 0.02) * 0.6
    out = stereo(x)
    out[: len(t)] += S.sfx_bubbles(0.9, 12, 400, 1400, seed=9)[: len(t)] * 0.6
    return out


def sfx_rimshot():
    out = np.zeros((int(1.6 * SR), 2))
    for i, (d, f) in enumerate(((0.0, 180), (0.18, 140))):
        t = T(0.3)
        x = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.5 * np.exp(-t * 30))) / SR) * np.exp(-t * 14) + bp(white(len(t)), 1500, 5000) * np.exp(-t * 40) * 0.5
        add_at(out, stereo(x * 0.6), d)
    t = T(1.2)
    cym = hp(white(len(t)), 6000) * np.exp(-t * 3.2) * 0.35
    add_at(out, pan(cym, 0.3), 0.36)
    return reverb(out, 0.2, 1.2)


def sfx_boing():
    t = T(0.7)
    f = 260 * (1 + 0.35 * np.sin(2 * np.pi * 11 * t) * np.exp(-t * 4)) * (1 + 0.6 * np.exp(-t * 8))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5) * 0.5
    return stereo(x)


def sfx_squeak(dur=3.0, every=0.55):
    out = np.zeros(int(dur * SR))
    k = 0
    while k * every < dur - 0.2:
        t = T(0.18)
        f = 1300 + 300 * np.sin(np.pi * t / 0.18)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.18) ** 2 * 0.18
        a = int(k * every * SR)
        out[a:a + len(x)] += x
        k += 1
    return reverb(stereo(out), 0.2, 1.0)


def sfx_xylo_run(notes=(74, 77, 81, 84, 86, 89), step=0.055):
    out = np.zeros((int((len(notes) * step + 1.2) * SR), 2))
    for i, m in enumerate(notes):
        t = T(0.8)
        f = midi_hz(m)
        x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 3.9 * t) * np.exp(-t * 30)) * np.exp(-t * 9) * 0.25
        add_at(out, pan(x, -0.4 + 0.15 * i), i * step)
    return reverb(out, 0.25, 1.4)


def sfx_door():
    t = T(1.3)
    f = 180 + 90 * np.sin(2 * np.pi * 0.9 * t) + 40 * np.sin(2 * np.pi * 3.1 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = sum(np.sin(ph * k) / k for k in range(1, 10))
    x = bp(saw, 400, 2500) * (np.abs(np.sin(2 * np.pi * 7 * t)) ** 0.5) * np.minimum(1, t / 0.1) * np.exp(-t * 1.2) * 0.12
    out = stereo(x)
    add_at(out, stereo(sfx_thud(0.4, 90)), 1.1)
    return reverb(out, 0.2, 1.0)


def sfx_thunder(dur=4.5):
    t = T(dur)
    crack = hp(white(len(t)), 1500) * np.exp(-t * 18) * 0.6
    rum = lp(brown(len(t)) * 3, 260) * (np.exp(-t * 0.9) * (0.6 + 0.4 * np.sin(2 * np.pi * 1.3 * t) ** 2))
    return reverb(stereo(crack + rum * 1.4), 0.4, 3.0, 2000)


def sfx_glitch(dur=1.3, seed=2):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    pos = 0
    while pos < n:
        L = int(r.uniform(0.01, 0.08) * SR)
        kind = r.integers(0, 3)
        t = np.arange(L) / SR
        if kind == 0:
            seg = np.sign(np.sin(2 * np.pi * r.uniform(200, 3000) * t)) * 0.3
        elif kind == 1:
            seg = r.standard_normal(L) * 0.4
            seg = np.round(seg * 4) / 4
        else:
            seg = np.zeros(L)
        out[pos:pos + L] = seg[: n - pos]
        pos += L
    out = hp(out, 150) * 0.5
    return stereo(out)


def sfx_shutter():
    out = np.zeros(int(0.35 * SR))
    for d in (0.0, 0.09):
        c = sfx_click(1200, 0.06, int(d * 100)) + lp(white(int(0.06 * SR)), 2000) * np.exp(-np.arange(int(0.06 * SR)) / SR * 80) * 0.4
        a = int(d * SR)
        out[a:a + len(c)] += c
    return stereo(out) * 0.8


def sfx_marker(dur=0.35):
    t = T(dur)
    fr = 0.5 + 0.5 * np.sin(2 * np.pi * 38 * t)
    x = bp(white(len(t)), 1800, 4500) * fr * np.sin(np.pi * t / dur) * 0.6
    return stereo(x)


def sfx_chime():
    out = np.zeros((int(2.5 * SR), 2))
    for i, m in enumerate((81, 85, 88, 93)):
        t = T(2.0)
        f = midi_hz(m)
        x = np.sin(2 * np.pi * f * t + 1.5 * np.exp(-t * 6) * np.sin(2 * np.pi * f * 2.0 * t)) * np.exp(-t * 2.2) * 0.12
        add_at(out, pan(x, -0.5 + i * 0.33), i * 0.09)
    return reverb(out, 0.45, 2.5)


def sfx_buzz(dur=1.4, seed=6):
    r = np.random.default_rng(seed)
    t = T(dur)
    hum = np.sign(np.sin(2 * np.pi * 100 * t)) * 0.12 + np.sin(2 * np.pi * 50 * t) * 0.1
    gate = np.repeat(r.random(int(dur * 30) + 1) > 0.45, int(SR / 30) + 1)[: len(t)]
    return stereo(lp(hum * gate, 3000) * 0.6)


def sfx_rev_cymbal(dur=1.4):
    t = T(dur)
    x = hp(white(len(t)), 4000) * (t / dur) ** 3 * 0.4
    return reverb(stereo(x), 0.3, 1.5)


def sfx_clink(seed=0):
    r = np.random.default_rng(seed)
    t = T(0.6)
    f = r.uniform(3200, 4600)
    x = sum(np.sin(2 * np.pi * f * k * t + k) * np.exp(-t * (12 + 6 * k)) / k for k in (1, 2.76, 5.4)) * 0.15
    return pan(x, r.uniform(-0.7, 0.7))


def sfx_pops(n=40, dur=1.6, seed=3):
    r = np.random.default_rng(seed)
    out = np.zeros((int((dur + 0.4) * SR), 2))
    for i in range(n):
        add_at(out, S.sfx_pop(r.uniform(700, 1500), 0.12), i * dur / n + r.uniform(0, 0.01), 0.35)
    return out


def sfx_bighit():
    out = np.zeros((int(4.0 * SR), 2))
    add_at(out, S.sfx_impact(1.6, 3.0), 0, 1.0)
    t = T(3.0)
    sub = np.sin(2 * np.pi * np.cumsum(55 * np.exp(-t * 0.6) + 20) / SR) * np.exp(-t * 1.0) * 0.6
    add_at(out, stereo(sub), 0)
    return out


# ======================================================================= ortam
def babble(dur, voices=10, seed=1, level=1.0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    tt = np.arange(n) / SR
    for v in range(voices):
        f0 = r.uniform(95, 230)
        f = f0 * (1 + 0.08 * np.sin(2 * np.pi * r.uniform(0.2, 0.6) * tt + r.uniform(0, 6)))
        ph = 2 * np.pi * np.cumsum(f) / SR
        src = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph) + 0.15 * np.sin(5 * ph)
        syl = np.zeros(n)
        pos = r.uniform(0, 1.5)
        while pos < dur:
            L = r.uniform(0.09, 0.22)
            a, b = int(pos * SR), int(min(dur, pos + L) * SR)
            syl[a:b] = np.sin(np.linspace(0, np.pi, b - a)) * r.uniform(0.4, 1.0)
            pos += L + (r.uniform(0.02, 0.08) if r.random() < 0.85 else r.uniform(0.4, 1.4))
        x = bp(src * syl, 350, 2800)
        out += pan(x * 0.12, r.uniform(-0.9, 0.9))
    out = lp(out, 2600) * level
    return reverb(out, 0.45, 1.8, 3000)


def waves(dur, seed=2, level=1.0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    tt = np.arange(n) / SR
    sw = 0.4 + 0.6 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * tt + r.uniform(0, 6))) ** 2
    L = lp(pink(n), 1400) * sw
    R = lp(pink(n), 1400) * np.roll(sw, int(0.7 * SR))
    return np.stack([L, R], axis=1) * 0.18 * level


def wind(dur, level=1.0, seed=8):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    m = 0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * tt) * np.sin(2 * np.pi * 0.031 * tt + 1)
    x = sweep_bp(pink(n), 300, 900, q=1.0) * m
    return stereo(x * 0.25 * level)


def engine(dur, f=42, level=1.0):
    t = T(dur)
    x = np.sin(2 * np.pi * f * t) * 0.5 + np.sin(2 * np.pi * f * 2 * t + 1) * 0.25 + lp(brown(len(t)) * 3, 180) * 0.6
    x *= 1 + 0.15 * np.sin(2 * np.pi * 3.3 * t)
    return stereo(lp(x, 300) * 0.25 * level)


def traffic(dur, level=1.0, seed=3):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    out = stereo(lp(brown(n) * 3, 400) * 0.15)
    pos = r.uniform(0, 3)
    while pos < dur:
        d = r.uniform(2.5, 4.5)
        t = T(d)
        env = np.exp(-((t - d / 2) / (d / 5)) ** 2)
        car = lp(pink(len(t)), 900) * env * 0.25
        add_at(out, pan(car, np.linspace(-0.9, 0.9, len(t)) * (1 if r.random() < 0.5 else -1)), pos)
        pos += r.uniform(3, 7)
    return out * level


def roomtone(dur, level=1.0, hum=False):
    t = T(dur)
    x = lp(brown(len(t)) * 3, 160) * 0.12
    if hum:
        x += (np.sin(2 * np.pi * 120 * t) * 0.02 + np.sin(2 * np.pi * 240 * t) * 0.008)
    return stereo(x * level)


def rain(dur, level=1.0, seed=4):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.stack([hp(pink(n), 900), hp(pink(n), 900)], axis=1) * 0.12
    drops = np.zeros(n)
    idx = r.integers(0, n, int(dur * 160))
    drops[idx] = r.uniform(0.2, 1.0, len(idx))
    drops = bp(drops, 2000, 7000) * 0.5
    out += stereo(drops)
    return out * level


def birds(dur, seed=5, level=1.0):
    r = np.random.default_rng(seed)
    out = np.zeros((int(dur * SR), 2))
    pos = r.uniform(0, 2)
    while pos < dur:
        k = r.integers(2, 5)
        f = r.uniform(2800, 4800)
        for i in range(k):
            t = T(0.08)
            x = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.3 * np.sin(np.pi * t / 0.08))) / SR) * np.sin(np.pi * t / 0.08) * 0.05
            add_at(out, pan(x, r.uniform(-0.8, 0.8)), pos + i * 0.11)
        pos += r.uniform(1.5, 4)
    return reverb(out, 0.3, 1.5) * level


def ticking(dur, every=1.0, level=1.0):
    out = np.zeros(int(dur * SR))
    k = 0
    while k * every < dur:
        x = sfx_tock(2200 if k % 2 else 1900, 0.12)
        a = int(k * every * SR)
        out[a:a + len(x)] += x[: len(out) - a]
        k += 1
    return stereo(out) * level


def gulls_bed(dur, seed=7, level=1.0):
    r = np.random.default_rng(seed)
    out = np.zeros((int(dur * SR) + SR * 3, 2))
    pos = r.uniform(0.5, 3)
    while pos < dur:
        add_at(out, sfx_gull(int(pos * 10), r.integers(1, 4)), pos, r.uniform(0.3, 0.7))
        pos += r.uniform(3, 7)
    return out[: int(dur * SR)] * level


def clinks(dur, seed=8, level=1.0):
    r = np.random.default_rng(seed)
    out = np.zeros((int(dur * SR) + SR, 2))
    pos = r.uniform(0, 1)
    while pos < dur:
        add_at(out, stereo(sfx_clink(int(pos * 100))), pos, r.uniform(0.3, 0.8))
        pos += r.uniform(0.6, 2.5)
    return out[: int(dur * SR)] * level


def ambience_for(kind: str, time: str, dur: float, seed: int) -> np.ndarray:
    n = int(dur * SR)
    z = np.zeros((n, 2))
    if kind == 'market':
        z += babble(dur, 12, seed, 0.9 if time != 'dawn' else 0.0) + traffic(dur, 0.6, seed) + gulls_bed(dur, seed, 0.4)
        if time == 'dawn':
            z += wind(dur, 0.5) + birds(dur, seed, 0.8) + roomtone(dur, 1.5)
    elif kind == 'office':
        z += roomtone(dur, 1.2, hum=True) + babble(dur, 4, seed, 0.25) + ticking(dur, 0.17, 0.15)
    elif kind == 'room':
        if time == 'night':
            z += roomtone(dur, 1.0) + ticking(dur, 1.0, 1.2) + traffic(dur, 0.2, seed)
        else:
            z += roomtone(dur, 0.9) + birds(dur, seed, 1.0) + traffic(dur, 0.25, seed)
    elif kind == 'pier':
        z += waves(dur, seed, 1.2) + gulls_bed(dur, seed, 1.0) + engine(dur, 38, 0.8) + babble(dur, 6, seed, 0.5)
    elif kind == 'street':
        if time == 'rain':
            z += rain(dur, 1.4, seed) + traffic(dur, 0.5, seed)
        elif time == 'night':
            z += traffic(dur, 0.5, seed) + roomtone(dur, 0.8) + wind(dur, 0.3)
        else:
            z += traffic(dur, 0.9, seed) + babble(dur, 6, seed, 0.45) + birds(dur, seed, 0.6)
    elif kind == 'bookshop':
        z += roomtone(dur, 1.0) + ticking(dur, 1.0, 0.9) + traffic(dur, 0.15, seed)
    elif kind == 'square':
        z += babble(dur, 16, seed, 1.0) + traffic(dur, 0.8, seed)
    elif kind == 'cafe':
        z += babble(dur, 8, seed, 0.55) + clinks(dur, seed, 1.0) + waves(dur, seed, 0.4) + gulls_bed(dur, seed, 0.5)
    elif kind == 'deck':
        z += engine(dur, 44, 1.2) + wind(dur, 1.0) + waves(dur, seed, 0.9)
        if time == 'sunset':
            z += gulls_bed(dur, seed, 0.6)
    else:
        z += roomtone(dur, 0.8)
    return z[:n]


# ======================================================================= müzik
CHORDS = [  # (bas kökü midi, akor notaları)
    (38, [62, 65, 69]),   # Dm
    (34, [58, 62, 65]),   # Bb
    (41, [60, 65, 69]),   # F
    (36, [60, 64, 67]),   # C
]
MOTIF = [(0, 69), (0.5, 74), (1.0, 77), (1.5, 76), (2.0, 74), (3.0, 72), (4.0, 70), (4.5, 74), (5.0, 77), (5.5, 79), (6.0, 77), (6.5, 76), (7.0, 72)]

MOOD = {
    'mystery': {'pad': 0.55, 'pizz': 0.85, 'box': 0.55, 'tick': 0.45, 'drone': 0.25},
    'comedy': {'pad': 0.35, 'bounce': 1.0, 'bassoon': 0.9, 'box': 0.25, 'shaker': 0.55},
    'tension': {'pad': 0.25, 'drone': 1.0, 'trem': 0.75, 'heart': 0.6, 'tick': 0.5},
    'warm': {'pad': 1.0, 'box': 0.85, 'pizz': 0.3},
    'reveal': {'pad': 0.75, 'box': 0.6, 'drone': 0.5, 'trem': 0.35, 'pizz': 0.45},
    'quiet': {'pad': 0.55, 'box': 0.4},
}
LAYERS = ['pad', 'pizz', 'bounce', 'box', 'bassoon', 'tick', 'shaker', 'drone', 'trem', 'heart']


def ks_pluck(f, dur=0.6, bright=0.5, seed=0):
    n = int(dur * SR)
    N = max(2, int(SR / f))
    r = np.random.default_rng(seed)
    exc = np.zeros(n)
    burst = r.uniform(-1, 1, N)
    burst = lfilter([bright, 1 - bright], [1], burst)
    exc[:N] = burst
    g = 0.996
    a = np.zeros(N + 2)
    a[0] = 1
    a[N] = -g / 2
    a[N + 1] = -g / 2
    y = lfilter([1], a, exc)
    y *= np.exp(-np.arange(n) / (SR * dur * 0.35))
    return lp(y, 3500) * 0.6


def bell(f, dur=1.6, g=0.2):
    t = T(dur)
    x = np.sin(2 * np.pi * f * t + 1.8 * np.exp(-t * 5) * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 2.6)
    x += 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 5)
    return x * g


def bassoon(f, dur):
    t = T(dur)
    ph = 2 * np.pi * f * t
    x = np.sign(np.sin(ph)) * 0.5 + np.sin(ph) * 0.5 + 0.3 * np.sin(2 * ph)
    env = np.minimum(1, t / 0.02) * np.exp(-t * 5)
    return lp(x * env, 900) * 0.35


def strings_pad(freqs, dur):
    t = T(dur)
    out = np.zeros((len(t), 2))
    env = S.env_adsr(len(t), min(0.5, dur * 0.3), 0.2, 0.9, min(0.6, dur * 0.3))
    for i, f in enumerate(freqs):
        for det, pn in ((-0.08, -0.7), (0.0, 0.0), (0.08, 0.7)):
            ff = f * 2 ** (det / 12)
            ph = 2 * np.pi * ff * t + i
            saw = sum(np.sin(ph * k) / k for k in range(1, 7))
            out += pan(saw * env * 0.035, pn)
    return lp(out, 2400)


def render_layers(dur: float, bpm: float, seed: int) -> dict[str, np.ndarray]:
    n = int(dur * SR) + SR
    L = {k: np.zeros((n, 2)) for k in LAYERS}
    beat = 60 / bpm
    bar = beat * 4
    e8 = beat / 2
    r = np.random.default_rng(seed)
    nb = int(math.ceil(dur / bar)) + 1
    for bi in range(nb):
        t0 = bi * bar
        if t0 > dur:
            break
        root, ch = CHORDS[bi % 4]
        # pad
        add_at(L['pad'], strings_pad([midi_hz(m - 12) for m in ch] + [midi_hz(root)], bar + 0.5), t0, 1.0)
        # gizem pizzicato: seyrek
        pat = [0, 3, 4, 6] if bi % 2 == 0 else [0, 2, 5, 7]
        for i in pat:
            m = [root + 12, ch[0] - 12, ch[1] - 12, ch[2] - 12][i % 4]
            add_at(L['pizz'], pan(ks_pluck(midi_hz(m), 0.5, 0.4, bi * 8 + i), 0.3 * math.sin(i)), t0 + i * e8, 0.7)
        # komik zıplayan pizz (her 8'lik, oktav sıçramalı)
        for i in range(8):
            m = (root + 12 if i % 2 == 0 else ch[(i // 2) % 3]) + (12 if i in (3, 7) else 0)
            add_at(L['bounce'], pan(ks_pluck(midi_hz(m), 0.3, 0.7, bi * 16 + i), -0.3 + 0.6 * (i % 2)), t0 + i * e8, 0.8 if i % 2 == 0 else 0.55)
        # fagot "um-pa"
        for i in (0, 2):
            add_at(L['bassoon'], stereo(bassoon(midi_hz(root + (0 if i == 0 else 7)), beat * 0.6)), t0 + i * beat, 1.0)
        # saat tıkırtısı + hafif shaker
        for i in range(8):
            add_at(L['tick'], pan(sfx_tock(1900 if i % 2 else 2300, 0.25), 0.4 if i % 2 else -0.4), t0 + i * e8, 1.0)
            tt = T(0.08)
            sh = hp(white(len(tt)), 6000) * np.exp(-tt * 50) * (0.25 if i % 2 else 0.12)
            add_at(L['shaker'], pan(sh, 0.5), t0 + i * e8 + e8 * 0.5, 1.0)
        # müzik kutusu motifi (2 ölçüde bir 8 nota)
        half = bi % 2
        for (bt, m) in MOTIF:
            if (bt < 4) == (half == 0):
                tt0 = t0 + (bt % 4) * beat
                add_at(L['box'], pan(bell(midi_hz(m + 12)), 0.25 * math.sin(m)), tt0, 0.9)
        # kalp atışı
        for i in (0, 2):
            add_at(L['heart'], sfx_heartbeat(0.6, 100), t0 + i * beat, 1.0)
    # drone + tremolo
    t = np.arange(n) / SR
    d = np.zeros(n)
    for f, g in ((midi_hz(26), 1.0), (midi_hz(38), 0.5), (midi_hz(45), 0.3)):
        ph = 2 * np.pi * f * t
        d += sum(np.sin(ph * k + k) / k for k in range(1, 8)) * g
    d = lp(d * (0.8 + 0.2 * np.sin(2 * np.pi * 0.13 * t)), 420) * 0.12
    L['drone'] = stereo(d)
    tr = np.zeros(n)
    for f in (midi_hz(74), midi_hz(77), midi_hz(81)):
        ph = 2 * np.pi * f * t
        tr += sum(np.sin(ph * k) / k for k in range(1, 6))
    tr = lp(tr, 3500) * (0.5 + 0.5 * np.sin(2 * np.pi * 11 * t)) * 0.03
    L['trem'] = np.stack([tr, np.roll(tr, 300)], axis=1)
    for k in L:
        L[k] = L[k][: int(dur * SR)]
    return L


def automation(dur: float, shots: list[dict], layer: str, cliff_t: float | None, fade=0.4) -> np.ndarray:
    n = int(dur * SR)
    g = np.zeros(n)
    for s in shots:
        a, b = int(s["start"] * SR), int(min(dur, s["end"]) * SR)
        g[a:b] = MOOD.get(s.get("mood", "mystery"), MOOD['mystery']).get(layer, 0.0)
    k = int(fade * SR)
    g = np.convolve(g, np.ones(k) / k, mode="same")
    if cliff_t is not None:
        c = int(cliff_t * SR)
        if c < n:
            keep = 0.35 if layer == 'drone' else 0.0
            g[c:] = g[c:] * 0 + keep * np.exp(-np.arange(n - c) / (1.6 * SR))
    return g


# ======================================================================= seslendirme işleme
def process_line(a: np.ndarray, style: str) -> np.ndarray:
    v = hp(a.astype(np.float64), 70, 2)
    v = S.peaking(v, 3600, 2.5, 0.9)
    if style in ('nuri', 'old'):
        v = S.peaking(v, 260, 2.5, 0.8)
        v = lp(v, 7500)
        v = soft_clip(v * 1.3, 1.2)
    if style == 'note':
        v = bp(v, 150, 8000)
        v = S.peaking(v, 5000, 2.0, 0.8)
    if style == 'twist':
        v = lp(v, 4800)
        v = S.peaking(v, 180, 3.5, 0.8)
    v = S.compress(v, -22, 3.0, 5)
    rms = np.sqrt(np.mean(v[np.abs(v) > 1e-4] ** 2) + 1e-12)
    v = v * (0.085 / rms) * {'shout': 1.25, 'twist': 1.05}.get(style, 1.0)
    wet = {'n': (0.07, 0.8), 'note': (0.2, 1.6), 'nuri': (0.12, 1.0), 'old': (0.12, 1.0), 'stranger': (0.14, 1.1), 'shout': (0.38, 2.6), 'twist': (0.42, 3.2)}.get(style, (0.08, 0.9))
    out = reverb(v, wet[0], wet[1], 5000)
    if style == 'note':  # hafif çift kanal (yakın, fısıltımsı)
        d = int(0.014 * SR)
        out[d:, 1] += out[:-d, 0] * 0.25
    if style == 'twist':  # ters yankı ön-gelişi
        pre = reverb(v[::-1].copy(), 1.0, 2.5, 3000)[::-1]
        L0 = min(len(pre), int(1.2 * SR))
        out = np.concatenate([pre[-L0:] * 0.35, out], axis=0)
        return out, L0 / SR
    return out, 0.0


# ======================================================================= ana fonksiyon
def design(tl: dict, placements, out_dir: Path) -> Path:
    from .pipeline import loudnorm, write_wav

    dur = tl["meta"]["duration"]
    n = int(dur * SR)
    shots = tl["shots"]
    bpm = tl["meta"].get("bpm", 96)
    ep = tl["meta"].get("episode", 1)
    cliff_t = (tl.get("cliff") or {}).get("t")

    # --- seslendirme
    vox = np.zeros((n, 2))
    for off, clip in placements:
        out, pre = process_line(clip.audio, clip.style)
        add_at(vox, out, off - pre)

    # --- müzik
    layers = render_layers(dur, bpm, ep)
    music = np.zeros((n, 2))
    for k, x in layers.items():
        g = automation(dur, shots, k, cliff_t)
        music[: len(x)] += x * g[: len(x), None]
    music = reverb(music, 0.18, 2.2)

    # --- ortam (çekim bazlı çapraz geçiş)
    cache = {}
    amb = np.zeros((n, 2))
    last = ('room', 'day')
    for s in shots:
        kind, time, lvl = s["set"], s.get("time", "day"), 1.0
        if kind == 'insert':
            kind, time = last
            lvl = 0.5
        else:
            last = (kind, time)
        if s.get("grade") == 'nightvision':
            lvl = 0.6
        key = (kind, time)
        if key not in cache:
            cache[key] = ambience_for(kind, time, dur, seed=hash(key) % 1000)
        a, b = s["start"], s["end"]
        seg = cache[key]
        i0, i1 = int(max(0, a - 0.25) * SR), int(min(dur, b + 0.25) * SR)
        env = np.ones(i1 - i0)
        f = int(0.25 * SR)
        env[:f] = np.linspace(0, 1, min(f, len(env)))[: len(env[:f])]
        env[-f:] = np.linspace(1, 0, min(f, len(env)))[-len(env[-f:]):]
        x = seg[i0:i1] * env[:, None] * lvl
        if s.get("grade") == 'sepia':
            x = lp(x, 2200) * 0.7
        amb[i0:i1] += x
    if cliff_t:
        c = int(cliff_t * SR)
        amb[c:] *= np.exp(-np.arange(n - c) / (0.8 * SR))[:, None]

    # --- efektler
    fx = np.zeros((n + 6 * SR, 2))
    words = tl["words"]
    add_at(fx, S.sfx_impact(1.2, 1.6), 0.02, 0.55)
    add_at(fx, sfx_paper(0.6, 1), 0.05, 0.6)
    for k, s in enumerate(shots):
        st = s["start"]
        cut = s.get("cut", "cut")
        if k > 0:
            if cut == 'whip':
                add_at(fx, S.sfx_whoosh(0.6, up=k % 2 == 0, pan_from=-0.8, pan_to=0.8), st - 0.38, 0.55)
            elif cut == 'flash':
                add_at(fx, S.sfx_whoosh(0.5, up=True, bright=1.4), st - 0.3, 0.4)
                add_at(fx, S.sfx_impact(0.7, 1.2), st, 0.35)
                add_at(fx, S.sfx_sparkle(1.2, k), st + 0.05, 0.3)
            elif cut == 'glitch':
                add_at(fx, sfx_glitch(0.4, k), st, 0.5)
            elif cut == 'fade':
                add_at(fx, sfx_rev_cymbal(0.9), st - 0.85, 0.3)
            elif s["set"] != shots[k - 1]["set"]:
                add_at(fx, S.sfx_whoosh(0.4, up=True, bright=0.8), st - 0.25, 0.22)
        if s.get("label"):
            L = s["label"]
            add_at(fx, sfx_type_clicks(len(L.get("place", "")) + len(L.get("time", "")), 0.04, k), L["t"] + 0.05, 0.45)
        if s.get("tag"):
            add_at(fx, sfx_scratch(), s["tag"]["t"] - 0.05, 0.5)
            add_at(fx, S.sfx_pop(900), s["tag"]["t"] + 0.12, 0.6)
        if s.get("bubble"):
            add_at(fx, S.sfx_pop(1100), s["bubble"]["t"], 0.6)
        o = s.get("overlay") or {}
        if o.get("type") == 'bigtext':
            add_at(fx, S.sfx_impact(1.4, 1.6), o["t"], 0.8)
        if o.get("type") == 'suspects':
            add_at(fx, S.sfx_pop(800 + 150 * o.get("show", 1)), st + 0.12, 0.6)
            if o.get("strike_t"):
                add_at(fx, sfx_marker(), o["strike_t"], 0.7)
            if o.get("circle"):
                add_at(fx, sfx_marker(0.5), o.get("t", st), 0.6)
        if o.get("type") == 'rec':
            add_at(fx, stereo(S.sfx_tick(1800, 0.08)), st + 0.1, 0.6)
        if o.get("type") == 'photo':
            add_at(fx, sfx_shutter(), st + 0.02, 0.8)
        if o.get("type") == 'photojoin':
            add_at(fx, S.sfx_whoosh(0.6, up=True), o["t"] - 0.3, 0.4)
        if o.get("type") == 'network':
            items = len(o.get("items", []))
            sp = (s["ve"] - s["vs"]) * 0.8 / max(1, items)
            for i in range(items):
                add_at(fx, S.sfx_pop(700 + i * 120), s["vs"] + i * sp + 0.1, 0.5)
        # yazılan notlar: kalem cızırtısı
        if s["set"] == 'insert':
            add_at(fx, sfx_paper(0.5, k + 3, 0.7), st + 0.05, 0.45)
            for ln in s.get("lines", []):
                if ln.get("write"):
                    pen, p0 = sfx_pen(words[ln["w0"]:ln["w1"]], 0, seed=k)
                    add_at(fx, pen, p0, 0.32)
    # bağımsız efekt listesi
    lib = {
        'paper': lambda e: sfx_paper(0.7, int(e['t'] * 10)), 'thud': lambda e: stereo(sfx_thud(1.2)), 'horn': lambda e: sfx_horn(),
        'gulls': lambda e: sfx_gull(int(e['t']), 3), 'lock': lambda e: sfx_lock(), 'clock': lambda e: ticking(3.0, 1.0, 1.0),
        'scratch': lambda e: sfx_marker(0.45), 'meow': lambda e: sfx_meow(), 'purr': lambda e: sfx_purr(), 'hiss': lambda e: sfx_hiss() + sfx_meow()[: int(0.6 * SR)] * 0.6,
        'books': lambda e: sfx_books(), 'heartbeat': lambda e: sfx_heartbeat(e.get('dur', 3.0)), 'pigeons': lambda e: sfx_wings(),
        'spill': lambda e: sfx_spill(), 'rimshot': lambda e: sfx_rimshot(), 'match': lambda e: S.sfx_sparkle(1.0, 3) + 0,
        'dots': lambda e: sfx_pops(40, 1.6), 'tick': lambda e: stereo(S.sfx_tick(2600, 0.08)), 'boing': lambda e: sfx_boing(),
        'squeak': lambda e: sfx_squeak(e.get('dur', 3.0)), 'pen': lambda e: np.zeros((10, 2)), 'sting_comedy': lambda e: sfx_xylo_run(),
        'door': lambda e: sfx_door(), 'crumple': lambda e: sfx_paper(1.2, 9, 1.6), 'thunder': lambda e: sfx_thunder(),
    }
    gains = {'horn': 0.55, 'thunder': 0.8, 'books': 0.9, 'heartbeat': 0.9, 'pigeons': 0.8, 'clock': 0.6, 'dots': 0.8, 'match': 0.6, 'tick': 0.5}
    for e in tl.get("sfx", []):
        f = lib.get(e["type"])
        if f is None:
            continue
        x = f(e)
        add_at(fx, x if x.ndim == 2 else stereo(x), e["t"], gains.get(e["type"], 0.7) * e.get("gain", 1.0))
    for c in tl.get("cues", []):
        typ = c["type"]
        if typ == 'shake':
            add_at(fx, S.sfx_impact(0.9, 1.4), c["t"], 0.45)
        elif typ == 'flash' and c["t"] > 0.1:
            add_at(fx, S.sfx_whoosh(0.4, up=True, bright=1.3), c["t"] - 0.2, 0.3)
        elif typ == 'glitch':
            add_at(fx, sfx_glitch(c.get("dur", 1.3)), c["t"], 0.65)
        elif typ == 'ferry_depart':
            add_at(fx, engine(5.0, 46, 1.5), c["t"], 0.6)
        elif typ == 'rain_start':
            add_at(fx, rain(2.5, 1.3) * np.linspace(0, 1, int(2.5 * SR))[:, None], c["t"], 0.6)
        elif typ == 'cat_jump':
            add_at(fx, sfx_meow(), c["t"] - 0.1, 0.6)
            add_at(fx, S.sfx_whoosh(0.4, up=True), c["t"], 0.4)
        elif typ == 'join':
            add_at(fx, sfx_paper(0.4, 5, 0.6), c["t"] - 0.4, 0.5)
        elif typ == 'holdhands':
            add_at(fx, sfx_chime(), c["t"], 0.55)
        elif typ == 'flicker':
            add_at(fx, sfx_buzz(c.get("dur", 1.4)), c["t"], 0.5)
        elif typ == 'books':
            pass
    # son kart: riser + büyük vuruş + müzik kutusu iz sürümü
    if cliff_t:
        add_at(fx, S.sfx_riser(1.8, 4200), cliff_t - 1.8, 0.45)
        add_at(fx, sfx_rev_cymbal(1.5), cliff_t - 1.5, 0.35)
        add_at(fx, sfx_bighit(), cliff_t, 0.9)
        sting = np.zeros((int(3 * SR), 2))
        for i, m in enumerate((74, 77, 81, 80)):
            add_at(sting, pan(bell(midi_hz(m + 12), 2.0, 0.22), -0.3 + 0.2 * i), 0.45 + i * 0.32)
        add_at(fx, reverb(sting, 0.4, 2.8), cliff_t + 0.35, 0.9)
    fx = fx[:n]

    # --- miks
    env = S.envelope_follow(vox.mean(axis=1), 0.03, 0.35)
    thr = np.percentile(env[env > 1e-4], 60) if np.any(env > 1e-4) else 0.05
    duck = 1 - 0.6 * np.clip(env / (thr + 1e-9), 0, 1)
    mix = vox + music * (0.5 * duck)[:, None] + amb * (0.3 * (0.55 + 0.45 * duck))[:, None] + fx * 0.75
    mix = hp(mix, 28, 2)
    fi = int(0.05 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    fo = int(0.5 * SR)
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
    mix = S.limiter(mix * 0.9, 0.9)
    raw = out_dir / "audio_raw.wav"
    write_wav(raw, mix)
    stems = out_dir / "stems"
    stems.mkdir(exist_ok=True)
    write_wav(stems / "voice.wav", np.clip(vox, -1, 1))
    write_wav(stems / "music.wav", np.clip(music * 0.5, -1, 1))
    write_wav(stems / "ambience.wav", np.clip(amb * 0.3, -1, 1))
    write_wav(stems / "sfx.wav", np.clip(fx * 0.75, -1, 1))
    final = out_dir / "audio.wav"
    loudnorm(raw, final)
    return final
