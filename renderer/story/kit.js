// Hikâye modu yapı taşları: malzeme önbelleği, statik geometri birleştirme (draw call
// azaltma), kanvas dokuları, gökyüzü/çevre ışığı (IBL), su, silüet, yağmur, kuşlar...
// Her şey deterministiktir (mulberry32), Math.random kullanılmaz.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32, hashString, clamp, lerp } from '../src/util.js';

export { mulberry32, hashString };

// ------------------------------------------------------------------ malzemeler
const _mats = new Map();
export function mat(color, o = {}) {
  const key = JSON.stringify([color, o.rough, o.metal, o.em, o.emI, o.map?.uuid, o.side, o.op, o.flat, o.nm?.uuid, o.env]);
  if (_mats.has(key) && !o.unique) return _mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: o.rough ?? 0.8, metalness: o.metal ?? 0,
    map: o.map || null, side: o.side ?? THREE.FrontSide, flatShading: !!o.flat,
  });
  if (o.em) { m.emissive = new THREE.Color(o.em); m.emissiveIntensity = o.emI ?? 1; }
  if (o.op !== undefined) { m.transparent = true; m.opacity = o.op; m.depthWrite = o.op > 0.9; }
  if (o.nm) { m.normalMap = o.nm; m.normalScale = new THREE.Vector2(o.nms ?? 0.5, o.nms ?? 0.5); }
  if (o.env !== undefined) m.envMapIntensity = o.env;
  if (!o.unique) _mats.set(key, m);
  return m;
}
export function glow(color, intensity = 2.5) {
  return mat('#000000', { em: color, emI: intensity, rough: 1 });
}
export function basic(color, o = {}) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: !!o.op || o.add, opacity: o.op ?? 1, depthWrite: !(o.op || o.add), side: o.side ?? THREE.FrontSide, map: o.map || null, fog: o.fog ?? true });
  if (o.add) m.blending = THREE.AdditiveBlending;
  return m;
}

// ------------------------------------------------------------------ geometri
export const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  rbox: (w, h, d, r = 0.02, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2.01, h / 2.01, d / 2.01)),
  cyl: (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  sph: (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs),
  cap: (r, len, cs = 4, rs = 10) => new THREE.CapsuleGeometry(r, len, cs, rs),
  tor: (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  cone: (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg),
  plane: (w, h, sx = 1, sy = 1) => new THREE.PlaneGeometry(w, h, sx, sy),
  lathe: (pts, seg = 20, ps = 0, pl = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, ps, pl),
};

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
// Geometrinin dönüştürülmüş kopyası
export function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _q.setFromEuler(_e.set(rx, ry, rz));
  _m4.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m4);
  return g;
}

function _normalizeAttrs(g) {
  const keep = ['position', 'normal', 'uv'];
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}

// Aynı malzemeyi paylaşan statik parçaları tek mesh'te birleştirir.
export class Batch {
  constructor() { this.groups = new Map(); }
  add(geo, material, { cast = true, receive = true } = {}) {
    const k = material.uuid + (cast ? 'c' : '') + (receive ? 'r' : '');
    if (!this.groups.has(k)) this.groups.set(k, { material, geos: [], cast, receive });
    this.groups.get(k).geos.push(_normalizeAttrs(geo));
    return this;
  }
  build(parent) {
    for (const g of this.groups.values()) {
      for (let i = 0; i < g.geos.length; i += 400) {
        const merged = mergeGeometries(g.geos.slice(i, i + 400), false);
        if (!merged) continue;
        const m = new THREE.Mesh(merged, g.material);
        m.castShadow = g.cast; m.receiveShadow = g.receive;
        m.matrixAutoUpdate = false; m.updateMatrix();
        parent.add(m);
      }
    }
    this.groups.clear();
    return parent;
  }
}

// ------------------------------------------------------------------ kanvas dokuları
export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, aniso = 4, mip = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  t.userData.canvas = c;
  return t;
}

function noiseFill(ctx, w, h, rnd, base, amt = 18, n = 4000, size = 2) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (rnd() - 0.5) * amt;
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    ctx.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}
function shade(hex, k) {
  const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString();
}

const _texCache = new Map();
function cached(key, fn) { if (!_texCache.has(key)) _texCache.set(key, fn()); return _texCache.get(key); }

export const TEX = {
  wood: (base = '#7a5236', rep = [1, 1], plank = 8) => cached('wood' + base + plank + rep, () => canvasTex(512, 512, (x, w, h) => {
    const r = mulberry32(hashString(base));
    for (let i = 0; i < plank; i++) {
      const y0 = (i * h) / plank;
      x.fillStyle = shade(base, 0.82 + r() * 0.3); x.fillRect(0, y0, w, h / plank);
      for (let k = 0; k < 26; k++) {
        x.strokeStyle = `rgba(30,15,5,${0.05 + r() * 0.12})`; x.lineWidth = 1 + r() * 2;
        x.beginPath(); const yy = y0 + r() * (h / plank);
        x.moveTo(0, yy); x.bezierCurveTo(w * 0.3, yy + (r() - 0.5) * 8, w * 0.6, yy + (r() - 0.5) * 8, w, yy + (r() - 0.5) * 6); x.stroke();
      }
      x.fillStyle = 'rgba(20,10,5,0.55)'; x.fillRect(0, y0, w, 2);
      const cut = r() * w; x.fillRect(cut, y0, 2, h / plank);
    }
  }, { repeat: rep })),
  cobble: (base = '#6d655c', rep = [6, 6]) => cached('cob' + base + rep, () => canvasTex(512, 512, (x, w, h) => {
    const r = mulberry32(77);
    x.fillStyle = shade(base, 0.45); x.fillRect(0, 0, w, h);
    const rows = 10;
    for (let j = 0; j < rows; j++) {
      const ch = h / rows, off = (j % 2) * 0.5;
      for (let i = -1; i < 8; i++) {
        const cw = w / 7; const cx = (i + off) * cw;
        x.fillStyle = shade(base, 0.75 + r() * 0.45);
        x.beginPath(); x.roundRect(cx + 3, j * ch + 3, cw - 6, ch - 6, 10); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.06)'; x.beginPath(); x.roundRect(cx + 6, j * ch + 5, cw - 16, ch * 0.35, 8); x.fill();
      }
    }
  }, { repeat: rep })),
  tiles: (a = '#c9c1b5', b = '#b3aa9c', rep = [8, 8], n = 8) => cached('tile' + a + b + rep + n, () => canvasTex(512, 512, (x, w, h) => {
    const s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? a : b; x.fillRect(i * s, j * s, s, s); }
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 3;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, h); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(w, i * s); x.stroke(); }
  }, { repeat: rep })),
  plaster: (base = '#d8cdb8', rep = [2, 2]) => cached('pl' + base + rep, () => canvasTex(256, 256, (x, w, h) => noiseFill(x, w, h, mulberry32(5), base, 14, 3000, 3), { repeat: rep })),
  wallpaper: (a = '#5d7a74', b = '#6a8a83', rep = [4, 2]) => cached('wp' + a + b + rep, () => canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = a; x.fillRect(0, 0, w, h);
    x.fillStyle = b;
    for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 14, h);
    x.fillStyle = 'rgba(255,240,200,0.10)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(i * 64 + 32, j * 64 + 32, 9, 0, 7); x.fill(); }
  }, { repeat: rep })),
  check: (a = '#c23b3b', b = '#f2ede4', rep = [3, 3]) => cached('ck' + a + b + rep, () => canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = b; x.fillRect(0, 0, w, h);
    x.fillStyle = a; x.globalAlpha = 0.75;
    for (let i = 0; i < 8; i++) { x.fillRect(i * 32, 0, 16, h); x.fillRect(0, i * 32, w, 16); }
    x.globalAlpha = 1;
  }, { repeat: rep })),
  wool: (base = '#b8844e', rep = [3, 3]) => cached('wool' + base + rep, () => canvasTex(512, 512, (x, w, h) => {
    const r = mulberry32(31);
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = r(); x.strokeStyle = v > 0.5 ? 'rgba(255,230,190,0.08)' : 'rgba(60,30,10,0.10)';
      const px = r() * w, py = r() * h, a = r() * 0.6 - 0.3 + (i % 2 ? Math.PI / 4 : -Math.PI / 4);
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6); x.stroke();
    }
  }, { repeat: rep })),
  stripes: (a, b, n = 10) => cached('st' + a + b + n, () => canvasTex(64, 256, (x, w, h) => {
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? b : a; x.fillRect(0, (i * h) / n, w, h / n); }
  })),
  awning: (a, b) => cached('aw' + a + b, () => canvasTex(256, 64, (x, w, h) => {
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? b : a; x.fillRect((i * w) / 8, 0, w / 8, h); }
  })),
  sign: (text, { bg = '#1f3b33', fg = '#f4e7c8', font = '700 64px "Playfair Display"', w = 512, h = 128, border = '#c9a24a' } = {}) =>
    cached('sg' + text + bg + fg + font + w + h, () => canvasTex(w, h, (x) => {
      x.fillStyle = bg; x.fillRect(0, 0, w, h);
      x.strokeStyle = border; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
      x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
      let fs = parseInt(font.match(/(\d+)px/)[1]);
      while (fs > 18) { x.font = font.replace(/\d+px/, fs + 'px'); if (x.measureText(text).width < w - 50) break; fs -= 4; }
      x.fillText(text, w / 2, h / 2 + 4);
    }, { repeat: [1, 1] })),
  facade: (seed, { wall = '#d9c3a0', floors = 5, cols = 4, lit = 0, shop = true, trim = '#efe6d6' } = {}) =>
    cached('fac' + seed + wall + floors + cols + lit + shop, () => canvasTex(512, 1024, (x, w, h) => {
      const r = mulberry32(seed);
      noiseFill(x, w, h, r, wall, 10, 2500, 3);
      const fh = h / (floors + 0.4);
      for (let f = 0; f < floors; f++) {
        const y0 = h - (f + 1) * fh;
        x.fillStyle = trim; x.globalAlpha = 0.6; x.fillRect(0, y0 + fh - 8, w, 8); x.globalAlpha = 1;
        if (f === 0 && shop) {
          x.fillStyle = '#2a2622'; x.fillRect(20, y0 + fh * 0.18, w - 40, fh * 0.8);
          const on = r() < 0.75;
          x.fillStyle = on ? (lit ? '#ffd9a0' : '#8a9aa0') : '#3b3a36';
          x.fillRect(36, y0 + fh * 0.26, w - 72, fh * 0.6);
          x.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 1; i < 4; i++) x.fillRect(36 + i * (w - 72) / 4, y0 + fh * 0.26, 5, fh * 0.6);
          continue;
        }
        for (let c = 0; c < cols; c++) {
          const cw = w / cols, wx = c * cw + cw * 0.22, ww = cw * 0.56, wy = y0 + fh * 0.18, wh = fh * 0.62;
          x.fillStyle = trim; x.fillRect(wx - 6, wy - 6, ww + 12, wh + 14);
          const isLit = lit && r() < lit;
          const g = x.createLinearGradient(0, wy, 0, wy + wh);
          if (isLit) { g.addColorStop(0, '#ffe2a8'); g.addColorStop(1, '#f5a85a'); }
          else { g.addColorStop(0, '#5f7482'); g.addColorStop(1, '#25313a'); }
          x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
          x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); x.fillRect(wx, wy + wh * 0.38, ww, 4);
          if (r() < 0.35) { x.fillStyle = shade(['#3d6b5a', '#7a3a2e', '#2f4a6a'][Math.floor(r() * 3)], 1); x.fillRect(wx - 14, wy - 4, 12, wh + 8); x.fillRect(wx + ww + 2, wy - 4, 12, wh + 8); }
        }
      }
    }, { repeat: [1, 1] })),
  emissiveMap: (srcTex) => srcTex,
  bookSpines: (seed) => cached('bk' + seed, () => canvasTex(512, 128, (x, w, h) => {
    const r = mulberry32(seed);
    let px = 0;
    const pal = ['#7a2e2e', '#2e4a6a', '#3a5a3a', '#8a6a2a', '#5a3a5a', '#2a2a2a', '#9a8a6a', '#6a2a1a', '#1f3f4f', '#b0a080'];
    while (px < w) {
      const bw = 10 + r() * 22, bh = h * (0.7 + r() * 0.3);
      x.fillStyle = pal[Math.floor(r() * pal.length)]; x.fillRect(px, h - bh, bw - 1, bh);
      x.fillStyle = 'rgba(255,220,150,0.35)'; x.fillRect(px + 2, h - bh + 8, bw - 5, 2); x.fillRect(px + 2, h - 14, bw - 5, 2);
      px += bw;
    }
  })),
};

// Not kâğıdı dokusu (çizgili/ızgara) — el yazısı ayrıca çizilir
export function paperTexture(kind = 'lined', tint = '#f4e9cf') {
  return canvasTex(512, 512, (x, w, h) => {
    const r = mulberry32(kind === 'grid' ? 9 : 3);
    noiseFill(x, w, h, r, tint, 12, 2500, 2);
    const g = x.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(120,80,30,0.25)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (kind === 'grid') {
      x.strokeStyle = 'rgba(80,120,170,0.25)'; x.lineWidth = 1.5;
      for (let i = 0; i < w; i += 22) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
    } else {
      x.strokeStyle = 'rgba(80,110,160,0.22)'; x.lineWidth = 2;
      for (let y = 70; y < h; y += 48) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
    }
    // katlama izleri
    x.strokeStyle = 'rgba(90,60,20,0.18)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2 + 4); x.stroke();
    x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2 - 3, h); x.stroke();
  }, { mip: true });
}

// ------------------------------------------------------------------ gökyüzü + IBL
export const SKY = {
  day:     { top: '#3d7fd6', mid: '#9cc6ee', bot: '#e9e2cf', sun: '#fff1d6', sunDir: [0.4, 0.75, 0.35], sunI: 2.6, env: 1.0, fog: '#bcd3e6', fogD: 0.012 },
  morning: { top: '#4f86cf', mid: '#f2c79a', bot: '#ffe5c2', sun: '#ffd29a', sunDir: [-0.6, 0.35, 0.55], sunI: 2.4, env: 0.95, fog: '#e9cfb2', fogD: 0.014 },
  evening: { top: '#2f4f8a', mid: '#f09a6a', bot: '#ffc98e', sun: '#ffb070', sunDir: [0.7, 0.22, -0.3], sunI: 2.2, env: 0.85, fog: '#e7a98a', fogD: 0.016 },
  sunset:  { top: '#283f7a', mid: '#f07a52', bot: '#ffb36a', sun: '#ff9a58', sunDir: [0.0, 0.12, -1.0], sunI: 2.0, env: 0.8, fog: '#e8906c', fogD: 0.014 },
  dawn:    { top: '#1e2f55', mid: '#8a7da0', bot: '#e7b6a3', sun: '#ffc6a8', sunDir: [0.8, 0.12, -0.2], sunI: 0.9, env: 0.55, fog: '#a39ab0', fogD: 0.05 },
  night:   { top: '#050a1a', mid: '#13203f', bot: '#2a2f4a', sun: '#9fb4ff', sunDir: [-0.3, 0.6, 0.4], sunI: 0.35, env: 0.28, fog: '#141b30', fogD: 0.03 },
  rain:    { top: '#4a535e', mid: '#7f8892', bot: '#a3a9ae', sun: '#d9e0e8', sunDir: [0.2, 0.9, 0.3], sunI: 0.55, env: 0.75, fog: '#8f989f', fogD: 0.05 },
  interior: { top: '#e9d2b0', mid: '#c9a982', bot: '#6e5440', sun: '#ffe2b8', sunDir: [0.5, 0.6, 0.6], sunI: 1.6, env: 0.7, fog: '#3a2f28', fogD: 0.0 },
};

export class SkyDome {
  constructor(scene) {
    this.u = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color() }, uSunSize: { value: 1 }, uStars: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
      fragmentShader: `uniform vec3 uTop, uMid, uBot, uSun, uSunDir; uniform float uSunSize, uStars; varying vec3 vD;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){ float y = vD.y;
          vec3 c = y > 0.0 ? mix(uMid, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uMid, uBot, clamp(-y * 3.0, 0.0, 1.0));
          float sd = max(dot(normalize(vD), normalize(uSunDir)), 0.0);
          c += uSun * (pow(sd, 900.0 / uSunSize) * 6.0 + pow(sd, 12.0) * 0.35);
          if (uStars > 0.0) { vec3 q = floor(vD * 420.0); float s = step(0.9975, h(q)) * smoothstep(0.0, 0.25, y); c += vec3(s) * uStars; }
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  set(p) {
    this.u.uTop.value.set(p.top); this.u.uMid.value.set(p.mid); this.u.uBot.value.set(p.bot);
    if (p.name === 'interior') { this.u.uSun.value.set(0, 0, 0); }
    this.u.uSun.value.set(p.sun).multiplyScalar(p.name === 'night' ? 0.25 : 1);
    this.u.uSunDir.value.set(...p.sunDir).normalize();
    this.u.uStars.value = p.name === 'night' ? 0.8 : 0;
    this.u.uSunSize.value = p.name === 'night' ? 0.4 : 1;
  }
}

// Gökyüzü + birkaç parlak alan → PMREM çevre haritası (yumuşak, gerçekçi ortam ışığı)
const _envCache = new Map();
export function envFor(renderer, name, preset, interior = false) {
  const key = name + (interior ? 'i' : '');
  if (_envCache.has(key)) return _envCache.get(key);
  const sc = new THREE.Scene();
  const sky = new SkyDome(sc);
  const desat = (hex, k = 0.45) => { const c = new THREE.Color(hex); const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; c.lerp(new THREE.Color(l, l, l), k); return c; };
  sky.set({ ...preset, name, top: desat(preset.top), mid: desat(preset.mid, 0.3), bot: desat(preset.bot, 0.2) });
  if (interior) {
    // sıcak duvarlar + pencere ışığı + lamba
    const wall = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(preset.wall || '#8a6a50').multiplyScalar(0.55), side: THREE.BackSide }));
    sc.add(wall);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(preset.window || '#ffe8c8').multiplyScalar(preset.winI ?? 2.2) }));
    win.position.set(18, 10, -20); win.lookAt(0, 0, 0); sc.add(win);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc890').multiplyScalar(preset.lampI ?? 2.5) }));
    lamp.position.set(-15, 20, 10); sc.add(lamp);
  } else {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(preset.bot).lerp(new THREE.Color('#b8a890'), 0.5).multiplyScalar(0.6) }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -8; sc.add(ground);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.02);
  pm.dispose();
  _envCache.set(key, rt.texture);
  return rt.texture;
}

// ------------------------------------------------------------------ su
export function makeWater({ size = 400, color = '#1d4a63', y = -0.6 } = {}) {
  const nm = canvasTex(256, 256, (x, w, h) => {
    const r = mulberry32(12);
    const img = x.createImageData(w, h);
    const hgt = new Float32Array(w * h);
    for (let k = 0; k < 40; k++) {
      const fx = 1 + Math.floor(r() * 6), fy = 1 + Math.floor(r() * 6), ph = r() * 6.28, a = 1 / (fx + fy);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hgt[j * w + i] += a * Math.sin(((i * fx) / w + (j * fy) / h) * Math.PI * 2 + ph);
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = hgt[j * w + ((i + 1) % w)] - hgt[j * w + ((i + w - 1) % w)];
      const dy = hgt[((j + 1) % h) * w + i] - hgt[((j + h - 1) % h) * w + i];
      const o = (j * w + i) * 4;
      img.data[o] = clamp(128 - dx * 90, 0, 255); img.data[o + 1] = clamp(128 - dy * 90, 0, 255); img.data[o + 2] = 255; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }, { srgb: false, repeat: [60, 60] });
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.12, metalness: 0.15, normalMap: nm, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.userData.update = (t, speed = 0.01) => { nm.offset.set(t * speed, t * speed * 0.6); };
  return mesh;
}

// İstanbul tarihi yarımada silüeti (kubbeler + minareler), uzak, sisli
export function makeSkyline({ z = -120, x0 = -160, x1 = 160, color = '#6a7480', lights = false, seed = 4 } = {}) {
  const g = new THREE.Group();
  const b = new Batch();
  const r = mulberry32(seed);
  const m = mat(color, { rough: 1, env: 0.4 });
  for (let x = x0; x < x1; x += 4 + r() * 6) {
    const h = 4 + r() * 10 + Math.max(0, 14 - Math.abs(x) * 0.08) * r();
    b.add(xf(G.box(5 + r() * 6, h, 6), x, h / 2 - 1, z + r() * 10), m, { cast: false, receive: false });
  }
  const mosques = [[-60, 1.0], [-18, 1.25], [35, 0.95], [90, 0.8]];
  for (const [mx, s] of mosques) {
    const base = 14 * s;
    b.add(xf(G.box(26 * s, base, 22 * s), mx, base / 2, z - 4), m, { cast: false, receive: false });
    b.add(xf(new THREE.SphereGeometry(10 * s, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mx, base, z - 4), m, { cast: false, receive: false });
    for (const dx of [-8, 8]) b.add(xf(new THREE.SphereGeometry(5 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mx + dx * s, base - 1, z - 4 + 6 * s), m, { cast: false, receive: false });
    for (const [dx, dz] of [[-15, -12], [15, -12], [-15, 8], [15, 8]]) {
      const mh = 36 * s;
      b.add(xf(G.cyl(0.8 * s, 1.0 * s, mh, 8), mx + dx * s, mh / 2, z - 4 + dz * s), m, { cast: false, receive: false });
      b.add(xf(G.cone(1.1 * s, 5 * s, 8), mx + dx * s, mh + 2.4 * s, z - 4 + dz * s), m, { cast: false, receive: false });
    }
  }
  b.build(g);
  if (lights) {
    const pos = [];
    for (let i = 0; i < 700; i++) pos.push(lerp(x0, x1, r()), 1 + r() * 12, z + 4 + r() * 6);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color('#ffd08a').multiplyScalar(3), size: 0.9, sizeAttenuation: true, fog: false }));
    g.add(pts);
  }
  return g;
}

// Zincir ampuller (kepçe eğrisi)
export function stringLights(b, from, to, { n = 14, sag = 0.5, bulb = '#ffcf7a', intensity = 3.0, wire = '#222' } = {}) {
  const wm = mat(wire, { rough: 1 });
  const gm = glow(bulb, intensity);
  const A = new THREE.Vector3(...from), B = new THREE.Vector3(...to);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n; const p = A.clone().lerp(B, k); p.y -= Math.sin(k * Math.PI) * sag; pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  b.add(new THREE.TubeGeometry(curve, n * 3, 0.006, 4, false), wm, { cast: false, receive: false });
  for (let i = 1; i < n; i++) b.add(xf(G.sph(0.035, 8, 6), pts[i].x, pts[i].y - 0.04, pts[i].z), gm, { cast: false, receive: false });
}

export function lampPost(b, x, z, { h = 3.6, color = '#1d2228', lit = false, head = 'lantern' } = {}) {
  const m = mat(color, { rough: 0.5, metal: 0.6 });
  b.add(xf(G.cyl(0.05, 0.08, h, 10), x, h / 2, z), m);
  b.add(xf(G.cyl(0.14, 0.18, 0.25, 10), x, 0.12, z), m);
  if (head === 'lantern') {
    b.add(xf(G.cyl(0.13, 0.08, 0.32, 6), x, h + 0.16, z), m);
    b.add(xf(G.cone(0.2, 0.18, 6), x, h + 0.42, z), m);
    b.add(xf(G.cyl(0.1, 0.07, 0.26, 6), x, h + 0.16, z), lit ? glow('#ffd59a', 4) : mat('#e8e2d0', { rough: 0.3 }), { cast: false });
  }
}

export function tree(b, x, z, { h = 4.5, seed = 1, leaf = '#4f6e3a', trunk = '#5a4430' } = {}) {
  const r = mulberry32(seed);
  const tm = mat(trunk, { rough: 1 });
  b.add(xf(G.cyl(0.09, 0.16, h * 0.6, 8), x, h * 0.3, z), tm);
  const lm = mat(leaf, { rough: 0.95, flat: true });
  for (let i = 0; i < 6; i++) {
    const s = 0.8 + r() * 0.7;
    b.add(xf(new THREE.IcosahedronGeometry(s, 1), x + (r() - 0.5) * 1.4, h * 0.65 + r() * h * 0.35, z + (r() - 0.5) * 1.4, r(), r(), r()), lm);
  }
}

// Kadıköy tipi apartman cephesi (kutu + dokulu cephe + balkonlar + korniş)
export function building(b, x, z, { w = 6, floors = 5, d = 6, seed = 1, wall = '#d9c3a0', facing = 1, lit = 0, shop = true, sign = null, signBg } = {}) {
  const fh = 3.1, h = floors * fh + 1.2;
  const tex = TEX.facade(seed, { wall, floors, cols: Math.max(2, Math.round(w / 1.7)), lit, shop });
  const front = mat('#ffffff', { map: tex, rough: 0.95, env: 0.6 });
  const side = mat(wall, { rough: 0.95, env: 0.5 });
  // ön yüz düzlemi ayrı (doku), gövde kutusu
  b.add(xf(G.box(w, h, d), x, h / 2, z - facing * d / 2), side);
  const fp = G.plane(w, h);
  b.add(xf(fp, x, h / 2, z + facing * 0.005, 0, facing > 0 ? 0 : Math.PI, 0), front, { cast: false });
  const tm = mat('#efe6d6', { rough: 0.9 });
  b.add(xf(G.box(w + 0.3, 0.35, 0.4), x, h - 0.1, z + facing * 0.1), tm);
  const r = mulberry32(seed + 7);
  for (let f = 1; f < floors; f++) {
    if (r() < 0.55) {
      const bw = w * (0.35 + r() * 0.3), bx = x + (r() - 0.5) * (w - bw) * 0.8;
      b.add(xf(G.box(bw, 0.12, 0.75), bx, f * fh + 0.35, z + facing * 0.37), tm);
      const rm = mat('#2b2b2b', { rough: 0.6, metal: 0.5 });
      b.add(xf(G.box(bw, 0.04, 0.04), bx, f * fh + 1.25, z + facing * 0.72), rm, { cast: false });
      for (let k = 0; k <= 6; k++) b.add(xf(G.box(0.025, 0.9, 0.025), bx - bw / 2 + (bw * k) / 6, f * fh + 0.8, z + facing * 0.72), rm, { cast: false });
    }
  }
  if (sign) {
    const st = TEX.sign(sign, { bg: signBg || '#1f3b33' });
    b.add(xf(G.plane(Math.min(w * 0.8, 3.6), 0.75), x, fh * 0.93, z + facing * 0.08, 0, facing > 0 ? 0 : Math.PI, 0), mat('#ffffff', { map: st, rough: 0.6, em: '#ffffff', emI: lit ? 0.0 : 0 }), { cast: false });
  }
  return h;
}

// ------------------------------------------------------------------ parçacıklar
export class Rain {
  constructor(parent, { count = 1600, area = [14, 9, 12], center = [0, 0, 0] } = {}) {
    const pos = new Float32Array(count * 6);
    this.seed = []; const r = mulberry32(91);
    for (let i = 0; i < count; i++) this.seed.push([r() * area[0] - area[0] / 2, r(), r() * area[2] - area[2] / 2, 0.8 + r() * 0.4]);
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mesh = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#c8d6e6'), transparent: true, opacity: 0.45, fog: true }));
    this.mesh.frustumCulled = false;
    this.area = area; this.center = center; this.count = count;
    parent.add(this.mesh);
  }
  update(t, k = 1, camPos) {
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;
    const p = this.geo.attributes.position.array, H = this.area[1];
    const cx = camPos ? camPos.x : this.center[0], cz = camPos ? camPos.z - 4 : this.center[2];
    const n = Math.floor(this.count * k);
    for (let i = 0; i < this.count; i++) {
      const [x, y0, z, sp] = this.seed[i];
      let y = (((y0 * H - t * 9 * sp) % H) + H) % H;
      const o = i * 6;
      if (i >= n) { p.fill(0, o, o + 6); continue; }
      p[o] = cx + x; p[o + 1] = y; p[o + 2] = cz + z;
      p[o + 3] = cx + x + 0.02; p[o + 4] = y + 0.28; p[o + 5] = cz + z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

export class Dust {
  constructor(parent, { count = 220, box = [3, 2.5, 3], center = [0, 1.3, 0], color = '#ffe8c0', size = 0.012 } = {}) {
    const r = mulberry32(55);
    this.base = []; const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.base.push([(r() - 0.5) * box[0], (r() - 0.5) * box[1], (r() - 0.5) * box[2], r() * 6.28]);
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mesh = new THREE.Points(this.geo, new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2), size, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.position.set(...center); this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }
  update(t) {
    const p = this.geo.attributes.position.array;
    this.base.forEach(([x, y, z, ph], i) => {
      p[i * 3] = x + Math.sin(t * 0.21 + ph) * 0.12; p[i * 3 + 1] = y + Math.sin(t * 0.13 + ph * 2) * 0.1; p[i * 3 + 2] = z + Math.cos(t * 0.17 + ph) * 0.12;
    });
    this.geo.attributes.position.needsUpdate = true;
  }
}

// Kuşlar: martı (süzülme) ve güvercin (yerde gagalama → kalkış)
export class Birds {
  constructor(parent, { n = 6, kind = 'gull', seed = 3, area = null } = {}) {
    this.kind = kind; this.items = []; const r = mulberry32(seed);
    const body = mat(kind === 'gull' ? '#f1f1ee' : '#7d8088', { rough: 0.8 });
    const wingM = mat(kind === 'gull' ? '#e6e8ea' : '#6a6d75', { rough: 0.8, side: THREE.DoubleSide });
    const tipM = mat('#2a2a2a', { side: THREE.DoubleSide });
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const s = kind === 'gull' ? 1 : 0.6;
      const bd = new THREE.Mesh(G.sph(0.09 * s, 10, 8), body); bd.scale.set(0.8, 0.75, 1.8); g.add(bd);
      const hd = new THREE.Mesh(G.sph(0.055 * s, 8, 6), body); hd.position.set(0, 0.04 * s, 0.15 * s); g.add(hd);
      const bk = new THREE.Mesh(G.cone(0.015 * s, 0.05 * s, 6), mat(kind === 'gull' ? '#e2b13c' : '#3a3a3a')); bk.rotation.x = Math.PI / 2; bk.position.set(0, 0.035 * s, 0.215 * s); g.add(bk);
      const wings = [];
      for (const sd of [-1, 1]) {
        const wg = new THREE.Group(); wg.position.set(0.04 * sd * s, 0.02, 0);
        const w = new THREE.Mesh(G.plane(0.42 * s, 0.14 * s), wingM); w.rotation.x = -Math.PI / 2; w.position.x = 0.21 * sd * s; wg.add(w);
        if (kind === 'gull') { const tp = new THREE.Mesh(G.plane(0.08 * s, 0.1 * s), tipM); tp.rotation.x = -Math.PI / 2; tp.position.set(0.42 * sd * s, 0.001, -0.01); wg.add(tp); }
        g.add(wg); wings.push([wg, sd]);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = kind !== 'gull'; });
      parent.add(g);
      this.items.push({ g, wings, ph: r() * 6.28, r: 4 + r() * 10, h: 5 + r() * 6, sp: 0.15 + r() * 0.2, c: [(r() - 0.5) * 20, (r() - 0.5) * 10 - 8], ground: area ? [lerp(area[0], area[1], r()), lerp(area[2], area[3], r())] : [0, 0], dir: r() * 6.28 });
    }
  }
  update(t, { flyAt = null } = {}) {
    for (const it of this.items) {
      const { g, wings } = it;
      if (this.kind === 'gull') {
        const a = it.ph + t * it.sp;
        g.position.set(it.c[0] + Math.cos(a) * it.r, it.h + Math.sin(t * 0.5 + it.ph) * 0.6, it.c[1] + Math.sin(a) * it.r);
        g.rotation.set(0, -a, Math.sin(a) * 0.25);
        const flap = Math.sin(t * 7 + it.ph) * (0.5 + 0.5 * Math.sin(t * 0.7 + it.ph) > 0.6 ? 0.55 : 0.08);
        for (const [w, sd] of wings) w.rotation.z = sd * flap;
      } else {
        const k = flyAt !== null && t > flyAt ? t - flyAt - it.ph * 0.03 : -1;
        if (k <= 0) {
          const peck = Math.max(0, Math.sin(t * 5 + it.ph * 3)) ** 6;
          g.position.set(it.ground[0], 0.07, it.ground[1]);
          g.rotation.set(peck * 0.6, it.dir + Math.sin(t * 0.4 + it.ph) * 0.5, 0);
          for (const [w, sd] of wings) w.rotation.z = sd * 0.05;
        } else {
          const up = k * 2.4 + k * k * 1.2;
          g.position.set(it.ground[0] + Math.cos(it.dir) * k * 2.5, 0.07 + up, it.ground[1] + Math.sin(it.dir) * k * 2.5 - k * 1.2);
          g.rotation.set(-0.5, it.dir, 0);
          for (const [w, sd] of wings) w.rotation.z = sd * Math.sin(t * 24 + it.ph) * 0.9;
        }
      }
    }
  }
}
