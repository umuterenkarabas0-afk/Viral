// Prosedürel 3D modeller: tekne, şişe, kupon, ağ, balık, martı, fener, köy evleri, oda mobilyaları...
import * as THREE from 'three';
import { mulberry32, clamp, lerp, noise3, fbm3, smoothstep } from '../util.js';
import * as TX from './textures.js';

export const M = (c, r = 0.6, m = 0, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r, metalness: m, ...extra });
const shadow = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };

// ------------------------------------------------------------------ tekne (Karadeniz kayığı)
export function makeBoat({ name = 'RIZA REİS', hullTop = '#f4f1ea', stripe = '#1f5fa8', bottom = '#9b2b25', cabin = '#f4f1ea' } = {}) {
  const g = new THREE.Group();
  const L = 7.2, NS = 40, NC = 24;
  const half = (u) => 1.18 * Math.pow(Math.sin(Math.PI * (0.06 + 0.9 * u)), 0.55);
  const sheer = (u) => 0.62 + 0.42 * Math.pow(u, 3) + 0.12 * Math.pow(1 - u, 4);
  const keel = (u) => -0.55 + 0.35 * Math.pow(u, 4) + 0.15 * Math.pow(1 - u, 3);
  const pos = [], colr = [], idx = [];
  const cTop = new THREE.Color(hullTop), cStripe = new THREE.Color(stripe), cBot = new THREE.Color(bottom);
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, z = (u - 0.5) * L, w = half(u), s = sheer(u), k = keel(u);
    for (let j = 0; j <= NC; j++) {
      const th = (j / NC) * Math.PI;
      const c = Math.cos(th), sn = Math.sin(th);
      const x = w * Math.sign(c) * Math.pow(Math.abs(c), 0.62);
      const y = s - (s - k) * Math.pow(sn, 0.7);
      pos.push(x, y, z);
      let cc = cTop;
      if (y < 0.08) cc = cBot; else if (y > s - 0.16) cc = cStripe; else if (Math.abs(y - 0.3) < 0.05) cc = cStripe;
      colr.push(cc.r, cc.g, cc.b);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) {
    const a = i * (NC + 1) + j, b = a + NC + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  hg.setIndex(idx); hg.computeVertexNormals();
  const hull = new THREE.Mesh(hg, M('#ffffff', 0.45, 0, { vertexColors: true, side: THREE.DoubleSide }));
  g.add(hull);
  // güverte
  const dpos = [], duv = [], didx = [];
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, z = (u - 0.5) * L, w = half(u) * 0.93, y = sheer(u) - 0.24;
    dpos.push(-w, y, z, w, y, z); duv.push(0, u * 6, 1.5, u * 6);
    if (i < NS) { const a = i * 2; didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3)); dg.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  dg.setIndex(didx); dg.computeVertexNormals();
  const deck = new THREE.Mesh(dg, M('#ffffff', 0.8, 0, { map: TX.woodTexture('#8a6440', 4, [1, 1]), side: THREE.DoubleSide }));
  g.add(deck);
  // küpeşte (iki yanda boru)
  const railM = M('#13396b', 0.5);
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push(new THREE.Vector3(half(u) * s, sheer(u) + 0.02, (u - 0.5) * L)); }
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.055, 8), railM);
    g.add(rail);
    // usturmaça lastikler
    for (let k = 0; k < 3; k++) {
      const u = [0.2, 0.3, 0.8][k];
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 8, 16), M('#151515', 0.85));
      tire.position.set(half(u) * s * 1.03, sheer(u) - 0.35, (u - 0.5) * L); tire.rotation.y = Math.PI / 2;
      g.add(tire);
    }
    // isim
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshStandardMaterial({ map: TX.boatNameTexture(name), transparent: true, roughness: 0.5 }));
    const u = 0.78;
    nm.position.set(half(u) * s + 0.02 * s, sheer(u) - 0.3, (u - 0.5) * L - 0.1);
    nm.rotation.y = s > 0 ? Math.PI / 2 + 0.2 : -Math.PI / 2 - 0.2;
    g.add(nm);
  }
  // kaptan köşkü
  const cab = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 1.35), M(cabin, 0.5)); body.position.y = 0.62; cab.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.6), M(stripe, 0.45)); roof.position.y = 1.3; cab.add(roof);
  const glassM = M('#2a3e52', 0.08, 0.3, { emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.0 });
  for (const [x, z, ry, w] of [[0, 0.68, 0, 1.2], [0.76, 0.2, Math.PI / 2, 0.7], [-0.76, 0.2, -Math.PI / 2, 0.7]]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.42), glassM); win.position.set(x, 0.88, z); win.rotation.y = ry; cab.add(win);
  }
  cab.position.set(0, sheer(0.3) - 0.24, (0.3 - 0.5) * L);
  g.add(cab);
  g.userData.cabinGlass = glassM;
  // direk + ışık
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 10), M('#e8e4da', 0.5)); mast.position.set(0, sheer(0.62) + 1.6, (0.62 - 0.5) * L); g.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 8), M('#e8e4da', 0.5)); boom.rotation.z = Math.PI / 2; boom.position.set(0, sheer(0.62) + 2.7, (0.62 - 0.5) * L); g.add(boom);
  const lampM = M('#ffffff', 0.2, 0, { emissive: new THREE.Color('#ffe0a0'), emissiveIntensity: 2.0 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), lampM); lamp.position.set(0, sheer(0.62) + 3.45, (0.62 - 0.5) * L); g.add(lamp);
  g.userData.lampM = lampM;
  // ağ makarası
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 18), M('#c23b22', 0.5, 0.3)); drum.rotation.z = Math.PI / 2;
  drum.position.set(0.7, sheer(0.55) - 0.02, (0.55 - 0.5) * L); g.add(drum);
  // şamandıralar
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), M('#ff6a1a', 0.4));
    b.position.set(-0.6 + k * 0.12, sheer(0.15) - 0.12, (0.13 + 0.03 * k - 0.5) * L); g.add(b);
  }
  g.userData.deckY = (u) => sheer(u) - 0.24;
  g.userData.half = half;
  g.userData.sheer = sheer;
  g.userData.L = L;
  return shadow(g);
}

// ------------------------------------------------------------------ cam şişe + mantar + içindeki kâğıt
export function makeBottle({ color = '#3f7a55' } = {}) {
  const g = new THREE.Group();
  const prof = [[0.0, 0.0], [0.07, 0.0], [0.082, 0.02], [0.085, 0.2], [0.08, 0.24], [0.045, 0.3], [0.028, 0.34], [0.026, 0.42], [0.032, 0.44], [0.028, 0.45]];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.42, clearcoat: 1, clearcoatRoughness: 0.05,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.2, specularIntensity: 1, sheen: 0,
  }));
  glass.renderOrder = 2;
  g.add(glass);
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.06, 16), M('#b5884f', 0.9, 0, { map: TX.corkTexture() }));
  cork.position.y = 0.455; g.add(cork);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.02, 16), M('#7a1a14', 0.35)); wax.position.y = 0.475; g.add(wax);
  const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 16, 1, true), M('#efe6cf', 0.8, 0, { side: THREE.DoubleSide }));
  scroll.position.y = 0.13; scroll.rotation.z = 0.08; g.add(scroll);
  const twine = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.005, 6, 18), M('#7a5a2a', 0.8)); twine.rotation.x = Math.PI / 2; twine.position.y = 0.13; g.add(twine);
  // midye/yosun lekeleri
  const r = mulberry32(3);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, y = 0.02 + r() * 0.2;
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.012 + r() * 0.01, 0.014, 6), M('#d8d2c0', 0.9));
    b.position.set(Math.cos(a) * 0.084, y, Math.sin(a) * 0.084); b.lookAt(b.position.clone().multiplyScalar(2).setY(y)); b.rotateX(Math.PI / 2);
    g.add(b);
  }
  g.userData.glass = glass; g.userData.cork = cork;
  return g;
}

// Kıvrılarak açılan kâğıt (kupon). k=0 → rulo, 1 → düz.
export class RollPaper {
  constructor(tex, w = 0.21, h = 0.35, backTex = null) {
    this.w = w; this.h = h;
    this.geo = new THREE.PlaneGeometry(w, h, 2, 60);
    this.base = this.geo.attributes.position.array.slice();
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: backTex ? THREE.FrontSide : THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, front);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    if (backTex) {
      backTex.wrapS = THREE.RepeatWrapping; backTex.repeat.x = -1; backTex.offset.x = 1; // arka yüzden bakınca ayna olmasın
      const back = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.85, side: THREE.BackSide }));
      back.castShadow = true; this.group.add(back);
      this.back = back;
    }
    this.set(1);
  }
  set(k) {
    const p = this.geo.attributes.position.array, b = this.base, h = this.h;
    const rollR = 0.028;
    const flatLen = h * clamp(k);
    for (let i = 0; i < p.length; i += 3) {
      const x = b[i], y = b[i + 1];
      const s = h / 2 - y; // üstten mesafe
      if (s <= flatLen) { p[i] = x; p[i + 1] = y; p[i + 2] = 0.002 * Math.sin(s * 40); continue; }
      const a = (s - flatLen) / rollR; // sarılmış açı
      const rr = rollR * (1 - 0.06 * a / (Math.PI * 2));
      p[i] = x;
      p[i + 1] = h / 2 - flatLen - Math.sin(a) * rr;
      p[i + 2] = (1 - Math.cos(a)) * rr;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ------------------------------------------------------------------ balık (basit, hafif)
export function makeSmallFish(seed = 1, { body = '#9fb4c4', back = '#2f4f6a' } = {}) {
  const r = mulberry32(seed);
  const len = 0.16 + r() * 0.08;
  const pts = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(new THREE.Vector2(Math.max(0.0005, Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.9) * len * 0.12), u * len)); }
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.scale(0.55, 1, 1); geo.rotateX(Math.PI / 2); geo.translate(0, 0, -len / 2);
  // renk: sırt koyu, karın gümüş
  const pos = geo.attributes.position; const col = [];
  const cb = new THREE.Color(body), ck = new THREE.Color(back);
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const c = cb.clone().lerp(ck, smoothstep(-0.004, 0.012, y)); col.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, M('#ffffff', 0.25, 0.55, { vertexColors: true }));
  const tail = new THREE.Mesh(new THREE.ConeGeometry(len * 0.12, len * 0.25, 3), M(back, 0.4, 0.3));
  tail.rotation.x = -Math.PI / 2; tail.scale.set(0.15, 1, 1); tail.position.z = -len / 2 - len * 0.08;
  const g = new THREE.Group(); g.add(m, tail);
  g.userData.len = len;
  return shadow(g);
}

// ------------------------------------------------------------------ martı
export function makeGull() {
  const g = new THREE.Group();
  const white = M('#f2f2ee', 0.7), grey = M('#9aa3ad', 0.7), dark = M('#2a2a2a', 0.7), beak = M('#f0b429', 0.5);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), white); body.scale.set(0.8, 0.75, 2.0); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), white); head.position.set(0, 0.06, 0.22); g.add(head);
  const bk = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 6), beak); bk.rotation.x = Math.PI / 2; bk.position.set(0, 0.05, 0.31); g.add(bk);
  g.userData.wings = [];
  for (const s of [1, -1]) {
    const piv = new THREE.Group(); piv.position.set(0.06 * s, 0.03, 0.02); g.add(piv);
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.16), grey); w.position.x = 0.21 * s; piv.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.1), dark); tip.position.x = 0.5 * s; tip.position.z = -0.02; piv.add(tip);
    g.userData.wings.push([piv, s]);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.12), white); tail.position.z = -0.25; g.add(tail);
  return g;
}

export function flapGull(gull, t, ph = 0) {
  const a = Math.sin(t * 6 + ph) * 0.6 + 0.1;
  for (const [piv, s] of gull.userData.wings) piv.rotation.z = a * s;
}

// ------------------------------------------------------------------ ağ (tekneden suya sarkan) + içindekiler
export function makeHaulNet() {
  const g = new THREE.Group();
  const tex = TX.netTexture();
  const geo = new THREE.PlaneGeometry(1.4, 2.4, 14, 24);
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaMap: null, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9, color: new THREE.Color('#ffffff') });
  const net = new THREE.Mesh(geo, mat); net.castShadow = true;
  g.add(net);
  g.userData.net = net; g.userData.base = geo.attributes.position.array.slice();
  // ağdaki balıklar
  const fishes = [];
  for (let i = 0; i < 14; i++) { const f = makeSmallFish(i + 3); g.add(f); fishes.push(f); }
  g.userData.fish = fishes;
  return g;
}

export function makeNetPile() {
  const geo = new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = fbm3(v.x * 4, v.y * 4, v.z * 4, 3);
    v.multiplyScalar(1 + n * 0.25); v.y *= 0.55;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f7a5a'), roughness: 0.95, map: TX.netTexture() }));
  m.scale.set(1.3, 1, 1);
  const g = new THREE.Group(); g.add(m);
  for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), M('#ff6a1a', 0.4)); b.position.set(Math.cos(k) * 0.5, 0.12 + 0.05 * Math.sin(k * 3), Math.sin(k) * 0.4); g.add(b); }
  return shadow(g);
}

export function makeFishPile(n = 26) {
  const g = new THREE.Group();
  const r = mulberry32(12);
  for (let i = 0; i < n; i++) {
    const f = makeSmallFish(50 + i);
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.32;
    f.position.set(Math.cos(a) * d, 0.02 + r() * 0.06 * (1 - d * 2), Math.sin(a) * d);
    f.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.4, r() * Math.PI * 2, 0);
    f.rotation.order = 'YXZ'; f.rotation.set(0, r() * Math.PI * 2, Math.PI / 2 * (r() > 0.5 ? 1 : -1));
    g.add(f);
  }
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.6), M('#3a6ea5', 0.6)); crate.position.y = -0.04; g.add(crate);
  return shadow(g);
}

// ------------------------------------------------------------------ fener + ada
export function makeLighthouse() {
  const g = new THREE.Group();
  // ada (kaya)
  const rock = new THREE.IcosahedronGeometry(1, 4);
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = fbm3(v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6, 4);
    v.multiplyScalar(1 + n * 0.45);
    p.setXYZ(i, v.x * 14, Math.max(-2, v.y * 5.5), v.z * 11);
  }
  rock.computeVertexNormals();
  const isl = new THREE.Mesh(rock, M('#5a5650', 0.95)); isl.position.y = -1.2; g.add(isl);
  const grass = new THREE.Mesh(new THREE.SphereGeometry(6, 18, 10, 0, Math.PI * 2, 0, 0.9), M('#4f6b3a', 0.95)); grass.position.set(0, 1.3, 0); grass.scale.set(1.3, 0.4, 1.1); g.add(grass);
  // kule
  const prof = [];
  for (let i = 0; i <= 10; i++) { const y = i * 1.2; prof.push(new THREE.Vector2(1.5 - i * 0.055, y)); }
  const tg = new THREE.LatheGeometry(prof, 28);
  const tp = tg.attributes.position; const tc = [];
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); const band = Math.floor(y / 2.4) % 2 === 1; const c = new THREE.Color(band ? '#b8282b' : '#f2efe8'); tc.push(c.r, c.g, c.b); }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
  const tower = new THREE.Mesh(tg, M('#ffffff', 0.6, 0, { vertexColors: true })); tower.position.y = 2.2; g.add(tower);
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.2, 28), M('#2a2a2a', 0.5, 0.4)); gallery.position.y = 14.3; g.add(gallery);
  const lampM = M('#fff6d8', 0.1, 0, { emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0, transparent: true, opacity: 0.9 });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 20), lampM); lantern.position.y = 15.1; g.add(lantern);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M('#b8282b', 0.4, 0.3)); dome.position.y = 15.75; g.add(dome);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.1), M('#3a2a1e', 0.7)); door.position.set(0, 3.0, 1.48); g.add(door);
  // ışık huzmesi (dönen koni)
  const beamM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2a0'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const bg = new THREE.ConeGeometry(5, 60, 24, 1, true); bg.translate(0, -30, 0); bg.rotateZ(Math.PI / 2);
  const beam = new THREE.Mesh(bg, beamM); beam.position.y = 15.1; g.add(beam);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.set(12, 12, 1); glow.position.y = 15.1; g.add(glow);
  g.userData = { lampM, beam, beamM, glow, lightY: 15.1, doorPos: new THREE.Vector3(0, 3.0, 1.6) };
  return shadow(g);
}

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  _glow = TX.canvasTex(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  return _glow;
}

// ------------------------------------------------------------------ köy (yamaçta evler) + iskele
export function makeVillage(seed = 8) {
  const g = new THREE.Group();
  const r = mulberry32(seed);
  // yamaç
  const hill = new THREE.PlaneGeometry(220, 90, 80, 40); hill.rotateX(-Math.PI / 2);
  const hp = hill.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), z = hp.getZ(i);
    const back = (z + 45) / 90; // 0 ön (kıyı) → 1 arka
    const y = Math.pow(1 - back, 1.3) * 26 + fbm3(x * 0.03, z * 0.04, 1, 4) * 6 - 1.5;
    hp.setY(i, y);
  }
  hill.computeVertexNormals();
  const hc = []; for (let i = 0; i < hp.count; i++) { const y = hp.getY(i); const c = new THREE.Color(y < 1 ? '#8a7f6a' : '#3f5f33').lerp(new THREE.Color('#2b4a2a'), clamp(y / 30)); hc.push(c.r, c.g, c.b); }
  hill.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
  const hillM = new THREE.Mesh(hill, M('#ffffff', 0.95, 0, { vertexColors: true })); hillM.position.set(0, 0, -70); g.add(hillM);
  // evler
  const facade = TX.canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3b4652';
    for (const [x, y] of [[40, 60], [150, 60], [40, 150], [150, 150]]) c.fillRect(x, y, 60, 60);
  });
  const glowMap = TX.canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffb35a';
    for (const [x, y] of [[40, 60], [150, 150]]) c.fillRect(x + 4, y + 4, 52, 52);
  });
  const houseM = M('#ffffff', 0.85, 0, { map: facade, emissiveMap: glowMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
  const roofM = M('#ffffff', 0.8);
  const N = 70;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), houseM, N);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 0.5, 4), roofM, N);
  const wallCols = ['#f4efe4', '#efe2c4', '#e8d4b0', '#f2f2f2', '#dfe8ef', '#f0d9c8'], roofCols = ['#a8452f', '#8f3a2a', '#b6553a', '#6d4a3a'];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < N; i++) {
    const x = (r() - 0.5) * 120, back = r();
    const z = -28 - back * 40;
    const y = Math.pow(1 - (z + 115) / 90, 1.3) * 26 + fbm3(x * 0.03, (z + 70) * 0.04, 1, 4) * 6 - 1.5;
    const w = 3 + r() * 2.5, h = 3 + r() * 3, d = 3 + r() * 2;
    e.set(0, (r() - 0.5) * 0.5, 0); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y + h / 2 - 0.3, z), q, new THREE.Vector3(w, h, d)); walls.setMatrixAt(i, m4);
    walls.setColorAt(i, new THREE.Color(wallCols[Math.floor(r() * wallCols.length)]));
    e.set(0, e.y + Math.PI / 4, 0); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y + h - 0.3 + 0.9, z), q, new THREE.Vector3(w * 1.05, 3.6, d * 1.05)); roofs.setMatrixAt(i, m4);
    roofs.setColorAt(i, new THREE.Color(roofCols[Math.floor(r() * roofCols.length)]));
  }
  walls.castShadow = roofs.castShadow = true; walls.receiveShadow = true;
  g.add(walls, roofs);
  // cami minaresi (köy silüeti)
  const mn = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 16, 12), M('#f2f0ea', 0.7)); mn.position.set(18, 14, -48); g.add(mn);
  const mc = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.4, 12), M('#6b7a88', 0.5, 0.4)); mc.position.set(18, 23.2, -48); g.add(mc);
  // iskele
  const pier = new THREE.Group();
  const plankM = M('#ffffff', 0.85, 0, { map: TX.woodTexture('#7d6047', 9, [1, 8]) });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 30), plankM); deck.position.set(0, 1.1, -12); pier.add(deck);
  for (let k = 0; k < 8; k++) for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.4, 8), M('#4a3a2c', 0.9)); post.position.set(1.4 * s, -0.4, -26 + k * 4); pier.add(post);
  }
  for (let k = 0; k < 4; k++) {
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3, 8), M('#222', 0.5, 0.6)); lp.position.set(1.3, 2.7, -24 + k * 8); pier.add(lp);
    const lb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M('#fff', 0.2, 0, { emissive: new THREE.Color('#ffcf7a'), emissiveIntensity: 0 })); lb.position.set(1.3, 4.25, -24 + k * 8); pier.add(lb);
    (g.userData.lamps = g.userData.lamps || []).push(lb.material);
  }
  g.add(pier);
  // kıyı şeridi (çakıl)
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(220, 20), M('#8b8273', 1)); shore.rotation.x = -Math.PI / 2; shore.position.set(0, 0.25, -28); g.add(shore);
  g.userData.houseM = houseM;
  return shadow(g, true, true);
}

// ------------------------------------------------------------------ iç mekân yardımcıları
export function makeRoom(w, d, h, { wall = '#d9cbb0', floorTex = null, ceil = '#bfb39a', wallTex = null } = {}) {
  const g = new THREE.Group();
  const wm = M(wall, 0.9, 0, wallTex ? { map: wallTex } : {});
  const fm = M('#ffffff', 0.8, 0, { map: floorTex || TX.woodTexture('#6b4a30', 13, [4, 4]) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fm); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(ceil, 0.95)); ceiling.rotation.x = Math.PI / 2; ceiling.position.y = h; g.add(ceiling);
  for (const [x, z, ry, len] of [[0, -d / 2, 0, w], [0, d / 2, Math.PI, w], [-w / 2, 0, Math.PI / 2, d], [w / 2, 0, -Math.PI / 2, d]]) {
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wm); wl.position.set(x, h / 2, z); wl.rotation.y = ry; wl.receiveShadow = true; g.add(wl);
  }
  return g;
}

export function makeTable(r = 0.45, h = 0.75, color = '#6b4a30') {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 24), M('#ffffff', 0.6, 0, { map: TX.woodTexture(color, 5, [1, 1]) })); top.position.y = h; g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 10), M('#2a2420', 0.5, 0.5)); leg.position.y = h / 2; g.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.03, 16), M('#2a2420', 0.5, 0.5)); foot.position.y = 0.015; g.add(foot);
  return shadow(g);
}

export function makeChair(color = '#5a3a24') {
  const g = new THREE.Group(); const m = M(color, 0.7);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), m); seat.position.y = 0.46; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.04), m); back.position.set(0, 0.7, -0.2); g.add(back);
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.04), m); l.position.set(x, 0.23, z); g.add(l); }
  return shadow(g);
}

export function makeTeaGlass() {
  const g = new THREE.Group();
  const prof = [[0.0, 0.0], [0.022, 0.0], [0.026, 0.02], [0.019, 0.045], [0.024, 0.075], [0.027, 0.09]].map(([r, y]) => new THREE.Vector2(r, y));
  const gl = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, roughness: 0.05, clearcoat: 1, depthWrite: false }));
  const tea = new THREE.Mesh(new THREE.LatheGeometry(prof.slice(0, 5).map((v) => new THREE.Vector2(v.x * 0.92, v.y)), 16), M('#a3300f', 0.2, 0, { emissive: new THREE.Color('#5a1405'), emissiveIntensity: 0.3 }));
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.008, 20), M('#e8e8e8', 0.3));
  g.add(saucer, tea, gl);
  return g;
}

export function makeLamp(color = '#ffcf8a', intensity = 2.2) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 16), M('#3a2a1a', 0.5, 0.5)); g.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), M('#3a2a1a', 0.5, 0.5)); stem.position.y = 0.17; g.add(stem);
  const shadeM = M('#f0d9a8', 0.8, 0, { emissive: new THREE.Color(color), emissiveIntensity: 0.9, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.17, 20, 1, true), shadeM); shade.position.y = 0.36; g.add(shade);
  const light = new THREE.PointLight(new THREE.Color(color), intensity, 7, 1.6); light.position.y = 0.34; g.add(light);
  g.userData.light = light;
  return g;
}

export function makeTV() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.78, 0.07), M('#0d0d0f', 0.3, 0.5)); g.add(frame);
  const tex = TX.tvTexture();
  TX.drawTV(tex, {});
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.7), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  scr.position.z = 0.036; g.add(scr);
  const glow = new THREE.PointLight(new THREE.Color('#9ad6ff'), 1.2, 5, 1.5); glow.position.z = 0.6; g.add(glow);
  g.userData = { tex, glow };
  return g;
}

export function makeDoor() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.15, 0.12), M('#4a3020', 0.7)); frame.position.y = 1.075; g.add(frame);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 2.02), new THREE.MeshBasicMaterial({ color: new THREE.Color('#050a16') })); hole.position.set(0, 1.01, 0.065); g.add(hole);
  const piv = new THREE.Group(); piv.position.set(-0.46, 0, 0.07); g.add(piv);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.02, 0.05), M('#ffffff', 0.75, 0, { map: TX.woodTexture('#7a4a2a', 21, [1, 1]) })); leaf.position.set(0.46, 1.01, 0); piv.add(leaf);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M('#c9a24a', 0.3, 0.8)); knob.position.set(0.82, 1.0, 0.04); piv.add(knob);
  g.userData.leaf = piv;
  return shadow(g);
}

// Çok sayıda boş şişe (fener odası)
export function makeBottleField(n = 140, seed = 4) {
  const r = mulberry32(seed);
  const prof = [[0.0, 0.0], [0.07, 0.0], [0.082, 0.02], [0.085, 0.2], [0.045, 0.3], [0.027, 0.34], [0.027, 0.44]].map(([a, b]) => new THREE.Vector2(a, b));
  const geo = new THREE.LatheGeometry(prof, 12);
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, roughness: 0.08, clearcoat: 1, depthWrite: false });
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const cols = ['#3f7a55', '#6a4a2a', '#2f5f6f', '#7f8f5a'];
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * 1.6, z = (r() - 0.5) * 0.9;
    const fallen = r() > 0.8;
    q.setFromEuler(new THREE.Euler(fallen ? Math.PI / 2 : 0, r() * 6, 0));
    m4.compose(new THREE.Vector3(x, fallen ? 0.08 : 0, z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + r() * 0.3));
    im.setMatrixAt(i, m4); im.setColorAt(i, new THREE.Color(cols[Math.floor(r() * cols.length)]));
  }
  return im;
}

// Olasılık ızgarası: binlerce küçük top, tek bir altın top
export function makeProbabilityGrid(n = 110) {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.035, 1);
  const im = new THREE.InstancedMesh(geo, M('#ffffff', 0.35, 0.1), n * n);
  const m4 = new THREE.Matrix4();
  const r = mulberry32(2);
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (i - n / 2) * 0.1, z = (j - n / 2) * 0.1;
    m4.makeTranslation(x, 0, z); im.setMatrixAt(k, m4);
    const v = 0.35 + r() * 0.35;
    im.setColorAt(k, new THREE.Color(v * 0.75, v * 0.85, v)); k++;
  }
  g.add(im);
  const gold = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), M('#ffc93c', 0.2, 0.9, { emissive: new THREE.Color('#ff9a00'), emissiveIntensity: 1.2 }));
  gold.position.set(0.3, 0.05, 0.4); g.add(gold);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(1.2, 1.2, 1); halo.position.copy(gold.position); g.add(halo);
  g.userData = { im, gold, halo, n };
  return g;
}

export function makeInstancedPapers(n, tex, w, h, seed = 1) {
  const geo = new THREE.PlaneGeometry(w, h);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }), n);
  im.userData.r = mulberry32(seed);
  im.userData.seeds = Array.from({ length: n }, () => [im.userData.r(), im.userData.r(), im.userData.r(), im.userData.r()]);
  return im;
}

export function makeConfetti(n = 260) {
  const geo = new THREE.PlaneGeometry(0.05, 0.03);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3 }), n);
  const r = mulberry32(77); const cols = ['#ffc93c', '#5ce1e6', '#ff4d5e', '#ffffff', '#7bd389'];
  im.userData.seeds = [];
  for (let i = 0; i < n; i++) { im.setColorAt(i, new THREE.Color(cols[i % cols.length])); im.userData.seeds.push([r(), r(), r(), r()]); }
  return im;
}

// Parçacık tozu (boşluk/infografik sahnesi)
export function makeDust(n = 600, spread = 14, color = '#9fd8ff') {
  const r = mulberry32(5);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * spread; pos[i * 3 + 1] = (r() - 0.5) * spread * 0.6; pos[i * 3 + 2] = (r() - 0.5) * spread; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(color), size: 0.035, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture() }));
}
