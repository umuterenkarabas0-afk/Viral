// Hikâye modu yönetmeni: timeline.json'daki çekimleri sırayla kurar, karakterleri
// zamana bağlı eylem/ifade/bakış listelerine göre oynatır, kamera ön ayarlarını
// (geniş, boy, bel, yakın, omuz üstü, ikili, insert...) hareketleriyle hesaplar,
// ışık/çevre haritası/sis ve son işlem derecelendirmesini uygular. Render deterministiktir.
import * as THREE from 'three';
import { Post } from '../src/post.js';
import { clamp, lerp, ease, smoothstep, noise3, mulberry32 } from '../src/util.js';
import { SKY, SkyDome, envFor } from './kit.js';
import { Character, randomLook } from './character.js';
import { SET_BUILDERS } from './sets.js';
import { makeHandProp } from './props.js';
import { StoryOverlay } from './overlay.js';

const W = 1080, H = 1920, PI = Math.PI, D2R = PI / 180;
const MOVE_ACTIONS = new Set(['walk', 'run', 'sneak', 'push_cart']);
const SIT_ACTIONS = new Set(['sit', 'sit_talk', 'type', 'headdesk', 'write', 'write_stuck', 'headhands', 'lean']);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function timedAt(list, t, dflt) {
  if (!list || !list.length) return { v: dflt, t0: -10, prev: dflt, pt0: -10 };
  let i = -1;
  for (let k = 0; k < list.length; k++) if (t >= list[k][0] - 1e-6) i = k;
  if (i < 0) return { v: list[0][1], t0: list[0][0] - 10, prev: list[0][1], pt0: -10 };
  return { v: list[i][1], t0: list[i][0], prev: i > 0 ? list[i - 1][1] : list[i][1], pt0: i > 0 ? list[i - 1][0] : list[i][0] - 10 };
}

function pathInfo(pts) {
  const segs = []; let L = 0;
  for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(d); L += d; }
  return { segs, L };
}
function pointOnPath(pts, info, s) {
  let acc = 0;
  for (let i = 0; i < info.segs.length; i++) {
    if (s <= acc + info.segs[i] || i === info.segs.length - 1) {
      const k = clamp((s - acc) / Math.max(1e-6, info.segs[i]));
      const a = pts[i], b = pts[i + 1];
      return { x: lerp(a[0], b[0], k), z: lerp(a[1], b[1], k), dir: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    acc += info.segs[i];
  }
  const a = pts[pts.length - 1]; return { x: a[0], z: a[1], dir: 0 };
}

class Director {
  constructor(tl) { this.tl = tl; this.shots = tl.shots; this.active = -1; }

  async init() {
    const canvas = document.getElementById('gl');
    const ro = window.__RENDER_OPTS__ || {};
    this.scale = ro.scale ?? 0.75;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(this.scale); r.setSize(W, H, false);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(36, W / H, 0.02, 900);
    this.sky = new SkyDome(scene);
    const sun = (this.sun = new THREE.DirectionalLight('#ffffff', 2));
    sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    this.points = [0, 1, 2].map(() => { const p = new THREE.PointLight('#ffffff', 0, 5, 2); scene.add(p); return p; });
    this.fill = new THREE.PointLight('#fff1e0', 0, 0, 2); scene.add(this.fill);
    this.fog = new THREE.FogExp2('#000000', 0); scene.fog = this.fog;
    this.post = new Post(r, Math.round(W * this.scale), Math.round(H * this.scale), { msaa: ro.msaa ?? 0 });

    // mekânlar
    this.sets = {};
    for (const name of new Set(this.shots.map((s) => s.set))) {
      const b = SET_BUILDERS[name];
      if (!b) throw new Error('Bilinmeyen mekân: ' + name);
      const set = b({ renderer: r, timeline: this.tl });
      set.group.visible = false; set.name = name;
      scene.add(set.group);
      this.sets[name] = set;
    }
    // karakterler
    this.chars = {};
    const ids = new Set(); this.shots.forEach((s) => s.cast.forEach((c) => ids.add(c.who)));
    for (const id of ids) {
      const def = this.tl.castDefs[id] || randomLook(7);
      const ch = new Character(id, def);
      ch.root.visible = false; scene.add(ch.root); this.chars[id] = ch;
    }
    const maxExtras = Math.max(0, ...this.shots.map((s) => s.extras || 0));
    this.extras = [];
    for (let i = 0; i < maxExtras; i++) { const ch = new Character('extra' + i, randomLook(1000 + i * 17)); ch.root.visible = false; scene.add(ch.root); this.extras.push(ch); }
    this.handProps = {};
    // ön derleme: tüm görünür iken
    for (const s of Object.values(this.sets)) s.group.visible = true;
    Object.values(this.chars).forEach((c) => (c.root.visible = true));
    this.extras.forEach((c) => (c.root.visible = true));
    for (const sh of this.shots) { const set = this.sets[sh.set]; const lp = this._lightPreset(set, sh); this._env(set, lp); }
    r.compile(scene, this.camera);
    for (const s of Object.values(this.sets)) s.group.visible = false;
    this.overlay = new StoryOverlay(document.getElementById('ui'), this.tl, this);
  }

  _lightPreset(set, shot) {
    return set.light(shot.time) || set.light('day') || set.light('morning') || set.light('night') || { sky: 'day', sun: { pos: V(5, 10, 5), color: '#fff', I: 2.5 } };
  }
  _env(set, lp) {
    const preset = { ...(SKY[lp.sky] || SKY.day), ...(lp.interiorEnv || {}) };
    return envFor(this.renderer, lp.sky + (lp.interiorEnv ? JSON.stringify(lp.interiorEnv) : ''), preset, !!lp.interiorEnv);
  }

  // ---------------------------------------------------------------- çekime giriş
  _enter(shot) {
    const set = this.sets[shot.set];
    for (const s of Object.values(this.sets)) s.group.visible = s === set;
    const lp = (this.lp = this._lightPreset(set, shot));
    const sk = SKY[lp.sky] || SKY.day;
    this.sky.set({ ...sk, name: lp.sky });
    this.sky.mesh.visible = !set.isInsert;
    this.scene.background = set.isInsert ? new THREE.Color(lp.bg || '#1a1410') : null;
    this.scene.environment = this._env(set, lp);
    this.scene.environmentIntensity = lp.envI ?? sk.env ?? 1;
    const [fc, fd] = lp.fog || [sk.fog, sk.fogD];
    this.fog.color.set(fc); this.fog.density = shot.grade === 'sepia' ? fd * 0.6 : fd;
    this.sun.color.set(lp.sun?.color || '#ffffff'); this.sun.intensity = lp.sun?.I ?? 2;
    this.sunOff = (lp.sun?.pos || V(5, 10, 5)).clone();
    const pts = lp.points || [];
    this.points.forEach((p, i) => { const q = pts[i]; if (q) { p.position.copy(q.pos); p.color.set(q.color); p.intensity = q.I; p.distance = q.d; } else p.intensity = 0; });
    const ext = set.shadowExt || 5;
    const sc = this.sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.1; sc.far = 60; sc.updateProjectionMatrix();
    set.onShot && set.onShot(shot, this.tl);
    this.set = set;
    // karakterler
    Object.values(this.chars).forEach((c) => (c.root.visible = false));
    for (const ph of Object.values(this.handProps)) ph.visible = false;
    this.cast = shot.cast.map((c) => {
      const ch = this.chars[c.who];
      ch.root.visible = true;
      ch.setOutfit(c.outfit || ch.def.default);
      const info = c.walk ? pathInfo(c.walk) : null;
      const poseList = c.pose || (c.do && c.do.some(([, a]) => SIT_ACTIONS.has(a)) ? [[shot.start, 'sit']] : null);
      const mf = (this.tl.cues || []).find((q) => q.type === 'mustache_fall' && q.shot === shot.i);
      return { c, ch, info, poseList, mustacheFall: mf ? mf.t : undefined };
    });
    // tabureler (pazar)
    if (set.stools) {
      set.stools.forEach((s) => (s.visible = false));
      let k = 0;
      for (const cc of this.cast) {
        if (cc.poseList && cc.poseList.some(([, p]) => p === 'sit') && k < set.stools.length && !cc.c.y) {
          const s = set.stools[k++]; s.visible = true; s.position.set(cc.c.at[0], 0, cc.c.at[1]);
        }
      }
    }
    this._placeExtras(shot, set);
  }

  _placeExtras(shot, set) {
    this.extras.forEach((e) => (e.root.visible = false));
    const n = Math.min(this.extras.length, shot.extras || 0);
    if (!n || !set.crowd) return;
    const r = mulberry32(1000 + shot.i * 31 + (shot.set.length * 7));
    const [x0, x1, z0, z1] = set.crowd.zone;
    const avoid = [...(set.crowd.avoid || [])];
    for (const cc of this.cast) if (cc.c.at) avoid.push([cc.c.at[0], cc.c.at[1], 1.1]);
    for (const cc of this.cast) if (cc.c.walk) cc.c.walk.forEach(([x, z]) => avoid.push([x, z, 0.9]));
    const placed = [];
    // kamera → hedef koridoru (çekim ortasındaki kamera)
    this._camera(shot, (shot.start + shot.end) / 2);
    const cp = this.camera.position.clone(), lp = this._look.clone();
    const corridor = (x, z) => {
      const ax = cp.x, az = cp.z, bx = lp.x, bz = lp.z; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz || 1;
      const k = clamp(((x - ax) * dx + (z - az) * dz) / L2); const px = ax + dx * k, pz = az + dz * k;
      return Math.hypot(x - px, z - pz) < 0.9 && k < 0.98;
    };
    const seats = set.crowd.seated ? [...set.crowd.seated] : null;
    this.extraState = [];
    for (let i = 0; i < n; i++) {
      const ch = this.extras[i];
      let x, z, face, seated = false;
      if (seats && seats.length) { const s = seats.splice(Math.floor(r() * seats.length), 1)[0]; [x, z, face] = s; seated = true; }
      else {
        let tries = 0;
        do { x = lerp(x0, x1, r()); z = lerp(z0, z1, r()); tries++; }
        while (tries < 60 && (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar) || placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < 0.75) || corridor(x, z)));
        face = r() * PI * 2;
      }
      placed.push([x, z]);
      const walker = !seated && !shot.crowd && r() < 0.35;
      const dir = r() < 0.5 ? 1 : -1;
      ch.root.visible = true;
      this.extraState.push({ ch, x, z, face, seated, walker, dir, speed: 0.9 + r() * 0.4, act: seated ? 'sit' : r() < 0.4 ? 'talk' : 'idle', expr: ['neutral', 'smile', 'bored', 'curious'][Math.floor(r() * 4)], seed: r() * 10 });
    }
  }

  // ---------------------------------------------------------------- yaklaşık çapa (pozdan bağımsız, deterministik)
  _castPos(cc, t, shot) {
    const c = cc.c;
    let x = c.at ? c.at[0] : 0, z = c.at ? c.at[1] : 0, dir = null, moving = false, dist = 0;
    if (c.walk && cc.info) {
      const [t0, t1] = c.walkT;
      const u = clamp((t - t0) / Math.max(0.1, t1 - t0));
      const ue = u < 0.12 ? (u * u) / 0.24 : u > 0.9 ? 1 - ((1 - u) * (1 - u)) / 0.2 * 0.5 - 0.0 : u; // yumuşak kalkış/duruş
      const s = clamp(ue, 0, 1) * cc.info.L;
      const p = pointOnPath(c.walk, cc.info, s);
      x = p.x; z = p.z; dir = p.dir; moving = u < 1 && u > 0; dist = s;
    }
    let y = c.y || 0;
    if (c.onFerry && this.set.ferry) { const f = this.set.ferry.position; x = f.x + (c.at ? c.at[0] : 0); z = f.z + 1.35; y = 1.0; }
    return { x, y, z, dir, moving, dist };
  }
  _faceOf(cc, t, pos) {
    const f = cc.c.face;
    if (typeof f === 'string') {
      if (f === 'cam') return Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
      const o = this.cast.find((k) => k.c.who === f);
      if (o) { const op = this._castPos(o, t); return Math.atan2(op.x - pos.x, op.z - pos.z); }
      return 0;
    }
    return (f || 0) * D2R;
  }
  _poseAt(cc, t) { return cc.poseList ? timedAt(cc.poseList, t, 'stand').v : 'stand'; }
  anchor(who, t, kind = 'head') {
    const cc = this.cast.find((k) => k.c.who === who);
    if (!cc) return null;
    const p = this._castPos(cc, t);
    const pose = this._poseAt(cc, t);
    const Hh = cc.ch.headHeight();
    let hy = Hh;
    if (pose === 'sit') hy -= 0.43 * cc.ch.H; else if (pose === 'crouch') hy -= 0.5 * cc.ch.H;
    if (cc.ch.def.old) hy -= 0.05;
    const face = p.dir !== null && p.moving ? p.dir : this._faceOf(cc, t, p);
    if (pose === 'lying') return V(p.x, p.y + 0.72, p.z - 1.55 * cc.ch.H);
    const fw = V(Math.sin(face), 0, Math.cos(face));
    const base = V(p.x, p.y, p.z);
    if (kind === 'chest') return base.add(V(0, hy - 0.35, 0)).add(fw.multiplyScalar(0.05));
    if (kind === 'hand') return base.add(V(0, hy - 0.45, 0)).add(fw.multiplyScalar(0.32));
    return base.add(V(0, hy, 0)).add(fw.multiplyScalar(0.04));
  }
  faceAngle(who, t) { const cc = this.cast.find((k) => k.c.who === who); if (!cc) return 0; const p = this._castPos(cc, t); return p.dir !== null && p.moving ? p.dir : this._faceOf(cc, t, p); }

  _lookTarget(cc, val, t, pos, face) {
    if (!val || val === 'none') return null;
    const hp = V(pos.x, pos.y + cc.ch.headHeight(), pos.z);
    const fw = V(Math.sin(face), 0, Math.cos(face));
    switch (val) {
      case 'cam': return this._camPosNow ? this._camPosNow.clone() : hp.clone().add(fw.multiplyScalar(3));
      case 'around': return hp.clone().add(fw.clone().multiplyScalar(3));
      case 'up': return hp.clone().add(V(0, 2.2, 0)).add(fw.multiplyScalar(2));
      case 'sky': return hp.clone().add(V(0, 5, 0)).add(fw.multiplyScalar(2));
      case 'floor': return V(pos.x, 0, pos.z).add(fw.multiplyScalar(1.1));
      case 'hand': return V(pos.x, pos.y + cc.ch.headHeight() - 0.5, pos.z).add(fw.multiplyScalar(0.35));
      case 'table': case 'desk': if (!this.set.anchors[val]) return V(pos.x, 0.75, pos.z).add(fw.multiplyScalar(0.5));
    }
    if (this.set.dyn && this.set.dyn[val]) return this.set.dyn[val]();
    if (this.set.anchors[val]) return this.set.anchors[val].clone();
    const o = this.anchor(val, t);
    if (o) return o;
    return hp.clone().add(fw.multiplyScalar(3));
  }

  // ---------------------------------------------------------------- karakter güncelleme
  _updateCast(t, shot) {
    for (const cc of this.cast) {
      const c = cc.c, ch = cc.ch;
      const p = this._castPos(cc, t, shot);
      let act = timedAt(c.do, t, 'idle');
      // yürüyüş bittiyse dur
      let action = act.v, actionT = t - act.t0, prevAction = act.prev, prevT = t - act.pt0, blendStart = act.t0;
      if (MOVE_ACTIONS.has(action) && c.walk && !p.moving && t > c.walkT[1] - 0.05) { prevAction = action; action = 'idle'; actionT = t - c.walkT[1]; blendStart = c.walkT[1]; }
      if (MOVE_ACTIONS.has(action) && !c.walk) action = 'idle';
      const pose = this._poseAt(cc, t);
      const blend = smoothstep(0, 0.28, t - blendStart);
      let face = this._faceOf(cc, t, p);
      if (p.dir !== null && (p.moving || MOVE_ACTIONS.has(action))) {
        const k = c.walk && t > c.walkT[1] - 0.4 && typeof c.face !== 'undefined' && c.face !== 0 ? smoothstep(c.walkT[1] - 0.4, c.walkT[1] + 0.2, t) : 0;
        face = p.dir + Math.atan2(Math.sin(face - p.dir), Math.cos(face - p.dir)) * k;
      } else if (c.walk && cc.info && cc.info.L > 0.1 && (c.face === undefined || c.face === 0)) {
        const last = c.walk[c.walk.length - 1], prev = c.walk[c.walk.length - 2];
        face = Math.atan2(last[0] - prev[0], last[1] - prev[1]);
      }
      const ex = timedAt(c.expr, t, 'neutral');
      const lk = timedAt(c.look, t, null);
      const lookPt = this._lookTarget(cc, lk.v, t, p, face);
      // ağız
      let mouth = 0;
      if (c.talk) for (const [s, e, w0, w1] of c.talk) {
        if (t < s || t > e) continue;
        for (let i = w0; i < w1; i++) {
          const w = this.tl.words[i];
          if (t >= w.s && t <= w.e) { const syl = Math.max(1, (w.text.match(/[aeıioöuüâîûAEIİOÖUÜ]/g) || []).length); mouth = 0.18 + 0.72 * Math.abs(Math.sin(PI * syl * (t - w.s) / Math.max(0.05, w.e - w.s))); break; }
        }
      }
      const stride = action === 'run' ? 2.4 : action === 'sneak' ? 1.0 : 1.35;
      ch.update(t, {
        pos: V(p.x, p.y, p.z), face, action, actionT, prevAction, prevT, blend,
        expr: ex.v, prevExpr: ex.prev, exprBlend: smoothstep(0, 0.22, t - ex.t0),
        look: lookPt, lookAround: lk.v === 'around', lookK: lk.v ? 1 : 0, mouth,
        walkPhase: (p.dist / stride) * PI * 2, speed: p.moving ? 1 : 0, pose, mustacheFall: cc.mustacheFall,
      });
      this._updateHeld(cc, t, action);
    }
  }

  _prop(who, kind, slot) {
    const key = `${who}:${kind}:${slot}`;
    if (!this.handProps[key]) { const p = makeHandProp(kind === 'tea2' ? 'tea' : kind); this.scene.add(p); this.handProps[key] = p; }
    return this.handProps[key];
  }
  _updateHeld(cc, t, action) {
    const c = cc.c, ch = cc.ch;
    for (const ph of Object.values(this.handProps)) if (ph.userData.owner === c.who) ph.visible = false;
    const h1 = timedAt(c.hold, t, null).v, h2 = timedAt(c.hold2, t, null).v;
    const face = ch.root.rotation.y;
    const fw = V(Math.sin(face), 0, Math.cos(face));
    const place = (kind, slot) => {
      if (!kind) return;
      const p = this._prop(c.who, kind, slot); p.userData.owner = c.who; p.visible = true;
      const hand = ch.handPos(slot === 'L' || kind === 'bowl' ? 'L' : 'R');
      p.position.copy(hand); p.rotation.set(0, 0, 0); p.quaternion.identity();
      switch (kind) {
        case 'note': case 'note_twist': case 'photo': {
          if (action === 'show' || action === 'give') { p.lookAt(hand.clone().add(fw)); p.position.add(fw.clone().multiplyScalar(0.03)); }
          else { const eye = ch.eyePos(); p.lookAt(eye); p.position.add(V(0, 0.05, 0)); }
          break;
        }
        case 'tea': case 'tea2': case 'bowl': p.position.add(V(0, 0.01, 0)).add(fw.clone().multiplyScalar(0.02)); p.rotation.y = face; break;
        case 'pen': p.lookAt(hand.clone().add(fw)); break;
        case 'phone': { const eye = ch.eyePos(); p.lookAt(eye); break; }
        case 'umbrella_red': p.position.add(V(0, -0.05, 0)); p.rotation.set(0.05, face, 0.08); break;
        case 'simit2': p.lookAt(hand.clone().add(fw)); p.position.add(fw.clone().multiplyScalar(0.05)); break;
        case 'coat_folded': { const l = ch.handPos('L'); p.position.copy(hand).add(l).multiplyScalar(0.5).add(V(0, 0.04, 0)); p.rotation.set(0, face, 0); break; }
        case 'coat_hanger': p.position.add(V(0, 0.05, 0)); p.rotation.set(0, face + PI / 2, 0); break;
        default: p.rotation.y = face;
      }
    };
    place(h1, 'R');
    if (h1 === 'tea2') place('tea2', 'L');
    if (h2) place(h2, 'L');
  }

  _updateExtras(t, shot) {
    if (!this.extraState) return;
    const crowd = shot.crowd;
    const kerem = this.anchor('kerem', t);
    for (const e of this.extraState) {
      if (!e.ch.root.visible) continue;
      let x = e.x, z = e.z, face = e.face, action = e.act, expr = e.expr, look = null, hold = null;
      if (e.walker) {
        const lt = t - shot.start;
        x = e.x + e.dir * e.speed * (lt - (shot.end - shot.start) / 2) * 0.9; face = e.dir > 0 ? PI / 2 : -PI / 2; action = 'walk';
      }
      if (crowd === 'stare' && kerem) { face = Math.atan2(kerem.x - x, kerem.z - z); look = kerem; action = 'idle'; expr = e.seed > 5 ? 'surprised' : 'annoyed'; }
      if (crowd === 'readnotes') { action = e.seed > 3 ? 'read' : 'laugh'; expr = 'smile'; hold = 'note'; face = Math.atan2(this.camera.position.x - x, this.camera.position.z - z) + (e.seed - 5) * 0.12; }
      const ph = e.walker ? ((t - shot.start) * e.speed / 1.35) * PI * 2 : 0;
      e.ch.update(t, { pos: V(x, 0, z), face, action, actionT: t - shot.start + e.seed, prevAction: action, prevT: 0, blend: 1, expr, prevExpr: expr, exprBlend: 1, look, lookK: look ? 1 : 0, mouth: action === 'talk' ? 0.3 * Math.max(0, Math.sin(t * 9 + e.seed)) : 0, walkPhase: ph, speed: e.walker ? 1 : 0, pose: e.seated ? 'sit' : 'stand' });
      const key = 'extra:' + e.ch.id;
      if (hold) {
        if (!this.handProps[key]) { const p = makeHandProp('note'); this.scene.add(p); this.handProps[key] = p; }
        const p = this.handProps[key]; p.visible = true; p.userData.owner = e.ch.id;
        const hand = e.ch.handPos('R'); p.position.copy(hand).add(V(0, 0.05, 0)); p.lookAt(e.ch.eyePos());
      } else if (this.handProps[key]) this.handProps[key].visible = false;
    }
  }

  // ---------------------------------------------------------------- kamera
  _camera(shot, t) {
    const c = shot.cam || { shot: 'wide' };
    const lt = t - shot.start, Dd = Math.max(0.5, shot.end - shot.start);
    const p = clamp(lt / Dd), e = ease.inOutQuad(p);
    const on = c.on || shot.cast[0]?.who, to = c.to;
    const A = on ? this.anchor(on, t) : V(0, 1.2, 0);
    const Ft = on ? this.faceAngle(on, t) : 0;
    const ang = (c.angle || 0) * D2R;
    let pos, look, fov = c.fov || 34, focusDist = null;
    const orbitPos = (target, dist, az, h) => target.clone().add(V(Math.sin(az) * dist, h, Math.cos(az) * dist));
    switch (c.shot) {
      case 'insert': {
        const f = this.set.focus || V();
        const az = ang;
        look = f.clone().add(V(0, 0, 0.0));
        const dd = c.dist || this.set.insertDist || 0.64;
        pos = look.clone().add(V(Math.sin(az) * dd * 0.42, dd * 0.9, Math.cos(az) * dd * 0.42));
        fov = c.fov || 34;
        break;
      }
      case 'close': look = A.clone().add(V(0, -0.02, 0)); pos = orbitPos(look, c.dist || 1.12, Ft + ang, 0.03); fov = c.fov || 30; break;
      case 'ecu': look = A.clone().add(V(0, 0.0, 0)); pos = orbitPos(look, c.dist || 0.82, Ft + ang, 0.02); fov = c.fov || 28; break;
      case 'medium': look = A.clone().add(V(0, -0.2, 0)); pos = orbitPos(look, c.dist || 1.95, Ft + ang, 0.05); fov = c.fov || 34; break;
      case 'full': look = A.clone().add(V(0, -0.62, 0)); pos = orbitPos(look, c.dist || 3.3, Ft + ang, 0.15); fov = c.fov || 36; break;
      case 'low': look = A.clone().add(V(0, -0.05, 0)); pos = orbitPos(A.clone().setY(0.45), c.dist || 1.5, Ft + ang, 0); fov = c.fov || 42; break;
      case 'high': look = A.clone().add(V(0, -0.25, 0)); pos = orbitPos(A.clone(), c.dist || 1.1, Ft + ang, 1.5); fov = c.fov || 42; break;
      case 'ots': {
        const B = to === 'ferry' ? (this.set.dyn?.ferry?.() || V(0, 2, -4)) : this.anchor(to, t) || A.clone().add(V(0, 0, -2));
        const dir = B.clone().sub(A).setY(0).normalize();
        const right = V().crossVectors(dir, V(0, 1, 0)).normalize();
        pos = A.clone().sub(dir.clone().multiplyScalar(1.45)).add(right.multiplyScalar(0.42 * (c.side || 1))).add(V(0, 0.1, 0));
        look = B.clone().add(V(0, -0.08, 0)).add(right.clone().normalize().multiplyScalar(0.0));
        fov = c.fov || 30;
        break;
      }
      case 'two': {
        const B = this.anchor(to, t) || A.clone().add(V(1, 0, 0));
        const mid = A.clone().add(B).multiplyScalar(0.5);
        const sep = A.distanceTo(B);
        let perp = V(-(B.z - A.z), 0, B.x - A.x).normalize();
        const ref = this.set.wide ? this.set.wide.pos.clone().sub(mid).setY(0) : V(0, 0, 1);
        if (perp.dot(ref) < 0) perp.negate();
        // A tarafına doğru varsayılan 28° bükülme: derinlikte üst üste binen, dikey kadraja sığan ikili
        const toA = A.clone().sub(mid).setY(0);
        const sgn = Math.sign(V().crossVectors(perp, toA).y) || 1;
        const twist = (c.angle !== undefined ? c.angle * D2R : 28 * D2R * sgn);
        const az = Math.atan2(perp.x, perp.z) + twist;
        const hf = Math.tan(((c.fov || 34) * D2R) / 2) * (W / H);
        const proj = sep * Math.abs(Math.cos(twist));
        const dist = c.dist || Math.max(1.6, (proj * 0.5 + 0.42) / hf);
        look = mid.clone().add(V(0, -0.14, 0));
        pos = orbitPos(look, dist, az, 0.1);
        fov = c.fov || 34;
        break;
      }
      case 'custom': pos = V(...c.pos); look = V(...c.look); fov = c.fov || 36; break;
      case 'wide': default: {
        const w = this.set.wide || { pos: V(0, 1.8, 6), look: V(0, 1, 0) };
        pos = w.pos.clone(); look = w.look.clone();
        if (on && A) look.lerp(A.clone().add(V(0, -0.4, 0)), 0.6);
        if (ang) { const off = pos.clone().sub(look); off.applyAxisAngle(V(0, 1, 0), ang); pos = look.clone().add(off); }
        fov = c.fov || 40;
      }
    }
    // hareketler
    const amt = c.amt ?? 0.25;
    switch (c.move) {
      case 'push': pos.lerp(look, amt * e * (c.shot === 'insert' ? 0.5 : 1)); break;
      case 'pull': pos = look.clone().add(pos.clone().sub(look).multiplyScalar(1 + amt * e)); break;
      case 'orbit': { const off = pos.clone().sub(look); off.applyAxisAngle(V(0, 1, 0), (e - 0.5) * amt * 1.8); pos = look.clone().add(off); break; }
      case 'crane': pos.y += (e - 0.3) * amt * 3.0; break;
      case 'track': if (on && c.shot === 'wide') { const w = this.set.wide; const off = w.pos.clone().sub(w.look); pos = A.clone().setY(w.look.y).add(off.multiplyScalar(0.8)); } break;
      case 'pan': break;
    }
    // minimum mesafe (aşırı yakın itmeleri sınırla)
    const MIN = { close: 0.92, ecu: 0.66, medium: 1.5, full: 2.5, low: 1.15 };
    if (MIN[c.shot] && pos.distanceTo(look) < MIN[c.shot]) pos = look.clone().add(pos.clone().sub(look).normalize().multiplyScalar(MIN[c.shot]));
    // kadraj: özneyi altyazının üstüne it
    const dist = pos.distanceTo(look);
    const SHIFT = { close: 0.08, ecu: 0.05, medium: 0.05, full: 0.03, two: 0.06, ots: 0.06, low: 0, high: 0.02 };
    if (SHIFT[c.shot]) { const span = 2 * dist * Math.tan((fov * D2R) / 2); look.y -= span * SHIFT[c.shot]; }
    if (c.shot === 'insert') { look.z += 0.035; }
    focusDist = dist;
    // iç mekân sınırı
    if (this.set.camBox) { const b = this.set.camBox; pos.x = clamp(pos.x, b[0], b[1]); pos.y = clamp(pos.y, b[2], b[3]); pos.z = clamp(pos.z, b[4], b[5]); }
    // geçiş ofsetleri + el kamerası + sarsıntı
    const shake = this._cueEnv(t, 'shake', 0.05, 0.9) + (c.move === 'shake' ? 0.6 : 0);
    const cam = this.camera;
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.position.copy(pos);
    cam.lookAt(look);
    const hk = c.shot === 'insert' ? 0.4 : 1;
    cam.rotateX(noise3(t * 0.45, 1.3, 0) * 0.006 * hk + noise3(t * 9, 3.1, 0) * 0.02 * shake);
    cam.rotateY(noise3(t * 0.4, 7.1, 0) * 0.008 * hk + noise3(t * 8, 5.7, 0) * 0.025 * shake);
    cam.rotateZ(noise3(t * 0.3, 2.2, 0) * 0.004 + noise3(t * 7, 9.1, 0) * 0.012 * shake);
    const wk = this._whip(shot, t);
    if (wk) cam.rotateY(wk * 0.35);
    cam.updateMatrixWorld();
    this._camPosNow = cam.position.clone();
    this._focus = focusDist;
    this._look = look;
  }

  _cueEnv(t, type, a = 0.05, d = 0.8) {
    let v = 0;
    for (const q of this.tl.cues || []) {
      if (q.type !== type) continue;
      const dur = q.dur ?? d;
      if (t < q.t) continue;
      const k = t - q.t;
      v = Math.max(v, k < a ? k / a : k < a + dur ? 1 - (k - a) / dur : 0);
    }
    return v;
  }
  _whip(shot, t) {
    // bu çekimin başı (giriş) veya sonraki çekimin girişi 'whip' ise
    const next = this.shots[shot.i + 1];
    if (shot.cut === 'whip' && t - shot.start < 0.22) return -(1 - (t - shot.start) / 0.22);
    if (next && next.cut === 'whip' && shot.end - t < 0.14) return (1 - (shot.end - t) / 0.14);
    return 0;
  }

  // ---------------------------------------------------------------- kare
  frame(t) {
    let idx = this.shots.findIndex((s) => t >= s.start && t < s.end);
    if (idx < 0) idx = t < this.shots[0].start ? 0 : this.shots.length - 1;
    const shot = this.shots[idx];
    if (idx !== this.active) { this.active = idx; this._enter(shot); }
    this._camPosNow = this._camPrev || null;
    // önce kamera (çapalar pozdan bağımsız), sonra karakterler
    this._camera(shot, t);
    this._updateCast(t, shot);
    this._updateExtras(t, shot);
    this.set.update && this.set.update(t, shot, this);
    // gölge kamerası odağı
    const focus = this._look.clone();
    if (shot.set !== 'insert') focus.y = 0;
    const off = this.sunOff.clone();
    if (!this.set.interior || this.set.isInsert) off.normalize().multiplyScalar(this.set.isInsert ? 3 : 18);
    this.sun.position.copy(focus).add(off);
    this.sun.target.position.copy(focus); this.sun.target.updateMatrixWorld();
    // kamera tarafı yumuşak dolgu (yüzler karanlıkta kalmasın)
    if (shot.set !== 'insert') {
      const cp = this.camera.position, lk = this._look;
      const dir = lk.clone().sub(cp).normalize();
      const side = V().crossVectors(dir, V(0, 1, 0)).normalize();
      this.fill.position.copy(cp).add(side.multiplyScalar(-0.5)).add(V(0, 0.55, 0)).add(dir.multiplyScalar(0.2));
      const dd = Math.max(0.6, cp.distanceTo(lk));
      this.fill.intensity = (this.lp.fillI ?? (this.set.interior ? 1.6 : 0.9)) * dd * dd * (shot.time === 'night' ? 0.6 : 1);
      this.fill.color.set(this.lp.fillC || (shot.time === 'night' ? '#c8d4ff' : '#fff1e0'));
    } else this.fill.intensity = 0;
    // ışık titremesi
    const flick = this._cueEnv(t, 'flicker', 0.02, 1.4);
    const fl = flick > 0 ? (noise3(t * 25, 1, 1) > 0.1 ? 0.25 : 1) : 1;
    this.points.forEach((p, i) => { p.userData.base = p.userData.base ?? p.intensity; });
    this._post(shot, t, fl);
    this.post.render(this.scene, this.camera);
    this.overlay.update(t, shot, this);
    this._camPrev = this.camera.position.clone();
  }

  _post(shot, t, flick = 1) {
    const u = this.post.u, lp = this.lp || {};
    const lt = t - shot.start;
    u.uTime.value = t;
    u.uExposure.value = (lp.exp ?? 1.04) * (flick < 1 ? 0.55 : 1);
    u.uSat.value = lp.sat ?? 1.06; u.uContrast.value = 1.06;
    const tint = lp.tint || [1, 1, 1]; u.uTint.value.setRGB(...tint);
    u.uBloom.value = shot.time === 'night' || shot.time === 'dawn' ? 0.9 : 0.6;
    u.uVig.value = 0.5; u.uGrain.value = 0.03;
    u.uSepia.value = 0; u.uNV.value = 0; u.uLift.value.setRGB(0, 0, 0);
    if (shot.grade === 'sepia') { u.uSepia.value = 1; u.uGrain.value = 0.09; u.uVig.value = 0.95; u.uSat.value = 0.7; u.uLift.value.setRGB(0.06, 0.04, 0.02); }
    if (shot.grade === 'nightvision') { u.uNV.value = 1; u.uGrain.value = 0.12; u.uVig.value = 1.0; u.uExposure.value *= 1.8; }
    // geçişler
    let blur = 0, flash = 0, fade = 0, glitch = 0;
    const next = this.shots[shot.i + 1];
    const wk = this._whip(shot, t);
    if (wk) blur = Math.abs(wk) * 0.16;
    if (shot.cut === 'flash' && lt < 0.3) flash = Math.pow(1 - lt / 0.3, 2);
    if (shot.cut === 'fade' && lt < 0.35) fade = 1 - lt / 0.35;
    if (next && next.cut === 'fade' && shot.end - t < 0.3) fade = 1 - (shot.end - t) / 0.3;
    if (shot.cut === 'glitch' && lt < 0.35) glitch = 1 - lt / 0.35;
    flash = Math.max(flash, this._cueEnv(t, 'flash', 0.02, 0.35) * 0.9);
    glitch = Math.max(glitch, this._cueEnv(t, 'glitch', 0.03, 1.3));
    u.uBlur.value = blur; u.uBlurDir.value.set(1, 0.05); u.uZoom.value = 0;
    u.uFlash.value = flash; u.uGlitch.value = glitch;
    // son kart: kararma
    const cl = this.tl.cliff;
    const endK = cl && cl.t !== undefined ? smoothstep(cl.t - 0.1, cl.t + 0.6, t) : 0;
    u.uFade.value = Math.max(fade, endK * 0.35);
    u.uCA.value = 0.0018 + glitch * 0.01 + blur * 0.05;
    u.uDream.value = 0;
    u.uFocus.value = this._focus || 3; u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    const cs = shot.cam?.shot;
    u.uDof.value = cs === 'insert' ? 1.6 : cs === 'close' || cs === 'ecu' ? 1.1 : cs === 'wide' ? 0.35 : 0.75;
  }

  debug() {
    const sh = this.shots[this.active];
    const f = (v) => v ? [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] : null;
    return { shot: sh.i, set: sh.set, cam: f(this.camera.position), look: f(this._look), fov: this.camera.fov,
      cast: this.cast.map((cc) => ({ who: cc.c.who, root: f(cc.ch.root.position), face: +(cc.ch.root.rotation.y / D2R).toFixed(1), head: f(cc.ch.headPos()), anchor: f(this.anchor(cc.c.who, this.tl.shots[this.active].start + 0.5)) })) };
  }

  // ---------------------------------------------------------------- overlay yardımcıları
  project(v) { const p = v.clone().project(this.camera); if (p.z > 1) return null; return { x: (p.x * 0.5 + 0.5) * W, y: (1 - (p.y * 0.5 + 0.5)) * H }; }
  projectChar(who, dy = 0.25) {
    const ch = this.chars[who];
    if (!ch || !ch.root.visible) return null;
    return this.project(ch.headPos().add(V(0, dy, 0)));
  }
  projectMid(a, b) {
    const A = this.chars[a], B = this.chars[b];
    if (!A || !B || !A.root.visible || !B.root.visible) return null;
    return this.project(A.headPos().add(B.headPos()).multiplyScalar(0.5));
  }
}

async function loadTimeline() {
  if (window.__TIMELINE__) return window.__TIMELINE__;
  const q = new URLSearchParams(location.search);
  const r = await fetch(q.get('timeline') || '/output/timeline.json');
  return r.json();
}

(async () => {
  try {
    const tl = await loadTimeline();
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load('900 84px Montserrat', 'ĞÜŞİÖÇğüşıöç'), document.fonts.load('800 36px Montserrat', 'ĞÜŞİÖÇ'),
      document.fonts.load('400 100px Anton', 'ĞÜŞİÖÇ0123'), document.fonts.load('700 100px Caveat', 'ğüşıöçĞÜŞİÖÇ'),
      document.fonts.load('700 100px Kalam', 'ğüşıöç'), document.fonts.load('700 100px "Amatic SC"', 'ğüşıöçİ'),
      document.fonts.load('700 36px "Courier Prime"', 'ĞÜŞİÖÇ'), document.fonts.load('700 60px "Playfair Display"', 'KADIKÖY'),
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
