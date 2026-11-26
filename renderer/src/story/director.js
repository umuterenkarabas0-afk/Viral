// Hikâye yönetmeni: sahne → set, zaman dilimi, oyuncular, nesneler, kamera hareketi, geçiş ve efektler.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { World } from './world.js';
import { Character } from './character.js';
import { SeaSet, HarborSet, LighthouseInSet, KioskSet, CoffeehouseSet, HomeSet, VoidSet } from './sets.js';
import { DepotSet, ShopSet, FactorySet } from './sets2.js';
import { Post } from '../post.js';
import { StoryOverlay } from './overlay.js';
import { clamp, lerp, ease, noise3, smoothstep, hashString, mulberry32 } from '../util.js';

const W = 1080, H = 1920;
const TRANS = 0.3;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class StoryDirector {
  constructor(tl) {
    this.tl = tl;
    this.segs = tl.segments;
  }

  async init() {
    const canvas = document.getElementById('gl');
    const ro = window.__RENDER_OPTS__ || {};
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    this.scale = ro.scale ?? 0.75;
    r.setPixelRatio(this.scale); r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, W / H, 0.03, 3000);
    this.camera.setViewOffset(W, H, 0, 70, W, H);
    this.world = new World(r, this.scene);
    this.post = new Post(r, Math.round(W * this.scale), Math.round(H * this.scale), { msaa: ro.msaa ?? 0 });

    // oyuncular
    const cast = this.tl.cast || {};
    this.cast = {};
    let seed = 1;
    for (const [id, p] of Object.entries(cast)) { const c = new Character(p, seed++); c.group.visible = false; this.scene.add(c.group); this.cast[id] = c; }
    const mkExtra = (p, s) => new Character({ skin: '#c9926e', pants: '#2c2f36', boots: '#1a1a1a', ...p }, s);

    // setler
    this.sets = {
      sea: new SeaSet(this.world), harbor: new HarborSet(this.world, mkExtra, { boatName: this.tl.world?.boat }), lighthouse_in: new LighthouseInSet(),
      kiosk: new KioskSet(), coffeehouse: new CoffeehouseSet(mkExtra), home: new HomeSet(), void: new VoidSet(),
      depot: new DepotSet(), shop: new ShopSet(), factory: new FactorySet(),
    };
    // el feneri (depoda Selim ve adamları)
    this.flashlights = [];
    for (const s of Object.values(this.sets)) this.scene.add(s.group);

    // ortam haritaları (cam/metal yansımaları için)
    const pm = new THREE.PMREMGenerator(r);
    this.envRoom = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.envSky = {};
    const skyScene = new THREE.Scene();
    const skyClone = new THREE.Mesh(this.world.sky.geometry, this.world.sky.material);
    skyScene.add(skyClone);
    const used = new Set(this.segs.map((s) => s.time || 'dawn'));
    for (const tn of used) { this.world.setTime(tn); this.envSky[tn] = pm.fromScene(skyScene, 0, 1, 2000).texture; }
    pm.dispose();

    this.overlay = new StoryOverlay(document.getElementById('ui'), this.tl);
    this.bounds = this.segs.slice(0, -1).map((s) => s.end);
    this.active = -1;
    // shader ön derleme
    for (const s of Object.values(this.sets)) s.group.visible = true;
    for (const c of Object.values(this.cast)) c.group.visible = true;
    r.compile(this.scene, this.camera);
    for (const s of Object.values(this.sets)) s.group.visible = false;
    for (const c of Object.values(this.cast)) c.group.visible = false;
  }

  _phoneLit(seg, t) {
    let v = seg.phone_lit ?? 0;
    for (const g of seg.gfx || []) if ((g.type === 'notify' || g.type === 'chat' || g.type === 'live') && t >= g.t0 - 0.05 && t <= g.t1) v = Math.max(v, 0.35 + 0.65 * Math.exp(-(t - g.t0) * 1.5));
    return v;
  }

  segIndexAt(t) { let i = 0; while (i < this.bounds.length && t >= this.bounds[i]) i++; return i; }

  transitionState(t) {
    for (let i = 0; i < this.bounds.length; i++) {
      const b = this.bounds[i];
      if (Math.abs(t - b) < TRANS) {
        const next = this.segs[i + 1];
        const style = next.transition || (next.set === 'void' || this.segs[i].set === 'void' ? 'zoom' : next.mood === 'cliff' ? 'zoom' : ['whip', 'rise', 'whip', 'spin'][i % 4]);
        return { k: (t - b) / TRANS, style, b, idx: i };
      }
    }
    return null;
  }

  cueValue(t, type) {
    let v = 0;
    for (const c of this.tl.cues || []) {
      if (c.type !== type) continue;
      const a = c.attack ?? 0.06, d = c.dur ?? 0.4, rl = c.release ?? 0.35;
      const k = t < c.t ? 0 : t < c.t + a ? (t - c.t) / a : t < c.t + a + d ? 1 : t < c.t + a + d + rl ? 1 - (t - c.t - a - d) / rl : 0;
      v = Math.max(v, k * (c.amount ?? 1));
    }
    return v;
  }

  heartbeat(t) {
    let v = 0;
    for (const c of this.tl.cues || []) {
      if (c.type !== 'heartbeat' || t < c.t || t > c.t + (c.dur ?? 2)) continue;
      const lt = t - c.t, per = 0.82, ph = lt % per;
      v = Math.max(v, Math.exp(-ph * 14) + 0.6 * Math.exp(-Math.max(0, ph - 0.22) * 14) * (ph > 0.22 ? 1 : 0));
    }
    return v;
  }

  knock(t) {
    let v = 0;
    for (const c of this.tl.cues || []) {
      if (c.type !== 'knock') continue;
      for (let k = 0; k < 3; k++) { const d = t - (c.t + k * 0.32); if (d >= 0 && d < 0.2) v = Math.max(v, Math.exp(-d * 25)); }
    }
    return v;
  }

  // Sahneye geçiş: set, zaman, oyuncular, nesneler
  _enter(seg) {
    let setName = seg.set || 'sea';
    const target = seg.shot?.target || 'boat';
    if (setName === 'deck') setName = 'sea';
    if (setName === 'black') setName = 'void';
    if (setName === 'lighthouse') setName = target === 'lighthouse' ? 'sea' : 'lighthouse_in';
    for (const s of Object.values(this.sets)) s.group.visible = false;
    const set = (this.set = this.sets[setName]);
    set.group.visible = true;
    const time = seg.time || 'dawn';
    this.world.setTime(time);
    this.world.setExterior(set.exterior, set.sea);
    this.scene.environment = set.exterior ? this.envSky[time] : this.envRoom;
    this.scene.background = set.exterior ? null : new THREE.Color('#000000');
    if (!set.exterior) {
      this.world.sun.intensity = 0; this.world.rim.intensity = 0;
      this.world.hemi.intensity = setName === 'void' ? 0.5 : 0.35;
      this.scene.fog.density = setName === 'void' ? 0.02 : 0.015; this.scene.fog.color.set(setName === 'void' ? '#030b14' : '#1a120c');
    }
    const props = [...(seg.props || [])];
    if (seg.set === 'lighthouse' && target === 'lighthouse') props.push('lighthouse_far', 'lighthouse_on');
    set.showProps(props);
    // oyuncular
    for (const c of Object.values(this.cast)) { c.group.visible = false; }
    set.actors = {};
    const actors = seg.actors || {};
    const used = new Set();
    for (const [id, a] of Object.entries(actors)) {
      const c = this.cast[id]; if (!c) continue;
      const spot = this._spotFor(setName, id, a.pose, seg, used, a.spot);
      if (!spot) continue;
      used.add(spot);
      spot.add(c.group); c.group.position.set(...(a.offset || [0, 0, 0])); c.group.rotation.set(0, a.turn || 0, 0);
      c.group.visible = true; c.pose = a.pose || 'stand';
      c.setLook({ hood: a.hood, phone: !!a.phone, screen: a.screen ?? 0.9 });
      c.holdsWatch = a.holds === 'watch';
      c.walk = a.walk || null;
      if (a.light === 'flashlight') this._flashlight(c);
      set.actors[id] = c;
    }
    for (const f of this.flashlights) f.visible = Object.values(set.actors || {}).some((c) => c.flash === f);
    if (set.setLights) set.setLights(seg.lights || 'on');
    // tekne setinde: çekim kupon/not ise kâğıt açılır; şişe güvertede mi ağda mı
    if (setName === 'sea') {
      const sea = this.sets.sea;
      sea.coupon.group.rotation.y = 0;
      const back = (seg.props || []).includes('coupon_back');
      sea.coupon.group.rotation.set(back ? Math.PI / 2 : -Math.PI / 2, 0, 0);
    }
    this.seg = seg;
  }

  _flashlight(c) {
    if (c.flash) { c.flash.visible = true; return; }
    const sl = new THREE.SpotLight('#fff4dc', 18, 14, 0.32, 0.45, 1.4);
    sl.position.set(0, -0.08, 0.05); c.j.wrR.add(sl); c.j.wrR.add(sl.target); sl.target.position.set(0, -0.6, 2.5);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3d8', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.geometry.translate(0, -3, 0); beam.rotation.x = -Math.PI / 2 - 0.25; beam.position.set(0, -0.08, 0.05); sl.add(beam);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 10), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.4 })); torch.rotation.x = Math.PI / 2; torch.position.set(0, -0.08, 0.03); sl.add(torch);
    c.flash = sl; this.flashlights.push(sl);
  }

  _spotFor(setName, id, pose, seg, used, want) {
    const s = this.sets[setName].spots;
    const pick = (...names) => names.map((n) => s[n]).find((o) => o && !used.has(o));
    if (want && s[want]) return s[want];
    if (s[id] && !used.has(s[id])) return s[id];
    switch (setName) {
      case 'sea':
        if (pose === 'haul') return pick('haul', 'deck');
        if (pose === 'kneel') return pick('kneel', 'deck');
        return pick('deck', 'bow');
      case 'harbor': return pick(pose === 'walk' ? 'pier' : 'pier2', 'pier', 'edge');
      case 'kiosk': return pick(id === 'nuri' ? 'nuri' : 'riza', 'riza');
      case 'coffeehouse': return pick(pose === 'sit' ? 'riza' : 'rizaStand', 'rizaStand');
      case 'home':
        if (id === 'stranger') return pick('stranger');
        return pick(pose === 'sit' ? 'riza' : 'rizaStand', 'rizaStand');
      case 'lighthouse_in':
        if (id === 'ilyas') return pick(pose === 'sit' ? 'ilyasSit' : 'ilyas');
        return pick('riza');
      default: return null;
    }
  }

  _anchor(name) {
    const set = this.set;
    if (name && name.includes('.')) {
      const [who, part] = name.split('.');
      const c = set.actors?.[who];
      if (c) return { pos: () => c.anchor(part), frame: { face: 0.55, head: 0.7, hands: 0.75, handR: 0.5, handL: 0.5, chest: 1.6 }[part] || 1.2, yaw0: null, actor: c };
    }
    if (set.actors?.[name]) { const c = set.actors[name]; return { pos: () => c.anchor('chest'), frame: 2.3, yaw0: null, actor: c }; }
    if (name === 'face' && set.actors) { const c = Object.values(set.actors)[0]; if (c) return { pos: () => c.anchor('face'), frame: 0.55, yaw0: null, actor: c }; }
    let a = set.anchor(name);
    if (!a && set.actors && set.actors[name]) a = { pos: () => set.actors[name].anchor('chest'), frame: 2.4, yaw0: null };
    if (!a) a = set.anchor(Object.keys(set.anchors)[0]);
    return a;
  }

  frame(t) {
    const idx = this.segIndexAt(t);
    const seg = this.segs[idx];
    if (idx !== this.active) { this.active = idx; this._enter(seg); }
    const set = this.set;
    const lt = t - seg.start, D = Math.max(0.5, seg.end - seg.start);
    const tr = this.transitionState(t);

    // TV / kahvehane verisi (skor gfx'inden)
    const score = (seg.gfx || []).filter((g) => g.type === 'score' && t >= g.t0).pop();
    const tvState = score ? { home: score.home, away: score.away, a: score.a, b: score.b, minute: score.minute, goal: (seg.gfx || []).some((g) => g.type === 'score' && g.b > 0 && t >= g.t0) && seg.id === 'goal' ? clamp((t - score.t0) / 0.3) * (1 - smoothstep(score.t0 + 2.5, score.t0 + 3, t)) : 0 } : {};

    // oyuncular
    for (const c of Object.values(set.actors || {})) c.update(t, c.pose, lt);
    // şimşek (fırtına): deterministik çakmalar + flash cue
    let light = 0;
    if ((seg.time || '') === 'storm') {
      const k = Math.floor(t / 1.7), r = mulberry32(k * 7 + 3)();
      const ph = t - k * 1.7 - r * 1.0;
      if (r > 0.55 && ph > 0 && ph < 0.25) light = Math.exp(-ph * 18) * (0.6 + 0.4 * Math.sin(ph * 90));
      light = Math.max(light, this.cueValue(t, 'flash'));
    }
    this.world.lightning = light;
    const phoneLit = this._phoneLit(seg, t);
    set.update(t, this.world, { tv: tvState, lt, phoneLit, lights: seg.lights, door: seg.door, porch: seg.porch });
    // oyuncuların telefon ekranı bildirim anında parlar
    for (const c of Object.values(set.actors || {})) if (c.phone.visible) c.phoneLight.intensity = 0.5 + 1.2 * phoneLit;
    // yürüyen oyuncular
    for (const c of Object.values(set.actors || {})) if (c.walk) { const [dx, dz] = c.walk; c.group.position.set(dx * lt, 0, dz * lt); }

    // kâğıt açılması
    if (set === this.sets.sea) {
      const sea = this.sets.sea;
      const unroll = (seg.props || []).includes('coupon_unroll') ? ease.outCubic(clamp((lt - 0.2) / 1.3)) : 1;
      sea.coupon.set(unroll);
      // eldeki kupon
      const holder = Object.values(set.actors || {})[0];
      const hc = sea.handCoupon;
      hc.visible = !!holder && holder.pose === 'hold' && !(seg.props || []).includes('coupon_unroll');
      if (hc.visible) { const p = holder.anchor('hands'); sea.group.worldToLocal(p); hc.position.copy(p).add(V(0, 0.05, 0)); hc.lookAt(sea.group.localToWorld(holder.anchor('face').clone())); hc.rotateX(-0.4); }
    }
    if (set === this.sets.harbor) {
      const holder = set.actors?.riza; const hc = set.handCoupon;
      hc.visible = !!holder && (seg.props || []).includes('coupon_hand');
      if (hc.visible) { const p = holder.anchor('handR'); set.group.worldToLocal(p); hc.position.copy(p); hc.rotation.set(-0.3, holder.group.parent.rotation.y, 0.2); }
      // yürüme: oyuncu iskelede ilerler
      if (holder && holder.pose === 'walk') holder.group.position.z = lt * 0.9 - 1;
    }

    // ---------------- kamera
    const shot = seg.shot || {};
    const A = this._anchor(shot.target || 'boat');
    const target = A.pos();
    const from = { yaw: 0.4, pitch: 0.15, dist: 1.0, ...(shot.from || {}) };
    const to = { yaw: from.yaw, pitch: from.pitch, dist: from.dist, ...(shot.to || {}) };
    const e = { establish: ease.outCubic, push: ease.inOutCubic, pull: ease.inOutCubic, orbit: (x) => x, closeup: ease.outQuart, low: ease.inOutQuad, over: ease.inOutQuad, track: (x) => x }[shot.type] || ease.inOutCubic;
    const p = e(clamp(lt / D));
    let yaw = lerp(from.yaw, to.yaw, p), pitch = lerp(from.pitch, to.pitch, p), dist = lerp(from.dist, to.dist, p) * A.frame;
    // eksen: hedefin ön yönü
    let base = A.yaw0;
    if (base == null) {
      const who = Object.values(set.actors || {}).find((c) => (shot.target === 'face' || shot.target === 'riza' || set.actors[shot.target] === c));
      const c = A.actor || set.actors?.[shot.target] || who || Object.values(set.actors || {})[0];
      if (c) { const q = new THREE.Quaternion(); c.group.getWorldQuaternion(q); const f = V(0, 0, 1).applyQuaternion(q); base = Math.atan2(f.x, f.z); } else base = 0;
    } else if (set === this.sets.sea && ['boat', 'net', 'bottle', 'coupon', 'note'].includes(shot.target)) {
      base += this.sets.sea.boat.rotation.y;
    }
    // kâğıt çekimleri: kamera sayfanın alt kenarı tarafından bakar, yazı ekranda dik durur
    let paperUp = null;
    if (A.paperUp) { paperUp = A.paperUp(); base = Math.atan2(-paperUp.x, -paperUp.z); }
    // geçiş ofsetleri
    let roll = 0, distMul = 1;
    if (tr) {
      const k = tr.k, out = k < 0, a = out ? ease.inCubic(clamp(1 + k)) : 1 - ease.outCubic(clamp(k));
      const sgn = out ? 1 : -1;
      switch (tr.style) {
        case 'whip': yaw += sgn * a * 0.9; break;
        case 'rise': pitch -= sgn * a * 0.35; break;
        case 'zoom': distMul = out ? 1 - 0.6 * a : 1 + 1.0 * a; break;
        case 'spin': yaw += sgn * a * 1.2; roll = sgn * a * 0.45; break;
      }
    }
    // kalp atışı: hafif ileri itme
    const hb = this.heartbeat(t);
    distMul *= 1 - hb * 0.035;
    dist *= distMul;
    const Y = base + yaw;
    const cam = this.camera;
    const pc = Math.min(pitch, 1.45);
    cam.position.set(Math.sin(Y) * Math.cos(pc), Math.sin(pc), Math.cos(Y) * Math.cos(pc)).multiplyScalar(dist).add(target);
    // dış sahnede kamera denizin altına girmesin
    if (set.exterior) cam.position.y = Math.max(cam.position.y, this.world.heightAt(cam.position.x, cam.position.z, t) + 0.35);
    if (paperUp) cam.up.copy(paperUp); else cam.up.set(0, 1, 0);
    if (shot.type === 'pov' && shot.eye) {
      const E = this._anchor(shot.eye); cam.position.copy(E.pos()); cam.up.set(0, 1, 0);
      const tgt = target.clone(); tgt.y += (shot.tilt || 0);
      cam.lookAt(tgt);
      cam.fov = lerp(shot.fov?.[0] ?? 70, shot.fov?.[1] ?? 55, p); cam.updateProjectionMatrix();
    } else if (A.fixedCam || shot.type === 'cctv') {
      const E = this._anchor(shot.eye || 'cctv'); cam.position.copy(E.pos()); cam.up.set(0, 1, 0); cam.lookAt(target);
      cam.fov = lerp(shot.fov?.[0] ?? 62, shot.fov?.[1] ?? 40, p); cam.updateProjectionMatrix();
    } else {
      if (cam.fov !== 48) { cam.fov = 48; cam.updateProjectionMatrix(); }
      cam.lookAt(target);
    }
    cam.rotateZ(roll + 0.01 * Math.sin(t * 0.5));
    const shake = Math.max(this.cueValue(t, 'shake'), this.knock(t) * 0.5) + (seg.time === 'storm' && set.exterior ? 0.25 : 0);
    const hk = 1 + shake * 8;
    cam.rotateX(noise3(t * 0.5, 1.3, 0) * 0.006 * hk + (shake > 0 ? noise3(t * 30, 2, 0) * 0.01 * shake : 0));
    cam.rotateY(noise3(t * 0.45, 7.1, 0) * 0.008 * hk + (shake > 0 ? noise3(t * 28, 5, 0) * 0.012 * shake : 0));
    cam.updateMatrixWorld();
    this.world.update(t, cam, target);

    // ---------------- son işlem
    const pu = this.post.u;
    const g = this.world.preset.grade;
    const interior = !set.exterior && set !== this.sets.void;
    pu.uTime.value = t;
    pu.uTint.value.setRGB(...(interior ? [1.06, 0.98, 0.9] : g.tint));
    pu.uSat.value = interior ? 1.05 : g.sat; pu.uExposure.value = interior ? 1.15 : g.exp; pu.uContrast.value = interior ? 1.08 : g.contrast;
    const tk = tr ? Math.pow(1 - Math.abs(tr.k), 1.6) : 0;
    pu.uBlur.value = 0; pu.uZoom.value = 0;
    if (tr) {
      if (tr.style === 'zoom') pu.uZoom.value = 0.24 * tk;
      else if (tr.style === 'rise') { pu.uBlur.value = 0.12 * tk; pu.uBlurDir.value.set(0, 1); }
      else { pu.uBlur.value = 0.15 * tk; pu.uBlurDir.value.set(1, 0.08); }
    }
    pu.uFlash.value = Math.max(tr ? 0.12 * Math.pow(tk, 6) : 0, this.cueValue(t, 'flash') * 0.55, light * 0.25);
    pu.uCA.value = 0.0018 + 0.012 * tk + shake * 0.008 + hb * 0.003;
    pu.uVig.value = 0.55 + hb * 0.25 + (seg.mood === 'cliff' ? 0.1 : 0);
    pu.uDream.value = 0; pu.uFade.value = 0; pu.uFish.value = 0; pu.uGrain.value = 0.035;
    const flt = seg.filter;
    if (flt === 'cctv') { pu.uSat.value = 0.0; pu.uContrast.value = 1.25; pu.uGrain.value = 0.12; pu.uExposure.value = 1.25; pu.uTint.value.setRGB(0.95, 1.02, 0.98); pu.uFish.value = 0.25; pu.uBloom.value = 0.3; }
    else if (flt === 'flashback') { pu.uSat.value = 0.45; pu.uTint.value.setRGB(1.12, 1.0, 0.82); pu.uGrain.value = 0.07; pu.uVig.value = 0.9; }
    else if (flt === 'peephole') { pu.uFish.value = 1.35; pu.uVig.value = 1.2; pu.uCA.value = 0.006; }
    // ışıklar kapalı: ortam/gök ışığı kısılır, sahneyi ekran/ay/fener ışığı aydınlatır
    const lm = set.exterior ? 'on' : (seg.lights || 'on');
    this.scene.environmentIntensity = lm === 'off' ? 0.06 : lm === 'dim' ? 0.3 : 1;
    if (!set.exterior) { this.world.hemi.intensity = lm === 'off' ? 0.06 : lm === 'dim' ? 0.18 : 0.35; this.world.hemi.color.set(lm === 'off' ? '#4a62a0' : '#ffffff'); }
    pu.uFocus.value = dist; pu.uNear.value = cam.near; pu.uFar.value = cam.far;
    pu.uDof.value = A.frame < 0.2 ? 0.5 : A.frame < 1 ? 1.2 : 0.8;
    pu.uBloom.value = interior ? 0.8 : 0.7;
    this.post.render(this.scene, cam);

    // ---------------- motion graphics
    const anchors = {};
    for (const gx of seg.gfx || []) {
      if (gx.type !== 'label' || !gx.anchor) continue;
      const [who, part] = String(gx.anchor).split('.');
      let wp = null;
      if (set.actors?.[who]) wp = set.actors[who].anchor(part || 'head');
      else { const an = set.anchor(who); if (an) wp = an.pos(); }
      if (!wp) continue;
      const sp = wp.clone().project(cam);
      anchors[gx.anchor] = { x: (sp.x * 0.5 + 0.5) * W, y: (1 - (sp.y * 0.5 + 0.5)) * H, vis: sp.z < 1 };
    }
    this.overlay.update(t, { segment: seg, idx, anchors, heartbeat: hb });
  }
}
