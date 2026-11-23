"""Kodla sentezlenen ses tasarımı.

Hiçbir hazır örnek (sample) kullanılmaz; her şey numpy ile üretilir:
  • Müzik: pluck arpej (eklemeli sentez), pad (dedektörlü testere), bas, kick/clap/hi-hat
  • Atmosfer: alçak geçiren kahverengi gürültü + LFO dalgalanması + uzak kabarcıklar
  • SFX: whoosh, impact, riser, pop, sparkle, kabarcık, rüya dalgası, ding
  • Miks: ses ducking (sidechain), kick pompalama, sentetik reverb, limiter
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve, lfilter

SR = 48000
RNG = np.random.default_rng(1234)


# ----------------------------------------------------------------- temel DSP
def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n: int, a: float, d: float, s: float, r: float, hold: float | None = None) -> np.ndarray:
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    H = n - A - D - R if hold is None else int(hold * SR)
    H = max(0, H)
    e = np.concatenate([
        np.linspace(0, 1, max(1, A), endpoint=False),
        np.linspace(1, s, max(1, D), endpoint=False),
        np.full(H, s),
        np.linspace(s, 0, max(1, R)),
    ])
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e[:n]


def exp_decay(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n) / (tau * SR))


def bp(x, lo, hi, order=2):
    lo = max(20, lo); hi = min(SR / 2 * 0.95, hi)
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR / 2 * 0.95), btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, max(10, f), btype="high", fs=SR, output="sos"), x)


def white(n):
    return RNG.standard_normal(n).astype(np.float64)


def pink(n):
    # Voss benzeri: beyaz gürültüye 1/f filtre (Paul Kellet yaklaşımı)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return lfilter(b, a, white(n)) * 6


def brown(n):
    x = np.cumsum(white(n)) * 0.02
    return hp(x, 15, 1)


def sweep_bp(x: np.ndarray, f0: float, f1: float, q: float = 1.2, block: int = 256) -> np.ndarray:
    """Merkez frekansı üstel olarak kayan bant geçiren (blok tabanlı)."""
    out = np.zeros_like(x)
    n = len(x)
    nb = max(1, n // block)
    zi = None
    sos_prev = None
    for i in range(nb + 1):
        a, b = i * block, min(n, (i + 1) * block)
        if a >= b:
            break
        k = a / max(1, n - 1)
        fc = f0 * (f1 / f0) ** k
        bw = fc / q
        sos = butter(2, [max(30, fc - bw / 2), min(SR * 0.45, fc + bw / 2)], btype="band", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[a:b], zi = sosfilt(sos, x[a:b], zi=zi)
        sos_prev = sos
    return out


def pan(x: np.ndarray, p: float | np.ndarray) -> np.ndarray:
    """p: -1 (sol) .. +1 (sağ), eşit güç."""
    ang = (np.asarray(p) + 1) * math.pi / 4
    return np.stack([x * np.cos(ang), x * np.sin(ang)], axis=1)


def stereo(x: np.ndarray) -> np.ndarray:
    return np.stack([x, x], axis=1) if x.ndim == 1 else x


def make_ir(dur: float = 2.4, predelay: float = 0.018, damp: float = 6000, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 6.9 / dur)
    ir = np.zeros((n + int(predelay * SR), 2))
    for c in range(2):
        nz = rng.standard_normal(n) * env
        nz = lp(nz, damp * (1 if c == 0 else 0.93), 1)
        # erken yansımalar
        for k in range(8):
            d = int(rng.uniform(0.004, 0.06) * SR)
            if d < n:
                nz[d] += rng.uniform(0.3, 0.7) * (1 if rng.random() > 0.5 else -1)
        ir[int(predelay * SR):, c] = nz
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir


_IR_CACHE: dict = {}


def reverb(x: np.ndarray, wet: float = 0.25, dur: float = 2.4, damp: float = 6000) -> np.ndarray:
    key = (round(dur, 2), int(damp))
    if key not in _IR_CACHE:
        _IR_CACHE[key] = make_ir(dur, damp=damp)
    ir = _IR_CACHE[key]
    x2 = stereo(x)
    out = np.zeros((len(x2) + len(ir) - 1, 2))
    for c in range(2):
        out[:, c] = fftconvolve(x2[:, c], ir[:, c])
    out = out[: len(x2)] * 0.35
    return x2 * (1 - wet * 0.5) + out * wet


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def add_at(buf: np.ndarray, x: np.ndarray, t: float, gain: float = 1.0):
    i = int(round(t * SR))
    x2 = stereo(x)
    if i < 0:
        x2 = x2[-i:]
        i = 0
    j = min(len(buf), i + len(x2))
    if j > i:
        buf[i:j] += x2[: j - i] * gain


# ----------------------------------------------------------------- SFX
def sfx_whoosh(dur=0.7, up=True, pan_from=-0.8, pan_to=0.8, bright=1.0) -> np.ndarray:
    n = int(dur * SR)
    x = pink(n)
    f0, f1 = (250, 4200 * bright) if up else (4200 * bright, 250)
    y = sweep_bp(x, f0, f1, q=1.4)
    t = np.linspace(0, 1, n)
    env = np.where(t < 0.65, (t / 0.65) ** 2.2, np.exp(-(t - 0.65) * 9))
    y *= env
    # alçak "hava" gövdesi
    body = lp(brown(n), 300) * env * 1.5
    tone = np.sin(2 * np.pi * np.cumsum(np.linspace(180, 90, n)) / SR) * env * 0.15
    mono = y + body + tone
    p = np.linspace(pan_from, pan_to, n)
    out = pan(mono, p)
    return reverb(out, 0.25, 1.4) * 0.9


def sfx_impact(power=1.0, dur=1.6) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 32 + 90 * np.exp(-t * 18)                    # pitch düşüşü
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.0)
    thump = np.sin(2 * np.pi * np.cumsum(55 + 160 * np.exp(-t * 40)) / SR) * np.exp(-t * 14)
    click = hp(white(n), 2500) * np.exp(-t * 120) * 0.5
    crack = bp(white(n), 700, 4000) * np.exp(-t * 22) * 0.35
    x = soft_clip((sub * 1.0 + thump * 0.8 + click + crack) * power, 1.6)
    return reverb(x, 0.3, 2.2, 3500) * 0.9


def sfx_riser(dur=1.8, top=3800) -> np.ndarray:
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    nz = sweep_bp(white(n), 300, top, q=2.0) * (t ** 2.5)
    f = 110 * 2 ** (t * 2.5)
    saw = np.zeros(n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    for k in range(1, 9):
        saw += np.sin(ph * k * 1.003) / k + np.sin(ph * k * 0.997) / k
    saw *= (t ** 2) * 0.12
    x = nz * 0.9 + saw
    out = pan(x, np.sin(t * 12) * 0.3)
    return reverb(out, 0.35, 2.0) * 0.8


def sfx_pop(freq=900, dur=0.18) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 1.8 * (1 - np.exp(-t * 60)))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)
    x += bp(white(n), 2000, 6000) * np.exp(-t * 200) * 0.25
    return reverb(x * 0.6, 0.2, 0.8)


def sfx_tick(freq=2400, dur=0.06) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 90) * 0.4


def sfx_bubbles(dur=1.2, count=14, f_lo=350, f_hi=1500, seed=3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    for _ in range(count):
        st = rng.uniform(0, dur * 0.75)
        f0 = rng.uniform(f_lo, f_hi)
        d = rng.uniform(0.04, 0.12)
        m = int(d * SR)
        tt = np.arange(m) / SR
        f = f0 * (1 + 2.2 * tt / d)
        b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * (6 / d)) * rng.uniform(0.2, 0.6)
        add_at(out, pan(b, rng.uniform(-0.7, 0.7)), st)
    return reverb(out, 0.3, 1.2, 4000)


def sfx_sparkle(dur=1.4, seed=5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    notes = [88, 91, 95, 100, 103, 107]
    for i in range(9):
        st = i * 0.045 + rng.uniform(0, 0.02)
        f = midi_hz(rng.choice(notes))
        m = int(0.9 * SR)
        tt = np.arange(m) / SR
        # FM çan
        mod = np.sin(2 * np.pi * f * 3.5 * tt) * 2.0 * np.exp(-tt * 8)
        bell = np.sin(2 * np.pi * f * tt + mod) * np.exp(-tt * 5) * 0.12
        add_at(out, pan(bell, rng.uniform(-0.8, 0.8)), st)
    return reverb(out, 0.45, 2.5)


def sfx_dream(dur=2.6) -> np.ndarray:
    """Halüsinasyon/rüya: vibratolu dedektörlü pad + ters dalga + flanger hissi."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    env = np.minimum(1, t / 0.5) * np.exp(-np.maximum(0, t - dur * 0.55) * 2.5)
    for k, m in enumerate([69, 72, 76, 81, 84]):
        f = midi_hz(m) * (1 + 0.025 * np.sin(2 * np.pi * (4.5 + k * 0.7) * t + k))
        ph = 2 * np.pi * np.cumsum(f) / SR
        v = (np.sin(ph) + 0.3 * np.sin(ph * 2.01) + 0.15 * np.sin(ph * 3.0)) * 0.09
        out += pan(v * env, math.sin(k * 1.7) * 0.8)
    sw = sweep_bp(white(n), 6000, 400, q=3) * env * 0.25
    out += pan(sw, np.sin(t * 7) * 0.9)
    # flanger
    d = (0.003 + 0.002 * np.sin(2 * np.pi * 0.6 * t)) * SR
    idx = np.clip(np.arange(n) - d.astype(int), 0, n - 1)
    out = out + out[idx] * 0.6
    return reverb(out, 0.5, 3.0)


def sfx_ding(dur=1.6) -> np.ndarray:
    out = np.zeros((int(dur * SR), 2))
    for i, m in enumerate([88, 95]):
        f = midi_hz(m)
        tt = t_axis(1.4)
        x = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 6)) * np.exp(-tt * 3.2) * 0.22
        add_at(out, pan(x, -0.2 + 0.4 * i), i * 0.11)
    return reverb(out, 0.35, 2.0)


def sfx_splash(dur=2.2) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = lp(white(n), 2500) * np.exp(-t * 5) * 0.6
    nz = lp(nz * np.minimum(1, t / 0.02), 900 + 0 * t[0])
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-t * 6)) / SR) * np.exp(-t * 2.2) * 0.8
    out = stereo(nz + boom)
    out += sfx_bubbles(dur, 40, 250, 1300, seed=11)[:n] * 1.2
    return reverb(out, 0.4, 2.5, 2500)


# ----------------------------------------------------------------- müzik
@dataclass
class MusicPlan:
    duration: float
    bpm: float = 100.0
    sections: list[tuple[float, float, str]] = field(default_factory=list)  # (başlangıç, bitiş, tip)
    key_root: int = 57  # A3


PROG = [  # i - VI - III - VII (A minör)
    (45, [57, 60, 64]),   # Am
    (41, [53, 57, 60]),   # F
    (48, [55, 60, 64]),   # C
    (43, [55, 59, 62]),   # G
]


def _pluck(f: float, dur: float, bright: int = 10, decay: float = 5.5) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for k in range(1, bright + 1):
        if f * k > SR * 0.45:
            break
        x += np.sin(2 * np.pi * f * k * t + k * 0.3) / k * np.exp(-t * (decay + k * 2.2))
    att = np.minimum(1, t / 0.003)
    return x * att


def _pad(freqs: list[float], dur: float, bright: int = 6) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    env = env_adsr(n, min(0.6, dur * 0.3), 0.3, 0.85, min(0.8, dur * 0.3))
    for i, f in enumerate(freqs):
        for dt, pn in ((-0.07, -0.6), (0.0, 0.0), (0.07, 0.6)):
            ff = f * 2 ** (dt / 12)
            v = np.zeros(n)
            for k in range(1, bright + 1):
                v += np.sin(2 * np.pi * ff * k * t + i + k) / (k ** 1.3)
            out += pan(v * env * 0.05, pn)
    return out


def _kick(dur=0.45):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 30)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    x += hp(white(n), 3000) * np.exp(-t * 200) * 0.15
    return soft_clip(x * 1.3, 1.5)


def _clap(dur=0.35):
    n = int(dur * SR); t = np.arange(n) / SR
    env = np.zeros(n)
    for d in (0.0, 0.011, 0.022, 0.031):
        i = int(d * SR)
        env[i:] += np.exp(-(t[: n - i]) * (60 if d < 0.03 else 14))
    return bp(white(n), 900, 4200) * env * 0.35


def _hat(open_=False):
    dur = 0.22 if open_ else 0.06
    n = int(dur * SR); t = np.arange(n) / SR
    return hp(white(n), 7500, 4) * np.exp(-t * (14 if open_ else 70)) * 0.22


def _bass(f: float, dur: float) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * f * t
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    env = env_adsr(n, 0.005, 0.08, 0.7, 0.06)
    return soft_clip(x * env * 0.9, 1.4)


def render_music(plan: MusicPlan) -> tuple[np.ndarray, np.ndarray]:
    """(müzik_stereo, davul_stereo) döndürür — davul ayrı ki pompalama müziğe uygulansın."""
    n = int(plan.duration * SR) + SR
    mus = np.zeros((n, 2)); drm = np.zeros((n, 2))
    beat = 60 / plan.bpm
    bar = beat * 4
    s16 = beat / 4

    def section_at(t):
        for a, b, kind in plan.sections:
            if a <= t < b:
                return kind
        return "full"

    kick, clap, hat, ohat = _kick(), _clap(), _hat(), _hat(True)
    nbars = int(math.ceil(plan.duration / bar)) + 1
    for bi in range(nbars):
        t0 = bi * bar
        if t0 >= plan.duration:
            break
        root, chord = PROG[bi % 4]
        kind = section_at(t0 + 0.01)
        cf = [midi_hz(m) for m in chord]
        # pad
        if kind in ("intro", "full", "lift", "break", "outro", "final"):
            g = {"intro": 1.0, "break": 1.2, "outro": 1.1, "final": 0.9}.get(kind, 0.75)
            add_at(mus, _pad(cf, bar + 0.6, 5 if kind in ("intro", "break") else 7), t0, g)
        # arp
        arp_notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12, chord[0] + 24, chord[2] + 12, chord[1] + 12, chord[2] + 12]
        for i in range(16):
            tt = t0 + i * s16
            if tt >= plan.duration:
                break
            k2 = section_at(tt)
            if k2 == "end":
                continue
            m = arp_notes[i % 8]
            br = {"intro": 3, "break": 4, "full": 9, "lift": 10, "final": 11, "outro": 6}.get(k2, 8)
            vel = (1.0 if i % 4 == 0 else 0.72) * (0.8 if k2 in ("intro", "break") else 1.0)
            note = _pluck(midi_hz(m), s16 * 2.6, br)
            add_at(mus, pan(note, 0.35 * math.sin(i * 0.9)), tt, 0.16 * vel)
            if k2 in ("lift", "final") and i % 2 == 0:
                add_at(mus, pan(_pluck(midi_hz(m + 12), s16 * 2, 6), -0.3), tt + s16 * 0.5, 0.06)
        # bas + davul
        if kind in ("full", "lift", "final"):
            for i in range(8):
                tt = t0 + i * beat / 2
                if tt >= plan.duration:
                    break
                k2 = section_at(tt)
                if k2 not in ("full", "lift", "final"):
                    continue
                f = midi_hz(root - 12 if i % 2 == 0 else root)
                add_at(mus, stereo(_bass(midi_hz(root), beat / 2 * 0.9)), tt, 0.32 if i % 2 == 0 else 0.22)
                add_at(drm, stereo(hat), tt + beat / 4, 0.55 + 0.25 * (i % 2))
                add_at(drm, stereo(hat), tt, 0.35)
                _ = f
            for b in range(4):
                tt = t0 + b * beat
                if tt >= plan.duration or section_at(tt) not in ("full", "lift", "final"):
                    continue
                if b in (0, 2) or (b == 3 and bi % 2 == 1):
                    add_at(drm, stereo(kick), tt + (beat / 2 if b == 3 else 0), 0.75)
                if b in (1, 3):
                    add_at(drm, reverb(_clap(), 0.25, 1.2), tt, 0.6)
            if bi % 4 == 3:
                add_at(drm, stereo(ohat), t0 + bar - beat / 2, 0.5)
        elif kind == "intro":
            # kalp atışı gibi derin nabız
            for b in (0, 2):
                tt = t0 + b * beat
                if tt < plan.duration:
                    add_at(drm, stereo(lp(_kick(), 180)), tt, 0.45)
    mus = reverb(mus, 0.22, 2.2)
    return mus[: int(plan.duration * SR)], drm[: int(plan.duration * SR)]


def render_ambience(duration: float) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n) / SR
    swell = 0.65 + 0.35 * np.sin(2 * np.pi * 0.07 * t) * np.sin(2 * np.pi * 0.023 * t + 1)
    # su altı "basınç" uğultusu: 90–500 Hz bandı, alt-bas temizlenmiş
    l = bp(brown(n), 90, 520, 2) * 3.0 * swell
    r = bp(brown(n), 90, 520, 2) * 3.0 * swell
    # çok hafif yüksek frekans "hışırtı" (parçacıklar)
    fizz = hp(pink(n), 5000, 2) * 0.012
    amb = np.stack([l + fizz, r + fizz], axis=1) * 0.3
    # uzak kabarcık kümeleri
    rng = np.random.default_rng(42)
    for st in np.arange(0.5, duration, 2.3):
        b = sfx_bubbles(1.5, rng.integers(4, 9), 250, 900, seed=int(st * 10))
        add_at(amb, b, st + rng.uniform(0, 1.2), 0.25)
    return amb


# ----------------------------------------------------------------- miks
def envelope_follow(x: np.ndarray, attack=0.02, release=0.35) -> np.ndarray:
    hop = int(0.01 * SR)
    m = x if x.ndim == 1 else x.mean(axis=1)
    nfr = len(m) // hop + 1
    pad = np.pad(m, (0, nfr * hop - len(m)))
    rms = np.sqrt(np.mean(pad.reshape(nfr, hop) ** 2, axis=1))
    out = np.zeros(nfr)
    a_c, r_c = math.exp(-0.01 / attack), math.exp(-0.01 / release)
    v = 0.0
    for i, r in enumerate(rms):
        c = a_c if r > v else r_c
        v = c * v + (1 - c) * r
        out[i] = v
    return np.interp(np.arange(len(m)) / hop, np.arange(nfr), out)


def compress(x: np.ndarray, thresh_db=-20, ratio=3.0, makeup_db=4, attack=0.008, release=0.12) -> np.ndarray:
    env = envelope_follow(x, attack, release)
    db = 20 * np.log10(env + 1e-9)
    over = np.maximum(0, db - thresh_db)
    gain_db = -over * (1 - 1 / ratio) + makeup_db
    g = 10 ** (gain_db / 20)
    return x * (g[:, None] if x.ndim == 2 else g)


def peaking(x, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w0 = 2 * math.pi * f0 / SR
    alpha = math.sin(w0) / (2 * q)
    b = [1 + alpha * A, -2 * math.cos(w0), 1 - alpha * A]
    a = [1 + alpha / A, -2 * math.cos(w0), 1 - alpha / A]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def limiter(x: np.ndarray, ceiling=0.93, lookahead=0.004, release=0.08) -> np.ndarray:
    peak = np.max(np.abs(x), axis=1)
    la = int(lookahead * SR)
    # ileriye bakan tepe tutma
    from scipy.ndimage import maximum_filter1d
    pk = maximum_filter1d(peak, size=2 * la + 1)
    g_target = np.minimum(1.0, ceiling / np.maximum(pk, 1e-9))
    # yumuşak bırakma
    rel = math.exp(-1 / (release * SR))
    g = lfilter([1 - rel], [1, -rel], g_target)
    g = np.minimum(g, g_target)
    return x * g[:, None]


def process_voice(v: np.ndarray) -> np.ndarray:
    v = hp(v, 75, 2)
    v = peaking(v, 220, -1.5, 1.0)
    v = peaking(v, 3800, 2.5, 0.9)
    v = peaking(v, 9000, 1.5, 0.7)
    v = compress(v, -22, 3.0, 5)
    rms = np.sqrt(np.mean(v[np.abs(v) > 1e-4] ** 2) + 1e-12)
    v = v * (0.085 / rms)
    wet = reverb(v, 0.08, 0.9, 5000)
    return wet
