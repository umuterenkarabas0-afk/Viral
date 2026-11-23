"""Uzay teması için kodla sentezlenen ses tasarımı (hazır örnek yok, her şey numpy).

Müzik  : D minör sinematik elektronik — dedektörlü pad (yavaş filtre süpürmesi), alt drone,
         FM cam-çan arpeji + ping-pong yankı, 8'lik nabız bası, sinematik davullar (derin kick,
         geniş reverb'lü clap, hi-hat, tom geçişleri), yıldız parıltısı çanları.
Atmosfer: derin uzay uğultusu, kozmik rüzgar süpürmeleri, yüksek "hava", uzak pulsar sinyalleri.
SFX    : warp/whoosh geçişleri, sinematik vuruş, UI bip/blip, tarama, veri cıvıltısı ve sahneye
         özel efektler (sun, ice, whirl, chime, rumble, storm, geyser, lava, rain, wind, heat).
"""
from __future__ import annotations

import math

import numpy as np

from . import sound as S
from .sound import SR, add_at, bp, brown, env_adsr, hp, lp, midi_hz, pan, pink, reverb, soft_clip, stereo, sweep_bp, white

# i – VI – III – VII (D minör), zengin voicing'ler
PROG = [
    (38, [62, 65, 69, 72, 76]),   # Dm9
    (34, [58, 62, 65, 69, 74]),   # Bbmaj7(9)
    (41, [60, 65, 69, 72, 76]),   # Fmaj7(9)
    (36, [60, 64, 67, 71, 74]),   # Cmaj7(9)
]


# ----------------------------------------------------------------- yardımcılar
def pingpong(x: np.ndarray, delay: float, fb: float = 0.4, taps: int = 6, damp: float = 4500) -> np.ndarray:
    """Stereo ping-pong yankı (sonlu sayıda yansıma, her yansıma biraz daha karanlık)."""
    x2 = stereo(x)
    d = int(delay * SR)
    out = np.zeros((len(x2) + d * taps, 2))
    out[: len(x2)] += x2
    tap = x2.mean(axis=1)
    for k in range(1, taps + 1):
        tap = lp(tap, damp * (0.85 ** k), 1)
        side = 0 if k % 2 else 1
        out[k * d: k * d + len(tap), side] += tap * (fb ** k)
    return out


def fm_bell(f: float, dur: float, ratio: float = 3.5, index: float = 2.2, decay: float = 4.0) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t * decay * 1.6)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t * decay) * np.minimum(1, t / 0.002)


def supersaw_pad(freqs: list[float], dur: float, bright: float = 6.0, attack: float = 0.9, release: float = 1.2, seed: int = 0) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    env = env_adsr(n, min(attack, dur * 0.45), 0.4, 0.85, min(release, dur * 0.45))
    rng = np.random.default_rng(seed)
    # yavaş "filtre" süpürmesi: harmonik ağırlıkları zamanla değişir
    sweep = 0.65 + 0.35 * np.sin(2 * np.pi * (0.11 + 0.03 * rng.random()) * t + rng.random() * 6)
    for i, f in enumerate(freqs):
        for dt, pn in ((-0.11, -0.8), (-0.04, -0.3), (0.0, 0.0), (0.05, 0.35), (0.12, 0.8)):
            ff = f * 2 ** (dt / 12)
            v = np.zeros(n)
            ph0 = rng.random() * 6.28
            for k in range(1, 12):
                if ff * k > 9000:
                    break
                w = np.exp(-k / (bright * sweep)) / k
                v += np.sin(2 * np.pi * ff * k * t + ph0 * k) * w
            out += pan(v * env * 0.028, pn)
    return out


def _kick(dur=0.7):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 38 + 120 * np.exp(-t * 26)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.2)
    x += hp(white(n), 2500) * np.exp(-t * 180) * 0.12
    return soft_clip(x * 1.4, 1.6)


def _clap(dur=0.4):
    n = int(dur * SR); t = np.arange(n) / SR
    env = np.zeros(n)
    for d in (0.0, 0.012, 0.024, 0.034):
        i = int(d * SR)
        env[i:] += np.exp(-(t[: n - i]) * (55 if d < 0.03 else 12))
    return bp(white(n), 900, 5200) * env * 0.3


def _hat(open_=False):
    dur = 0.25 if open_ else 0.05
    n = int(dur * SR); t = np.arange(n) / SR
    return hp(white(n), 8000, 4) * np.exp(-t * (13 if open_ else 80)) * 0.18


def _tom(f0=90, dur=0.8):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f0 * (1 + 0.6 * np.exp(-t * 18))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6)
    x += bp(white(n), 200, 1500) * np.exp(-t * 40) * 0.25
    return soft_clip(x * 1.2, 1.3)


def _bass(f: float, dur: float) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * f * t
    x = np.sin(ph) + 0.45 * np.sin(2 * ph + 0.3) + 0.2 * np.sin(3 * ph) + 0.1 * np.sin(4 * ph)
    env = env_adsr(n, 0.004, 0.12, 0.55, 0.05)
    return soft_clip(lp(x * env, 900, 2) * 0.9, 1.5)


# ----------------------------------------------------------------- müzik
def render_music(plan: S.MusicPlan) -> tuple[np.ndarray, np.ndarray]:
    n = int(plan.duration * SR) + SR * 2
    mus = np.zeros((n, 2)); drm = np.zeros((n, 2)); arp_bus = np.zeros((n, 2)); shim = np.zeros((n, 2))
    beat = 60 / plan.bpm
    bar = beat * 4
    s16 = beat / 4
    rng = np.random.default_rng(7)

    def section_at(t):
        for a, b, kind in plan.sections:
            if a <= t < b:
                return kind
        return "full"

    kick, clap, hat, ohat = _kick(), _clap(), _hat(), _hat(True)
    clap_r = reverb(clap, 0.45, 2.8)
    nbars = int(math.ceil(plan.duration / bar)) + 1
    for bi in range(nbars):
        t0 = bi * bar
        if t0 >= plan.duration:
            break
        root, chord = PROG[bi % 4]
        kind = section_at(t0 + 0.01)
        cf = [midi_hz(m) for m in chord]
        # pad + alt drone
        if kind != "end":
            g = {"intro": 1.1, "break": 1.25, "final": 1.0, "lift": 0.85}.get(kind, 0.8)
            add_at(mus, supersaw_pad(cf, bar + 1.4, 4.5 if kind in ("intro", "break") else 6.5, seed=bi), t0 - 0.2, g)
            nd = int((bar + 0.6) * SR)
            tt = np.arange(nd) / SR
            sub = np.sin(2 * np.pi * midi_hz(root - 12) * tt) * env_adsr(nd, 0.25, 0.2, 0.9, 0.4) * 0.22
            add_at(mus, stereo(sub), t0, {"intro": 1.2, "break": 1.2}.get(kind, 0.8))
        # FM çan arpeji
        pattern = [0, 2, 4, 1, 3, 4, 2, 3, 0, 4, 2, 1, 3, 2, 4, 3]
        for i in range(16):
            tt = t0 + i * s16
            if tt >= plan.duration:
                break
            k2 = section_at(tt)
            if k2 == "end":
                continue
            if k2 in ("intro", "break") and i % 2 == 1:
                continue
            m = chord[pattern[i]] + 12
            vel = (1.0 if i % 4 == 0 else 0.7) * (0.8 if k2 in ("intro", "break") else 1.0)
            note = fm_bell(midi_hz(m), 0.9, ratio=3.0 if k2 != "lift" else 3.5, index=1.6, decay=5.5)
            add_at(arp_bus, pan(note, 0.4 * math.sin(i * 1.3)), tt, 0.085 * vel)
            if k2 in ("lift", "final") and i % 4 == 2:
                add_at(arp_bus, pan(fm_bell(midi_hz(m + 12), 0.7, 2.0, 1.0, 6.0), -0.4), tt, 0.04)
        # parıltı (yıldız çanları)
        if kind in ("intro", "break", "final", "full"):
            for _ in range(2 if kind == "full" else 4):
                tt = t0 + rng.random() * bar
                if tt < plan.duration:
                    m = chord[rng.integers(0, len(chord))] + 24
                    add_at(shim, pan(fm_bell(midi_hz(m), 2.2, 2.0, 0.8, 2.0), rng.uniform(-0.9, 0.9)), tt, 0.035)
        # bas + davul
        if kind in ("full", "lift", "final"):
            for i in range(8):
                tt = t0 + i * beat / 2
                if tt >= plan.duration or section_at(tt) not in ("full", "lift", "final"):
                    continue
                add_at(mus, stereo(_bass(midi_hz(root), beat / 2 * 0.85)), tt, 0.3 if i % 2 == 0 else 0.2)
                hv = 0.45 + 0.25 * (i % 2) + 0.1 * rng.random()
                add_at(drm, pan(hat, 0.3), tt + beat / 4, hv)
                if section_at(tt) == "lift":
                    add_at(drm, pan(hat, -0.3), tt + beat / 8, 0.25)
            final = kind == "final"
            for b in range(4):
                tt = t0 + b * beat
                if tt >= plan.duration or section_at(tt) not in ("full", "lift", "final"):
                    continue
                if b in (0, 2) and not (final and b == 2):
                    add_at(drm, stereo(kick), tt, 0.8)
                if b == 3 and bi % 2 == 1 and not final:
                    add_at(drm, stereo(kick), tt + beat / 2, 0.55)
                if b in (1, 3) and not final:
                    add_at(drm, clap_r, tt, 0.42)
                if final and b == 2:
                    add_at(drm, clap_r, tt, 0.5)
            if bi % 4 == 3 and not final:
                for j, f0 in enumerate((110, 92, 78)):
                    add_at(drm, pan(_tom(f0), -0.4 + 0.4 * j), t0 + bar - beat + j * beat / 3, 0.35)
            if bi % 4 == 3:
                add_at(drm, stereo(ohat), t0 + bar - beat / 2, 0.4)
        elif kind == "intro":
            for b in (0, 2):
                tt = t0 + b * beat
                if tt < plan.duration:
                    add_at(drm, stereo(lp(_kick(), 150)), tt, 0.5)
        elif kind == "break":
            add_at(drm, reverb(_tom(70, 1.4), 0.5, 3.0), t0, 0.35)
    arp = pingpong(arp_bus, beat * 0.75, 0.38, 5)[:n]
    mus[: len(arp)] += arp[:n]
    mus += reverb(shim, 0.85, 4.5)[:n]
    mus = reverb(mus, 0.3, 3.6, 5000)
    L = int(plan.duration * SR)
    return mus[:L], drm[:L]


# ----------------------------------------------------------------- atmosfer
def render_ambience(duration: float, segments: list[dict] | None = None) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(42)
    swell = 0.7 + 0.3 * np.sin(2 * np.pi * 0.05 * t) * np.sin(2 * np.pi * 0.017 * t + 1)
    rum_l = lp(brown(n), 110, 2) * 3.0
    rum_r = lp(brown(n), 110, 2) * 3.0
    amb = np.stack([rum_l, rum_r], axis=1) * swell[:, None] * 0.35
    # kozmik rüzgar: yavaş kayan bant geçiren gürültü parçaları
    seg = 7.0
    k = 0
    while k * seg * 0.75 < duration:
        st = k * seg * 0.75
        dur = min(seg, duration - st + 0.5)
        m = int(dur * SR)
        f0, f1 = rng.uniform(180, 500), rng.uniform(500, 1600)
        if k % 2:
            f0, f1 = f1, f0
        w = sweep_bp(pink(m), f0, f1, q=3.0)
        e = np.sin(np.linspace(0, np.pi, m)) ** 2
        add_at(amb, pan(w * e * 0.05, rng.uniform(-0.8, 0.8)), st)
        k += 1
    amb += np.stack([hp(pink(n), 7000, 2), hp(pink(n), 7000, 2)], axis=1) * 0.004
    # uzak pulsar / sinyal bipleri
    for st in np.arange(1.5, duration, 4.7):
        st += rng.uniform(0, 1.5)
        f = rng.choice([1320, 1760, 2093, 2637])
        m = int(0.6 * SR)
        tt = np.arange(m) / SR
        tone = np.sin(2 * np.pi * f * tt) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 9 * tt))) * np.exp(-tt * 5)
        add_at(amb, reverb(pan(tone * 0.012, rng.uniform(-1, 1)), 0.7, 3.5), st)
    # Güneş planı: plazma çıtırtısı yatağı
    for s in segments or []:
        if s.get("subject", {}).get("ref") == "sun" and s["kind"] == "hook":
            a, b = s["start"], s["end"]
            add_at(amb, sfx_sun(b - a + 1.0) * 0.6, a)
    return amb


# ----------------------------------------------------------------- SFX
def sfx_warp(dur=0.9, up=True, pan_from=-0.6, pan_to=0.6) -> np.ndarray:
    n = int(dur * SR); t = np.linspace(0, 1, n)
    f0, f1 = (180, 5200) if up else (5200, 180)
    nz = sweep_bp(pink(n), f0, f1, q=1.6)
    env = np.where(t < 0.7, (t / 0.7) ** 2.4, np.exp(-(t - 0.7) * 10))
    tone_f = (120 * 2 ** (t * 3)) if up else (900 * 2 ** (-t * 3))
    tone = np.sin(2 * np.pi * np.cumsum(tone_f) / SR) * env * 0.12
    sub = np.sin(2 * np.pi * np.cumsum(55 + 25 * t) / SR) * env * 0.25
    out = pan(nz * env + tone + sub, np.linspace(pan_from, pan_to, n))
    return reverb(out, 0.35, 2.2) * 0.9


def sfx_impact(power=1.0, dur=2.4) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(30 + 85 * np.exp(-t * 14)) / SR) * np.exp(-t * 3.2)
    thump = np.sin(2 * np.pi * np.cumsum(60 + 170 * np.exp(-t * 35)) / SR) * np.exp(-t * 12)
    # metalik, inharmonik vuruş (FM)
    metal = np.sin(2 * np.pi * 196 * t + 3.0 * np.sin(2 * np.pi * 196 * 1.41 * t) * np.exp(-t * 6)) * np.exp(-t * 4.5) * 0.25
    click = hp(white(n), 3000) * np.exp(-t * 140) * 0.4
    x = soft_clip((sub + thump * 0.8 + metal + click) * power, 1.7)
    return reverb(x, 0.4, 3.2, 3000) * 0.9


def sfx_riser(dur=1.6, top=5000) -> np.ndarray:
    n = int(dur * SR); t = np.linspace(0, 1, n)
    nz = sweep_bp(white(n), 300, top, q=2.2) * t ** 2.6
    f = 110 * 2 ** (t * 3)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = sum(np.sin(ph * k * (1 + 0.003 * k)) / k for k in range(1, 7)) * t ** 2 * 0.1
    out = pan(nz * 0.8 + tone, np.sin(t * 14) * 0.4)
    return reverb(out, 0.4, 2.6) * 0.8


def sfx_reverse_swell(dur=1.2, f=147.0) -> np.ndarray:
    """Ters reverb hissi: yükselen pad + gürültü, vuruşa doğru emer."""
    n = int(dur * SR); t = np.linspace(0, 1, n)
    x = sum(np.sin(2 * np.pi * f * k * np.arange(n) / SR) / k for k in (1, 2, 3, 5)) * 0.2
    x += bp(pink(n), 400, 3000) * 0.3
    x *= t ** 3
    return reverb(x, 0.5, 2.5) * 0.7


def sfx_blip(freq=1400, dur=0.12) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    f = freq * (1 + 0.5 * np.exp(-t * 80))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 32)
    x += np.sign(np.sin(2 * np.pi * freq * 2 * t)) * np.exp(-t * 120) * 0.05
    return reverb(x * 0.5, 0.25, 1.2)


def sfx_scan(dur=1.2) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    f = 600 + 1800 * (t / dur)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 22 * t)) * np.sin(np.pi * t / dur) ** 2
    return reverb(pan(x * 0.12, np.linspace(-0.6, 0.6, n)), 0.35, 1.5)


def sfx_data(dur=0.8, seed=1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros((n, 2))
    tt = 0.0
    while tt < dur - 0.05:
        f = rng.choice([1800, 2400, 3000, 3600, 4200])
        m = int(rng.uniform(0.012, 0.03) * SR)
        x = np.sign(np.sin(2 * np.pi * f * np.arange(m) / SR)) * 0.04
        add_at(out, pan(lp(x, 6000), rng.uniform(-0.6, 0.6)), tt)
        tt += rng.uniform(0.025, 0.06)
    return reverb(out, 0.2, 0.8)


def sfx_sparkle(dur=1.6, seed=5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros((int(dur * SR), 2))
    notes = [86, 89, 93, 96, 98, 101]
    for i in range(10):
        add_at(out, pan(fm_bell(midi_hz(rng.choice(notes)), 1.0, 3.5, 1.5, 5.0) * 0.1, rng.uniform(-0.8, 0.8)), i * 0.04 + rng.uniform(0, 0.02))
    return reverb(out, 0.55, 3.0)


def sfx_ding(dur=2.0) -> np.ndarray:
    out = np.zeros((int(dur * SR), 2))
    for i, m in enumerate([86, 93, 98]):
        add_at(out, pan(fm_bell(midi_hz(m), 1.6, 2.0, 1.2, 2.6) * 0.18, -0.3 + 0.3 * i), i * 0.09)
    return reverb(out, 0.45, 2.8)


# --- sahneye özel efektler
def sfx_sun(dur=4.0) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    roar = lp(brown(n), 160, 2) * 6 * (0.6 + 0.4 * np.sin(2 * np.pi * 0.4 * t))
    body = bp(pink(n), 80, 700) * 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.23 * t + 1))
    crk = hp(white(n), 2500) * (np.random.default_rng(3).random(n) > 0.9985) * 2.0
    crk = lp(crk, 7000)
    env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.8)
    x = (roar + body + crk * 0.6) * env
    return reverb(np.stack([x, np.roll(x, 900)], axis=1) * 0.6, 0.4, 3.0, 3000)


def sfx_ice(dur=2.2) -> np.ndarray:
    rng = np.random.default_rng(12)
    out = np.zeros((int(dur * SR), 2))
    for i in range(14):
        f = midi_hz(rng.choice([93, 96, 98, 100, 103, 105]))
        add_at(out, pan(fm_bell(f, 1.4, 5.2, 2.6, 3.5) * 0.08, rng.uniform(-0.9, 0.9)), i * 0.05 + rng.uniform(0, 0.03))
    n = len(out); t = np.arange(n) / SR
    glass = hp(white(n), 6000) * np.exp(-t * 3) * 0.04
    out += stereo(glass)
    return reverb(out, 0.6, 3.5)


def sfx_whirl(dur=2.6) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    rate = 1.2 + 1.8 * t / dur
    ph = 2 * np.pi * np.cumsum(rate) / SR
    fc = 700 + 500 * np.sin(ph)
    nz = pink(n)
    y = np.zeros(n)
    blk = 512
    for i in range(0, n, blk):
        f = float(np.clip(fc[i], 200, 4000))
        y[i:i + blk] = bp(nz[i:i + blk], f * 0.7, f * 1.4, 1)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    tone = np.sin(2 * np.pi * np.cumsum(220 + 60 * np.sin(ph)) / SR) * 0.08
    out = pan((y * 0.6 + tone) * env, np.sin(ph) * 0.9)
    return reverb(out, 0.4, 2.4) * 0.9


def sfx_chime(dur=2.4) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    low = np.sin(2 * np.pi * 73.4 * t) * np.exp(-t * 2.2) * 0.4
    out = stereo(low)
    add_at(out, pan(fm_bell(midi_hz(98), 2.0, 2.0, 1.4, 2.4) * 0.2, 0.4), 0.18)
    add_at(out, pan(fm_bell(midi_hz(86), 2.0, 2.0, 1.2, 2.4) * 0.16, -0.4), 0.0)
    return reverb(out, 0.5, 3.0)


def sfx_rumble(dur=3.0) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    x = lp(brown(n), 140, 2) * 9 * (0.7 + 0.3 * np.sin(2 * np.pi * 3.2 * t))
    x = soft_clip(x, 2.0)
    sub = np.sin(2 * np.pi * np.cumsum(36 + 8 * np.sin(2 * np.pi * 0.7 * t)) / SR) * 0.4
    env = np.minimum(1, t / 0.35) * np.exp(-np.maximum(0, t - dur * 0.5) * 2.5)
    out = np.stack([x + sub, np.roll(x, 1200) + sub], axis=1) * env[:, None] * 0.6
    return reverb(out, 0.35, 2.6, 2500)


def sfx_storm(dur=3.0) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    lfo = np.sin(2 * np.pi * 0.9 * t)
    a = sweep_bp(pink(n), 300, 1400, q=4) * (0.6 + 0.4 * lfo)
    b = sweep_bp(pink(n), 1400, 400, q=4) * (0.6 - 0.4 * lfo)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.2
    out = np.stack([a + 0.4 * b, b + 0.4 * a], axis=1) * env[:, None] * 0.35
    out += stereo(lp(brown(n), 90) * 3 * env) * 0.2
    return reverb(out, 0.45, 2.8)


def sfx_geyser(dur=2.4) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    hiss = hp(white(n), 2500, 2) * (np.minimum(1, t / 0.08) * np.exp(-t * 1.4)) * 0.35
    rush = bp(pink(n), 500, 4000) * np.minimum(1, t / 0.15) * np.exp(-t * 1.1) * 0.3
    rng = np.random.default_rng(8)
    pops = np.zeros(n)
    for _ in range(40):
        i = int(rng.uniform(0, dur * 0.7) * SR)
        m = int(0.02 * SR)
        f = rng.uniform(1500, 4000)
        pops[i:i + m] += np.sin(2 * np.pi * f * np.arange(min(m, n - i)) / SR) * np.exp(-np.arange(min(m, n - i)) / SR * 200) * 0.15
    x = hiss + rush + pops
    out = pan(x, np.linspace(-0.3, 0.5, n))
    return reverb(out, 0.4, 2.6)


def sfx_lava(dur=3.0) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    rng = np.random.default_rng(21)
    out = stereo(lp(brown(n), 120) * 5 * np.exp(-t * 0.6)) * 0.5
    for _ in range(28):
        st = rng.uniform(0, dur * 0.8)
        f0 = rng.uniform(60, 160)
        d = rng.uniform(0.08, 0.2)
        m = int(d * SR); tt = np.arange(m) / SR
        b = np.sin(2 * np.pi * np.cumsum(f0 * (1 + 1.5 * tt / d)) / SR) * np.exp(-tt * (5 / d)) * rng.uniform(0.2, 0.5)
        add_at(out, pan(b, rng.uniform(-0.7, 0.7)), st)
    crack = hp(white(n), 3000) * (rng.random(n) > 0.997) * 1.2
    out += stereo(lp(crack, 8000) * np.exp(-t * 0.8)) * 0.4
    boom = sfx_impact(0.8, 2.0)
    add_at(out, boom, 0.0, 0.5)
    return reverb(out, 0.35, 2.4, 3000)


def sfx_rain(dur=3.0) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    rng = np.random.default_rng(31)
    drops = np.zeros((n, 2))
    for _ in range(int(220 * dur)):
        i = int(rng.uniform(0, dur) * SR)
        m = int(0.008 * SR)
        f = rng.uniform(2500, 6500)
        if i + m < n:
            d = np.sin(2 * np.pi * f * np.arange(m) / SR) * np.exp(-np.arange(m) / SR * 600) * rng.uniform(0.02, 0.07)
            p = rng.uniform(-1, 1)
            drops[i:i + m] += pan(d, p)
    bed = stereo(bp(pink(n), 2000, 8000) * 0.05)
    env = np.minimum(1, t / 0.5) * np.minimum(1, (dur - t) / 0.8)
    return reverb((drops + bed) * env[:, None], 0.4, 2.0)


def sfx_wind(dur=3.6) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    howl = sweep_bp(pink(n), 350, 1100, q=7) * 1.4
    howl2 = sweep_bp(pink(n), 900, 500, q=6) * 1.0
    gust = 0.55 + 0.45 * np.sin(2 * np.pi * 0.8 * t) * np.sin(2 * np.pi * 0.31 * t + 1)
    env = np.minimum(1, t / 0.3) * np.minimum(1, (dur - t) / 1.0)
    out = pan(howl * gust * env, np.sin(2 * np.pi * 0.5 * t) * 0.8) + pan(howl2 * (1.1 - gust) * env, -np.sin(2 * np.pi * 0.4 * t) * 0.8)
    out += stereo(hp(white(n), 3000) * 0.05 * gust * env)
    return reverb(out * 0.5, 0.35, 2.4)


def sfx_heat(dur=2.0) -> np.ndarray:
    n = int(dur * SR); t = np.arange(n) / SR
    rng = np.random.default_rng(41)
    sizzle = hp(white(n), 4000) * (0.5 + 0.5 * (rng.random(n) > 0.6)) * np.exp(-t * 1.3) * 0.18
    out = stereo(sizzle)
    add_at(out, sfx_impact(1.2, 2.0), 0.0, 0.7)
    dist = soft_clip(lp(brown(n), 300) * 8, 3.0) * np.exp(-t * 2) * 0.25
    out += stereo(dist)
    return reverb(out, 0.3, 2.0)


NAMED = {"sun": sfx_sun, "ice": sfx_ice, "whirl": sfx_whirl, "chime": sfx_chime, "rumble": sfx_rumble, "storm": sfx_storm,
         "geyser": sfx_geyser, "lava": sfx_lava, "rain": sfx_rain, "wind": sfx_wind, "heat": sfx_heat}
GAIN = {"sun": 0.55, "ice": 0.7, "whirl": 0.55, "chime": 0.6, "rumble": 0.75, "storm": 0.55, "geyser": 0.65, "lava": 0.6,
        "rain": 0.6, "wind": 0.6, "heat": 0.6}


def place_sfx(timeline: dict, sfx: np.ndarray, bar: float):
    """Uzay teması: geçişler, vurgular, UI sesleri ve sahne efektlerini yerleştirir."""
    segs = timeline["segments"]
    add_at(sfx, sfx_impact(0.9), 0.02, 0.55)
    for k, s in enumerate(segs):
        if s["kind"] == "hook" and s.get("title"):
            at = s["title"]["at"]
            add_at(sfx, sfx_riser(1.4), at - 1.4 + 0.05, 0.5)
            add_at(sfx, sfx_impact(1.3), at + 0.1, 0.85)
            add_at(sfx, sfx_sparkle(), at + 0.25, 0.55)
        if k > 0:
            b = s["start"]
            up = k % 2 == 0
            add_at(sfx, sfx_warp(0.85, up=up, pan_from=-0.7 if up else 0.7, pan_to=0.7 if up else -0.7), b - 0.6, 0.55)
            if s["kind"] == "item":
                top = s.get("rank") == 1
                add_at(sfx, sfx_impact(1.45 if top else 1.0), b, 0.9 if top else 0.62)
                add_at(sfx, sfx_scan(1.2), b + 0.12, 0.5)
                for ci, _ in enumerate(s.get("chips", [])[:3]):
                    add_at(sfx, sfx_blip(1300 + ci * 300), b + 0.86 + ci * 0.18, 0.6)
                add_at(sfx, sfx_blip(2600, 0.06), b + 0.52, 0.3)
                if s.get("callout"):
                    add_at(sfx, sfx_data(0.7, seed=k), s["callout"]["t0"], 0.6)
                    add_at(sfx, sfx_sparkle(seed=k), s["callout"]["t0"] + 0.1, 0.35)
            if s["kind"] == "outro":
                add_at(sfx, sfx_blip(1100), b + 0.45, 0.6)
                add_at(sfx, sfx_ding(), b + 0.95, 0.65)
        if s["kind"] == "item" and s.get("rank") == 1:
            add_at(sfx, sfx_riser(bar, 6000), s["start"] - bar, 0.5)
    for c in timeline.get("cues", []):
        if c["type"] == "sfx" and c.get("name") in NAMED:
            if c.get("name") == "sun":
                continue  # açılış atmosferinde zaten var
            add_at(sfx, NAMED[c["name"]](), c["t"] - 0.05, GAIN.get(c["name"], 0.6) * float(c.get("gain", 1.0)))
        elif c["type"] == "flash":
            add_at(sfx, sfx_sparkle(seed=9), c["t"], 0.5)
