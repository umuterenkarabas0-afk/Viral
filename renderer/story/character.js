// Prosedürel 3D karakterler ("vinil oyuncak" stili): iskelet grupları, kıyafet katmanları,
// yüz ifadeleri (göz kapağı, kaş, ağız), göz kırpma, bakış, konuşma ağız hareketi ve
// zamana bağlı pozlar (idle, yürüme, koşma, oturma, okuma, bağırma...). Ayrıca kedi.
import * as THREE from 'three';
import { G, mat, glow, TEX, mulberry32, hashString } from './kit.js';
import { clamp, lerp, smoothstep, ease, noise3 } from '../src/util.js';

const PI = Math.PI;
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ ifadeler
// lid: göz kapağı kapanması (0 açık, 1 kapalı), brow: kaş yüksekliği, ang: iç kaş kalkışı (+ endişe, - öfke),
// smile: -1..1, open: ağız açıklığı, pupil: göz bebeği ölçeği, blush
const EXPR = {
  neutral: { lid: 0.14, brow: 0, ang: 0, smile: 0.12, open: 0 },
  smile: { lid: 0.2, brow: 0.12, ang: 0.05, smile: 0.85, open: 0.05 },
  bored: { lid: 0.55, brow: -0.25, ang: 0.15, smile: -0.15, open: 0 },
  sleepy: { lid: 0.62, brow: -0.1, ang: 0.2, smile: 0, open: 0 },
  surprised: { lid: 0, brow: 1, ang: 0.15, smile: 0, open: 0.6, pupil: 0.78 },
  shock: { lid: 0, brow: 1, ang: 0.5, smile: -0.2, open: 0.85, pupil: 0.62 },
  horror: { lid: 0, brow: 1, ang: 0.85, smile: -0.4, open: 0.55, pupil: 0.5, shake: 1 },
  confused: { lid: 0.15, brow: 0.4, ang: 0.3, smile: -0.2, open: 0, asym: 0.6 },
  curious: { lid: 0.08, brow: 0.45, ang: 0.15, smile: 0.12, open: 0 },
  suspicious: { lid: 0.48, brow: -0.45, ang: -0.45, smile: -0.12, open: 0, asym: 0.35 },
  determined: { lid: 0.25, brow: -0.4, ang: -0.55, smile: -0.05, open: 0 },
  nervous: { lid: 0.05, brow: 0.55, ang: 0.65, smile: -0.35, open: 0.05 },
  embarrassed: { lid: 0.3, brow: 0.35, ang: 0.6, smile: 0.35, open: 0, blush: 0.9 },
  blush: { lid: 0.38, brow: 0.2, ang: 0.3, smile: 0.55, open: 0, blush: 1 },
  laugh: { lid: 0.88, brow: 0.35, ang: 0.2, smile: 1, open: 0.7 },
  knowing: { lid: 0.35, brow: 0.2, ang: -0.1, smile: 0.5, open: 0, asym: 0.5 },
  tired: { lid: 0.58, brow: 0.2, ang: 0.55, smile: -0.3, open: 0 },
  worried: { lid: 0.12, brow: 0.45, ang: 0.8, smile: -0.45, open: 0 },
  sad: { lid: 0.35, brow: 0.3, ang: 0.85, smile: -0.5, open: 0 },
  sad_smile: { lid: 0.35, brow: 0.3, ang: 0.65, smile: 0.4, open: 0 },
  hopeful: { lid: 0.1, brow: 0.45, ang: 0.45, smile: 0.4, open: 0 },
  kind: { lid: 0.25, brow: 0.2, ang: 0.2, smile: 0.65, open: 0 },
  excited: { lid: 0, brow: 0.75, ang: 0.1, smile: 0.9, open: 0.3 },
  annoyed: { lid: 0.45, brow: -0.3, ang: -0.35, smile: -0.4, open: 0 },
  dreamy: { lid: 0.35, brow: 0.35, ang: 0.3, smile: 0.75, open: 0, blush: 0.4 },
  awkward: { lid: 0.2, brow: 0.35, ang: 0.4, smile: 0.25, open: 0, asym: 0.4, blush: 0.3 },
  guilty: { lid: 0.2, brow: 0.5, ang: 0.6, smile: 0.25, open: 0.05, asym: 0.3 },
  focused: { lid: 0.32, brow: -0.25, ang: -0.2, smile: 0, open: 0 },
  sleep: { lid: 1, brow: -0.05, ang: 0.1, smile: 0.05, open: 0 },
  dead: { lid: 1, brow: -0.2, ang: 0.4, smile: -0.2, open: 0.35 },
  shout: { lid: 0.05, brow: -0.15, ang: -0.3, smile: 0.1, open: 1.0 },
  wink: { lid: 0.2, brow: 0.2, ang: 0, smile: 0.75, open: 0, winkR: 1 },
};

// ------------------------------------------------------------------ pozlar
const ZERO = {
  y: 0, hipY: 0, hipX: 0, hipZ: 0, spX: 0, spY: 0, spZ: 0, nkX: 0, nkY: 0, nkZ: 0, hdX: 0, hdY: 0, hdZ: 0,
  sLx: 0.05, sLy: 0, sLz: 0.12, eL: -0.15, wL: 0, sRx: 0.05, sRy: 0, sRz: -0.12, eR: -0.15, wR: 0,
  tLx: 0, tLz: 0.0, kL: 0.04, fL: 0, tRx: 0, tRz: 0.0, kR: 0.04, fR: 0, lying: 0,
};
function P(o) { return Object.assign({}, ZERO, o); }
function mixPose(a, b, w) { const o = {}; for (const k in ZERO) o[k] = lerp(a[k] ?? ZERO[k], b[k] ?? ZERO[k], w); return o; }

function breathe(p, t, k = 1) {
  const b = Math.sin(t * 1.6) * k;
  p.spX += -0.01 * b; p.nkX += 0.008 * b; p.y += 0.003 * b;
  p.sLz += 0.01 * b; p.sRz -= 0.01 * b;
  p.hipZ += Math.sin(t * 0.37) * 0.012 * k; p.spZ -= Math.sin(t * 0.37) * 0.01 * k;
  return p;
}
function sitBase(o = {}) {
  return P({ hipY: -0.43, tLx: -1.52, tRx: -1.52, kL: 1.5, kR: 1.5, fL: 0.05, fR: 0.05, tLz: 0.06, tRz: -0.06, spX: 0.04,
    sLx: -0.42, sRx: -0.42, eL: -0.95, eR: -0.95, sLz: 0.08, sRz: -0.08, ...o });
}
function walkPose(ph, speed, { amp = 1, lean = 0.05 } = {}) {
  const s = Math.sin(ph), c = Math.cos(ph);
  const a = 0.42 * amp;
  return P({
    y: Math.abs(Math.sin(ph)) * 0.028 * amp, spX: lean, spY: s * 0.07 * amp, hipY: -0.015,
    tLx: -s * a, tRx: s * a, kL: Math.max(0, c) * 0.75 * amp + 0.08, kR: Math.max(0, -c) * 0.75 * amp + 0.08,
    fL: -Math.max(0, -s) * 0.25, fR: -Math.max(0, s) * 0.25,
    sLx: s * 0.38 * amp, sRx: -s * 0.38 * amp, eL: -0.3, eR: -0.3, sLz: 0.1, sRz: -0.1,
    nkY: -s * 0.04,
  });
}

export const POSES = {
  idle: (t, st) => breathe(P({ sLx: 0.04, sRx: 0.06 }), t + st.seed),
  stand: (t, st) => POSES.idle(t, st),
  talk: (t, st) => {
    const p = breathe(P({}), t + st.seed);
    const g = Math.sin(t * 2.1 + st.seed) * 0.5 + 0.5;
    p.sRx = -0.45 - 0.25 * g; p.eR = -1.25 - 0.3 * Math.sin(t * 3.2); p.sRz = -0.18; p.wR = 0.2 * Math.sin(t * 2.7);
    p.sLx = -0.1 - 0.1 * Math.sin(t * 1.7); p.eL = -0.5;
    p.hdX += 0.05 * Math.sin(t * 4.3); p.hdZ += 0.04 * Math.sin(t * 1.3);
    return p;
  },
  walk: (t, st) => walkPose(st.walkPhase, st.speed, { amp: st.old ? 0.6 : 1 }),
  sneak: (t, st) => { const p = walkPose(st.walkPhase, st.speed, { amp: 0.7, lean: 0.38 }); p.hipY = -0.16; p.kL += 0.5; p.kR += 0.5; p.tLx -= 0.45; p.tRx -= 0.45; p.sLx = -0.7; p.sRx = -0.7; p.eL = -1.2; p.eR = -1.2; p.nkX = -0.3; return p; },
  run: (t, st) => { const p = walkPose(st.walkPhase, st.speed, { amp: 1.7, lean: 0.24 }); p.eL = -1.35; p.eR = -1.35; p.y *= 2.2; p.sLx *= 1.6; p.sRx *= 1.6; return p; },
  push_cart: (t, st) => { const p = walkPose(st.walkPhase, st.speed, { amp: 0.55, lean: 0.18 }); p.sLx = -1.05; p.sRx = -1.05; p.eL = -0.35; p.eR = -0.35; p.sLz = 0.1; p.sRz = -0.1; return p; },
  surprised: (t, st) => {
    const k = clamp(t / 0.25), j = Math.sin(clamp(t / 0.35) * PI) * 0.06;
    const p = P({ y: j, spX: -0.12 * k, nkX: -0.08 * k, sLz: lerp(0.12, 0.85, k), sRz: lerp(-0.12, -0.85, k), sLx: -0.5 * k, sRx: -0.5 * k, eL: -1.1 * k, eR: -1.1 * k });
    return breathe(p, t, 0.5);
  },
  shock: (t, st) => { const p = P({ spX: -0.1, nkX: -0.05, sLz: 0.55, sRz: -0.55, sLx: -0.7, sRx: -0.7, eL: -1.7, eR: -1.7, kL: 0.15, kR: 0.15, hipY: -0.03 }); p.hdZ = 0.01 * Math.sin(t * 30); return p; },
  shout: (t, st) => {
    const k = clamp(t / 0.18);
    const p = P({ spX: 0.2 * k, nkX: -0.25 * k, hdX: -0.15 * k, sLx: 0.45 * k, sRx: 0.45 * k, sLz: 0.32, sRz: -0.32, eL: -0.3, eR: -0.3, kL: 0.12, kR: 0.12, tLz: 0.08, tRz: -0.08 });
    p.spX += 0.01 * Math.sin(t * 40); return p;
  },
  point: (t, st) => { const k = ease.outBack(clamp(t / 0.35)); const p = breathe(P({ sRx: -1.45 * k, sRz: -0.05, eR: -0.05, spY: -0.12 * k }), t); return p; },
  give: (t, st) => { const k = ease.outCubic(clamp(t / 0.4)); return breathe(P({ sLx: -0.95 * k, sRx: -0.95 * k, eL: -0.55 * k, eR: -0.55 * k, sLz: 0.06, sRz: -0.06, spX: 0.06 * k }), t); },
  show: (t, st) => { const k = ease.outCubic(clamp(t / 0.4)); return breathe(P({ sRx: -1.15 * k, eR: -0.45, sRz: -0.12, spY: -0.1 * k }), t); },
  read: (t, st) => breathe(P({ sRx: -0.55, sRz: -0.32, eR: -1.75, wR: 0.2, sLx: -0.25, sLz: 0.1, eL: -0.9, nkX: 0.1 }), t),
  pocket: (t, st) => { const k = clamp(t / 0.35); return breathe(P({ sRx: 0.12 * k, sRz: -0.04 - 0.08 * k, eR: -0.55 * k, nkX: 0.15 * k }), t); },
  lock: (t, st) => { const w = Math.sin(t * 7) * 0.08; return breathe(P({ sLx: -1.05, sRx: -1.05 + w, eL: -0.5, eR: -0.55, sLz: 0.0, sRz: 0.0, spX: 0.1, nkX: 0.2 }), t); },
  type: (t, st) => { const p = sitBase({ sLx: -0.55, sRx: -0.55, eL: -0.95, eR: -0.95, sLz: 0.12, sRz: -0.12, spX: 0.12, nkX: 0.1 }); p.eL += Math.sin(t * 17) * 0.05; p.eR += Math.sin(t * 19 + 1) * 0.05; return breathe(p, t, 0.5); },
  headdesk: (t, st) => { const k = ease.inCubic(clamp(t / 0.32)); const b = t > 0.32 ? Math.exp(-(t - 0.32) * 8) * Math.sin((t - 0.32) * 30) * 0.04 : 0; return sitBase({ spX: 0.12 + 0.85 * k + b, nkX: 0.35 * k, sLx: -0.55 + 0.2 * k, sRx: -0.55 + 0.2 * k, eL: -0.95 + 0.4 * k, eR: -0.95 + 0.4 * k, sLz: 0.12 + 0.3 * k, sRz: -0.12 - 0.3 * k }); },
  sit: (t, st) => breathe(sitBase(), t + st.seed, 0.7),
  sit_talk: (t, st) => { const p = breathe(sitBase(), t + st.seed, 0.7); p.sRx = -0.75 - 0.2 * Math.sin(t * 2.2); p.eR = -1.3 - 0.25 * Math.sin(t * 3.1); p.sRz = -0.2; p.hdX += 0.05 * Math.sin(t * 4.1); return p; },
  laugh: (t, st) => {
    const sitting = st.pose === 'sit';
    const base = sitting ? sitBase() : P({});
    const b = Math.abs(Math.sin(t * 9));
    base.spX += -0.12 - 0.04 * b; base.nkX -= 0.1; base.hdX -= 0.12 + 0.05 * b; base.y += sitting ? 0 : 0.01 * b;
    base.sLx = -0.5; base.sRx = -0.5; base.eL = -1.4; base.eR = -1.4; base.sLz = 0.2; base.sRz = -0.2;
    return base;
  },
  cover: (t, st) => { const k = ease.outCubic(clamp(t / 0.3)); return P({ sLx: -2.5 * k, sRx: -2.5 * k, sLz: 0.55 * k, sRz: -0.55 * k, eL: -1.9 * k, eR: -1.9 * k, spX: 0.12 * k, nkX: 0.15 * k, kL: 0.12, kR: 0.12 }); },
  breathe: (t, st) => { const b = Math.sin(t * 1.1) * 0.5 + 0.5; return P({ spX: -0.06 * b, nkX: -0.05 * b, sLz: 0.12 + 0.08 * b, sRz: -0.12 - 0.08 * b, y: 0.012 * b, sLx: 0.05, sRx: 0.05 }); },
  embarrassed: (t, st) => breathe(P({ sRx: -2.3, sRz: -0.55, eR: -2.2, nkZ: 0.12, hdZ: 0.1, spZ: 0.04, sLx: 0.05 }), t),
  search: (t, st) => { const s = Math.sin(t * 2.2); return P({ spX: 1.0, nkX: -0.4, kL: 0.55, kR: 0.55, tLx: -0.5, tRx: -0.5, hipY: -0.1, sLx: -1.2 + 0.2 * s, sRx: -1.2 - 0.2 * s, eL: -0.3, eR: -0.3, spY: 0.15 * s }); },
  eat: (t, st) => { const c = (Math.sin(t * 3.2) * 0.5 + 0.5); return breathe(P({ sLx: -0.65, sLz: 0.05, eL: -1.45, sRx: -0.7 - 0.35 * c, eR: -1.5 - 0.7 * c, sRz: -0.05, nkX: 0.06 }), t); },
  phone: (t, st) => breathe(P({ sRx: -0.55, sRz: -0.5, eR: -2.5, wR: 0.3, nkZ: -0.14, hdZ: -0.06, sLx: 0.1 }), t),
  pet: (t, st) => { const s = Math.sin(t * 3.0); return P({ spX: 0.32, nkX: 0.15, sRx: -1.05 + 0.12 * s, sRz: -0.1, eR: -0.25, sLx: 0.1, kL: 0.08, kR: 0.08 }); },
  duck: (t, st) => { const k = ease.outCubic(clamp(t / 0.25)); return P({ hipY: -0.32 * k, tLx: -1.0 * k, tRx: -1.0 * k, kL: 1.7 * k, kR: 1.7 * k, fL: -0.6 * k, fR: -0.6 * k, spX: 0.65 * k, nkX: 0.3 * k, sLx: -2.6 * k, sRx: -2.6 * k, sLz: 0.6 * k, sRz: -0.6 * k, eL: -1.8 * k, eR: -1.8 * k }); },
  lying: (t, st) => P({ lying: 1, sLz: 0.18, sRz: -0.18, sLx: 0, sRx: 0, eL: -0.2, eR: -0.2, spX: Math.sin(t * 1.3) * 0.01 }),
  sleep: (t, st) => P({ lying: 1, sLz: 0.2, sRz: -0.2, eL: -0.25, eR: -0.25, spX: Math.sin(t * 1.0) * 0.015, hdY: 0.25 }),
  crouch: (t, st) => breathe(P({ hipY: -0.42, tLx: -1.65, tRx: -1.65, kL: 2.25, kR: 2.25, fL: -0.6, fR: -0.6, tLz: 0.18, tRz: -0.18, spX: 0.38, nkX: -0.25, sLx: -0.9, sRx: -0.9, eL: -0.7, eR: -0.7 }), t, 0.6),
  grip: (t, st) => { const p = st.pose === 'crouch' ? POSES.crouch(t, st) : breathe(P({}), t); p.sRx = -0.75; p.sRz = 0.55; p.eR = -0.65; return p; },
  reach: (t, st) => { const k = ease.outCubic(clamp(t / 0.5)); const p = st.pose === 'sit' ? sitBase() : breathe(P({}), t); p.sRx = lerp(p.sRx, -1.15, k); p.eR = lerp(p.eR, -0.25, k); p.spX += 0.2 * k; return p; },
  hang: (t, st) => { const s = Math.sin(t * 1.8); return breathe(P({ sRx: -2.1 + 0.15 * s, sRz: -0.1, eR: -0.45, sLx: -0.7, eL: -0.9, spX: -0.06, nkX: -0.15 }), t); },
  fold: (t, st) => { const s = Math.sin(t * 4) * 0.12; return breathe(P({ sLx: -0.75, sRx: -0.75, eL: -1.1 + s, eR: -1.1 - s, sLz: 0.0, sRz: 0.0, nkX: 0.22 }), t); },
  slip: (t, st) => { const k = ease.inOutCubic(clamp(t / 0.6)); return breathe(P({ sRx: -0.9 * k, sRz: -0.12, eR: -0.4, spX: 0.12 * k, nkX: 0.18 }), t); },
  write: (t, st) => { const p = sitBase({ sRx: -0.75, eR: -1.15, sRz: -0.18, sLx: -0.6, eL: -1.1, sLz: 0.15, spX: 0.16, nkX: 0.18 }); p.wR = Math.sin(t * 9) * 0.15; p.eR += Math.sin(t * 6.5) * 0.06; return p; },
  write_stuck: (t, st) => { const p = sitBase({ sRx: -0.8, eR: -1.4, sRz: -0.15, sLx: -0.9, eL: -2.3, sLz: 0.4, spX: 0.25, nkX: 0.15, nkZ: 0.15, hdZ: 0.12 }); p.wR = Math.max(0, Math.sin(t * 5)) * 0.3; return p; },
  headhands: (t, st) => sitBase({ sLx: -1.2, sRx: -1.2, eL: -2.35, eR: -2.35, sLz: 0.35, sRz: -0.35, spX: 0.42, nkX: 0.25, hdX: Math.sin(t * 0.8) * 0.04 }),
  shy: (t, st) => breathe(P({ sLx: -0.32, sRx: -0.32, sLz: -0.12, sRz: 0.12, eL: -0.95, eR: -0.95, nkX: 0.18, hdZ: 0.12 + 0.04 * Math.sin(t * 1.5), spY: 0.06 * Math.sin(t * 1.2) }), t),
  lean: (t, st) => { const p = breathe(sitBase(), t, 0.5); p.spZ = 0.2; p.nkZ = 0.25; p.hdZ = 0.2; p.sLx = -0.5; p.sRx = -0.5; return p; },
  rail: (t, st) => breathe(P({ sLx: -1.15, sRx: -1.15, eL: -1.15, eR: -1.15, sLz: 0.18, sRz: -0.18, spX: 0.22, nkX: -0.12, kL: 0.06, kR: 0.1 }), t),
  wave: (t, st) => breathe(P({ sRx: -0.25, sRz: -2.55, eR: -0.45 - 0.35 * Math.sin(t * 7), sLx: 0.05 }), t),
  thumbsup: (t, st) => { const k = ease.outBack(clamp(t / 0.3)); return breathe(P({ sRx: -0.75 * k, eR: -1.6 * k, sRz: -0.25, sLx: -0.65, eL: -1.45 }), t); },
  whisper: (t, st) => { const p = st.pose === 'sit' ? sitBase() : P({}); p.spX += 0.22; p.spZ = -0.12; p.sRx = -0.95; p.eR = -2.35; p.sRz = -0.32; p.nkZ = -0.1; return breathe(p, t, 0.5); },
  wink: (t, st) => POSES.idle(t, st),
  stuck: (t, st) => POSES.idle(t, st),
};
const SEATED = new Set(['sit', 'sit_talk', 'type', 'headdesk', 'write', 'write_stuck', 'headhands', 'lean', 'whisper_sit']);

// ------------------------------------------------------------------ yardımcılar
function capsule(r, len, m, cs = 4, rs = 10) { const g = G.cap(r, len, cs, rs); const me = new THREE.Mesh(g, m); me.castShadow = true; me.receiveShadow = true; return me; }
function sphere(r, m, ws = 20, hs = 14) { const me = new THREE.Mesh(G.sph(r, ws, hs), m); me.castShadow = true; me.receiveShadow = true; return me; }
function lathe(pts, m, seg = 28, ps = 0, pl = PI * 2) { const me = new THREE.Mesh(G.lathe(pts, seg, ps, pl), m); me.castShadow = true; me.receiveShadow = true; return me; }

const SKINS = ['#f0c6a5', '#e2a882', '#d49a76', '#c88a64', '#b9774f', '#9a6040', '#f3d0b5'];
const HAIRS = ['#1b1410', '#2b1c13', '#4a3020', '#6e4a2e', '#a5452a', '#cfc9c1', '#8a7a6a', '#d9b780'];
const CLOTH = ['#3b4a5e', '#7a3a33', '#5a6b4a', '#a0784e', '#2f3640', '#6a5a7a', '#c9a24a', '#4a6a7a', '#8a8a8a', '#d9cbb2', '#3a5a4a', '#9a4a5a'];

export function randomLook(seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const female = r() < 0.5;
  const old = r() < 0.25 ? 0.4 + r() * 0.5 : 0;
  const style = female ? pick(['bob', 'long', 'bun', 'short_f']) : pick(['short', 'curly', 'side', 'messy', old ? 'sides' : 'short', old ? 'bald' : 'side']);
  const hc = old ? pick(['#cfc9c1', '#b8b2aa', '#e6e2dc']) : pick(HAIRS);
  const top = pick(CLOTH);
  const o = { top, pants: pick(['#2a2f38', '#3a3530', '#4a4f5a', '#2e3a4a', '#5a4a3a']), shoes: pick(['#2a211b', '#ece7dd', '#3a3a40', '#5b2f1f']) };
  const layer = r();
  if (layer < 0.3) o.coat = pick(['#5a4a3a', '#2a2c33', '#7a6a52', '#3a4a3a', '#8a5a3a']);
  else if (layer < 0.55) o.jacket = pick(CLOTH);
  if (female && r() < 0.4) { o.skirt = pick(CLOTH); }
  if (r() < 0.2) o.scarf = pick(['#c9a24a', '#9a3a3a', '#3a5a7a', '#d9cbb2']);
  if (r() < 0.15 && !female) o.cap = pick(['#3a3a3a', '#6c5844', '#2a3a4a']);
  return {
    skin: pick(SKINS), hair: { style, color: hc }, female, old,
    build: { height: (female ? 0.93 : 1.0) * (0.95 + r() * 0.1), width: 0.92 + r() * 0.25 },
    mustache: !female && r() < 0.3 ? { color: hc, size: 0.9 + r() * 0.3 } : undefined,
    glasses: r() < 0.2 ? '#2a2420' : undefined,
    outfits: { main: o }, default: 'main',
  };
}

// ------------------------------------------------------------------ karakter
export class Character {
  constructor(id, def, { seed = 0 } = {}) {
    this.id = id; this.def = def; this.seed = (hashString(id) % 1000) / 100 + seed;
    this.root = new THREE.Group(); this.root.name = id;
    this.outfitName = null;
    this.props = {}; this.held = null; this.held2 = null;
    this._build();
    this.setOutfit(def.default || Object.keys(def.outfits || { main: {} })[0]);
  }

  _build() {
    const d = this.def;
    const H = d.build?.height ?? 1, Wd = d.build?.width ?? 1;
    this.H = H; this.Wd = Wd;
    const skinC = d.skin || '#e2a882';
    this.mSkin = mat(skinC, { rough: 0.62, em: skinC, emI: 0.07, unique: true });
    this.mSkinDark = mat(new THREE.Color(skinC).multiplyScalar(0.86).getStyle(), { rough: 0.7, unique: true });
    this.mHair = mat(d.hair?.color || '#2b1c13', { rough: 0.55, unique: true });
    this.mTop = mat('#888888', { rough: 0.85, unique: true });
    this.mSleeve = mat('#888888', { rough: 0.85, unique: true });
    this.mPants = mat('#333333', { rough: 0.85, unique: true });
    this.mShoe = mat('#222222', { rough: 0.55, unique: true });
    this.mCoat = mat('#b8844e', { rough: 0.92, unique: true, side: THREE.DoubleSide });
    this.mJacket = mat('#4f5a3c', { rough: 0.85, unique: true, side: THREE.DoubleSide });
    this.mVest = mat('#6b4a32', { rough: 0.85, unique: true });
    this.mSkirt = mat('#4a3a48', { rough: 0.85, unique: true, side: THREE.DoubleSide });
    this.mScarf = mat('#d99a32', { rough: 0.95, unique: true });
    this.mAcc = mat('#333333', { rough: 0.6, unique: true });
    const body = (this.body = new THREE.Group());
    body.scale.setScalar(H);
    this.root.add(body);

    // ---- iskelet
    const hips = (this.hips = new THREE.Group()); hips.position.y = 0.9; body.add(hips);
    const spine = (this.spine = new THREE.Group()); spine.position.y = 0.06; hips.add(spine);
    const neck = (this.neck = new THREE.Group()); neck.position.y = 0.47; spine.add(neck);
    const head = (this.head = new THREE.Group()); head.position.y = 0.07; neck.add(head);
    const mk = (side) => {
      const s = new THREE.Group(); s.position.set(side * 0.172 * Wd, 0.395, 0); spine.add(s);
      const up = capsule(0.047 * Math.sqrt(Wd), 0.2, this.mSleeve); up.position.y = -0.135; s.add(up);
      const el = new THREE.Group(); el.position.y = -0.28; s.add(el);
      const fo = capsule(0.041 * Math.sqrt(Wd), 0.19, this.mSleeve); fo.position.y = -0.12; el.add(fo);
      const cuff = capsule(0.044, 0.02, this.mSleeve); cuff.position.y = -0.235; el.add(cuff);
      const hand = new THREE.Group(); hand.position.y = -0.27; el.add(hand);
      const palm = sphere(0.046, this.mSkin, 14, 10); palm.scale.set(0.85, 1.15, 0.62); palm.position.y = -0.025; hand.add(palm);
      const th = sphere(0.019, this.mSkin, 8, 6); th.position.set(-side * 0.032, -0.012, 0.022); hand.add(th);
      return { s, el, hand, up, fo };
    };
    this.armL = mk(1); this.armR = mk(-1);
    const leg = (side) => {
      const t = new THREE.Group(); t.position.set(side * 0.086 * Wd, -0.04, 0); hips.add(t);
      const th = capsule(0.068 * Math.sqrt(Wd), 0.3, this.mPants); th.position.y = -0.2; t.add(th);
      const k = new THREE.Group(); k.position.y = -0.42; t.add(k);
      const sh = capsule(0.054 * Math.sqrt(Wd), 0.3, this.mPants); sh.position.y = -0.19; k.add(sh);
      const f = new THREE.Group(); f.position.y = -0.4; k.add(f);
      const shoe = sphere(0.06, this.mShoe, 14, 10); shoe.scale.set(0.95, 0.72, 1.85); shoe.position.set(0, -0.03, 0.045); f.add(shoe);
      return { t, k, f, th, sh };
    };
    this.legL = leg(1); this.legR = leg(-1);

    // ---- gövde
    const dz = 0.72;
    const torso = lathe([[0.001, -0.1], [0.15, -0.1], [0.158, 0.0], [0.15, 0.1], [0.165, 0.22], [0.178, 0.32], [0.172, 0.39], [0.14, 0.44], [0.07, 0.48], [0.001, 0.49]], this.mTop);
    torso.scale.set(Wd, 1, Wd * dz); spine.add(torso); this.torso = torso;
    const pelvis = lathe([[0.001, -0.1], [0.14, -0.1], [0.158, -0.02], [0.156, 0.07], [0.001, 0.08]], this.mPants);
    pelvis.scale.set(Wd, 1, Wd * 0.74); hips.add(pelvis); this.pelvis = pelvis;
    const neckM = capsule(0.05, 0.06, this.mSkin, 3, 10); neckM.position.y = 0.03; neck.add(neckM);

    // katmanlar
    const coat = (this.coat = new THREE.Group()); spine.add(coat);
    const cm = lathe([[0.1, 0.48], [0.168, 0.45], [0.192, 0.4], [0.198, 0.3], [0.188, 0.18], [0.178, 0.06], [0.192, -0.06], [0.215, -0.22], [0.24, -0.4], [0.262, -0.52]], this.mCoat, 32);
    cm.scale.set(Wd, 1, Wd * 0.8); coat.add(cm);
    const collar = new THREE.Mesh(G.tor(0.088, 0.03, 8, 22), this.mCoat); collar.rotation.x = PI / 2; collar.position.y = 0.455; collar.scale.set(Wd, Wd * 0.86, 1); coat.add(collar);
    for (const sd of [-1, 1]) {
      const lap = new THREE.Mesh(G.box(0.05, 0.2, 0.012), this.mCoat); lap.position.set(sd * 0.05 * Wd, 0.34, 0.152 * Wd); lap.rotation.set(-0.25, 0, sd * 0.38); coat.add(lap);
      const pk = new THREE.Mesh(G.box(0.1, 0.03, 0.015), this.mCoat); pk.position.set(sd * 0.115 * Wd, -0.1, 0.158 * Wd); pk.rotation.y = sd * 0.35; coat.add(pk);
    }
    const btnM = mat('#3a2a1e', { rough: 0.4 });
    for (const y of [0.22, 0.1, -0.02]) { const b = sphere(0.011, btnM, 8, 6); b.position.set(0.0, y, 0.142 * Wd); b.scale.z = 0.5; coat.add(b); }
    const jacket = (this.jacket = new THREE.Group()); spine.add(jacket);
    const jm = lathe([[0.1, 0.48], [0.17, 0.45], [0.192, 0.4], [0.194, 0.3], [0.182, 0.18], [0.172, 0.06], [0.174, -0.06], [0.178, -0.15]], this.mJacket, 30);
    jm.scale.set(Wd, 1, Wd * 0.78); jacket.add(jm);
    const jc = new THREE.Mesh(G.tor(0.085, 0.024, 8, 22), this.mJacket); jc.rotation.x = PI / 2; jc.position.y = 0.455; jc.scale.set(Wd, Wd * 0.86, 1); jacket.add(jc);
    const zip = new THREE.Mesh(G.box(0.012, 0.6, 0.01), mat('#2a2a2a', { rough: 0.4, metal: 0.5 })); zip.position.set(0, 0.15, 0.143 * Wd); jacket.add(zip);
    const vest = (this.vest = new THREE.Group()); spine.add(vest);
    const vm = lathe([[0.11, 0.42], [0.178, 0.38], [0.186, 0.28], [0.173, 0.14], [0.166, 0.02], [0.17, -0.08]], this.mVest, 28);
    vm.scale.set(Wd, 1, Wd * 0.77); vest.add(vm);
    for (const y of [0.25, 0.14, 0.03]) { const b = sphere(0.009, btnM, 8, 6); b.position.set(0.0, y, 0.134 * Wd); vest.add(b); }
    const apron = (this.apron = new THREE.Mesh(G.rbox(0.3 * Wd, 0.82, 0.012, 0.005), mat('#f2efe8', { rough: 0.9 }))); apron.position.set(0, -0.06, 0.13 * Wd); apron.castShadow = true; spine.add(apron);
    const skirt = (this.skirt = lathe([[0.155, 0.04], [0.165, -0.05], [0.215, -0.25], [0.262, -0.47]], this.mSkirt, 28)); skirt.scale.set(Wd, 1, Wd * 0.82); hips.add(skirt);
    const scarf = (this.scarf = new THREE.Group()); spine.add(scarf);
    const sc = new THREE.Mesh(G.tor(0.082, 0.042, 10, 22), this.mScarf); sc.rotation.x = PI / 2; sc.position.y = 0.45; sc.scale.set(Wd, Wd * 0.85, 1); scarf.add(sc);
    const se = new THREE.Mesh(G.rbox(0.065, 0.26, 0.022, 0.01), this.mScarf); se.position.set(0.05, 0.3, 0.148 * Wd); se.rotation.z = 0.12; scarf.add(se);
    scarf.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const lanyard = (this.lanyard = new THREE.Group()); spine.add(lanyard);
    const ly = new THREE.Mesh(G.tor(0.1, 0.004, 4, 24, PI), mat('#d23c3c')); ly.rotation.set(PI * 0.62, 0, PI); ly.position.set(0, 0.42, 0.04); lanyard.add(ly);
    const badge = new THREE.Mesh(G.rbox(0.055, 0.075, 0.006, 0.004), mat('#f4f4f4', { rough: 0.4 })); badge.position.set(0, 0.25, 0.134 * Wd); lanyard.add(badge);
    this.stripeTex = null;

    // ---- kafa
    this._buildHead();
  }

  _buildHead() {
    const d = this.def, head = this.head;
    const C = new THREE.Vector3(0, 0.13, 0);
    const R = 0.145;
    const hg = G.sph(R, 36, 26);
    const pa = hg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i); const k = y < 0 ? -y / R : 0;
      pa.setX(i, pa.getX(i) * (1 - 0.13 * k) * 0.98); pa.setZ(i, pa.getZ(i) * (1 - 0.04 * k) + (y < 0 ? 0.008 * k : 0)); pa.setY(i, y * 1.05);
    }
    hg.computeVertexNormals();
    const hm = new THREE.Mesh(hg, this.mSkin); hm.position.copy(C); hm.castShadow = true; head.add(hm);
    const face = (this.face = new THREE.Group()); face.position.copy(C); head.add(face);
    // kulaklar
    for (const sd of [-1, 1]) { const e = sphere(0.032, this.mSkin, 10, 8); e.scale.set(0.45, 0.85, 0.75); e.position.set(sd * 0.139, -0.005, -0.005); face.add(e); }
    // burun
    const nose = sphere(0.021, this.mSkinDark, 14, 10); nose.scale.set(0.85, 1.0, 1.15); nose.position.set(0, -0.032, 0.143); face.add(nose);
    // gözler
    const eyeW = mat('#fbf8f2', { rough: 0.25 });
    const irisM = mat(d.eyes || '#4a2f1c', { rough: 0.3 });
    const pupM = mat('#0b0806', { rough: 0.2 });
    const hiM = glow('#ffffff', 1.6);
    this.eyes = [];
    for (const sd of [-1, 1]) {
      const eg = new THREE.Group(); eg.position.set(sd * 0.056, -0.004, 0.112); eg.scale.z = 0.66; face.add(eg);
      const w = sphere(0.034, eyeW, 20, 16); eg.add(w);
      const ir = new THREE.Group(); ir.position.z = 0.03; eg.add(ir);
      const iris = sphere(0.0215, irisM, 16, 12); iris.scale.z = 0.42; ir.add(iris);
      const pup = sphere(0.0118, pupM, 12, 8); pup.scale.z = 0.42; pup.position.z = 0.0045; ir.add(pup);
      const hi = new THREE.Mesh(G.sph(0.0052, 6, 4), hiM); hi.position.set(0.0075, 0.0085, 0.0115); ir.add(hi);
      const hi2 = new THREE.Mesh(G.sph(0.0024, 6, 4), hiM); hi2.position.set(-0.006, -0.006, 0.011); ir.add(hi2);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0425, 20, 10, 0, PI * 2, 0, PI / 2), this.mSkin); eg.add(lid);
      const lidLo = new THREE.Mesh(new THREE.SphereGeometry(0.0415, 20, 8, 0, PI * 2, PI * 0.64, PI * 0.36), this.mSkin); eg.add(lidLo);
      let lash = null;
      if (d.female) { lash = new THREE.Mesh(G.tor(0.0425, 0.003, 4, 16, PI), mat('#1a1210')); lash.rotation.y = PI / 2; lid.add(lash); }
      this.eyes.push({ g: eg, ir, lid, pup, sd });
    }
    // kaşlar
    const browC = d.brows?.color || d.hair?.color || '#2b1c13';
    const browM = mat(browC, { rough: 0.7 });
    const bushy = d.brows?.bushy || (d.old ? 1.3 : 1);
    this.brows = [];
    for (const sd of [-1, 1]) {
      const b = new THREE.Group(); b.position.set(sd * 0.056, 0.06, 0.128); face.add(b);
      const m = capsule(0.0085 * bushy, 0.042, browM, 3, 6); m.rotation.z = PI / 2; m.castShadow = false; b.add(m);
      this.brows.push({ g: b, sd });
    }
    // ağız
    const mouth = (this.mouth = new THREE.Group()); mouth.position.set(0, -0.074, 0.126); mouth.rotation.x = -0.28; face.add(mouth);
    const lipM = mat(d.female ? '#b9555a' : '#8a4a40', { rough: 0.5 });
    this.smile = new THREE.Mesh(G.tor(0.026, 0.0055, 6, 16, PI), lipM); this.smile.rotation.z = PI; mouth.add(this.smile);
    this.mouthOpen = sphere(0.024, mat('#3d1414', { rough: 0.7 }), 14, 10); this.mouthOpen.scale.set(1.1, 0.5, 0.35); mouth.add(this.mouthOpen);
    const teeth = new THREE.Mesh(G.box(0.03, 0.007, 0.01), mat('#f6f3ee', { rough: 0.3 })); teeth.position.set(0, 0.008, 0.004); this.mouthOpen.add(teeth);
    // yanak kızarması
    const blushM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6b7a'), transparent: true, opacity: 0, depthWrite: false });
    this.blush = [];
    for (const sd of [-1, 1]) { const b = new THREE.Mesh(G.sph(0.024, 10, 8), blushM); b.scale.set(1.2, 0.8, 0.2); b.position.set(sd * 0.084, -0.035, 0.118); face.add(b); this.blush.push(b); }
    this.blushM = blushM;
    // sakal gölgesi
    if (d.stubble) {
      const st = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 28, 14, -PI * 0.5, PI, PI * 0.56, PI * 0.3), new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a2a22'), transparent: true, opacity: d.stubble * 0.32, roughness: 1, depthWrite: false }));
      st.scale.set(0.95, 1.05, 1.0); face.add(st);
    }
    if (d.beard) {
      const bm = mat(d.beard.color, { rough: 0.8 });
      const br = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 28, 14, -PI * 0.5, PI, PI * 0.58, PI * 0.36), bm); br.scale.set(0.95, 1.08, 1.05); br.castShadow = true; face.add(br);
      const ch = sphere(0.05, bm, 12, 10); ch.position.set(0, -0.135, 0.07); ch.scale.set(1.1, 0.8, 0.9); face.add(ch);
    }
    if (d.mustache) this._mustache(face, d.mustache.color, d.mustache.size || 1);
    if (d.glasses) this._glasses(face, d.glasses, false);
    this._hair(face, d.hair?.style || 'short');
    // değişken aksesuarlar (kıyafete bağlı)
    this.accSun = this._glasses(face, '#111111', true); this.accSun.visible = false;
    this.accFake = this._mustache(face, '#120d0a', 1.35); this.accFake.visible = false; this.fakeRest = this.accFake.position.clone();
    this.accCap = this._cap(face); this.accCap.visible = false;
    this.accHat = this._hat(face); this.accHat.visible = false;
    this.accBeret = this._beret(face); this.accBeret.visible = false;
    this.accTray = this._tray(face); this.accTray.visible = false;
  }

  _mustache(face, color, size) {
    const g = new THREE.Group(); g.position.set(0, -0.054, 0.138); face.add(g);
    const m = mat(color, { rough: 0.75 });
    for (const sd of [-1, 1]) {
      const c = capsule(0.0115 * size, 0.036 * size, m, 3, 8); c.castShadow = false;
      c.rotation.z = sd * (PI / 2 - 0.38); c.position.set(sd * 0.024 * size, -0.006 * size, -0.002); g.add(c);
    }
    return g;
  }
  _glasses(face, color, sun) {
    const g = new THREE.Group(); g.position.set(0, 0.008, 0.147); face.add(g);
    const fm = mat(color, { rough: 0.35, metal: 0.4 });
    for (const sd of [-1, 1]) {
      const ring = new THREE.Mesh(G.tor(0.031, 0.0042, 6, 20), fm); ring.position.x = sd * 0.055; g.add(ring);
      if (sun) { const l = new THREE.Mesh(G.cyl(0.031, 0.031, 0.004, 20), mat('#0a0a0e', { rough: 0.05, metal: 0.6 })); l.rotation.x = PI / 2; l.position.x = sd * 0.055; g.add(l); }
      const arm = new THREE.Mesh(G.box(0.004, 0.004, 0.13), fm); arm.position.set(sd * 0.088, 0.0, -0.065); g.add(arm);
    }
    const br = new THREE.Mesh(G.box(0.026, 0.004, 0.004), fm); g.add(br);
    return g;
  }
  _hair(face, style) {
    const m = this.mHair; const R = 0.145;
    const cap = (r, tilt, th = 0.52, y = 0.012, z = -0.012) => { const c = new THREE.Mesh(new THREE.SphereGeometry(r, 30, 16, 0, PI * 2, 0, PI * th), m); c.rotation.x = tilt; c.position.set(0, y, z); c.castShadow = true; face.add(c); return c; };
    const blob = (r, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => { const b = sphere(r, m, 14, 10); b.position.set(x, y, z); b.scale.set(sx, sy, sz); b.rotation.set(rx, 0, rz); face.add(b); return b; };
    const r = mulberry32(hashString(this.id));
    switch (style) {
      case 'messy': {
        cap(0.153, -0.38, 0.55);
        const tufts = [[-0.07, 0.115, 0.07], [-0.02, 0.135, 0.075], [0.035, 0.13, 0.07], [0.08, 0.11, 0.055], [-0.1, 0.09, 0.03], [0.0, 0.15, 0.02], [0.06, 0.145, 0.0], [-0.055, 0.15, -0.01]];
        for (const [x, y, z] of tufts) blob(0.045 + r() * 0.012, x, y, z, 1.1, 0.7, 1.15, -0.5 + r() * 0.3, (r() - 0.5) * 0.6);
        for (const sd of [-1, 1]) blob(0.02, sd * 0.133, 0.01, 0.035, 0.6, 1.6, 1);
        break;
      }
      case 'bob': case 'short_f': {
        cap(0.158, -0.15, 0.56);
        const long = style === 'bob';
        const prof = long ? [[0.159, 0.04], [0.168, -0.03], [0.165, -0.1], [0.135, -0.135]] : [[0.158, 0.03], [0.162, -0.03], [0.148, -0.07]];
        const sideV = new THREE.Mesh(G.lathe(prof, 30, 0.95, PI * 2 - 1.9), m); sideV.castShadow = true; face.add(sideV);
        blob(0.072, 0, 0.088, 0.112, 1.55, 0.42, 0.62, 0.35);
        break;
      }
      case 'sides': case 'bald': {
        const ring = new THREE.Mesh(G.lathe([[0.146, 0.05], [0.153, 0.0], [0.149, -0.055]], 30, 1.2, PI * 2 - 2.4), m);
        if (style === 'bald') ring.scale.set(0.99, 0.7, 0.99);
        face.add(ring);
        break;
      }
      case 'side': {
        cap(0.152, -0.22, 0.54);
        blob(0.06, -0.035, 0.125, 0.06, 1.6, 0.55, 1.2, -0.3, 0.2);
        for (const sd of [-1, 1]) blob(0.018, sd * 0.134, 0.01, 0.03, 0.6, 1.5, 1);
        break;
      }
      case 'curly': {
        cap(0.149, -0.2, 0.55);
        for (let i = 0; i < 34; i++) {
          const th = r() * 1.25, ph = r() * PI * 2;
          if (th > 0.8 && Math.cos(ph) > 0.4) continue;
          blob(0.036 + r() * 0.012, Math.sin(th) * Math.sin(ph) * 0.152, Math.cos(th) * 0.152 + 0.01, Math.sin(th) * Math.cos(ph) * 0.152 - 0.015);
        }
        break;
      }
      case 'bun': {
        cap(0.151, -0.18, 0.55);
        blob(0.056, 0, 0.12, -0.095);
        break;
      }
      case 'long': {
        cap(0.155, -0.1, 0.56);
        const back = new THREE.Mesh(G.lathe([[0.158, 0.03], [0.168, -0.08], [0.165, -0.2], [0.15, -0.32]], 30, 1.25, PI * 2 - 2.5), m); back.castShadow = true; face.add(back);
        for (const sd of [-1, 1]) blob(0.048, sd * 0.128, -0.07, 0.05, 0.45, 1.5, 0.6);
        blob(0.07, 0.02, 0.09, 0.105, 1.5, 0.4, 0.6, 0.35, -0.2);
        break;
      }
      default: { // short
        cap(0.149, -0.28, 0.5);
        for (const sd of [-1, 1]) blob(0.018, sd * 0.132, 0.01, 0.03, 0.6, 1.4, 1);
      }
    }
    void R;
  }
  _cap(face) {
    const g = new THREE.Group(); face.add(g);
    const m = this.mAcc;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.162, 26, 12, 0, PI * 2, 0, PI * 0.42), m); top.scale.set(1, 0.72, 1.06); top.position.set(0, 0.035, 0.0); top.rotation.x = 0.12; top.castShadow = true; g.add(top);
    const brim = new THREE.Mesh(G.rbox(0.2, 0.014, 0.08, 0.006), m); brim.position.set(0, 0.075, 0.15); brim.rotation.x = 0.28; g.add(brim);
    return g;
  }
  _hat(face) {
    const g = new THREE.Group(); face.add(g);
    const m = this.mAcc;
    const crown = new THREE.Mesh(G.cyl(0.115, 0.135, 0.12, 24), m); crown.position.y = 0.14; crown.castShadow = true; g.add(crown);
    const brim = new THREE.Mesh(G.cyl(0.235, 0.235, 0.012, 28), m); brim.position.y = 0.085; brim.castShadow = true; g.add(brim);
    const band = new THREE.Mesh(G.cyl(0.136, 0.136, 0.03, 24), mat('#0b0b0d')); band.position.y = 0.1; g.add(band);
    return g;
  }
  _beret(face) {
    const g = new THREE.Group(); face.add(g);
    const b = new THREE.Mesh(G.sph(0.168, 24, 12), this.mAcc); b.scale.set(1.05, 0.34, 1.05); b.position.set(0.02, 0.118, -0.01); b.rotation.z = -0.22; b.castShadow = true; g.add(b);
    return g;
  }
  _tray(face) {
    const g = new THREE.Group(); g.position.y = 0.175; face.add(g);
    const pad = new THREE.Mesh(G.tor(0.06, 0.025, 8, 16), mat('#d9cbb2')); pad.rotation.x = PI / 2; g.add(pad);
    const tray = new THREE.Mesh(G.cyl(0.33, 0.31, 0.03, 32), mat('#c9b48a', { rough: 0.6 })); tray.position.y = 0.03; tray.castShadow = true; g.add(tray);
    const simM = mat('#b8743a', { rough: 0.7 });
    const r = mulberry32(5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2, rr = i < 8 ? 0.22 : 0.09;
      const s = new THREE.Mesh(G.tor(0.052, 0.02, 8, 18), simM); s.rotation.set(PI / 2 + (r() - 0.5) * 0.3, 0, a); s.position.set(Math.cos(a) * rr, 0.06 + (i >= 8 ? 0.03 : 0), Math.sin(a) * rr); s.castShadow = true; g.add(s);
    }
    return g;
  }

  setOutfit(name) {
    if (!name || name === this.outfitName) return;
    const o = (this.def.outfits || {})[name] || Object.values(this.def.outfits || { main: {} })[0] || {};
    this.outfitName = name; this.outfit = o;
    this.mTop.color.set(o.top || '#888');
    if (o.stripes) { this.mTop.map = TEX.stripes(o.top, o.stripes, 14); this.mTop.color.set('#ffffff'); this.mTop.needsUpdate = true; }
    const layer = o.coat || o.jacket;
    this.mSleeve.color.set(layer || o.top || '#888'); this.mSleeve.map = o.stripes && !layer ? this.mTop.map : null; this.mSleeve.needsUpdate = true;
    if (o.coat) { this.mCoat.color.set(o.coat); this.mCoat.map = /^#b8/.test(o.coat) ? TEX.wool(o.coat, [2, 2]) : null; if (this.mCoat.map) this.mCoat.color.set('#ffffff'); this.mCoat.needsUpdate = true; }
    if (o.jacket) this.mJacket.color.set(o.jacket);
    if (o.vest) this.mVest.color.set(o.vest);
    const pants = o.skirt ? (o.legs || this.def.skin) : (o.pants || '#333');
    this.mPants.color.set(pants);
    if (o.skirt) { this.mSkirt.color.set(o.skirt); this.legL.th.material = this.legR.th.material = this.mSkin; this.legL.sh.material = this.legR.sh.material = this.mSkin; }
    this.pelvis.material = o.skirt ? this.mSkirt : this.mPants;
    this.mShoe.color.set(o.shoes || '#222');
    if (o.scarf) this.mScarf.color.set(o.scarf);
    this.coat.visible = !!o.coat; this.jacket.visible = !!o.jacket; this.vest.visible = !!o.vest; this.apron.visible = !!o.apron;
    this.skirt.visible = !!o.skirt; this.scarf.visible = !!o.scarf; this.lanyard.visible = !!o.lanyard;
    this.accSun.visible = !!o.sunglasses; this.accFake.visible = !!o.fakeMustache;
    const acc = o.cap || o.hat || o.beret;
    if (acc) this.mAcc.color.set(acc);
    this.accCap.visible = !!o.cap; this.accHat.visible = !!o.hat; this.accBeret.visible = !!o.beret; this.accTray.visible = !!o.tray;
  }

  // ---------------------------------------------------------------- dünya konumları
  worldOf(obj, local = [0, 0, 0]) { obj.updateWorldMatrix(true, false); return new THREE.Vector3(...local).applyMatrix4(obj.matrixWorld); }
  headPos() { return this.worldOf(this.head, [0, 0.13, 0.02]); }
  eyePos() { return this.worldOf(this.head, [0, 0.135, 0.1]); }
  chestPos() { return this.worldOf(this.spine, [0, 0.3, 0.1]); }
  handPos(side = 'R') { return this.worldOf((side === 'R' ? this.armR : this.armL).hand, [0, -0.04, 0.02]); }
  headHeight() { return (0.9 + 0.06 + 0.47 + 0.07 + 0.13) * this.H; }

  // ---------------------------------------------------------------- kare güncellemesi
  // st: { pos: Vector3, face: rad, action, actionT, prevAction, prevT, blend, expr, prevExpr, exprBlend, look: Vector3|null,
  //       mouth: 0..1, walkPhase, speed, pose, t }
  update(t, st) {
    st.seed = this.seed; st.old = this.def.old || 0;
    const A = POSES[st.action] || POSES.idle, B = POSES[st.prevAction] || POSES.idle;
    let p = A(Math.max(0, st.actionT), st);
    if (st.blend < 1) p = mixPose(B(Math.max(0, st.prevT), st), p, st.blend);
    // otururken ayakta pozlara (konuşma vb.) oturma tabanını uygula
    if (st.pose === 'sit' && !SEATED.has(st.action) && !['laugh', 'whisper', 'reach', 'lean'].includes(st.action)) {
      const s = sitBase();
      for (const k of ['hipY', 'tLx', 'tRx', 'kL', 'kR', 'fL', 'fR', 'tLz', 'tRz']) p[k] = s[k];
    }
    if (st.pose === 'crouch' && !['crouch', 'grip'].includes(st.action)) {
      const s = POSES.crouch(t, st);
      for (const k of ['hipY', 'tLx', 'tRx', 'kL', 'kR', 'fL', 'fR', 'tLz', 'tRz', 'spX']) p[k] = s[k];
    }
    if (st.pose === 'lying' && !p.lying) { const s = POSES.lying(t, st); Object.assign(p, s); }
    // yaşlı duruşu
    if (st.old) { p.spX += 0.12 * st.old; p.nkX += 0.08 * st.old; p.hdX -= 0.06 * st.old; p.kL += 0.05; p.kR += 0.05; }

    // bakış
    let yaw = 0, pitch = 0;
    if (st.look) {
      const hp = this.headPos();
      const d = st.look.clone().sub(hp);
      const fwdYaw = Math.atan2(d.x, d.z) - st.face;
      yaw = Math.atan2(Math.sin(fwdYaw), Math.cos(fwdYaw));
      pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      yaw = clamp(yaw, -1.25, 1.25); pitch = clamp(pitch, -0.6, 0.5);
      if (p.lying) { yaw *= 0.4; pitch = 0; }
    }
    if (st.lookAround) { yaw += Math.sin(t * 0.9 + this.seed) * 0.6; pitch += Math.sin(t * 0.5) * 0.05; }
    const lk = st.lookK ?? 1;
    p.spY += yaw * 0.2 * lk; p.nkY += yaw * 0.3 * lk; p.hdY += yaw * 0.42 * lk;
    p.nkX += -pitch * 0.3 * lk; p.hdX += -pitch * 0.5 * lk;
    // mikro hareket
    p.hdY += noise3(t * 0.6, this.seed, 1) * 0.03; p.hdX += noise3(t * 0.5, this.seed, 2) * 0.02;

    // uygula
    const r = this.root;
    r.position.copy(st.pos);
    r.rotation.set(0, st.face, 0);
    if (p.lying > 0.5) { r.rotation.set(-PI / 2, 0, 0, 'YXZ'); r.rotation.y = st.face; }
    this.body.position.y = p.y * this.H;
    this.hips.position.y = 0.9 + p.hipY;
    this.hips.rotation.set(p.hipX, 0, p.hipZ);
    this.spine.rotation.set(p.spX, p.spY, p.spZ);
    this.neck.rotation.set(p.nkX, p.nkY, p.nkZ);
    this.head.rotation.set(p.hdX, p.hdY, p.hdZ);
    const arm = (a, sx, sy, sz, e, w) => { a.s.rotation.set(sx, sy, sz); a.el.rotation.set(e, 0, 0); a.hand.rotation.set(w, 0, 0); };
    arm(this.armL, p.sLx, p.sLy, p.sLz, p.eL, p.wL);
    arm(this.armR, p.sRx, p.sRy, p.sRz, p.eR, p.wR);
    const leg = (l, tx, tz, k, f) => { l.t.rotation.set(tx, 0, tz); l.k.rotation.set(k, 0, 0); l.f.rotation.set(f - k * 0.0, 0, 0); };
    leg(this.legL, p.tLx, p.tLz, p.kL, p.fL);
    leg(this.legR, p.tRx, p.tRz, p.kR, p.fR);

    // yüz
    const E = this._exprMix(st);
    const blinkCycle = (t + this.seed * 1.37) % 3.7;
    const blink = blinkCycle < 0.13 ? Math.sin((blinkCycle / 0.13) * PI) : 0;
    const shake = E.shake ? Math.sin(t * 40) * 0.003 : 0;
    this.eyes.forEach((e) => {
      let lid = E.lid;
      if (E.winkR && e.sd < 0) lid = Math.max(lid, E.winkR);
      lid = Math.max(lid, blink);
      if (E.asym) lid = clamp(lid + (e.sd > 0 ? 0.12 : -0.05) * E.asym);
      e.lid.rotation.x = lerp(-PI / 2 - 0.1, PI / 2 + 0.05, clamp(lid) * 0.98 + 0.02) ;
      const ps = E.pupil ?? 1;
      e.ir.scale.set(ps * 0.15 + 0.85, ps * 0.15 + 0.85, 1);
      e.ir.position.x = clamp(yaw * 0.012 * (1 - lk * 0.5), -0.008, 0.008) + shake;
      e.ir.position.y = clamp(pitch * 0.012, -0.007, 0.007);
    });
    this.brows.forEach((b) => {
      const a = E.asym ? (b.sd > 0 ? E.asym * 0.4 : -E.asym * 0.2) : 0;
      b.g.position.y = 0.06 + (E.brow + a) * 0.014;
      b.g.rotation.z = -b.sd * E.ang * 0.35;
    });
    const open = clamp(Math.max(E.open, st.mouth || 0));
    const sm = E.smile;
    this.smile.scale.set(1 + Math.max(0, sm) * 0.15 - open * 0.25, (Math.abs(sm) < 0.12 ? 0.12 : Math.abs(sm)) * Math.sign(sm || 1), 1);
    this.smile.position.y = sm >= 0 ? 0.004 : -0.006;
    this.smile.rotation.z = (sm >= 0 ? PI : 0) + (E.asym ? 0.15 * E.asym : 0);
    this.smile.visible = open < 0.55;
    this.mouthOpen.visible = open > 0.03;
    this.mouthOpen.scale.set(1.0 + 0.15 * sm, 0.12 + open * 0.95, 0.35);
    this.mouthOpen.position.y = -0.006 * open;
    this.blushM.opacity = (E.blush || 0) * 0.5;

    // takma bıyık düşmesi
    if (this.accFake.visible) {
      const ft = st.mustacheFall;
      if (ft !== undefined && t > ft) {
        const k = t - ft;
        this.accFake.position.set(this.fakeRest.x + Math.sin(k * 5) * 0.01, this.fakeRest.y - Math.min(0.9, 1.6 * k * k + 0.1 * k), this.fakeRest.z + 0.02 * k);
        this.accFake.rotation.z = Math.min(1.2, k * 3);
        if (k > 0.9) this.accFake.visible = false;
      } else { this.accFake.position.copy(this.fakeRest); this.accFake.rotation.z = 0; }
    }
    this.root.updateMatrixWorld(true);
  }

  _exprMix(st) {
    const a = EXPR[st.expr] || EXPR.neutral, b = EXPR[st.prevExpr] || EXPR.neutral, w = st.exprBlend ?? 1;
    const o = {};
    for (const k of ['lid', 'brow', 'ang', 'smile', 'open', 'pupil', 'blush', 'asym', 'winkR', 'shake']) o[k] = lerp(b[k] ?? (k === 'pupil' ? 1 : 0), a[k] ?? (k === 'pupil' ? 1 : 0), w);
    if (st.action === 'wink' && st.actionT < 0.7) o.winkR = Math.sin(clamp(st.actionT / 0.7) * PI);
    if (st.action === 'shout') o.open = 1;
    if (st.action === 'laugh') { o.lid = 0.85; o.smile = 1; o.open = 0.5 + 0.3 * Math.abs(Math.sin(st.actionT * 9)); }
    return o;
  }
}

// ------------------------------------------------------------------ kedi
export class Cat {
  constructor({ color = '#e08a3a', stripe = '#b8621e', belly = '#f4e4cc', size = 1 } = {}) {
    const g = (this.root = new THREE.Group());
    this.size = size;
    const fur = mat(color, { rough: 0.9, map: TEX.stripes(color, stripe, 12) });
    const bm = mat(belly, { rough: 0.9 });
    const body = (this.body = new THREE.Group()); g.add(body);
    const torso = capsule(0.085, 0.2, fur, 4, 14); torso.rotation.x = PI / 2; torso.position.y = 0.16; body.add(torso); this.torso = torso;
    const bel = capsule(0.07, 0.16, bm, 4, 10); bel.rotation.x = PI / 2; bel.position.set(0, 0.13, 0.0); body.add(bel);
    const head = (this.head = new THREE.Group()); head.position.set(0, 0.24, 0.17); body.add(head);
    const hm = sphere(0.075, fur, 18, 14); hm.scale.set(1.1, 0.95, 1); head.add(hm);
    const muz = sphere(0.035, bm, 12, 8); muz.position.set(0, -0.02, 0.06); muz.scale.set(1.3, 0.8, 0.8); head.add(muz);
    const nose = sphere(0.011, mat('#e07a8a'), 8, 6); nose.position.set(0, -0.004, 0.088); head.add(nose);
    for (const sd of [-1, 1]) {
      const ear = new THREE.Mesh(G.cone(0.03, 0.06, 4), fur); ear.position.set(sd * 0.045, 0.07, 0.0); ear.rotation.z = -sd * 0.25; ear.castShadow = true; head.add(ear);
    }
    const eyeM = mat('#c8d84a', { rough: 0.2, em: '#9aaa20', emI: 0.6, unique: true });
    this.eyeM = eyeM;
    this.eyes = [];
    for (const sd of [-1, 1]) {
      const e = new THREE.Group(); e.position.set(sd * 0.032, 0.012, 0.062); head.add(e);
      const em = sphere(0.016, eyeM, 10, 8); em.scale.z = 0.6; e.add(em);
      const pu = new THREE.Mesh(G.box(0.004, 0.022, 0.004), mat('#050505')); pu.position.z = 0.009; e.add(pu);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 10, 6, 0, PI * 2, 0, PI / 2), fur); e.add(lid);
      this.eyes.push({ e, lid });
    }
    this.legs = [];
    for (const [x, z] of [[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.1], [0.05, -0.1]]) {
      const l = new THREE.Group(); l.position.set(x, 0.12, z); body.add(l);
      const m = capsule(0.022, 0.09, fur, 3, 8); m.position.y = -0.06; l.add(m);
      this.legs.push(l);
    }
    this.tail = [];
    let parent = body;
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Group(); s.position.set(0, i === 0 ? 0.18 : 0, i === 0 ? -0.17 : -0.045); parent.add(s);
      const m = sphere(0.022 - i * 0.0015, fur, 8, 6); m.scale.z = 1.6; s.add(m);
      this.tail.push(s); parent = s;
    }
    g.scale.setScalar(size);
  }
  // mode: sleep | sit | wake | jump ; k: zamana bağlı
  update(t, mode = 'sleep', k = 0) {
    const b = this.body;
    b.position.set(0, 0, 0); b.rotation.set(0, 0, 0);
    let lid = 0.1, glowI = 0.6;
    if (mode === 'sleep') {
      const br = Math.sin(t * 1.8) * 0.03;
      this.torso.scale.set(1 + br, 1, 1 + br);
      this.head.position.set(0.06, 0.13, 0.15); this.head.rotation.set(0.5, 0.6, 0.3);
      this.legs.forEach((l, i) => { l.rotation.set(i < 2 ? -1.3 : 1.2, 0, 0); });
      b.position.y = -0.05;
      lid = 1; glowI = 0;
      this.tail.forEach((s, i) => { s.rotation.set(0.1, 0.45, 0); });
    } else if (mode === 'sit' || mode === 'wake') {
      b.rotation.x = -0.55; b.position.set(0, 0.02, -0.05);
      this.legs.forEach((l, i) => { l.rotation.set(i < 2 ? 0.55 : -0.9, 0, 0); });
      this.head.position.set(0, 0.24, 0.17); this.head.rotation.set(0.5 + Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.4) * 0.25, 0);
      lid = mode === 'wake' ? clamp(1 - k * 3) : 0.35 + 0.1 * Math.sin(t * 0.3);
      glowI = mode === 'wake' ? 2.5 * clamp(k * 3) : 0.8;
      this.tail.forEach((s, i) => { s.rotation.set(-0.35, Math.sin(t * 2.2 - i * 0.6) * 0.25, 0); });
    } else if (mode === 'jump') {
      b.rotation.x = -0.5 + k * 0.8;
      this.legs.forEach((l, i) => { l.rotation.set(i < 2 ? -1.2 : 1.1, 0, 0); });
      this.head.position.set(0, 0.24, 0.17); this.head.rotation.set(-0.2, 0, 0);
      lid = 0; glowI = 3;
      this.tail.forEach((s) => { s.rotation.set(0.25, 0, 0); });
    }
    this.eyes.forEach(({ lid: l }) => { l.rotation.x = lerp(-PI / 2 - 0.1, PI / 2, clamp(lid)); });
    this.eyeM.emissiveIntensity = glowI;
  }
}
