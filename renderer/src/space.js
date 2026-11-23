// Uzay ortamı: küp haritaya bir kez işlenen gökyüzü (Samanyolu bandı, toz şeritleri, renkli
// nebula bulutları, çözünürlük altı yıldız tozu) + keskin yıldızlar (parlaklık dağılımlı nokta
// sprite'ları, parlaklarda kırınım ışınları) + paralaks veren kozmik toz parçacıkları.
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { mulberry32, hashString } from './util.js';

export const SKY_PRESETS = {
  default: { n1: '#1b2a6b', n2: '#4b1d6e', n3: '#0e5566', neb: 0.9, milky: 1.0 },
  warm: { n1: '#6b1d2b', n2: '#9a4a17', n3: '#4b1d6e', neb: 1.0, milky: 0.9 },
  cool: { n1: '#0d3b66', n2: '#0f5e6e', n3: '#33206e', neb: 0.9, milky: 1.0 },
  violet: { n1: '#3b0f5e', n2: '#7a1d63', n3: '#1b2a6b', neb: 1.0, milky: 0.9 },
  gold: { n1: '#4a2a0a', n2: '#6b3410', n3: '#2a1d4a', neb: 0.9, milky: 1.0 },
  deep: { n1: '#0a1030', n2: '#170c2e', n3: '#08202e', neb: 0.45, milky: 0.7 },
  teal: { n1: '#08404a', n2: '#123a6e', n3: '#3a1a5a', neb: 0.95, milky: 0.95 },
};

const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3 uN1, uN2, uN3, uAxis; uniform float uNeb, uMilky, uSeed;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float b = dot(d, uAxis);
  float band = exp(-b * b * 12.0);
  float core = exp(-b * b * 70.0);
  float n1 = fbm(d * 2.2 + uSeed, 6);
  float n2 = fbm(d * 5.5 + uSeed * 1.7 + 3.1, 6);
  float n3 = fbm(d * 15.0 + uSeed * 2.3, 4);
  float dust = smoothstep(-0.05, 0.45, fbm(d * 6.5 + 11.0 + uSeed, 6) + 0.25 * n3);
  vec3 milky = mix(vec3(0.42, 0.5, 0.75), vec3(1.0, 0.84, 0.64), clamp(core * 0.9 + 0.25 * smoothstep(-0.2, 0.6, n1), 0.0, 1.0));
  float mw = band * (0.3 + 0.7 * smoothstep(-0.35, 0.65, n2 * 0.7 + n3 * 0.35)) * (1.0 - 0.85 * dust * band);
  vec3 col = milky * mw * uMilky * 0.2;
  float neb = smoothstep(0.05, 0.95, fbm(d * 1.35 + uSeed * 0.7 + 9.0, 6) * 0.95 + 0.35 * n2);
  float wisps = pow(1.0 - abs(snoise(d * 3.6 + n1 * 1.6 + uSeed)), 5.0);
  vec3 nc = mix(uN1, uN2, smoothstep(-0.45, 0.45, n1));
  nc = mix(nc, uN3, smoothstep(0.1, 0.75, n3 + 0.3 * n2));
  col += nc * (neb * 0.55 + wisps * neb * 0.75) * uNeb * 0.26;
  vec3 g = d * 560.0; vec3 cell = floor(g);
  float h = hash13(cell + uSeed);
  float sd = step(0.991, h) * hash13(cell * 1.3 + 2.0);
  col += vec3(0.82, 0.87, 1.0) * sd * (0.25 + band * 1.1) * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = /* glsl */`
attribute float aMag; attribute vec3 aColor; attribute float aPh;
uniform float uTime, uScale, uBright;
varying vec3 vC; varying float vSpike;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float b = pow(10.0, -0.26 * aMag);
  float tw = 1.0 + 0.14 * sin(uTime * (2.0 + aPh * 3.0) + aPh * 40.0);
  gl_PointSize = clamp(2.2 + sqrt(b) * 9.0, 2.0, 15.0) * uScale;
  vC = aColor * b * tw * uBright;
  vSpike = smoothstep(0.3, 0.9, b);
}`;
const STAR_FRAG = /* glsl */`
varying vec3 vC; varying float vSpike;
void main(){
  vec2 c = (gl_PointCoord - 0.5) * 2.0;
  float r = length(c);
  float core = exp(-r * r * 16.0);
  float halo = exp(-r * r * 4.0) * 0.18;
  float spike = vSpike * (exp(-abs(c.x) * 26.0) + exp(-abs(c.y) * 26.0)) * max(0.0, 1.0 - r) * 0.7;
  gl_FragColor = vec4(vC * (core + halo + spike), 1.0);
}`;

const DUST_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uProj;
varying float vA;
void main(){
  vec3 p = position + vec3(sin(uTime * 0.07 + aSeed.x * 6.28), cos(uTime * 0.05 + aSeed.y * 6.28), sin(uTime * 0.06 + aSeed.z * 6.28)) * 0.25;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSeed.w * uProj / -mv.z, 1.0, 10.0);
  vA = smoothstep(0.3, 1.2, -mv.z) * (0.35 + 0.65 * aSeed.x);
}`;
const DUST_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
  gl_FragColor = vec4(uColor * exp(-d * d * 4.0) * vA * uOpacity, 1.0);
}`;

function starColor(rng) {
  const k = rng();
  if (k < 0.12) return [0.62, 0.74, 1.0];
  if (k < 0.45) return [0.86, 0.9, 1.0];
  if (k < 0.75) return [1.0, 0.97, 0.9];
  if (k < 0.92) return [1.0, 0.85, 0.65];
  return [1.0, 0.68, 0.45];
}

export class SpaceEnv {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer; this.scene = scene;
    this.opts = opts;
    this.axis = new THREE.Vector3(0.35, 0.82, -0.45).normalize();
    this.cubes = {};
    this._buildSkyBaker();
    this._buildStars();
    this._buildDust();
    this.setConfig({});
  }

  _buildSkyBaker() {
    this.skyU = { uN1: { value: new THREE.Color() }, uN2: { value: new THREE.Color() }, uN3: { value: new THREE.Color() },
      uAxis: { value: this.axis }, uNeb: { value: 1 }, uMilky: { value: 1 }, uSeed: { value: 0 } };
    this.skyScene = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 32), new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }));
    this.skyScene.add(m);
  }

  _skyCube(name) {
    if (this.cubes[name]) return this.cubes[name];
    const pr = SKY_PRESETS[name] || SKY_PRESETS.default;
    this.skyU.uN1.value.set(pr.n1); this.skyU.uN2.value.set(pr.n2); this.skyU.uN3.value.set(pr.n3);
    this.skyU.uNeb.value = pr.neb; this.skyU.uMilky.value = pr.milky; this.skyU.uSeed.value = (hashString(name) % 1000) * 0.013;
    const size = this.opts.skySize || 1024;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const cc = new THREE.CubeCamera(0.1, 20, rt);
    cc.update(this.renderer, this.skyScene);
    this.cubes[name] = rt;
    return rt;
  }

  _buildStars() {
    const N = 7000;
    const rng = mulberry32(2024);
    const pos = new Float32Array(N * 3), mag = new Float32Array(N), col = new Float32Array(N * 3), ph = new Float32Array(N);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      // %40'ı Samanyolu bandına yakın
      for (let tries = 0; tries < 20; tries++) {
        v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
        const l = v.length(); if (l < 0.05 || l > 1) continue;
        v.divideScalar(l);
        if (i % 5 < 2 && Math.abs(v.dot(this.axis)) > 0.25 * rng()) continue;
        break;
      }
      pos.set([v.x * 500, v.y * 500, v.z * 500], i * 3);
      const m = 6.8 + Math.log10(Math.max(1e-4, rng())) / 0.42;
      mag[i] = Math.max(-0.5, m);
      col.set(starColor(rng), i * 3);
      ph[i] = rng();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this.starU = { uTime: { value: 0 }, uScale: { value: this.opts.pixelScale ?? 0.75 }, uBright: { value: 2.2 } };
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    this.scene.add(this.stars);
  }

  _buildDust() {
    const N = 700;
    const rng = mulberry32(99);
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const r = 1.8 + Math.pow(rng(), 0.7) * 12;
      const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 2 - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
      seed.set([rng(), rng(), rng(), 0.006 + rng() * 0.018], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.dustU = { uTime: { value: 0 }, uProj: { value: 1500 }, uColor: { value: new THREE.Color('#ffe9d0') }, uOpacity: { value: 0.35 } };
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.dustU, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  setConfig(cfg = {}) {
    const name = cfg.palette || 'default';
    const rt = this._skyCube(name);
    this.scene.background = rt.texture;
    this.scene.backgroundIntensity = cfg.sky ?? 1.0;
    const rot = (cfg.skyRot ?? (hashString(cfg.seed || name) % 360)) * Math.PI / 180;
    this.scene.backgroundRotation = new THREE.Euler(0.3 * Math.sin(rot), rot, 0);
    this.stars.rotation.copy(this.scene.backgroundRotation);
    this.dustU.uOpacity.value = cfg.dust ?? 0.35;
    this.starU.uBright.value = cfg.stars ?? 2.2;
  }

  update(t, camera, { proj = 1500 } = {}) {
    this.starU.uTime.value = t;
    this.stars.position.copy(camera.position);
    this.dustU.uTime.value = t;
    this.dustU.uProj.value = proj;
  }

  warmup(names) { for (const n of names) this._skyCube(n); }
}
