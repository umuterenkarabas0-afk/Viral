"""Mini dizi (hikâye) formatı için kodla sentezlenen ses tasarımı.

Hiç hazır örnek yok; her şey numpy/scipy ile üretilir:
  • Müzik (sahne ruh hâline göre): drone pad, saat-tik ostinato, nabız bas, müzik kutusu motifi,
    "braam" (sinematik bas vurgusu), zafer arpeji, merak kancasında sub-drop + tik-tak
  • Atmosfer (set + zamana göre): dalgalar, tekneye vuran su, rüzgâr, martılar, ahşap gıcırtısı,
    fırtına (yağmur, gök gürültüsü — görüntüdeki şimşeklerle aynı deterministik zamanlama),
    kahvehane uğultusu, stadyum sesi, oda tonu, duvar saati, cırcır böceği
  • Efektler: whoosh geçişleri, impact, daktilo, pop, damga, kâğıt hışırtısı, cam tıngırtısı, mantar,
    kalp atışı, kapı vuruşu, sayaç tıkırtısı, ding
  • Miks: seslendirmeye göre ducking, limiter, -14 LUFS
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from . import sound as S
from .sound import SR, add_at, bp, hp, lp, pan, reverb, stereo, white, pink, brown, soft_clip, sweep_bp, midi_hz


# ----------------------------------------------------------------- yardımcılar
def _n(d):
    return max(1, int(d * SR))


def _t(n):
    return np.arange(n) / SR


def fade(x, a=0.02, r=0.05):
    n = len(x)
    e = np.ones(n)
    A, R = min(n, _n(a)), min(n, _n(r))
    e[:A] = np.linspace(0, 1, A)
    e[n - R:] = np.minimum(e[n - R:], np.linspace(1, 0, R))
    return x * (e[:, None] if x.ndim == 2 else e)


def mulberry32(seed: int):
    """renderer/src/util.js ile birebir aynı PRNG (şimşek zamanlamaları eşleşsin)."""
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return ((x & 0xFFFFFFFF) * (y & 0xFFFFFFFF)) & 0xFFFFFFFF

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


def lightning_times(t0: float, t1: float) -> list[float]:
    out = []
    k0, k1 = int(math.floor(t0 / 1.7)), int(math.floor(t1 / 1.7)) + 1
    for k in range(k0, k1):
        r = mulberry32(k * 7 + 3)()
        if r > 0.55:
            t = k * 1.7 + r * 1.0
            if t0 <= t < t1:
                out.append(t)
    return out


# ----------------------------------------------------------------- müzik parçaları (D minör)
ROOT = 38  # D2


def saw_stack(freqs, dur, detune=0.08, bright=14):
    n = _n(dur); t = _t(n)
    out = np.zeros(n)
    for f in freqs:
        for d in (-detune, 0, detune):
            ff = f * 2 ** (d / 12)
            for k in range(1, bright + 1):
                if ff * k > SR * 0.4:
                    break
                out += np.sin(2 * np.pi * ff * k * t + k * 1.3 + d * 7) / k
    return out / (len(freqs) * 3)


def braam(dur=2.8, root=ROOT - 12, power=1.0):
    """Sinematik bas vurgusu: dedektörlü testere yığını + açılan filtre."""
    n = _n(dur); t = _t(n)
    x = saw_stack([midi_hz(root), midi_hz(root + 7), midi_hz(root + 12), midi_hz(root + 15)], dur, 0.12, 18)
    # zamanla değişen alçak geçiren (blok tabanlı)
    out = np.zeros(n); blk = 512
    from scipy.signal import butter, sosfilt
    zi = None
    for i in range(0, n, blk):
        k = i / n
        fc = 180 + 1600 * math.exp(-k * 3.5) * min(1, k * 25 + 0.05)
        sos = butter(2, fc, btype="low", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + blk], zi = sosfilt(sos, x[i:i + blk], zi=zi)
    env = np.minimum(1, t / 0.03) * np.exp(-t * 1.1)
    sub = np.sin(2 * np.pi * midi_hz(root - 12) * t) * np.exp(-t * 1.4)
    y = soft_clip((out * 2.2 + sub * 0.8) * env * power, 1.8)
    return reverb(pan(y, np.sin(t * 2) * 0.15), 0.45, 3.2, 3000)


def drone(dur, root=ROOT, dark=1.0, seed=0):
    n = _n(dur); t = _t(n)
    out = np.zeros((n, 2))
    for i, (m, g) in enumerate([(root, 1.0), (root + 7, 0.6), (root + 12, 0.45), (root + 15, 0.25 * dark)]):
        f = midi_hz(m)
        for d, p in ((-0.06, -0.7), (0.06, 0.7)):
            ff = f * 2 ** (d / 12)
            ph = 2 * np.pi * ff * t + i
            v = np.sin(ph) + 0.3 * np.sin(2 * ph + 0.5) + 0.12 * np.sin(3 * ph + 1.1)
            v *= 0.55 + 0.45 * np.sin(2 * np.pi * (0.07 + 0.03 * i) * t + seed + i)
            out += pan(v * g * 0.06, p)
    return lp(out, 1400 if dark else 2600, 2)


def pluck(f, dur=0.5, bright=8, decay=7.0):
    return S._pluck(f, dur, bright, decay)


def music_box(f, dur=2.0):
    n = _n(dur); t = _t(n)
    mod = np.sin(2 * np.pi * f * 4.0 * t) * 1.6 * np.exp(-t * 6)
    x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 2.4) + 0.3 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 5)
    return x * np.minimum(1, t / 0.002) * 0.25


def tom(f=70, dur=1.2):
    n = _n(dur); t = _t(n)
    x = np.sin(2 * np.pi * np.cumsum(f + f * 1.5 * np.exp(-t * 18)) / SR) * np.exp(-t * 4.5)
    x += bp(white(n), 200, 1200) * np.exp(-t * 40) * 0.3
    return soft_clip(x * 1.2, 1.4)


def heartbeat(dur=0.8):
    n = _n(dur); t = _t(n)
    out = np.zeros(n)
    for d, a in ((0.0, 1.0), (0.22, 0.7)):
        i = _n(d); m = n - i; tt = t[:m]
        out[i:] += np.sin(2 * np.pi * np.cumsum(42 + 40 * np.exp(-tt * 30)) / SR) * np.exp(-tt * 16) * a
    return lp(out, 220, 2) * 1.6


def tick(f=3200, dur=0.05, a=0.35):
    n = _n(dur); t = _t(n)
    return (np.sin(2 * np.pi * f * t) * 0.6 + hp(white(n), 4000) * 0.5) * np.exp(-t * 140) * a


def render_score(timeline) -> tuple[np.ndarray, np.ndarray]:
    """(müzik, vurmalı) stereo."""
    dur = timeline["meta"]["duration"]
    bpm = timeline["meta"].get("bpm", 84)
    beat = 60 / bpm
    n = _n(dur + 4)
    mus = np.zeros((n, 2)); perc = np.zeros((n, 2))
    segs = timeline["segments"]
    motif = [ROOT + 24, ROOT + 31, ROOT + 27, ROOT + 26, ROOT + 24, ROOT + 19]  # D4 A4 F4 E4 D4 A3
    ost = [ROOT + 12, ROOT + 15, ROOT + 19, ROOT + 15]  # D3 F3 A3 F3
    for si, s in enumerate(segs):
        a, b = s["start"], s["end"]
        mood = s.get("mood", "calm")
        L = b - a
        # drone her zaman (ruh hâline göre seviye)
        g = {"calm": 0.8, "tension": 1.0, "reveal": 1.1, "fact": 0.7, "triumph": 0.6, "cliff": 0.9}.get(mood, 0.8)
        root = ROOT + (5 if mood == "triumph" else 0)
        dr = drone(L + 0.6, root, dark=0.0 if mood == "triumph" else 1.0, seed=si)
        add_at(mus, fade(dr, 0.25, 0.4), a - 0.1, g)
        # ızgaraya oturtulmuş vuruşlar
        first = math.ceil(a / (beat / 2) - 1e-6) * (beat / 2)
        tt = first
        i = 0
        while tt < b - 0.02:
            step = int(round(tt / (beat / 2)))
            if mood in ("tension", "reveal", "cliff"):
                # saat-tik ostinato (8'likler) + nabız bas
                m = ost[step % 4] + (12 if mood == "reveal" and step % 8 >= 4 else 0)
                add_at(mus, pan(pluck(midi_hz(m), 0.4, 7, 9), 0.3 * math.sin(step)), tt, 0.13)
                if step % 2 == 0:
                    add_at(mus, stereo(S._bass(midi_hz(root), beat * 0.45)), tt, 0.2)
                add_at(perc, stereo(tick(2800 if step % 2 else 3600, 0.05, 0.25)), tt, 0.5)
                if mood == "reveal" and step % 4 == 0:
                    add_at(perc, stereo(tom(62 if step % 8 == 0 else 78)), tt, 0.5)
            elif mood == "calm":
                if step % 3 == 0:
                    m = motif[(step // 3) % len(motif)]
                    add_at(mus, reverb(pan(music_box(midi_hz(m)), 0.25 * math.sin(step * 1.3)), 0.5, 2.5), tt, 0.4)
            elif mood == "fact":
                if step % 2 == 0:
                    m = [ROOT + 36, ROOT + 43, ROOT + 39, ROOT + 41][(step // 2) % 4]
                    add_at(mus, reverb(pan(music_box(midi_hz(m), 1.6), 0.5 * math.sin(step)), 0.55, 3.0), tt, 0.28)
                add_at(perc, stereo(tick(5200, 0.03, 0.12)), tt, 0.4)
            elif mood == "triumph":
                chord = [root + 12, root + 16, root + 19, root + 24]
                m = chord[step % 4] + (12 if step % 8 >= 4 else 0)
                add_at(mus, pan(pluck(midi_hz(m + 12), 0.5, 10, 6), 0.4 * math.sin(step)), tt, 0.14)
                if step % 2 == 0:
                    add_at(perc, stereo(S._kick()), tt, 0.5)
                    add_at(mus, stereo(S._bass(midi_hz(root), beat * 0.45)), tt, 0.25)
                if step % 4 == 2:
                    add_at(perc, reverb(S._clap(), 0.25, 1.2), tt, 0.5)
            tt += beat / 2
            i += 1
        # sahne başında vurgu
        if mood in ("reveal",) or si == 0:
            add_at(mus, braam(3.0, ROOT - 12, 0.9), a + 0.02, 0.55)
        if mood == "cliff":
            # gerilim yükselir, sonra her şey susar: sub-drop + tek nota + tik-tak
            cg = next((g_ for g_ in s.get("gfx", []) if g_.get("type") == "cliff"), None)
            hit = cg["t0"] if cg else b - 2.5
            add_at(mus, S.sfx_riser(1.6, 3000), hit - 1.6, 0.5)
            add_at(mus, braam(3.5, ROOT - 12, 1.2), hit, 0.75)
            for k in range(8):
                add_at(perc, stereo(tick(1800 if k % 2 else 2400, 0.06, 0.4)), hit + 0.6 + k * 0.5, 0.6 * (1 - k / 9))
    return mus[: _n(dur)], perc[: _n(dur)]


# ----------------------------------------------------------------- atmosfer
def waves(dur, amp=1.0, seed=1):
    n = _n(dur); t = _t(n)
    rng = np.random.default_rng(seed)
    out = np.zeros((n, 2))
    for c in range(2):
        nz = pink(n)
        sw = np.zeros(n)
        for k in range(4):
            f = rng.uniform(0.07, 0.16); ph = rng.uniform(0, 6)
            sw += np.maximum(0, np.sin(2 * np.pi * f * t + ph)) ** 3
        sw = 0.35 + sw / 2.2
        body = bp(nz, 200, 1600) * sw * 0.5 + lp(nz, 250) * sw * 0.6 + hp(nz, 3000) * sw ** 2 * 0.12
        out[:, c] = body
    return out * 0.6 * amp


def lapping(dur, seed=2):
    """Tekne gövdesine vuran küçük dalgalar."""
    rng = np.random.default_rng(seed)
    out = np.zeros((_n(dur), 2))
    for st in np.arange(0.1, dur, 0.55):
        st += rng.uniform(-0.15, 0.15)
        d = rng.uniform(0.25, 0.45); m = _n(d); tt = _t(m)
        x = bp(white(m), rng.uniform(250, 500), rng.uniform(900, 1800)) * np.sin(np.pi * tt / d) ** 2 * np.exp(-tt * 3)
        x += np.sin(2 * np.pi * rng.uniform(90, 140) * tt) * np.exp(-tt * 20) * 0.3
        add_at(out, pan(x, rng.uniform(-0.5, 0.5)), st, rng.uniform(0.25, 0.5))
    return out


def wind(dur, amount=1.0, seed=3, howl=False):
    n = _n(dur); t = _t(n)
    rng = np.random.default_rng(seed)
    out = np.zeros((n, 2))
    for c in range(2):
        f0 = rng.uniform(300, 500)
        x = sweep_bp(pink(n), f0, f0 * rng.uniform(1.5, 2.5), q=2.5)
        mod = 0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.05, 0.12) * t + rng.uniform(0, 6))
        out[:, c] = x * mod * 0.5
    if howl:
        f = 420 + 180 * np.sin(2 * np.pi * 0.09 * t) + 60 * np.sin(2 * np.pi * 0.31 * t)
        hw = bp(white(n), 300, 900) * 0.3 + np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.03
        out += stereo(hw * (0.4 + 0.6 * np.sin(2 * np.pi * 0.13 * t) ** 2))
    return out * amount


def gull_call(seed=0):
    rng = np.random.default_rng(seed)
    out = np.zeros(_n(1.4))
    pos = 0.0
    for k in range(rng.integers(2, 5)):
        d = rng.uniform(0.18, 0.32); m = _n(d); tt = _t(m)
        f0 = rng.uniform(1300, 1900)
        f = f0 * (1 + 0.35 * np.sin(np.pi * tt / d)) * (1 - 0.25 * tt / d)
        ph = 2 * np.pi * np.cumsum(f) / SR
        x = (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)) * np.sin(np.pi * tt / d) ** 0.7
        x = bp(x + bp(white(m), 1500, 4000) * 0.08, 800, 5000)
        i = _n(pos)
        out[i:i + m] += x[: len(out) - i] * 0.25
        pos += d + rng.uniform(0.04, 0.12)
        if pos > 1.2:
            break
    return out


def creak(seed=0):
    rng = np.random.default_rng(seed)
    d = rng.uniform(0.4, 0.8); n = _n(d); t = _t(n)
    rate = 40 + 40 * np.sin(np.pi * t / d) + rng.uniform(-5, 5)
    ph = np.cumsum(rate) / SR
    imp = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)
    x = bp(imp, rng.uniform(300, 500), rng.uniform(900, 1400), 4) * np.sin(np.pi * t / d) * 6
    return x


def rain(dur, amount=1.0):
    n = _n(dur)
    x = np.stack([hp(white(n), 2500), hp(white(n), 2500)], axis=1) * 0.12
    rng = np.random.default_rng(9)
    drops = np.zeros((n, 2))
    idx = rng.integers(0, n, int(dur * 900))
    drops[idx, rng.integers(0, 2, len(idx))] = rng.uniform(0.2, 1.0, len(idx))
    drops = np.stack([bp(drops[:, 0], 2000, 9000), bp(drops[:, 1], 2000, 9000)], axis=1) * 0.5
    return (x + drops) * amount


def thunder(dur=4.0, seed=0, near=1.0):
    rng = np.random.default_rng(seed)
    n = _n(dur); t = _t(n)
    crack = bp(white(n), 800, 6000) * np.exp(-t * 18) * near
    roll = lp(brown(n) * 8, 180, 2) * (np.exp(-t * 0.9) * (1 + 0.6 * np.sin(2 * np.pi * 3 * t + rng.uniform(0, 6))))
    rumble = lp(white(n), 120, 2) * np.exp(-t * 1.3) * 2
    x = soft_clip(crack + roll * 1.4 + rumble, 1.3)
    return reverb(pan(x, rng.uniform(-0.4, 0.4)), 0.5, 3.5, 2500)


def babble(dur, voices=10, seed=4):
    """Kalabalık uğultusu: formant benzeri bant gürültüleri + rastgele hece zarfları."""
    n = _n(dur); t = _t(n)
    rng = np.random.default_rng(seed)
    out = np.zeros((n, 2))
    for v in range(voices):
        f1 = rng.uniform(350, 800); f2 = rng.uniform(1100, 2200)
        src = bp(pink(n), f1 * 0.8, f1 * 1.2) + 0.6 * bp(pink(n), f2 * 0.85, f2 * 1.15)
        rate = rng.uniform(3, 5.5)
        env = np.maximum(0, np.sin(2 * np.pi * rate * t + rng.uniform(0, 6))) ** 2
        env *= np.maximum(0, np.sin(2 * np.pi * rng.uniform(0.08, 0.25) * t + rng.uniform(0, 6)))
        out += pan(src * env * 0.35, rng.uniform(-0.8, 0.8))
    return lp(out, 3500) * 0.8


def stadium(dur, swell=None):
    n = _n(dur); t = _t(n)
    x = np.stack([bp(pink(n), 250, 2500), bp(pink(n), 250, 2500)], axis=1) * 0.6
    env = 0.5 + 0.2 * np.sin(2 * np.pi * 0.2 * t)
    if swell is not None:
        env = env + swell
    return x * env[:, None]


def clock_ticks(dur, every=1.0):
    out = np.zeros((_n(dur), 2))
    k = 0
    for st in np.arange(0, dur, every):
        add_at(out, pan(bp(white(_n(0.04)), 1500, 5000) * np.exp(-_t(_n(0.04)) * 120) * 0.4, -0.3 if k % 2 else -0.2), st)
        k += 1
    return reverb(out, 0.3, 0.8)


def crickets(dur, seed=5):
    rng = np.random.default_rng(seed)
    out = np.zeros((_n(dur), 2))
    for st in np.arange(0, dur, 0.9):
        for c in range(3):
            d = 0.025; m = _n(d); tt = _t(m)
            x = np.sin(2 * np.pi * 4600 * tt) * np.sin(np.pi * tt / d) * 0.05
            add_at(out, pan(x, 0.6), st + c * 0.05 + rng.uniform(0, 0.05))
    return out


def room_tone(dur, f=180):
    n = _n(dur)
    return np.stack([lp(brown(n), f), lp(brown(n), f)], axis=1) * 1.2


def render_ambience(timeline) -> np.ndarray:
    dur = timeline["meta"]["duration"]
    n = _n(dur)
    out = np.zeros((n, 2))
    rng = np.random.default_rng(11)
    for si, s in enumerate(timeline["segments"]):
        a, b = s["start"], s["end"]
        L = b - a + 0.6
        st, tm = s.get("set", "sea"), s.get("time", "dawn")
        target = (s.get("shot") or {}).get("target")
        exterior = st in ("sea", "deck", "harbor") or (st == "lighthouse" and target == "lighthouse")
        x = np.zeros((_n(L), 2))
        if exterior:
            storm = tm == "storm"
            x += waves(L, 1.8 if storm else (0.9 if st == "harbor" else 1.0), seed=si)
            x += wind(L, 1.4 if storm else 0.35, seed=si + 7, howl=storm)
            if "searchboat" in (s.get("props") or []):
                x += stereo(boat_motor(L, si)) * 0.8
            if st in ("sea", "deck"):
                x += lapping(L, seed=si) * (0.6 if st == "deck" else 0.4)
                for k in range(int(L // 1.3)):
                    add_at(x, pan(creak(si * 10 + k), rng.uniform(-0.4, 0.4)), k * 1.3 + rng.uniform(0, 0.8), 0.3)
            if storm:
                x += rain(L, 1.0)
                for lt_ in lightning_times(a, b):
                    add_at(x, thunder(4.0, int(lt_ * 10), 1.0), lt_ - a + rng.uniform(0.05, 0.35), 0.9)
            elif tm in ("dawn", "day", "dusk") and "gulls" in (s.get("props") or []):
                for k in range(max(1, int(L // 1.8))):
                    add_at(x, pan(gull_call(si * 7 + k), rng.uniform(-0.8, 0.8)), rng.uniform(0, max(0.1, L - 1.2)), rng.uniform(0.35, 0.6))
            if tm == "night":
                x += crickets(L) * 0.4
        elif st == "coffeehouse":
            x += babble(L, 12, si) * 0.9 + room_tone(L) * 0.6
            x += stadium(L) * 0.25
            for k in range(int(L // 1.6)):
                add_at(x, pan(S.sfx_tick(rng.uniform(3500, 5200), 0.08) * 0.8, rng.uniform(-0.6, 0.6)), rng.uniform(0, L), 0.5)  # çay kaşığı
        elif st == "kiosk":
            x += room_tone(L) * 0.8 + babble(L, 3, si) * 0.2 + waves(L, 0.25, si)
        elif st == "home":
            x += room_tone(L, 140) * 0.7 + clock_ticks(L) * 0.9
            if tm == "night":
                x += crickets(L) * 0.5
        elif st == "lighthouse":
            x += room_tone(L, 120) * 0.6 + wind(L, 0.9, si, howl=True) * 0.6 + lp(rain(L, 0.8), 2500) * 0.6
            for lt_ in lightning_times(a, b):
                add_at(x, lp(thunder(4.0, int(lt_ * 10), 0.5), 900), lt_ - a + 0.3, 0.7)
        elif st == "depot":
            x += room_tone(L, 120) * 0.8 + lp(waves(L, 0.3, si), 600) * 0.6
            for k in range(int(L // 2.3)):  # damlalar
                add_at(x, pan(tick(rng.uniform(1200, 2200), 0.08, 0.25), rng.uniform(-0.7, 0.7)), rng.uniform(0, L), 0.5)
            if s.get("lights") != "off":
                x += stereo(fluorescent_hum(L)) * 0.6
        elif st == "shop":
            x += room_tone(L, 160) * 0.5 + stereo(fluorescent_hum(L)) * 0.9 + babble(L, 2, si) * 0.12
        elif st == "factory":
            x += room_tone(L, 110) * 0.6 + wind(L, 0.8, si, howl=True) * 0.5
            for k in range(int(L // 1.9)):
                add_at(x, pan(tick(rng.uniform(900, 1600), 0.1, 0.3), rng.uniform(-0.8, 0.8)), rng.uniform(0, L), 0.4)
            if s.get("time") == "storm":
                x += lp(rain(L, 0.6), 2000) * 0.5
        elif st in ("void", "black"):
            tt = _t(_n(L))
            sub = np.sin(2 * np.pi * 41.2 * tt) * 0.15 * (0.7 + 0.3 * np.sin(2 * np.pi * 0.2 * tt))
            x += stereo(sub) + np.stack([hp(pink(_n(L)), 6000), hp(pink(_n(L)), 6000)], axis=1) * 0.01
        add_at(out, fade(x, 0.15, 0.35), a - 0.15, 1.0)
    return out


# ----------------------------------------------------------------- efektler
def paper_rustle(dur=0.9, seed=0):
    rng = np.random.default_rng(seed)
    n = _n(dur); t = _t(n)
    env = np.zeros(n)
    for _ in range(int(dur * 18)):
        i = rng.integers(0, n); m = _n(rng.uniform(0.01, 0.05))
        env[i:i + m] += rng.uniform(0.3, 1.0) * np.exp(-_t(min(m, n - i)) * 60)
    x = bp(white(n), 1800, 9000) * env + bp(white(n), 400, 1500) * env * 0.3
    return reverb(x * 0.5, 0.15, 0.6)


def glass_clink(seed=0):
    rng = np.random.default_rng(seed)
    n = _n(1.5); t = _t(n)
    x = np.zeros(n)
    for f, a, d in ((2350, 0.5, 4), (3610, 0.3, 6), (5180, 0.2, 9), (1480, 0.25, 3)):
        x += np.sin(2 * np.pi * f * rng.uniform(0.98, 1.02) * t) * np.exp(-t * d) * a
    x += hp(white(n), 5000) * np.exp(-t * 200) * 0.3
    return reverb(x * 0.4, 0.3, 1.5)


def cork_pop():
    n = _n(0.25); t = _t(n)
    x = np.sin(2 * np.pi * np.cumsum(420 + 700 * np.exp(-t * 40)) / SR) * np.exp(-t * 30)
    x += bp(white(n), 800, 4000) * np.exp(-t * 80) * 0.5
    return x * 0.5


def knock():
    n = _n(0.35); t = _t(n)
    x = np.sin(2 * np.pi * 160 * t) * np.exp(-t * 30) + bp(white(n), 300, 1500) * np.exp(-t * 60) * 0.6
    x += np.sin(2 * np.pi * 95 * t) * np.exp(-t * 18) * 0.5
    return reverb(soft_clip(x * 1.4, 1.3), 0.35, 1.2, 2500)


def _stamp():
    n = _n(0.9); t = _t(n)
    thud = np.sin(2 * np.pi * np.cumsum(70 + 120 * np.exp(-t * 35)) / SR) * np.exp(-t * 12)
    slap = bp(white(n), 600, 5000) * np.exp(-t * 55) * 0.7
    return reverb(soft_clip((thud + slap) * 1.2, 1.4), 0.3, 1.4, 3000)


def typewriter(count, cadence=0.045, seed=0):
    rng = np.random.default_rng(seed)
    out = np.zeros((_n(count * cadence + 0.3), 2))
    for i in range(count):
        m = _n(0.03); tt = _t(m)
        x = (bp(white(m), 1500, 6000) * 0.6 + np.sin(2 * np.pi * rng.uniform(1800, 2600) * tt) * 0.3) * np.exp(-tt * 180)
        add_at(out, pan(x, rng.uniform(-0.2, 0.2)), i * cadence + rng.uniform(0, 0.01), 0.5)
    return out


def counter_ticks(dur, n_ticks=24):
    out = np.zeros((_n(dur + 0.5), 2))
    for i in range(n_ticks):
        k = i / max(1, n_ticks - 1)
        tt = dur * (1 - (1 - k) ** 2)  # outQuad aralıkları (sayaç yavaşlar)
        add_at(out, stereo(tick(2400 + 1600 * k, 0.04, 0.3)), tt)
    return out


def referee_whistle(dur=0.9):
    n = _n(dur); t = _t(n)
    f = 2900 + 120 * np.sin(2 * np.pi * 28 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.6 + 0.4 * (np.sin(2 * np.pi * 28 * t) > 0))
    x += bp(white(n), 2500, 4000) * 0.2
    return x * np.minimum(1, t / 0.02) * np.exp(-np.maximum(0, t - dur * 0.7) * 20) * 0.25


def phone_buzz(dur=0.9):
    """Telefon titreşimi: 2 kısa vızıltı (masada tıkırdayan rezonans)."""
    out = np.zeros(_n(dur))
    for st in (0.0, 0.42):
        m = _n(0.32); tt = _t(m)
        mot = np.sign(np.sin(2 * np.pi * 172 * tt)) * 0.5 + np.sin(2 * np.pi * 344 * tt) * 0.3
        env = np.minimum(1, tt / 0.01) * np.minimum(1, (0.32 - tt) / 0.03)
        x = bp(mot * env, 120, 2400) + bp(white(m), 2000, 5000) * env * 0.05
        i = _n(st)
        if i < len(out): out[i:i + m] += x[: len(out) - i]
    return out * 0.6


def notify_chime():
    out = np.zeros(_n(0.9))
    for k, (m, d) in enumerate(((88, 0.0), (93, 0.11))):
        mm = _n(0.7); tt = _t(mm)
        f = midi_hz(m)
        x = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 2 * tt)) * np.exp(-tt * 7) * 0.25
        i = _n(d)
        if i < len(out): out[i:i + mm] += x[: len(out) - i]
    return reverb(out, 0.2, 0.8)


def msg_sent():
    n = _n(0.35); tt = _t(n)
    f = 500 + 1400 * (tt / 0.35)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 14) * 0.25 + bp(white(n), 2000, 7000) * np.exp(-tt * 30) * 0.08
    return x


def msg_recv():
    out = np.zeros(_n(0.6))
    for k, m in enumerate((84, 88, 91)):
        mm = _n(0.25); tt = _t(mm)
        x = np.sin(2 * np.pi * midi_hz(m) * tt) * np.exp(-tt * 16) * 0.22
        i = _n(k * 0.085)
        if i < len(out): out[i:i + mm] += x[: len(out) - i]
    return out


def footsteps(dur=2.4, rate=0.55, seed=0, hard=True):
    rng = np.random.default_rng(seed)
    out = np.zeros((_n(dur), 2))
    for k, st in enumerate(np.arange(0, dur - 0.2, rate)):
        m = _n(0.18); tt = _t(m)
        x = bp(white(m), 120 if hard else 80, 1800 if hard else 900) * np.exp(-tt * 38) + np.sin(2 * np.pi * rng.uniform(70, 110) * tt) * np.exp(-tt * 30) * 0.6
        add_at(out, pan(x * 0.7, (-0.3 if k % 2 else 0.3)), st + rng.uniform(0, 0.03))
    return reverb(out, 0.4, 1.6, 3000)


def door_creak(dur=1.6, seed=1):
    rng = np.random.default_rng(seed)
    n = _n(dur); t = _t(n)
    rate = 25 + 60 * np.sin(np.pi * t / dur) ** 2 + 10 * np.sin(2 * np.pi * 3 * t)
    ph = np.cumsum(rate) / SR
    imp = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)
    x = bp(imp, 400, 1600, 4) * 8 * np.sin(np.pi * t / dur) + bp(imp, 1800, 3200, 2) * 2
    return reverb(x * 0.6, 0.35, 1.8, 3500)


def power_down():
    n = _n(1.4); t = _t(n)
    f = 120 * np.exp(-t * 2.2) + 20
    hum = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.5) * 0.4
    clunk = bp(white(n), 80, 900) * np.exp(-t * 30) * 0.8
    return reverb(hum + clunk, 0.3, 1.5, 2500)


def boat_motor(dur, seed=0):
    n = _n(dur); t = _t(n)
    f = 38 + 4 * np.sin(2 * np.pi * 0.3 * t)
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.4 + np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * 0.3
    x = lp(x, 500) + bp(white(n), 300, 1500) * 0.15
    return x * np.minimum(1, t / max(0.1, dur)) ** 2


def crash():
    n = _n(2.5); t = _t(n)
    wood = bp(white(n), 300, 3000) * np.exp(-t * 9) * 1.2
    thud = np.sin(2 * np.pi * np.cumsum(50 + 80 * np.exp(-t * 20)) / SR) * np.exp(-t * 6)
    splash = lp(white(n), 3000) * np.exp(-np.maximum(0, t - 0.15) * 3) * (t > 0.15) * 0.8
    return reverb(soft_clip(wood + thud + splash, 1.4), 0.4, 2.0, 3000)


def fluorescent_hum(dur):
    n = _n(dur); t = _t(n)
    x = np.sin(2 * np.pi * 100 * t) * 0.03 + np.sin(2 * np.pi * 200 * t) * 0.015 + bp(white(n), 3000, 8000) * 0.004
    return x


def render_sfx(timeline) -> np.ndarray:
    dur = timeline["meta"]["duration"]
    out = np.zeros((_n(dur + 3), 2))
    segs = timeline["segments"]
    for k, s in enumerate(segs):
        b = s["start"]
        if k > 0:
            up = k % 2 == 0
            add_at(out, S.sfx_whoosh(0.7, up=up, pan_from=-0.8 if up else 0.8, pan_to=0.8 if up else -0.8), b - 0.5, 0.55)
            add_at(out, S.sfx_impact(0.7, 1.2), b, 0.35)
        props = s.get("props") or []
        if "bottle" in props and s.get("set") in ("deck", "sea"):
            add_at(out, glass_clink(k), b + 0.35, 0.6)
        if "coupon_unroll" in props:
            add_at(out, stereo(paper_rustle(1.3, k)), b + 0.15, 0.9)
        if "coupon_back" in props:
            add_at(out, stereo(paper_rustle(0.6, k + 3)), b + 0.05, 0.7)
        if s.get("set") == "void":
            add_at(out, S.sfx_sparkle(1.6, k), b + 0.05, 0.4)
        for g in s.get("gfx") or []:
            t0 = g["t0"]; ty = g["type"]
            if ty == "title":
                add_at(out, S.sfx_riser(1.2, 3600), t0 - 1.15, 0.4)
                add_at(out, braam(2.6, ROOT - 12, 1.0), t0 + 0.05, 0.5)
                add_at(out, S.sfx_sparkle(1.4, 2), t0 + 0.3, 0.4)
            elif ty == "chapter":
                add_at(out, typewriter(len(g.get("text", ""))), t0, 0.7)
            elif ty == "label":
                add_at(out, S.sfx_pop(900), t0 + 0.02, 0.5)
                add_at(out, S.sfx_whoosh(0.3, up=True, pan_from=0, pan_to=0.5, bright=1.6), t0 + 0.2, 0.25)
            elif ty == "stamp":
                add_at(out, _stamp(), t0 + 0.2, 0.8)
            elif ty == "fact":
                add_at(out, S.sfx_whoosh(0.5, up=True, pan_from=-0.3, pan_to=0.3, bright=1.3), t0 - 0.3, 0.4)
                add_at(out, S.sfx_ding(), t0 + 0.2, 0.6)
                add_at(out, counter_ticks(1.1, 14), t0 + 0.25, 0.5)
            elif ty == "quote":
                add_at(out, stereo(paper_rustle(0.5, 9)), t0, 0.5)
                add_at(out, typewriter(len(g.get("text", "")) // 2, 0.06, 4) * 0.4, t0 + 0.15, 0.4)
            elif ty == "counter":
                d = min(g.get("dur", 2.0) * 0.7, 2.6)
                add_at(out, counter_ticks(d, 26), t0, 0.6)
                add_at(out, S.sfx_ding(), t0 + d, 0.6)
            elif ty == "score":
                if (g.get("a", 0) or g.get("b", 0)):
                    add_at(out, referee_whistle(), t0 - 0.2, 0.5)
                    n2 = _n(4.0); sw = np.concatenate([np.linspace(0, 1.6, _n(0.3)), np.linspace(1.6, 0.6, n2 - _n(0.3))])
                    add_at(out, stadium(4.0, sw), t0, 0.6)
                else:
                    add_at(out, S.sfx_pop(700), t0, 0.4)
            elif ty == "cliff":
                add_at(out, S.sfx_whoosh(0.8, up=False, pan_from=0.6, pan_to=-0.6), t0 - 0.6, 0.5)
            elif ty == "notify":
                add_at(out, stereo(phone_buzz()), t0, 0.9)
                add_at(out, stereo(notify_chime()), t0 + 0.05, 0.6)
            elif ty == "chat":
                if g.get("from") == "me":
                    add_at(out, stereo(msg_sent()), t0, 0.7)
                else:
                    add_at(out, stereo(phone_buzz(0.4)), t0 - 0.05, 0.5)
                    add_at(out, stereo(msg_recv()), t0, 0.7)
            elif ty == "hook":
                add_at(out, braam(2.4, ROOT - 12, 0.9), t0 + 0.02, 0.5)
            elif ty == "peephole":
                add_at(out, S.sfx_whoosh(0.5, up=True, pan_from=0, pan_to=0, bright=0.6), t0 - 0.3, 0.4)
            elif ty == "cctv":
                add_at(out, stereo(bp(white(_n(0.3)), 1000, 8000) * 0.2), t0, 0.6)  # parazit
                add_at(out, stereo(fluorescent_hum(max(0.5, g["t1"] - t0))), t0, 0.8)
            elif ty == "live":
                for k in range(len(g.get("comments") or [])):
                    add_at(out, stereo(msg_recv()), t0 + 0.7 * (k + 1), 0.35)
                n2 = _n(max(1.0, g["t1"] - t0)); sw = np.linspace(0.2, 1.2, n2)
                add_at(out, stadium(max(1.0, g["t1"] - t0), sw) * 0.4, t0, 0.4)
            elif ty == "clock":
                for k in range(4):
                    add_at(out, stereo(tick(2000, 0.05, 0.4)), t0 + k * 0.5, 0.6)
            elif ty == "next":
                add_at(out, braam(3.0, ROOT - 12, 1.1), t0, 0.6)
    for c in timeline.get("cues", []):
        ty, t = c["type"], c["t"]
        if ty == "heartbeat":
            per = 0.82
            for k in range(int(c.get("dur", 2.0) / per) + 1):
                add_at(out, stereo(heartbeat()), t + k * per, 0.9)
        elif ty == "knock":
            for k in range(3):
                add_at(out, knock(), t + k * 0.32, 0.9)
        elif ty == "shake":
            add_at(out, S.sfx_impact(1.2, 1.6), t, 0.6)
        elif ty == "flash":
            add_at(out, S.sfx_sparkle(1.2, 9), t, 0.4)
            add_at(out, S.sfx_impact(0.9, 1.2), t, 0.35)
        elif ty == "vibrate":
            add_at(out, stereo(phone_buzz()), t, 1.0)
        elif ty == "footsteps":
            add_at(out, footsteps(c.get("dur", 2.4), 0.5, int(t)), t, 0.8)
        elif ty == "creak":
            add_at(out, stereo(door_creak()), t, 0.8)
        elif ty == "lightsout":
            add_at(out, stereo(power_down()), t, 0.9)
        elif ty == "crash":
            add_at(out, crash(), t, 1.0)
            add_at(out, S.sfx_impact(1.4, 1.6), t, 0.7)
        elif ty == "splash":
            add_at(out, S.sfx_splash(), t, 0.9)
    return out[: _n(dur)]


# ----------------------------------------------------------------- miks
def design_story_audio(timeline: dict, placements, out_dir: Path, write_wav, loudnorm) -> Path:
    dur = timeline["meta"]["duration"]
    n = _n(dur)
    print("[ses] seslendirme yerleştiriliyor", flush=True)
    vox = np.zeros(n)
    for off, clip in placements:
        i = int(off * SR); a = clip.audio
        j = min(n, i + len(a))
        if i < n:
            vox[max(0, i):j] += a[max(0, -i): j - i]
    silent = (timeline["meta"].get("voice") or {}).get("engine") == "none"
    if silent:
        vox = np.zeros(n)
        vox_st = np.zeros((n, 2))
    else:
        vox_st = S.process_voice(vox)
    print("[ses] müzik besteleniyor", flush=True)
    mus, perc = render_score(timeline)
    print("[ses] atmosfer + efektler", flush=True)
    amb = render_ambience(timeline)
    sfx = render_sfx(timeline)
    env = S.envelope_follow(vox, 0.03, 0.45)
    thr = np.percentile(env[env > 1e-4], 60) if np.any(env > 1e-4) else 0.05
    duck = 1 - 0.5 * np.clip(env / (thr + 1e-9), 0, 1)
    music_bus = mus * duck[:, None] * 0.55 + perc * (0.65 + 0.35 * duck)[:, None] * 0.4
    amb_bus = amb * (0.55 + 0.45 * duck)[:, None] * 0.45
    sfx_bus = sfx * 0.6
    mix = vox_st + music_bus + amb_bus + sfx_bus
    mix = S.hp(mix, 28, 2)
    fi = _n(0.12); mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    fo = _n(0.5); mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
    mix = S.limiter(mix * 0.9, 0.9)
    raw = out_dir / "audio_raw.wav"
    write_wav(raw, mix)
    stems = out_dir / "stems"; stems.mkdir(exist_ok=True)
    write_wav(stems / "voice.wav", np.clip(vox_st, -1, 1))
    write_wav(stems / "music.wav", np.clip(music_bus, -1, 1))
    write_wav(stems / "sfx.wav", np.clip(sfx_bus + amb_bus, -1, 1))
    final = out_dir / "audio.wav"
    loudnorm(raw, final)
    return final
