// Stilize 3D karakter (animasyon filmi tarzı): hiyerarşik iskelet + prosedürel pozlar.
// Karakter +Z yönüne bakar, ayakları y=0'dadır. Tüm hareket t'nin fonksiyonudur.
import * as THREE from 'three';
import { clamp, lerp, noise3, smoothstep } from '../util.js';

const mat = (c, r = 0.65, m = 0, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r, metalness: m, ...extra });

function capsule(r, len, m, seg = 10) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 5, seg);
  g.translate(0, -len / 2 - r * 0.2, 0); // eklem tepede, uzuv aşağı doğru
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function sphere(r, m, sx = 1, sy = 1, sz = 1, ws = 20, hs = 14) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  return mesh;
}

const DEF = { skin: '#c98f6b', hair: '#d9d4cc', beard: true, mustache: true, cap: '#2b3a55', coat: '#f2b705', sweater: '#24344f', pants: '#2c2f36', boots: '#1d2a22', glasses: false, tie: null, age: 60 };

export class Character {
  constructor(params = {}, seed = 1) {
    this.p = { ...DEF, ...params };
    this.seed = seed;
    const p = this.p;
    this.group = new THREE.Group();
    const M = {
      skin: mat(p.skin, 0.55), hair: mat(p.hair, 0.9), coat: mat(p.coat || p.sweater, p.coat ? 0.38 : 0.85, 0, p.coat ? { } : {}),
      sweater: mat(p.sweater, 0.9), pants: mat(p.pants, 0.85), boots: mat(p.boots, 0.35), white: mat('#f4f1ea', 0.3),
      pupil: mat('#1a120c', 0.2), cap: mat(p.cap || '#333', 0.95, 0, { color: new THREE.Color(p.cap || '#333').multiplyScalar(1.6) }), dark: mat('#2a1410', 0.6), lip: mat('#8a4a3a', 0.5),
      glass: mat('#222', 0.3, 0.6), tie: mat(p.tie || '#7a1020', 0.5),
    };
    this.M = M;
    const J = (this.j = {});
    const mk = (name, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); J[name] = o; return o; };

    // ---- iskelet
    const root = mk('root', this.group);
    const hips = mk('hips', root, 0, 0.94, 0);
    const spine = mk('spine', hips, 0, 0.04, 0);
    const chest = mk('chest', spine, 0, 0.3, 0);
    const neck = mk('neck', chest, 0, 0.22, 0.01);
    const head = mk('head', neck, 0, 0.08, 0.0);
    for (const s of [1, -1]) {
      const n = s > 0 ? 'L' : 'R';
      const sh = mk('sh' + n, chest, 0.205 * s, 0.16, -0.01);
      const el = mk('el' + n, sh, 0, -0.29, 0);
      mk('wr' + n, el, 0, -0.26, 0);
      const hp = mk('hip' + n, hips, 0.1 * s, -0.03, 0);
      const kn = mk('kn' + n, hp, 0, -0.43, 0);
      mk('an' + n, kn, 0, -0.42, 0);
    }

    // ---- gövde
    const coatM = p.coat ? M.coat : M.sweater;
    const pelvis = sphere(0.17, M.pants, 1.05, 0.62, 0.8); pelvis.position.y = 0.0; hips.add(pelvis);
    const torsoPts = [];
    const prof = [[0.0, 0.16], [0.06, 0.175], [0.16, 0.19], [0.26, 0.2], [0.33, 0.19], [0.4, 0.165], [0.46, 0.11], [0.5, 0.0]];
    for (const [y, r] of prof) torsoPts.push(new THREE.Vector2(r, y));
    const torsoG = new THREE.LatheGeometry(torsoPts, 22);
    const torso = new THREE.Mesh(torsoG, coatM); torso.scale.set(1.08, 1, 0.78); torso.position.y = -0.06; torso.castShadow = true;
    spine.add(torso);
    // yaka / kazak boğazı
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 8, 18), M.sweater);
    collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.18, 0.0); chest.add(collar);
    if (p.coat) {
      // fermuar / ön şerit ve ceplere benzeyen çizgiler
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.42, 0.01), mat('#c98f00', 0.5));
      strip.position.set(0, -0.02, 0.152); strip.rotation.x = -0.05; chest.add(strip);
      for (const s of [1, -1]) {
        const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.01), mat('#d99f00', 0.45));
        pocket.position.set(0.09 * s, -0.17, 0.14); pocket.rotation.x = -0.25; chest.add(pocket);
      }
    }
    if (p.tie) {
      const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.01), M.white); shirt.position.set(0, 0.06, 0.15); shirt.rotation.x = -0.15; chest.add(shirt);
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.012), M.tie); tie.position.set(0, 0.03, 0.158); tie.rotation.x = -0.15; chest.add(tie);
    }
    // kollar
    this.hands = {};
    for (const s of [1, -1]) {
      const n = s > 0 ? 'L' : 'R';
      const up = capsule(0.058, 0.2, coatM); J['sh' + n].add(up);
      const sp = sphere(0.075, coatM, 1, 0.9, 0.95); J['sh' + n].add(sp);
      const fo = capsule(0.05, 0.19, coatM); J['el' + n].add(fo);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 12), p.coat ? M.coat : M.sweater); cuff.position.y = -0.235; J['el' + n].add(cuff);
      const hand = sphere(0.048, M.skin, 0.85, 1.15, 0.6); hand.position.y = -0.055; J['wr' + n].add(hand);
      const thumb = sphere(0.02, M.skin, 1, 1.6, 1); thumb.position.set(-0.03 * s, -0.03, 0.025); thumb.rotation.z = 0.6 * s; J['wr' + n].add(thumb);
      this.hands[n] = hand;
      // bacaklar
      const th = capsule(0.078, 0.3, M.pants); J['hip' + n].add(th);
      const sh = capsule(0.064, 0.3, M.pants); J['kn' + n].add(sh);
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.08, 0.2, 14), M.boots); boot.position.y = -0.04; boot.castShadow = true; J['kn' + n].children.length; J['an' + n].add(boot);
      boot.position.set(0, 0.06, 0);
      const toe = sphere(0.08, M.boots, 1, 0.6, 1.5); toe.position.set(0, -0.03, 0.06); J['an' + n].add(toe);
    }

    // ---- baş
    const skull = sphere(0.135, M.skin, 1, 1.1, 1.04, 28, 20); skull.position.y = 0.1; head.add(skull);
    const jaw = sphere(0.115, M.skin, 1, 0.8, 1.0); jaw.position.set(0, 0.035, 0.015); head.add(jaw);
    const nose = sphere(0.026, M.skin, 0.85, 1.05, 1.2); nose.position.set(0, 0.085, 0.135); head.add(nose);
    const noseTip = sphere(0.021, M.skin); noseTip.position.set(0, 0.072, 0.15); head.add(noseTip);
    for (const s of [1, -1]) {
      const ear = sphere(0.032, M.skin, 0.5, 1, 0.8); ear.position.set(0.135 * s, 0.1, -0.005); head.add(ear);
    }
    // gözler
    this.eyes = []; this.lids = []; this.brows = [];
    for (const s of [1, -1]) {
      const eg = new THREE.Group(); eg.position.set(0.052 * s, 0.128, 0.112); head.add(eg);
      const white = sphere(0.024, M.white, 1, 1, 0.8); eg.add(white);
      const pupil = sphere(0.013, M.pupil); pupil.position.set(0, 0, 0.018); eg.add(pupil);
      const shine = sphere(0.004, mat('#ffffff', 0.1, 0, { emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.5 })); shine.position.set(0.005, 0.006, 0.03); eg.add(shine);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0265, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.skin);
      lid.rotation.x = -0.6; eg.add(lid);
      this.eyes.push(eg); this.lids.push(lid);
      const brow = capsule(0.011, 0.045, M.hair, 6); brow.rotation.z = Math.PI / 2 + 0.12 * s; brow.position.set(0.054 * s + 0.024 * s, 0.168, 0.118);
      head.add(brow); this.brows.push(brow);
    }
    // ağız
    this.mouth = sphere(0.022, M.dark, 1.3, 0.25, 0.5); this.mouth.position.set(0, 0.012, 0.128); head.add(this.mouth);
    if (p.mustache) {
      const mg = new THREE.TorusGeometry(0.045, 0.017, 8, 16, Math.PI);
      const must = new THREE.Mesh(mg, M.hair); must.rotation.z = Math.PI; must.position.set(0, 0.052, 0.135); must.scale.set(1.15, 0.7, 1); must.castShadow = true;
      head.add(must);
    }
    if (p.beard) {
      const beard = sphere(0.118, mat(p.hair, 1.0), 1.02, 0.78, 0.95); beard.position.set(0, 0.0, 0.02); head.add(beard);
      // yanaklar ağzın üstünde kalsın
    }
    if (p.cap) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.cap);
      cap.position.y = 0.19; cap.scale.set(0.98, 0.85, 1.0); cap.castShadow = true; head.add(cap);
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.024, 10, 28), M.cap); brim.rotation.x = Math.PI / 2; brim.position.y = 0.195; brim.scale.set(1.02, 1.05, 1); head.add(brim);
      for (const s of [1, -1]) { const tuft = sphere(0.04, M.hair, 0.6, 0.8, 1); tuft.position.set(0.125 * s, 0.11, -0.04); head.add(tuft); }
    } else {
      const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.142, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), M.hair);
      hairCap.position.set(0, 0.118, -0.012); hairCap.rotation.x = -0.35; hairCap.scale.set(1.0, 1.0, 1.04); head.add(hairCap);
    }
    if (p.glasses) {
      for (const s of [1, -1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 18), M.glass); ring.position.set(0.052 * s, 0.128, 0.138); head.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.006), M.glass); bridge.position.set(0, 0.13, 0.14); head.add(bridge);
    }
    this.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    this.pose = 'stand';
  }

  // Pozlar: eklem açıları (radyan). Konvansiyonlar dosya başında anlatıldığı gibi:
  // omuz.x < 0 → kolu öne kaldırır, omuz.z (dışa) > 0, dirsek.x < 0 → ön kolu büker,
  // kalça.x < 0 → bacağı öne alır, diz.x > 0 → bükülür, spine.x > 0 → öne eğilir, head.x > 0 → başı eğer.
  _target(name, t, k) {
    const ph = t + this.seed * 1.7;
    const breathe = Math.sin(ph * 1.6) * 0.02;
    const P = {
      hipsY: 0, hipsZ: 0, spine: [0.03 + breathe, 0, 0], neck: [0, 0, 0], head: [0.02, 0, 0],
      shL: [0.05, 0, 0.1], shR: [0.05, 0, 0.1], elL: -0.18, elR: -0.18, hipL: 0, hipR: 0, knL: 0.02, knR: 0.02, anL: 0, anR: 0,
      brows: 0, eyes: 1, mouth: 0.1,
    };
    switch (name) {
      case 'haul': {
        const c = ph * 1.5;
        P.hipsY = -0.06; P.spine = [0.4 + 0.12 * Math.sin(c), 0.12 * Math.sin(c * 0.5), 0];
        P.shL = [-1.25 + 0.5 * Math.sin(c), 0, 0.12]; P.elL = -0.55 - 0.45 * Math.cos(c);
        P.shR = [-1.25 + 0.5 * Math.sin(c + Math.PI), 0, 0.12]; P.elR = -0.55 - 0.45 * Math.cos(c + Math.PI);
        P.hipL = -0.35; P.knL = 0.45; P.hipR = 0.1; P.knR = 0.25; P.anL = -0.1;
        P.head = [-0.15, 0, 0]; P.mouth = 0.2;
        break;
      }
      case 'hold': case 'read':
        P.spine = [0.12 + breathe, 0, 0]; P.head = [name === 'read' ? 0.5 : 0.38, 0, 0];
        P.shL = [-0.95, 0, -0.28]; P.shR = [-0.95, 0, -0.28]; P.elL = -1.05; P.elR = -1.05;
        P.mouth = 0.15;
        break;
      case 'shock': {
        const tr = noise3(ph * 9, 1, 0) * 0.05;
        P.spine = [-0.12 + breathe, 0, 0]; P.head = [-0.12 + tr, 0, tr];
        P.shL = [-0.55 + tr, 0, 0.35]; P.shR = [-0.55 - tr, 0, 0.35]; P.elL = -1.5; P.elR = -1.5;
        P.hipL = -0.15; P.knL = 0.2; P.brows = 1; P.eyes = 1.35; P.mouth = 1.0;
        break;
      }
      case 'kneel':
        P.hipsY = -0.42; P.spine = [0.45, 0, 0]; P.head = [0.35, 0, 0];
        P.hipL = -1.45; P.knL = 1.55; P.anL = -0.1; P.hipR = -0.15; P.knR = 1.65; P.anR = 0.4;
        P.shL = [-0.85, 0, -0.1]; P.shR = [-0.85, 0, -0.1]; P.elL = -0.55; P.elR = -0.55;
        break;
      case 'sit':
        P.hipsY = -0.44; P.spine = [0.08 + breathe, 0, 0]; P.head = [0.1, 0, 0];
        P.hipL = -1.5; P.knL = 1.5; P.hipR = -1.5; P.knR = 1.5;
        P.shL = [-0.6, 0, -0.05]; P.shR = [-0.6, 0, -0.05]; P.elL = -0.75; P.elR = -0.75;
        break;
      case 'walk': {
        const c = ph * 2 * Math.PI * 0.85;
        P.hipsY = -0.015 + 0.025 * Math.abs(Math.sin(c));
        P.hipL = 0.42 * Math.sin(c); P.hipR = -0.42 * Math.sin(c);
        P.knL = 0.12 + 0.55 * Math.max(0, Math.sin(c - 1.2)); P.knR = 0.12 + 0.55 * Math.max(0, Math.sin(c + Math.PI - 1.2));
        P.shL = [-0.35 * Math.sin(c), 0, 0.1]; P.shR = [0.35 * Math.sin(c), 0, 0.1]; P.elL = -0.35; P.elR = -0.35;
        P.spine = [0.08, 0.06 * Math.sin(c), 0];
        break;
      }
      case 'cheer': {
        const c = ph * 6;
        P.hipsY = 0.05 * Math.abs(Math.sin(c * 0.5));
        P.shL = [-2.7 + 0.15 * Math.sin(c), 0, 0.35]; P.shR = [-2.7 + 0.15 * Math.sin(c + 1), 0, 0.35]; P.elL = -0.3; P.elR = -0.3;
        P.head = [-0.25, 0, 0]; P.spine = [-0.1, 0, 0]; P.mouth = 1.0; P.brows = 0.6; P.eyes = 1.15;
        break;
      }
      case 'look':
        P.head = [0.0, 0.55 * smoothstep(0, 1.2, k), 0]; P.spine = [0.03, 0.2 * smoothstep(0, 1.2, k), 0]; P.brows = 0.4;
        break;
      case 'point':
        P.shR = [-1.45, 0.2, -0.05]; P.elR = -0.05; P.head = [0, 0.1, 0]; P.brows = -0.3;
        break;
      default: break;
    }
    return P;
  }

  update(t, pose = this.pose, k = 1) {
    const P = this._target(pose, t, k);
    const J = this.j;
    J.hips.position.y = 0.94 + P.hipsY;
    J.spine.rotation.set(P.spine[0], P.spine[1], P.spine[2]);
    J.neck.rotation.set(P.neck[0], P.neck[1] * 0.4, 0);
    J.head.rotation.set(P.head[0], P.head[1], P.head[2]);
    for (const [n, s] of [['L', 1], ['R', -1]]) {
      const sh = P['sh' + n];
      J['sh' + n].rotation.set(sh[0], sh[1] * s, sh[2] * s, 'XZY');
      J['el' + n].rotation.set(P['el' + n], 0, 0);
      J['hip' + n].rotation.set(P['hip' + n], 0, 0.03 * s);
      J['kn' + n].rotation.set(P['kn' + n], 0, 0);
      J['an' + n].rotation.set(P['an' + n] - (P['hip' + n] + P['kn' + n]) * 0.0, 0, 0);
    }
    // yüz ifadesi
    const blinkPh = (t + this.seed * 0.77) % 3.7;
    const blink = blinkPh < 0.12 ? Math.sin((blinkPh / 0.12) * Math.PI) : 0;
    for (const lid of this.lids) lid.rotation.x = lerp(-0.6 - 0.5 * (P.eyes - 1), 0.75, blink);
    for (const e of this.eyes) e.scale.setScalar(P.eyes);
    this.brows.forEach((b, i) => { b.position.y = 0.168 + 0.018 * P.brows; b.rotation.z = Math.PI / 2 + (0.12 - 0.25 * P.brows) * (i === 0 ? 1 : -1); });
    this.mouth.scale.set(1.3 - 0.4 * P.mouth, 0.25 + 1.4 * P.mouth, 0.5);
    this.pose = pose;
  }

  anchor(name) {
    const v = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    switch (name) {
      case 'head': return this.j.head.localToWorld(v.set(0, 0.13, 0.02));
      case 'face': return this.j.head.localToWorld(v.set(0, 0.1, 0.1));
      case 'top': return this.j.head.localToWorld(v.set(0, 0.32, 0));
      case 'chest': return this.j.chest.localToWorld(v.set(0, 0, 0.1));
      case 'hands': {
        const a = this.j.wrL.localToWorld(new THREE.Vector3(0, -0.06, 0));
        const b = this.j.wrR.localToWorld(new THREE.Vector3(0, -0.06, 0));
        return a.add(b).multiplyScalar(0.5);
      }
      case 'handR': return this.j.wrR.localToWorld(v.set(0, -0.06, 0.02));
      case 'handL': return this.j.wrL.localToWorld(v.set(0, -0.06, 0.02));
      default: return this.j.hips.localToWorld(v.set(0, 0.3, 0));
    }
  }
}
