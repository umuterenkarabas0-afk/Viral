// Su altı ortamı: gökyüzü kubbesi (Snell penceresi + ışık huzmeleri),
// kumlu zemin + kostikler, kayalar, Posidonia çayırı, deniz karı,
// kabarcıklar, uzakta dolaşan balık sürüsü, hacimsel ışık huzmeleri.
import * as THREE from 'three';
import { mulberry32, hashString, fbm3, noise3, clamp, lerp, smoothstep } from './util.js';
import { patchCaustics, causticUniforms } from './caustics.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const PRESETS = {
  default: { deep: '#01101d', mid: '#05476a', top: '#3fb3d3', sun: '#d9fbff', fog: '#0a4f72', fogDensity: 0.055, sand: '#c9b48b' },
  warm: { deep: '#03131c', mid: '#0b5468', top: '#58c4cf', sun: '#fff4d6', fog: '#0d5a6c', fogDensity: 0.05, sand: '#d1b98c' },
  deep: { deep: '#000814', mid: '#023252', top: '#1a7ea6', sun: '#a8e8ff', fog: '#032e4a', fogDensity: 0.07, sand: '#8f8a78' },
  open: { deep: '#000b1a', mid: '#034a7a', top: '#3aa7e0', sun: '#e0f7ff', fog: '#04528a', fogDensity: 0.04, sand: '#a39a80' },
  dream: { deep: '#14012a', mid: '#3a1f7a', top: '#ff8bd8', sun: '#fff0ff', fog: '#3a2a7a', fogDensity: 0.05, sand: '#c7a9c9' },
};

function canvasTex(w, h, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

export class OceanEnv {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer; this.scene = scene;
    this.q = opts.quality ?? 1;
    this.world = new THREE.Group(); scene.add(this.world);
    this.colors = {};
    this._buildSky();
    this._buildLights();
    this._buildSeabed();
    this._buildRocks();
    this._buildGrass();
    this._buildRays();
    this._buildSnow();
    this._buildBubbles();
    this._buildSchool();
    this._buildEnvMap();
    this.setConfig({});
  }

  _buildSky() {
    this.skyU = {
      uDeep: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uTop: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.2, 1, 0.1).normalize() },
      uSurface: { value: 1.0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uDeep, uMid, uTop, uSun, uSunDir; uniform float uTime, uSurface;
        varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 col = mix(uDeep, uMid, smoothstep(-0.7, 0.05, y));
          col = mix(col, uTop, smoothstep(0.0, 0.85, y));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSun * (pow(s, 6.0) * 0.55 + pow(s, 60.0) * 1.2) * uSurface;
          // yüzey dalgacıkları (Snell penceresi içinde)
          vec2 sp = d.xz / max(0.15, y) * 3.0;
          float rip = n2(sp * 2.0 + vec2(uTime * 0.35, uTime * 0.2)) * n2(sp * 3.1 - vec2(uTime * 0.25, -uTime * 0.31));
          col += uSun * smoothstep(0.35, 0.95, y) * rip * 0.55 * uSurface;
          // hacimsel ışık huzmeleri
          float ang = atan(d.x, d.z);
          float rays = (sin(ang * 19.0 + uTime * 0.25) * 0.5 + 0.5) * (sin(ang * 31.0 - uTime * 0.17 + 1.3) * 0.5 + 0.5);
          col += uSun * rays * smoothstep(-0.1, 0.8, y) * 0.16 * uSurface;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), mat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(0x0a4f72, 0.055);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0x9fe7ff, 0x0b2a3a, 1.35); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e0, 2.4); this.sun.position.set(2, 10, 3); this.scene.add(this.sun);
    this.rim = new THREE.DirectionalLight(0x7fe0ff, 2.2); this.rim.position.set(-4, 3, -6); this.scene.add(this.rim);
    this.fill = new THREE.DirectionalLight(0x3b7fa5, 0.7); this.fill.position.set(0, -4, 5); this.scene.add(this.fill);
  }

  _buildEnvMap() {
    // Metalik/clearcoat yansımaları için basit su altı ortam haritası
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vD; void main(){ float y = vD.y;
        vec3 c = mix(vec3(0.01,0.06,0.1), vec3(0.05,0.35,0.5), smoothstep(-0.6,0.1,y));
        c = mix(c, vec3(0.6,0.95,1.0), smoothstep(0.2,0.95,y));
        c += vec3(2.5,2.4,2.2) * pow(max(dot(vD, normalize(vec3(0.2,1.,0.1))),0.), 40.);
        gl_FragColor = vec4(c,1.); }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
    this.envTex = pm.fromScene(s, 0.02).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.85;
  }

  _buildSeabed() {
    const sandTex = canvasTex(512, 512, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const rip = Math.sin((x * 0.11 + noise3(x * 0.02, y * 0.02, 1) * 6) + y * 0.02) * 0.5 + 0.5;
        const grain = noise3(x * 0.9, y * 0.9, 4) * 0.5 + 0.5;
        const v = 0.78 + rip * 0.14 + grain * 0.1 + noise3(x * 0.05, y * 0.05, 2) * 0.06;
        const i = (y * w + x) * 4;
        img.data[i] = 255 * v; img.data[i + 1] = 245 * v; img.data[i + 2] = 220 * v; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { repeat: 18 });
    const sandN = canvasTex(256, 256, (ctx, w, h) => {
      const hgt = (x, y) => Math.sin((x * 0.22 + noise3(x * 0.04, y * 0.04, 1) * 6) + y * 0.04);
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
        const n = new THREE.Vector3(-dx * 0.6, dy * 0.6, 1).normalize();
        const i = (y * w + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { repeat: 22, srgb: false });
    const seg = Math.round(150 * this.q);
    const g = new THREE.PlaneGeometry(140, 140, Math.round(seg * 0.7), Math.round(seg * 0.7));
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      pos[i + 1] = fbm3(x * 0.08, z * 0.08, 0.5, 4) * 0.9 + noise3(x * 0.4, z * 0.4, 3) * 0.08;
    }
    g.computeVertexNormals();
    this.sandMat = new THREE.MeshLambertMaterial({ map: sandTex, normalMap: sandN, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xc9b48b });
    patchCaustics(this.sandMat, { strength: 1.6 });
    this.seabed = new THREE.Mesh(g, this.sandMat);
    this.world.add(this.seabed);
  }

  _buildRocks() {
    this.rocks = [];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    patchCaustics(mat, { strength: 0.9 });
    for (let k = 0; k < 16; k++) {
      let g = new THREE.IcosahedronGeometry(1, k < 6 ? 5 : 4);
      g.deleteAttribute('normal'); g.deleteAttribute('uv');
      g = mergeVertices(g);
      const pos = g.attributes.position.array;
      const cols = new Float32Array(pos.length);
      const seed = k * 13.7;
      for (let i = 0; i < pos.length; i += 3) {
        const v = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]);
        const n = fbm3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3, 5);
        const r = 1 + n * 0.45 + noise3(v.x * 5, v.y * 5 + seed, v.z * 5) * 0.05;
        v.multiplyScalar(r);
        if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.25;
        pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z;
        const moss = smoothstep(0.05, 0.7, v.y / r) * (0.55 + 0.45 * noise3(v.x * 3, v.y * 3, v.z * 3 + seed));
        const base = 0.13 + 0.06 * noise3(v.x * 4, v.y * 4, v.z * 4) + 0.04 * noise3(v.x * 12, v.y * 12, v.z * 12);
        const pinkAlgae = smoothstep(0.55, 0.85, noise3(v.x * 2.2 + seed, v.y * 2.2, v.z * 2.2)) * 0.6;
        cols[i] = lerp(lerp(base * 1.1, 0.1, moss), 0.42, pinkAlgae); cols[i + 1] = lerp(lerp(base, 0.17, moss), 0.2, pinkAlgae); cols[i + 2] = lerp(lerp(base * 0.85, 0.07, moss), 0.24, pinkAlgae);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      this.world.add(m); this.rocks.push(m);
    }
  }

  _buildGrass() {
    const blade = new THREE.PlaneGeometry(0.07, 1, 1, 6);
    blade.translate(0, 0.5, 0);
    const tex = canvasTex(8, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#1d3a1c'); g.addColorStop(0.5, '#3f7a35'); g.addColorStop(0.85, '#6c9a3e'); g.addColorStop(1, '#8a7a45');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1, 1);
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    this.grassU = { uGTime: { value: 0 } };
    const prev = patchCaustics(mat, { strength: 0.45 }).onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      prev(shader);
      Object.assign(shader.uniforms, this.grassU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uGTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float hh = position.y;
          float sw = sin(uGTime * 1.3 + ip.x * 0.6 + ip.z * 0.4) * 0.6 + sin(uGTime * 2.1 + ip.x * 1.7) * 0.25;
          transformed.x += sw * hh * hh * 0.35;
          transformed.z += cos(uGTime * 1.1 + ip.z * 0.8) * hh * hh * 0.15;`);
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    const N = Math.round(2600 * this.q);
    this.grass = new THREE.InstancedMesh(blade, mat, N);
    this.grass.frustumCulled = false;
    this.grassN = N;
    this.world.add(this.grass);
  }

  _buildRays() {
    this.rayU = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#dff8ff') }, uStrength: { value: 0.35 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rayU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: /* glsl */`
        uniform float uTime, uStrength; uniform vec3 uColor; varying vec2 vUv;
        float h(float x){ return fract(sin(x*127.1)*43758.5); }
        float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h(i),h(i+1.),f); }
        void main(){
          float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float len = smoothstep(0.0, 0.7, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          float stripes = n1(vUv.x * 9.0 + uTime * 0.25) * 0.7 + n1(vUv.x * 23.0 - uTime * 0.4) * 0.3;
          float a = edge * len * stripes * uStrength;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    this.rays = [];
    const rng = mulberry32(77);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.PlaneGeometry(1.6 + rng() * 2.2, 26);
      g.translate(0, -13, 0);
      const m = new THREE.Mesh(g, mat);
      m.userData = { x: (rng() - 0.5) * 18, z: -2 - rng() * 14, tilt: 0.18 + rng() * 0.12, ph: rng() * 10 };
      m.frustumCulled = false; m.renderOrder = 5;
      this.scene.add(m); this.rays.push(m);
    }
  }

  _pointsMaterial(kind) {
    const u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(24, 16, 24) }, uScale: { value: 900 }, uColor: { value: new THREE.Color('#cfefff') }, uOpacity: { value: 0.7 }, uRise: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: kind === 'bubble' ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aSeed;
        uniform float uTime, uScale, uRise; uniform vec3 uCam, uBox;
        varying float vFade; varying float vSeed;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.4 + aSeed * 6.0) * 0.25 + sin(uTime * 2.3 + aSeed * 11.0) * 0.03 * uRise;
          p.z += cos(uTime * 0.33 + aSeed * 4.0) * 0.25;
          p.y += uRise * uTime * (0.6 + aSeed * 0.8) - (1.0 - uRise) * uTime * 0.04;
          p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = clamp(aSize * uScale / max(d, 0.1), 1.0, 70.0);
          vFade = smoothstep(0.8, 2.0, d) * (1.0 - smoothstep(9.0, 15.0, d));
          vSeed = aSeed;
        }`,
      fragmentShader: kind === 'bubble' ? /* glsl */`
        uniform vec3 uColor; uniform float uOpacity; varying float vFade;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
          if (r > 1.0) discard;
          float rim = smoothstep(0.65, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
          float hl = smoothstep(0.35, 0.0, length(c - vec2(-0.17, -0.17)));
          float a = (rim * 0.8 + hl * 0.9 + 0.06) * vFade * uOpacity;
          gl_FragColor = vec4(uColor, a);
        }` : /* glsl */`
        uniform vec3 uColor; uniform float uOpacity; varying float vFade; varying float vSeed;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a = a * a * vFade * uOpacity * (0.5 + 0.5 * vSeed);
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    return { mat, u };
  }

  _buildSnow() {
    const N = Math.round(1400 * this.q);
    const rng = mulberry32(11);
    const pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rng() - 0.5) * 24; pos[i * 3 + 1] = (rng() - 0.5) * 16; pos[i * 3 + 2] = (rng() - 0.5) * 24;
      size[i] = 0.012 + Math.pow(rng(), 6) * 0.08; seed[i] = rng();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const { mat, u } = this._pointsMaterial('snow');
    this.snowU = u;
    this.snow = new THREE.Points(g, mat); this.snow.frustumCulled = false; this.snow.renderOrder = 6;
    this.scene.add(this.snow);
  }

  _buildBubbles() {
    const N = Math.round(160 * this.q);
    const rng = mulberry32(23);
    const pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // birkaç kabarcık kolonu
      const col = Math.floor(rng() * 5);
      const cx = [-3.5, 4.2, -6, 7, 1.5][col], cz = [-4, -6, -9, -3, -11][col];
      pos[i * 3] = cx + (rng() - 0.5) * 0.6; pos[i * 3 + 1] = (rng() - 0.5) * 16; pos[i * 3 + 2] = cz + (rng() - 0.5) * 0.6;
      size[i] = 0.02 + rng() * 0.05; seed[i] = rng();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const { mat, u } = this._pointsMaterial('bubble');
    u.uRise.value = 1; u.uOpacity.value = 0.75; u.uColor.value = new THREE.Color('#e8fbff');
    this.bubbleU = u;
    this.bubbles = new THREE.Points(g, mat); this.bubbles.frustumCulled = false; this.bubbles.renderOrder = 7;
    this.scene.add(this.bubbles);

    // Patlama kabarcıkları (geçişlerde / dalışta)
    const M = 220;
    const r2 = mulberry32(99);
    const bp = new Float32Array(M * 3), bs = new Float32Array(M), bseed = new Float32Array(M);
    for (let i = 0; i < M; i++) {
      bp[i * 3] = (r2() - 0.5) * 3.2; bp[i * 3 + 1] = (r2() - 0.5) * 2.0; bp[i * 3 + 2] = (r2() - 0.5) * 2.5;
      bs[i] = 0.015 + Math.pow(r2(), 2) * 0.09; bseed[i] = r2();
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    bg.setAttribute('aSize', new THREE.BufferAttribute(bs, 1));
    bg.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
    this.burstU = { uAge: { value: -1 }, uScale: { value: 900 }, uOrigin: { value: new THREE.Vector3() } };
    const bm = new THREE.ShaderMaterial({
      uniforms: this.burstU, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aSeed; uniform float uAge, uScale; uniform vec3 uOrigin; varying float vA;
        void main(){
          float age = uAge - aSeed * 0.25;
          vec3 p = uOrigin + position * (0.4 + age * 1.2);
          p.y += age * age * (1.2 + aSeed * 2.5) + age * 0.8;
          p.x += sin(age * 9.0 + aSeed * 20.0) * 0.05;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 90.0);
          vA = (age < 0.0 ? 0.0 : 1.0) * (1.0 - smoothstep(1.0, 2.0, age)) * smoothstep(0.9, 2.0, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float rim = smoothstep(0.6, 0.95, r); float hl = smoothstep(0.3, 0.0, length(c - vec2(-0.16,-0.16)));
          float a = (rim * 0.7 + hl * 0.6 + 0.04) * vA;
          gl_FragColor = vec4(vec3(0.85, 0.95, 1.0), a);
        }`,
    });
    this.burst = new THREE.Points(bg, bm); this.burst.frustumCulled = false; this.burst.renderOrder = 8;
    this.scene.add(this.burst);
  }

  _buildSchool() {
    // Basit düşük poligonlu gümüş balık sürüsü
    const body = new THREE.SphereGeometry(0.5, 10, 6);
    body.scale(1, 0.32, 0.14);
    const tail = new THREE.BufferGeometry();
    tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.42, 0, 0, -0.72, 0.18, 0, -0.72, -0.18, 0], 3));
    tail.computeVertexNormals();
    const merged = mergeGeoms([body, tail]);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
    const N = 70;
    this.school = new THREE.InstancedMesh(merged, mat, N);
    this.school.frustumCulled = false;
    const rng = mulberry32(5);
    this.schoolData = Array.from({ length: N }, () => ({ r: 6 + rng() * 2.5, y: (rng() - 0.5) * 1.6, ph: rng() * 1.1, sp: 0.12 + rng() * 0.015, s: 0.16 + rng() * 0.07, off: rng() * 6 }));
    this.scene.add(this.school);
  }

  setConfig(cfg = {}) {
    const preset = PRESETS[cfg.palette] || PRESETS.default;
    const pal = { ...preset, ...(cfg.colors || {}) };
    this.pal = pal;
    this.skyU.uDeep.value.set(pal.deep); this.skyU.uMid.value.set(pal.mid); this.skyU.uTop.value.set(pal.top); this.skyU.uSun.value.set(pal.sun);
    this.scene.fog.color.set(pal.fog); this.scene.fog.density = cfg.fogDensity ?? pal.fogDensity;
    this.sandMat.color.set(pal.sand);
    causticUniforms.uCColor.value = new THREE.Color(pal.sun).multiplyScalar(1.0);
    const habitat = cfg.habitat || 'seabed';
    const seed = hashString(cfg.seed || habitat);
    const rng = mulberry32(seed);
    const floorY = { seabed: -1.25, sand: -0.7, meadow: -1.6, reef: -1.5, rocky: -1.4, open: -9, surface: -6 }[habitat] ?? -1.3;
    this.world.position.y = cfg.floorY ?? floorY;
    this.habitat = habitat;
    // kayalar
    const reef = habitat === 'reef' || habitat === 'rocky';
    this.driftSpeed = cfg.drift ?? 0.22;
    this.driftOffset = (rng() - 0.5) * 20;
    const ax = this.travel((cfg.t0 ?? 0) + (cfg.dur ?? 5) * 0.5);
    this.anchorX = ax;
    this.rocks.forEach((r, i) => {
      let sc;
      if (reef && i < 8) {
        r.position.set(ax + (i - 3.5) * 1.6 + (rng() - 0.5) * 1.2, -0.1, -2.4 - rng() * 2.8);
        sc = 0.9 + rng() * 1.2;
      } else {
        const side = rng() < 0.5 ? -1 : 1;
        r.position.set(ax + side * (4 + rng() * 14), -0.1, -4 - rng() * 18);
        sc = 0.7 + rng() * 2.6;
      }
      r.scale.set(sc * (0.8 + rng() * 0.6), sc * (0.45 + rng() * 0.6), sc * (0.8 + rng() * 0.6));
      r.rotation.set(0, rng() * 6.28, 0);
      r.userData.baseX = r.position.x;
      r.visible = habitat !== 'open';
    });
    // çayır
    const dense = habitat === 'meadow' ? 1 : habitat === 'sand' ? 0.12 : habitat === 'open' ? 0 : 0.45;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const clusters = Array.from({ length: 14 }, () => [ax + (rng() - 0.5) * 26, -1.5 - rng() * 16]);
    let shown = 0;
    for (let i = 0; i < this.grassN; i++) {
      const cl = clusters[i % clusters.length];
      const r = Math.sqrt(rng()) * (2.2 + rng() * 1.5);
      const a = rng() * Math.PI * 2;
      p.set(cl[0] + Math.cos(a) * r, -0.05, cl[1] + Math.sin(a) * r);
      const dFish = Math.hypot(p.x - ax, p.z);
      const keep = rng() < dense && (p.z < -0.7 || (dFish > 2.6 && p.z < 1.0));
      const hgt = 0.5 + rng() * 0.9;
      q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, rng() * Math.PI, (rng() - 0.5) * 0.3));
      s.set(0.8 + rng() * 0.6, hgt, 1);
      const w = rng();
      if (!keep) continue;
      m.compose(p, q, s); this.grass.setMatrixAt(shown, m);
      shown++;
      void w;
    }
    this.grass.count = shown;
    this.grass.instanceMatrix.needsUpdate = true;
    this.grass.visible = shown > 0;
    this.seabed.visible = habitat !== 'open';
    this.surfaceK = cfg.surface ?? 1;
    this.raysStrength = cfg.rays ?? (habitat === 'open' ? 0.55 : 0.38);
  }

  // Balık + kamera bu kadar +x yönünde ilerler (ileri yüzme hissi)
  travel(t) { return this.driftOffset + t * this.driftSpeed; }

  burstAt(origin, age) {
    this.burstU.uOrigin.value.copy(origin);
    this.burstU.uAge.value = age;
  }

  update(t, camera) {
    causticUniforms.uCTime.value = t * 0.55;
    this.skyU.uTime.value = t;
    this.skyU.uSurface.value = this.surfaceK;
    this.sky.position.copy(camera.position);
    this.grassU.uGTime.value = t;
    // ışık huzmeleri kameraya dönük
    for (const r of this.rays) {
      const d = r.userData;
      r.position.set(d.x + Math.sin(t * 0.1 + d.ph) * 0.8 + camera.position.x * 0.3, 9, d.z);
      const ang = Math.atan2(camera.position.x - r.position.x, camera.position.z - r.position.z);
      r.rotation.set(0, ang, 0);
      r.rotateZ(d.tilt);
    }
    this.rayU.uTime.value = t;
    this.rayU.uStrength.value = this.raysStrength * this.surfaceK;
    for (const u of [this.snowU, this.bubbleU]) { u.uTime.value = t; u.uCam.value.copy(camera.position); }
    // sürü
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.schoolData.forEach((d, i) => {
      const a = d.ph + t * d.sp;
      p.set((this.anchorX || 0) + Math.cos(a) * d.r * 1.6, d.y + Math.sin(t * 0.5 + d.off) * 0.3 + 1.2, Math.sin(a) * d.r * 0.6 - 16);
      const yaw = -a - Math.PI;
      q.setFromEuler(new THREE.Euler(0, yaw, Math.sin(t * 6 + d.off) * 0.08));
      s.setScalar(d.s);
      m.compose(p, q, s); this.school.setMatrixAt(i, m);
    });
    this.school.instanceMatrix.needsUpdate = true;
    this.school.visible = this.habitat !== 'surface';
  }
}

function mergeGeoms(geoms) {
  let total = 0; geoms.forEach((g) => (total += g.attributes.position.count));
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3); const idx = [];
  let off = 0;
  for (const g0 of geoms) {
    const g = g0.index ? g0 : g0;
    pos.set(g.attributes.position.array, off * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nrm.set(g.attributes.normal.array, off * 3);
    if (g.index) for (const i of g.index.array) idx.push(i + off);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}
