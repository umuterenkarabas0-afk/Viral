// Prosedürel 3D balık üreticisi.
// Tüm görünüm bir parametre nesnesinden gelir (senaryo YAML'ı / LLM bu
// parametreleri doldurur). Gövde, yüzgeçler, göz, bıyıklar ayrı mesh'lerdir;
// yüzme hareketi CPU'da deterministik olarak (t'ye bağlı) uygulanır.
import * as THREE from 'three';
import { mulberry32, hashString, clamp, lerp, smoothstep, deepMerge, noise3 } from './util.js';
import { patchCaustics } from './caustics.js';

export const FISH_DEFAULTS = {
  name: 'fish',
  seed: 1,
  length: 2.0,
  bodyFrac: 0.8,
  height: 0.12,      // azami yarı-yükseklik / boy
  width: 0.06,       // azami yarı-genişlik / boy
  maxAt: 0.33,
  noseTop: 1.6,
  noseBottom: 1.4,
  peduncle: 0.24,
  pedWidth: 0.32,
  tailPow: 1.0,
  belly: 0.08,
  keel: 1.15,
  mouth: { y: -0.12, len: 0.09, depth: 0.25, color: '#3a2626' },
  gill: { u: 0.24, strength: 1, color: '#000000', alpha: 0.28 },
  eye: { u: 0.085, y: 0.3, size: 0.2, iris: '#c9a645', pupil: '#050505', ring: null },
  colors: { back: '#3f5f7f', side: '#b4c2cc', belly: '#f1f1ec', split: 0.3, bellyStart: -0.35 },
  patterns: [],
  lateralLine: { color: '#1e2a33', alpha: 0.3, y: 0.42 },
  scales: { size: 1, strength: 0.8 },
  material: { roughness: 0.36, metalness: 0.2, clearcoat: 0.7, iridescence: 0.3, sheen: 0 },
  fins: {
    color: null,
    dorsal: [{ u0: 0.3, u1: 0.62, height: 0.75, shape: 'spiny', rake: 18, rays: 11 }],
    anal: [{ u0: 0.62, u1: 0.8, height: 0.45, shape: 'rounded', rake: 25, rays: 9 }],
    pectoral: { u: 0.28, y: -0.25, size: 0.17, spread: 30, droop: 12, roll: 0, fan: 40, rays: 12 },
    pelvic: { u: 0.34, size: 0.1 },
    caudal: { type: 'forked', length: null, span: 1.15, rays: 18 },
    finlets: null,
  },
  barbels: null,
  swim: { amp: 0.055, waves: 0.85, freq: 1.5, style: 'carangiform' },
};

const tmpC = new THREE.Color();
function hex(c, fallback = '#888888') { return c || fallback; }
function mixHex(a, b, t) { const c1 = new THREE.Color(a), c2 = new THREE.Color(b); return '#' + c1.lerp(c2, t).getHexString(); }
function shade(a, k) { const c = new THREE.Color(a); c.multiplyScalar(k); return '#' + c.getHexString(); }

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Pul (scale) yükseklik haritasından normal haritası
let SCALE_NORMAL = null;
function scaleNormalMap() {
  if (SCALE_NORMAL) return SCALE_NORMAL;
  const W = 256, H = 256;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const rows = 8, cols = 8, sw = W / cols, sh = H / rows;
  for (let r = -1; r <= rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const cx = k * sw + (r % 2 ? sw / 2 : 0) + sw * 0.15, cy = r * sh + sh * 0.5;
      const g = ctx.createRadialGradient(cx + sw * 0.25, cy, 1, cx, cy, sw * 0.75);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.65, 'rgba(150,150,150,1)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy, sw * 0.7, sh * 0.62, 0, Math.PI * 0.5, Math.PI * 1.5, true); ctx.fill();
    }
  }
  const src = ctx.getImageData(0, 0, W, H).data;
  const out = ctx.createImageData(W, H);
  const hAt = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 2.0;
    const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * 2.0;
    const n = new THREE.Vector3(-dx, dy, 1).normalize();
    const i = (y * W + x) * 4;
    out.data[i] = (n.x * 0.5 + 0.5) * 255; out.data[i + 1] = (n.y * 0.5 + 0.5) * 255; out.data[i + 2] = (n.z * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  SCALE_NORMAL = tex;
  return tex;
}

function profile(u, k, ped, maxAt, pow) {
  if (u <= maxAt) {
    const x = u / maxAt;
    return Math.pow(Math.max(0, 1 - Math.pow(1 - x, 2)), 1 / k);
  }
  const x = (u - maxAt) / (1 - maxAt);
  return ped + (1 - ped) * (0.5 + 0.5 * Math.cos(Math.PI * Math.pow(x, pow)));
}

function finShape(shape, a) {
  switch (shape) {
    case 'spiny': return (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, a * 1.6 + 0.12)), 0.5)) * (1 - 0.45 * a) * smoothstep(0, 0.06, a) + 0.02;
    case 'rounded': return Math.pow(Math.sin(Math.PI * a), 0.65);
    case 'falcate': return Math.pow(1 - a, 1.8) * smoothstep(0, 0.12, a) * 1.25 + 0.04;
    case 'triangle': return (1 - a) * smoothstep(0, 0.1, a) + 0.03;
    case 'long': return smoothstep(0, 0.08, a) * (1 - smoothstep(0.9, 1, a)) * 0.95 + 0.05;
    case 'tall': return (0.55 + 0.45 * Math.cos(a * Math.PI * 0.5)) * smoothstep(0, 0.05, a);
    case 'sail': return smoothstep(0, 0.1, a) * (1 - 0.3 * a);
    default: return Math.sin(Math.PI * a);
  }
}

function caudalLen(type, s) {
  const as = Math.abs(s);
  switch (type) {
    case 'lunate': return 0.22 + 0.78 * Math.pow(as, 1.6);
    case 'forked': return 0.5 + 0.5 * Math.pow(as, 1.15);
    case 'emarginate': return 0.82 + 0.18 * as;
    case 'truncate': return 1.0 - 0.06 * as;
    case 'rounded': return 0.62 + 0.38 * Math.cos(as * Math.PI * 0.5);
    case 'pointed': return 0.35 + 0.65 * Math.pow(Math.cos(as * Math.PI * 0.5), 2);
    default: return 0.6 + 0.4 * as;
  }
}

export class Fish {
  constructor(input, opts = {}) {
    const p = (this.p = deepMerge(FISH_DEFAULTS, input || {}));
    this.quality = opts.quality ?? 1;
    this.rng = mulberry32(hashString(p.name || 'fish') ^ (p.seed || 1));
    this.group = new THREE.Group();
    this.group.name = 'fish:' + p.name;
    this.parts = [];
    this.anchorsRest = {};
    this.T = p.length;
    this.xNose = this.T / 2;
    this.bodyL = p.bodyFrac * this.T;
    this.xEnd = this.xNose - this.bodyL;
    this.Hm = p.height * this.T;
    this.Wm = p.width * this.T;
    this.finColor = p.fins.color || mixHex(p.colors.side, p.colors.back, 0.45);
    this._build();
  }

  top(u) { const p = this.p; return this.Hm * (1 - p.belly) * profile(u, p.noseTop, p.peduncle, p.maxAt, p.tailPow); }
  bot(u) { const p = this.p; return this.Hm * (1 + p.belly) * profile(u, p.noseBottom, p.peduncle, p.maxAt, p.tailPow); }
  wid(u) { const p = this.p; return this.Wm * profile(u, 1.7, p.pedWidth, Math.min(0.45, p.maxAt + 0.05), p.tailPow); }
  xOf(u) { return this.xNose - u * this.bodyL; }

  radialMod(u, yn) {
    const p = this.p;
    let r = 1;
    // Ağız oluğu
    if (p.mouth && u < p.mouth.len) {
      const k = 1 - u / p.mouth.len;
      r -= (p.mouth.depth ?? 0.25) * 0.12 * Math.exp(-Math.pow((yn - p.mouth.y) / 0.06, 2)) * k;
    }
    // Solungaç kapağı kabarıklığı ve kenarı
    if (p.gill && p.gill.strength > 0) {
      const gu = p.gill.u + 0.055 * yn * yn - 0.01;
      const bulge = smoothstep(gu - 0.14, gu - 0.01, u) * (1 - smoothstep(gu - 0.005, gu + 0.012, u));
      r += 0.022 * p.gill.strength * bulge * (1 - Math.abs(yn) * 0.6);
    }
    return r;
  }

  surf(u, th, out) {
    const c = Math.cos(th), s = Math.sin(th);
    const yn = Math.sign(c) * Math.abs(c);
    const hy = c >= 0 ? this.top(u) : this.bot(u);
    const zn = Math.sign(s) * Math.pow(Math.abs(s), this.p.keel);
    const r = this.radialMod(u, yn);
    out.set(this.xOf(u), hy * yn * r, this.wid(u) * zn * r);
    return yn;
  }

  // yüzey noktası (u, yn, yan) için konum
  surfacePoint(u, yn, side = 1) {
    const th = side > 0 ? Math.acos(clamp(yn, -1, 1)) : 2 * Math.PI - Math.acos(clamp(yn, -1, 1));
    const v = new THREE.Vector3();
    this.surf(u, th, v);
    return v;
  }

  _build() {
    const p = this.p;
    const q = this.quality;
    const nU = Math.round((p.eel ? 220 : 140) * q), nT = Math.round(56 * q);
    const pos = new Float32Array((nU + 1) * (nT + 1) * 3);
    const uv = new Float32Array((nU + 1) * (nT + 1) * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i <= nU; i++) {
      const u = 0.5 - 0.5 * Math.cos(Math.PI * i / nU);
      for (let j = 0; j <= nT; j++) {
        const th = (j / nT) * Math.PI * 2;
        const yn = this.surf(u, th, v);
        const k = i * (nT + 1) + j;
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        uv[k * 2] = u; uv[k * 2 + 1] = (yn + 1) / 2;
      }
    }
    const idx = [];
    for (let i = 0; i < nU; i++) for (let j = 0; j < nT; j++) {
      const a = i * (nT + 1) + j, b = (i + 1) * (nT + 1) + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
    // Kuyruk ucu kapağı
    const capIdx = (nU + 1) * (nT + 1);
    const posFull = new Float32Array(pos.length + 3);
    posFull.set(pos);
    posFull[capIdx * 3] = this.xEnd - 0.004; posFull[capIdx * 3 + 1] = 0; posFull[capIdx * 3 + 2] = 0;
    const uvFull = new Float32Array(uv.length + 2); uvFull.set(uv); uvFull[capIdx * 2] = 1; uvFull[capIdx * 2 + 1] = 0.5;
    for (let j = 0; j < nT; j++) { const a = nU * (nT + 1) + j; idx.push(a, capIdx, a + 1); }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posFull, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvFull, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal.array;
    // dikiş normallerini birleştir
    for (let i = 0; i <= nU; i++) {
      const a = i * (nT + 1), b = a + nT;
      const nx = nrm[a * 3] + nrm[b * 3], ny = nrm[a * 3 + 1] + nrm[b * 3 + 1], nz = nrm[a * 3 + 2] + nrm[b * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[a * 3] = nrm[b * 3] = nx / l; nrm[a * 3 + 1] = nrm[b * 3 + 1] = ny / l; nrm[a * 3 + 2] = nrm[b * 3 + 2] = nz / l;
    }
    for (let j = 0; j <= nT; j++) { nrm[j * 3] = 1; nrm[j * 3 + 1] = 0; nrm[j * 3 + 2] = 0; }
    nrm[capIdx * 3] = -1; nrm[capIdx * 3 + 1] = 0; nrm[capIdx * 3 + 2] = 0;

    const bodyTex = this._paintBody();
    const m = p.material;
    const bodyMat = new THREE.MeshPhysicalMaterial({
      map: bodyTex,
      normalMap: p.scales && p.scales.size > 0 ? scaleNormalMap().clone() : null,
      normalScale: new THREE.Vector2(0.35 * (p.scales?.strength ?? 0.8), 0.35 * (p.scales?.strength ?? 0.8)),
      roughness: m.roughness, metalness: m.metalness,
      clearcoat: m.clearcoat, clearcoatRoughness: 0.22,
      iridescence: m.iridescence, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
      sheen: m.sheen || 0, sheenColor: new THREE.Color(p.colors.side), sheenRoughness: 0.5,
      envMapIntensity: 1.0,
    });
    if (bodyMat.normalMap) {
      bodyMat.normalMap.needsUpdate = true;
      const sz = p.scales.size;
      bodyMat.normalMap.repeat.set(46 / sz * p.bodyFrac * (p.eel ? 2.5 : 1), 7 / sz);
    }
    patchCaustics(bodyMat, { strength: 1.0 });
    const body = new THREE.Mesh(g, bodyMat);
    body.castShadow = false;
    this._addPart(body, { kind: 'body' });

    this._buildFins();
    this._buildEyes();
    if (p.barbels) this._buildBarbels();

    // Çapa noktaları (callout ve kamera odakları için)
    const eyeP = this.surfacePoint(p.eye.u, p.eye.y, 1);
    this.anchorsRest.nose = new THREE.Vector3(this.xNose, 0, 0);
    this.anchorsRest.eye = eyeP;
    this.anchorsRest.head = this.surfacePoint(0.12, 0.1, 1);
    this.anchorsRest.mouth = this.surfacePoint(0.03, p.mouth?.y ?? -0.1, 1);
    this.anchorsRest.gill = this.surfacePoint(p.gill?.u ?? 0.24, 0.0, 1);
    this.anchorsRest.body = this.surfacePoint(0.45, 0.1, 1);
    this.anchorsRest.belly = this.surfacePoint(0.42, -0.75, 1);
    this.anchorsRest.tail = new THREE.Vector3(this.xEnd - 0.5 * (this.caudalLength || 0.3), 0, 0);
    const spot = (p.patterns || []).find((x) => x.type === 'ocellus');
    if (spot) this.anchorsRest.spot = this.surfacePoint(spot.u, spot.y, 1);
    if (!this.anchorsRest.dorsal) this.anchorsRest.dorsal = new THREE.Vector3(this.xOf(0.45), this.top(0.45) * 1.4, 0);
    if (!this.anchorsRest.pectoral) this.anchorsRest.pectoral = this.surfacePoint(0.3, -0.2, 1);
    if (!this.anchorsRest.barbels) this.anchorsRest.barbels = this.anchorsRest.mouth.clone();
  }

  _addPart(mesh, { kind, flutter = null, flutterAxis = null, flutterAmp = 0, flutterFreq = 2 } = {}) {
    mesh.frustumCulled = false;
    const g = mesh.geometry;
    const rest = g.attributes.position.array.slice();
    const restN = g.attributes.normal.array.slice();
    this.parts.push({ mesh, kind, rest, restN, flutter, flutterAxis, flutterAmp, flutterFreq });
    this.group.add(mesh);
  }

  // ------------------------------------------------------------ Doku boyama
  _paintBody() {
    const p = this.p;
    const W = 1024, H = 512;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    const Y = (yn) => ((1 - yn) / 2) * H;
    const X = (u) => u * W;
    const col = p.colors;
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    const split = col.split ?? 0.3, bs = col.bellyStart ?? -0.35;
    gr.addColorStop(0, shade(col.back, 0.85));
    gr.addColorStop(clamp((1 - split - 0.15) / 2, 0, 1), col.back);
    gr.addColorStop(clamp((1 - split + 0.12) / 2, 0, 1), mixHex(col.back, col.side, 0.75));
    gr.addColorStop(clamp((1 - (bs + 0.25)) / 2, 0, 1), col.side);
    gr.addColorStop(clamp((1 - bs) / 2, 0, 1), col.belly);
    gr.addColorStop(1, col.belly);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);

    const rng = mulberry32(hashString(p.name + ':tex') ^ (p.seed || 1));
    // Hafif benekli doğal doku
    const img = ctx.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = noise3(x * 0.03, y * 0.05, 1.7) * 0.06 + noise3(x * 0.12, y * 0.2, 7.3) * 0.03;
      const i = (y * W + x) * 4;
      img.data[i] = clamp(img.data[i] * (1 + n), 0, 255);
      img.data[i + 1] = clamp(img.data[i + 1] * (1 + n), 0, 255);
      img.data[i + 2] = clamp(img.data[i + 2] * (1 + n), 0, 255);
    }
    ctx.putImageData(img, 0, 0);

    // Dünya birimiyle yuvarlak görünen elips yarıçapları
    const rx = (r) => (r / this.bodyL) * W;
    const ry = (r, u, yn) => (r / (2 * Math.max(0.01, yn >= 0 ? this.top(u) : this.bot(u)))) * H;

    for (const pat of p.patterns || []) {
      ctx.save();
      ctx.globalAlpha = pat.alpha ?? 1;
      ctx.fillStyle = ctx.strokeStyle = pat.color || '#000';
      if (pat.blur) ctx.filter = `blur(${pat.blur}px)`;
      const u0 = pat.u0 ?? 0.05, u1 = pat.u1 ?? 1.0, y0 = pat.y0 ?? -0.8, y1 = pat.y1 ?? 0.85;
      switch (pat.type) {
        case 'hstripes': {
          const n = pat.count || 5;
          for (let i = 0; i < n; i++) {
            const yn = lerp(y1, y0, (i + 0.5) / n);
            const wpx = (pat.width ?? 0.35) * ((y1 - y0) / n) * H / 2;
            ctx.lineWidth = wpx; ctx.lineCap = 'round';
            ctx.beginPath();
            for (let s = 0; s <= 60; s++) {
              const u = lerp(u0, u1, s / 60);
              const wy = (pat.wavy || 0) * Math.sin(u * 30 + i) * 0.03;
              const fade = smoothstep(u0, u0 + 0.05, u) * (1 - smoothstep(u1 - 0.05, u1, u));
              const yy = Y(yn + wy);
              if (s === 0) ctx.moveTo(X(u), yy); else ctx.lineTo(X(u), yy);
              void fade;
            }
            ctx.stroke();
          }
          break;
        }
        case 'vbars': {
          const n = pat.count || 5;
          const span = (u1 - u0) / n;
          for (let i = 0; i < n; i++) {
            const uc = u0 + span * (i + 0.5);
            const w = span * (pat.width ?? 0.45);
            ctx.beginPath();
            const wob = (pat.wobble ?? 0.15) * span;
            ctx.moveTo(X(uc - w / 2), Y(y1));
            for (let s = 0; s <= 20; s++) { const yn = lerp(y1, y0, s / 20); ctx.lineTo(X(uc - w / 2 + Math.sin(s * 0.9 + i) * wob * 0.3 + (pat.slant || 0) * (yn - y0)), Y(yn)); }
            for (let s = 20; s >= 0; s--) { const yn = lerp(y1, y0, s / 20); ctx.lineTo(X(uc + w / 2 + Math.cos(s * 0.8 + i) * wob * 0.3 + (pat.slant || 0) * (yn - y0)), Y(yn)); }
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'spots': {
          const n = pat.count || 30, size = (pat.size ?? 0.02) * this.T;
          for (let i = 0; i < n; i++) {
            const u = lerp(u0, u1, rng()), yn = lerp(y0, y1, rng());
            const r = size * (1 - (pat.sizeVar ?? 0.4) * rng());
            ctx.beginPath(); ctx.ellipse(X(u), Y(yn), rx(r), ry(r, u, yn), 0, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'blotches': {
          const n = pat.count || 12, size = (pat.size ?? 0.05) * this.T;
          for (let i = 0; i < n; i++) {
            const u = lerp(u0, u1, rng()), yn = lerp(y0, y1, rng());
            const r = size * (0.6 + 0.6 * rng());
            ctx.beginPath();
            for (let s = 0; s <= 24; s++) {
              const a = (s / 24) * Math.PI * 2;
              const k = 1 + 0.35 * noise3(Math.cos(a) * 1.5 + i * 3.1, Math.sin(a) * 1.5, i * 1.7);
              const px = X(u) + Math.cos(a) * rx(r) * k, py = Y(yn) + Math.sin(a) * ry(r, u, yn) * k;
              if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'ocellus': {
          const r = (pat.r ?? 0.05) * this.T;
          if (pat.ring) {
            ctx.fillStyle = pat.ring;
            const k = 1 + (pat.ringWidth ?? 0.35);
            ctx.beginPath(); ctx.ellipse(X(pat.u), Y(pat.y), rx(r * k), ry(r * k, pat.u, pat.y), 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = pat.color || '#000';
          }
          ctx.beginPath(); ctx.ellipse(X(pat.u), Y(pat.y), rx(r), ry(r, pat.u, pat.y), 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'patch': {
          ctx.filter = `blur(${pat.blur ?? 14}px)`;
          ctx.beginPath(); ctx.ellipse(X(pat.u), Y(pat.y), (pat.ru ?? 0.08) * W, (pat.ry ?? 0.25) * H / 2, pat.rot || 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'band': {
          ctx.filter = `blur(${pat.blur ?? 3}px)`;
          ctx.beginPath();
          const w = (pat.width ?? 0.03) * W;
          ctx.moveTo(X(pat.u) - w / 2, Y(y1)); ctx.lineTo(X(pat.u) + w / 2, Y(y1));
          ctx.lineTo(X(pat.u + (pat.slant || 0)) + w / 2, Y(y0)); ctx.lineTo(X(pat.u + (pat.slant || 0)) - w / 2, Y(y0));
          ctx.closePath(); ctx.fill();
          break;
        }
        case 'diagonal': {
          const n = pat.count || 8;
          ctx.lineWidth = (pat.width ?? 5);
          for (let i = 0; i < n; i++) {
            const u = lerp(u0, u1, (i + 0.5) / n);
            const du = (pat.slope ?? 0.12);
            ctx.beginPath(); ctx.moveTo(X(u), Y(y1)); ctx.lineTo(X(u + du), Y(y0)); ctx.stroke();
          }
          break;
        }
        case 'scribble': {
          const n = pat.count || 10;
          ctx.lineWidth = pat.width ?? 4; ctx.lineCap = 'round';
          for (let i = 0; i < n; i++) {
            let u = lerp(u0, u1, rng()), yn = lerp(y0, y1, rng());
            ctx.beginPath(); ctx.moveTo(X(u), Y(yn));
            let ang = rng() * Math.PI * 2;
            for (let s = 0; s < 14; s++) {
              ang += (rng() - 0.5) * 1.6;
              u += Math.cos(ang) * 0.012; yn += Math.sin(ang) * 0.05;
              ctx.lineTo(X(u), Y(yn));
            }
            ctx.stroke();
          }
          break;
        }
        case 'wavy': {
          const n = pat.count || 6;
          ctx.lineWidth = pat.width ?? 4;
          for (let i = 0; i < n; i++) {
            const yb = lerp(y1, y0, (i + 0.5) / n);
            ctx.beginPath();
            for (let s = 0; s <= 80; s++) {
              const u = lerp(u0, u1, s / 80);
              const yy = yb + Math.sin(u * (pat.freq ?? 40) + i * 1.3) * (pat.amp ?? 0.04);
              if (s === 0) ctx.moveTo(X(u), Y(yy)); else ctx.lineTo(X(u), Y(yy));
            }
            ctx.stroke();
          }
          break;
        }
        case 'mottle': {
          const id = ctx.getImageData(0, 0, W, H);
          const cc = new THREE.Color(pat.color || '#000');
          const sc = pat.scale ?? 1;
          const a = pat.alpha ?? 0.5;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const u = x / W, yn = 1 - (2 * y) / H;
            if (u < u0 || u > u1 || yn < y0 || yn > y1) continue;
            const n = noise3(x * 0.012 * sc, y * 0.03 * sc, 3.3) + 0.5 * noise3(x * 0.03 * sc, y * 0.07 * sc, 9.1);
            const k = smoothstep(pat.threshold ?? 0.1, (pat.threshold ?? 0.1) + 0.25, n) * a;
            const i = (y * W + x) * 4;
            id.data[i] = lerp(id.data[i], cc.r * 255, k);
            id.data[i + 1] = lerp(id.data[i + 1], cc.g * 255, k);
            id.data[i + 2] = lerp(id.data[i + 2], cc.b * 255, k);
          }
          ctx.globalAlpha = 1; ctx.filter = 'none';
          ctx.putImageData(id, 0, 0);
          break;
        }
        case 'gradientU': {
          // baştan kuyruğa renk geçişi (örn. papağan balığı)
          const gg = ctx.createLinearGradient(X(u0), 0, X(u1), 0);
          gg.addColorStop(0, 'rgba(0,0,0,0)');
          gg.addColorStop(1, pat.color);
          if (pat.reverse) { gg.addColorStop(0, pat.color); }
          ctx.fillStyle = gg;
          ctx.fillRect(X(u0), Y(y1), X(u1) - X(u0), Y(y0) - Y(y1));
          break;
        }
        default: break;
      }
      ctx.restore();
    }

    // Yanal çizgi
    if (p.lateralLine && p.lateralLine.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = p.lateralLine.alpha; ctx.strokeStyle = p.lateralLine.color; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let s = 0; s <= 50; s++) {
        const u = lerp(p.gill?.u ?? 0.24, 0.99, s / 50);
        const yn = p.lateralLine.y + 0.08 * Math.sin(u * Math.PI) - 0.06;
        if (s === 0) ctx.moveTo(X(u), Y(yn)); else ctx.lineTo(X(u), Y(yn));
      }
      ctx.stroke(); ctx.restore();
    }
    // Solungaç kapağı çizgisi
    if (p.gill && p.gill.strength > 0) {
      ctx.save();
      ctx.globalAlpha = (p.gill.alpha ?? 0.28) * 0.8; ctx.strokeStyle = p.gill.color || '#000'; ctx.lineWidth = 7;
      ctx.filter = 'blur(3px)';
      ctx.beginPath();
      for (let s = 0; s <= 30; s++) {
        const yn = lerp(0.62, -0.8, s / 30);
        const u = p.gill.u + 0.055 * yn * yn - 0.02;
        if (s === 0) ctx.moveTo(X(u), Y(yn)); else ctx.lineTo(X(u), Y(yn));
      }
      ctx.stroke(); ctx.restore();
    }
    // Ağız çizgisi
    if (p.mouth) {
      ctx.save();
      ctx.strokeStyle = p.mouth.color || '#2a1a1a'; ctx.globalAlpha = 0.85; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.filter = 'blur(1px)';
      ctx.beginPath(); ctx.moveTo(X(0.0), Y(p.mouth.y)); ctx.quadraticCurveTo(X(p.mouth.len * 0.5), Y(p.mouth.y - 0.04), X(p.mouth.len), Y(p.mouth.y - 0.02)); ctx.stroke();
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  _finTexture(f, opt = {}) {
    const W = 256, H = 256;
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    const base = f.color || this.finColor;
    const edge = f.edge || mixHex(base, '#ffffff', 0.15);
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, base); g.addColorStop(0.75, mixHex(base, edge, 0.5)); g.addColorStop(1, edge);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rng = mulberry32(hashString(this.p.name + (opt.key || 'fin')));
    if (f.bands) {
      ctx.save(); ctx.globalAlpha = f.bandAlpha ?? 0.6; ctx.fillStyle = f.bandColor || shade(base, 0.5);
      for (let i = 0; i < f.bands; i++) { const y = H * (1 - (i + 0.6) / (f.bands + 0.5)); ctx.fillRect(0, y, W, H / (f.bands * 3.2)); }
      ctx.restore();
    }
    if (f.spots) {
      ctx.save(); ctx.fillStyle = f.spotColor || shade(base, 0.4); ctx.globalAlpha = 0.8;
      for (let i = 0; i < f.spots; i++) { ctx.beginPath(); ctx.arc(rng() * W, H * (0.1 + 0.8 * rng()), 4 + rng() * 6, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (f.edgeBand) {
      ctx.save(); const eg = ctx.createLinearGradient(0, 0, 0, H * 0.4); eg.addColorStop(0, f.edgeBand); eg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H * 0.4); ctx.restore();
    }
    const n = f.rays || 10;
    // ışın çizgileri
    ctx.save();
    ctx.strokeStyle = f.rayColor || shade(base, 0.75); ctx.globalAlpha = 0.35; ctx.lineWidth = 2.5;
    for (let i = 0; i < n; i++) { const x = ((i + 0.5) / n) * W; ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, 0); ctx.stroke(); }
    ctx.restore();
    // alfa maskesi (dikenli yüzgeçte zar kenarı girintili)
    const mask = makeCanvas(W, H), mc = mask.getContext('2d');
    mc.fillStyle = '#fff';
    mc.beginPath(); mc.moveTo(0, H);
    const scallop = f.shape === 'spiny' || f.spiny ? (f.scallop ?? 0.32) : 0.03;
    for (let x = 0; x <= W; x += 2) {
      const ph = Math.abs(Math.sin(Math.PI * (x / W) * n));
      const dip = scallop * Math.pow(1 - ph, 0.7) + 0.02 * noise3(x * 0.05, 1, 2);
      mc.lineTo(x, H * clamp(dip, 0, 0.9));
    }
    mc.lineTo(W, H); mc.closePath(); mc.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0); ctx.restore();
    if (f.shape === 'spiny' || f.spiny) {
      ctx.save(); ctx.strokeStyle = f.spineColor || mixHex(base, '#ffffff', 0.25); ctx.globalAlpha = 0.95; ctx.lineWidth = 3.5;
      for (let i = 0; i < n; i++) { const x = ((i + 0.5) / n) * W; ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, 2); ctx.stroke(); }
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _finMaterial(f, key) {
    const mat = new THREE.MeshPhysicalMaterial({
      map: this._finTexture(f, { key }),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: f.opacity ?? 0.78,
      alphaTest: 0.3,
      roughness: 0.55,
      metalness: 0.0,
      clearcoat: 0.25,
      envMapIntensity: 0.5,
      depthWrite: true,
    });
    patchCaustics(mat, { strength: 0.6 });
    return mat;
  }

  _gridGeometry(nA, nB, fn) {
    const pos = new Float32Array((nA + 1) * (nB + 1) * 3), uv = new Float32Array((nA + 1) * (nB + 1) * 2);
    const flutter = new Float32Array((nA + 1) * (nB + 1));
    const v = new THREE.Vector3();
    for (let i = 0; i <= nA; i++) for (let j = 0; j <= nB; j++) {
      const a = i / nA, b = j / nB;
      fn(a, b, v);
      const k = i * (nB + 1) + j;
      pos.set([v.x, v.y, v.z], k * 3); uv.set([a, b], k * 2); flutter[k] = b;
    }
    const idx = [];
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
      const a = i * (nB + 1) + j, b = (i + 1) * (nB + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return { g, flutter };
  }

  _buildFins() {
    const p = this.p, F = p.fins;
    // Sırt ve anal yüzgeçleri (orta hat)
    const midline = (f, side, key) => {
      const rk = ((f.rake ?? 20) * Math.PI) / 180;
      const H = (f.height ?? 0.6) * this.Hm;
      const { g, flutter } = this._gridGeometry(Math.round(36 * this.quality), 8, (a, b, out) => {
        const u = lerp(f.u0, f.u1, a);
        const by = side > 0 ? this.top(u) * 0.9 : -this.bot(u) * 0.9;
        const h = H * finShape(f.shape, a);
        out.set(this.xOf(u) - Math.sin(rk) * h * b, by + side * Math.cos(rk) * h * b, 0);
      });
      const mesh = new THREE.Mesh(g, this._finMaterial(f, key));
      this._addPart(mesh, { kind: 'fin', flutter, flutterAxis: new THREE.Vector3(0, 0, 1), flutterAmp: 0.012 * this.T, flutterFreq: 3.0 });
      if (side > 0 && !this.anchorsRest.dorsal) {
        const u = lerp(f.u0, f.u1, 0.3);
        this.anchorsRest.dorsal = new THREE.Vector3(this.xOf(u), this.top(u) + H * 0.8, 0);
      }
    };
    (F.dorsal || []).forEach((f, i) => midline(f, 1, 'd' + i));
    (F.anal || []).forEach((f, i) => midline(f, -1, 'a' + i));

    // Kuyruk yüzgeci
    if (F.caudal) {
      const cf = F.caudal;
      const len = (cf.length ?? (1 - p.bodyFrac) + 0.02) * this.T;
      this.caudalLength = len;
      const spanY = (cf.span ?? 1.1) * this.Hm;
      const tY = this.top(1) * 0.95, bY = this.bot(1) * 0.95;
      const x0 = this.xEnd + 0.03 * this.T;
      const { g, flutter } = this._gridGeometry(Math.round(28 * this.quality), 10, (a, b, out) => {
        const s = a * 2 - 1;
        const baseY = s >= 0 ? s * tY : s * bY;
        const tipY = s * spanY;
        const l = len * caudalLen(cf.type, s);
        out.set(x0 - b * l, lerp(baseY, tipY, Math.pow(b, 0.75)), 0);
      });
      const mesh = new THREE.Mesh(g, this._finMaterial({ ...cf, rays: cf.rays ?? 18 }, 'c'));
      this._addPart(mesh, { kind: 'fin', flutter, flutterAxis: new THREE.Vector3(0, 0, 1), flutterAmp: 0.01 * this.T, flutterFreq: 2.5 });
    }

    // Göğüs yüzgeçleri (iki yan)
    const sideFin = (f, side, key, kind) => {
      const isPelvic = kind === 'pelvic';
      const u = f.u, yn = isPelvic ? -0.92 : f.y;
      const Pc = this.surfacePoint(u, yn, side);
      Pc.z *= 0.92;
      const L = (f.size ?? 0.15) * this.T;
      const spread = ((f.spread ?? (isPelvic ? 10 : 30)) * Math.PI) / 180;
      const droop = ((f.droop ?? (isPelvic ? 45 : 12)) * Math.PI) / 180;
      const roll = ((f.roll ?? 0) * Math.PI) / 180;
      const fan = ((f.fan ?? 40) * Math.PI) / 180;
      const d0 = new THREE.Vector3(-Math.cos(droop) * Math.cos(spread), -Math.sin(droop), side * Math.cos(droop) * Math.sin(spread)).normalize();
      let vv = new THREE.Vector3(0, 1, 0).sub(d0.clone().multiplyScalar(d0.y)).normalize();
      const cross = new THREE.Vector3().crossVectors(d0, vv);
      vv = vv.clone().multiplyScalar(Math.cos(roll)).add(cross.multiplyScalar(Math.sin(roll) * side)).normalize();
      const baseLen = L * (isPelvic ? 0.25 : 0.32);
      const { g, flutter } = this._gridGeometry(14, 8, (a, b, out) => {
        const phi = lerp(-fan * 0.35, fan * 0.65, a);
        const lenA = L * (0.55 + 0.45 * Math.sin(Math.PI * (0.25 + 0.6 * a)));
        const dir = d0.clone().multiplyScalar(Math.cos(phi)).add(vv.clone().multiplyScalar(Math.sin(phi)));
        out.copy(Pc).addScaledVector(vv, (a - 0.5) * baseLen).addScaledVector(dir, b * lenA);
      });
      const mesh = new THREE.Mesh(g, this._finMaterial(f, key));
      const axis = new THREE.Vector3().crossVectors(d0, vv).normalize();
      this._addPart(mesh, { kind: 'fin', flutter, flutterAxis: axis, flutterAmp: (f.flap ?? 0.05) * this.T, flutterFreq: f.flapFreq ?? 2.2 });
      if (side > 0 && !isPelvic) this.anchorsRest.pectoral = Pc.clone().addScaledVector(d0, L * 0.85);
    };
    if (F.pectoral) { sideFin(F.pectoral, 1, 'p1', 'pectoral'); sideFin(F.pectoral, -1, 'p2', 'pectoral'); }
    if (F.pelvic) { const pf = { u: 0.34, ...F.pelvic }; sideFin(pf, 1, 'v1', 'pelvic'); sideFin(pf, -1, 'v2', 'pelvic'); }

    // Ton balığı tipi yüzgeççikler
    if (F.finlets) {
      const fl = F.finlets;
      const n = fl.count ?? 7;
      const pos = [], idx = [], uvs = [];
      const add = (u, side) => {
        const x = this.xOf(u), y = side > 0 ? this.top(u) * 0.95 : -this.bot(u) * 0.95;
        const s = 0.022 * this.T * (fl.size ?? 1);
        const b = pos.length / 3;
        pos.push(x + s * 0.3, y, 0, x - s * 0.4, y, 0, x - s * 0.9, y + side * s * 1.1, 0);
        uvs.push(0, 0, 1, 0, 1, 1);
        idx.push(b, b + 1, b + 2);
      };
      for (let i = 0; i < n; i++) { const u = lerp(fl.u0 ?? 0.76, 0.97, i / (n - 1)); add(u, 1); add(u, -1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const mat = new THREE.MeshPhysicalMaterial({ color: fl.color || '#e8c23a', side: THREE.DoubleSide, roughness: 0.4, clearcoat: 0.5 });
      patchCaustics(mat);
      this._addPart(new THREE.Mesh(g, mat), { kind: 'fin' });
    }
  }

  _buildEyes() {
    const p = this.p, e = p.eye;
    const re = (e.size ?? 0.2) * this.Hm * 0.55;
    const W = 256, c = makeCanvas(W, W), ctx = c.getContext('2d');
    ctx.fillStyle = e.sclera || shade(e.iris, 0.6); ctx.fillRect(0, 0, W, W);
    const gi = ctx.createRadialGradient(W / 2, W / 2, W * 0.08, W / 2, W / 2, W * 0.42);
    gi.addColorStop(0, shade(e.iris, 0.6)); gi.addColorStop(0.55, e.iris); gi.addColorStop(1, shade(e.iris, 0.55));
    ctx.fillStyle = gi; ctx.beginPath(); ctx.arc(W / 2, W / 2, W * 0.44, 0, Math.PI * 2); ctx.fill();
    if (e.ring) { ctx.strokeStyle = e.ring; ctx.lineWidth = W * 0.05; ctx.beginPath(); ctx.arc(W / 2, W / 2, W * 0.42, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = e.pupil || '#050505'; ctx.beginPath(); ctx.arc(W / 2, W / 2, W * (e.pupilSize ?? 0.2), 0, Math.PI * 2); ctx.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.0 });
    patchCaustics(mat, { strength: 0.2 });
    for (const side of [1, -1]) {
      const g = new THREE.SphereGeometry(re, 40, 28);
      const nrm = g.attributes.normal.array, uv = g.attributes.uv.array;
      // ön yarıküreyi düzlemsel olarak iris dokusuna eşle (yerel +z dışarı bakar)
      for (let i = 0; i < uv.length / 2; i++) {
        const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
        const k = nz > 0 ? 0.5 : 0.5 / Math.max(0.2, Math.hypot(nx, ny)) ;
        uv[i * 2] = 0.5 + nx * k * (nz > 0 ? 1 : 1); uv[i * 2 + 1] = 0.5 + ny * k;
      }
      const P = this.surfacePoint(e.u, e.y, side);
      // yüzey normali (yaklaşık): yanal + biraz yukarı/ileri
      const n = new THREE.Vector3(0.15, e.y * 0.45, side).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const m = new THREE.Matrix4().compose(P.clone().addScaledVector(n, -re * 0.38), q, new THREE.Vector3(1, 1, 0.8));
      g.applyMatrix4(m);
      this._addPart(new THREE.Mesh(g, mat), { kind: 'eye' });
    }
  }

  _buildBarbels() {
    const b = this.p.barbels;
    const L = (b.length ?? 0.08) * this.T;
    const mat = new THREE.MeshPhysicalMaterial({ color: b.color || '#f3d9c4', roughness: 0.5, clearcoat: 0.3 });
    patchCaustics(mat);
    for (const side of [1, -1]) {
      const P0 = this.surfacePoint(b.u ?? 0.035, -0.75, side);
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const s = i / 6;
        pts.push(new THREE.Vector3(P0.x - L * 0.55 * s, P0.y - L * Math.sin(s * 1.2) * 0.9, P0.z + side * L * 0.12 * s));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const g = new THREE.TubeGeometry(curve, 24, 0.006 * this.T, 6, false);
      // uca doğru incelt
      const pos = g.attributes.position.array;
      for (let i = 0; i < pos.length / 3; i++) {
        const seg = Math.floor(i / 7) / 24;
        const c = curve.getPointAt(Math.min(1, seg));
        const k = 1 - 0.7 * seg;
        pos[i * 3] = c.x + (pos[i * 3] - c.x) * k; pos[i * 3 + 1] = c.y + (pos[i * 3 + 1] - c.y) * k; pos[i * 3 + 2] = c.z + (pos[i * 3 + 2] - c.z) * k;
      }
      g.computeVertexNormals();
      const flutter = new Float32Array(pos.length / 3);
      for (let i = 0; i < flutter.length; i++) flutter[i] = Math.floor(i / 7) / 24;
      this._addPart(new THREE.Mesh(g, mat), { kind: 'barbel', flutter, flutterAxis: new THREE.Vector3(0.3, 0.2, side).normalize(), flutterAmp: 0.012 * this.T, flutterFreq: 4.0 });
      if (side > 0) this.anchorsRest.barbels = pts[4].clone();
    }
  }

  // ------------------------------------------------------------ Animasyon
  bend(x, t, turn) {
    const p = this.p, sw = p.swim;
    const s = (this.xNose - x) / this.T;
    let base;
    switch (sw.style) {
      case 'anguilliform': base = 0.35; break;
      case 'thunniform': base = 0.0; break;
      case 'labriform': base = 0.02; break;
      default: base = 0.08;
    }
    const sp = Math.max(0, s);
    const env = sw.style === 'thunniform' ? Math.pow(sp, 3) * 1.4 : base + (1 - base) * sp * sp;
    const denv = sw.style === 'thunniform' ? 3 * Math.pow(sp, 2) * 1.4 : 2 * (1 - base) * sp;
    const A = sw.amp * this.T;
    const k = sw.waves * Math.PI * 2;
    const ph = k * s - sw.freq * Math.PI * 2 * t;
    const d = A * env * Math.sin(ph) + turn * this.T * sp * sp;
    const dds = A * (denv * Math.sin(ph) + env * k * Math.cos(ph)) + 2 * turn * this.T * sp;
    return [d, -dds / this.T];
  }

  update(t, { turn = 0, swimScale = 1 } = {}) {
    const ft = t * swimScale;
    for (const part of this.parts) {
      const pos = part.mesh.geometry.attributes.position, nrm = part.mesh.geometry.attributes.normal;
      const P = pos.array, N = nrm.array, R = part.rest, RN = part.restN;
      const fl = part.flutter, ax = part.flutterAxis;
      for (let i = 0, n = R.length / 3; i < n; i++) {
        let x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2];
        if (fl) {
          const w = Math.pow(fl[i], 1.3) * part.flutterAmp * Math.sin(part.flutterFreq * Math.PI * 2 * ft - fl[i] * 2.2 + x * 3.0);
          x += ax.x * w; y += ax.y * w; z += ax.z * w;
        }
        const [d, m] = this.bend(R[i * 3], ft, turn);
        const c = 1 / Math.sqrt(1 + m * m), s = m * c;
        P[i * 3] = x - z * s * 0.0; P[i * 3 + 1] = y; P[i * 3 + 2] = z + d;
        const nx = RN[i * 3], nz = RN[i * 3 + 2];
        N[i * 3] = nx * c - nz * s; N[i * 3 + 1] = RN[i * 3 + 1]; N[i * 3 + 2] = nx * s + nz * c;
      }
      pos.needsUpdate = true; nrm.needsUpdate = true;
    }
    this._t = ft; this._turn = turn;
  }

  anchorLocal(name) {
    const a = this.anchorsRest[name] || this.anchorsRest.body;
    const [d] = this.bend(a.x, this._t || 0, this._turn || 0);
    return new THREE.Vector3(a.x, a.y, a.z + d);
  }

  anchorWorld(name) {
    this.group.updateMatrixWorld(true);
    return this.anchorLocal(name).applyMatrix4(this.group.matrixWorld);
  }

  setVisible(v) { this.group.visible = v; }
}
