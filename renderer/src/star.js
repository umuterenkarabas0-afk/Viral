// Güneş: granülasyonlu plazma yüzeyi (bake + kare başına akış), kenar kararması,
// kameraya dönük korona (akıntılı ışınlar) ve kenardan yükselen protuberans halkaları.
import * as THREE from 'three';
import { NOISE_GLSL, FS_VERT } from './glsl.js';
import { mulberry32 } from './util.js';
import { dirLL } from './planet.js';

const GRAN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec4 uSpots[6]; uniform int uSpotN;
${NOISE_GLSL}
vec2 worley(vec3 p){
  vec3 c = floor(p); float f1 = 8.0, f2 = 8.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 h = hash33(c + o);
    float d = length(p - (c + o + h));
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return vec2(f1, f2);
}
void main(){
  vec3 p = sphereDir(vUv);
  vec3 w = vec3(snoise(p * 9.0), snoise(p * 9.0 + 3.3), snoise(p * 9.0 + 7.7)) * 0.5;
  vec2 a = worley(p * 120.0 + w);
  vec2 b = worley(p * 120.0 + w + vec3(13.1, 7.3, 2.9));
  float g1 = smoothstep(0.0, 0.8, a.y - a.x) * 0.8 + 0.2 * (1.0 - a.x);
  float g2 = smoothstep(0.0, 0.8, b.y - b.x) * 0.8 + 0.2 * (1.0 - b.x);
  // plazma: büyük ölçekli akış + parlak filamentler
  vec3 q = p * 3.0 + 0.6 * vec3(fbm(p * 2.0, 4), fbm(p * 2.0 + 5.1, 4), fbm(p * 2.0 + 9.7, 4));
  float sup = clamp(0.45 + 0.35 * fbm(q, 6) + 0.35 * (ridgedf(q * 2.2 + 3.0, 5) - 0.45), 0.0, 1.0);
  float spot = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uSpotN) break;
    float d = angDist(p, uSpots[i].xyz) / uSpots[i].w + 0.25 * fbm(p * 40.0 + float(i), 3);
    spot = max(spot, smoothstep(1.0, 0.75, d) * 0.55 + smoothstep(0.55, 0.35, d) * 0.45);
  }
  gl_FragColor = vec4(g1, g2, spot, sup);
}`;

const SUN_VERT = 'varying vec2 vUv; varying vec3 vObjN; varying vec3 vWorldPos; void main(){ vUv = uv; vObjN = normalize(position); vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';
const SUN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tGran; uniform float uTime, uInt; uniform vec3 uHot, uMid, uCool; uniform mat3 uRot;
varying vec2 vUv; varying vec3 vObjN; varying vec3 vWorldPos;
${NOISE_GLSL}
void main(){
  vec3 Ng = normalize(uRot * vObjN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = max(dot(Ng, V), 0.0);
  vec2 uv = vUv + vec2(uTime * 0.0012, 0.0);
  vec4 g = texture(tGran, uv);
  float bl = 0.5 + 0.5 * sin(uTime * 0.7 + vObjN.y * 30.0 + vObjN.x * 20.0);
  float gr = mix(g.r, g.g, bl);
  float fine = vnoise(vObjN * 260.0 + vec3(0.0, uTime * 0.35, 0.0));
  float flow = vnoise(vObjN * 18.0 + vec3(uTime * 0.05, 0.0, uTime * 0.04));
  float T = 0.3 + 0.1 * gr + 0.04 * fine + 0.7 * g.a + 0.08 * flow - 0.75 * g.b;
  T = clamp(T, 0.0, 1.0);
  vec3 col = T < 0.6 ? mix(uCool, uMid, T / 0.6) : mix(uMid, uHot, (T - 0.6) / 0.4);
  float limb = pow(mu, 0.5);
  col *= (0.3 + 0.7 * limb);
  col = mix(col * vec3(1.0, 0.45, 0.18) * 1.3, col, smoothstep(0.0, 0.4, mu));
  gl_FragColor = vec4(col * uInt, 1.0);
}`;

const CORONA_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const CORONA_FRAG = /* glsl */`
precision highp float;
uniform float uTime, uInt, uSize; uniform vec3 uColor, uColor2;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 q = (vUv - 0.5) * uSize;
  float r = length(q);
  if (r < 0.97) discard;
  vec2 dir = q / r;
  float rays = snoise(vec3(dir * 2.6, r * 0.35 - uTime * 0.04)) * 0.5 + 0.5;
  float rays2 = snoise(vec3(dir * 7.0, r * 0.9 - uTime * 0.07)) * 0.5 + 0.5;
  float x = r - 1.0;
  float inner = exp(-x * 14.0);
  float glow = exp(-x * 2.4);
  float far = exp(-x * 0.9) * 0.25;
  float str = mix(0.45, 1.5, rays) * mix(0.7, 1.25, rays2);
  vec3 c = uColor2 * inner * 1.6 + uColor * (glow * str + far);
  c *= 1.0 - smoothstep(uSize * 0.36, uSize * 0.5, r);
  gl_FragColor = vec4(c * uInt, 1.0);
}`;

const PROM_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const PROM_FRAG = /* glsl */`
precision highp float;
uniform float uTime, uInt, uSeed; uniform vec3 uColor;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  float n = snoise(vec3(vUv.x * 14.0 - uTime * 0.6, vUv.y * 2.0, uSeed)) * 0.5 + 0.5;
  float n2 = snoise(vec3(vUv.x * 40.0 + uTime * 0.3, vUv.y * 5.0, uSeed + 3.0)) * 0.5 + 0.5;
  float across = sin(vUv.y * 3.14159);
  float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  float a = pow(across, 1.5) * (0.35 + 0.9 * n * n2) * (0.6 + 0.4 * ends);
  gl_FragColor = vec4(uColor * a * uInt, 1.0);
}`;

export class Sun {
  constructor(renderer, params = {}) {
    this.p = params;
    this.renderer = renderer;
    this.group = new THREE.Group(); this.group.name = 'sun';
    this.spin = new THREE.Group(); this.group.add(this.spin);
    this._bake();
    const u = (this.u = {
      tGran: { value: this.granRT.texture }, uTime: { value: 0 }, uInt: { value: params.intensity ?? 1.0 },
      uHot: { value: new THREE.Color(params.hot || '#ffd27a').multiplyScalar(1.9) },
      uMid: { value: new THREE.Color(params.mid || '#ff7a10').multiplyScalar(1.15) },
      uCool: { value: new THREE.Color(params.cool || '#7a1200').multiplyScalar(0.42) },
      uRot: { value: new THREE.Matrix3() },
    });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.ShaderMaterial({ uniforms: u, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG }));
    this.spin.add(this.body);
    this.cu = {
      uTime: { value: 0 }, uInt: { value: params.corona ?? 1.0 }, uSize: { value: 7.0 },
      uColor: { value: new THREE.Color(params.coronaColor || '#ff9a3a').multiplyScalar(1.3) },
      uColor2: { value: new THREE.Color('#fff0c0').multiplyScalar(1.4) },
    };
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.ShaderMaterial({
      uniforms: this.cu, vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.corona.renderOrder = 1;
    this.group.add(this.corona);
    this._buildProminences(params.prominences ?? 5);
  }

  _bake() {
    const W = 4096, H = 2048;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, depthBuffer: false, wrapS: THREE.RepeatWrapping });
    rt.texture.colorSpace = THREE.NoColorSpace;
    const spots = (this.p.spots || [{ lat: 14, lon: 20, size: 2.2 }, { lat: 11, lon: 32, size: 1.4 }, { lat: -17, lon: 330, size: 1.8 }]).slice(0, 6);
    const arr = Array.from({ length: 6 }, () => new THREE.Vector4());
    spots.forEach((s, i) => { const d = dirLL(s.lat, s.lon); arr[i].set(d.x, d.y, d.z, (s.size ?? 2) * Math.PI / 180); });
    const mat = new THREE.ShaderMaterial({ uniforms: { uSpots: { value: arr }, uSpotN: { value: spots.length } }, vertexShader: FS_VERT, fragmentShader: GRAN_FRAG, depthTest: false, depthWrite: false });
    const scene = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; scene.add(q);
    this.renderer.setRenderTarget(rt); this.renderer.render(scene, cam); this.renderer.setRenderTarget(null);
    mat.dispose();
    this.granRT = rt;
  }

  _buildProminences(n) {
    this.proms = [];
    const rng = mulberry32(77);
    // ilk ikisi açılış planında görünen kenarda (boylam ~194°)
    const fixed = this.p.promAt || [[6, 218], [-24, 214], [30, 222]];
    for (let i = 0; i < n; i++) {
      const lat = i < fixed.length ? fixed[i][0] : (rng() - 0.5) * 70, lon = i < fixed.length ? fixed[i][1] : rng() * 360;
      const c = dirLL(lat, lon);
      // sabit (açılış planındaki) halkalar kuzey-güney doğrultusunda: kameradan kemer gibi görünsün
      const t1 = i < fixed.length
        ? new THREE.Vector3(0, 1, 0).addScaledVector(c, -c.y).normalize().applyAxisAngle(c, (rng() - 0.5) * 0.6)
        : new THREE.Vector3().crossVectors(c, new THREE.Vector3(0, 1, 0)).normalize();
      const sep = 0.1 + rng() * 0.16, hgt = i < fixed.length ? 0.16 + rng() * 0.12 : 0.1 + rng() * 0.2;
      const a = c.clone().addScaledVector(t1, -sep).normalize(), b = c.clone().addScaledVector(t1, sep).normalize();
      const u = { uTime: { value: 0 }, uInt: { value: 1 }, uSeed: { value: i * 3.1 }, uColor: { value: new THREE.Color('#ff4a14').multiplyScalar(3.2) } };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PROM_VERT, fragmentShader: PROM_FRAG, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      // her halka birkaç ince plazma ipliğinden oluşur
      const strands = i < fixed.length ? 5 : 3;
      const side = new THREE.Vector3().crossVectors(c, t1).normalize();
      for (let k = 0; k < strands; k++) {
        const jx = (rng() - 0.5) * 0.05, jy = (rng() - 0.5) * 0.04, hk = 1 + (rng() - 0.5) * 0.35;
        const pts = [];
        for (let j = 0; j <= 28; j++) {
          const sN = j / 28;
          const base = a.clone().lerp(b, sN).normalize();
          const lift = Math.sin(Math.PI * sN) * hgt * hk * (1 + 0.15 * Math.sin(sN * 11 + i + k));
          pts.push(base.multiplyScalar(0.995 + lift).addScaledVector(side, (jx + 0.02 * Math.sin(sN * 7 + k)) * Math.sin(Math.PI * sN)).addScaledVector(t1, jy * Math.sin(Math.PI * sN)));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const geo = new THREE.TubeGeometry(curve, 110, (i < fixed.length ? 0.006 : 0.005) + rng() * 0.006, 8, false);
        const m = new THREE.Mesh(geo, mat);
        m.renderOrder = 2;
        this.spin.add(m);
      }
      this.proms.push(u);
    }
  }

  setVisible(v) { this.group.visible = v; }

  update(t, camera, { intensity = 1, corona = 1 } = {}) {
    this.spin.rotation.y = t * 0.01;
    this.group.updateMatrixWorld(true);
    this.u.uTime.value = t;
    this.u.uInt.value = (this.p.intensity ?? 1) * intensity;
    this.u.uRot.value.setFromMatrix4(new THREE.Matrix4().extractRotation(this.spin.matrixWorld));
    this.cu.uTime.value = t;
    this.cu.uInt.value = (this.p.corona ?? 1) * corona;
    this.corona.quaternion.copy(camera.quaternion);
    for (const p of this.proms) { p.uTime.value = t; p.uInt.value = intensity; }
  }
}
