// Setler: deniz/güverte, liman köyü, fener adası (dış + iç), bayi, kahvehane, ev, infografik boşluğu.
// Her set: group, anchors (isim → { pos(), frame, yaw0 }), spots (oyuncu yerleri), props (isim → nesne), update(t).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, noise3, mulberry32, ease } from '../util.js';
import * as P from './props.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Düz bir kâğıdın (yerel +Y = yazının üstü) dünya uzayındaki "yukarı" yönü
function paperUp(obj) { const q = new THREE.Quaternion(); obj.getWorldQuaternion(q); return V(0, 1, 0).applyQuaternion(q).normalize(); }

class BaseSet {
  constructor(name, origin, { exterior = true, sea = exterior } = {}) {
    this.name = name;
    this.group = new THREE.Group();
    this.group.position.copy(origin);
    this.exterior = exterior; this.sea = sea;
    this.anchors = {}; this.spots = {}; this.props = {};
    this.group.visible = false;
  }
  anchor(name) { return this.anchors[name] || null; }
  showProps(list) {
    const want = new Set(list || []);
    const on = new Map();  // aynı nesne birden çok isimle kayıtlı olabilir (ör. kupon/not tahtası)
    for (const [k, o] of Object.entries(this.props)) { if (o && o.isObject3D) on.set(o, (on.get(o) || false) || want.has(k) || o.userData.always === true); }
    for (const [o, v] of on) o.visible = v;
    this.active = want;
  }
  has(p) { return this.active && this.active.has(p); }
  update() {}
}

// ------------------------------------------------------------------ DENİZ / GÜVERTE
export class SeaSet extends BaseSet {
  constructor(world) {
    super('sea', V(0, 0, 0));
    this.world = world;
    const boat = (this.boat = P.makeBoat());
    this.group.add(boat);
    this.props.boat = boat; boat.userData.always = true;
    const ud = boat.userData;
    const L = ud.L;
    const zAt = (u) => (u - 0.5) * L;
    // oyuncu yerleri (tekneye bağlı)
    const mkSpot = (x, u, ry) => { const o = new THREE.Object3D(); o.position.set(x, ud.deckY(u), zAt(u)); o.rotation.y = ry; boat.add(o); return o; };
    this.spots.haul = mkSpot(0.62, 0.55, Math.PI / 2);
    this.spots.deck = mkSpot(0.05, 0.52, Math.PI / 2 + 0.5);
    this.spots.kneel = mkSpot(-0.38, 0.46, Math.PI / 2 - 0.15);
    this.spots.bow = mkSpot(0.0, 0.7, 0.4);
    // ağ (iskele tarafından suya)
    const net = (this.net = P.makeHaulNet());
    boat.add(net);
    this.props.net = net;
    this.netBase = V(ud.half(0.55) + 0.05, ud.sheer(0.55), zAt(0.55) + 0.2);
    // ağdaki şişe
    const bin = (this.bottleNet = P.makeBottle());
    net.add(bin);
    this.props.bottle_in_net = bin;
    // güverte üstü: ağ yığını, balık kasası, şişe
    const pile = P.makeNetPile(); pile.position.set(-0.45, ud.deckY(0.36), zAt(0.36)); pile.scale.setScalar(0.9); boat.add(pile); this.props.net_pile = pile;
    const fish = P.makeFishPile(); fish.position.set(0.35, ud.deckY(0.46) + 0.06, zAt(0.46) - 0.1); boat.add(fish); this.props.fish_pile = fish;
    const bottle = (this.bottle = P.makeBottle()); bottle.position.set(0.12, ud.deckY(0.45) + 0.085, zAt(0.45) + 0.18); bottle.rotation.set(0, 0.5, Math.PI / 2 - 0.12);
    boat.add(bottle); this.props.bottle = bottle;
    // kupon (güverte tahtası üstünde, yukarı bakar)
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5), P.M('#ffffff', 0.8, 0, { map: TX.woodTexture('#6e4a2c', 31, [1, 1]) }));
    board.position.set(0, ud.deckY(0.62) + 0.45, zAt(0.62) + 0.3); boat.add(board);
    this.board = board;
    const cp = (this.coupon = new P.RollPaper(TX.couponTexture(), 0.21, 0.35, TX.noteTexture()));
    cp.group.rotation.x = -Math.PI / 2; cp.group.position.set(0, 0.025, 0); board.add(cp.group);
    this.props.coupon_unroll = board; this.props.coupon_back = board;
    // eldeki küçük kupon
    const hand = (this.handCoupon = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.25), new THREE.MeshStandardMaterial({ map: TX.couponTexture(), side: THREE.DoubleSide, roughness: 0.8 })));
    this.group.add(hand); this.props.coupon_hand = hand;
    // martılar
    this.gulls = [];
    const gg = new THREE.Group(); this.group.add(gg); this.props.gulls = gg;
    for (let i = 0; i < 7; i++) { const g = P.makeGull(); g.scale.setScalar(1.3); gg.add(g); this.gulls.push(g); }
    // uzaktaki fener adası
    const lh = (this.lighthouse = P.makeLighthouse());
    lh.position.set(70, 0, -190); lh.rotation.y = 0.35; this.group.add(lh);
    this.props.lighthouse_far = lh; this.props.lighthouse_on = new THREE.Object3D();
    // denizde süzülen şişe
    const drift = (this.drift = P.makeBottle()); this.group.add(drift); this.props.bottle_drift = drift;

    const self = this;
    this.anchors = {
      boat: { pos: () => boat.localToWorld(V(0, 0.9, 0)), frame: 13, yaw0: Math.PI / 2 },
      riza: { pos: () => self._actorAnchor('riza', 'chest', V(0, 1.4, 0)), frame: 2.6, yaw0: null },
      face: { pos: () => self._actorAnchor('*', 'face', V(0, 1.6, 0)), frame: 0.6, yaw0: null },
      hands: { pos: () => self._actorAnchor('*', 'hands', V(0, 1.2, 0)), frame: 0.8, yaw0: null },
      net: { pos: () => net.localToWorld(V(0, -0.3, 0.15)), frame: 2.4, yaw0: Math.PI / 2 },
      bottle: { pos: () => (bin.visible && !bottle.visible ? bin : bottle).localToWorld(V(0, 0.22, 0)), frame: 0.75, yaw0: Math.PI / 2 },
      coupon: { pos: () => board.localToWorld(V(0, 0.03, 0)), frame: 0.45, yaw0: Math.PI / 2, paperUp: () => paperUp(cp.group) },
      note: { pos: () => board.localToWorld(V(0, 0.03, 0)), frame: 0.45, yaw0: Math.PI / 2, paperUp: () => paperUp(cp.group) },
      lighthouse: { pos: () => lh.localToWorld(V(0, 9, 0)), frame: 32, yaw0: Math.PI / 2 + 0.6 },
      gulls: { pos: () => gg.localToWorld(V(0, 6, 0)), frame: 8, yaw0: 0 },
    };
  }

  _actorAnchor(who, part, fallback) {
    const a = this.actors && (who === '*' ? Object.values(this.actors)[0] : this.actors[who]);
    return a ? a.anchor(part) : this.boat.localToWorld(fallback.clone());
  }

  update(t, scene) {
    const w = this.world, boat = this.boat;
    // tekne dalgalarda salınır
    const h = w.heightAt(0, 0, t), hb = w.heightAt(0, 2.5, t), hs = w.heightAt(0, -2.5, t), hl = w.heightAt(-1, 0, t), hr = w.heightAt(1, 0, t);
    const amp = w.waveAmp;
    boat.position.set(0, h * 0.85 + 0.05, 0);
    boat.rotation.set(Math.atan2(hs - hb, 5) * 0.8 + 0.01 * Math.sin(t * 0.7), 0.0, Math.atan2(hr - hl, 2) * 0.9 - 0.02 * amp);
    // ağ: iskeleden suya doğru kavisli
    if (this.net.visible) {
      const net = this.net; const ud = net.userData;
      net.position.copy(this.netBase); net.rotation.set(0, Math.PI / 2, 0);
      const p = ud.net.geometry.attributes.position.array, b = ud.base;
      for (let i = 0; i < p.length; i += 3) {
        const x = b[i], y = b[i + 1];
        const v = (1.2 - y) / 2.4; // 0 üst → 1 alt
        p[i] = x * (1 - 0.35 * v) + noise3(x * 2, y * 2, t * 0.6) * 0.03;
        p[i + 1] = 0 - v * 1.6 + 0.08 * Math.sin(t * 1.4 + x * 2);
        p[i + 2] = Math.sin(v * Math.PI) * 0.55 + v * 0.65 + noise3(x * 3, y * 3, t * 0.8) * 0.04;
      }
      ud.net.geometry.attributes.position.needsUpdate = true; ud.net.geometry.computeVertexNormals();
      ud.fish.forEach((f, i) => {
        const r = mulberry32(i * 13 + 1); const u = (r() - 0.5) * 0.9, v = 0.35 + r() * 0.55;
        f.position.set(u * (1 - 0.35 * v), -v * 1.6 + 0.05, Math.sin(v * Math.PI) * 0.52 + v * 0.62);
        f.rotation.set(Math.sin(t * 7 + i) * 0.25, Math.PI / 2 + r() * 0.8 + Math.sin(t * 9 + i * 2) * 0.35, Math.PI / 2 * (r() > 0.5 ? 1 : -1) * 0.7);
      });
      this.bottleNet.position.set(0.12, -0.35, 0.42); this.bottleNet.rotation.set(0.5, 0.3 + Math.sin(t) * 0.05, -1.1);
    }
    // martılar
    this.gulls.forEach((g, i) => {
      const a = t * (0.25 + i * 0.03) + i * 0.9, R = 5 + i * 1.3;
      g.position.set(Math.cos(a) * R, 7 + i * 0.6 + Math.sin(t * 0.8 + i) * 0.5, Math.sin(a) * R * 0.8 - 1);
      g.rotation.set(0, -a + (i % 2 ? Math.PI : 0), 0.25);
      if (i % 2) g.rotation.y = -a + Math.PI; else g.rotation.y = -a;
      P.flapGull(g, t, i * 1.3);
    });
    // süzülen şişe
    const dx = 1.8, dz = 4.0;
    this.drift.position.set(dx, w.heightAt(dx, dz, t) - 0.12, dz);
    this.drift.rotation.set(Math.PI / 2 - 0.25 + Math.sin(t * 1.1) * 0.15, t * 0.1, Math.sin(t * 0.9) * 0.2);
    // fener
    const on = this.has('lighthouse_on');
    const lu = this.lighthouse.userData;
    lu.lampM.emissiveIntensity = on ? 6 : 0;
    lu.beamM.opacity = on ? 0.16 : 0;
    lu.glow.material.opacity = on ? 0.9 * (0.75 + 0.25 * Math.sin(t * 9)) : 0;
    lu.beam.rotation.y = t * 1.2;
    w.seaU.uLamp.value.set(...this.lighthouse.localToWorld(V(0, lu.lightY, 0)).toArray(), on ? 1 : 0);
  }
}

// ------------------------------------------------------------------ LİMAN KÖYÜ
export class HarborSet extends BaseSet {
  constructor(world) {
    super('harbor', V(400, 0, 0));
    this.world = world;
    const vil = (this.village = P.makeVillage()); this.group.add(vil); this.props.village = vil; vil.userData.always = true;
    const boat = (this.boat = P.makeBoat({ name: 'İLYAS', stripe: '#2b7a4b' })); boat.position.set(5, 0, -8); boat.rotation.y = 0.05; this.group.add(boat);
    this.props.boat = boat;
    const spot = (x, y, z, ry) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; this.group.add(o); return o; };
    this.spots.pier = spot(0, 1.2, -6, Math.PI);
    this.spots.pier2 = spot(0.8, 1.2, -4.5, Math.PI + 0.5);
    this.spots.edge = spot(0.6, 1.2, 1.5, 0.2);
    this.gulls = [];
    const gg = new THREE.Group(); this.group.add(gg); this.props.gulls = gg;
    for (let i = 0; i < 6; i++) { const g = P.makeGull(); g.scale.setScalar(1.3); gg.add(g); this.gulls.push(g); }
    const hc = (this.handCoupon = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.25), new THREE.MeshStandardMaterial({ map: TX.couponTexture(), side: THREE.DoubleSide })));
    this.group.add(hc); this.props.coupon_hand = hc;
    this.confetti = P.makeConfetti(); this.group.add(this.confetti); this.props.confetti = this.confetti;
    this.lh = P.makeLighthouse(); this.lh.position.set(-40, 0, 150); this.lh.scale.setScalar(0.9); this.group.add(this.lh); this.props.lighthouse_on = new THREE.Object3D();
    const self = this;
    this.anchors = {
      riza: { pos: () => self._a('riza', 'chest', V(0, 2.4, -6)), frame: 2.6, yaw0: null },
      face: { pos: () => self._a('*', 'face', V(0, 2.8, -6)), frame: 0.6, yaw0: null },
      village: { pos: () => self.group.localToWorld(V(0, 8, -50)), frame: 60, yaw0: 0 },
      boat: { pos: () => boat.localToWorld(V(0, 1, 0)), frame: 13, yaw0: Math.PI / 2 },
      lighthouse: { pos: () => self.lh.localToWorld(V(0, 9, 0)), frame: 48, yaw0: Math.PI },
    };
  }
  _a(who, part, fb) { const a = this.actors && (who === '*' ? Object.values(this.actors)[0] : this.actors[who]); return a ? a.anchor(part) : this.group.localToWorld(fb.clone()); }
  update(t) {
    const w = this.world;
    this.boat.position.y = w.heightAt(405, -8, t) * 0.6 + 0.05;
    this.boat.rotation.z = Math.sin(t * 0.8) * 0.03;
    this.gulls.forEach((g, i) => {
      const a = t * (0.2 + i * 0.03) + i, R = 7 + i * 1.5;
      g.position.set(Math.cos(a) * R, 9 + i * 0.7, Math.sin(a) * R - 8); g.rotation.y = -a; P.flapGull(g, t, i);
    });
    const night = w.timeName === 'night' || w.timeName === 'storm' || w.timeName === 'dusk';
    this.village.userData.houseM.emissiveIntensity = night ? 1.4 : 0;
    for (const m of this.village.userData.lamps) m.emissiveIntensity = night ? 3 : 0;
    const on = this.has('lighthouse_on');
    const lu = this.lh.userData;
    lu.lampM.emissiveIntensity = on ? 6 : 0; lu.beamM.opacity = on ? 0.18 : 0; lu.glow.material.opacity = on ? 0.9 : 0; lu.beam.rotation.y = t * 1.2;
    animateConfetti(this.confetti, t, this.group.worldToLocal(this._a('*', 'top', V(0, 3, -6))), 3);
  }
}

function animateConfetti(im, t, c, spread = 2) {
  if (!im.visible) return;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  im.userData.seeds.forEach(([a, b, cc, d], i) => {
    const life = ((t * 0.35 + a) % 1);
    const x = c.x + (b - 0.5) * spread * 2 + Math.sin(t * 2 + i) * 0.2, z = c.z + (cc - 0.5) * spread * 2;
    const y = c.y + 2.2 - life * 4.5;
    e.set(t * (2 + d * 4) + i, t * 3 * b, t * 2.5 * cc); q.setFromEuler(e);
    m4.compose(V(x, y, z), q, V(1.6, 1.6, 1.6)); im.setMatrixAt(i, m4);
  });
  im.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------ FENER ADASI (dış: denizdeki fener, iç: oda)
export class LighthouseInSet extends BaseSet {
  constructor() {
    super('lighthouse_in', V(5000, 0, 0), { exterior: false });
    const stone = TX.canvasTex(512, 512, (g, w, h) => {
      const r = mulberry32(2); g.fillStyle = '#6d665c'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 48) for (let x = (y / 48) % 2 ? -40 : 0; x < w; x += 96) { g.fillStyle = `rgb(${95 + r() * 40},${88 + r() * 35},${78 + r() * 30})`; g.fillRect(x + 3, y + 3, 90, 42); }
    }, { repeat: [6, 2] });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3.2, 40, 1, true), P.M('#ffffff', 0.95, 0, { map: stone, side: THREE.BackSide }));
    wall.position.y = 1.6; this.group.add(wall);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), P.M('#ffffff', 0.9, 0, { map: TX.woodTexture('#5a3e28', 41, [3, 3]) })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.group.add(floor);
    const ceil = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), P.M('#3a332c', 0.9)); ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2; this.group.add(ceil);
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.1), P.M('#ffffff', 0.7, 0, { map: TX.woodTexture('#6b4a30', 8, [1, 1]) })); table.position.set(0, 0.78, -1.0); table.castShadow = table.receiveShadow = true; this.group.add(table);
    for (const [x, z] of [[-0.85, -1.45], [0.85, -1.45], [-0.85, -0.55], [0.85, -0.55]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.07), P.M('#3a2a1e', 0.8)); l.position.set(x, 0.39, z); this.group.add(l); }
    const bf = P.makeBottleField(); bf.position.set(0, 0.81, -1.0); this.group.add(bf); this.props.bottles_many = bf;
    const lamp = (this.lamp = P.makeLamp('#ffb760', 3.5)); lamp.position.set(0.7, 0.81, -0.8); this.group.add(lamp); this.props.lamp = lamp; lamp.userData.always = true;
    const fill = new THREE.PointLight('#6f8fb8', 0.8, 9); fill.position.set(-1.5, 2.6, 1.5); this.group.add(fill);
    // pencere (fırtına ışığı)
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), new THREE.MeshBasicMaterial({ color: '#334a66' })); win.position.set(-2.55, 1.8, 0); win.rotation.y = Math.PI / 2; this.group.add(win);
    this.win = win;
    const spot = (x, y, z, ry) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; this.group.add(o); return o; };
    this.spots.ilyas = spot(0.0, 0, -1.9, 0);
    this.spots.ilyasSit = spot(-0.5, 0.0, -1.95, 0.3);
    const stool = P.makeChair('#4a3020'); stool.position.set(-0.5, 0, -2.05); stool.rotation.y = 0.3; this.group.add(stool);
    this.spots.riza = spot(0.3, 0, 0.9, Math.PI + 0.15);
    const door = P.makeDoor(); door.position.set(0, 0, 2.5); door.rotation.y = Math.PI; this.group.add(door); door.userData.leaf.rotation.y = 1.1;
    const self = this;
    this.anchors = {
      door: { pos: () => self.group.localToWorld(V(0, 1.0, -1.0)), frame: 2.4, yaw0: 0 },
      table: { pos: () => self.group.localToWorld(V(0, 0.9, -1.0)), frame: 1.8, yaw0: 0 },
      ilyas: { pos: () => self._a('ilyas', 'chest', V(0, 1.4, -1.9)), frame: 2.4, yaw0: null },
      riza: { pos: () => self._a('riza', 'chest', V(0, 1.4, 0.9)), frame: 2.4, yaw0: null },
      face: { pos: () => self._a('riza', 'face', V(0, 1.6, 0.9)), frame: 0.6, yaw0: null },
    };
  }
  _a(who, part, fb) { const a = this.actors && this.actors[who]; return a ? a.anchor(part) : this.group.localToWorld(fb.clone()); }
  update(t, world) {
    this.lamp.userData.light.intensity = 3.5 * (0.9 + 0.1 * noise3(t * 6, 1, 1));
    this.win.material.color.setRGB(0.2 + world.lightning * 2, 0.29 + world.lightning * 2, 0.4 + world.lightning * 2);
  }
}

// ------------------------------------------------------------------ BAYİ
export class KioskSet extends BaseSet {
  constructor() {
    super('kiosk', V(2000, 0, 0), { exterior: false });
    const room = P.makeRoom(4.4, 4, 2.8, { wall: '#e9e1cf' }); this.group.add(room);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.6), P.M('#b8282b', 0.5)); counter.position.set(0, 0.5, -0.6); counter.castShadow = counter.receiveShadow = true; this.group.add(counter);
    const ctop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.05, 0.7), P.M('#f4f1ea', 0.3)); ctop.position.set(0, 1.02, -0.6); this.group.add(ctop);
    // raflar ve kutular
    const r = mulberry32(3);
    const cols = ['#ffc93c', '#5ce1e6', '#ff4d5e', '#7bd389', '#ffffff', '#8a6cc4', '#ff8a3d'];
    for (let s = 0; s < 4; s++) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 0.35), P.M('#6b4a30', 0.7)); sh.position.set(0, 0.6 + s * 0.45, -1.8); this.group.add(sh);
      for (let k = 0; k < 16; k++) {
        const h = 0.18 + r() * 0.2, w = 0.12 + r() * 0.08;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), P.M(cols[Math.floor(r() * cols.length)], 0.5)); b.position.set(-1.7 + k * 0.22, 0.62 + s * 0.45 + h / 2, -1.8); this.group.add(b);
      }
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: TX.signTexture('BAYİ', 'ŞANS OYUNLARI · GAZETE'), emissive: new THREE.Color('#ffffff'), emissiveMap: TX.signTexture('BAYİ', 'ŞANS OYUNLARI · GAZETE'), emissiveIntensity: 0.5 }));
    sign.position.set(0, 2.45, -1.97); this.group.add(sign);
    const term = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.28, 0.3), P.M('#222', 0.4, 0.4)); term.position.set(0.8, 1.2, -0.7); term.rotation.x = -0.3; this.group.add(term);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.18), new THREE.MeshBasicMaterial({ color: '#7bd3ff' })); scr.position.set(0.8, 1.23, -0.545); scr.rotation.x = -0.3; this.group.add(scr);
    const cp = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.35), new THREE.MeshStandardMaterial({ map: TX.couponTexture(), roughness: 0.8 }));
    cp.rotation.x = -Math.PI / 2; cp.rotation.z = 0.15; cp.position.set(-0.1, 1.05, -0.45); this.group.add(cp); this.props.coupon_counter = cp; this.props.coupon = cp;
    const l1 = new THREE.PointLight('#fff0d0', 2.2, 8, 1.4); l1.position.set(0, 2.5, 0.5); this.group.add(l1);
    const l2 = new THREE.PointLight('#d0e8ff', 1.0, 8, 1.4); l2.position.set(-1.5, 2.0, 1.5); this.group.add(l2);
    const spot = (x, y, z, ry) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; this.group.add(o); return o; };
    this.spots.nuri = spot(0.2, 0, -1.25, 0);
    this.spots.riza = spot(-0.55, 0, 0.4, Math.PI - 0.35);
    const self = this;
    this.anchors = {
      nuri: { pos: () => self._a('nuri', 'chest', V(0, 1.4, -1.25)), frame: 2.4, yaw0: null },
      riza: { pos: () => self._a('riza', 'chest', V(0, 1.4, 0.35)), frame: 2.4, yaw0: null },
      face: { pos: () => self._a('riza', 'face', V(0, 1.6, 0.35)), frame: 0.6, yaw0: null },
      coupon: { pos: () => cp.localToWorld(V(0, 0, 0)), frame: 0.45, yaw0: 0, paperUp: () => paperUp(cp) },
      kiosk: { pos: () => self.group.localToWorld(V(0, 1.3, -1)), frame: 3.4, yaw0: 0 },
    };
  }
  _a(who, part, fb) { const a = this.actors && this.actors[who]; return a ? a.anchor(part) : this.group.localToWorld(fb.clone()); }
}

// ------------------------------------------------------------------ KAHVEHANE
export class CoffeehouseSet extends BaseSet {
  constructor(makeExtra) {
    super('coffeehouse', V(3000, 0, 0), { exterior: false });
    const wallTex = TX.woodTexture('#7a5233', 3, [6, 2]);
    const room = P.makeRoom(8, 6, 3.1, { wall: '#ffffff', wallTex }); this.group.add(room);
    const tv = (this.tv = P.makeTV()); tv.position.set(0, 2.15, -2.95); this.group.add(tv); this.props.tv = tv; tv.userData.always = true;
    this.tables = [];
    const glasses = [];
    for (const [x, z] of [[-1.6, -0.6], [1.6, -0.6], [0, 0.9], [-2.6, 1.6], [2.6, 1.6], [0, -1.4]]) {
      const t = P.makeTable(0.42); t.position.set(x, 0, z); this.group.add(t); this.tables.push(t);
      for (let k = 0; k < 2; k++) { const gl = P.makeTeaGlass(); gl.position.set(x + (k ? 0.15 : -0.12), 0.77, z + (k ? 0.1 : -0.05)); this.group.add(gl); glasses.push(gl); }
    }
    const tg = new THREE.Group(); glasses.forEach((g) => tg.add(g)); this.group.add(tg); this.props.tea = tg; this.props.tables = new THREE.Object3D();
    // asılı lambalar
    for (const [x, z] of [[-2, 0], [2, 0], [0, 1.8]]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 4), P.M('#111', 0.5)); cord.position.set(x, 2.8, z); this.group.add(cord);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), P.M('#fff', 0.2, 0, { emissive: new THREE.Color('#ffc070'), emissiveIntensity: 4 })); bulb.position.set(x, 2.45, z); this.group.add(bulb);
      const pl = new THREE.PointLight('#ffb760', 1.4, 7, 1.5); pl.position.set(x, 2.4, z); this.group.add(pl);
    }
    // çerçeveler
    for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), P.M(['#2a4a6a', '#6a2a2a', '#2a5a3a'][k], 0.6)); f.position.set(-3.98, 1.9, -1.5 + k * 1.4); f.rotation.y = Math.PI / 2; this.group.add(f); }
    // müşteriler
    this.extras = [];
    const ex = [
      { p: [-1.6, -0.15], ry: Math.PI, c: { sweater: '#5a4a3a', coat: null, cap: '#3a3a3a', hair: '#cfcfcf' } },
      { p: [1.6, -0.15], ry: Math.PI + 0.2, c: { sweater: '#2a4a5a', coat: null, cap: null, hair: '#2a2a2a', mustache: true, beard: false } },
      { p: [-2.6, 2.05], ry: Math.PI - 0.3, c: { sweater: '#6a2a2a', coat: null, cap: '#2a3a2a', hair: '#bbb' } },
      { p: [2.6, 2.05], ry: Math.PI + 0.3, c: { sweater: '#3a5a3a', coat: null, cap: null, hair: '#444', beard: false } },
    ];
    ex.forEach((e, i) => {
      const ch = makeExtra(e.c, 20 + i);
      ch.group.position.set(e.p[0], 0, e.p[1]); ch.group.rotation.y = e.ry; this.group.add(ch.group);
      const chair = P.makeChair(); chair.position.set(e.p[0], 0, e.p[1] + 0.05); chair.rotation.y = e.ry + Math.PI; this.group.add(chair);
      this.extras.push(ch);
    });
    const ch = P.makeChair(); ch.position.set(0, 0, 1.4); ch.rotation.y = 0; this.group.add(ch);
    this.confetti = P.makeConfetti(); this.group.add(this.confetti); this.props.confetti = this.confetti;
    const spot = (x, y, z, ry) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; this.group.add(o); return o; };
    this.spots.riza = spot(0, 0, 1.38, Math.PI);
    this.spots.rizaStand = spot(0.9, 0, 2.1, Math.PI + 0.25);
    const self = this;
    this.anchors = {
      tv: { pos: () => tv.localToWorld(V(0, 0, 0)), frame: 1.6, yaw0: 0 },
      riza: { pos: () => self._a('riza', 'chest', V(0, 1.1, 1.4)), frame: 2.2, yaw0: null },
      face: { pos: () => self._a('riza', 'face', V(0, 1.3, 1.4)), frame: 0.6, yaw0: null },
      room: { pos: () => self.group.localToWorld(V(0, 1.4, 0)), frame: 6, yaw0: Math.PI },
    };
  }
  _a(who, part, fb) { const a = this.actors && this.actors[who]; return a ? a.anchor(part) : this.group.localToWorld(fb.clone()); }
  update(t, world, scene) {
    this.extras.forEach((e, i) => e.update(t, i % 2 ? 'sit' : 'sit'));
    const tvd = scene?.tv || {};
    P; TX.drawTV(this.tv.userData.tex, { ...tvd, t });
    this.tv.userData.glow.intensity = 1.2 + 0.3 * Math.sin(t * 7) + (tvd.goal || 0) * 2;
    animateConfetti(this.confetti, t, this.group.worldToLocal(this._a('riza', 'top', V(0, 2.3, 1.2))), 1.6);
  }
}

// ------------------------------------------------------------------ EV (gece)
export class HomeSet extends BaseSet {
  constructor() {
    super('home', V(4000, 0, 0), { exterior: false });
    const plaster = TX.canvasTex(256, 256, (g, w, h) => { const r = mulberry32(7); g.fillStyle = '#cdbf9f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.06})`; g.fillRect(r() * w, r() * h, 3, 3); } }, { repeat: [3, 2] });
    const room = P.makeRoom(4.6, 4.4, 2.7, { wall: '#ffffff', wallTex: plaster }); this.group.add(room);
    const table = P.makeTable(0.55, 0.76, '#5a3a22'); table.position.set(0, 0, -0.5); this.group.add(table);
    const lamp = (this.lamp = P.makeLamp('#ffbf70', 2.6)); lamp.position.set(0.4, 0.78, -0.88); this.group.add(lamp); this.props.lamp = lamp; lamp.userData.always = true;
    const bottle = P.makeBottle(); bottle.position.set(-0.2, 0.78, -0.7); this.group.add(bottle); this.props.bottle = bottle;
    const cp = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.35), new THREE.MeshStandardMaterial({ map: TX.couponTexture(), roughness: 0.85 }));
    cp.rotation.x = -Math.PI / 2; cp.rotation.z = -0.3; cp.position.set(0.05, 0.785, -0.35); this.group.add(cp); this.props.coupon_table = cp;
    const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.235), new THREE.MeshStandardMaterial({ map: TX.photoTexture(), roughness: 0.6 }));
    ph.rotation.x = -Math.PI / 2; ph.rotation.z = 0.25; ph.position.set(-0.15, 0.786, -0.3); this.group.add(ph); this.props.photo = ph;
    const nb = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.31), new THREE.MeshStandardMaterial({ map: TX.notebookTexture(), roughness: 0.85 }));
    nb.rotation.x = -Math.PI / 2; nb.position.set(-0.05, 0.787, -0.3); this.group.add(nb); this.props.notebook = nb;
    const chair = P.makeChair(); chair.position.set(0, 0, 0.15); chair.rotation.y = Math.PI; this.group.add(chair);
    // pencere
    const wf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 1.0), P.M('#3a2a1e', 0.7)); wf.position.set(-2.28, 1.5, -0.6); this.group.add(wf);
    const glassM = new THREE.MeshBasicMaterial({ color: '#16294a' });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.95), glassM); win.position.set(-2.23, 1.5, -0.6); win.rotation.y = Math.PI / 2; this.group.add(win);
    this.winM = glassM;
    const moon = new THREE.PointLight('#7f9fe0', 1.2, 6, 1.5); moon.position.set(-1.9, 1.7, -0.6); this.group.add(moon);
    // kapı
    const door = (this.door = P.makeDoor()); door.position.set(0.9, 0, 2.18); door.rotation.y = Math.PI; this.group.add(door);
    const outside = new THREE.PointLight('#5f7fc0', 0.0, 4, 1.5); outside.position.set(0.9, 1.6, 3.0); this.group.add(outside); this.outside = outside;
    const spot = (x, y, z, ry) => { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; this.group.add(o); return o; };
    this.spots.riza = spot(0, 0, 0.12, Math.PI);
    this.spots.rizaStand = spot(-0.9, 0, 1.0, 0.7);
    this.spots.stranger = spot(0.9, 0, 1.95, Math.PI);
    const self = this;
    this.anchors = {
      table: { pos: () => self.group.localToWorld(V(0, 0.85, -0.5)), frame: 1.6, yaw0: 0 },
      door: { pos: () => self.group.localToWorld(V(0.9, 1.3, 2.2)), frame: 2.4, yaw0: Math.PI },
      riza: { pos: () => self._a('riza', 'chest', V(0, 1.1, 0.1)), frame: 2.2, yaw0: null },
      face: { pos: () => self._a('riza', 'face', V(0, 1.3, 0.1)), frame: 0.6, yaw0: null },
      stranger: { pos: () => self._a('stranger', 'chest', V(0.9, 1.4, 2.7)), frame: 2.4, yaw0: null },
      bottle: { pos: () => bottle.localToWorld(V(0, 0.25, 0)), frame: 0.75, yaw0: 0.4 },
      photo: { pos: () => ph.localToWorld(V(0, 0, 0)), frame: 0.42, yaw0: 0, paperUp: () => paperUp(ph) },
      notebook: { pos: () => nb.localToWorld(V(0, 0, 0)), frame: 0.65, yaw0: 0, paperUp: () => paperUp(nb) },
    };
  }
  _a(who, part, fb) { const a = this.actors && this.actors[who]; return a ? a.anchor(part) : this.group.localToWorld(fb.clone()); }
  update(t, world) {
    const day = world.timeName === 'day' || world.timeName === 'dawn';
    this.winM.color.set(day ? '#bfe0ff' : '#16294a');
    this.lamp.userData.light.intensity = day ? 1.2 : 2.6;
    const open = this.actors && this.actors.stranger ? 1 : 0;
    this.door.userData.leaf.rotation.y = -1.25 * open;
    this.outside.intensity = open * 1.2;
  }
}

// ------------------------------------------------------------------ İNFOGRAFİK BOŞLUĞU
export class VoidSet extends BaseSet {
  constructor() {
    super('void', V(6000, 0, 0), { exterior: false });
    const bgU = { uTime: { value: 0 }, uA: { value: new THREE.Color('#071a2e') }, uB: { value: new THREE.Color('#010409') } };
    const bg = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
      uniforms: bgU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uA, uB; uniform float uTime; varying vec3 vP;
        void main(){ float k = smoothstep(-0.6, 0.7, vP.y); vec3 c = mix(uA * 1.6, uB, k);
          c += vec3(0.05, 0.12, 0.2) * pow(max(0.0, 1.0 - abs(vP.y + 0.05) * 3.0), 3.0);
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    this.group.add(bg);
    this.dust = P.makeDust(); this.group.add(this.dust);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), P.M('#06121f', 0.25, 0.6)); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.3; floor.receiveShadow = true; this.group.add(floor);
    const key = new THREE.DirectionalLight('#cfe8ff', 2.0); key.position.set(3, 6, 4); this.group.add(key, key.target);
    const rimL = new THREE.PointLight('#5ce1e6', 3, 20, 1.5); rimL.position.set(-4, 2, -3); this.group.add(rimL);
    const rimR = new THREE.PointLight('#ffc93c', 2.5, 20, 1.5); rimR.position.set(4, 1.5, -2); this.group.add(rimR);
    // nesneler
    const grid = (this.grid = P.makeProbabilityGrid()); this.group.add(grid); this.props.probability_grid = grid;
    const money = (this.money = P.makeInstancedPapers(220, TX.banknoteTexture(), 0.34, 0.17, 3)); this.group.add(money); this.props.money_rain = money;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.7, 40), [P.M('#b5884f', 0.9), P.M('#ffffff', 0.9, 0, { map: TX.corkTexture() }), P.M('#b5884f', 0.9)]);
    cork.position.y = 0.6; this.group.add(cork); this.props.cork_seal = cork; this.cork = cork;
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), new THREE.MeshBasicMaterial({ map: TX.fingerprintTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    fp.position.set(0, 1.0, 0); this.group.add(fp); this.props.fingerprint = fp;
    const dc = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.0, 0.9), new THREE.MeshBasicMaterial({ map: TX.depthTexture() })); dc.position.set(0, 1.6, 0); this.group.add(dc); this.props.depth_column = dc;
    const wreck = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.2), P.M('#4a3a2a', 0.9)); wreck.position.set(0.0, -0.1, 0.5); dc.add(wreck);
    const bd = (this.bottle = P.makeBottle()); bd.scale.setScalar(3); this.group.add(bd); this.props.bottle_drift = bd;
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.17), new THREE.MeshStandardMaterial({ map: TX.photoTexture(), roughness: 0.6 })); photo.position.set(0, 1.0, 0); this.group.add(photo); this.props.photo = photo;
    const self = this;
    this.anchors = {
      // ızgara yoksa (para, mantar, şişe, parmak izi…) kamera ortadaki nesneye yakınlaşır
      grid: { pos: () => self.group.localToWorld(V(0, self.grid.visible ? 0.4 : 0.9, 0)), get frame() { return self.grid.visible ? 1.2 : 0.42; }, yaw0: 0 },
      cork: { pos: () => cork.localToWorld(V(0, 0.35, 0)), frame: 1.5, yaw0: 0 },
      photo: { pos: () => photo.localToWorld(V(0, 0, 0)), frame: 1.6, yaw0: 0 },
      bottle: { pos: () => bd.localToWorld(V(0, 0.25, 0)), frame: 2.4, yaw0: 0 },
    };
  }
  update(t) {
    this.dust.rotation.y = t * 0.02;
    const gu = this.grid.userData;
    gu.gold.position.y = 0.06 + 0.04 * Math.sin(t * 3);
    gu.halo.position.copy(gu.gold.position); gu.halo.material.opacity = 0.6 + 0.3 * Math.sin(t * 4);
    this.grid.rotation.y = t * 0.03;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    if (this.money.visible) {
      this.money.userData.seeds.forEach(([a, b, c, d], i) => {
        const life = (t * 0.22 + a) % 1;
        e.set(t * (1 + d * 3) + i, t * 2 * b + i, Math.sin(t * 2 + i) * 0.8); q.setFromEuler(e);
        m4.compose(V((b - 0.5) * 6 + Math.sin(t + i) * 0.3, 3.5 - life * 5, (c - 0.5) * 6), q, V(1, 1, 1)); this.money.setMatrixAt(i, m4);
      });
      this.money.instanceMatrix.needsUpdate = true;
    }
    this.cork.rotation.set(Math.PI / 2 - 0.25, t * 0.25, 0); this.cork.position.y = 0.7;
    this.props.fingerprint.rotation.y = Math.sin(t * 0.6) * 0.25;
    this.props.depth_column.rotation.y = t * 0.2;
    this.bottle.position.set(0, 0.6 + Math.sin(t * 1.2) * 0.1, 0); this.bottle.rotation.set(Math.PI / 2 - 0.3 + Math.sin(t) * 0.1, t * 0.4, 0.2);
    this.props.photo.rotation.set(-0.15, Math.sin(t * 0.5) * 0.2, 0.05);
  }
}
