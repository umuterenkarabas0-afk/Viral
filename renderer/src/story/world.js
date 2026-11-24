// Hikâye dünyası: zaman dilimine göre gökyüzü (güneş, bulut, yıldız, şimşek),
// Gerstner dalgalı deniz, ışıklar ve sis. Render tamamen t'nin fonksiyonudur.
import * as THREE from 'three';
import { clamp, lerp } from '../util.js';

// Zaman dilimi ön ayarları (doğrusal renk uzayında karıştırılır)
export const TIMES = {
  dawn: {
    zenith: '#1d2f5c', horizon: '#ff9a62', ground: '#2a1c2c', sun: '#ffd2a1', sunI: 3.2, sunDir: [-0.55, 0.12, -0.83],
    hemiSky: '#8fa6d6', hemiGround: '#3a2a2a', hemiI: 0.9, fog: '#d98d6e', fogD: 0.0042,
    sea: '#0c2c45', seaShallow: '#2f6f86', clouds: 0.55, cloudCol: '#ffb38a', stars: 0.08, waves: 0.75,
    grade: { tint: [1.04, 0.98, 0.95], sat: 1.1, exp: 1.05, contrast: 1.06 },
  },
  day: {
    zenith: '#2f6fd0', horizon: '#bfe3ff', ground: '#3b4a52', sun: '#fff3dc', sunI: 3.6, sunDir: [0.35, 0.72, -0.6],
    hemiSky: '#bcd8ff', hemiGround: '#5b5446', hemiI: 1.1, fog: '#bcd9ee', fogD: 0.0028,
    sea: '#0b3f62', seaShallow: '#2a8aa8', clouds: 0.4, cloudCol: '#ffffff', stars: 0.0, waves: 0.6,
    grade: { tint: [1.0, 1.0, 1.0], sat: 1.12, exp: 1.0, contrast: 1.05 },
  },
  dusk: {
    zenith: '#2a1f4f', horizon: '#ff6a3d', ground: '#1f1420', sun: '#ff9a5a', sunI: 2.6, sunDir: [0.62, 0.07, -0.78],
    hemiSky: '#7a6aa8', hemiGround: '#3a2020', hemiI: 0.75, fog: '#b8604e', fogD: 0.0045,
    sea: '#140f2e', seaShallow: '#4a2f4f', clouds: 0.6, cloudCol: '#ff8a66', stars: 0.25, waves: 0.7,
    grade: { tint: [1.05, 0.96, 0.98], sat: 1.12, exp: 1.05, contrast: 1.07 },
  },
  night: {
    zenith: '#050b1e', horizon: '#2a3f6e', ground: '#060a14', sun: '#b8c8ff', sunI: 1.4, sunDir: [-0.3, 0.45, -0.84],
    hemiSky: '#5a72b8', hemiGround: '#141a28', hemiI: 0.95, fog: '#1a2848', fogD: 0.005,
    sea: '#06142a', seaShallow: '#1c3a66', clouds: 0.3, cloudCol: '#3a4a78', stars: 1.0, waves: 0.65,
    grade: { tint: [0.92, 0.98, 1.12], sat: 1.0, exp: 1.35, contrast: 1.08 },
  },
  storm: {
    zenith: '#1a222e', horizon: '#5d6a78', ground: '#14181d', sun: '#c9d6e4', sunI: 1.8, sunDir: [-0.2, 0.5, -0.84],
    hemiSky: '#7d8b9c', hemiGround: '#1c2024', hemiI: 1.3, fog: '#3d4753', fogD: 0.009,
    sea: '#0d1a22', seaShallow: '#2f5160', clouds: 1.0, cloudCol: '#465260', stars: 0.0, waves: 1.6,
    grade: { tint: [0.95, 1.0, 1.06], sat: 0.82, exp: 1.3, contrast: 1.1 },
  },
};

// Dalga bileşenleri: yön (x,z), dalga boyu, dikiklik, hız çarpanı
const WAVES = [
  [1.0, 0.35, 9.0, 0.32], [0.7, -0.8, 5.3, 0.28], [-0.4, 1.0, 3.1, 0.22], [0.2, 0.95, 1.7, 0.18], [-0.85, -0.3, 1.1, 0.12],
];

const col = (h) => new THREE.Color(h);

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.waveAmp = 0.75;
    this.lightning = 0;
    this._buildSky();
    this._buildSea();
    this._buildLights();
    scene.fog = new THREE.FogExp2(0x000000, 0.004);
    this.setTime('dawn');
  }

  _buildSky() {
    this.skyU = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uTime: { value: 0 },
      uClouds: { value: 0.5 }, uCloudCol: { value: new THREE.Color() }, uStars: { value: 0 }, uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uGround, uSun, uSunDir, uCloudCol; uniform float uTime, uClouds, uStars, uFlash;
        varying vec3 vDir;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 c = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.45));
          c = mix(c, uGround, smoothstep(0.0, -0.08, y));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          c += uSun * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 1.2) * (0.6 + 0.4 * smoothstep(-0.05, 0.15, y));
          c += uSun * smoothstep(0.9993, 0.9997, sd) * 18.0;          // güneş diski
          c += uHorizon * 0.35 * exp(-abs(y) * 14.0);                   // ufuk parlaması
          // yıldızlar
          if (uStars > 0.0 && y > 0.0) {
            vec2 g = d.xz / (d.y + 0.35) * 260.0;
            float s = step(0.9965, h2(floor(g))) * (0.6 + 0.4 * sin(uTime * 3.0 + h2(floor(g) + 3.1) * 40.0));
            c += vec3(s) * uStars * smoothstep(0.02, 0.3, y) * 2.4;
          }
          // bulutlar: kubbeye yansıtılmış fbm
          if (y > -0.02) {
            vec2 uv = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float cl = fbm(uv * 1.3);
            float cov = smoothstep(1.0 - uClouds * 0.75, 1.15 - uClouds * 0.5, cl + 0.15);
            float lit = 0.55 + 0.6 * pow(sd, 3.0);
            vec3 cc = uCloudCol * lit + uSun * pow(sd, 12.0) * 0.6;
            c = mix(c, cc, cov * smoothstep(-0.02, 0.12, y) * 0.92);
          }
          c += vec3(0.75, 0.82, 1.0) * uFlash * 3.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  _buildSea() {
    this.seaU = {
      uTime: { value: 0 }, uAmp: { value: 0.75 }, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
      uSkyZ: { value: new THREE.Color() }, uSkyH: { value: new THREE.Color() }, uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.004 },
      uFlash: { value: 0 }, uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) }, uLamp: { value: new THREE.Vector4(0, -100, 0, 0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.seaU, fog: false,
      vertexShader: /* glsl */`
        uniform float uTime, uAmp; uniform vec4 uWaves[5];
        varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
        void main(){
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 o = p; vec3 tx = vec3(1,0,0), tz = vec3(0,0,1); float crest = 0.0;
          for (int i = 0; i < 5; i++){
            vec2 dir = normalize(uWaves[i].xy); float L = uWaves[i].z * (0.6 + 0.4 * uAmp); float k = 6.2831853 / L;
            float c = sqrt(9.8 / k) * (0.8 + uWaves[i].w); float a = uWaves[i].w / k * uAmp;
            float f = k * (dot(dir, p.xz) - c * uTime);
            float Q = 0.85;
            o.x += Q * a * dir.x * cos(f); o.z += Q * a * dir.y * cos(f); o.y += a * sin(f);
            tx += vec3(-Q*dir.x*dir.x*a*k*sin(f), dir.x*a*k*cos(f), -Q*dir.x*dir.y*a*k*sin(f));
            tz += vec3(-Q*dir.x*dir.y*a*k*sin(f), dir.y*a*k*cos(f), -Q*dir.y*dir.y*a*k*sin(f));
            crest += max(0.0, sin(f)) * uWaves[i].w;
          }
          vWorld = o; vNormal = normalize(cross(tz, tx)); vCrest = crest;
          gl_Position = projectionMatrix * viewMatrix * vec4(o, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uDeep, uShallow, uSkyZ, uSkyH, uSun, uSunDir, uFogCol; uniform float uFogD, uTime, uFlash, uAmp; uniform vec4 uLamp;
        varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          // küçük ölçekli dalgacık normali
          vec2 q = vWorld.xz * 1.7 + uTime * vec2(0.4, 0.25);
          float e = 0.12;
          float n0 = n2(q), nx = n2(q + vec2(e, 0.0)), nz = n2(q + vec2(0.0, e));
          vec2 q2 = vWorld.xz * 4.3 - uTime * vec2(0.3, 0.5);
          float m0 = n2(q2), mx = n2(q2 + vec2(e, 0.0)), mz = n2(q2 + vec2(0.0, e));
          float ripple = 0.55 * smoothstep(60.0, 2.0, dist);
          vec3 N = normalize(vNormal + vec3((n0 - nx) + 0.5 * (m0 - mx), 0.0, (n0 - nz) + 0.5 * (m0 - mz)) * ripple);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          vec3 sky = mix(uSkyH, uSkyZ, pow(clamp(R.y, 0.0, 1.0), 0.45));
          vec3 L = normalize(uSunDir);
          sky += uSun * pow(max(dot(R, L), 0.0), 8.0) * 0.4;
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 water = mix(uDeep, uShallow, clamp(vCrest * 1.4 + 0.15 * N.y, 0.0, 1.0) * 0.6);
          // ışık sırtlardan sızar (alt yüzey saçılımı)
          float sss = pow(max(dot(V, -L + N * 0.4), 0.0), 3.0) * clamp(vCrest, 0.0, 1.0);
          water += uSun * sss * 0.25;
          vec3 c = mix(water, sky, clamp(fres, 0.0, 1.0));
          // güneş parıltısı
          float spec = pow(max(dot(R, L), 0.0), 380.0) * 22.0 + pow(max(dot(R, L), 0.0), 40.0) * 0.6;
          c += uSun * spec;
          // köpük
          float foam = smoothstep(0.6, 1.1, vCrest * (0.6 + 0.4 * n2(vWorld.xz * 1.3 + uTime * 0.2))) * clamp(uAmp - 0.5, 0.0, 0.8);
          foam *= smoothstep(80.0, 10.0, dist);
          c = mix(c, vec3(0.75, 0.8, 0.85) * (0.4 + 0.6 * max(L.y, 0.15)), foam * 0.45);
          // fener / lamba yansıması
          if (uLamp.w > 0.0) {
            vec3 Lp = normalize(uLamp.xyz - vWorld);
            c += vec3(1.0, 0.85, 0.55) * pow(max(dot(R, Lp), 0.0), 120.0) * uLamp.w * 4.0;
          }
          c += vec3(0.7, 0.8, 1.0) * uFlash * fres * 2.0;
          float fog = 1.0 - exp(-uFogD * uFogD * dist * dist * 1.0);
          c = mix(c, uFogCol, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const geo = new THREE.PlaneGeometry(420, 420, 220, 220);
    geo.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(geo, mat);
    this.sea.frustumCulled = false;
    this.scene.add(this.sea);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.5; sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.rim = new THREE.DirectionalLight(0xffffff, 0.6);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.rim, this.rim.target);
  }

  setTime(name) {
    const p = TIMES[name] || TIMES.dawn;
    this.preset = p; this.timeName = name;
    const u = this.skyU;
    u.uZenith.value.set(p.zenith); u.uHorizon.value.set(p.horizon); u.uGround.value.set(p.ground);
    u.uSun.value.set(p.sun).multiplyScalar(name === 'night' ? 0.25 : 1);
    u.uSunDir.value.set(...p.sunDir).normalize();
    u.uClouds.value = p.clouds; u.uCloudCol.value.set(p.cloudCol); u.uStars.value = p.stars;
    const s = this.seaU;
    s.uDeep.value.set(p.sea); s.uShallow.value.set(p.seaShallow); s.uSkyZ.value.set(p.zenith); s.uSkyH.value.set(p.horizon);
    s.uSun.value.set(p.sun).multiplyScalar(name === 'night' ? 0.35 : 1);
    s.uSunDir.value.copy(u.uSunDir.value); s.uFogCol.value.set(p.fog); s.uFogD.value = p.fogD;
    this.waveAmp = p.waves; s.uAmp.value = p.waves;
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiI;
    this.sun.color.set(p.sun); this.sun.intensity = p.sunI;
    this.rim.color.set(p.horizon); this.rim.intensity = name === 'night' ? 0.35 : 0.8;
    this.scene.fog.color.set(p.fog); this.scene.fog.density = p.fogD;
  }

  // Deniz yüksekliği (yatay kaymayı ihmal eden yaklaşık değer) — tekne salınımı için
  heightAt(x, z, t) {
    let y = 0;
    for (const [dx, dz, L0, st] of WAVES) {
      const L = L0 * (0.6 + 0.4 * this.waveAmp), k = (2 * Math.PI) / L, c = Math.sqrt(9.8 / k) * (0.8 + st);
      const n = Math.hypot(dx, dz), a = (st / k) * this.waveAmp;
      y += a * Math.sin(k * ((dx / n) * x + (dz / n) * z - c * t));
    }
    return y;
  }

  normalAt(x, z, t) {
    const e = 0.6;
    const hx = this.heightAt(x + e, z, t) - this.heightAt(x - e, z, t);
    const hz = this.heightAt(x, z + e, t) - this.heightAt(x, z - e, t);
    return new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  setExterior(on, seaOn = on) {
    this.sky.visible = on;
    this.sea.visible = seaOn;
  }

  update(t, cam, focus) {
    this.skyU.uTime.value = t;
    this.seaU.uTime.value = t;
    // deniz kamerayla birlikte kayar (ızgara adımına oturtularak titreme önlenir)
    const step = 420 / 220;
    this.sea.position.set(Math.round(cam.position.x / step) * step, 0, Math.round(cam.position.z / step) * step);
    this.sky.position.copy(cam.position);
    // gölge kamerası odağı takip eder
    const f = focus || new THREE.Vector3();
    const d = this.skyU.uSunDir.value;
    this.sun.position.set(f.x + d.x * 25, f.y + Math.max(0.25, d.y) * 25, f.z + d.z * 25);
    this.sun.target.position.copy(f);
    this.rim.position.set(f.x - d.x * 20, f.y + 8, f.z - d.z * 20);
    this.rim.target.position.copy(f);
    // şimşek
    this.skyU.uFlash.value = this.lightning;
    this.seaU.uFlash.value = this.lightning;
    this.hemi.intensity = this.preset.hemiI + this.lightning * 3.0;
  }
}
