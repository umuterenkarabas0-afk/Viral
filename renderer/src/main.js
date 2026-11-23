// Yönetmen: timeline.json'u okur, sahneyi kurar ve window.renderFrame(t)
// fonksiyonunu dışa açar. Render tamamen deterministiktir (t → kare).
import * as THREE from 'three';
import { Fish } from './fish.js';
import { OceanEnv } from './ocean.js';
import { Post } from './post.js';
import { SpaceStage } from './spacestage.js';
import { Overlay } from './overlay.js';
import { clamp, lerp, ease, noise3, smoothstep } from './util.js';

const W = 1080, H = 1920;
const TRANS = 0.32; // geçiş yarı süresi (sn)
const TRANSITIONS = ['whip', 'zoom', 'rise', 'whip', 'spin'];
const SPACE_TRANSITIONS = ['zoom', 'whip', 'spin', 'zoom', 'rise'];

async function loadTimeline() {
  if (window.__TIMELINE__) return window.__TIMELINE__;
  const q = new URLSearchParams(location.search);
  const url = q.get('timeline') || '/output/timeline.json';
  const r = await fetch(url);
  return r.json();
}

class Director {
  constructor(tl) {
    this.tl = tl;
    this.segs = tl.segments;
    this.q = tl.meta?.quality ?? 1;
  }

  async init() {
    const canvas = document.getElementById('gl');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    const ro = window.__RENDER_OPTS__ || {};
    this.scale = ro.scale ?? 0.75;
    r.setPixelRatio(this.scale);
    r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, W / H, 0.05, 900);
    this.camera.setViewOffset(W, H, 0, 105, W, H); // özneyi kadrajda biraz yukarı al (altyazıya yer)
    this.post = new Post(r, Math.round(W * this.scale), Math.round(H * this.scale), { msaa: ro.msaa ?? 0 });
    this.space = this.tl.environment === 'space';
    if (this.space) {
      this.camera.far = 1200; this.camera.updateProjectionMatrix();
      this.stage = new SpaceStage(r, this.scene, this.camera, this.tl, { scale: this.scale, quality: this.q });
      this.stage.init();
      const pu = this.post.u;
      pu.uDof.value = 0; pu.uBloom.value = 0.8; pu.uBT.value.set(0.9, 0.75, 0.62);
      pu.uVig.value = 0.5; pu.uGrain.value = 0.028; pu.uSat.value = 1.1; pu.uContrast.value = 1.07; pu.uExposure.value = 1.0;
      this.overlay = new Overlay(document.getElementById('ui'), this.tl);
      this.bounds = [];
      for (let i = 0; i < this.segs.length - 1; i++) this.bounds.push(this.segs[i].end);
      this.activeIdx = -1;
      return;
    }
    this.env = new OceanEnv(r, this.scene, { quality: this.q });

    // Özneler
    this.subjects = {};
    for (const [id, s] of Object.entries(this.tl.subjects || {})) {
      if ((s.kind || 'fish') === 'fish') {
        const f = new Fish({ name: id, ...(s.params || {}) }, { quality: this.q });
        f.setVisible(false);
        this.scene.add(f.group);
        this.subjects[id] = f;
      }
    }
    this.overlay = new Overlay(document.getElementById('ui'), this.tl);
    // sınırlar
    this.bounds = [];
    for (let i = 0; i < this.segs.length - 1; i++) this.bounds.push(this.segs[i].end);
    this.activeIdx = -1;
    // shaderları önceden derle
    for (const f of Object.values(this.subjects)) f.setVisible(true);
    r.compile(this.scene, this.camera);
    for (const f of Object.values(this.subjects)) f.setVisible(false);
  }

  segIndexAt(t) {
    let i = 0;
    while (i < this.bounds.length && t >= this.bounds[i]) i++;
    return i;
  }

  // Bir sonraki/önceki sınıra göre geçiş durumu
  transitionState(t) {
    for (let i = 0; i < this.bounds.length; i++) {
      const b = this.bounds[i];
      if (Math.abs(t - b) < TRANS) {
        const next = this.segs[i + 1];
        const list = this.space ? SPACE_TRANSITIONS : TRANSITIONS;
        const style = next.transition || (next.kind === 'outro' ? 'zoom' : list[i % list.length]);
        return { k: (t - b) / TRANS, style, b, idx: i };
      }
    }
    return null;
  }

  cueValue(t, type) {
    let v = 0;
    for (const c of this.tl.cues || []) {
      if (c.type !== type) continue;
      const a = c.attack ?? 0.4, d = c.dur ?? 1.5, rl = c.release ?? 0.7;
      const k = t < c.t ? 0 : t < c.t + a ? (t - c.t) / a : t < c.t + a + d ? 1 : t < c.t + a + d + rl ? 1 - (t - c.t - a - d) / rl : 0;
      v = Math.max(v, k * (c.amount ?? 1));
    }
    return v;
  }

  fitDistance(fish, yaw) {
    const vfov = (this.camera.fov * Math.PI) / 180;
    const tanH = Math.tan(vfov / 2) * (W / H);
    const halfLen = fish.T * 0.56 * (fish.group.scale.x || 1);
    const apparent = halfLen * Math.abs(Math.cos(yaw)) + fish.Hm * 1.2 * Math.abs(Math.sin(yaw)) + 0.08;
    return Math.max(2.0, apparent / (tanH * 0.98));
  }

  frameSpace(t) {
    const segIdx = this.segIndexAt(t);
    const seg = this.segs[segIdx];
    const tr = this.transitionState(t);
    const info = this.stage.frame(t, seg, segIdx, tr, (type) => this.cueValue(t, type));
    const pu = this.post.u;
    pu.uTime.value = t;
    const tk = tr ? Math.pow(1 - Math.abs(tr.k), 1.6) : 0;
    pu.uBlur.value = 0; pu.uZoom.value = 0;
    if (tr) {
      if (tr.style === 'zoom') pu.uZoom.value = 0.26 * tk;
      else if (tr.style === 'rise') { pu.uBlur.value = 0.12 * tk; pu.uBlurDir.value.set(0, 1); }
      else { pu.uBlur.value = 0.14 * tk; pu.uBlurDir.value.set(1, 0.1); }
    }
    const shake = this.cueValue(t, 'shake');
    pu.uFlash.value = Math.max(tr ? 0.14 * Math.pow(tk, 6) : 0, this.cueValue(t, 'flash') * 0.85);
    pu.uCA.value = 0.0018 + 0.012 * tk + shake * 0.01;
    pu.uDream.value = this.cueValue(t, 'dream');
    pu.uFade.value = 0;
    const fl = info.flare || { k: 0 };
    pu.uFlare.value = fl.k || 0;
    if (fl.k) pu.uFlarePos.value.set(fl.x, fl.y);
    pu.uNear.value = this.camera.near; pu.uFar.value = this.camera.far;
    pu.uFocus.value = info.focusDist || 6;
    pu.uBloom.value = info.bloom ?? 0.8;
    this.post.render(this.scene, this.camera);
    this.overlay.update(t, { segment: seg, transOut: 0, anchorScreen: info.anchorScreen || null });
  }

  frame(t) {
    if (this.space) return this.frameSpace(t);
    const segIdx = this.segIndexAt(t);
    const seg = this.segs[segIdx];
    if (segIdx !== this.activeIdx) {
      this.activeIdx = segIdx;
      this.env.setConfig({ seed: seg.id, ...(seg.env || {}), t0: seg.start, dur: seg.end - seg.start });
    }
    const tr = this.transitionState(t);
    const cam = this.camera;
    const travel = this.env.travel(t);
    const ctx = { segment: seg, transOut: 0 };
    for (const f of Object.values(this.subjects)) f.setVisible(false);

    let camPos = new THREE.Vector3(), target = new THREE.Vector3();
    let yawOff = 0, pitchOff = 0, distMul = 1, roll = 0;
    // geçiş kamera ofsetleri
    if (tr) {
      const k = tr.k, out = k < 0, a = out ? ease.inCubic(clamp(1 + k)) : 1 - ease.outCubic(clamp(k));
      // a: 0 → sınırda 1 (çıkışta artar, girişte azalır)
      const sgn = out ? 1 : -1;
      switch (tr.style) {
        case 'whip': yawOff = sgn * a * 1.1; break;
        case 'rise': pitchOff = -sgn * a * 0.9; break;
        case 'zoom': distMul = out ? 1 - 0.65 * a : 1 + 1.2 * a; break;
        case 'spin': yawOff = sgn * a * 1.6; roll = sgn * a * 0.5; break;
      }
    }

    const lt = t - seg.start, D = Math.max(0.5, seg.end - seg.start);
    const shake = this.cueValue(t, 'shake');
    if (seg.kind === 'item' || seg.kind === 'hook') {
      const fish = this.subjects[seg.subject?.ref];
      if (fish) {
        fish.setVisible(true);
        fish.group.scale.setScalar(seg.subject.scale ?? 1);
        const bob = Math.sin(t * 0.9) * 0.05;
        const yawFish = 0.12 * Math.sin(t * 0.35 + segIdx) + (seg.subject.yaw ?? 0);
        fish.group.position.set(travel, bob + (seg.subject.y ?? 0), 0);
        fish.group.rotation.set(0, yawFish, 0.04 * Math.sin(t * 0.7));
        fish.group.rotation.z += (seg.subject.pitch ?? 0);
        fish.update(t, { turn: 0.05 * Math.sin(t * 0.35 + segIdx), swimScale: seg.subject.swimScale ?? 1 });

        const c = seg.camera || {};
        const p = clamp(lt / D);
        const pe = ease.inOutCubic(p);
        const dflt = segIdx % 2 ? { yaw: [-0.15, 0.45], pitch: [0.18, 0.06] } : { yaw: [0.85, 0.3], pitch: [0.05, 0.16] };
        let yaw = lerp((c.yaw || dflt.yaw)[0], (c.yaw || dflt.yaw)[1], pe) + yawOff;
        let pitch = lerp((c.pitch || dflt.pitch)[0], (c.pitch || dflt.pitch)[1], pe) + pitchOff;
        let dk = lerp((c.dist || [1.0, 0.86])[0], (c.dist || [1.0, 0.86])[1], pe) * distMul;
        target.copy(fish.group.position);
        // callout/odak: kamerayı detaya yaklaştır
        const co = seg.callout;
        let focusK = 0;
        if (co && co.anchor) {
          focusK = smoothstep(co.t0 - 0.35, co.t0 + 0.45, t) * (1 - smoothstep(co.t1 - 0.2, co.t1 + 0.5, t)) * (co.zoom ?? 0.6);
          const ap = fish.anchorWorld(co.anchor);
          target.lerp(ap, focusK * 0.75);
          dk *= 1 - 0.38 * focusK;
        }
        if (seg.kind === 'hook') {
          // Açılış: balığın gözüne çok yakın başla, kabarcık patlamasıyla geri çekil
          const dv = ease.outCubic(clamp(lt / 2.4));
          yaw = lerp(1.25, yaw, dv);
          pitch = lerp(0.02, pitch, dv);
          dk *= lerp(0.42, 1, dv);
          const eye = fish.anchorWorld('eye');
          target.lerp(eye, (1 - dv) * 0.8);
          this.env.burstAt(camPos.set(0, 0, 0).add(target).add(new THREE.Vector3(0.6, -0.3, 1.2)), lt * 1.0 + 0.15);
        } else if (tr && !( tr.k < 0)) {
          this.env.burstAt(fish.group.position.clone().add(new THREE.Vector3(-0.4, -0.2, 0.6)), (t - tr.b) * 1.3);
        } else {
          this.env.burstAt(new THREE.Vector3(), -1);
        }
        const dist = this.fitDistance(fish, yaw) * dk;
        this._focusDist = dist;
        camPos.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
        if (seg.kind === 'hook') { camPos.y = Math.max(camPos.y, target.y - 1.5); }
        if (co && co.anchor) ctx.anchorScreen = null;
        cam.position.copy(camPos);
        cam.lookAt(target);
        cam.rotateZ(roll + 0.015 * Math.sin(t * 0.6));
        this._handheld(t, 1 + shake * 6);
        cam.updateMatrixWorld();
        if (co && co.anchor) {
          const ap = fish.anchorWorld(co.anchor).project(cam);
          ctx.anchorScreen = { x: (ap.x * 0.5 + 0.5) * W, y: (1 - (ap.y * 0.5 + 0.5)) * H };
        }
      }
    } else if (seg.kind === 'outro') {
      // Tüm türler bir atlıkarınca halinde
      const fishes = (seg.carousel || Object.keys(this.subjects)).map((id) => this.subjects[id]).filter(Boolean);
      const R = 3.3, n = fishes.length;
      const center = new THREE.Vector3(travel, 0.2, 0);
      fishes.forEach((f, i) => {
        f.setVisible(true);
        const a = (i / n) * Math.PI * 2 + t * 0.22;
        f.group.scale.setScalar(0.62);
        f.group.position.set(center.x + Math.cos(a) * R, center.y + Math.sin(a * 2 + i) * 0.35, Math.sin(a) * R);
        f.group.rotation.set(0, -a - Math.PI / 2 + 0.0, 0);
        f.update(t + i * 0.37, { turn: -0.06 });
      });
      const ca = 0.25 + lt * 0.08 + yawOff;
      const dist = 10.5 * distMul;
      this._focusDist = dist - 1.5;
      camPos.set(Math.sin(ca) * dist, 2.6 + pitchOff * 3, Math.cos(ca) * dist).add(center);
      cam.position.copy(camPos);
      cam.lookAt(center.clone().add(new THREE.Vector3(0, -0.4, 0)));
      cam.rotateZ(roll);
      this._handheld(t, 1);
      this.env.burstAt(new THREE.Vector3(), -1);
    }
    cam.updateMatrixWorld();
    this.env.update(t, cam);

    // Son işlem parametreleri
    const pu = this.post.u;
    pu.uTime.value = t;
    const tk = tr ? Math.pow(1 - Math.abs(tr.k), 1.6) : 0;
    pu.uBlur.value = 0; pu.uZoom.value = 0;
    if (tr) {
      if (tr.style === 'zoom') pu.uZoom.value = 0.22 * tk;
      else if (tr.style === 'rise') { pu.uBlur.value = 0.12 * tk; pu.uBlurDir.value.set(0, 1); }
      else { pu.uBlur.value = 0.14 * tk; pu.uBlurDir.value.set(1, 0.1); }
    }
    const flashCue = this.cueValue(t, 'flash');
    pu.uFlash.value = Math.max(tr ? 0.16 * Math.pow(tk, 6) : 0, flashCue * 0.85);
    pu.uCA.value = 0.0022 + 0.012 * tk + shake * 0.01;
    pu.uDream.value = this.cueValue(t, 'dream');
    pu.uFade.value = 0; // döngüye uygun: siyah açılış/kapanış yok
    // derinlik alanı: odak = özne mesafesi
    pu.uFocus.value = this._focusDist || 6;
    pu.uNear.value = cam.near; pu.uFar.value = cam.far;
    this.post.render(this.scene, cam);
    this.overlay.update(t, ctx);
  }

  _handheld(t, k = 1) {
    const c = this.camera;
    c.rotateX(noise3(t * 0.45, 1.3, 0) * 0.006 * k);
    c.rotateY(noise3(t * 0.4, 7.1, 0) * 0.008 * k);
  }
}

(async () => {
  try {
    const tl = await loadTimeline();
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load('900 84px Montserrat', 'ĞÜŞİÖÇğüşıöç'),
      document.fonts.load('800 36px Montserrat', 'ĞÜŞİÖÇ'),
      document.fonts.load('italic 700 42px Montserrat', 'abc'),
      document.fonts.load('400 200px Anton', '0123456789#'),
    ]);
    const d = new Director(tl);
    await d.init();
    window.__director = d;
    window.renderFrame = (t) => { d.frame(t); return true; };
    window.__ready = true;
  } catch (e) {
    console.error('INIT ERROR', e && e.stack ? e.stack : e);
    window.__initError = String(e && e.stack ? e.stack : e);
  }
})();
