// "Kapıyı Açma" dizisi için ek modeller ve dokular.
import * as THREE from 'three';
import { mulberry32, fbm3 } from '../util.js';
import { canvasTex, handText } from './textures.js';
import { M, glowTexture } from './props.js';

const shadow = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };

// ------------------------------------------------------------------ dokular
export function watchFaceTexture(h = 3, m = 17) {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    const grd = g.createRadialGradient(c, c, 20, c, c, c);
    grd.addColorStop(0, '#f3efe4'); grd.addColorStop(1, '#cfc6b0');
    g.fillStyle = grd; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1b1b1b';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, r1 = i % 5 ? 220 : 200;
      g.save(); g.translate(c, c); g.rotate(a); g.fillRect(-(i % 5 ? 2 : 6), -240, i % 5 ? 4 : 12, 240 - r1); g.restore();
    }
    g.font = '700 54px Montserrat'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [12, 3, 6, 9].forEach((n, k) => { const a = (k / 4) * Math.PI * 2 - Math.PI / 2; g.fillText(String(n), c + Math.cos(a) * 160, c + Math.sin(a) * 160); });
    g.font = '600 26px Montserrat'; g.fillStyle = '#6b6b6b'; g.fillText('DENİZCİ', c, c + 80);
    const hand = (ang, len, wid, col) => { g.save(); g.translate(c, c); g.rotate(ang); g.fillStyle = col; g.fillRect(-wid / 2, -len, wid, len + 24); g.restore(); };
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, 130, 16, '#151515');
    hand((m / 60) * Math.PI * 2, 200, 10, '#151515');
    hand((40 / 60) * Math.PI * 2, 210, 3, '#c8102e');
    g.fillStyle = '#151515'; g.beginPath(); g.arc(c, c, 14, 0, Math.PI * 2); g.fill();
  });
}

export function crackTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry32(8);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.2;
    const cx = 330, cy = 180;
    for (let k = 0; k < 11; k++) {
      let x = cx, y = cy, a = (k / 11) * Math.PI * 2 + r() * 0.4;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 9; s++) { a += (r() - 0.5) * 0.6; x += Math.cos(a) * (18 + r() * 30); y += Math.sin(a) * (18 + r() * 30); g.lineTo(x, y); }
      g.stroke();
    }
    for (let ring = 1; ring < 4; ring++) { g.beginPath(); g.arc(cx, cy, ring * 34 + r() * 10, r() * 6, r() * 6 + 2.5); g.stroke(); }
  });
}

export function mapTexture() {
  return canvasTex(1024, 768, (g, w, h) => {
    g.fillStyle = '#e9dfc4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9d3dc'; g.fillRect(0, 0, w, h * 0.62);
    g.fillStyle = '#d7c79c';
    g.beginPath(); g.moveTo(0, h * 0.62);
    for (let x = 0; x <= w; x += 20) g.lineTo(x, h * 0.62 + Math.sin(x * 0.012) * 40 + Math.sin(x * 0.05) * 10);
    g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.strokeStyle = 'rgba(40,70,90,0.25)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#c8102e'; g.lineWidth = 7; g.setLineDash([22, 12]);
    g.beginPath(); g.moveTo(180, 520); g.bezierCurveTo(300, 360, 520, 300, 700, 210); g.stroke(); g.setLineDash([]);
    g.lineWidth = 8; g.beginPath(); g.moveTo(670, 180); g.lineTo(730, 240); g.moveTo(730, 180); g.lineTo(670, 240); g.stroke();
    handText(g, '03:17 — batır', 600, 150, 56, '#c8102e', 3, -0.05);
    handText(g, 'liman', 120, 600, 46, '#3a2a1a', 5, 0);
  });
}

export function deedPhotoTexture() {
  return canvasTex(600, 800, (g, w, h) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, h);
    const x0 = 30, y0 = 30, pw = w - 60, ph = 600;
    const grd = g.createLinearGradient(0, y0, 0, y0 + ph); grd.addColorStop(0, '#9aa7b3'); grd.addColorStop(1, '#5f6b73');
    g.fillStyle = grd; g.fillRect(x0, y0, pw, ph);
    g.fillStyle = '#c9c2b3'; g.fillRect(x0 + 40, y0 + 120, pw - 80, 360);
    g.fillStyle = '#31404d'; g.fillRect(x0 + 70, y0 + 140, pw - 140, 60);
    g.fillStyle = '#fff'; g.font = '800 34px Montserrat'; g.textAlign = 'center'; g.fillText('TAPU MÜDÜRLÜĞÜ', w / 2, y0 + 182);
    for (let k = 0; k < 4; k++) { g.fillStyle = '#4b5966'; g.fillRect(x0 + 80 + k * 110, y0 + 240, 70, 90); }
    // kadın silüeti (uzun saç)
    const cx = w / 2 + 40, by = y0 + ph;
    g.fillStyle = '#2b1e18'; g.beginPath(); g.ellipse(cx, by - 330, 58, 80, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e0b394'; g.beginPath(); g.ellipse(cx, by - 350, 40, 50, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f3b4a'; g.beginPath(); g.moveTo(cx - 90, by); g.quadraticCurveTo(cx - 95, by - 250, cx - 30, by - 285); g.lineTo(cx + 30, by - 285); g.quadraticCurveTo(cx + 95, by - 250, cx + 90, by); g.fill();
    // hedef çemberi
    g.strokeStyle = '#c8102e'; g.lineWidth = 8; g.beginPath(); g.arc(cx, by - 340, 95, 0, Math.PI * 2); g.stroke();
    handText(g, 'kızı — dün', 60, 720, 60, '#c8102e', 9, -0.03);
  });
}

export function listTexture() {
  return canvasTex(768, 1024, (g, w, h) => {
    g.fillStyle = '#efe8d4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,110,170,0.22)'; g.lineWidth = 2;
    for (let y = 150; y < h; y += 90) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    handText(g, "Selim'in adamları:", 60, 120, 70, '#1f3a8a', 2, -0.02);
    const names = ['Telefoncu Hakan', 'Liman bekçisi', 'Belediye — Murat', 'Kerem'];
    names.forEach((n, i) => handText(g, `${i + 1}. ${n}`, 80, 290 + i * 150, 72, '#1f3a8a', 20 + i, -0.02));
    g.strokeStyle = '#c8102e'; g.lineWidth = 9;
    g.beginPath(); g.ellipse(250, 728, 200, 72, -0.06, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(255, 732, 210, 80, -0.03, 0.4, Math.PI * 1.9); g.stroke();
    handText(g, 'GÜVENME!', 380, 880, 76, '#c8102e', 44, -0.06);
  });
}

export function tallyTexture() {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#8f8a82'; g.fillRect(0, 0, w, h);
    const r = mulberry32(4);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(40,35,30,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 3, 3); }
    g.strokeStyle = 'rgba(30,25,20,0.85)'; g.lineWidth = 4; g.lineCap = 'round';
    let n = 0;
    for (let row = 0; row < 8 && n < 365; row++) for (let grp = 0; grp < 10 && n < 365; grp++) {
      const x0 = 30 + grp * 98, y0 = 30 + row * 60;
      for (let k = 0; k < 4 && n < 365; k++, n++) { g.beginPath(); g.moveTo(x0 + k * 16 + r() * 3, y0); g.lineTo(x0 + k * 16 + r() * 3, y0 + 42); g.stroke(); }
      if (n < 365) { g.beginPath(); g.moveTo(x0 - 6, y0 + 36); g.lineTo(x0 + 62, y0 + 6); g.stroke(); n++; }
    }
  });
}

export function posterTexture(title, sub, bg = '#0f7a4a') {
  return canvasTex(512, 720, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(w * 0.7, h * 0.35, 180, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '400 110px Anton'; g.textAlign = 'center'; g.fillText(title, w / 2, 300);
    g.font = '800 40px Montserrat'; g.fillText(sub, w / 2, 380);
    g.fillStyle = '#ffc93c'; g.fillRect(60, 560, w - 120, 80); g.fillStyle = '#111'; g.font = '900 44px Montserrat'; g.fillText('KAMPANYA', w / 2, 615);
  });
}

function corrugatedTexture(base = '#56636e') {
  return canvasTex(256, 256, (g, w, h) => {
    for (let x = 0; x < w; x += 16) { const k = Math.sin((x / 16) * Math.PI); const v = 0.7 + 0.3 * k; g.fillStyle = new THREE.Color(base).multiplyScalar(v).getStyle(); g.fillRect(x, 0, 16, h); }
    const r = mulberry32(6);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,60,20,${0.1 + r() * 0.25})`; g.fillRect(r() * w, r() * h, 4 + r() * 20, 30 + r() * 80); }
  }, { repeat: [6, 2] });
}

function concreteTexture(base = '#8a8680', rep = [4, 2]) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const r = mulberry32(13);
    for (let i = 0; i < 3500; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`; g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3); }
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(60,50,40,${0.08 + r() * 0.12})`; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 40, 6 + r() * 20, r() * 3, 0, Math.PI * 2); g.fill(); }
  }, { repeat: rep });
}

// ------------------------------------------------------------------ modeller
export function makeWatch() {
  const g = new THREE.Group();
  const caseM = M('#c9c4b8', 0.25, 0.9);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.009, 40), caseM); body.rotation.x = Math.PI / 2; g.add(body);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.0022, 10, 40), caseM); bezel.position.z = 0.0045; g.add(bezel);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.019, 48), new THREE.MeshStandardMaterial({ map: watchFaceTexture(), roughness: 0.5 })); face.position.z = 0.0046; g.add(face);
  const crack = new THREE.Mesh(new THREE.CircleGeometry(0.019, 48), new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false, opacity: 0.8 })); crack.position.z = 0.0052; g.add(crack);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.019, 48), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1, depthWrite: false })); glass.position.z = 0.0055; g.add(glass);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.005, 12), caseM); crown.rotation.z = Math.PI / 2; crown.position.x = 0.0235; g.add(crown);
  const strapM = M('#3b2a1e', 0.75);
  for (const s of [1, -1]) {
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(0, s * (0.02 + t * 0.07), -0.002 - Math.pow(t, 2) * 0.03 * (s > 0 ? 1 : 0.2))); }
    const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.007, 4), strapM); strap.scale.x = 2.0; g.add(strap);
  }
  return shadow(g);
}

export function makeKey() {
  const g = new THREE.Group();
  const m = M('#8a6a3a', 0.45, 0.8);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 10, 24), m); g.add(bow);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 10), m); shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.08; g.add(shaft);
  for (const [x, hh] of [[0.11, 0.018], [0.125, 0.012]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.008, hh, 0.006), m); t.position.set(x, -hh / 2 - 0.004, 0); g.add(t); }
  const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 24), new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (c) => { c.fillStyle = '#b08d57'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#2a1a0a'; c.font = '400 70px Anton'; c.textAlign = 'center'; c.fillText('17', 64, 92); }), metalness: 0.6, roughness: 0.4 }));
  tag.rotation.x = Math.PI / 2; tag.position.set(-0.05, -0.02, 0); g.add(tag);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 16), m); ring.position.set(-0.03, -0.006, 0); g.add(ring);
  return shadow(g);
}

export function makeDrumField(n = 90, seed = 3, area = [6, 4]) {
  const geo = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 + 0.03 * (Math.abs(Math.sin(y * 9)) > 0.9 ? 1 : 0); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, M('#ffffff', 0.45, 0.2), n);
  const r = mulberry32(seed); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const cols = ['#1f4fa0', '#1a3f86', '#2758b0', '#20488f'];
  let k = 0;
  const cols2 = Math.floor(area[0] / 0.62), rows = Math.ceil(n / cols2 / 2);
  for (let layer = 0; layer < 2 && k < n; layer++) for (let rr = 0; rr < rows && k < n; rr++) for (let c = 0; c < cols2 && k < n; c++) {
    q.setFromEuler(new THREE.Euler(0, r() * 6, 0));
    m4.compose(new THREE.Vector3(-area[0] / 2 + c * 0.62 + (rr % 2) * 0.3, 0.44 + layer * 0.9, -rr * 0.62), q, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(k, m4); im.setColorAt(k, new THREE.Color(cols[Math.floor(r() * 4)])); k++;
  }
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

export function makeCrateStack(n = 40, seed = 5, color = '#2b6cb0') {
  const geo = new THREE.BoxGeometry(0.62, 0.26, 0.42);
  const im = new THREE.InstancedMesh(geo, M('#ffffff', 0.55), n);
  const r = mulberry32(seed); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const col = i % 4, layer = Math.floor(i / 8), row = Math.floor((i % 8) / 4);
    q.setFromEuler(new THREE.Euler(0, (r() - 0.5) * 0.12, 0));
    m4.compose(new THREE.Vector3(col * 0.64, 0.13 + layer * 0.27, row * 0.45), q, new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, m4); im.setColorAt(i, new THREE.Color(color).offsetHSL(0, 0, (r() - 0.5) * 0.08));
  }
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

export function makeMoneyStacks(n = 14, seed = 2) {
  const g = new THREE.Group(); const r = mulberry32(seed);
  const tex = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#8a6cc4'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '400 70px Anton'; c.fillText('200', 120, 92); c.fillStyle = '#c9a24a'; c.fillRect(0, 54, w, 20); });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), side = M('#d9d2e6', 0.9);
  for (let i = 0; i < n; i++) {
    const h = 0.03 + r() * 0.05;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.075), [side, side, top, side, side, side]);
    b.position.set((i % 5) * 0.17 + (r() - 0.5) * 0.02, h / 2 + Math.floor(i / 10) * 0.08, Math.floor((i % 10) / 5) * 0.09); b.rotation.y = (r() - 0.5) * 0.3; g.add(b);
  }
  return shadow(g);
}

export function makePaper(tex, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
  m.receiveShadow = true; return m;
}

export function makeOldPhone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.14), M('#1a1a1c', 0.4, 0.4)); g.add(body);
  const scrM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0b0f14'), toneMapped: false });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.12), scrM); scr.rotation.x = -Math.PI / 2; scr.position.y = 0.0065; g.add(scr);
  const glow = new THREE.PointLight('#bcd8ff', 0, 1.2, 1.8); glow.position.y = 0.12; g.add(glow);
  g.userData = { scrM, glow };
  return shadow(g);
}

export function makeBrokenPhone() {
  const g = makeOldPhone();
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.12), new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false })); crack.rotation.x = -Math.PI / 2; crack.position.y = 0.007; g.add(crack);
  const algae = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.05), new THREE.MeshStandardMaterial({ color: '#3d5a2a', transparent: true, opacity: 0.6 })); algae.rotation.x = -Math.PI / 2; algae.position.set(0.01, 0.0072, 0.04); g.add(algae);
  return g;
}

export function makeSolarPanel() {
  const g = new THREE.Group();
  const tex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#10203a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7d93b5'; c.lineWidth = 3; for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); } });
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.38), [M('#999', 0.4, 0.6), M('#999', 0.4, 0.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.2, metalness: 0.5 }), M('#555'), M('#999', 0.4, 0.6), M('#999', 0.4, 0.6)]);
  p.rotation.x = -0.6; g.add(p);
  return shadow(g);
}

export function makeCable(a, b, sag = 0.15) {
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= sag;
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 24, 0.005, 6), M('#111', 0.5));
}

export function makeCorkboard(seed = 9) {
  const g = new THREE.Group(); const r = mulberry32(seed);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.03), M('#9c7a4e', 0.95)); g.add(board);
  const pins = [];
  const colors = ['#e9e3d3', '#f2ecdc', '#ddd5c2'];
  for (let i = 0; i < 16; i++) {
    const w = 0.22 + r() * 0.12, h = 0.16 + r() * 0.12;
    const x = -1.05 + (i % 6) * 0.42 + (r() - 0.5) * 0.1, y = 0.5 - Math.floor(i / 6) * 0.48 + (r() - 0.5) * 0.08;
    const tex = canvasTex(128, 96, (c, cw, ch) => {
      c.fillStyle = colors[i % 3]; c.fillRect(0, 0, cw, ch);
      if (i % 3 === 0) { c.fillStyle = '#6b7a86'; c.fillRect(8, 8, cw - 16, ch - 30); c.fillStyle = '#2a2a2a'; c.beginPath(); c.arc(cw / 2, 40, 16, 0, Math.PI * 2); c.fill(); }
      else { c.strokeStyle = '#1f3a8a'; c.lineWidth = 3; for (let l = 0; l < 5; l++) { c.beginPath(); c.moveTo(10, 15 + l * 15); c.lineTo(cw - 10 - r() * 40, 15 + l * 15); c.stroke(); } }
    });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    card.position.set(x, y, 0.02); card.rotation.z = (r() - 0.5) * 0.15; g.add(card);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), M('#c8102e', 0.3)); pin.position.set(x, y + h / 2 - 0.02, 0.03); g.add(pin);
    pins.push(pin.position.clone());
  }
  const strM = new THREE.LineBasicMaterial({ color: '#c8102e' });
  for (let i = 0; i < 12; i++) {
    const a = pins[Math.floor(r() * pins.length)], b = pins[Math.floor(r() * pins.length)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a.clone().setZ(0.035), b.clone().setZ(0.035)]), strM));
  }
  return shadow(g);
}

// Küçük kürek kayığı
export function makeRowboat() {
  const g = new THREE.Group();
  const L = 3.0, NS = 24, NC = 14;
  const half = (u) => 0.62 * Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * u)), 0.6);
  const sheer = (u) => 0.32 + 0.12 * Math.pow(2 * u - 1, 2);
  const pos = [], idx = [];
  for (let i = 0; i <= NS; i++) {
    const u = i / NS;
    for (let j = 0; j <= NC; j++) {
      const th = (j / NC) * Math.PI, c = Math.cos(th);
      pos.push(half(u) * Math.sign(c) * Math.pow(Math.abs(c), 0.7), sheer(u) - (sheer(u) + 0.12) * Math.pow(Math.sin(th), 0.8), (u - 0.5) * L);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) { const a = i * (NC + 1) + j, b = a + NC + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, M('#3f6e8a', 0.7, 0, { side: THREE.DoubleSide })));
  for (const z of [-0.5, 0.5]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.22), M('#7a5a3a', 0.8)); seat.position.set(0, 0.16, z); g.add(seat); }
  const oarM = M('#a07a4a', 0.7);
  g.userData.oars = [];
  for (const s of [1, -1]) {
    const piv = new THREE.Group(); piv.position.set(0.6 * s, 0.33, 0.1); g.add(piv);
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.0, 8), oarM); oar.rotation.z = Math.PI / 2; oar.position.x = 0.5 * s; piv.add(oar);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.14), oarM); blade.position.x = 1.4 * s; piv.add(blade);
    g.userData.oars.push([piv, s]);
  }
  const lant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 12), M('#fff', 0.2, 0, { emissive: new THREE.Color('#ffb860'), emissiveIntensity: 3 })); lant.position.set(0.25, 0.28, -0.05); g.add(lant);
  const ll = new THREE.PointLight('#ffb860', 3.2, 5, 1.4); ll.position.set(0.25, 0.5, -0.05); g.add(ll);
  return shadow(g);
}

// Projektörlü takip teknesi (ışık konisi görünür)
export function makeSearchBoat(makeBoat) {
  const b = makeBoat({ name: 'SELİM-1', stripe: '#1b1b1b', hullTop: '#2a2d33', cabin: '#d8d8d8' });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 22, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f2f6ff', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  cone.geometry.translate(0, -11, 0); cone.rotation.x = -Math.PI / 2 + 0.1;
  const head = new THREE.Object3D(); head.position.set(0, 2.2, 1.0); b.add(head); head.add(cone);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.25, 16), M('#fff', 0.2, 0, { emissive: new THREE.Color('#f2f6ff'), emissiveIntensity: 6 })); lamp.rotation.x = Math.PI / 2; head.add(lamp);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#eaf2ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); flare.scale.set(3, 3, 1); head.add(flare);
  const spot = new THREE.SpotLight('#eef4ff', 60, 40, 0.22, 0.5, 1.2); head.add(spot); head.add(spot.target); spot.target.position.set(0, -0.4, 20);
  b.userData.searchHead = head;
  return b;
}

export function makeHoles() {
  const g = new THREE.Group();
  const tex = canvasTex(128, 128, (c, w) => { const grd = c.createRadialGradient(w / 2, w / 2, 8, w / 2, w / 2, w / 2); grd.addColorStop(0, '#000'); grd.addColorStop(0.55, '#050505'); grd.addColorStop(0.72, 'rgba(90,50,20,0.9)'); grd.addColorStop(1, 'rgba(90,50,20,0)'); c.fillStyle = grd; c.fillRect(0, 0, w, w); });
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  [[0, 0.18], [0.35, 0.12], [0.7, 0.2]].forEach(([z, y]) => { const h = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), m); h.position.set(0, y, z); h.rotation.y = Math.PI / 2; g.add(h); });
  return g;
}

export { corrugatedTexture, concreteTexture };
