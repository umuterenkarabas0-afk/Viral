// Aksesuarlar: eldeki nesneler (not, fotoğraf, çay, şemsiye, simit...) ve yakın plan
// "insert" çekimleri (el yazısıyla yazılan not, harita, açık kitap, dolma kalem...).
import * as THREE from 'three';
import { G, mat, glow, TEX, canvasTex, paperTexture, mulberry32, hashString, Batch, xf } from './kit.js';
import { clamp, lerp, ease, smoothstep } from '../src/util.js';

const PI = Math.PI;
export const HANDS = {
  nuri: { font: 'Caveat', weight: 700, color: '#1c2a52', size: 1.0 },
  defne: { font: 'Caveat', weight: 700, color: '#1c2a52', size: 1.0 },
  kerem: { font: 'Kalam', weight: 700, color: '#141414', size: 0.82 },
  twist: { font: 'Amatic SC', weight: 700, color: '#5e0d0d', size: 1.25 },
};

// ------------------------------------------------------------------ el yazısı düzeni + çizimi
export class Handwriting {
  constructor(text, { hand = 'nuri', w = 1024, h = 740, paper = 'lined', tint = '#f4e9cf', margin = 70, maxFs = 108, minFs = 52, align = 'left' } = {}) {
    this.text = text; this.hand = HANDS[hand] || HANDS.nuri; this.w = w; this.h = h; this.margin = margin;
    this.bg = paperTexture(paper, tint).userData.canvas;
    this.tex = canvasTex(w, h, () => {}, { mip: true });
    this.ctx = this.tex.userData.canvas.getContext('2d');
    this.rnd = mulberry32(hashString(text));
    this._layout(maxFs, minFs, align);
    this.shown = -1;
    this.draw(1e9);
  }
  _font(fs) { return `${this.hand.weight} ${Math.round(fs)}px "${this.hand.font}"`; }
  _layout(maxFs, minFs, align) {
    const x = this.ctx; const W = this.w - this.margin * 2, Hh = this.h - this.margin * 2;
    const words = this.text.replace(/\n/g, ' \n ').split(' ').filter((s) => s.length);
    let fs = maxFs * this.hand.size;
    let lines;
    for (; fs > minFs; fs -= 4) {
      x.font = this._font(fs);
      lines = []; let cur = '';
      for (const wd of words) {
        if (wd === '\n') { lines.push(cur); cur = ''; continue; }
        const test = cur ? cur + ' ' + wd : wd;
        if (x.measureText(test).width > W && cur) { lines.push(cur); cur = wd; } else cur = test;
      }
      if (cur) lines.push(cur);
      if (lines.length * fs * 1.12 <= Hh) break;
    }
    this.fs = fs;
    x.font = this._font(fs);
    const lh = fs * 1.12;
    const total = lines.length * lh;
    let y0 = this.margin + (Hh - total) / 2 + fs * 0.82;
    this.chars = [];
    let ci = 0;
    const flat = this.text.replace(/\n/g, ' ');
    lines.forEach((ln, li) => {
      const lw = x.measureText(ln).width;
      let px = align === 'center' ? (this.w - lw) / 2 : this.margin + (li % 2 ? 8 : 0);
      const slope = (this.rnd() - 0.5) * 0.02;
      for (const ch of ln) {
        while (ci < flat.length && flat[ci] !== ch) ci++;
        const cw = x.measureText(ch).width;
        this.chars.push({ ch, x: px, y: y0 + li * lh + (px - this.margin) * slope + (this.rnd() - 0.5) * 3, w: cw, r: (this.rnd() - 0.5) * 0.06, a: 0.86 + this.rnd() * 0.14, src: ci });
        px += cw; ci++;
      }
      ci++;
    });
  }
  // marks: [[charStart, charEnd, s, e]] — t anına kadar yazılmış karakter sayısı (kesirli)
  progressAt(t, marks) {
    if (!marks || !marks.length) return 1e9;
    let n = 0;
    for (const [c0, c1, s, e] of marks) {
      const d = Math.max(0.15, (e - s) * 0.95);
      if (t >= s) n = Math.max(n, c0 + (c1 - c0) * clamp((t - s) / d));
    }
    // kaynak karakter indeksinden düzen indeksine
    let k = 0;
    for (const c of this.chars) { if (c.src < n) k++; else break; }
    const last = this.chars[k];
    const frac = last && n > last.src ? clamp(n - last.src) : 0;
    return k + frac;
  }
  penPos(prog) {
    const i = Math.min(this.chars.length - 1, Math.floor(prog));
    const c = this.chars[Math.max(0, i)];
    if (!c) return { u: 0.5, v: 0.5 };
    const f = prog - Math.floor(prog);
    return { u: (c.x + c.w * f) / this.w, v: (c.y - this.fs * 0.25) / this.h };
  }
  draw(prog) {
    const key = Math.round(prog * 6);
    if (key === this.shown) return;
    this.shown = key;
    const x = this.ctx;
    x.drawImage(this.bg, 0, 0, this.w, this.h);
    x.font = this._font(this.fs);
    x.textBaseline = 'alphabetic';
    const n = Math.floor(prog);
    for (let i = 0; i < this.chars.length && i <= n; i++) {
      const c = this.chars[i];
      x.save();
      x.translate(c.x, c.y); x.rotate(c.r);
      if (i === n) { const f = prog - n; if (f <= 0) { x.restore(); break; } x.beginPath(); x.rect(-2, -this.fs, c.w * f + 2, this.fs * 1.4); x.clip(); }
      x.fillStyle = this.hand.color; x.globalAlpha = c.a;
      x.fillText(c.ch, 0, 0);
      x.restore();
    }
    x.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}

// kıvrık kâğıt geometrisi
function paperGeo(w, h, curl = 0.012, seg = 16) {
  const g = new THREE.PlaneGeometry(w, h, seg, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, curl * Math.pow((x / (w / 2)), 2) + curl * 0.6 * Math.sin((y / h) * PI * 1.3) + 0.004 * Math.abs(y) / h);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ eldeki nesneler
function scribbleTex(color = '#1c2a52', paper = 'lined') {
  return canvasTex(256, 192, (x, w, h) => {
    x.drawImage(paperTexture(paper).userData.canvas, 0, 0, w, h);
    const r = mulberry32(hashString(color + paper));
    x.strokeStyle = color; x.lineWidth = 3; x.lineCap = 'round';
    for (let l = 0; l < 4; l++) {
      x.beginPath(); let px = 22, y = 40 + l * 36;
      x.moveTo(px, y);
      while (px < w - 30 - (l === 3 ? 90 : 0)) { px += 6 + r() * 8; x.lineTo(px, y + (r() - 0.5) * 12); }
      x.stroke();
    }
  });
}
function photoTex(half = null) {
  return canvasTex(256, 320, (x, w, h) => {
    x.fillStyle = '#f3eee2'; x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#c9b08a'); g.addColorStop(0.6, '#8a6f50'); g.addColorStop(1, '#5a4632');
    x.fillStyle = g; x.fillRect(14, 14, w - 28, h - 70);
    x.fillStyle = 'rgba(40,28,18,0.75)';
    const fig = (cx) => { x.beginPath(); x.arc(cx, 120, 20, 0, 7); x.fill(); x.beginPath(); x.moveTo(cx - 30, 250); x.lineTo(cx - 22, 145); x.lineTo(cx + 22, 145); x.lineTo(cx + 30, 250); x.fill(); };
    if (half !== 'right') fig(half ? 150 : 90);
    if (half !== 'left') fig(half ? 100 : 170);
    x.fillStyle = 'rgba(30,20,10,0.5)'; x.fillRect(14, 200, w - 28, 8);
    x.fillStyle = '#7a2a1a'; x.font = '700 26px "Caveat"'; x.fillText('1984', 22, h - 22);
  });
}

export function makeHandProp(kind) {
  const g = new THREE.Group();
  g.userData.kind = kind;
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  switch (kind) {
    case 'note': case 'note_twist': {
      const tex = kind === 'note' ? scribbleTex() : scribbleTex('#5e0d0d', 'grid');
      add(new THREE.Mesh(paperGeo(0.105, 0.078, 0.004, 6), mat('#ffffff', { map: tex, rough: 0.9, side: THREE.DoubleSide })));
      break;
    }
    case 'photo': {
      add(new THREE.Mesh(G.plane(0.08, 0.1), mat('#ffffff', { map: photoTex(), rough: 0.5, side: THREE.DoubleSide })));
      break;
    }
    case 'pen': {
      const body = add(new THREE.Mesh(G.cyl(0.0065, 0.0055, 0.13, 12), mat('#121212', { rough: 0.25, metal: 0.3 })));
      body.rotation.x = PI / 2;
      const band = add(new THREE.Mesh(G.cyl(0.0068, 0.0068, 0.008, 12), mat('#c9a24a', { rough: 0.25, metal: 1 }))); band.rotation.x = PI / 2; band.position.z = -0.02;
      const nib = add(new THREE.Mesh(G.cone(0.0045, 0.022, 8), mat('#d9b85a', { rough: 0.2, metal: 1 }))); nib.rotation.x = PI / 2; nib.position.z = 0.075;
      break;
    }
    case 'tea': case 'tea2': {
      const one = () => {
        const t = new THREE.Group();
        const glass = new THREE.Mesh(G.lathe([[0.001, 0], [0.019, 0.002], [0.021, 0.02], [0.016, 0.045], [0.022, 0.075], [0.024, 0.085]], 18), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.35, metalness: 0 }));
        const tea = new THREE.Mesh(G.lathe([[0.001, 0.003], [0.018, 0.005], [0.02, 0.02], [0.015, 0.045], [0.02, 0.068], [0.001, 0.068]], 16), mat('#8a1f0c', { rough: 0.15, em: '#3a0800', emI: 0.6 }));
        const saucer = new THREE.Mesh(G.cyl(0.045, 0.03, 0.008, 20), mat('#f4f2ee', { rough: 0.3 })); saucer.position.y = -0.004;
        t.add(tea, glass, saucer); return t;
      };
      g.add(one());
      if (kind === 'tea2') { const b = one(); b.name = 'second'; g.add(b); }
      break;
    }
    case 'bowl': {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 10, 0, PI * 2, PI / 2, PI / 2), mat('#e9e2d4', { rough: 0.4, side: THREE.DoubleSide })));
      const milk = add(new THREE.Mesh(G.cyl(0.062, 0.062, 0.004, 18), mat('#f7f3e8'))); milk.position.y = -0.02;
      const r = mulberry32(3);
      for (let i = 0; i < 9; i++) { const c = add(new THREE.Mesh(G.tor(0.009, 0.004, 5, 8), mat('#d99a3a'))); c.position.set((r() - 0.5) * 0.08, -0.016, (r() - 0.5) * 0.08); c.rotation.x = PI / 2; }
      break;
    }
    case 'phone': {
      add(new THREE.Mesh(G.rbox(0.072, 0.145, 0.008, 0.006), mat('#15161a', { rough: 0.3, metal: 0.4 })));
      const scr = new THREE.Mesh(G.plane(0.064, 0.135), glow('#7fb2ff', 0.9)); scr.position.z = 0.0045; g.add(scr);
      break;
    }
    case 'umbrella_red': {
      const red = mat('#c8202c', { rough: 0.5, side: THREE.DoubleSide });
      const shaft = add(new THREE.Mesh(G.cyl(0.008, 0.008, 0.95, 8), mat('#1a1a1a', { metal: 0.6, rough: 0.3 }))); shaft.position.y = 0.42;
      const canopy = add(new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.26, 10, 1, true), red)); canopy.position.y = 0.86;
      const hook = add(new THREE.Mesh(G.tor(0.03, 0.007, 6, 12, PI), mat('#3a2a1e'))); hook.position.y = -0.05; hook.rotation.z = PI;
      break;
    }
    case 'simit2': {
      for (const dx of [-0.03, 0.03]) { const s = add(new THREE.Mesh(G.tor(0.055, 0.021, 8, 20), mat('#b8743a', { rough: 0.7 }))); s.position.x = dx; s.rotation.y = 0.2; }
      break;
    }
    case 'coat_folded': {
      add(new THREE.Mesh(G.rbox(0.36, 0.09, 0.24, 0.03), mat('#ffffff', { map: TEX.wool('#b8844e', [1, 1]), rough: 0.95 })));
      break;
    }
    case 'coat_hanger': {
      const h = add(new THREE.Mesh(G.tor(0.17, 0.006, 4, 20, PI), mat('#6a4a2e'))); h.position.y = 0.0;
      const c = add(new THREE.Mesh(G.lathe([[0.04, 0.0], [0.15, -0.04], [0.17, -0.3], [0.2, -0.75]], 18), mat('#5a6a7a', { rough: 0.9, side: THREE.DoubleSide }))); c.scale.z = 0.5;
      break;
    }
    case 'envelope': {
      add(new THREE.Mesh(G.box(0.16, 0.002, 0.11), mat('#efe3c6', { rough: 0.9 })));
      break;
    }
  }
  return g;
}

// ------------------------------------------------------------------ yüzeyler (insert)
function surface(kind) {
  const g = new THREE.Group();
  let m;
  switch (kind) {
    case 'coat': m = mat('#ffffff', { map: TEX.wool('#b8844e', [3, 3]), rough: 0.95 }); break;
    case 'cloth': m = mat('#ffffff', { map: TEX.check('#3a6a5a', '#f2ede4', [6, 6]), rough: 0.95 }); break;
    case 'market_cloth': m = mat('#ffffff', { map: TEX.check('#8a2a2a', '#e8d9b8', [7, 7]), rough: 0.95 }); break;
    case 'deck': m = mat('#ffffff', { map: TEX.wood('#a07850', [4, 4], 10), rough: 0.75 }); break;
    case 'hand': m = mat('#ffffff', { map: TEX.wool('#3b4a5e', [3, 3]), rough: 0.95 }); break;
    default: m = mat('#ffffff', { map: TEX.wood('#6a4630', [3, 3], 8), rough: 0.6 });
  }
  const p = new THREE.Mesh(G.plane(3, 3), m); p.rotation.x = -PI / 2; p.receiveShadow = true; g.add(p);
  if (kind === 'coat') {
    // cep ağzı + dikiş
    const lip = new THREE.Mesh(G.rbox(0.32, 0.02, 0.05, 0.01), mat('#ffffff', { map: TEX.wool('#a87444', [1, 1]), rough: 0.95 }));
    lip.position.set(0, 0.012, 0.07); lip.castShadow = true; g.add(lip);
    const slot = new THREE.Mesh(G.plane(0.3, 0.035), mat('#1a1008', { rough: 1 })); slot.rotation.x = -PI / 2; slot.position.set(0, 0.003, 0.095); g.add(slot);
    const btn = new THREE.Mesh(G.cyl(0.02, 0.02, 0.008, 16), mat('#3a2a1e', { rough: 0.4 })); btn.position.set(0.25, 0.006, -0.12); g.add(btn);
  }
  if (kind === 'hand') {
    const skin = mat('#e2a882', { rough: 0.6, em: '#e2a882', emI: 0.05 });
    const palm = new THREE.Mesh(G.sph(0.11, 20, 14), skin); palm.scale.set(1.0, 0.28, 1.15); palm.position.set(0.02, 0.025, 0.06); palm.castShadow = true; g.add(palm);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(G.cap(0.022, 0.08, 4, 8), skin); f.rotation.x = PI / 2 - 0.15; f.position.set(-0.06 + i * 0.04, 0.03, -0.09 - (i === 1 || i === 2 ? 0.015 : 0)); f.castShadow = true; g.add(f); }
    const th = new THREE.Mesh(G.cap(0.025, 0.07, 4, 8), skin); th.rotation.set(PI / 2, 0, -1.0); th.position.set(0.13, 0.03, 0.05); g.add(th);
  }
  return g;
}

function decor(g, kind, seed = 1) {
  // odak dışında kalacak çevre nesneleri: çay bardağı, anahtar, gözlük, kalem
  const r = mulberry32(seed);
  const tea = makeHandProp('tea'); tea.scale.setScalar(1.6); tea.position.set(-0.32 - r() * 0.1, 0.0, -0.22); g.add(tea);
  if (kind !== 'coat') {
    const pen = makeHandProp('pen'); pen.scale.setScalar(1.4); pen.position.set(0.28, 0.01, 0.12); pen.rotation.y = 0.8; g.add(pen);
    const key = new THREE.Mesh(G.tor(0.022, 0.005, 6, 16), mat('#c9a24a', { metal: 1, rough: 0.3 })); key.rotation.x = PI / 2; key.position.set(0.3, 0.006, -0.25); g.add(key);
  }
}

// ------------------------------------------------------------------ harita
const PLACES = [['İSKELE', 0.33, 0.30], ['MODA', 0.40, 0.78], ['ALTIYOL', 0.62, 0.44], ['BAHARİYE', 0.58, 0.58], ['YELDEĞİRMENİ', 0.55, 0.16], ['FENERBAHÇE', 0.78, 0.9], ['ÇARŞI', 0.47, 0.36]];
function mapCanvas(nDots, highlight) {
  const W = 1024, H = 1024;
  const r = mulberry32(40);
  const dots = [];
  return canvasTex(W, H, (x) => {
    x.drawImage(paperTexture('plain', '#efe2c2').userData.canvas, 0, 0, W, H);
    // deniz
    x.fillStyle = 'rgba(80,130,150,0.35)';
    x.beginPath(); x.moveTo(0, 0); x.lineTo(380, 0); x.bezierCurveTo(300, 200, 360, 280, 260, 380); x.bezierCurveTo(200, 520, 330, 640, 300, 760);
    x.bezierCurveTo(330, 880, 520, 900, 600, 1024); x.lineTo(0, 1024); x.fill();
    x.strokeStyle = 'rgba(40,70,90,0.6)'; x.lineWidth = 4; x.stroke();
    x.fillStyle = 'rgba(40,70,90,0.5)'; x.font = 'italic 700 46px "Playfair Display"'; x.fillText('MARMARA', 40, 560);
    // sokaklar
    x.strokeStyle = 'rgba(90,70,50,0.35)'; x.lineWidth = 3;
    for (let i = 0; i < 26; i++) { x.beginPath(); const y = 60 + i * 38; x.moveTo(330 + Math.sin(i) * 40, y); x.lineTo(1000, y + (r() - 0.5) * 60); x.stroke(); }
    for (let i = 0; i < 16; i++) { x.beginPath(); const xx = 380 + i * 42; x.moveTo(xx, 0); x.lineTo(xx + (r() - 0.5) * 120, 1024); x.stroke(); }
    x.strokeStyle = 'rgba(90,60,40,0.55)'; x.lineWidth = 8;
    x.beginPath(); x.moveTo(340, 300); x.bezierCurveTo(500, 380, 600, 420, 980, 470); x.stroke();
    x.beginPath(); x.moveTo(620, 0); x.bezierCurveTo(600, 300, 640, 600, 560, 1024); x.stroke();
    x.fillStyle = 'rgba(50,35,25,0.85)'; x.font = '700 30px "Courier Prime"';
    for (const [n, u, v] of PLACES) x.fillText(n, u * W - 40, v * H);
    x.font = '700 64px "Playfair Display"'; x.fillStyle = 'rgba(60,40,25,0.9)'; x.fillText('KADIKÖY', 640, 90);
    // pusula
    x.strokeStyle = 'rgba(60,40,25,0.8)'; x.lineWidth = 3; x.beginPath(); x.arc(900, 900, 50, 0, 7); x.stroke();
    x.beginPath(); x.moveTo(900, 840); x.lineTo(915, 900); x.lineTo(900, 960); x.lineTo(885, 900); x.closePath(); x.stroke(); x.fillText('K', 885, 830);
  }, { mip: true });
}

export function mapDots(nDots = 40) {
  const r = mulberry32(41);
  const out = [];
  while (out.length < nDots) {
    const u = 0.36 + r() * 0.6, v = 0.06 + r() * 0.9;
    if (u < 0.33 + 0.1 * Math.sin(v * 6)) continue;
    out.push([u, v]);
  }
  out[0] = [0.43, 0.74];  // Selim & Ayla — Moda
  out[nDots - 1] = [0.6, 0.47]; // Kerem & Defne — Altıyol
  return out;
}

// ------------------------------------------------------------------ insert sahnesi kurucusu
export function buildInsert(prop, timeline) {
  const g = new THREE.Group();
  const kind = prop.type;
  const surf = prop.surface || 'wood';
  g.add(surface(surf));
  decor(g, surf, hashString(kind + surf));
  const st = { focus: new THREE.Vector3(0, 0, 0), update: () => {} };
  const paperM = (tex) => mat('#ffffff', { map: tex, rough: 0.92, side: THREE.DoubleSide, unique: true });

  if (kind === 'note' || kind === 'book_margin' || kind === 'pen_write' || kind === 'pen_shake') {
    const text = prop.text || 'Bugün birine gülümse.';
    const margin = kind === 'book_margin';
    const hw = new Handwriting(text, { hand: prop.hand || 'nuri', paper: prop.paper || (margin ? 'plain' : 'lined'), tint: margin ? '#f1e8d2' : '#f4e9cf', maxFs: margin ? 84 : 118, w: margin ? 1024 : 768, h: margin ? 600 : 1000, margin: margin ? 70 : 64 });
    const W = margin ? 0.24 : 0.19, H = W * hw.h / hw.w;
    const paper = new THREE.Mesh(paperGeo(W, H, 0.01), paperM(hw.tex));
    paper.rotation.x = -PI / 2;
    paper.position.y = 0.004;
    paper.castShadow = true; paper.receiveShadow = true;
    const holder = new THREE.Group(); holder.add(paper); g.add(holder);
    if (kind === 'book_margin') {
      // basılı sayfa: üstte basılı satırlar, el yazısı altta
      const printed = canvasTex(1024, 512, (x, w, h) => {
        x.drawImage(paperTexture('plain', '#f1e8d2').userData.canvas, 0, 0, w, h);
        x.fillStyle = 'rgba(30,25,20,0.8)'; x.font = '400 34px "Playfair Display"';
        const lines = ['…ve vapur iskeleden ayrılırken, kimse', 'arkasına bakmadı. Şehir, cebinde taşıdığı', 'sırlarla birlikte uyanıyordu. Bazı insanlar', 'birbirini bulmak için kırk yıl bekler;', 'bazıları ise yalnızca bir notu…'];
        lines.forEach((l, i) => x.fillText(l, 70, 90 + i * 72));
        x.font = '700 30px "Playfair Display"'; x.fillText('— 47 —', w / 2 - 50, h - 30);
      });
      const pm = new THREE.Mesh(paperGeo(W, W / 2, 0.006), paperM(printed)); pm.rotation.x = -PI / 2; pm.position.set(0, 0.003, -H / 2 - W / 4 + 0.005); pm.receiveShadow = true; holder.add(pm);
      holder.position.z = 0.03;
    }
    if (prop.pose === 'pocket') { holder.rotation.set(-0.15, 0.25, 0.05); holder.position.set(0, 0.02, 0.0); }
    else holder.rotation.y = (hashString(text) % 100) / 100 * 0.3 - 0.15;
    let pen = null;
    if (kind === 'pen_write' || kind === 'pen_shake') { pen = makeHandProp('pen'); pen.scale.setScalar(1.25); g.add(pen); }
    st.update = (t) => {
      let prog = prop.reveal ? hw.progressAt(t, prop.marks) : 1e9;
      if (kind === 'pen_shake') prog = Math.min(prog, hw.chars.length * 0.35 + Math.sin(t * 3) * 0.5);
      hw.draw(prog);
      if (pen) {
        const pp = hw.penPos(Math.min(prog, hw.chars.length - 0.01));
        const loc = new THREE.Vector3((pp.u - 0.5) * W, 0.0, (pp.v - 0.5) * H);
        loc.applyEuler(holder.rotation);
        const writing = prog < hw.chars.length;
        const jig = kind === 'pen_shake' ? 0.004 : 0.0015;
        const lift = writing ? 0.004 + Math.abs(Math.sin(t * 22)) * 0.004 : 0.03;
        pen.position.set(loc.x + Math.sin(t * 41) * jig + 0.01, lift + 0.055, loc.z + Math.cos(t * 37) * jig + 0.045);
        pen.rotation.set(-0.95, 0.35, 0.2);
        pen.position.add(new THREE.Vector3(0.0, 0, 0));
      }
    };
    st.focus.set(0, 0, 0);
    st.hw = hw;
  } else if (kind === 'notes_many') {
    const texts = ['08:47 vapurunu kaçıracaksın.', 'Kamera güzel fikirdi Kerem.', 'Kediye dokunma.', 'Kırmızı balık!', 'Paltolu çocuğun adı Kerem.', 'Simitçiye iki tane de.', 'Yalnız olmayacaksın.', 'Bugün kırmızı şemsiyeli adama saati sor.'];
    const r = mulberry32(8);
    texts.forEach((tx, i) => {
      const hw = new Handwriting(tx, { hand: 'nuri', maxFs: 120, w: 768, h: 560 });
      const m = new THREE.Mesh(paperGeo(0.15, 0.11, 0.006), paperM(hw.tex));
      const a = (i / texts.length) * PI * 2;
      m.rotation.set(-PI / 2, 0, (r() - 0.5) * 1.2);
      m.position.set(Math.cos(a) * (0.1 + r() * 0.08), 0.003 + i * 0.0015, Math.sin(a) * (0.08 + r() * 0.06));
      m.castShadow = true; m.receiveShadow = true;
      m.userData.t0 = i * 0.25;
      g.add(m);
      m.userData.drop = true;
    });
    st.update = (t, lt) => { g.children.forEach((c) => { if (c.userData.drop) { const k = ease.outCubic(clamp((lt - c.userData.t0) / 0.35)); c.visible = lt >= c.userData.t0 - 0.02; c.position.y = 0.003 + (1 - k) * 0.08 + c.userData.t0 * 0.006; } }); };
  } else if (kind === 'notes_pair') {
    const mk = (tx, side) => {
      const hw = new Handwriting(tx, { hand: 'nuri', w: 640, h: 560, maxFs: 110, align: 'center' });
      const m = new THREE.Mesh(paperGeo(0.13, 0.115, 0.006), paperM(hw.tex));
      m.rotation.set(-PI / 2, 0, side * 0.08); m.castShadow = true; m.receiveShadow = true;
      g.add(m); return m;
    };
    const L = mk(prop.left || 'Bu gece son vapur.', 1), R = mk(prop.right || 'Arka güverte.', -1);
    const joinT = (timeline.cues || []).find((c) => c.type === 'join')?.t ?? 0;
    st.update = (t) => {
      const k = ease.inOutCubic(clamp((t - joinT + 0.6) / 0.6));
      L.position.set(lerp(-0.12, -0.066, k), 0.004, lerp(-0.03, 0, k)); L.rotation.z = lerp(0.3, 0.0, k);
      R.position.set(lerp(0.12, 0.066, k), 0.0045, lerp(0.04, 0, k)); R.rotation.z = lerp(-0.25, 0.0, k);
    };
  } else if (kind === 'map') {
    const dots = mapDots(prop.dots || 40);
    const tex = mapCanvas(dots.length);
    const W = 0.42, H = 0.42;
    const m = new THREE.Mesh(paperGeo(W, H, 0.012, 24), paperM(tex)); m.rotation.x = -PI / 2; m.position.y = 0.004; m.castShadow = true; m.receiveShadow = true; g.add(m);
    const dotM = mat('#d01e1e', { rough: 0.4, em: '#ff2020', emI: 0.5 });
    const ringM = basicRing();
    const dotsT = (timeline.cues || []).find((c) => c.type === 'dots')?.t;
    const dms = dots.map(([u, v], i) => {
      const d = new THREE.Mesh(G.cyl(0.0055, 0.0055, 0.002, 12), dotM); d.position.set((u - 0.5) * W, 0.016, (v - 0.5) * H); g.add(d); return d;
    });
    const labelTex = (txt) => canvasTex(512, 128, (x, w, h) => { x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, w, h); x.fillStyle = '#7a1010'; x.font = '700 74px "Caveat"'; x.fillText(txt, 8, 90); }, { mip: true });
    const lab = (txt, i) => {
      const lm = new THREE.Mesh(G.plane(0.12, 0.03), new THREE.MeshStandardMaterial({ map: labelTex(txt), transparent: true, roughness: 0.9, depthWrite: false }));
      lm.rotation.x = -PI / 2; lm.position.copy(dms[i].position).add(new THREE.Vector3(0.066, 0.001, -0.004)); g.add(lm); return lm;
    };
    const lS = lab('Selim & Ayla · 1984', 0), lK = lab('Kerem & Defne · 2026', dots.length - 1);
    const ring = new THREE.Mesh(G.tor(0.018, 0.0018, 6, 30), ringM); ring.rotation.x = -PI / 2; g.add(ring);
    const foc = prop.focus === 'selim' ? 0 : prop.focus === 'us' ? dots.length - 1 : -1;
    if (foc >= 0) st.focus.copy(dms[foc].position).setY(0);
    st.update = (t, lt) => {
      dms.forEach((d, i) => {
        let k = 1;
        if (prop.reveal && dotsT !== undefined) k = ease.outBack(clamp((t - dotsT - i * 0.035) / 0.25), 2.5);
        d.scale.setScalar(Math.max(0.001, k));
        d.visible = k > 0.01;
      });
      const isNew = dots.length - 1;
      dms[isNew].material = dotM;
      if (prop.focus === 'us') dms[isNew].scale.setScalar(1 + 0.35 * Math.max(0, Math.sin(lt * 7)));
      lS.visible = !prop.reveal || foc === 0 || prop.focus;
      lK.visible = prop.focus === 'us';
      ring.visible = foc >= 0;
      if (foc >= 0) { ring.position.copy(dms[foc].position).setY(0.017); const k = ease.outCubic(clamp((lt - 0.3) / 0.5)); ring.scale.setScalar(0.4 + 0.6 * k + 0.05 * Math.sin(lt * 5)); }
    };
  } else if (kind === 'book') {
    const pageTex = (n, side) => canvasTex(512, 720, (x, w, h) => {
      x.drawImage(paperTexture('plain', '#f1e8d2').userData.canvas, 0, 0, w, h);
      x.fillStyle = 'rgba(30,25,20,0.75)';
      const r = mulberry32(n);
      for (let i = 0; i < 22; i++) x.fillRect(50, 60 + i * 28, (w - 100) * (0.75 + r() * 0.25), 9);
      x.font = '700 34px "Playfair Display"'; x.fillStyle = 'rgba(30,25,20,0.9)'; x.fillText(String(n), side < 0 ? 50 : w - 90, h - 30);
    });
    const curve = (side) => { const gg = new THREE.PlaneGeometry(0.17, 0.24, 20, 2); const p = gg.attributes.position; for (let i = 0; i < p.count; i++) { const xx = p.getX(i) + 0.085; p.setX(i, side * xx); p.setZ(i, Math.sin((xx / 0.17) * PI) * 0.012 + Math.pow(1 - xx / 0.17, 6) * 0.02); } gg.computeVertexNormals(); return gg; };
    const left = new THREE.Mesh(curve(-1), paperM(pageTex(46, -1))); left.rotation.x = -PI / 2; left.position.y = 0.02; left.receiveShadow = true; left.castShadow = true; g.add(left);
    const right = new THREE.Mesh(curve(1), paperM(pageTex(47, 1))); right.rotation.x = -PI / 2; right.position.y = 0.02; right.receiveShadow = true; g.add(right);
    const cover = new THREE.Mesh(G.rbox(0.36, 0.018, 0.255, 0.004), mat('#5a1f1f', { rough: 0.7 })); cover.position.y = 0.006; cover.castShadow = true; g.add(cover);
    const ph = new THREE.Mesh(G.plane(0.075, 0.1), mat('#ffffff', { map: photoTex('right'), rough: 0.5, side: THREE.DoubleSide })); ph.rotation.set(-PI / 2, 0, -0.18); ph.position.set(0.05, 0.036, 0.01); ph.castShadow = true; g.add(ph);
    st.focus.set(0.03, 0, 0);
    st.update = (t, lt) => { const k = ease.outCubic(clamp(lt / 0.6)); right.rotation.z = 0; left.position.y = 0.02 + (1 - k) * 0.0; };
  }
  st.group = g;
  return st;
}

function basicRing() { return new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(1.4), transparent: true, opacity: 0.9 }); }

// Zarf (güverte bankının üstünde)
export function envelopeMesh() {
  const tex = canvasTex(512, 352, (x, w, h) => {
    x.fillStyle = '#efe3c6'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(120,90,50,0.4)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 0); x.lineTo(w / 2, h * 0.55); x.lineTo(w, 0); x.stroke();
    x.fillStyle = '#1c2a52'; x.font = '700 70px "Caveat"'; x.textAlign = 'center'; x.fillText('Kerem & Defne', w / 2, h * 0.82);
  });
  const m = new THREE.Mesh(G.box(0.2, 0.004, 0.14), [mat('#e6d7b5'), mat('#e6d7b5'), mat('#ffffff', { map: tex, rough: 0.9 }), mat('#e6d7b5'), mat('#e6d7b5'), mat('#e6d7b5')]);
  m.castShadow = true;
  return m;
}
