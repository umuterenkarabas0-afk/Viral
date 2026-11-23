// Mekânlar: ofis, bit pazarı, ev (oda), Kadıköy iskelesi, cadde, sahaf, Altıyol meydanı,
// Moda çay bahçesi/sahil, vapur güvertesi ve yakın plan "insert" masası.
// Her mekân: statik geometri (Batch ile birleştirilmiş), çapa noktaları, varsayılan geniş
// kamera, kalabalık bölgesi, saat/hava durumuna göre ışık ayarı ve kare güncellemesi.
import * as THREE from 'three';
import { G, mat, glow, basic, TEX, Batch, xf, canvasTex, makeWater, makeSkyline, stringLights, lampPost, tree, building, Rain, Dust, Birds, mulberry32, hashString, SKY } from './kit.js';
import { Cat } from './character.js';
import { makeHandProp, buildInsert, envelopeMesh } from './props.js';
import { clamp, lerp, ease, smoothstep } from '../src/util.js';

const PI = Math.PI;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ ortak mobilya
function chair(b, x, z, face, { wood = '#6a4630', seat = 0.46 } = {}) {
  const m = mat(wood, { rough: 0.7 });
  const c = Math.cos(face), s = Math.sin(face);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  b.add(xf(G.rbox(0.44, 0.05, 0.42, 0.015), ...P(0, seat, 0), 0, face, 0), m);
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) b.add(xf(G.cyl(0.018, 0.018, seat, 6), ...P(lx, seat / 2, lz), 0, face, 0), m);
  b.add(xf(G.rbox(0.42, 0.42, 0.035, 0.012), ...P(0, seat + 0.25, -0.2), -0.08, face, 0), m);
}
function stoolMesh() {
  const g = new THREE.Group(); const m = mat('#7a5236', { rough: 0.75 });
  const top = new THREE.Mesh(G.cyl(0.17, 0.17, 0.04, 16), m); top.position.y = 0.44; top.castShadow = true; g.add(top);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; const l = new THREE.Mesh(G.cyl(0.015, 0.02, 0.45, 6), m); l.position.set(Math.cos(a) * 0.11, 0.22, Math.sin(a) * 0.11); l.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); l.castShadow = true; g.add(l); }
  return g;
}
function roundTable(b, x, z, { r = 0.42, h = 0.74, cloth = TEX.check('#b33a3a', '#f2ede4', [2, 2]) } = {}) {
  b.add(xf(G.cyl(r, r, 0.04, 28), x, h, z), mat('#ffffff', { map: cloth, rough: 0.9 }));
  b.add(xf(G.cyl(r + 0.01, r + 0.06, 0.16, 28, true), x, h - 0.09, z), mat('#ffffff', { map: cloth, rough: 0.9, side: THREE.DoubleSide }));
  b.add(xf(G.cyl(0.04, 0.05, h, 8), x, h / 2, z), mat('#2a2a2a', { metal: 0.6, rough: 0.4 }));
  b.add(xf(G.cyl(0.25, 0.28, 0.03, 16), x, 0.015, z), mat('#2a2a2a', { metal: 0.6, rough: 0.4 }));
}
function teaGlass(parent, x, y, z, s = 1) { const t = makeHandProp('tea'); t.position.set(x, y, z); t.scale.setScalar(s); parent.add(t); return t; }
function crate(b, x, y, z, ry = 0, s = 1) {
  const m = mat('#ffffff', { map: TEX.wood('#9a7048', [1, 1], 4), rough: 0.85 });
  b.add(xf(G.box(0.62 * s, 0.42 * s, 0.45 * s), x, y + 0.21 * s, z, 0, ry, 0), m);
  b.add(xf(G.box(0.64 * s, 0.05 * s, 0.47 * s), x, y + 0.36 * s, z, 0, ry, 0), mat('#6a4a2e', { rough: 0.9 }));
}

// Pazar tezgâhı: masa + örtü + tente + eşyalar
function stall(b, x, z, seed, { face = 1, awn = ['#efe3c6', '#b8322c'], items = true, coats = false } = {}) {
  const r = mulberry32(seed);
  const fz = (dz) => z + face * dz;
  b.add(xf(G.box(1.8, 0.05, 0.7), x, 0.78, fz(-0.45)), mat('#ffffff', { map: TEX.wood('#8a6040', [1, 1], 3), rough: 0.8 }));
  const cl = TEX.check(['#7a3a3a', '#3a5a7a', '#5a6a3a', '#8a6a2a'][seed % 4], '#efe6d2', [2, 1]);
  b.add(xf(G.box(1.84, 0.68, 0.74), x, 0.43, fz(-0.45)), mat('#ffffff', { map: cl, rough: 0.95 }));
  const pm = mat('#3a3530', { metal: 0.4, rough: 0.6 });
  for (const dx of [-0.95, 0.95]) for (const dz of [-0.08, -1.45]) b.add(xf(G.cyl(0.025, 0.025, 2.35, 6), x + dx, 1.17, fz(dz)), pm);
  const aw = mat('#ffffff', { map: TEX.awning(awn[0], awn[1]), rough: 0.9, side: THREE.DoubleSide });
  const ap = G.plane(2.1, 1.65); ap.rotateX(-PI / 2 + face * 0.2);
  b.add(xf(ap, x, 2.3, fz(-0.72)), aw, { cast: true });
  const vm = mat('#ffffff', { map: TEX.awning(awn[0], awn[1]), rough: 0.9, side: THREE.DoubleSide });
  b.add(xf(G.plane(2.1, 0.22), x, 2.08, fz(0.07), 0, face > 0 ? 0 : PI, 0), vm);
  if (items) {
    const pal = ['#c9a24a', '#2e4a6a', '#7a2e2e', '#3a5a3a', '#d9cbb2', '#5a3a5a', '#1f1f1f', '#b87333'];
    for (let i = 0; i < 9; i++) {
      const ix = x - 0.75 + i * 0.19 + (r() - 0.5) * 0.05, iz = fz(-0.45 + (r() - 0.5) * 0.35);
      const c = mat(pal[Math.floor(r() * pal.length)], { rough: 0.4 + r() * 0.4, metal: r() < 0.3 ? 0.7 : 0 });
      const k = Math.floor(r() * 6);
      if (k === 0) { b.add(xf(G.lathe([[0.001, 0], [0.06, 0.01], [0.07, 0.1], [0.03, 0.2], [0.045, 0.26], [0.001, 0.26]], 14), ix, 0.805, iz), c); }
      else if (k === 1) { b.add(xf(G.rbox(0.18, 0.12, 0.1, 0.02), ix, 0.87, iz, 0, r(), 0), c); b.add(xf(G.cyl(0.03, 0.03, 0.01, 12), ix + 0.04, 0.88, iz + 0.051, PI / 2, 0, 0), mat('#d9cbb2')); }
      else if (k === 2) { b.add(xf(G.cyl(0.012, 0.02, 0.28, 8), ix, 0.94, iz), mat('#b87333', { metal: 0.8, rough: 0.3 })); b.add(xf(G.cyl(0.05, 0.11, 0.12, 12, true), ix, 1.1, iz), mat(pal[Math.floor(r() * 5)], { rough: 0.8, side: THREE.DoubleSide })); }
      else if (k === 3) { for (let j = 0; j < 3; j++) b.add(xf(G.box(0.15, 0.035, 0.21), ix, 0.82 + j * 0.036, iz, 0, r() * 0.4, 0), mat(pal[Math.floor(r() * pal.length)], { rough: 0.8 })); }
      else if (k === 4) { b.add(xf(G.sph(0.07, 12, 10), ix, 0.86, iz, 0, 0, 0, 1, 0.8, 1), c); b.add(xf(G.cyl(0.008, 0.015, 0.1, 6), ix + 0.08, 0.88, iz, 0, 0, -0.8), c); }
      else { b.add(xf(G.box(0.16, 0.2, 0.015), ix, 0.9, iz, -0.2, 0, 0), mat('#c9a24a', { metal: 0.7, rough: 0.3 })); b.add(xf(G.plane(0.12, 0.15), ix, 0.905, iz + 0.009, -0.2, 0, 0), mat(pal[Math.floor(r() * pal.length)], { rough: 0.9 })); }
    }
  }
}

function coatRack(b, x, z, len = 1.0, colors = ['#5a6a7a', '#7a3a33', '#2f3640', '#b8844e', '#4a5a3a', '#6a5a7a']) {
  const pm = mat('#2a2622', { metal: 0.5, rough: 0.5 });
  b.add(xf(G.cyl(0.018, 0.018, len, 8), x, 1.78, z, 0, 0, PI / 2), pm);
  for (const dx of [-len / 2, len / 2]) { b.add(xf(G.cyl(0.02, 0.02, 1.78, 8), x + dx, 0.89, z), pm); b.add(xf(G.box(0.05, 0.03, 0.5), x + dx, 0.02, z), pm); }
  colors.forEach((c, i) => {
    const cx = x - len / 2 + 0.1 + (i * (len - 0.2)) / Math.max(1, colors.length - 1);
    const cm = c === '#b8844e' ? mat('#ffffff', { map: TEX.wool(c, [1, 1]), rough: 0.95, side: THREE.DoubleSide }) : mat(c, { rough: 0.9, side: THREE.DoubleSide });
    const g = G.lathe([[0.04, 0.0], [0.15, -0.05], [0.17, -0.3], [0.2, -0.85]], 16); g.scale(1, 1, 0.42);
    b.add(xf(g, cx, 1.74, z, 0, PI / 2, 0), cm);
    b.add(xf(G.tor(0.12, 0.006, 4, 14, PI), cx, 1.72, z, 0, PI / 2, 0), mat('#6a4a2e'));
  });
}

function bench(b, x, z, ry, { len = 1.8, wood = '#8a6040' } = {}) {
  const m = mat('#ffffff', { map: TEX.wood(wood, [1, 1], 3), rough: 0.8 });
  const fm = mat('#22262a', { metal: 0.6, rough: 0.4 });
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  for (let i = 0; i < 3; i++) b.add(xf(G.box(len, 0.035, 0.11), ...P(0, 0.45, -0.15 + i * 0.13), 0, ry, 0), m);
  for (let i = 0; i < 2; i++) b.add(xf(G.box(len, 0.1, 0.03), ...P(0, 0.62 + i * 0.16, -0.25), -0.15, ry, 0), m);
  for (const lx of [-len / 2 + 0.1, len / 2 - 0.1]) { b.add(xf(G.box(0.05, 0.45, 0.4), ...P(lx, 0.225, 0), 0, ry, 0), fm); b.add(xf(G.box(0.05, 0.45, 0.04), ...P(lx, 0.65, -0.26), -0.15, ry, 0), fm); }
}

function ground(b, w, d, m, y = 0, x = 0, z = 0) { const g = G.plane(w, d); g.rotateX(-PI / 2); b.add(xf(g, x, y, z), m, { cast: false }); }

// Kadıköy vapuru (Şehir Hatları stili, stilize)
function ferry({ flashback = false } = {}) {
  const g = new THREE.Group();
  const b = new Batch();
  const white = mat(flashback ? '#efe6d6' : '#f2f0ea', { rough: 0.5 });
  const dark = mat('#20242a', { rough: 0.6 });
  const L = 16, Wd = 3.6;
  const sh = new THREE.Shape();
  sh.moveTo(-L / 2, -Wd / 2); sh.lineTo(L / 2 - 2, -Wd / 2); sh.quadraticCurveTo(L / 2 + 0.6, 0, L / 2 - 2, Wd / 2); sh.lineTo(-L / 2, Wd / 2); sh.quadraticCurveTo(-L / 2 - 1.2, 0, -L / 2, -Wd / 2);
  const hull = new THREE.ExtrudeGeometry(sh, { depth: 1.4, bevelEnabled: false }); hull.rotateX(-PI / 2);
  b.add(xf(hull, 0, -0.9, 0), dark);
  const top = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false }); top.rotateX(-PI / 2);
  b.add(xf(top, 0, 0.5, 0, 0, 0, 0, 0.98, 1, 0.98), white);
  const winTex = canvasTex(1024, 64, (x, w, h) => { x.fillStyle = '#f2f0ea'; x.fillRect(0, 0, w, h); for (let i = 0; i < 26; i++) { x.fillStyle = '#2b3a48'; x.fillRect(16 + i * 39, 14, 26, 36); } }, { repeat: [1, 1] });
  const wm = mat('#ffffff', { map: winTex, rough: 0.4 });
  for (const sd of [-1, 1]) b.add(xf(G.plane(12, 0.8), -0.5, 1.95, sd * 1.45, 0, sd > 0 ? 0 : PI, 0), wm, { cast: false });
  b.add(xf(G.box(12, 1.2, 2.9), -0.5, 1.95, 0), white);
  b.add(xf(G.box(12.6, 0.1, 3.3), -0.5, 2.6, 0), white);
  b.add(xf(G.box(8, 0.9, 2.4), -1, 3.1, 0), white);
  for (const sd of [-1, 1]) b.add(xf(G.plane(7.6, 0.55), -1, 3.15, sd * 1.21, 0, sd > 0 ? 0 : PI, 0), wm, { cast: false });
  b.add(xf(G.cyl(0.5, 0.55, 1.6, 16), -1.5, 4.2, 0), white);
  b.add(xf(G.cyl(0.51, 0.51, 0.35, 16), -1.5, 4.85, 0), dark);
  b.add(xf(G.cyl(0.512, 0.512, 0.12, 16), -1.5, 4.55, 0), mat('#b8322c', { rough: 0.5 }));
  const rail = mat('#e9e6df', { rough: 0.5 });
  for (const sd of [-1, 1]) { b.add(xf(G.box(15, 0.04, 0.04), 0, 1.45, sd * 1.75), rail); for (let i = -7; i <= 7; i++) b.add(xf(G.box(0.03, 0.5, 0.03), i, 1.2, sd * 1.75), rail); }
  b.add(xf(G.box(15.5, 0.12, 3.62), 0, 0.5, 0), mat('#b8322c', { rough: 0.5 }));
  b.build(g);
  g.userData.deckY = 1.0;
  return g;
}

// ------------------------------------------------------------------ ışık ayarları
function L(sky, o = {}) { return { sky, ...o }; }

// ------------------------------------------------------------------ mekânlar
export function office() {
  const g = new THREE.Group(); const b = new Batch();
  const carpet = mat('#ffffff', { map: TEX.plaster('#5c6670', [8, 8]), rough: 1 });
  ground(b, 14, 14, carpet);
  const wall = mat('#ffffff', { map: TEX.plaster('#c9ccc6', [3, 1]), rough: 0.95 });
  b.add(xf(G.plane(14, 3), 0, 1.5, -3.2), wall, { cast: false });
  b.add(xf(G.plane(14, 3), -4.5, 1.5, 0, 0, PI / 2, 0), wall, { cast: false });
  b.add(xf(G.plane(14, 3), 4.5, 1.5, 0, 0, -PI / 2, 0), wall, { cast: false });
  b.add(xf(G.plane(14, 14), 0, 3, 0, PI / 2, 0, 0), mat('#e8e8e4', { rough: 1 }), { cast: false });
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) b.add(xf(G.plane(1.2, 0.3), i * 2.2, 2.99, j * 2.2, PI / 2, 0, 0), glow('#f2f6ff', 3.2), { cast: false });
  // pencereler (gri gökyüzü)
  const sky = canvasTex(512, 256, (x, w, h) => { const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9aa6b0'); gr.addColorStop(1, '#c9d0d4'); x.fillStyle = gr; x.fillRect(0, 0, w, h); x.fillStyle = '#7a8590'; for (let i = 0; i < 12; i++) x.fillRect(i * 44, h * 0.55 - (i % 3) * 20, 38, h); });
  for (const wx of [-2.6, 0, 2.6]) { b.add(xf(G.plane(2.0, 1.4), wx, 1.7, -3.19), mat('#ffffff', { map: sky, em: '#ffffff', emI: 0.9, rough: 1 }), { cast: false }); b.add(xf(G.box(2.1, 0.06, 0.08), wx, 1.0, -3.15), mat('#d9d9d4')); }
  // Kerem'in masası
  const desk = mat('#d9d2c4', { rough: 0.6 });
  b.add(xf(G.rbox(1.5, 0.04, 0.75, 0.01), 0, 0.74, 0.5), desk);
  for (const [dx, dz] of [[-0.7, 0.2], [0.7, 0.2], [-0.7, 0.82], [0.7, 0.82]]) b.add(xf(G.cyl(0.02, 0.02, 0.74, 6), dx, 0.37, dz), mat('#555'));
  b.add(xf(G.box(1.6, 1.3, 0.05), 0, 0.65, -0.62), mat('#7a8a90', { rough: 0.9 }));
  b.add(xf(G.box(0.05, 1.3, 1.5), -0.82, 0.65, 0.1), mat('#7a8a90', { rough: 0.9 }));
  const sheet = canvasTex(512, 320, (x, w, h) => {
    x.fillStyle = '#f5f7f5'; x.fillRect(0, 0, w, h); x.fillStyle = '#1e7145'; x.fillRect(0, 0, w, 26);
    x.strokeStyle = '#cfd6cf'; x.lineWidth = 1;
    for (let i = 0; i < 20; i++) { x.beginPath(); x.moveTo(0, 30 + i * 15); x.lineTo(w, 30 + i * 15); x.stroke(); }
    for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(i * 60, 26); x.lineTo(i * 60, h); x.stroke(); }
    x.fillStyle = '#4a4a4a'; x.font = '11px monospace';
    const r = mulberry32(2); for (let i = 0; i < 19; i++) for (let j = 0; j < 8; j++) x.fillText(String(Math.floor(r() * 9999)), j * 60 + 6, 42 + i * 15);
  });
  const mon = new THREE.Group(); mon.position.set(-0.32, 0.76, 0.62); mon.rotation.y = PI + 0.45; g.add(mon);
  const mb = new THREE.Mesh(G.rbox(0.62, 0.38, 0.03, 0.01), mat('#1a1c20', { rough: 0.4 })); mb.position.y = 0.33; mb.castShadow = true; mon.add(mb);
  const ms = new THREE.Mesh(G.plane(0.58, 0.34), mat('#ffffff', { map: sheet, em: '#ffffff', emI: 1.1, rough: 0.5 })); ms.position.set(0, 0.33, 0.016); mon.add(ms);
  const st = new THREE.Mesh(G.cyl(0.02, 0.03, 0.16, 8), mat('#2a2a2a')); st.position.y = 0.08; mon.add(st);
  b.add(xf(G.rbox(0.42, 0.02, 0.14, 0.005), 0.05, 0.765, 0.3), mat('#2a2c30', { rough: 0.5 }));
  b.add(xf(G.cyl(0.04, 0.035, 0.1, 12), 0.5, 0.81, 0.35), mat('#c94a3a', { rough: 0.4 }));
  for (let i = 0; i < 4; i++) b.add(xf(G.box(0.002, 0.07, 0.07), -0.79, 0.98 + (i % 2) * 0.08, -0.3 + i * 0.09), mat(['#ffe26a', '#ff9ac0', '#9ae0ff', '#b0ff9a'][i], { rough: 1 }), { cast: false });
  chair(b, 0, -0.05, PI, { wood: '#2a2c30' });
  // arka plan: diğer masalar
  for (const [x, z] of [[-2.4, -1.2], [2.4, -1.2], [-2.4, 2.0], [2.4, 2.2], [0, -2.2]]) {
    b.add(xf(G.rbox(1.4, 0.04, 0.7, 0.01), x, 0.74, z), desk);
    b.add(xf(G.box(1.4, 1.2, 0.04), x, 0.6, z - 0.37), mat('#7a8a90', { rough: 0.9 }));
    b.add(xf(G.rbox(0.55, 0.34, 0.03, 0.01), x, 1.08, z - 0.2), mat('#1a1c20'));
    b.add(xf(G.plane(0.5, 0.3), x, 1.08, z - 0.184), mat('#ffffff', { map: sheet, em: '#ffffff', emI: 1.0 }), { cast: false });
  }
  b.add(xf(G.cyl(0.18, 0.14, 0.4, 12), 3.6, 0.2, -2.6), mat('#c9c1b5'));
  tree(b, 3.6, -2.6, { h: 1.6, leaf: '#3f6a3a', trunk: '#4a3a2a', seed: 3 });
  b.build(g);
  return {
    group: g, interior: true, shadowExt: 4,
    anchors: { desk: V(-0.32, 1.1, 0.62), monitor: V(-0.32, 1.1, 0.62) },
    wide: { pos: V(1.6, 1.6, 3.2), look: V(0, 1.0, 0) },
    crowd: { zone: [-3, 3, -2, 2.5] },
    light: () => L('day', { interiorEnv: { wall: '#9aa0a8', window: '#e8f0ff', winI: 1.6, lampI: 1.2 }, sun: { pos: V(-2, 6, -4), color: '#eef3ff', I: 1.6 }, points: [{ pos: V(-0.3, 1.1, 0.4), color: '#9fc4ff', I: 2.0, d: 2.2 }], fog: ['#9aa0a8', 0.0], exp: 1.0, sat: 0.92, tint: [0.96, 1.0, 1.04] }),
  };
}

export function market(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  ground(b, 60, 30, mat('#ffffff', { map: TEX.cobble('#7a7068', [16, 8]), rough: 0.92 }), 0, 0, 1);
  stall(b, 0, 0, 1, { awn: ['#efe3c6', '#2e6a5a'] });
  coatRack(b, -1.35, -0.85, 1.0);
  for (const [x, s, aw] of [[-4.3, 2, ['#efe3c6', '#b8322c']], [4.3, 3, ['#f2d27a', '#3a5a7a']], [8.6, 4, ['#efe3c6', '#7a3a5a']], [-8.6, 5, ['#efe3c6', '#c9802a']]]) stall(b, x, 0, s, { awn: aw });
  for (const [x, s, aw] of [[-3.2, 6, ['#efe3c6', '#3a6a3a']], [1.8, 7, ['#efe3c6', '#b8322c']], [6.6, 8, ['#f2d27a', '#2e4a6a']]]) stall(b, x, 3.6, s, { face: -1, awn: aw });
  const walls = ['#d9c3a0', '#c9a888', '#b8c0b0', '#e0cfb0', '#c8b8a8', '#d0b090'];
  for (let i = 0; i < 7; i++) building(b, -18 + i * 6, -3.4, { w: 6, floors: 4 + (i % 3), seed: 20 + i, wall: walls[i % 6], facing: 1, lit: 0.35, shop: true });
  for (let i = 0; i < 7; i++) building(b, -18 + i * 6, 6.6, { w: 6, floors: 4 + ((i + 1) % 3), seed: 40 + i, wall: walls[(i + 2) % 6], facing: -1, lit: 0.35 });
  for (let i = 0; i < 5; i++) stringLights(b, [-10 + i * 5, 3.3, -2.9], [-7.5 + i * 5, 3.2, 6.0], { n: 16, sag: 0.5 });
  stringLights(b, [-1.0, 2.35, 0.05], [1.0, 2.35, 0.05], { n: 8, sag: 0.08, intensity: 3.5 });
  for (const [x, z] of [[-6.2, -2.7], [6.2, -2.7]]) lampPost(b, x, z, { lit: true });
  b.build(g);
  // dinamik: tabure havuzu, kasalar, el arabası, boş tezgâh askısı
  const stools = []; for (let i = 0; i < 4; i++) { const s = stoolMesh(); s.visible = false; g.add(s); stools.push(s); }
  const crates = new THREE.Group(); { const cb = new Batch(); crate(cb, 2.75, 0, 1.25, 0.1); crate(cb, 3.4, 0, 1.3, -0.08); crate(cb, 3.05, 0.42, 1.28, 0.2, 0.9); crate(cb, 2.2, 0, 1.15, 0.3, 0.85); cb.build(crates); } g.add(crates);
  const cart = new THREE.Group(); {
    const cb = new Batch(); const w = mat('#ffffff', { map: TEX.wood('#8a6a4a', [1, 1], 4), rough: 0.85 });
    cb.add(xf(G.box(0.9, 0.35, 0.6), 0, 0.55, 0), w); cb.add(xf(G.box(0.95, 0.05, 0.65), 0, 0.38, 0), w);
    for (const sd of [-1, 1]) { cb.add(xf(G.cyl(0.25, 0.25, 0.05, 18), 0, 0.25, sd * 0.33, PI / 2, 0, 0), mat('#2a2622', { rough: 0.6 })); cb.add(xf(G.cyl(0.015, 0.015, 0.9, 6), -0.75, 0.75, sd * 0.25, 0, 0, PI / 2 - 0.35), mat('#5a4a3a')); }
    for (let i = 0; i < 4; i++) cb.add(xf(G.rbox(0.18, 0.06, 0.5, 0.02), -0.25 + i * 0.17, 0.76, 0, 0, 0, 0.15), mat(['#b8844e', '#5a6a7a', '#7a3a33', '#2f3640'][i], { rough: 0.95 }));
    cb.build(cart);
  } g.add(cart);
  const items = new THREE.Group(); g.add(items);
  const loneCoat = new THREE.Group(); { const cb = new Batch(); coatRack(cb, -1.35, -0.85, 1.0, ['#b8844e']); cb.build(loneCoat); } g.add(loneCoat);
  const fullRack = g.children[0]; void fullRack;
  const tableNote = makeHandProp('note'); tableNote.rotation.x = -PI / 2; tableNote.position.set(0.1, 0.81, -0.4); g.add(tableNote);
  return {
    group: g, interior: false, shadowExt: 6,
    anchors: { stall: V(0, 1.1, -0.6), rack: V(-1.35, 1.4, -0.85), table: V(0, 0.8, -0.45), crates: V(2.9, 0.8, 1.3) },
    wide: { pos: V(2.6, 2.0, 6.2), look: V(-0.4, 1.0, -0.2) },
    crowd: { zone: [-7.5, 7.5, 0.9, 2.9], avoid: [[0, 0.4, 1.3], [2.8, 1.3, 1.2]] },
    stools,
    onShot(shot) {
      const pr = new Set(shot.props || []);
      crates.visible = pr.has('crates');
      cart.visible = pr.has('cart') || pr.has('cart_parked');
      cart.userData.follow = pr.has('cart');
      if (pr.has('cart_parked')) { cart.position.set(-2.1, 0, 0.45); cart.rotation.y = 0.3; }
      loneCoat.visible = pr.has('empty_stall');
      tableNote.visible = shot.cast.some((c) => c.who === 'nuri' && (c.do || []).some(([, a]) => a === 'write'));
    },
    update(t, shot, D) {
      if (cart.userData.follow) {
        const n = D.chars.nuri;
        if (n) { const f = n.root.rotation.y; cart.position.set(n.root.position.x + Math.sin(f) * 0.95, 0, n.root.position.z + Math.cos(f) * 0.95); cart.rotation.y = f + PI / 2; }
      }
    },
    light: (time) => ({
      day: L('day', { sun: { pos: V(6, 10, 6), color: '#fff0d8', I: 2.6 }, points: [{ pos: V(0, 2.1, -0.4), color: '#ffcf8a', I: 0.6, d: 4 }], fog: ['#c9d6e0', 0.012], exp: 1.02 }),
      morning: L('morning', { sun: { pos: V(-8, 6, 6), color: '#ffd8a8', I: 2.4 }, points: [{ pos: V(0, 2.1, -0.4), color: '#ffcf8a', I: 0.8, d: 4 }], fog: ['#e9d2b8', 0.014], exp: 1.02 }),
      dawn: L('dawn', { sun: { pos: V(8, 3, -4), color: '#ffc6a8', I: 0.7 }, points: [{ pos: V(0, 2.1, -0.4), color: '#ffb870', I: 3.0, d: 5 }, { pos: V(-6.2, 3.6, -2.4), color: '#ffcf8a', I: 2.0, d: 7 }, { pos: V(2.9, 1.5, 1.8), color: '#9fb4ff', I: 0.6, d: 3 }], fog: ['#8a8aa8', 0.055], exp: 1.1, sat: 0.9 }),
      night: L('night', { sun: { pos: V(-4, 8, 4), color: '#9fb4ff', I: 0.3 }, points: [{ pos: V(0, 2.1, -0.4), color: '#ffb870', I: 3.0, d: 5 }], fog: ['#141b30', 0.03], exp: 1.1 }),
    }[time] || null),
  };
}

export function room() {
  const g = new THREE.Group(); const b = new Batch();
  const X0 = -2.2, X1 = 2.2, Z0 = -2.0, Z1 = 3.0, HH = 2.7;
  ground(b, X1 - X0, Z1 - Z0, mat('#ffffff', { map: TEX.wood('#8a5e3c', [2, 3], 10), rough: 0.55 }), 0, 0, (Z0 + Z1) / 2);
  const wp = mat('#ffffff', { map: TEX.wallpaper('#4f6e68', '#5a7c74', [5, 2]), rough: 0.95 });
  const wpS = mat('#ffffff', { map: TEX.wallpaper('#4f6e68', '#5a7c74', [6, 2]), rough: 0.95 });
  // arka duvar (pencere boşluğu bırakarak)
  const wx0 = 0.35, wx1 = 1.65, wy0 = 0.85, wy1 = 2.2;
  b.add(xf(G.plane(wx0 - X0, HH), (X0 + wx0) / 2, HH / 2, Z0), wp, { cast: false });
  b.add(xf(G.plane(X1 - wx1, HH), (wx1 + X1) / 2, HH / 2, Z0), wp, { cast: false });
  b.add(xf(G.plane(wx1 - wx0, wy0), (wx0 + wx1) / 2, wy0 / 2, Z0), wp, { cast: false });
  b.add(xf(G.plane(wx1 - wx0, HH - wy1), (wx0 + wx1) / 2, (wy1 + HH) / 2, Z0), wp, { cast: false });
  b.add(xf(G.plane(Z1 - Z0, HH), X0, HH / 2, (Z0 + Z1) / 2, 0, PI / 2, 0), wpS, { cast: false });
  b.add(xf(G.plane(Z1 - Z0, HH), X1, HH / 2, (Z0 + Z1) / 2, 0, -PI / 2, 0), wpS, { cast: false });
  b.add(xf(G.plane(X1 - X0, HH), 0, HH / 2, Z1, 0, PI, 0), wp, { cast: false });
  b.add(xf(G.plane(X1 - X0, Z1 - Z0), 0, HH, (Z0 + Z1) / 2, PI / 2, 0, 0), mat('#efe9dc', { rough: 1 }), { cast: false });
  const trim = mat('#efe6d6', { rough: 0.6 });
  b.add(xf(G.box(X1 - X0, 0.1, 0.02), 0, 0.05, Z0 + 0.01), trim);
  b.add(xf(G.box(0.02, 0.1, Z1 - Z0), X0 + 0.01, 0.05, (Z0 + Z1) / 2), trim);
  b.add(xf(G.box(0.02, 0.1, Z1 - Z0), X1 - 0.01, 0.05, (Z0 + Z1) / 2), trim);
  // pencere çerçevesi
  const fr = mat('#f2ede2', { rough: 0.5 });
  b.add(xf(G.box(wx1 - wx0 + 0.12, 0.08, 0.14), (wx0 + wx1) / 2, wy0, Z0 + 0.02), fr);
  b.add(xf(G.box(wx1 - wx0 + 0.12, 0.08, 0.1), (wx0 + wx1) / 2, wy1, Z0 + 0.02), fr);
  for (const x of [wx0, (wx0 + wx1) / 2, wx1]) b.add(xf(G.box(0.07, wy1 - wy0, 0.1), x, (wy0 + wy1) / 2, Z0 + 0.02), fr);
  const curt = mat('#c9a24a', { rough: 0.95, side: THREE.DoubleSide });
  for (const [x, w] of [[wx0 - 0.2, 0.42], [wx1 + 0.2, 0.42]]) { const cg = G.plane(w, 2.2, 6, 1); const p = cg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 30) * 0.03); cg.computeVertexNormals(); b.add(xf(cg, x, 1.45, Z0 + 0.1), curt); }
  // dolap
  const wd = mat('#ffffff', { map: TEX.wood('#6a4630', [1, 2], 3), rough: 0.6 });
  b.add(xf(G.box(1.1, 2.05, 0.55), -1.1, 1.025, -1.72), wd);
  b.add(xf(G.box(1.16, 0.06, 0.6), -1.1, 2.08, -1.72), mat('#5a3a26', { rough: 0.6 }));
  b.add(xf(G.box(0.005, 1.8, 0.01), -1.1, 1.05, -1.443), mat('#2a1a10'));
  for (const sd of [-1, 1]) { b.add(xf(G.box(0.48, 1.7, 0.012), -1.1 + sd * 0.27, 1.05, -1.44), mat('#ffffff', { map: TEX.wood('#7a5236', [1, 2], 2), rough: 0.55 })); b.add(xf(G.cyl(0.012, 0.012, 0.16, 8), -1.1 + sd * 0.05, 1.1, -1.42), mat('#c9a24a', { metal: 1, rough: 0.3 })); }
  // yatak
  b.add(xf(G.box(1.4, 0.32, 2.0), 1.1, 0.16, -1.0), mat('#ffffff', { map: TEX.wood('#5a3a26', [1, 1], 3), rough: 0.7 }));
  b.add(xf(G.rbox(1.34, 0.2, 1.95, 0.06), 1.1, 0.42, -1.0), mat('#efe9df', { rough: 0.9 }));
  b.add(xf(G.box(1.42, 0.9, 0.08), 1.1, 0.6, -1.98), mat('#5a3a26', { rough: 0.7 }));
  b.add(xf(G.rbox(0.6, 0.14, 0.38, 0.06), 1.1, 0.58, -1.72), mat('#f4f1ea', { rough: 0.9 }));
  // masa + sandalye + laptop + lamba
  b.add(xf(G.rbox(0.6, 0.04, 1.3, 0.01), -1.9, 0.74, 0.6), mat('#ffffff', { map: TEX.wood('#9a7048', [1, 1], 3), rough: 0.6 }));
  for (const [dx, dz] of [[-0.25, 0.0], [-0.25, 1.2], [0.25, 0.0], [0.25, 1.2]]) b.add(xf(G.box(0.04, 0.74, 0.04), -1.9 + dx, 0.37, dz), mat('#3a2a20'));
  chair(b, -1.4, 0.6, -PI / 2);
  const lap = new THREE.Group(); lap.position.set(-2.0, 0.76, 0.75); lap.rotation.y = PI / 2; g.add(lap);
  const lb = new THREE.Mesh(G.rbox(0.34, 0.015, 0.24, 0.004), mat('#b8bcc2', { metal: 0.6, rough: 0.35 })); lap.add(lb);
  const ls = new THREE.Mesh(G.rbox(0.34, 0.23, 0.01, 0.004), mat('#b8bcc2', { metal: 0.6, rough: 0.35 })); ls.position.set(0, 0.115, -0.12); ls.rotation.x = -0.25; lap.add(ls);
  const lscr = new THREE.Mesh(G.plane(0.31, 0.2), glow('#8fb6e8', 0.9)); lscr.position.set(0, 0.115, -0.113); lscr.rotation.x = -0.25; lap.add(lscr);
  b.add(xf(G.cyl(0.07, 0.08, 0.02, 12), -2.05, 0.77, 1.1), mat('#2a2a2a'));
  b.add(xf(G.cyl(0.008, 0.008, 0.38, 6), -2.05, 0.96, 1.1, 0, 0, 0.2), mat('#2a2a2a'));
  b.add(xf(G.cone(0.1, 0.12, 14, true), -2.0, 1.15, 1.1), mat('#c9a24a', { rough: 0.5, side: THREE.DoubleSide }));
  b.add(xf(G.sph(0.03, 8, 6), -2.0, 1.11, 1.1), glow('#ffd59a', 4));
  // halı, bitki, poster, kitaplık, kapı
  b.add(xf(G.rbox(1.8, 0.012, 1.3, 0.005), -0.1, 0.006, 0.4), mat('#ffffff', { map: TEX.check('#8a3a2a', '#d9b880', [3, 2]), rough: 1 }), { cast: false });
  b.add(xf(G.cyl(0.16, 0.12, 0.32, 12), 1.9, 0.16, 0.5), mat('#c96a3a', { rough: 0.7 }));
  tree(b, 1.9, 0.5, { h: 1.3, leaf: '#3f7a3a', seed: 8 });
  const poster = canvasTex(360, 512, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f2b45a'); gr.addColorStop(0.6, '#e2785a'); gr.addColorStop(1, '#2e4a6a'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f2f0ea'; x.fillRect(60, 300, 240, 50); x.fillStyle = '#1f2a33'; x.fillRect(60, 340, 240, 22); x.fillRect(150, 250, 30, 55);
    x.fillStyle = '#1f2a33'; x.font = '900 64px "Anton"'; x.textAlign = 'center'; x.fillText('KADIKÖY', w / 2, 110); x.font = '700 30px "Courier Prime"'; x.fillText('VAPUR · 1984', w / 2, 160);
  });
  b.add(xf(G.plane(0.6, 0.85), X0 + 0.01, 1.6, -0.6, 0, PI / 2, 0), mat('#ffffff', { map: poster, rough: 0.7 }), { cast: false });
  b.add(xf(G.box(0.07, 2.1, 0.95), X1 - 0.03, 1.05, 1.6), mat('#ffffff', { map: TEX.wood('#7a5236', [1, 2], 2), rough: 0.6 }));
  b.add(xf(G.box(0.08, 0.1, 1.15), X1 - 0.04, 2.15, 1.6), fr);
  b.add(xf(G.sph(0.03, 8, 6), X1 - 0.08, 1.05, 1.25), mat('#c9a24a', { metal: 1, rough: 0.3 }));
  b.build(g);
  // pencere dışı manzara
  const viewTex = (time) => canvasTex(512, 512, (x, w, h) => {
    const P = SKY[time] || SKY.day;
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, P.top); gr.addColorStop(0.7, P.mid); gr.addColorStop(1, P.bot); x.fillStyle = gr; x.fillRect(0, 0, w, h);
    const r = mulberry32(3);
    for (let i = 0; i < 9; i++) {
      const bw = 50 + r() * 60, bh = 160 + r() * 220, bx = i * 60 - 20;
      x.fillStyle = time === 'night' ? '#1a2234' : '#8a8478'; x.fillRect(bx, h - bh, bw, bh);
      for (let j = 0; j < 14; j++) for (let k = 0; k < 3; k++) { if (r() < (time === 'night' ? 0.4 : 0.15)) { x.fillStyle = time === 'night' ? '#ffd08a' : '#c9d6e0'; x.fillRect(bx + 8 + k * 14, h - bh + 14 + j * 22, 8, 12); } }
    }
  });
  const view = new THREE.Mesh(G.plane(2.8, 2.6), basic('#ffffff', { fog: false })); view.position.set(1.0, 1.5, Z0 - 0.9); g.add(view);
  const glass = new THREE.Mesh(G.plane(wx1 - wx0, wy1 - wy0), new THREE.MeshStandardMaterial({ color: '#a8c0d0', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.12 })); glass.position.set((wx0 + wx1) / 2, (wy0 + wy1) / 2, Z0 - 0.005); g.add(glass);
  // dinamik aksesuarlar
  const lock = new THREE.Group(); lock.position.set(-1.1, 1.1, -1.41); g.add(lock);
  const lbdy = new THREE.Mesh(G.rbox(0.07, 0.07, 0.03, 0.008), mat('#c9a24a', { metal: 0.9, rough: 0.3 })); lbdy.position.y = -0.05; lbdy.castShadow = true; lock.add(lbdy);
  const shk = new THREE.Mesh(G.tor(0.025, 0.006, 6, 14, PI), mat('#c8ccd2', { metal: 1, rough: 0.2 })); shk.position.y = -0.015; lock.add(shk);
  const tripod = new THREE.Group(); tripod.position.set(-0.6, 0, 0.9); tripod.rotation.y = PI + 0.25; g.add(tripod);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; const l = new THREE.Mesh(G.cyl(0.008, 0.008, 1.25, 6), mat('#1a1a1a', { metal: 0.6 })); l.position.set(Math.cos(a) * 0.12, 0.6, Math.sin(a) * 0.12); l.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18); tripod.add(l); }
  const ph = makeHandProp('phone'); ph.position.set(0, 1.27, 0); ph.rotation.set(0, 0, PI / 2); tripod.add(ph);
  const rec = new THREE.Mesh(G.sph(0.008, 6, 4), glow('#ff2a2a', 6)); rec.position.set(0.05, 1.32, 0.012); tripod.add(rec);
  const cat = new Cat({ color: '#f4f1ea', stripe: '#e4ded2', belly: '#ffffff', size: 1.1 }); cat.root.position.set(-1.1, 2.11, -1.75); cat.root.rotation.y = 0.5; g.add(cat.root);
  const crumpled = new THREE.Group(); { const r = mulberry32(4); const pm = mat('#f1ead8', { rough: 0.95, flat: true }); for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), pm); m.position.set(-1.5 + (r() - 0.5) * 0.9, 0.04, 0.4 + r() * 0.9); m.rotation.set(r() * 3, r() * 3, 0); m.castShadow = true; crumpled.add(m); } const m2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), pm); m2.position.set(-1.75, 0.79, 0.3); crumpled.add(m2); const pad = new THREE.Mesh(G.plane(0.2, 0.28), mat('#f6f1e4', { rough: 0.95 })); pad.rotation.x = -PI / 2; pad.position.set(-1.75, 0.765, 0.55); crumpled.add(pad); } g.add(crumpled);
  const stand = new THREE.Group(); { const cb = new Batch(); const m = mat('#3a2a20', { rough: 0.6 }); cb.add(xf(G.cyl(0.02, 0.02, 1.8, 8), 0, 0.9, 0), m); cb.add(xf(G.cyl(0.18, 0.2, 0.03, 12), 0, 0.015, 0), m); const cg = G.lathe([[0.04, 0.0], [0.15, -0.05], [0.17, -0.35], [0.21, -0.95]], 18); cg.scale(1, 1, 0.5); cb.add(xf(cg, 0, 1.75, 0.08), mat('#ffffff', { map: TEX.wool('#b8844e', [1, 1]), rough: 0.95, side: THREE.DoubleSide })); cb.build(stand); } stand.position.set(-0.25, 0, -1.65); g.add(stand);
  const blanket = new THREE.Mesh(G.rbox(1.3, 0.16, 1.45, 0.07), mat('#ffffff', { map: TEX.check('#2e4a6a', '#d9cbb2', [3, 3]), rough: 0.95 })); blanket.position.set(1.1, 0.56, -0.65); blanket.castShadow = true; blanket.receiveShadow = true; g.add(blanket);
  const views = {};
  return {
    group: g, interior: true, shadowExt: 3.5,
    anchors: { wardrobe: V(-1.1, 1.25, -1.5), bed: V(1.1, 0.6, -1.0), desk: V(-1.9, 0.8, 0.6), window: V(1.0, 1.5, -2), door: V(2.1, 1.3, 1.6), cat: V(-1.1, 2.25, -1.7), floor: V(0.4, 0, 0.2) },
    wide: { pos: V(0.6, 1.7, 2.8), look: V(-0.2, 1.1, -0.8) },
    crowd: { zone: [-1, 1, 0, 1] },
    camBox: [X0 + 0.15, X1 - 0.15, 0.2, HH - 0.1, Z0 + 0.15, Z1 - 0.15],
    onShot(shot) {
      const pr = new Set(shot.props || []);
      lock.visible = pr.has('padlock') || pr.has('padlock_open');
      shk.rotation.y = pr.has('padlock_open') ? 1.2 : 0; shk.position.y = pr.has('padlock_open') ? 0.0 : -0.015;
      tripod.visible = pr.has('tripod');
      cat.root.visible = pr.has('cat_top');
      crumpled.visible = pr.has('crumpled');
      stand.visible = pr.has('coat_stand');
      const lying = shot.cast.some((c) => (c.pose || []).some(([, p]) => p === 'lying'));
      blanket.position.y = lying ? 0.66 : 0.56; blanket.scale.y = lying ? 1.6 : 1;
      const tm = shot.time === 'night' ? 'night' : shot.time === 'morning' ? 'morning' : 'day';
      if (!views[tm]) views[tm] = viewTex(tm);
      view.material.map = views[tm]; view.material.color.setScalar(tm === 'night' ? 1.4 : 1.8); view.material.needsUpdate = true;
      rec.visible = tripod.visible && shot.time === 'night';
    },
    update(t, shot) { if (cat.root.visible) cat.update(t, 'sit', 0); },
    light: (time) => ({
      morning: L('morning', { interiorEnv: { wall: '#6a7a70', window: '#ffe2b8', winI: 2.6, lampI: 0.6 }, sun: { pos: V(2.8, 3.6, -5), color: '#ffd29a', I: 3.2 }, points: [{ pos: V(1.0, 1.6, -1.6), color: '#ffd8a8', I: 2.0, d: 4 }], fog: ['#3a2f28', 0], exp: 1.05 }),
      day: L('day', { interiorEnv: { wall: '#6a7a70', window: '#f2f6ff', winI: 2.4, lampI: 0.6 }, sun: { pos: V(2.8, 4.2, -5), color: '#fff4e4', I: 2.6 }, points: [{ pos: V(1.0, 1.6, -1.6), color: '#e8f0ff', I: 1.6, d: 4 }], fog: ['#3a2f28', 0], exp: 1.05 }),
      night: L('night', { interiorEnv: { wall: '#3a3a44', window: '#6a80b0', winI: 0.6, lampI: 1.8 }, sun: { pos: V(3, 4, -5), color: '#8aa0d8', I: 0.5 }, points: [{ pos: V(-1.95, 1.12, 1.05), color: '#ffc478', I: 3.2, d: 4.5 }, { pos: V(1.0, 1.5, -1.7), color: '#7f9ad0', I: 0.8, d: 3.5 }, { pos: V(-1.9, 0.95, 0.75), color: '#8fb6e8', I: 0.6, d: 1.8 }], fog: ['#141b30', 0], exp: 1.12 }),
    }[time] || null),
  };
}

export function pier(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  ground(b, 40, 10, mat('#ffffff', { map: TEX.tiles('#b9b2a6', '#a8a094', [20, 5], 8), rough: 0.85 }), 0, 0, 3.8);
  b.add(xf(G.box(40, 0.75, 0.35), 0, -0.37, -1.03), mat('#8a8478', { rough: 0.95 }));
  b.add(xf(G.box(40, 0.12, 0.42), 0, 0.06, -1.0), mat('#d0c8b8', { rough: 0.9 }));
  for (let x = -12; x <= 12; x += 3) b.add(xf(G.cyl(0.12, 0.15, 0.45, 12), x, 0.22, -0.85), mat('#2a2a2a', { metal: 0.5, rough: 0.5 }));
  // iskele binası + saat kulesi
  const pw = mat('#e8dcc6', { rough: 0.9 });
  b.add(xf(G.box(7, 4.2, 5.5), 10.5, 2.1, 2.2), pw);
  b.add(xf(G.box(7.4, 0.3, 5.9), 10.5, 4.3, 2.2), mat('#c9b48a'));
  const roof = new THREE.ConeGeometry(4.6, 1.6, 4); roof.rotateY(PI / 4); roof.scale(1.1, 1, 0.85);
  b.add(xf(roof, 10.5, 5.2, 2.2), mat('#6a3a2a', { rough: 0.8 }));
  b.add(xf(G.box(1.4, 3.0, 1.4), 7.6, 5.6, 0.2), pw);
  b.add(xf(G.cone(1.1, 1.3, 4), 7.6, 7.75, 0.2, 0, PI / 4, 0), mat('#6a3a2a', { rough: 0.8 }));
  const clock = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#f4efe2'; x.beginPath(); x.arc(128, 128, 120, 0, 7); x.fill(); x.strokeStyle = '#2a2a2a'; x.lineWidth = 8; x.stroke(); for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; x.fillStyle = '#2a2a2a'; x.fillRect(128 + Math.sin(a) * 96 - 4, 128 - Math.cos(a) * 96 - 10, 8, 20); } x.lineWidth = 10; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + 60 * Math.sin(8.75 / 12 * PI * 2), 128 - 60 * Math.cos(8.75 / 12 * PI * 2)); x.stroke(); x.lineWidth = 6; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + 90 * Math.sin(47 / 60 * PI * 2), 128 - 90 * Math.cos(47 / 60 * PI * 2)); x.stroke(); });
  b.add(xf(G.cyl(0.5, 0.5, 0.04, 24), 7.6, 6.1, -0.52, PI / 2, 0, 0), mat('#ffffff', { map: clock, rough: 0.5 }));
  for (let i = 0; i < 5; i++) { b.add(xf(G.box(0.9, 2.2, 0.05), 8.0 + i * 1.25, 1.3, -0.57), mat('#2b3a48', { rough: 0.3, metal: 0.3 })); b.add(xf(G.cyl(0.45, 0.45, 0.06, 16, false), 8.0 + i * 1.25, 2.4, -0.56, PI / 2, 0, 0), mat('#2b3a48', { rough: 0.3 })); }
  const sign = TEX.sign('KADIKÖY', { bg: '#1f3b55', fg: '#f4e7c8', font: '700 80px "Playfair Display"' });
  b.add(xf(G.plane(3.2, 0.7), 10.5, 3.6, -0.56), mat('#ffffff', { map: sign, rough: 0.6 }), { cast: false });
  // simit arabası
  const red = mat('#b8322c', { rough: 0.5 });
  b.add(xf(G.box(0.9, 0.55, 0.55), 2.35, 0.75, 0.15), red);
  b.add(xf(G.box(0.86, 0.38, 0.5), 2.35, 1.22, 0.15), new THREE.MeshStandardMaterial({ color: '#cfe6f0', transparent: true, opacity: 0.35, roughness: 0.05 }), { cast: false });
  for (let i = 0; i < 6; i++) b.add(xf(G.tor(0.06, 0.022, 8, 16), 2.05 + (i % 3) * 0.3, 1.1 + Math.floor(i / 3) * 0.1, 0.15 + (i % 2) * 0.1, PI / 2, 0, 0), mat('#b8743a'));
  b.add(xf(G.box(0.94, 0.04, 0.58), 2.35, 1.42, 0.15), red);
  for (const sd of [-1, 1]) b.add(xf(G.cyl(0.18, 0.18, 0.04, 16), 2.35 + sd * 0.3, 0.18, 0.45, PI / 2, 0, 0), mat('#1a1a1a'));
  for (const x of [-9, -4.5, 4.5]) lampPost(b, x, -0.5, { lit: false });
  bench(b, -6.5, 4.5, PI);
  bench(b, 3.5, 5.6, PI);
  b.build(g);
  const water = makeWater({ y: -0.65, color: '#1f4e66' }); g.add(water);
  const sky = makeSkyline({ z: -150, color: '#7a8590', lights: false, seed: 4 }); g.add(sky);
  const fer = ferry(); g.add(fer);
  const gulls = new Birds(g, { n: 5, kind: 'gull', seed: 4 });
  let departT = null;
  return {
    group: g, interior: false, shadowExt: 7,
    ferry: fer,
    anchors: { ferry: V(0, 2.2, -4.4), sea: V(-2, 0, -14) },
    dyn: { ferry: () => fer.position.clone().add(V(0, 2.2, 0)) },
    wide: { pos: V(-1.5, 1.9, 7.2), look: V(-1.5, 1.2, -1.5) },
    crowd: { zone: [-8, 4, 1.4, 5.0], avoid: [[2.35, 0.15, 1.0]] },
    onShot(shot, tl) {
      const c = (tl.cues || []).find((q) => q.type === 'ferry_depart' && q.shot === shot.i);
      // aynı sahnede önceki çekimde kalktıysa uzakta kalsın
      const prev = (tl.cues || []).filter((q) => q.type === 'ferry_depart' && q.shot < shot.i).pop();
      departT = c ? c.t : prev ? prev.t - 1000 : null;
      sky.children.forEach((o) => { if (o.material) o.material.color && 0; });
    },
    update(t, shot) {
      water.userData.update(t, 0.006);
      gulls.update(t);
      let x = 0, z = -4.4;
      if (departT !== null) { const k = Math.max(0, t - departT); x = -(k * k * 0.18 + k * 0.5); z = -4.4 - k * 0.35; if (departT < -100) { x = -60; } }
      fer.position.set(x, 0, z);
    },
    light: (time) => ({
      morning: L('morning', { sun: { pos: V(-10, 7, 8), color: '#ffd29a', I: 2.6 }, fog: ['#e9cfb2', 0.012], exp: 1.02 }),
      day: L('day', { sun: { pos: V(8, 10, 6), color: '#fff0d8', I: 2.6 }, fog: ['#c9d6e0', 0.01], exp: 1.0 }),
    }[time] || null),
  };
}

export function street(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  const cob = mat('#ffffff', { map: TEX.cobble('#6d655c', [14, 3]), rough: 0.9 });
  ground(b, 50, 4, cob, 0, 0, 0.5);
  const side = mat('#ffffff', { map: TEX.tiles('#b8b0a2', '#aaa294', [25, 1], 8), rough: 0.85 });
  b.add(xf(G.box(50, 0.14, 1.5), 0, 0.07, -2.25), side); b.add(xf(G.box(50, 0.14, 1.5), 0, 0.07, 3.25), side);
  b.add(xf(G.box(50, 0.15, 0.12), 0, 0.075, -1.5), mat('#9a9286')); b.add(xf(G.box(50, 0.15, 0.12), 0, 0.075, 2.5), mat('#9a9286'));
  for (const z of [0.25, 1.1]) b.add(xf(G.box(50, 0.02, 0.06), 0, 0.01, z), mat('#8a8a90', { metal: 0.9, rough: 0.3 }));
  const walls = ['#d9c3a0', '#c9a888', '#b8c0b0', '#e0cfb0', '#c8b8a8', '#cfa98a', '#b5bfc8'];
  const signs = ['SAHAF', 'SİMİT FIRINI', null, 'ÇAY OCAĞI', null, 'PLAK & KASET', 'BERBER', null];
  for (let i = 0; i < 8; i++) building(b, -21 + i * 6, -3, { w: 6, floors: 4 + (i % 3), seed: 60 + i, wall: walls[i % 7], facing: 1, lit: 0.45, shop: true, sign: signs[i] });
  for (let i = 0; i < 8; i++) building(b, -21 + i * 6, 4, { w: 6, floors: 4 + ((i + 2) % 3), seed: 80 + i, wall: walls[(i + 3) % 7], facing: -1, lit: 0.45, shop: true, sign: signs[(i + 3) % 8] });
  for (const x of [-9, -3, 3, 9]) { lampPost(b, x, -1.75, { lit: true }); tree(b, x + 1.5, -1.9, { h: 4.8, seed: x + 20 }); }
  for (const x of [-6, 0, 6]) lampPost(b, x, 2.75, { lit: true });
  // nostaljik tramvay (uzakta)
  const tr = mat('#b8322c', { rough: 0.5 });
  b.add(xf(G.rbox(5.5, 2.4, 2.1, 0.2), -14, 1.45, 0.68), tr);
  b.add(xf(G.box(5.0, 0.8, 2.12), -14, 1.85, 0.68), mat('#2b3a48', { rough: 0.2, metal: 0.4 }));
  b.add(xf(G.box(5.7, 0.15, 2.2), -14, 2.7, 0.68), mat('#efe6d6'));
  b.build(g);
  // İsmet Bey'in cumbası (gece, 9. bölüm)
  const cumba = new THREE.Group(); {
    const cb = new Batch(); const wm = mat('#c9a888', { rough: 0.9 }); const inside = mat('#d9a86a', { rough: 0.9, em: '#ffb060', emI: 0.35, side: THREE.BackSide });
    cb.add(xf(G.box(1.8, 1.7, 0.85), 0.9, 3.95, -2.55), inside);
    cb.add(xf(G.box(1.9, 0.12, 0.95), 0.9, 3.05, -2.55), wm); cb.add(xf(G.box(1.9, 0.12, 0.95), 0.9, 4.85, -2.55), wm);
    for (const x of [0.0, 0.9, 1.8]) cb.add(xf(G.box(0.08, 1.7, 0.08), x, 3.95, -2.12), mat('#efe6d6'));
    cb.add(xf(G.box(1.9, 0.06, 0.06), 0.9, 3.55, -2.12), mat('#efe6d6'));
    cb.add(xf(G.box(0.5, 0.04, 0.4), 1.3, 3.45, -2.55), mat('#6a4630'));
    cb.build(cumba);
    const lampG = new THREE.Mesh(G.sph(0.06, 10, 8), glow('#ffcf8a', 5)); lampG.position.set(1.5, 4.5, -2.75); cumba.add(lampG);
  } g.add(cumba);
  const wet = new THREE.Mesh(G.plane(50, 8), new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 0.06, metalness: 0.4, transparent: true, opacity: 0.55, envMapIntensity: 1.4 }));
  wet.rotation.x = -PI / 2; wet.position.set(0, 0.012, 0.5); g.add(wet);
  const puddles = new THREE.Group(); { const r = mulberry32(6); const pm = new THREE.MeshStandardMaterial({ color: '#1a2026', roughness: 0.02, metalness: 0.6, envMapIntensity: 1.6 }); for (let i = 0; i < 9; i++) { const p = new THREE.Mesh(new THREE.CircleGeometry(0.3 + r() * 0.5, 20), pm); p.rotation.x = -PI / 2; p.scale.set(1.6, 1, 1); p.position.set(-8 + r() * 16, 0.016, -0.8 + r() * 2.8); puddles.add(p); } } g.add(puddles);
  const rain = new Rain(g, { count: 1800, area: [16, 9, 14] });
  const cat = new Cat({ size: 0.95 }); cat.root.position.set(-3.6, 0.14, -2.4); cat.root.rotation.y = 0.8; g.add(cat.root);
  let rainT = null;
  return {
    group: g, interior: false, shadowExt: 7,
    anchors: { sky: V(0, 9, -6) },
    wide: { pos: V(1.5, 1.9, 6.8), look: V(0.6, 1.3, -0.8) },
    crowd: { zone: [-8, 8, -2.6, 3.4], avoid: [[0, -0.5, 1.4]] },
    onShot(shot, tl) {
      const isRain = shot.time === 'rain';
      wet.visible = isRain; puddles.visible = isRain;
      const c = (tl.cues || []).find((q) => q.type === 'rain_start' && q.shot === shot.i);
      rainT = isRain ? (c ? c.t : -100) : null;
      cumba.visible = (shot.props || []).includes('window_ismet');
      cat.root.visible = !isRain && shot.time !== 'night';
    },
    update(t, shot, D) {
      rain.update(t, rainT === null ? 0 : clamp((t - rainT) / 0.6), D.camera.position);
      if (cat.root.visible) cat.update(t, 'sit', 0);
    },
    light: (time) => ({
      day: L('day', { sun: { pos: V(5, 10, 7), color: '#fff0d8', I: 2.7 }, fog: ['#c9d6e0', 0.012], exp: 1.02 }),
      rain: L('rain', { sun: { pos: V(2, 10, 4), color: '#d9e0e8', I: 0.7 }, points: [{ pos: V(3, 3.7, -1.75), color: '#ffd59a', I: 2.2, d: 7 }, { pos: V(-3, 3.7, -1.75), color: '#ffd59a', I: 2.2, d: 7 }], fog: ['#8f989f', 0.05], exp: 1.08, sat: 0.85, tint: [0.95, 1.0, 1.06] }),
      night: L('night', { sun: { pos: V(-4, 8, 6), color: '#9fb4ff', I: 0.4 }, points: [{ pos: V(1.2, 4.4, -2.5), color: '#ffc478', I: 3.0, d: 3.5 }, { pos: V(3, 3.7, -1.75), color: '#ffd59a', I: 2.0, d: 7 }, { pos: V(-3, 3.7, -1.75), color: '#ffd59a', I: 2.0, d: 7 }], fog: ['#141b30', 0.03], exp: 1.15 }),
    }[time] || null),
  };
}

export function bookshop(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  const X0 = -2.4, X1 = 2.4, Z0 = -2.0, Z1 = 3.0, HH = 2.9;
  ground(b, X1 - X0, Z1 - Z0, mat('#ffffff', { map: TEX.wood('#4a3020', [2, 3], 10), rough: 0.6 }), 0, 0, 0.5);
  const wall = mat('#ffffff', { map: TEX.plaster('#2f4a3e', [3, 2]), rough: 0.95 });
  b.add(xf(G.plane(X1 - X0, HH), 0, HH / 2, Z0), wall, { cast: false });
  b.add(xf(G.plane(Z1 - Z0, HH), X0, HH / 2, 0.5, 0, PI / 2, 0), wall, { cast: false });
  b.add(xf(G.plane(Z1 - Z0, HH), X1, HH / 2, 0.5, 0, -PI / 2, 0), wall, { cast: false });
  b.add(xf(G.plane(X1 - X0, HH), 0, HH / 2, Z1, 0, PI, 0), wall, { cast: false });
  b.add(xf(G.plane(X1 - X0, Z1 - Z0), 0, HH, 0.5, PI / 2, 0, 0), mat('#3a2a20', { rough: 1 }), { cast: false });
  const shelfW = mat('#ffffff', { map: TEX.wood('#5a3a24', [1, 1], 3), rough: 0.7 });
  const shelfUnit = (x, z, w, ry, seed) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
    b.add(xf(G.box(w, 2.75, 0.04), ...P(0, 1.375, -0.17), 0, ry, 0), shelfW);
    for (const lx of [-w / 2, w / 2]) b.add(xf(G.box(0.05, 2.75, 0.38), ...P(lx, 1.375, 0), 0, ry, 0), shelfW);
    for (let i = 0; i < 7; i++) {
      const y = 0.12 + i * 0.4;
      b.add(xf(G.box(w, 0.035, 0.38), ...P(0, y, 0), 0, ry, 0), shelfW);
      if (i < 6) {
        const tex = TEX.bookSpines(seed * 10 + i);
        const front = mat('#ffffff', { map: tex, rough: 0.8 });
        const bg = G.box(w - 0.08, 0.33, 0.27);
        b.add(xf(bg, ...P(0, y + 0.18, 0.02), 0, ry, 0), [mat('#3a2a20'), mat('#3a2a20'), mat('#3a2a20'), mat('#3a2a20'), front, mat('#3a2a20')][4]);
      }
    }
  };
  for (const x of [-1.6, -0.5, 0.6, 1.7]) shelfUnit(x, -1.78, 1.05, 0, Math.round(x * 10) + 30);
  for (const z of [-0.8, 0.3, 1.4]) shelfUnit(X0 + 0.22, z, 1.05, PI / 2, Math.round(z * 10) + 50);
  // tezgâh
  b.add(xf(G.box(1.4, 0.95, 0.6), 1.05, 0.475, -0.5), mat('#ffffff', { map: TEX.wood('#6a4630', [1, 1], 4), rough: 0.6 }));
  b.add(xf(G.box(1.5, 0.04, 0.68), 1.05, 0.97, -0.5), mat('#3a2418', { rough: 0.4 }));
  b.add(xf(G.rbox(0.32, 0.22, 0.28, 0.03), 1.55, 1.1, -0.55), mat('#2a2a2a', { metal: 0.6, rough: 0.35 }));
  for (let i = 0; i < 4; i++) b.add(xf(G.box(0.22, 0.05, 0.3), 0.55, 1.01 + i * 0.05, -0.45, 0, i * 0.2, 0), mat(['#7a2e2e', '#2e4a6a', '#8a6a2a', '#3a5a3a'][i], { rough: 0.8 }));
  b.add(xf(G.cyl(0.07, 0.08, 0.02, 12), 0.75, 0.99, -0.68), mat('#c9a24a', { metal: 1, rough: 0.3 }));
  b.add(xf(G.cyl(0.01, 0.01, 0.3, 6), 0.75, 1.14, -0.68), mat('#c9a24a', { metal: 1 }));
  b.add(xf(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 16, 1, true, 0, PI), 0.75, 1.3, -0.62, 0, 0, PI / 2), mat('#2e6a4a', { rough: 0.3, side: THREE.DoubleSide }));
  // merdiven
  const lm = mat('#6a4630', { rough: 0.7 });
  for (const sd of [-1, 1]) b.add(xf(G.box(0.04, 2.6, 0.05), -1.2 + sd * 0.22, 1.3, -1.45, 0.17, 0, 0), lm);
  for (let i = 0; i < 7; i++) b.add(xf(G.box(0.44, 0.03, 0.04), -1.2, 0.3 + i * 0.36, -1.37 - i * 0.06), lm);
  // pencere ışık huzmesi
  b.add(xf(G.plane(1.2, 1.4), X0 + 0.01, 1.7, 2.2, 0, PI / 2, 0), mat('#ffffff', { em: '#fff2d6', emI: 2.4 }), { cast: false });
  b.add(xf(G.box(0.08, 2.0, 0.3), 1.5, 1.0, 2.0), mat('#3a2a20'));
  b.build(g);
  const beam = new THREE.Mesh(G.plane(1.0, 3.5), basic('#fff0c8', { op: 0.07, add: true, side: THREE.DoubleSide })); beam.position.set(-1.2, 1.4, 1.6); beam.rotation.set(0, PI / 2 - 0.5, 0.6); g.add(beam);
  const dust = new Dust(g, { count: 260, box: [3.2, 2.4, 3.2], center: [-0.6, 1.4, 0.8] });
  const lamp = new THREE.Mesh(G.sph(0.04, 8, 6), glow('#ffd59a', 4)); lamp.position.set(0.75, 1.25, -0.62); g.add(lamp);
  const cat = new Cat({ size: 1.45 }); g.add(cat.root);
  // düşen kitaplar
  const fall = []; { const r = mulberry32(13); const pal = ['#7a2e2e', '#2e4a6a', '#3a5a3a', '#8a6a2a', '#5a3a5a', '#2a2a2a', '#9a8a6a']; for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(G.box(0.16 + r() * 0.06, 0.24 + r() * 0.06, 0.035 + r() * 0.03), mat(pal[i % pal.length], { rough: 0.8 })); m.castShadow = true; m.userData = { p0: V(0.1 + r() * 1.0, 1.3 + r() * 1.2, -1.75), v: V((r() - 0.6) * 1.2, 0.6 + r() * 1.4, 1.0 + r() * 1.6), w: V(r() * 9, r() * 9, r() * 9), d: r() * 0.35, land: V(-0.3 + r() * 1.4, 0, -0.9 + r() * 1.7) }; m.visible = false; g.add(m); fall.push(m); } }
  let booksT = null, jumpT = null;
  return {
    group: g, interior: true, shadowExt: 3.5,
    anchors: { cat: V(1.15, 1.1, -0.5), shelf: V(0.4, 1.9, -1.75), counter: V(1.05, 1.0, -0.5) },
    wide: { pos: V(0.2, 1.65, 2.75), look: V(0.4, 1.15, -0.8) },
    crowd: { zone: [-1, 1, 0.5, 2] },
    camBox: [X0 + 0.15, X1 - 0.15, 0.2, HH - 0.1, Z0 + 0.15, Z1 - 0.15],
    onShot(shot, tl) {
      const pr = new Set(shot.props || []);
      const bc = (tl.cues || []).find((q) => q.type === 'books' && q.shot === shot.i);
      booksT = bc ? bc.t : null;
      const jc = (tl.cues || []).find((q) => q.type === 'cat_jump' && q.shot === shot.i);
      jumpT = jc ? jc.t : null;
      cat.root.visible = pr.has('cat_counter') || pr.has('cat_jump');
      cat.mode = pr.has('cat_jump') ? 'jump' : 'sleep';
      cat.petStart = shot.cast.find((c) => (c.do || []).some(([, a]) => a === 'pet'))?.do?.[0]?.[0];
    },
    update(t, shot) {
      dust.update(t);
      const home = V(1.15, 0.99, -0.5), top = V(0.35, 2.86, -1.75);
      if (cat.root.visible) {
        if (cat.mode === 'jump') {
          const k = jumpT === null ? 0 : clamp((t - jumpT) / 0.55);
          if (k <= 0) { cat.root.position.copy(home); cat.root.rotation.y = -0.6; cat.update(t, 'wake', 0.5); }
          else if (k < 1) { const p = home.clone().lerp(top, ease.inOutCubic(k)); p.y += Math.sin(k * PI) * 0.7; cat.root.position.copy(p); cat.root.rotation.y = -2.4; cat.update(t, 'jump', k); }
          else { cat.root.position.copy(top); cat.root.rotation.y = 0.2; cat.update(t, 'sit', 0); }
        } else {
          cat.root.position.copy(home); cat.root.rotation.y = -0.6;
          const wake = cat.petStart !== undefined && t > cat.petStart + 1.0 ? clamp((t - cat.petStart - 1.0) / 0.8) : 0;
          cat.update(t, wake > 0 ? 'wake' : 'sleep', wake);
        }
      }
      fall.forEach((m) => {
        if (booksT === null || t < booksT + m.userData.d) { m.visible = false; return; }
        m.visible = true;
        const k = t - booksT - m.userData.d, u = m.userData;
        const p = u.p0.clone().add(u.v.clone().multiplyScalar(k)); p.y -= 4.9 * k * k;
        if (p.y < 0.03) { p.copy(u.land); p.y = 0.03 + (u.d * 0.05); m.rotation.set(PI / 2, u.w.y, 0); }
        else m.rotation.set(u.w.x * k, u.w.y * k, u.w.z * k);
        m.position.copy(p);
      });
    },
    light: () => L('day', { interiorEnv: { wall: '#4a5a4a', window: '#fff2d6', winI: 2.0, lampI: 1.6 }, sun: { pos: V(-5, 4, 3), color: '#ffe2b0', I: 2.4 }, points: [{ pos: V(0.75, 1.3, -0.5), color: '#ffc478', I: 2.4, d: 3.5 }, { pos: V(-0.5, 2.6, 0.8), color: '#ffd8a8', I: 1.0, d: 5 }], fog: ['#2a2420', 0.0], exp: 1.08, sat: 1.05, tint: [1.04, 1.0, 0.94] }),
  };
}

export function square(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  ground(b, 60, 60, mat('#ffffff', { map: TEX.tiles('#bdb4a6', '#aea596', [24, 24], 4), rough: 0.88 }));
  // boğa heykeli
  b.add(xf(G.rbox(2.4, 1.25, 1.3, 0.05), 0, 0.625, -2.9), mat('#8a8680', { rough: 0.6 }));
  b.add(xf(G.rbox(2.6, 0.12, 1.5, 0.03), 0, 1.3, -2.9), mat('#7a766f', { rough: 0.6 }));
  const br = mat('#4a3a26', { rough: 0.35, metal: 0.85 });
  const bull = (x, y, z) => {
    b.add(xf(G.cap(0.38, 0.9, 6, 16), x, y + 0.85, z, 0, 0, PI / 2), br);
    b.add(xf(G.sph(0.5, 18, 14), x + 0.45, y + 0.95, z, 0, 0, 0, 1, 1.05, 0.95), br);
    b.add(xf(G.rbox(0.42, 0.42, 0.38, 0.12), x + 1.0, y + 0.6, z, 0, 0, 0.7), br);
    b.add(xf(G.rbox(0.22, 0.2, 0.3, 0.08), x + 1.2, y + 0.42, z, 0, 0, 0.7), br);
    for (const sd of [-1, 1]) { b.add(xf(G.tor(0.18, 0.04, 8, 14, PI * 0.8), x + 0.98, y + 0.85, z + sd * 0.22, PI / 2 * sd, 0, 0.3), br); }
    for (const [lx, lz, a] of [[0.55, 0.2, -0.5], [0.55, -0.2, 0.2], [-0.5, 0.2, 0.6], [-0.5, -0.2, -0.2]]) b.add(xf(G.cyl(0.08, 0.06, 0.75, 8), x + lx, y + 0.32, z + lz, 0, 0, a * 0.6), br);
    b.add(xf(G.cyl(0.025, 0.02, 0.7, 6), x - 0.75, y + 0.75, z, 0, 0, -0.9), br);
  };
  bull(-0.2, 1.36, -2.9);
  const walls = ['#d9c3a0', '#c9a888', '#b8c0b0', '#e0cfb0', '#c8b8a8', '#cfa98a'];
  for (let i = 0; i < 8; i++) building(b, -21 + i * 6, -9, { w: 6, floors: 5 + (i % 3), seed: 100 + i, wall: walls[i % 6], facing: 1, lit: 0.3, sign: ['ALTIYOL ECZANESİ', null, 'BÖREKÇİ', null, 'KIRTASİYE', null, 'LOKANTA', null][i] });
  for (let i = 0; i < 8; i++) building(b, -21 + i * 6, 10, { w: 6, floors: 5 + ((i + 1) % 3), seed: 120 + i, wall: walls[(i + 2) % 6], facing: -1, lit: 0.3, sign: [null, 'SİMİTÇİ', null, 'KAFE', null, null, 'KUAFÖR', null][i] });
  for (const [x, z] of [[-5, -5], [5, -5.5], [-6, 3], [6.5, 2.5]]) tree(b, x, z, { h: 5, seed: x * 3 + z });
  for (const [x, z] of [[-3.5, -5.5], [3.5, -5.5]]) lampPost(b, x, z, { lit: false });
  bench(b, -4, -3.6, 0.4); bench(b, 4.2, -3.8, -0.4);
  b.build(g);
  const pigeons = new Birds(g, { n: 14, kind: 'pigeon', seed: 7, area: [-2.5, 2.5, -1.4, 1.8] });
  let flyT = null;
  return {
    group: g, interior: false, shadowExt: 7,
    anchors: { statue: V(0.3, 2.4, -2.9) },
    wide: { pos: V(2.2, 2.4, 6.5), look: V(0, 1.3, -1.2) },
    crowd: { zone: [-6, 6, -1.6, 4.5], avoid: [[0, 0.3, 1.6], [0, -2.9, 1.8]] },
    onShot(shot, tl) {
      const c = (tl.cues || []).filter((q) => q.type === 'pigeons' && q.shot <= shot.i).pop();
      flyT = c ? (c.shot === shot.i ? c.t : c.t) : null;
    },
    update(t) { pigeons.update(t, { flyAt: flyT }); pigeons.items.forEach((it) => { it.g.visible = flyT === null || t < flyT + 3.5; }); },
    light: () => L('day', { sun: { pos: V(6, 10, 5), color: '#fff0d8', I: 2.7 }, fog: ['#c9d6e0', 0.012], exp: 1.02 }),
  };
}

export function cafe(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  ground(b, 30, 14, mat('#ffffff', { map: TEX.tiles('#c9b89a', '#b8a888', [15, 7], 6), rough: 0.9 }), 0, 0, 2.5);
  b.add(xf(G.box(30, 0.6, 0.4), 0, -0.3, -4.4), mat('#8a8478'));
  const rm = mat('#2a2e33', { metal: 0.6, rough: 0.4 });
  b.add(xf(G.box(30, 0.05, 0.05), 0, 1.0, -2.45), rm); b.add(xf(G.box(30, 0.03, 0.03), 0, 0.55, -2.45), rm);
  for (let x = -14; x <= 14; x += 1.2) b.add(xf(G.box(0.04, 1.0, 0.04), x, 0.5, -2.45), rm);
  b.add(xf(G.box(30, 4.0, 2.0), 0, -2.3, -3.5), mat('#7a7468', { rough: 1 }));
  roundTable(b, 0, 0);
  chair(b, -0.62, 0, PI / 2); chair(b, 0.62, 0, -PI / 2);
  const others = [[-2.7, -0.9], [2.7, -0.6], [-2.3, 2.6], [2.4, 2.4], [0.2, 3.4]];
  for (const [x, z] of others) { roundTable(b, x, z, { cloth: TEX.check('#3a6a5a', '#f2ede4', [2, 2]) }); chair(b, x - 0.6, z, PI / 2); chair(b, x + 0.6, z, -PI / 2); }
  for (const [x, z] of [[-4.5, 0.8], [4.6, 1.0], [-1.2, 5.2], [3.2, 5.0]]) tree(b, x, z, { h: 4.2, seed: Math.round(x * 7 + z), leaf: '#4a6e38' });
  stringLights(b, [-4.5, 3.4, 0.8], [4.6, 3.4, 1.0], { n: 18, sag: 0.6 });
  stringLights(b, [-1.2, 3.3, 5.2], [3.2, 3.3, 5.0], { n: 12, sag: 0.4 });
  stringLights(b, [-4.5, 3.3, 0.8], [-1.2, 3.3, 5.2], { n: 12, sag: 0.4 });
  b.build(g);
  for (const [x, z] of others) teaGlass(g, x + 0.1, 0.76, z + 0.05, 1.2);
  const water = makeWater({ y: -3.2, color: '#2a5a72' }); g.add(water);
  const sky = makeSkyline({ z: -140, color: '#7a8590', lights: true, seed: 5 }); g.add(sky);
  const skyNight = sky.children.find((o) => o.isPoints);
  const cake = new THREE.Group(); { const cm = mat('#f2e6d0', { rough: 0.6 }); const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 24, 1, false, 0, PI * 1.7), cm); c1.position.set(0.08, 0.81, 0.08); c1.castShadow = true; cake.add(c1); const top = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.015, 24, 1, false, 0, PI * 1.7), mat('#7a2a2a', { rough: 0.3 })); top.position.set(0.08, 0.86, 0.08); cake.add(top); const pl = new THREE.Mesh(G.cyl(0.15, 0.13, 0.01, 24), mat('#f4f2ee')); pl.position.set(0.08, 0.765, 0.08); cake.add(pl); teaGlass(cake, -0.18, 0.76, -0.1, 1.15); teaGlass(cake, 0.18, 0.76, -0.12, 1.15); } g.add(cake);
  const chess = new THREE.Group(); {
    const tex = canvasTex(256, 256, (x, w, h) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#3a2a1e' : '#e8dcc0'; x.fillRect(i * 32, j * 32, 32, 32); } });
    const bd = new THREE.Mesh(G.box(0.42, 0.02, 0.42), [mat('#5a3a24'), mat('#5a3a24'), mat('#ffffff', { map: tex, rough: 0.5 }), mat('#5a3a24'), mat('#5a3a24'), mat('#5a3a24')]); bd.position.y = 0.77; bd.castShadow = true; chess.add(bd);
    const r = mulberry32(9); const wm = mat('#f2ede2', { rough: 0.4 }), bm = mat('#1a1410', { rough: 0.4 });
    for (let i = 0; i < 20; i++) { const side = i < 10 ? -1 : 1; const pc = new THREE.Mesh(G.lathe([[0.001, 0], [0.018, 0], [0.012, 0.02], [0.008, 0.04], [0.014, 0.05], [0.001, 0.06 + (i % 4 === 0 ? 0.02 : 0)]], 10), side < 0 ? wm : bm); pc.position.set(side * (0.06 + r() * 0.13), 0.78, -0.18 + r() * 0.36); pc.castShadow = true; chess.add(pc); }
    teaGlass(chess, -0.3, 0.76, 0.2, 1.15); teaGlass(chess, 0.3, 0.76, -0.2, 1.15);
  } g.add(chess);
  const benchFar = new THREE.Group(); { const bb = new Batch(); bench(bb, -2.65, 1.68, 2.09, { len: 1.4 }); bb.build(benchFar); } g.add(benchFar);
  return {
    group: g, interior: false, shadowExt: 6,
    seats: [[-0.62, 0], [0.62, 0], ...others.flatMap(([x, z]) => [[x - 0.6, z], [x + 0.6, z]])],
    anchors: { table: V(0, 0.8, 0), sea: V(0, -1, -30) },
    wide: { pos: V(1.6, 1.7, 4.6), look: V(-0.2, 0.9, -0.2) },
    crowd: { zone: [-4, 4, -1, 4], seated: others.flatMap(([x, z]) => [[x - 0.6, z, PI / 2], [x + 0.6, z, -PI / 2]]) },
    onShot(shot) {
      const pr = new Set(shot.props || []);
      cake.visible = pr.has('cake'); chess.visible = pr.has('chess'); benchFar.visible = pr.has('bench_far');
      if (skyNight) skyNight.visible = shot.time === 'evening' || shot.time === 'night';
    },
    update(t) { water.userData.update(t, 0.004); },
    light: (time) => ({
      day: L('day', { sun: { pos: V(6, 10, 5), color: '#fff0d8', I: 2.6 }, fog: ['#c9d6e0', 0.008], exp: 1.02 }),
      evening: L('evening', { sun: { pos: V(10, 3.2, -5), color: '#ffb070', I: 2.4 }, points: [{ pos: V(0, 3.0, 1.5), color: '#ffcf8a', I: 1.6, d: 6 }], fog: ['#e7a98a', 0.008], exp: 1.05, sat: 1.08, tint: [1.05, 0.98, 0.92] }),
    }[time] || null),
  };
}

export function deck(ctx) {
  const g = new THREE.Group(); const b = new Batch();
  ground(b, 14, 4.4, mat('#ffffff', { map: TEX.wood('#a07850', [6, 2], 12), rough: 0.7 }), 0, 0, 0.5);
  const white = mat('#efede6', { rough: 0.5 });
  b.add(xf(G.box(14, 0.05, 0.06), 0, 1.05, -1.65), white); b.add(xf(G.box(14, 0.035, 0.035), 0, 0.6, -1.65), white); b.add(xf(G.box(14, 0.035, 0.035), 0, 0.3, -1.65), white);
  for (let x = -7; x <= 7; x += 0.9) b.add(xf(G.box(0.045, 1.05, 0.045), x, 0.525, -1.65), white);
  b.add(xf(G.box(14, 0.25, 0.1), 0, -0.1, -1.7), mat('#b8322c', { rough: 0.5 }));
  b.add(xf(G.box(14, 3.0, 0.2), 0, 1.5, 2.75), white);
  const wtex = canvasTex(1024, 128, (x, w, h) => { x.fillStyle = '#efede6'; x.fillRect(0, 0, w, h); for (let i = 0; i < 12; i++) { x.fillStyle = '#ffdca0'; x.fillRect(20 + i * 84, 20, 60, 80); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(48 + i * 84, 20, 4, 80); } });
  b.add(xf(G.plane(13, 1.2), 0, 1.6, 2.64, 0, PI, 0), mat('#ffffff', { map: wtex, rough: 0.4, em: '#ffffff', emI: 0.0 }), { cast: false });
  b.add(xf(G.box(14, 0.12, 1.4), 0, 3.0, 2.1), white);
  bench(b, 0.1, 0.0, 0, { len: 2.2, wood: '#8a5a38' });
  bench(b, -4.2, 0.6, 0, { len: 2.2, wood: '#8a5a38' });
  bench(b, 4.4, 0.6, 0, { len: 2.2, wood: '#8a5a38' });
  b.add(xf(G.tor(0.28, 0.07, 10, 24), 2.6, 0.75, -1.58), mat('#e8622c', { rough: 0.6 }));
  for (let i = 0; i < 4; i++) b.add(xf(G.tor(0.28, 0.072, 10, 4, PI / 8), 2.6, 0.75, -1.575, 0, 0, i * PI / 2), white);
  lampPost(b, -2.2, 2.4, { h: 2.4, lit: true, color: '#efede6' });
  lampPost(b, 3.4, 2.4, { h: 2.4, lit: true, color: '#efede6' });
  b.add(xf(G.cyl(0.9, 1.0, 3.0, 20), -1.0, 4.6, 4.5), white); b.add(xf(G.cyl(0.92, 0.92, 0.6, 20), -1.0, 6.0, 4.5), mat('#20242a'));
  b.build(g);
  const water = makeWater({ y: -2.4, color: '#1a3f58' }); g.add(water);
  const wake = new THREE.Mesh(G.plane(40, 5), basic('#ffffff', { op: 0.15, add: true })); wake.rotation.x = -PI / 2; wake.position.set(10, -2.35, -5); g.add(wake);
  const sky = makeSkyline({ z: -160, color: '#5a6470', lights: true, seed: 6 }); g.add(sky);
  const lights = sky.children.find((o) => o.isPoints);
  const moon = new THREE.Mesh(G.sph(6, 20, 14), basic('#fff4d6', { fog: false })); moon.material.color.multiplyScalar(2.2); moon.position.set(-60, 70, -260); g.add(moon);
  const moonPath = new THREE.Mesh(G.plane(6, 120), basic('#ffe8b0', { op: 0.12, add: true, fog: false })); moonPath.rotation.x = -PI / 2; moonPath.position.set(-20, -2.38, -70); moonPath.rotation.z = 0.25; g.add(moonPath);
  const env = envelopeMesh(); env.position.set(0.32, 0.475, 0.0); env.rotation.y = 0.25; g.add(env);
  const gulls = new Birds(g, { n: 4, kind: 'gull', seed: 9 });
  const gullG = gulls.items.map((i) => i.g);
  return {
    group: g, interior: false, shadowExt: 5,
    anchors: { sea: V(0, 0, -30), bench: V(0.3, 0.5, 0.0), envelope: V(0.32, 0.48, 0.0) },
    wide: { pos: V(2.2, 1.7, 2.3), look: V(-1.5, 1.0, 0.3) },
    camBox: [-7, 7, 0.2, 2.9, -1.5, 2.55],
    crowd: { zone: [-5, 5, -0.8, 2] },
    onShot(shot) {
      env.visible = (shot.props || []).includes('envelope_bench');
      const night = shot.time === 'night';
      moon.visible = night; moonPath.visible = night; if (lights) lights.visible = night || shot.time === 'sunset';
      gullG.forEach((m) => { m.visible = !night; });
    },
    update(t) {
      water.userData.update(t, 0.02);
      sky.position.x = -t * 0.35;
      wake.position.x = 10 + Math.sin(t * 0.3) * 0.5;
      gulls.update(t);
    },
    light: (time) => ({
      night: L('night', { sun: { pos: V(-6, 8, -10), color: '#9fb4ff', I: 0.55 }, points: [{ pos: V(-2.2, 2.6, 2.2), color: '#ffcf8a', I: 2.6, d: 6 }, { pos: V(3.4, 2.6, 2.2), color: '#ffcf8a', I: 2.6, d: 6 }], fog: ['#141b30', 0.012], exp: 1.12 }),
      sunset: L('sunset', { sun: { pos: V(0, 2.2, -12), color: '#ffa060', I: 2.8 }, points: [{ pos: V(0, 2.6, 2.2), color: '#ffcf8a', I: 0.8, d: 6 }], fog: ['#e8906c', 0.01], exp: 1.05, sat: 1.1, tint: [1.06, 0.98, 0.9] }),
    }[time] || null),
  };
}

export function insert(ctx) {
  const g = new THREE.Group();
  const bokeh = new THREE.Group(); g.add(bokeh);
  const r = mulberry32(21);
  const cols = ['#ffcf8a', '#ffb070', '#ffe2b8', '#9fc4ff'];
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(G.sph(0.03 + r() * 0.04, 8, 6), glow(cols[i % 4], 3 + r() * 3)); m.position.set((r() - 0.5) * 3, 0.2 + r() * 1.0, -1.2 - r() * 1.5); bokeh.add(m); }
  let cur = null, curKey = null;
  return {
    group: g, interior: true, shadowExt: 0.8, isInsert: true,
    anchors: {},
    wide: { pos: V(0, 0.35, 0.25), look: V(0, 0, 0) },
    onShot(shot, tl) {
      const key = shot.i;
      if (curKey !== key) {
        if (cur) g.remove(cur.group);
        cur = buildInsert(shot.prop || { type: 'note' }, tl);
        g.add(cur.group); curKey = key;
      }
      bokeh.visible = shot.time === 'night' || shot.time === 'dawn';
      this.focus = cur.focus;
    },
    update(t, shot) { if (cur) cur.update(t, t - shot.start); },
    light: (time) => {
      const night = time === 'night' || time === 'dawn';
      return L(night ? 'night' : 'interior', { interiorEnv: { wall: night ? '#2a2a34' : '#7a6450', window: '#ffe8c8', winI: night ? 0.8 : 2.0, lampI: night ? 2.2 : 1.2 }, sun: { pos: V(-0.8, 1.6, 0.7), color: night ? '#ffc890' : '#fff0dc', I: night ? 2.4 : 3.0 }, points: night ? [{ pos: V(0.5, 0.6, -0.4), color: '#ffb870', I: 1.2, d: 2 }] : [], fog: ['#1a1510', 0], exp: 1.05, sat: 1.05, bg: night ? '#0b0d14' : '#3a2a20' });
    },
  };
}

export const SET_BUILDERS = { office, market, room, pier, street, bookshop, square, cafe, deck, insert };
