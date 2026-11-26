// "Kapıyı Açma" setleri: depo (17 numara), telefoncu dükkânı, terk edilmiş buz fabrikası.
import * as THREE from 'three';
import { mulberry32, noise3 } from '../util.js';
import * as P from './props.js';
import * as Q from './props2.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function paperUp(obj) { const q = new THREE.Quaternion(); obj.getWorldQuaternion(q); return V(0, 1, 0).applyQuaternion(q).normalize(); }

class Base {
  constructor(name, origin) {
    this.name = name; this.group = new THREE.Group(); this.group.position.copy(origin); this.group.visible = false;
    this.exterior = false; this.sea = false; this.anchors = {}; this.spots = {}; this.props = {}; this.lamps = [];
  }
  anchor(n) { return this.anchors[n] || null; }
  showProps(list) {
    const want = new Set(list || []); const on = new Map();
    for (const [k, o] of Object.entries(this.props)) if (o && o.isObject3D) on.set(o, (on.get(o) || false) || want.has(k) || o.userData.always === true);
    for (const [o, v] of on) o.visible = v;
    this.active = want;
  }
  has(p) { return this.active && this.active.has(p); }
  spot(name, x, y, z, ry) { const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.y = ry; this.group.add(o); this.spots[name] = o; return o; }
  setLights(mode) { for (const l of this.lamps) l.visible = mode !== 'off'; this.lightMode = mode; }
  update() {}
}

// ------------------------------------------------------------------ DEPO 17
export class DepotSet extends Base {
  constructor() {
    super('depot', V(7000, 0, 0));
    const W = 10, D = 8, H = 4.6;
    const walls = new THREE.MeshStandardMaterial({ map: Q.corrugatedTexture('#4d5862'), roughness: 0.7, metalness: 0.5, side: THREE.BackSide });
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [walls, walls, P.M('#2a2f35', 0.9, 0.3, { side: THREE.BackSide }), new THREE.MeshStandardMaterial({ map: Q.concreteTexture('#6d6a64', [5, 4]), roughness: 0.95, side: THREE.BackSide }), walls, walls]);
    box.position.y = H / 2; box.receiveShadow = true; this.group.add(box);
    // kasalar (balıksız), bidonlar, palet
    const cr1 = Q.makeCrateStack(40, 5, '#2b6cb0'); cr1.position.set(-4.2, 0, -3.4); this.group.add(cr1);
    const cr2 = Q.makeCrateStack(32, 7, '#c75a1a'); cr2.position.set(1.6, 0, 1.0); cr2.rotation.y = 0.3; this.group.add(cr2);
    const cr3 = Q.makeCrateStack(24, 9, '#2b6cb0'); cr3.position.set(-1.3, 0, 1.6); this.group.add(cr3);
    const drums = Q.makeDrumField(70, 3, [5.6, 3]); drums.position.set(1.6, 0, -1.6); this.group.add(drums); this.props.drums = drums; drums.userData.always = true;
    // masa: harita + para
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 1.0), P.M('#ffffff', 0.8, 0, { map: TX.woodTexture('#5a4030', 17, [1, 1]) })); table.position.set(-2.6, 0.82, 0.4); table.castShadow = table.receiveShadow = true; this.group.add(table);
    for (const [x, z] of [[-0.85, -0.45], [0.85, -0.45], [-0.85, 0.45], [0.85, 0.45]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 0.06), P.M('#3a2a1e')); l.position.set(-2.6 + x, 0.41, 0.4 + z); this.group.add(l); }
    const map = Q.makePaper(Q.mapTexture(), 0.84, 0.63); map.rotation.x = -Math.PI / 2; map.rotation.z = 0.08; map.position.set(-2.85, 0.856, 0.42); this.group.add(map); this.props.map = map; map.userData.always = true;
    const money = Q.makeMoneyStacks(); money.position.set(-2.2, 0.85, 0.2); this.group.add(money); this.props.money = money; money.userData.always = true;
    // duvardaki fotoğraf (Deniz, tapu dairesinin önünde)
    const photo = Q.makePaper(Q.deedPhotoTexture(), 0.45, 0.6); photo.position.set(-3.6, 1.65, -3.97); this.group.add(photo); this.props.wallphoto = photo; photo.userData.always = true;
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), P.M('#d8c9a0', 0.9)); tape.position.set(-3.6, 1.96, -3.96); tape.rotation.z = 0.2; this.group.add(tape);
    // kapı (sürgülü) ve zemindeki tahta kapak
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.08), P.M('#3c4650', 0.6, 0.5)); door.position.set(3.4, 1.6, 3.96); this.group.add(door); this.door = door;
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.9), P.M('#ffffff', 0.8, 0, { map: TX.woodTexture('#4a3524', 23, [1, 1]) })); hatch.position.set(-4.4, 0.02, -1.0); this.group.add(hatch); this.hatch = hatch;
    // tavan lambaları (söndürülebilir) + ay ışığı
    for (const [x, z] of [[-2.5, 0], [2.5, 0]]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.25, 16, 1, true), P.M('#1d2328', 0.5, 0.6, { side: THREE.DoubleSide })); shade.position.set(x, 3.9, z); this.group.add(shade);
      const bulbM = P.M('#ffffff', 0.2, 0, { emissive: new THREE.Color('#ffd8a0'), emissiveIntensity: 5 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), bulbM); bulb.position.set(x, 3.8, z); this.group.add(bulb);
      const l = new THREE.PointLight('#ffcf90', 5, 12, 1.4); l.position.set(x, 3.6, z); this.group.add(l);
      this.lamps.push(l, bulb);
    }
    const moon = new THREE.DirectionalLight('#7f9ad0', 0.35); moon.position.set(4, 6, 6); this.group.add(moon, moon.target); moon.target.position.set(0, 0, 0);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), new THREE.MeshBasicMaterial({ color: '#30466e' })); win.position.set(-1, 3.8, 3.98); win.rotation.y = Math.PI; this.group.add(win);
    this.spot('deniz', -1.2, 0, 3.0, Math.PI - 0.4);
    this.spot('hide', -3.0, 0, -2.2, 0.9);
    this.spot('table', -2.6, 0, 1.2, Math.PI);
    this.spot('selim', 2.8, 0, 2.9, Math.PI + 0.5);
    this.spot('thug1', 3.6, 0, 3.1, Math.PI + 0.3);
    this.spot('thug2', 2.0, 0, 3.3, Math.PI + 0.8);
    const self = this;
    this.anchors = {
      drums: { pos: () => self.group.localToWorld(V(1.6, 1.0, -2.2)), frame: 4.5, yaw0: Math.PI * 0.85 },
      map: { pos: () => map.localToWorld(V(0, 0, 0)), frame: 0.95, yaw0: 0, paperUp: () => paperUp(map) },
      money: { pos: () => money.localToWorld(V(0.3, 0.05, 0.05)), frame: 0.9, yaw0: 0.6 },
      wallphoto: { pos: () => photo.localToWorld(V(0, 0, 0)), frame: 0.75, yaw0: 0 },
      door: { pos: () => door.localToWorld(V(0, -0.2, 0)), frame: 4.5, yaw0: Math.PI },
      hatch: { pos: () => hatch.localToWorld(V(0, 0, 0)), frame: 1.4, yaw0: 0.5 },
      room: { pos: () => self.group.localToWorld(V(0, 1.4, 0)), frame: 6, yaw0: Math.PI },
    };
  }
}

// ------------------------------------------------------------------ TELEFONCU
export class ShopSet extends Base {
  constructor() {
    super('shop', V(8000, 0, 0));
    const room = P.makeRoom(5, 4.4, 2.8, { wall: '#e8e6e1', floorTex: Q.concreteTexture('#bdb8ae', [3, 3]) }); this.group.add(room);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.6), P.M('#20262e', 0.4, 0.3)); counter.position.set(0, 0.5, -0.7); this.group.add(counter);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.02, 0.62), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, roughness: 0.05 })); glass.position.set(0, 1.01, -0.7); this.group.add(glass);
    const r = mulberry32(4);
    for (let i = 0; i < 14; i++) { const ph = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.01, 0.14), P.M(['#111', '#e8e8e8', '#2b3d5a', '#8a1c2b'][i % 4], 0.3, 0.5)); ph.position.set(-1.4 + i * 0.21, 0.98, -0.7 + (r() - 0.5) * 0.2); this.group.add(ph); }
    // arka duvar: kılıf rafı + afişler
    const cols = ['#ff4d5e', '#5ce1e6', '#ffc93c', '#7bd389', '#8a6cc4', '#ffffff'];
    for (let row = 0; row < 4; row++) for (let c = 0; c < 12; c++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.03), P.M(cols[(row * 5 + c) % 6], 0.5)); b.position.set(-1.6 + c * 0.28, 1.3 + row * 0.3, -2.17); this.group.add(b); }
    for (const [x, t, s, bg] of [[-1.9, 'HAT', 'YENİ SIM KART', '#0f7a4a'], [1.9, '5G', 'FATURA · TAKSİT', '#1f4fa0']]) {
      const pst = Q.makePaper(Q.posterTexture(t, s, bg), 0.8, 1.12); pst.position.set(x, 1.7, -2.18); this.group.add(pst);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.45), new THREE.MeshStandardMaterial({ map: TX.signTexture('İLETİŞİM', 'TELEFON · AKSESUAR', '#1f4fa0'), emissive: new THREE.Color('#ffffff'), emissiveMap: TX.signTexture('İLETİŞİM', 'TELEFON · AKSESUAR', '#1f4fa0'), emissiveIntensity: 0.4 }));
    sign.position.set(0, 2.5, -2.18); this.group.add(sign);
    // kayıt defteri
    const ledger = Q.makePaper(TX.notebookTexture(), 0.42, 0.31); ledger.rotation.x = -Math.PI / 2; ledger.position.set(-0.3, 1.025, -0.6); this.group.add(ledger);
    // floresan + kapı
    for (const x of [-1, 1]) { const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), P.M('#fff', 0.2, 0, { emissive: new THREE.Color('#eef6ff'), emissiveIntensity: 3 })); tube.position.set(x, 2.75, 0); this.group.add(tube); const l = new THREE.PointLight('#eaf2ff', 2.2, 8, 1.3); l.position.set(x, 2.6, 0); this.group.add(l); }
    const door = P.makeDoor(); door.position.set(1.6, 0, 2.18); door.rotation.y = Math.PI; this.group.add(door); door.userData.leaf.rotation.y = -0.9;
    // güvenlik kamerası (köşede)
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.2), P.M('#e8e8e8', 0.4)); cam.position.set(-2.3, 2.55, 1.9); cam.rotation.set(0.5, -0.7, 0); this.group.add(cam);
    this.spot('keeper', 0.4, 0, -1.3, 0);
    this.spot('deniz', -0.5, 0, 0.25, Math.PI - 0.15);
    this.spot('kerem', 0.45, 0, 0.35, Math.PI + 0.2);
    this.spot('customer', 0.0, 0, 0.0, Math.PI);
    this.spot('exit', 1.6, 0, 1.6, -0.4);
    const self = this;
    this.anchors = {
      room: { pos: () => self.group.localToWorld(V(0, 1.3, -0.6)), frame: 3.6, yaw0: 0 },
      ledger: { pos: () => ledger.localToWorld(V(0, 0, 0)), frame: 0.65, yaw0: 0, paperUp: () => paperUp(ledger) },
      cctv: { pos: () => self.group.localToWorld(V(-2.25, 2.5, 1.85)), frame: 1, yaw0: 0, fixedCam: true },
    };
  }
}

// ------------------------------------------------------------------ BUZ FABRİKASI
export class FactorySet extends Base {
  constructor() {
    super('factory', V(9000, 0, 0));
    const W = 12, D = 10, H = 6;
    const conc = new THREE.MeshStandardMaterial({ map: Q.concreteTexture('#7c7a74', [4, 2]), roughness: 0.95, side: THREE.BackSide });
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [conc, conc, P.M('#2a2a2a', 0.9, 0, { side: THREE.BackSide }), new THREE.MeshStandardMaterial({ map: Q.concreteTexture('#5d5a55', [6, 5]), roughness: 0.9, side: THREE.BackSide }), conc, conc]);
    box.position.y = H / 2; box.receiveShadow = true; this.group.add(box);
    // paslı borular + buz kalıpları
    const rust = P.M('#7a4a2a', 0.7, 0.6);
    for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, W, 12), rust); p.rotation.z = Math.PI / 2; p.position.set(0, 4.6 + (i % 2) * 0.4, -4.6 + i * 0.25); this.group.add(p); }
    const r = mulberry32(3);
    for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 0.3), P.M('#8b9096', 0.5, 0.7)); m.position.set(3 + (i % 6) * 0.45, 0.5, -3.5 + Math.floor(i / 6) * 0.5); m.rotation.y = (r() - 0.5) * 0.2; this.group.add(m); }
    // köşe: yatak, masa, pano, çentikler
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 1.9), P.M('#5a5f4a', 0.95)); mattress.position.set(-4.6, 0.09, -1.5); this.group.add(mattress);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 1.2), P.M('#6b2a2a', 0.95)); blanket.position.set(-4.6, 0.2, -1.1); blanket.rotation.y = 0.05; this.group.add(blanket);
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.8), P.M('#ffffff', 0.8, 0, { map: TX.woodTexture('#5a4030', 31, [1, 1]) })); table.position.set(-2.6, 0.78, -3.6); this.group.add(table);
    for (const [x, z] of [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.05), P.M('#3a2a1e')); l.position.set(-2.6 + x, 0.39, -3.6 + z); this.group.add(l); }
    const list = Q.makePaper(Q.listTexture(), 0.42, 0.56); list.rotation.x = -Math.PI / 2; list.rotation.z = 0.12; list.position.set(-2.85, 0.81, -3.55); this.group.add(list); this.props.list = list; list.userData.always = true;
    const phone = (this.oldPhone = Q.makeOldPhone()); phone.position.set(-2.2, 0.81, -3.5); phone.rotation.y = -0.3; this.group.add(phone);
    const solar = Q.makeSolarPanel(); solar.position.set(-1.2, 2.6, -4.85); this.group.add(solar);
    this.group.add(Q.makeCable(V(-1.2, 2.45, -4.8), V(-2.2, 0.82, -3.55), 0.6));
    const board = Q.makeCorkboard(); board.position.set(-3.0, 2.0, -4.95); this.group.add(board); this.board = board;
    const tally = Q.makePaper(Q.tallyTexture(), 2.0, 1.0); tally.position.set(-5.97, 1.6, -2.6); tally.rotation.y = Math.PI / 2; this.group.add(tally); this.tally = tally;
    // kırık pencereler + ay ışığı (+ fırtına çakması)
    for (const x of [-3, 0, 3]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ color: '#34507a' })); w.position.set(x, 4.2, 4.98); w.rotation.y = Math.PI; this.group.add(w); }
    this.moon = new THREE.DirectionalLight('#8fa8e0', 0.9); this.moon.position.set(-2, 8, -6); this.moon.target.position.set(1, 0, 3); this.group.add(this.moon, this.moon.target);
    const dl = new THREE.PointLight('#7f9ad0', 2.2, 8, 1.5); dl.position.set(2.5, 3.6, 3.2); this.group.add(dl);
    const lantern = P.makeLamp('#ffb760', 1.5); lantern.position.set(-1.9, 0.81, -3.9); this.group.add(lantern); this.lantern = lantern;
    // çelik kapı
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.0, 0.1), P.M('#4a4f55', 0.5, 0.7)); door.position.set(2.5, 1.5, 4.94); this.group.add(door); this.door = door;
    this.spot('deniz', -2.6, 0, -2.7, Math.PI + 0.1);
    this.spot('enter', 1.8, 0, 3.6, Math.PI + 0.5);
    this.spot('selim', 2.0, 0, 4.1, Math.PI + 0.2);
    this.spot('kerem', 3.0, 0, 4.0, Math.PI - 0.2);
    const self = this;
    this.anchors = {
      board: { pos: () => board.localToWorld(V(0, 0, 0)), frame: 2.6, yaw0: 0 },
      tally: { pos: () => tally.localToWorld(V(0, 0, 0)), frame: 2.0, yaw0: 0 },
      list: { pos: () => list.localToWorld(V(0, 0, 0)), frame: 0.6, yaw0: 0, paperUp: () => paperUp(list) },
      oldphone: { pos: () => phone.localToWorld(V(0, 0, 0)), frame: 0.42, yaw0: 0.4 },
      door: { pos: () => door.localToWorld(V(0, 0, 0)), frame: 3.6, yaw0: Math.PI },
      room: { pos: () => self.group.localToWorld(V(-1.8, 1.5, -2.2)), frame: 7, yaw0: 0.35 },
    };
  }
  update(t, world, scene) {
    const lit = scene?.phoneLit || 0;
    const u = this.oldPhone.userData;
    u.scrM.color.setRGB(0.05 + 0.75 * lit, 0.06 + 0.82 * lit, 0.08 + 0.95 * lit);
    u.glow.intensity = 1.2 * lit;
    this.lantern.userData.light.intensity = 1.5 * (0.9 + 0.1 * noise3(t * 6, 2, 2));
    this.moon.intensity = 0.9 + (world?.lightning || 0) * 6;
  }
}
