// Prosedürel canvas dokuları: kupon, el yazısı not, fotoğraf, defter, mühür, parmak izi, tabela, banknot...
// Hepsi deterministiktir (sabit tohumlu rastgelelik).
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

export function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.userData.canvas = c; t.userData.ctx = g;
  return t;
}

function paper(g, w, h, base = '#f3ecd9', seed = 3) {
  const r = mulberry32(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // lif / leke dokusu
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(${120 + r() * 60},${100 + r() * 50},${60 + r() * 40},${0.02 + r() * 0.04})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(120,80,30,0.28)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}

// El yazısı: hafif titreşimli satırlar
export function handText(g, text, x, y, size, color = '#1f3a8a', seed = 1, angle = -0.02) {
  const r = mulberry32(seed);
  g.save();
  g.translate(x, y); g.rotate(angle);
  g.fillStyle = color;
  g.font = `600 ${size}px Caveat, cursive`;
  let cx = 0;
  for (const ch of text) {
    g.save();
    g.translate(cx, (r() - 0.5) * size * 0.06);
    g.rotate((r() - 0.5) * 0.06);
    g.fillText(ch, 0, 0);
    g.restore();
    cx += g.measureText(ch).width * (0.98 + r() * 0.04);
  }
  g.restore();
  return cx;
}

function handX(g, cx, cy, s, r, color = '#1f3a8a') {
  g.strokeStyle = color; g.lineWidth = s * 0.16; g.lineCap = 'round';
  for (const [a, b] of [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]]) {
    g.beginPath();
    g.moveTo(cx + a[0] * s * 0.5 + (r() - 0.5) * 4, cy + a[1] * s * 0.5 + (r() - 0.5) * 4);
    g.quadraticCurveTo(cx + (r() - 0.5) * 6, cy + (r() - 0.5) * 6, cx + b[0] * s * 0.5 + (r() - 0.5) * 4, cy + b[1] * s * 0.5 + (r() - 0.5) * 4);
    g.stroke();
  }
}

export const MATCHES = [
  ['KARADENİZ', 'SİNOP GÜCÜ'], ['DERELİ', 'YAYLA SK'], ['LİMAN', 'FENERKÖY'], ['ÇAKILTAŞ', 'BOĞAZ'], ['MERCAN', 'YEŞİLIRMAK'],
  ['KAYALAR', 'TERSANE'], ['DALGA', 'KUZEY'], ['SAHİL', 'ORMANKÖY'], ['ADA SK', 'GEMİCİ'], ['MARTI', 'POYRAZ'],
  ['KÖRFEZ', 'İSKELE'], ['ÇINAR', 'DEMİRCİ'], ['AKINTI', 'KIYI SK'], ['FIRTINA', 'LODOS'], ['YAKAMOZ', 'AĞLAR'],
];
// Kupondaki tahminler (bölüm 2: hepsi sürpriz — 0 ya da 2)
export const PICKS = [2, 0, 2, 2, 0, 2, 0, 2, 2, 0, 2, 0, 2, 2, 2];

export function couponTexture() {
  return canvasTex(768, 1280, (g, w, h) => {
    paper(g, w, h, '#f6f1e4', 11);
    const r = mulberry32(5);
    // başlık bandı (kurgusal tasarım)
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#0f7a4a'); grd.addColorStop(1, '#16a06a');
    g.fillStyle = grd; g.fillRect(0, 0, w, 150);
    g.fillStyle = '#ffd23f'; g.fillRect(0, 150, w, 10);
    g.fillStyle = '#fff'; g.font = '400 92px Anton'; g.textAlign = 'center'; g.fillText('SÜPER TOTO', w / 2, 105);
    g.font = '800 26px Montserrat'; g.fillStyle = '#0f5a38'; g.fillText('HAFTALIK TAHMİN KUPONU · 15 MAÇ', w / 2, 200);
    g.textAlign = 'left';
    // kolon başlıkları
    const top = 240, rowH = 64, bx = 520;
    g.font = '900 30px Montserrat'; g.fillStyle = '#0f5a38';
    ['1', '0', '2'].forEach((s, i) => g.fillText(s, bx + i * 72 + 12, top - 8));
    for (let i = 0; i < 15; i++) {
      const y = top + i * rowH;
      g.fillStyle = i % 2 ? 'rgba(15,122,74,0.06)' : 'rgba(15,122,74,0.12)';
      g.fillRect(24, y, w - 48, rowH - 6);
      g.fillStyle = '#21302a'; g.font = '700 22px Montserrat';
      g.fillText(`${String(i + 1).padStart(2, '0')}`, 36, y + 38);
      g.font = '800 21px Montserrat';
      g.fillText(`${MATCHES[i][0]} - ${MATCHES[i][1]}`, 82, y + 38);
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = '#0f7a4a'; g.lineWidth = 3;
        g.strokeRect(bx + k * 72, y + 10, 46, 40);
      }
      const pick = PICKS[i];
      const col = pick === 1 ? 0 : pick === 0 ? 1 : 2;
      handX(g, bx + col * 72 + 23, y + 30, 40, r);
    }
    g.fillStyle = '#0f5a38'; g.font = '700 20px Montserrat';
    g.fillText('KOLON: 1   ·   TUTAR: 15 ₺', 36, top + 15 * rowH + 36);
    // barkod
    for (let i = 0; i < 90; i++) { g.fillStyle = r() > 0.45 ? '#111' : '#f6f1e4'; g.fillRect(420 + i * 3.4, top + 15 * rowH + 10, 3, 50); }
  });
}

export function noteTexture(lines = ['Bunu oyna.', 'Kimseye söyleme.']) {
  return canvasTex(768, 1280, (g, w, h) => {
    paper(g, w, h, '#efe6cf', 17);
    g.strokeStyle = 'rgba(70,110,170,0.25)'; g.lineWidth = 2;
    for (let y = 120; y < h; y += 70) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = 'rgba(200,60,60,0.3)'; g.beginPath(); g.moveTo(90, 0); g.lineTo(90, h); g.stroke();
    lines.forEach((ln, i) => handText(g, ln, 120, 470 + i * 150, 108, '#1f3a8a', 30 + i, -0.04));
    handText(g, '— R.', 470, 830, 80, '#1f3a8a', 77, -0.03);
  });
}

export function boatNameTexture(name = 'RIZA REİS') {
  return canvasTex(1024, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '400 130px Anton'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#ffffff'; g.strokeText(name, w / 2, h / 2 + 6);
    g.fillStyle = '#123a73'; g.fillText(name, w / 2, h / 2 + 6);
  });
}

export function signTexture(text, sub = '', bg = '#c8102e', fg = '#ffffff') {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, w, h * 0.45);
    g.fillStyle = fg; g.textAlign = 'center';
    g.font = '400 150px Anton'; g.fillText(text, w / 2, sub ? 150 : 185);
    if (sub) { g.font = '800 46px Montserrat'; g.fillText(sub, w / 2, 222); }
  });
}

export function photoTexture() {
  return canvasTex(768, 900, (g, w, h) => {
    g.fillStyle = '#efe7d6'; g.fillRect(0, 0, w, h);
    const x0 = 48, y0 = 48, pw = w - 96, ph = 640;
    const grd = g.createLinearGradient(0, y0, 0, y0 + ph);
    grd.addColorStop(0, '#cbb38d'); grd.addColorStop(0.55, '#a88d66'); grd.addColorStop(1, '#6f5a40');
    g.fillStyle = grd; g.fillRect(x0, y0, pw, ph);
    // deniz ve ufuk
    g.fillStyle = 'rgba(80,64,44,0.55)'; g.fillRect(x0, y0 + ph * 0.55, pw, ph * 0.45);
    // iki çocuk silüeti (aynı kazak)
    for (const [cx, s] of [[x0 + pw * 0.36, 1], [x0 + pw * 0.64, 1]]) {
      const by = y0 + ph * 0.95;
      g.fillStyle = '#4a3a28';
      g.beginPath(); g.ellipse(cx, by - 330 * s, 52, 60, 0, 0, Math.PI * 2); g.fill();          // baş
      g.fillStyle = '#5a4532';
      g.beginPath(); g.moveTo(cx - 80, by - 40); g.quadraticCurveTo(cx - 92, by - 250, cx - 40, by - 262); g.lineTo(cx + 40, by - 262);
      g.quadraticCurveTo(cx + 92, by - 250, cx + 80, by - 40); g.closePath(); g.fill();       // kazak
      g.strokeStyle = 'rgba(230,210,170,0.55)'; g.lineWidth = 8;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(cx - 70, by - 200 + k * 40); g.lineTo(cx + 70, by - 200 + k * 40); g.stroke(); } // aynı çizgili desen
      g.fillStyle = '#3a2c1e'; g.fillRect(cx - 55, by - 42, 40, 42); g.fillRect(cx + 15, by - 42, 40, 42);
    }
    // eskime
    const r = mulberry32(9);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,240,210,${r() * 0.08})`; g.fillRect(x0 + r() * pw, y0 + r() * ph, 2, 2); }
    const v = g.createRadialGradient(w / 2, y0 + ph / 2, 120, w / 2, y0 + ph / 2, 520);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(60,35,10,0.55)');
    g.fillStyle = v; g.fillRect(x0, y0, pw, ph);
    handText(g, 'Rıza & İlyas · 1968', 120, 800, 70, '#3a2a1a', 5, -0.02);
  });
}

export function notebookTexture() {
  return canvasTex(1024, 768, (g, w, h) => {
    paper(g, w, h, '#efe8d4', 21);
    g.strokeStyle = 'rgba(70,110,170,0.25)'; g.lineWidth = 2;
    for (let y = 90; y < h; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(w / 2 - 3, 0, 6, h);
    handText(g, 'Rıza', 80, 180, 80, '#1f3a8a', 3); handText(g, 'İlyas', 590, 180, 80, '#1f3a8a', 3);
    handText(g, 'Aa Bb Cc Çç', 70, 330, 64, '#1f3a8a', 8); handText(g, 'Aa Bb Cc Çç', 580, 330, 64, '#1f3a8a', 8);
    handText(g, 'Deniz bizi', 70, 450, 64, '#1f3a8a', 12); handText(g, 'Deniz bizi', 580, 450, 64, '#1f3a8a', 12);
    handText(g, 'büyüttü.', 70, 560, 64, '#1f3a8a', 14); handText(g, 'büyüttü.', 580, 560, 64, '#1f3a8a', 14);
  });
}

export function corkTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(31);
    g.fillStyle = '#b5884f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${70 + r() * 60},${45 + r() * 30},${20 + r() * 20},${0.25 + r() * 0.4})`; g.beginPath(); g.arc(r() * w, r() * h, r() * 3.5, 0, Math.PI * 2); g.fill(); }
    // kazınmış fener
    g.strokeStyle = 'rgba(50,28,10,0.95)'; g.lineWidth = 9; g.lineJoin = 'round';
    const cx = w / 2;
    g.beginPath(); g.moveTo(cx - 50, 400); g.lineTo(cx - 30, 180); g.lineTo(cx + 30, 180); g.lineTo(cx + 50, 400); g.closePath(); g.stroke();
    g.strokeRect(cx - 40, 130, 80, 50);
    g.beginPath(); g.moveTo(cx - 48, 130); g.lineTo(cx, 92); g.lineTo(cx + 48, 130); g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 50, 150); g.lineTo(cx + s * 170, 110); g.moveTo(cx + s * 50, 160); g.lineTo(cx + s * 170, 200); g.stroke(); }
    g.beginPath(); g.moveTo(cx - 110, 420); g.quadraticCurveTo(cx, 380, cx + 110, 420); g.stroke();
    g.beginPath(); g.arc(cx, h / 2, 236, 0, Math.PI * 2); g.lineWidth = 7; g.stroke();
  });
}

export function fingerprintTexture() {
  return canvasTex(512, 640, (g, w, h) => {
    g.fillStyle = '#081420'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#5ce1e6'; g.lineWidth = 6; g.lineCap = 'round';
    const cx = w / 2, cy = h * 0.52;
    for (let i = 1; i < 26; i++) {
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const rr = i * 9 * (1 + 0.08 * Math.sin(a * 3 + i * 0.4)) + 6 * Math.sin(a * 7 + i);
        const x = cx + Math.cos(a) * rr * 0.8, y = cy + Math.sin(a) * rr * 1.05 - (a > Math.PI ? 0 : i * 1.5);
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.globalAlpha = 0.5 + 0.5 * (i % 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

export function banknoteTexture() {
  return canvasTex(512, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#5b3f8c'); grd.addColorStop(0.5, '#8a6cc4'); grd.addColorStop(1, '#4b2f78');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '400 120px Anton'; g.textAlign = 'center'; g.fillText('200', w * 0.68, 165);
    g.beginPath(); g.arc(w * 0.25, h / 2, 70, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill();
  });
}

export function woodTexture(base = '#7a5233', seed = 4, rep = [2, 2]) {
  return canvasTex(512, 512, (g, w, h) => {
    const r = mulberry32(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const y = r() * h;
      g.strokeStyle = `rgba(${30 + r() * 40},${15 + r() * 25},${5 + r() * 10},${0.12 + r() * 0.2})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4);
      g.stroke();
    }
    for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(20,10,5,0.35)'; g.fillRect(0, (k * h) / 4, w, 3); }
  }, { repeat: rep });
}

export function netTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,120,90,1)'; g.lineWidth = 5;
    for (let i = -2; i <= 4; i++) {
      g.beginPath(); g.moveTo((i * w) / 2, 0); g.lineTo((i * w) / 2 + w, h); g.stroke();
      g.beginPath(); g.moveTo((i * w) / 2 + w, 0); g.lineTo((i * w) / 2, h); g.stroke();
    }
  }, { repeat: [6, 3] });
}

export function tvTexture() {
  return canvasTex(960, 540, () => {});
}

export function drawTV(tex, { home = 'KARADENİZ', away = 'SİNOP GÜCÜ', a = 0, b = 0, minute = "90'", t = 0, goal = 0 } = {}) {
  const g = tex.userData.ctx, w = 960, h = 540;
  // saha (yeşil şeritler, perspektif)
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#2f8f3a' : '#2a8234'; g.fillRect(0, i * 45, w, 45); }
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(w / 2 + Math.sin(t * 0.3) * 40, 0); g.lineTo(w / 2 + Math.sin(t * 0.3) * 40, h); g.stroke();
  g.beginPath(); g.ellipse(w / 2 + Math.sin(t * 0.3) * 40, h / 2, 120, 60, 0, 0, Math.PI * 2); g.stroke();
  // oyuncular
  const r = mulberry32(7);
  for (let i = 0; i < 14; i++) {
    const x = (r() * w + Math.sin(t * (0.6 + r()) + i) * 60) % w, y = 120 + r() * 380 + Math.cos(t * 0.8 + i) * 20;
    g.fillStyle = i < 7 ? '#1d4fa3' : '#d82a2a';
    g.beginPath(); g.ellipse(x, y, 9, 20, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#fff'; g.beginPath(); g.arc((w * 0.5 + t * 120) % w, 300 + Math.sin(t * 3) * 60, 6, 0, Math.PI * 2); g.fill();
  // skor bandı
  g.fillStyle = 'rgba(10,14,30,0.9)'; g.fillRect(30, 26, 560, 64);
  g.fillStyle = '#ffd23f'; g.fillRect(30, 26, 8, 64);
  g.fillStyle = '#fff'; g.font = '800 30px Montserrat'; g.textBaseline = 'middle';
  g.fillText(home, 52, 58); g.fillText(`${a} - ${b}`, 300, 58); g.fillText(away, 380, 58);
  g.fillStyle = '#d82a2a'; g.fillRect(600, 26, 120, 64); g.fillStyle = '#fff'; g.fillText(minute, 618, 58);
  if (goal > 0) {
    g.fillStyle = `rgba(255,210,63,${0.85 * goal})`; g.fillRect(0, h / 2 - 80, w, 160);
    g.fillStyle = `rgba(10,14,30,${goal})`; g.font = '400 140px Anton'; g.textAlign = 'center'; g.fillText('GOOOL!', w / 2, h / 2 + 8); g.textAlign = 'left';
  }
  // tarama çizgileri
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  tex.needsUpdate = true;
}

export function depthTexture() {
  return canvasTex(256, 1024, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#2a8fbf'); grd.addColorStop(0.25, '#0b4a73'); grd.addColorStop(0.3, '#3b2a4a'); grd.addColorStop(1, '#05030a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '800 28px Montserrat';
    for (let m = 0; m <= 2000; m += 250) {
      const y = 20 + (m / 2000) * (h - 40);
      g.fillRect(0, y, m % 500 === 0 ? 60 : 30, 3);
      if (m % 500 === 0) g.fillText(`${m} m`, 70, y + 10);
    }
    g.fillStyle = 'rgba(255,77,94,0.9)'; g.fillRect(0, 20 + (200 / 2000) * (h - 40), w, 5);
  });
}
