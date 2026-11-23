// Uzay sahnesi yönetmeni: her segment için kamera planı, Güneş ışığı yönü, arka plandaki
// eşlik eden gök cisimleri, callout yakınlaşması, açılıştaki Güneş planı ve kapanış atlıkarıncası.
// Kamera ve ışık özneye göre (odak noktası ve kadraj) tanımlanır; böylece senaryo yalnızca
// "neye bakılacağını" söyler, sahne yerleşimini motor hesaplar.
import * as THREE from 'three';
import { Planet } from './planet.js';
import { Sun } from './star.js';
import { SpaceEnv } from './space.js';
import { clamp, lerp, ease, smoothstep, noise3 } from './util.js';

const W = 1080, H = 1920;
const D2R = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
const v3 = () => new THREE.Vector3();

function latLonOf(dir) {
  return { lat: Math.asin(clamp(dir.y, -1, 1)) / D2R, lon: Math.atan2(dir.z, -dir.x) / D2R };
}
function kf(arr, dflt, k) {
  const a = Array.isArray(arr) ? arr : arr != null ? [arr, arr] : dflt;
  return lerp(a[0], a[1], k);
}
function basisFrom(F) {
  let up0 = Y.clone();
  if (Math.abs(F.dot(up0)) > 0.97) up0 = new THREE.Vector3(0, 0, -1);
  const r = up0.clone().cross(F).normalize();
  const u = F.clone().cross(r).normalize();
  return { F: F.clone(), r, u };
}
function dirFrom(b, yaw, pitch) {
  return b.F.clone().multiplyScalar(Math.cos(pitch) * Math.cos(yaw)).addScaledVector(b.r, Math.cos(pitch) * Math.sin(yaw)).addScaledVector(b.u, Math.sin(pitch)).normalize();
}

export class SpaceStage {
  constructor(renderer, scene, camera, tl, opts = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.tl = tl;
    this.opts = opts;
    this.pixelScale = opts.scale ?? 0.75;
  }

  init() {
    const tl = this.tl, r = this.renderer;
    this.env = new SpaceEnv(r, this.scene, { pixelScale: this.pixelScale, skySize: this.opts.skySize });
    // Gezegenler tembel oluşturulur (ilk göründükleri karede bake edilir): paralel işçilerin
    // her biri yalnızca kendi kare aralığında gereken dokuları üretir.
    this.planetDefs = {};
    this.planets = {};
    let sunParams = {};
    for (const [id, s] of Object.entries(tl.subjects || {})) {
      if (s.kind === 'star') { sunParams = s.params || {}; this.sunId = id; continue; }
      if (s.kind === 'planet') this.planetDefs[id] = s.params || {};
    }
    const stage = this;
    this.subjects = new Proxy({}, {
      get: (_, id) => (typeof id === 'string' ? stage._planet(id) : undefined),
      has: (_, id) => id in stage.planetDefs,
      ownKeys: () => Object.keys(stage.planetDefs),
      getOwnPropertyDescriptor: (_, id) => (id in stage.planetDefs ? { enumerable: true, configurable: true } : undefined),
    });
    this.sun = new Sun(r, sunParams);
    this.sun.setVisible(false);
    this.scene.add(this.sun.group);
    this.tanV = Math.tan(this.camera.fov * D2R / 2);
    this.tanH = this.tanV * (W / H);
    this.proj = (H * this.pixelScale) / (2 * this.tanV);
    this.activeIdx = -1;
    this.L = new THREE.Vector3(1, 0.3, 0.4).normalize();
    this.sun.setVisible(true);
    r.compile(this.scene, this.camera);
    this.sun.setVisible(false);
  }

  _planet(id) {
    if (this.planets[id]) return this.planets[id];
    const def = this.planetDefs[id];
    if (!def) return undefined;
    const P = new Planet(this.renderer, def, { name: id });
    P.setVisible(false);
    this.scene.add(P.group);
    this.planets[id] = P;
    return P;
  }

  cueState(t, type) {
    let best = null;
    for (const c of this.tl.cues || []) {
      if (c.type !== type) continue;
      const a = c.attack ?? 0.6, d = c.dur ?? 2.0, rl = c.release ?? 0.5;
      if (t < c.t || t > c.t + a + d + rl) continue;
      const lt = t - c.t;
      const st = { cue: c, lt, attack: clamp(lt / a), fade: lt < a + d ? 1 : 1 - clamp((lt - a - d) / rl), k: 0 };
      st.k = Math.min(st.attack, st.fade);
      if (!best || st.k > best.k) best = st;
    }
    return best;
  }

  _hideAll() {
    for (const P of Object.values(this.planets)) P.setVisible(false);
    this.sun.setVisible(false);
  }

  // tr: geçiş durumu (main.js), cue: (type) => 0..1
  frame(t, seg, segIdx, tr, cue) {
    if (segIdx !== this.activeIdx) {
      this.activeIdx = segIdx;
      this.env.setConfig({ seed: seg.id, ...(seg.env || {}) });
    }
    this._hideAll();
    const off = { yaw: 0, pitch: 0, dist: 1, roll: 0 };
    if (tr) {
      const k = tr.k, out = k < 0, a = out ? ease.inCubic(clamp(1 + k)) : 1 - ease.outCubic(clamp(k));
      const sgn = out ? 1 : -1;
      switch (tr.style) {
        case 'whip': off.yaw = sgn * a * 0.9; break;
        case 'rise': off.pitch = -sgn * a * 0.8; break;
        case 'zoom': off.dist = out ? 1 - 0.55 * a : 1 + 1.6 * a; break;
        case 'spin': off.yaw = sgn * a * 1.2; off.roll = sgn * a * 0.6; break;
        default: break;
      }
    }
    const shake = cue('shake');
    let info;
    const subj = seg.subject?.ref;
    if (seg.kind === 'outro') info = this._outro(t, seg, off);
    else if (subj && subj === this.sunId) info = this._sunShot(t, seg, off);
    else if (subj && subj in this.planetDefs) info = this._planetShot(t, seg, segIdx, off);
    else info = this._sunShot(t, seg, off);
    const cam = this.camera;
    cam.rotateZ(off.roll);
    const hk = 1 + shake * 8;
    cam.rotateX(noise3(t * 0.35, 1.3, 0) * 0.0035 * hk);
    cam.rotateY(noise3(t * 0.3, 7.1, 0) * 0.0045 * hk);
    cam.updateMatrixWorld();
    this.env.update(t, cam, { proj: this.proj });
    // Güneş ekran konumu → lens parlaması
    info.flare = this._flare(info.occluder);
    if (info.anchorWorld) {
      const ap = info.anchorWorld.clone().project(cam);
      const vis = info.anchorVisible !== false && ap.z < 1;
      info.anchorScreen = vis ? { x: (ap.x * 0.5 + 0.5) * W, y: (1 - (ap.y * 0.5 + 0.5)) * H } : null;
    }
    return info;
  }

  _flare(occ) {
    if (!this.sun.group.visible) return { k: 0 };
    const cam = this.camera;
    const c = new THREE.Vector3().setFromMatrixPosition(this.sun.group.matrixWorld);
    const p = c.clone().project(cam);
    if (p.z > 1 || Math.abs(p.x) > 1.6 || Math.abs(p.y) > 1.4) return { k: 0 };
    let k = 1 - smoothstep(0.9, 1.6, Math.max(Math.abs(p.x), Math.abs(p.y)));
    if (occ) {
      // Güneş, gezegenin arkasında mı?
      const ro = cam.position, rd = c.clone().sub(ro);
      const L = rd.length(); rd.divideScalar(L);
      const oc = ro.clone().sub(occ.center);
      const b = oc.dot(rd), cc = oc.lengthSq() - occ.radius * occ.radius, h = b * b - cc;
      if (h > 0 && -b > 0 && -b < L) k *= 1 - smoothstep(0.0, 0.25 * occ.radius * occ.radius, h);
    }
    return { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5, k };
  }

  // ------------------------------------------------------------ gezegen planı
  _planetShot(t, seg, segIdx, off) {
    const P = this.subjects[seg.subject.ref];
    const sc = seg.scene || {};
    const c = seg.camera || {};
    const lt = t - seg.start, D = Math.max(0.5, seg.end - seg.start);
    const pe = ease.inOutSine ? ease.inOutSine(clamp(lt / D)) : ease.inOutCubic(clamp(lt / D));
    P.setVisible(true);
    P.group.position.set(0, 0, 0);
    P.group.quaternion.identity();
    P.setScale(1);
    const tMid = seg.start + D * 0.5;
    let focus = seg.focus;
    if (!focus && seg.callout && seg.callout.anchor) {
      const al = P.anchorLocal(seg.callout.anchor);
      focus = al.dir ? latLonOf(al.dir) : { lat: al.lat, lon: al.lon };
      focus = { lat: focus.lat * 0.75, lon: focus.lon };
    }
    focus = focus || { lat: 12, lon: 0 };
    const F = P.dirWorld(focus.lat, focus.lon, tMid);
    const b = basisFrom(F);
    const dflt = segIdx % 2 ? { yaw: [-0.32, 0.12], pitch: [0.16, 0.06] } : { yaw: [0.32, -0.1], pitch: [0.04, 0.14] };
    const yaw0 = kf(c.yaw, dflt.yaw, 0.5) * 0, pitch0 = 0;
    // segment ortası kamera tabanı (ışık + arka plan sabit kalsın diye)
    const mid = basisFrom(dirFrom(b, yaw0, pitch0));
    // ışık yönü (kameraya göre: az<0 sol, el>0 yukarı; 0 = tam arkadan)
    const sun = sc.sun || {};
    const az = (sun.az ?? -55) * D2R, el = (sun.el ?? 22) * D2R;
    this.L.copy(dirFrom(mid, az, el));
    const yaw = kf(c.yaw, dflt.yaw, pe) + off.yaw;
    const pitch = kf(c.pitch, dflt.pitch, pe) + off.pitch;
    let camDir = dirFrom(b, yaw, pitch);
    const fit = 1 / Math.sin(Math.atan(this.tanH));
    let dk = kf(c.dist, [1.42, 1.18], pe) * off.dist;
    const center = v3();
    let target = center.clone();
    // kadraj kaydırma (yarıçap biriminde): +x sağ, +y yukarı (gezegen ekranda aşağı iner)
    const ox = sc.offset ? sc.offset[0] : 0, oy = sc.offset ? sc.offset[1] : 0;
    target.addScaledVector(mid.r, -ox).addScaledVector(mid.u, -oy);
    // callout yakınlaşması
    const co = seg.callout;
    let focusK = 0, A = null, An = null;
    P.update(t, {});
    if (co && co.anchor) {
      focusK = smoothstep(co.t0 - 0.35, co.t0 + 0.5, t) * (1 - smoothstep(co.t1 - 0.2, co.t1 + 0.55, t)) * (co.zoom ?? 0.6);
      A = P.anchorWorld(co.anchor, t);
      An = P.anchorNormalWorld(co.anchor);
      target.lerp(A, focusK * 0.6);
      camDir.lerp(An, focusK * 0.35).normalize();
      dk *= 1 - 0.38 * focusK;
    }
    const dist = fit * dk;
    const cam = this.camera;
    cam.position.copy(target).addScaledVector(camDir, dist);
    cam.up.copy(mid.u);
    cam.lookAt(target);
    cam.rotateZ((c.roll ?? 0) * D2R);
    cam.updateMatrixWorld();
    // gezegen güncelle (ışık, cue'lar)
    const axis = this.cueState(t, 'axis');
    const rev = this.tl.cues?.find((q) => q.type === 'reveal' && t >= q.t - 0.01 && q.t >= seg.start && q.t < seg.end);
    const scanK = clamp((lt - 0.12) / 1.15);
    const scanAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    P.update(t, {
      sunDir: this.L, proj: this.proj, scan: seg.kind === 'item' ? scanK : 0, scanAxis, accent: this.tl.theme?.accent2,
      axisReveal: axis ? axis.attack : 0, axisFade: axis ? axis.fade : 1,
      reveal: rev ? clamp((t - rev.t) / (rev.dur ?? 1.6)) : 0,
    });
    // eşlik eden gök cismi (ör. Io'nun arkasında Jüpiter)
    const mids = { pos: center.clone().addScaledVector(mid.F, fit * kf(c.dist, [1.42, 1.18], 0.5)), b: mid };
    const midCamPos = mids.pos;
    const fwd = mid.F.clone().multiplyScalar(-1);
    const camUp = mid.u, camRight = mid.r.clone();
    if (sc.companion && sc.companion.ref in this.planetDefs) {
      const cp = sc.companion;
      const C = this.subjects[cp.ref];
      if (C !== P) {
        C.setVisible(true);
        const Dc = fit * 1.3 * (cp.dist ?? 6);
        const dir = fwd.clone().addScaledVector(camRight, (cp.x ?? 0.5) * this.tanH).addScaledVector(camUp, (cp.y ?? 0.5) * this.tanV).normalize();
        C.group.position.copy(midCamPos).addScaledVector(dir, Dc);
        const s = (cp.size ?? 0.8) * this.tanH * Dc;
        C.setScale(s);
        const m = new THREE.Matrix4().makeBasis(camRight, camUp, mid.F);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        const rot = cp.rot || [0, 0, 0];
        q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R)));
        C.group.quaternion.copy(q);
        C.update(t, { sunDir: this.L, proj: this.proj, plumes: 0.6 });
      }
    }
    // görünür Güneş
    if (sun.show) {
      this.sun.setVisible(true);
      const Ds = fit * 1.3 * (sun.dist ?? 5);
      const dir = fwd.clone().addScaledVector(camRight, (sun.x ?? -0.6) * this.tanH).addScaledVector(camUp, (sun.y ?? 0.6) * this.tanV).normalize();
      this.sun.group.position.copy(midCamPos).addScaledVector(dir, Ds);
      this.sun.group.scale.setScalar((sun.size ?? 0.5) * this.tanH * Ds);
      this.sun.update(t, cam, { intensity: sun.intensity ?? 1 });
    }
    const info = { focusDist: dist - 1, occluder: { center, radius: 1 } };
    if (A) {
      const toCam = cam.position.clone().sub(A).normalize();
      info.anchorWorld = A;
      info.anchorVisible = An.dot(toCam) > 0.02;
    }
    return info;
  }

  // ------------------------------------------------------------ Güneş planı (açılış)
  _sunShot(t, seg, off) {
    const S = this.sun;
    S.setVisible(true);
    S.group.position.set(0, 0, 0);
    S.group.scale.setScalar(1);
    const lt = t - seg.start;
    const titleAt = seg.title ? seg.title.at - seg.start : 2.0;
    const c = seg.camera || {};
    const k1 = clamp(lt / Math.max(0.5, titleAt));
    const k2 = ease.outCubic(clamp((lt - titleAt + 0.15) / 1.4));
    const b = basisFrom(new THREE.Vector3(0.25, 0.18, 1).normalize());
    const yaw = lerp(0.55, 0.35, ease.inOutSine(k1)) + lerp(0, -0.25, k2) + off.yaw;
    const pitch = lerp(-0.05, 0.08, k1) + off.pitch;
    const camDir = dirFrom(b, yaw, pitch);
    // ilk anlar: kenara (protuberanslara) çok yakın; başlıkla birlikte geri çekil
    const dNear = lerp(c.near ?? 1.32, (c.near ?? 1.32) * 1.18, ease.inOutSine(k1));
    const dist = lerp(dNear, c.far ?? 6.4, k2) * off.dist;
    const target = b.r.clone().multiplyScalar(lerp(1.0, 0.0, k2)).addScaledVector(b.u, lerp(0.2, c.titleLift ?? 1.55, k2));
    const cam = this.camera;
    cam.position.copy(target).addScaledVector(camDir, dist);
    cam.up.copy(b.u);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    S.update(t, cam, { intensity: 1, corona: lerp(0.06, 1.0, k2 * k2) });
    return { focusDist: dist - 1, occluder: null, bloom: lerp(0.22, 0.6, k2) };
  }

  // ------------------------------------------------------------ kapanış atlıkarıncası
  _outro(t, seg, off) {
    const lt = t - seg.start;
    const ids = (seg.carousel || this.tl.segments.filter((s) => s.kind === 'item').map((s) => s.subject?.ref)).filter((id) => id in this.planetDefs);
    const n = ids.length || 1;
    const R = 3.5;
    this.sun.setVisible(true);
    this.sun.group.position.set(0, 0, 0);
    this.sun.group.scale.setScalar(0.55);
    const cam = this.camera;
    ids.forEach((id, i) => {
      const P = this.subjects[id];
      P.setVisible(true);
      const a = (i / n) * Math.PI * 2 + lt * 0.16 + 0.3;
      P.group.position.set(Math.cos(a) * R, Math.sin(a * 2 + i) * 0.28, Math.sin(a) * R);
      P.group.quaternion.identity();
      P.setScale(P.p.rings ? 0.4 : 0.52);
      const L = P.group.position.clone().multiplyScalar(-1).normalize();
      P.update(t, { sunDir: L, proj: this.proj, plumes: 0.8 });
    });
    const ca = 0.5 + lt * 0.05 + off.yaw;
    const dist = 10.6 * off.dist;
    cam.position.set(Math.sin(ca) * dist, 3.9 + off.pitch * 4, Math.cos(ca) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 1.75, 0);
    cam.updateMatrixWorld();
    this.sun.update(t, cam, { intensity: 0.75, corona: 0.55 });
    return { focusDist: dist, occluder: null, bloom: 0.55 };
  }
}
