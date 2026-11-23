// Prosedürel gezegen / uydu.
//
// Yüzey dokuları açılışta GPU'da bir kez "bake" edilir (eşdikdörtgen, 2048×1024):
//   1. yükseklik + maskeler (arazi fbm, 5 katman krater, volkan, kanyon, sırt, çizgiler, lekeler)
//   2. albedo (renk rampası, krater ışınları, kutup başlıkları, çift renk, göller, gaz bantları,
//      fırtına girdapları, kutup altıgeni, Venüs V-desenleri)
//   3. detay (yükseklik gradyanı → normal, emisyon, yer değiştirme yüksekliği)
//   4. (isteğe bağlı) bulut katmanı
// Kare başına çalışan shader yalnızca doku okur: aydınlatma, yumuşak gün-gece sınırı, halka
// gölgesi, atmosfer kenar ışığı, pus (Titan), lav ışıması, rüzgar çizgileri ve "tarama" grafikleri.
import * as THREE from 'three';
import { NOISE_GLSL, FS_VERT } from './glsl.js';
import { deepMerge, mulberry32, hashString, clamp } from './util.js';

const D2R = Math.PI / 180;

export function dirLL(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  return new THREE.Vector3(-Math.cos(lo) * Math.cos(la), Math.sin(la), Math.sin(lo) * Math.cos(la));
}

export const PLANET_DEFAULTS = {
  type: 'rocky',            // rocky | gas
  seed: 1,
  colors: ['#3b3734', '#77716b', '#aaa39b', '#e2dcd2'],
  albedo: { scale: 2.2, contrast: 1.0, accent: 0.5, heightTint: 6.0, ejecta: 0.6 },
  terrain: { scale: 1.8, amount: 0.012, ridged: 0.0, warp: 0.5 },
  craters: { density: 0, size: 1, depth: 0.6 },
  relief: 1.0,              // normal haritası şiddeti
  displace: 0.0,            // geometrik yer değiştirme (abartı)
  bands: { count: 14, turbulence: 0.6, contrast: 0.8, streaks: 0.5, flow: 0.004 },
  vshape: 0,
  storms: [],               // { lat, lon, size, aspect, swirl, color, amount }
  spots: [],                // { lat, lon, size, color, soft, ring, emissive, height, opacity }
  volcanoes: [],            // { lat, lon, size, height, caldera, color }
  canyons: [],              // { from: [lat, lon], to: [lat, lon], width, depth }
  caps: null,               // { north, south, color, soft }
  twotone: null,            // { lat, lon, color, coverage, soft }
  ridge: null,              // { height, width, lon0, lon1 }
  stripes: null,            // { count, spacing, length, width, depth, angle, color }
  fractures: null,          // { amount, scale, color }
  lakes: null,              // { lat, coverage, scale, color }
  hexagon: null,            // { size (derece), color, edge, rot }
  clouds: null,             // { color, coverage, scale, stretch, speed, opacity, lat: [a,b,c,d] }
  atmosphere: null,         // { color, intensity, thickness, scatter, rim }
  haze: null,               // { color, amount }
  rings: null,              // { inner, outer, style: saturn|thin|faint, color, color2, opacity }
  plumes: [],               // { lat, lon, kind: umbrella|jet, height, spread, color, count, size, rate, along }
  streaks: null,            // { color, speed, intensity, count }
  emissive: { color: '#ff7a2a', strength: 0 },
  specular: { amount: 0, power: 40 },
  ambient: 0.012,
  wrap: 0.0,
  tilt: 0,                  // eksen eğikliği (derece, Z ekseni etrafında)
  tiltYaw: 0,
  spin: 0.025,              // rad/sn (görsel)
  phase: 0,
  anchors: {},
  res: 2048,
};

const MAXS = 12, MAXV = 6, MAXC = 4, MAXST = 8;

// ------------------------------------------------------------------ bake shader
const BAKE_FRAG = /* glsl */`
precision highp float;
uniform float uSeed; uniform vec2 uRes;
uniform vec4 uTerr; uniform vec4 uCrat;
uniform vec4 uVolA[${MAXV}]; uniform vec4 uVolB[${MAXV}]; uniform vec3 uVolC[${MAXV}]; uniform int uVolN;
uniform vec4 uCanA[${MAXC}]; uniform vec4 uCanB[${MAXC}]; uniform int uCanN;
uniform vec4 uSpotA[${MAXS}]; uniform vec4 uSpotB[${MAXS}]; uniform vec4 uSpotC[${MAXS}]; uniform int uSpotN;
uniform vec4 uRidge; uniform vec4 uStripes; uniform vec4 uStripes2; uniform vec3 uStripeColor;
uniform vec4 uFrac; uniform vec3 uFracColor;
uniform vec3 uC[4]; uniform vec4 uAlb;
uniform vec4 uCaps; uniform vec3 uCapColor;
uniform vec4 uTwo; uniform vec3 uTwoColor; uniform float uTwoSoft;
uniform vec4 uLakes; uniform vec3 uLakeColor;
uniform vec4 uBands; uniform float uVShape;
uniform vec4 uStA[${MAXST}]; uniform vec4 uStB[${MAXST}]; uniform vec4 uStC[${MAXST}]; uniform int uStN;
uniform vec4 uHex; uniform vec3 uHexColor; uniform vec3 uHexEdge;
uniform vec4 uCloud; uniform vec4 uCloudLat; uniform vec3 uCloudColor;
uniform float uRelief; uniform float uEjecta;
uniform sampler2D tH;
varying vec2 vUv;
${NOISE_GLSL}
const float PI = 3.14159265359;

float craterProfile(float d){
  float cavity = d * d - 1.0;
  float rimX = min(d - 1.0 - 0.7, 0.0);
  float rim = 0.85 * rimX * rimX;
  float s = smin(cavity, rim, 0.3);
  return smax(s, -0.6, 0.3);
}
void craterLayer(vec3 p, float scale, float density, float seed, inout float h, inout float ej){
  vec3 q = p * scale; vec3 c = floor(q);
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 cell = c + vec3(float(x), float(y), float(z));
    vec3 r1 = hash33(cell + seed * 7.31);
    if (r1.x > density) continue;
    vec3 ctr = cell + 0.5 + (hash33(cell * 1.37 + seed * 3.17) - 0.5) * 0.7;
    float rad = mix(0.1, 0.42, r1.y * r1.y) * uCrat.y;
    float d = length(q - ctr) / rad;
    if (d > min(2.4, 1.0 / rad)) continue;
    float age = r1.z;
    float prof = craterProfile(d + 0.06 * snoise(q * 3.0 + seed)) * mix(0.35, 1.0, age);
    h += prof * rad / scale * uCrat.z;
    ej += smoothstep(0.82, 1.0, age) * exp(-pow(max(d - 0.95, 0.0) * 1.5, 2.0)) * smoothstep(min(2.4, 1.0 / rad), 1.2, d);
  }
}
float spotMask(vec3 p, int i, out float ringOut){
  vec3 c = uSpotA[i].xyz; float s = uSpotA[i].w;
  float soft = uSpotB[i].x;
  float d = angDist(p, c) / s;
  d += 0.3 * soft * fbm(p * (3.0 / s) + float(i) * 3.1, 3);
  float m = smoothstep(1.0, 1.0 - max(soft, 0.02), d);
  float r0 = uSpotB[i].y;
  ringOut = 1.0;
  if (r0 > 0.0) m *= smoothstep(r0 - 0.25, r0 + 0.05, d);
  return m;
}
float stripeMask(vec3 p, out float flank){
  flank = 0.0;
  if (uStripes.x < 0.5 || p.y > -0.4) return 0.0;
  float a = uStripes2.x;
  vec2 q = vec2(p.x, p.z);
  q = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
  float m = 0.0;
  for (int k = 0; k < 6; k++) {
    if (float(k) >= uStripes.x) break;
    float off = (float(k) - (uStripes.x - 1.0) * 0.5) * uStripes.y;
    float wig = 0.012 * snoise(vec3(q * 18.0, float(k) * 4.0)) + 0.02 * sin(q.x * 9.0 + float(k));
    float d = abs(q.y - off + wig);
    float L = uStripes.z * (1.0 - 0.12 * abs(float(k) - (uStripes.x - 1.0) * 0.5));
    float lm = smoothstep(L, L * 0.8, abs(q.x));
    m = max(m, smoothstep(uStripes.w, uStripes.w * 0.3, d) * lm);
    flank = max(flank, exp(-pow((d - uStripes.w * 1.4) / uStripes.w, 2.0)) * lm);
  }
  return m;
}

#ifdef PASS_H
void main(){
  vec3 p = sphereDir(vUv);
  float h = 0.0, ej = 0.0, mVol = 0.0, mLine = 0.0;
#ifndef GAS
  vec3 wp = p + uTerr.w * 0.12 * vec3(snoise(p * 2.0 + uSeed), snoise(p * 2.0 + uSeed + 5.2), snoise(p * 2.0 + uSeed + 9.1));
  h += uTerr.y * (fbm(wp * uTerr.x + uSeed, 7) + uTerr.z * ridgedf(wp * uTerr.x * 1.7 + uSeed * 2.0, 6));
  float young = 0.0;  // genç (kratersiz) volkanik yüzey
  for (int i = 0; i < ${MAXV}; i++) {
    if (i >= uVolN) break;
    young = max(young, smoothstep(1.9, 1.0, angDist(p, uVolA[i].xyz) / uVolA[i].w));
  }
  if (uCrat.x > 0.0) {
    float hc = 0.0, ec = 0.0;
    craterLayer(p, 2.6, uCrat.x * 0.22, uSeed + 1.0, hc, ec);
    craterLayer(p, 6.0, uCrat.x * 0.38, uSeed + 2.0, hc, ec);
    craterLayer(p, 14.0, uCrat.x * 0.5, uSeed + 3.0, hc, ec);
    craterLayer(p, 32.0, uCrat.x * 0.55, uSeed + 4.0, hc, ec);
    craterLayer(p, 70.0, uCrat.x * 0.6, uSeed + 5.0, hc, ec);
    h += hc * (1.0 - 0.92 * young); ej += ec * (1.0 - young);
  }
  for (int i = 0; i < ${MAXV}; i++) {
    if (i >= uVolN) break;
    vec3 c = uVolA[i].xyz; float s = uVolA[i].w;
    float x = angDist(p, c) / s + 0.05 * snoise(p * (6.0 / s));
    if (x < 1.6) {
      float H = uVolB[i].x;
      float shield = H * (0.82 * pow(clamp(1.0 - x, 0.0, 1.0), 0.9) + 0.18 * smoothstep(1.0, 0.9, x)) * smoothstep(1.0, 0.93, x);
      float cr = uVolB[i].y;
      float cal = smoothstep(cr, cr * 0.8, x + 0.03 * snoise(p * (40.0 / s)));
      float cal2 = smoothstep(cr * 0.6, cr * 0.45, angDist(p, normalize(c + normalize(cross(c, vec3(0.0, 1.0, 0.0))) * s * cr * 0.45)) / s);
      shield -= H * 0.24 * cal + H * 0.1 * cal2;
      // radyal lav akıntısı dokusu
      vec3 tdir = normalize(p - c * dot(p, c));
      shield += H * 0.035 * ridgedf(p * (26.0 / s) + tdir * 3.0, 4) * smoothstep(1.0, 0.3, x) * smoothstep(cr * 0.9, cr * 1.4, x);
      h += shield;
      mVol = max(mVol, smoothstep(1.08, 0.95, x) * (0.6 + 0.4 * smoothstep(cr * 1.2, cr * 0.8, x)));
    }
  }
  for (int i = 0; i < ${MAXC}; i++) {
    if (i >= uCanN) break;
    vec3 A = uCanA[i].xyz, B = uCanB[i].xyz; vec3 nrm = normalize(cross(A, B));
    float g = asin(clamp(dot(p, nrm), -1.0, 1.0));
    float L = angDist(A, B);
    float along = step(0.0, dot(cross(A, p), nrm)) * step(0.0, dot(cross(p, B), nrm));
    float tA = angDist(p, A), tB = angDist(p, B);
    float taper = smoothstep(0.0, 0.18 * L, min(tA, tB));
    float w = uCanA[i].w * (0.75 + 0.45 * snoise(p * 14.0 + 2.0)) * taper;
    float d = abs(g + 0.012 * snoise(p * 25.0));
    float prof = smoothstep(w, w * 0.35, d);
    float side = smoothstep(w * 2.2, w * 0.9, d) * 0.25 * (0.5 + 0.5 * snoise(p * 60.0));
    h -= uCanB[i].w * (prof + side) * along;
  }
  if (uRidge.x > 0.0) {
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, -p.x);
    float c = (uRidge.z + uRidge.w) * 0.5, hw = abs(uRidge.w - uRidge.z) * 0.5;
    float dl = abs(mod(lon - c + PI, 2.0 * PI) - PI);
    float lm = smoothstep(hw, hw * 0.6, dl);
    float wv = uRidge.y * (0.8 + 0.35 * snoise(vec3(lon * 5.0, 1.0, uSeed)));
    h += uRidge.x * exp(-pow(lat / wv, 2.0)) * (0.7 + 0.3 * snoise(vec3(lon * 14.0, 3.0, uSeed))) * lm;
    h += uRidge.x * 0.15 * ridgedf(p * 40.0, 3) * exp(-pow(lat / (wv * 2.0), 2.0)) * lm;
  }
  float flank;
  float st = stripeMask(p, flank);
  h += (-st + flank * 0.45) * uStripes2.y;
  mLine = st;
  if (uFrac.x > 0.0) {
    float f1 = pow(1.0 - abs(snoise(p * uFrac.y + 31.0)), 22.0);
    float f2 = pow(1.0 - abs(snoise(p * uFrac.y * 2.3 + 7.0)), 30.0);
    h += (f1 + 0.6 * f2) * uFrac.z;
    mLine = max(mLine, (f1 + 0.7 * f2) * uFrac.x);
  }
  for (int i = 0; i < ${MAXS}; i++) {
    if (i >= uSpotN) break;
    if (abs(uSpotB[i].w) < 1e-6) continue;
    float ro; float m = spotMask(p, i, ro);
    h += m * uSpotB[i].w;
  }
#endif
  gl_FragColor = vec4(h, ej, mVol, mLine);
}
#endif

#ifdef PASS_ALB
vec3 ramp4(float m){
  m = clamp(m, 0.0, 1.0) * 3.0;
  if (m < 1.0) return mix(uC[0], uC[1], m);
  if (m < 2.0) return mix(uC[1], uC[2], m - 1.0);
  return mix(uC[2], uC[3], m - 2.0);
}
void main(){
  vec3 p = sphereDir(vUv);
  vec4 Hm = texelFetch(tH, ivec2(gl_FragCoord.xy), 0);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  vec3 col; float spec = 0.0;
#ifdef GAS
  vec3 q = p;
  for (int i = 0; i < ${MAXST}; i++) {
    if (i >= uStN) break;
    vec3 c = uStA[i].xyz; float s = uStA[i].w;
    float d = angDist(q, c) / s;
    q = rotAxis(q, c, uStB[i].y * exp(-d * d * 1.2));
  }
  float qlat = asin(clamp(q.y, -1.0, 1.0));
  float qlon = atan(q.z, -q.x);
  float warp = fbm(vec3(q.x * 2.2, q.y * 6.0, q.z * 2.2) + uSeed, 5);
  float b = qlat + uBands.y * 0.07 * warp;
  float bid = (b / PI + 0.5) * uBands.x;
  float f = fract(bid), i0 = floor(bid);
  float v = mix(hash11(i0 + uSeed * 13.1), hash11(i0 + 1.0 + uSeed * 13.1), smoothstep(0.3, 0.7, f));
  float streak = snoise(vec3(q.x * 3.0, q.y * 55.0, q.z * 3.0) + uSeed);
  float eddy = fbm(q * 9.0 + uSeed * 2.0, 4);
  float val = v + uBands.w * 0.16 * streak + 0.12 * eddy * uBands.y;
  if (uVShape > 0.0) {
    val += uVShape * 0.45 * fbm(vec3((qlon + 1.5 * abs(qlat)) * 1.4, qlat * 4.0, 3.0), 4);
    val += uVShape * 0.2 * snoise(vec3((qlon + 2.2 * abs(qlat)) * 3.0, qlat * 9.0, 8.0));
  }
  vec3 mean = (uC[0] + uC[1] + uC[2] + uC[3]) * 0.25;
  col = mix(mean, ramp4(val), uBands.z);
  for (int i = 0; i < ${MAXST}; i++) {
    if (i >= uStN) break;
    vec3 c = uStA[i].xyz; float s = uStA[i].w;
    float clat = asin(clamp(c.y, -1.0, 1.0));
    float dlat = (lat - clat) * uStB[i].x;
    float dd = angDist(p, c);
    float dlon = sqrt(max(dd * dd - (lat - clat) * (lat - clat), 0.0));
    float e = sqrt(dlon * dlon + dlat * dlat) / s + 0.12 * snoise(p * (5.0 / s));
    float core = smoothstep(1.0, 0.55, e);
    float edge = exp(-pow((e - 1.0) * 5.0, 2.0));
    vec3 sc = uStC[i].rgb * (0.85 + 0.3 * snoise(p * (8.0 / s) + 1.0));
    col = mix(col, sc, core * uStC[i].w);
    col = mix(col, mix(uC[3], sc, 0.3), edge * 0.35 * uStC[i].w);
  }
  {
    // dalsız: SwiftShader, uniform'a bağlı dallarda hatalı kod üretebiliyor
    float hexOn = step(0.5, uHex.w);
    float hs = max(uHex.x, 0.01);
    float colat = acos(clamp(p.y, -1.0, 1.0));
    float th = atan(p.z, -p.x) + uHex.y;
    float sg = PI / 3.0;
    float a = mod(th, sg) - sg * 0.5;
    float rh = hs * cos(sg * 0.5) / cos(a);
    rh *= 1.0 + 0.012 * sin(th * 15.0) + 0.02 * snoise(p * 30.0);
    float x = colat / rh;
    float inside = smoothstep(1.02, 0.97, x);
    float edge = exp(-pow(min((x - 1.0) * 14.0, 20.0), 2.0));
    float swirl = fbm(vec3(p.x * 22.0, p.z * 22.0, colat * 10.0) + 5.0, 4);
    vec3 ic = uHexColor * (0.88 + 0.25 * swirl);
    float rings = 0.5 + 0.5 * sin(colat / hs * 18.0 + swirl * 3.0);
    ic = mix(ic, ic * 1.15, rings * 0.4);
    col = mix(col, ic, inside * 0.92 * hexOn);
    col = mix(col, uHexEdge, edge * uHex.z * hexOn);
    float eye = 1.0 - smoothstep(0.05 * hs, 0.16 * hs, colat);
    col = mix(col, uHexColor * 0.35, eye * 0.9 * hexOn);
  }
  {
    float capOn = step(0.0001, uCaps.w);
    float pn = smoothstep(uCaps.x - uCaps.z, uCaps.x + uCaps.z + 0.0001, lat + 0.03 * warp);
    float ps = smoothstep(uCaps.y - uCaps.z, uCaps.y + uCaps.z + 0.0001, -lat + 0.03 * warp);
    col = mix(col, uCapColor, max(pn, ps) * uCaps.w * capOn);
  }
#else
  float n1 = fbm(p * uAlb.x + uSeed * 1.7, 6);
  float n2 = fbm(p * uAlb.x * 2.7 + 5.3 + uSeed, 5);
  float m = 0.5 + n1 * uAlb.y;
  col = m < 0.5 ? mix(uC[0], uC[1], clamp(m * 2.0, 0.0, 1.0)) : mix(uC[1], uC[2], clamp(m * 2.0 - 1.0, 0.0, 1.0));
  col = mix(col, uC[3], smoothstep(0.3, 0.85, n2) * uAlb.z * 0.5);
  col *= 1.0 + clamp(Hm.x * uAlb.w, -0.35, 0.3);
  col = mix(col, uC[3] * 1.1, clamp(Hm.y * uEjecta, 0.0, 0.85));
  for (int i = 0; i < ${MAXV}; i++) {
    if (i >= uVolN) break;
    col = mix(col, uVolC[i], Hm.z * 0.45);
  }
  col = mix(col, uStripeColor, clamp(Hm.w, 0.0, 1.0) * (uStripes.x > 0.5 ? 1.0 : 0.0));
  if (uFrac.x > 0.0) col = mix(col, uFracColor, clamp(Hm.w, 0.0, 1.0) * 0.8);
  if (uTwo.w > -1.5) {
    float k = dot(p, uTwo.xyz) + 0.22 * fbm(p * 3.5 + uSeed * 2.0, 5) + 0.06 * snoise(p * 18.0);
    float dark = smoothstep(uTwo.w - uTwoSoft, uTwo.w + uTwoSoft, k);
    col = mix(col, uTwoColor * (0.85 + 0.3 * n2), dark);
  }
  if (uCaps.w > 0.0) {
    float e = 0.05 * fbm(p * 6.0 + 2.0, 4);
    float pn = smoothstep(uCaps.x - uCaps.z, uCaps.x + uCaps.z, lat + e);
    float ps = smoothstep(uCaps.y - uCaps.z, uCaps.y + uCaps.z, -lat + e);
    col = mix(col, uCapColor * (0.92 + 0.1 * n2), max(pn, ps) * uCaps.w);
    spec = max(spec, max(pn, ps) * 0.25);
  }
  if (uLakes.w > 0.5) {
    float lm = smoothstep(uLakes.x, uLakes.x + 0.12, lat);
    float ln = fbm(p * uLakes.z + uSeed * 3.0, 6) + 0.25 * lm;
    float lake = smoothstep(uLakes.y, uLakes.y + 0.03, ln) * lm;
    col = mix(col, uLakeColor, lake);
    col = mix(col, uLakeColor * 1.6, exp(-pow((ln - uLakes.y) * 30.0, 2.0)) * lm * 0.5);
    spec = max(spec, lake);
  }
#endif
  for (int i = 0; i < ${MAXS}; i++) {
    if (i >= uSpotN) break;
    float ro; float m = spotMask(p, i, ro);
    col = mix(col, uSpotC[i].rgb * (0.9 + 0.2 * snoise(p * 40.0 + float(i))), m * uSpotC[i].w);
  }
  gl_FragColor = vec4(sqrt(max(col, vec3(0.0))), spec);
}
#endif

#ifdef PASS_DET
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  int W = int(uRes.x), Hh = int(uRes.y);
  float h0 = texelFetch(tH, ip, 0).x;
  float hl = texelFetch(tH, ivec2((ip.x - 1 + W) % W, ip.y), 0).x;
  float hr = texelFetch(tH, ivec2((ip.x + 1) % W, ip.y), 0).x;
  float hd = texelFetch(tH, ivec2(ip.x, max(ip.y - 1, 0)), 0).x;
  float hu = texelFetch(tH, ivec2(ip.x, min(ip.y + 1, Hh - 1)), 0).x;
  float th = (1.0 - (float(ip.y) + 0.5) / uRes.y) * PI;
  float du = 2.0 * PI / uRes.x * max(sin(th), 0.004);
  float dv = PI / uRes.y;
  float gx = (hr - hl) / (2.0 * du), gy = (hu - hd) / (2.0 * dv);
  float fadeP = smoothstep(0.004, 0.03, sin(th));
  vec3 p = sphereDir(vUv);
  float emis = 0.0;
  for (int i = 0; i < ${MAXS}; i++) {
    if (i >= uSpotN) break;
    if (uSpotB[i].z <= 0.0) continue;
    float ro; float m = spotMask(p, i, ro);
    emis += m * uSpotB[i].z * (0.6 + 0.6 * fbm(p * 60.0 + float(i), 3));
  }
  gl_FragColor = vec4(gx * uRelief * fadeP, gy * uRelief * fadeP, emis, h0);
}
#endif

#ifdef PASS_CLOUD
void main(){
  vec3 p = sphereDir(vUv);
  float lat = abs(asin(clamp(p.y, -1.0, 1.0)));
  vec3 q = vec3(p.x * uCloud.y, p.y * uCloud.y * uCloud.z, p.z * uCloud.y);
  float n = fbm(q + uCloud.w * 3.0 + vec3(0.3 * snoise(p * 3.0)), 6) * 0.5 + 0.5;
  float band = smoothstep(uCloudLat.x, uCloudLat.y, lat) * (1.0 - smoothstep(uCloudLat.z, uCloudLat.w, lat));
  float a = smoothstep(uCloud.x, uCloud.x + 0.18, n) * band;
  vec3 c = uCloudColor * (0.85 + 0.3 * n);
  gl_FragColor = vec4(sqrt(c), a);
}
#endif
`;

// ------------------------------------------------------------------ yüzey (kare başına)
const SURF_VERT = /* glsl */`
uniform sampler2D tDetail; uniform float uDisp;
varying vec2 vUv; varying vec3 vObjN; varying vec3 vWorldPos;
void main(){
  vUv = uv;
  vec3 n = normalize(position);
  float h = uDisp > 0.0 ? textureLod(tDetail, uv, 0.0).w : 0.0;
  vec3 pos = n * (1.0 + h * uDisp);
  vObjN = n;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SURF_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAlbedo, tDetail, tClouds, tRing;
uniform mat3 uRot;
uniform vec3 uSunDir, uSunColor, uFillDir, uFillColor;
uniform float uAmbient, uWrap, uTime, uFlow, uBump;
uniform vec4 uCloudP;           // speed, opacity, on, shadow
uniform vec2 uSpec;              // amount, power
uniform vec3 uAtmoColor; uniform float uAtmoInt;
uniform vec3 uEmisColor; uniform float uEmis;
uniform vec4 uHaze; uniform vec3 uHazeColor;  // amount, reveal, 0, 0
uniform vec4 uRingSh;           // inner, outer, on, strength
uniform vec3 uRingN, uCenter; uniform float uRadiusW;
uniform vec4 uScan; uniform vec3 uScanAxis, uScanColor;   // progress, intensity
uniform vec4 uStreak; uniform vec3 uStreakColor;          // speed, intensity, count, 0
uniform float uExposure;
varying vec2 vUv; varying vec3 vObjN; varying vec3 vWorldPos;
float hsh(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float gridLine(float x, float w){ float d = abs(fract(x + 0.5) - 0.5); return 1.0 - smoothstep(0.0, w * 1.5, d); }
void main(){
  vec3 n = normalize(vObjN);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  vec2 uv = vUv;
#ifdef GAS
  float jet = (0.55 * cos(lat * 2.0) + 0.45 * cos(lat * 9.0 + 0.7)) * smoothstep(1.45, 1.05, abs(lat));
  uv.x += uTime * uFlow * jet;
#endif
  vec4 alb = texture(tAlbedo, uv);
  vec3 base = alb.rgb * alb.rgb;
  vec4 det = texture(tDetail, uv);
  float cloudA = 0.0;
#ifdef CLOUDS
  vec4 cl = texture(tClouds, vUv + vec2(uTime * uCloudP.x * (0.75 + 0.25 * cos(lat * 3.0)), 0.0));
  cloudA = cl.a * uCloudP.y;
  base = mix(base, cl.rgb * cl.rgb, cloudA);
#endif
  vec3 T = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-6, 0.0, 0.0));
  vec3 B = cross(n, T);
  vec3 nObj = normalize(n - uBump * (1.0 - cloudA) * (det.x * T + det.y * B));
  vec3 N = normalize(uRot * nObj);
  vec3 Ng = normalize(uRot * n);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndlG = dot(Ng, L);
  float term = smoothstep(-0.08 - uWrap * 0.25, 0.14, ndlG);
  float ndl = dot(N, L);
  float diff = clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0) * term;
  float shadow = 1.0;
  if (uRingSh.z > 0.5) {
    float dn = dot(L, uRingN);
    if (abs(dn) > 1e-4) {
      float tt = dot(uCenter - vWorldPos, uRingN) / dn;
      if (tt > 0.0) {
        float rr = length(vWorldPos + L * tt - uCenter) / uRadiusW;
        if (rr > uRingSh.x && rr < uRingSh.y) shadow = 1.0 - texture(tRing, vec2((rr - uRingSh.x) / (uRingSh.y - uRingSh.x), 0.5)).a * uRingSh.w;
      }
    }
  }
  vec3 col = base * uSunColor * diff * shadow;
  vec3 H = normalize(L + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), uSpec.y) * alb.a * uSpec.x * term * shadow;
  col += base * uAmbient;
  col += base * uFillColor * max(dot(N, uFillDir), 0.0);
  col += uEmisColor * det.z * uEmis * (0.7 + 0.6 * (1.0 - term));
  float mu = max(dot(Ng, V), 0.0);
  float fres = 1.0 - mu;
  if (uHaze.x > 0.0) {
    float rev = 0.0;
    if (uHaze.y > 0.0) {
      float y0 = 1.0 - 2.2 * uHaze.y;
      rev = smoothstep(y0 - 0.04, y0 + 0.04, n.y);
      float line = exp(-pow((n.y - y0) * 35.0, 2.0)) * step(0.001, uHaze.y) * (1.0 - smoothstep(0.85, 1.0, uHaze.y));
      col += uScanColor * line * 2.5 * (0.3 + 0.7 * term);
    }
    float hz = uHaze.x * (1.0 - rev * 0.92);
    float hl = clamp((ndlG + 0.35) / 1.35, 0.0, 1.0);
    vec3 hc = uHazeColor * uSunColor * (hl * (0.75 + 0.5 * pow(fres, 2.0)));
    col = mix(col, hc, hz * (0.82 + 0.18 * fres));
  }
  float rim = pow(fres, 2.6);
  col += uAtmoColor * rim * uAtmoInt * smoothstep(-0.3, 0.55, ndlG);
  if (uStreak.y > 0.0) {
    float row = vUv.y * uStreak.z;
    float ri = floor(row);
    float on = step(0.62, hsh(ri + 3.0)) * smoothstep(1.2, 0.7, abs(lat));
    float rw = abs(fract(row) - 0.5);
    float lineM = smoothstep(0.09, 0.0, rw);
    float x = vUv.x * (3.0 + 4.0 * hsh(ri)) + uTime * uStreak.x * (0.7 + 0.6 * hsh(ri + 9.0)) + hsh(ri + 5.0);
    float fx = fract(x);
    float dash = smoothstep(0.0, 0.05, fx) * (1.0 - smoothstep(0.05, 0.55, fx));
    col += uStreakColor * dash * lineM * on * uStreak.y * (0.35 + 0.65 * term);
  }
  if (uScan.y > 0.0 && uScan.x > 0.0 && uScan.x < 1.0) {
    float y = dot(Ng, uScanAxis);
    float pos = 1.05 - 2.1 * uScan.x;
    float line = exp(-pow((y - pos) * 28.0, 2.0));
    float trail = smoothstep(pos, pos + 0.04, y) * (1.0 - smoothstep(pos + 0.04, pos + 0.75, y));
    float g = max(gridLine(vUv.x * 36.0, fwidth(vUv.x * 36.0)), gridLine(vUv.y * 18.0, fwidth(vUv.y * 18.0)));
    col += uScanColor * (line * 1.6 + trail * g * 0.9 + trail * 0.06) * uScan.y;
  }
  gl_FragColor = vec4(col * uExposure, 1.0);
}`;

// ------------------------------------------------------------------ atmosfer kabuğu
const ATMO_VERT = 'varying vec3 vWorldPos; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';
const ATMO_FRAG = /* glsl */`
uniform vec3 uCenter, uSunDir, uColor; uniform float uR, uRa, uInt, uScatter;
varying vec3 vWorldPos;
void main(){
  vec3 ro = cameraPosition; vec3 rd = normalize(vWorldPos - ro);
  float tca = dot(uCenter - ro, rd);
  vec3 cp = ro + rd * tca;
  float b = length(cp - uCenter) / uR;
  float x = clamp((b - 1.0) / (uRa - 1.0), 0.0, 1.0);
  float dens = exp(-x * 4.5) * (1.0 - smoothstep(0.75, 1.0, x));
  if (b < 1.0) dens *= 0.0;
  vec3 cdir = normalize(cp - uCenter);
  float lit = smoothstep(-0.4, 0.55, dot(cdir, uSunDir));
  float fwd = pow(max(dot(rd, uSunDir), 0.0), 5.0) * uScatter;
  gl_FragColor = vec4(uColor * dens * (lit + fwd * 3.0) * uInt, 1.0);
}`;

// ------------------------------------------------------------------ halkalar
const RING_VERT = 'varying vec3 vLocal; varying vec3 vWorldPos; void main(){ vLocal = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';
const RING_FRAG = /* glsl */`
uniform sampler2D tRing; uniform float uIn, uOut, uR, uOpacity; uniform vec3 uSunDir, uCenter, uN, uSunColor;
varying vec3 vLocal; varying vec3 vWorldPos;
void main(){
  float r = length(vLocal.xy);
  float k = (r - uIn) / (uOut - uIn);
  if (k < 0.0 || k > 1.0) discard;
  vec4 s = texture(tRing, vec2(k, 0.5));
  if (s.a < 0.004) discard;
  vec3 oc = vWorldPos - uCenter;
  float bq = dot(oc, uSunDir); float c = dot(oc, oc) - uR * uR; float h = bq * bq - c;
  float sh = (h > 0.0 && bq < 0.0) ? 1.0 - smoothstep(0.0, 0.08 * uR * uR, h) * 0.94 : 1.0;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float sl = dot(uN, uSunDir), sv = dot(uN, V);
  float lit = 0.25 + 0.75 * abs(sl);
  float same = step(0.0, sl * sv);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 6.0);
  vec3 cc = s.rgb * s.rgb;
  vec3 col = cc * uSunColor * (same > 0.5 ? lit : lit * (0.18 + 0.7 * (1.0 - s.a))) * sh;
  col += cc * uSunColor * fwd * (1.0 - s.a) * 1.5 * sh;
  gl_FragColor = vec4(col, s.a * uOpacity);
}`;

// ------------------------------------------------------------------ püskürmeler
const PLUME_VERT = /* glsl */`
attribute vec3 aBase; attribute vec4 aSeed;
uniform float uTime, uHeight, uSpread, uKind, uRate, uSize, uProj;
uniform vec3 uSunDirL;
varying float vA; varying float vFwd;
void main(){
  vec3 n = normalize(aBase);
  vec3 t1 = normalize(abs(n.y) > 0.9 ? cross(n, vec3(1.0, 0.0, 0.0)) : cross(n, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(n, t1);
  float age = fract(uTime * uRate * (0.8 + 0.4 * aSeed.z) + aSeed.x);
  float ang = aSeed.y * 6.2831853;
  vec3 td = t1 * cos(ang) + t2 * sin(ang);
  vec3 pos;
  float sz = uSize * aSeed.w;
  if (uKind < 0.5) {
    float hor = uSpread * sqrt(aSeed.z);
    pos = n * (1.0 + uHeight * (0.6 + 0.4 * aSeed.z) * 4.0 * age * (1.0 - age)) + td * hor * age;
    vA = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.78, 1.0, age)) * (0.55 + 0.45 * (1.0 - aSeed.z));
    sz *= 0.7 + 0.8 * age;
  } else {
    float d = pow(age, 0.75);
    vec3 dir = normalize(n + td * uSpread * aSeed.z);
    pos = n * 1.0 + dir * uHeight * d;
    vA = (1.0 - age) * smoothstep(0.0, 0.04, age);
    sz *= 0.6 + 1.6 * d;
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec3 wdir = normalize((modelMatrix * vec4(pos, 1.0)).xyz - cameraPosition);
  vFwd = pow(max(dot(wdir, uSunDirL), 0.0), 3.0);
  gl_PointSize = clamp(sz * uProj / -mv.z, 1.0, 48.0);
  gl_Position = projectionMatrix * mv;
}`;
const PLUME_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vA; varying float vFwd;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = exp(-d * d * 3.5) * (1.0 - smoothstep(0.85, 1.0, d));
  gl_FragColor = vec4(uColor * a * vA * uOpacity * (0.45 + 2.2 * vFwd), 1.0);
}`;

// ------------------------------------------------------------------ eksen / dönüş oku
const GIZMO_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const GIZMO_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uReveal, uTime, uMode, uOpacity;
varying vec2 vUv;
void main(){
  float a;
  if (uMode < 0.5) {               // eksen çizgisi: merkezden dışa doğru büyür
    float d = abs(vUv.y - 0.5) * 2.0;
    if (d > uReveal) discard;
    float dash = step(0.45, fract(vUv.y * 26.0 - uTime * 0.8));
    a = mix(1.0, dash, smoothstep(0.32, 0.4, d));
  } else {                          // dönüş oku: yay boyunca çizilir
    if (vUv.x > uReveal) discard;
    float flow = 0.55 + 0.45 * smoothstep(0.0, 0.3, fract(vUv.x * 9.0 - uTime * 1.4));
    a = flow * smoothstep(0.0, 0.06, vUv.x);
  }
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

// ------------------------------------------------------------------ yardımcılar
function color(c) { return new THREE.Color(c); }
const V4 = () => new THREE.Vector4(0, 0, 0, 0); // dikkat: THREE.Vector4() varsayılanı w = 1
function vec4s(n) { return Array.from({ length: n }, V4); }
function vec3s(n) { return Array.from({ length: n }, () => new THREE.Color(0, 0, 0)); }

function ringProfile(r, seed) {
  const N = 1024;
  const data = new Uint8Array(N * 4);
  const rng = mulberry32(seed);
  const c1 = color(r.color || '#d8c8a8'), c2 = color(r.color2 || r.color || '#a89878');
  const lin = (c) => [Math.sqrt(c.r), Math.sqrt(c.g), Math.sqrt(c.b)];
  const A = lin(c1), B = lin(c2);
  const style = r.style || 'saturn';
  const inner = r.inner ?? 1.24, outer = r.outer ?? 2.27;
  // yumuşak rastgele dalgalanmalar
  const waves = Array.from({ length: 40 }, () => ({ f: 20 + rng() * 380, p: rng() * 6.28, a: rng() }));
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const R = inner + (outer - inner) * k;
    let w = 0;
    for (const s of waves) w += Math.sin(k * s.f + s.p) * s.a;
    w = 0.5 + 0.5 * Math.tanh(w * 0.25);
    let dens, mixc;
    if (style === 'saturn') {
      // C halkası (soluk) → B (yoğun) → Cassini boşluğu → A → Encke boşluğu
      if (R < 1.525) dens = 0.12 + 0.12 * w;
      else if (R < 1.95) dens = 0.62 + 0.36 * w;
      else if (R < 2.025) dens = 0.03 + 0.03 * w;
      else if (R < 2.27) dens = 0.42 + 0.3 * w;
      else dens = 0.0;
      if (Math.abs(R - 2.214) < 0.006) dens *= 0.1;
      mixc = R < 1.525 ? 0.85 : R < 1.95 ? 0.15 + 0.3 * w : 0.45 + 0.3 * w;
    } else if (style === 'thin') {
      // Uranüs: dar, koyu halkalar
      dens = 0.02;
      for (const rr of r.lines || [0.25, 0.42, 0.5, 0.58, 0.66, 0.74, 0.97]) {
        const dd = Math.abs(k - rr);
        dens = Math.max(dens, Math.exp(-Math.pow(dd / (rr > 0.95 ? 0.009 : 0.0045), 2)) * (rr > 0.95 ? 0.95 : 0.6));
      }
      mixc = w;
    } else {
      dens = (0.15 + 0.5 * w) * Math.sin(Math.PI * k);
      mixc = w;
    }
    const edge = Math.min(1, k / 0.02, (1 - k) / 0.02);
    dens *= Math.max(0, edge);
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(255 * clamp(A[c] * (1 - mixc) + B[c] * mixc));
    data[i * 4 + 3] = Math.round(255 * clamp(dens));
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

let _quadScene = null, _quadCam = null, _quad = null;
function quad() {
  if (!_quadScene) {
    _quadScene = new THREE.Scene();
    _quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    _quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    _quad.frustumCulled = false;
    _quadScene.add(_quad);
  }
  return { scene: _quadScene, cam: _quadCam, mesh: _quad };
}

// ------------------------------------------------------------------ Planet
export class Planet {
  constructor(renderer, input, opts = {}) {
    this.p = deepMerge(PLANET_DEFAULTS, input || {});
    this.name = opts.name || 'planet';
    this.renderer = renderer;
    this.gas = this.p.type === 'gas';
    this.res = Math.min(this.p.res || 2048, opts.maxRes || 4096);
    this.seed = (this.p.seed ?? 1) + (hashString(this.name) % 97) * 0.37;
    this.group = new THREE.Group(); this.group.name = 'planet:' + this.name;
    this.tiltGroup = new THREE.Group();
    this.spinGroup = new THREE.Group();
    this.group.add(this.tiltGroup); this.tiltGroup.add(this.spinGroup);
    this.tiltGroup.rotation.set(0, (this.p.tiltYaw || 0) * D2R, 0, 'YXZ');
    this.tiltGroup.rotateZ(-(this.p.tilt || 0) * D2R);
    this._sunDir = new THREE.Vector3(1, 0.3, 0.5).normalize();
    this.bake();
    this._buildSurface();
    this._buildAtmosphere();
    this._buildRings();
    this._buildPlumes();
    this._buildGizmo();
    this.radius = 1;
  }

  // -------------------------------------------------------------- bake
  _bakeUniforms() {
    const p = this.p;
    const u = {
      uSeed: { value: this.seed }, uRes: { value: new THREE.Vector2(this.res, this.res / 2) },
      uTerr: { value: new THREE.Vector4(p.terrain.scale, p.terrain.amount, p.terrain.ridged, p.terrain.warp) },
      uCrat: { value: new THREE.Vector4(p.craters.density || 0, p.craters.size ?? 1, p.craters.depth ?? 0.6, 0) },
      uVolA: { value: vec4s(MAXV) }, uVolB: { value: vec4s(MAXV) }, uVolC: { value: vec3s(MAXV) }, uVolN: { value: 0 },
      uCanA: { value: vec4s(MAXC) }, uCanB: { value: vec4s(MAXC) }, uCanN: { value: 0 },
      uSpotA: { value: vec4s(MAXS) }, uSpotB: { value: vec4s(MAXS) }, uSpotC: { value: vec4s(MAXS) }, uSpotN: { value: 0 },
      uRidge: { value: V4() }, uStripes: { value: V4() }, uStripes2: { value: V4() },
      uStripeColor: { value: color('#3b8fd8') }, uFrac: { value: V4() }, uFracColor: { value: color('#9a6a4a') },
      uC: { value: p.colors.slice(0, 4).concat(Array(4).fill(p.colors[p.colors.length - 1])).slice(0, 4).map(color) },
      uAlb: { value: new THREE.Vector4(p.albedo.scale, p.albedo.contrast, p.albedo.accent, p.albedo.heightTint) },
      uEjecta: { value: p.albedo.ejecta ?? 0.6 },
      uCaps: { value: new THREE.Vector4(0, 0, 0, 0) }, uCapColor: { value: color('#ffffff') },
      uTwo: { value: new THREE.Vector4(0, 0, 0, -2) }, uTwoColor: { value: color('#1a120c') }, uTwoSoft: { value: 0.08 },
      uLakes: { value: V4() }, uLakeColor: { value: color('#101820') },
      uBands: { value: new THREE.Vector4(p.bands.count, p.bands.turbulence, p.bands.contrast, p.bands.streaks) },
      uVShape: { value: p.vshape || 0 },
      uStA: { value: vec4s(MAXST) }, uStB: { value: vec4s(MAXST) }, uStC: { value: vec4s(MAXST) }, uStN: { value: 0 },
      uHex: { value: V4() }, uHexColor: { value: color('#6f8c96') }, uHexEdge: { value: color('#e8dcc0') },
      uCloud: { value: new THREE.Vector4(0.6, 3, 4, 1) }, uCloudLat: { value: new THREE.Vector4(-1, 0, 2, 3) }, uCloudColor: { value: color('#ffffff') },
      uRelief: { value: 1.0 }, tH: { value: null },
    };
    (p.volcanoes || []).slice(0, MAXV).forEach((v, i) => {
      const d = dirLL(v.lat, v.lon);
      u.uVolA.value[i].set(d.x, d.y, d.z, (v.size ?? 8) * D2R);
      u.uVolB.value[i].set(v.height ?? 0.02, v.caldera ?? 0.12, 0, 0);
      u.uVolC.value[i].set(v.color || p.colors[2]);
    });
    u.uVolN.value = Math.min(MAXV, (p.volcanoes || []).length);
    (p.canyons || []).slice(0, MAXC).forEach((c, i) => {
      const a = dirLL(c.from[0], c.from[1]), b = dirLL(c.to[0], c.to[1]);
      u.uCanA.value[i].set(a.x, a.y, a.z, (c.width ?? 1.5) * D2R);
      u.uCanB.value[i].set(b.x, b.y, b.z, c.depth ?? 0.01);
    });
    u.uCanN.value = Math.min(MAXC, (p.canyons || []).length);
    (p.spots || []).slice(0, MAXS).forEach((s, i) => {
      const d = dirLL(s.lat, s.lon);
      u.uSpotA.value[i].set(d.x, d.y, d.z, (s.size ?? 5) * D2R);
      u.uSpotB.value[i].set(s.soft ?? 0.3, s.ring ?? 0, s.emissive ?? 0, s.height ?? 0);
      const c = color(s.color || '#000000');
      u.uSpotC.value[i].set(c.r, c.g, c.b, s.opacity ?? 1);
    });
    u.uSpotN.value = Math.min(MAXS, (p.spots || []).length);
    if (p.ridge) u.uRidge.value.set(p.ridge.height ?? 0.02, (p.ridge.width ?? 2.5) * D2R, (p.ridge.lon0 ?? 0) * D2R, (p.ridge.lon1 ?? 360) * D2R);
    if (p.stripes) {
      const s = p.stripes;
      u.uStripes.value.set(s.count ?? 4, s.spacing ?? 0.085, s.length ?? 0.2, s.width ?? 0.012);
      u.uStripes2.value.set((s.angle ?? 20) * D2R, s.depth ?? 0.004, 0, 0);
      if (s.color) u.uStripeColor.value.set(s.color);
    }
    if (p.fractures) {
      u.uFrac.value.set(p.fractures.amount ?? 0.8, p.fractures.scale ?? 3, p.fractures.height ?? 0.0015, 0);
      if (p.fractures.color) u.uFracColor.value.set(p.fractures.color);
    }
    if (p.caps) {
      u.uCaps.value.set((p.caps.north ?? 90) * D2R, (p.caps.south ?? 90) * D2R, (p.caps.soft ?? 3) * D2R, p.caps.amount ?? 1);
      if (p.caps.color) u.uCapColor.value.set(p.caps.color);
    }
    if (p.twotone) {
      const d = dirLL(p.twotone.lat ?? 0, p.twotone.lon ?? 90);
      u.uTwo.value.set(d.x, d.y, d.z, p.twotone.threshold ?? 0.05);
      u.uTwoColor.value.set(p.twotone.color || '#1a120c');
      u.uTwoSoft.value = p.twotone.soft ?? 0.08;
    }
    if (p.lakes) {
      u.uLakes.value.set((p.lakes.lat ?? 55) * D2R, p.lakes.coverage ?? 0.1, p.lakes.scale ?? 4, 1);
      if (p.lakes.color) u.uLakeColor.value.set(p.lakes.color);
    }
    (p.storms || []).slice(0, MAXST).forEach((s, i) => {
      const d = dirLL(s.lat, s.lon);
      u.uStA.value[i].set(d.x, d.y, d.z, (s.size ?? 8) * D2R);
      u.uStB.value[i].set(s.aspect ?? 1.6, s.swirl ?? 2.5, 0, 0);
      const c = color(s.color || '#c0603a');
      u.uStC.value[i].set(c.r, c.g, c.b, s.amount ?? 0.9);
    });
    u.uStN.value = Math.min(MAXST, (p.storms || []).length);
    if (p.hexagon) {
      u.uHex.value.set((p.hexagon.size ?? 14) * D2R, (p.hexagon.rot ?? 0) * D2R, p.hexagon.edge ?? 0.6, 1);
      if (p.hexagon.color) u.uHexColor.value.set(p.hexagon.color);
      if (p.hexagon.edgeColor) u.uHexEdge.value.set(p.hexagon.edgeColor);
    }
    if (p.clouds) {
      const c = p.clouds, la = c.lat || [-1, 0, 100, 101];
      u.uCloud.value.set(c.coverage ?? 0.55, c.scale ?? 3, c.stretch ?? 4, this.seed + 7);
      u.uCloudLat.value.set(la[0] * D2R, la[1] * D2R, la[2] * D2R, la[3] * D2R);
      if (c.color) u.uCloudColor.value.set(c.color);
    }
    return u;
  }

  _pass(defs, target, uniforms) {
    const r = this.renderer;
    const q = quad();
    const defines = {}; for (const d of defs) defines[d] = '';
    if (this.gas) defines.GAS = '';
    const mat = new THREE.ShaderMaterial({ uniforms, defines, vertexShader: FS_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false });
    q.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(q.scene, q.cam);
    r.setRenderTarget(null);
    mat.dispose();
  }

  bake() {
    const W = this.res, H = this.res / 2;
    const u = this._bakeUniforms();
    const hRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    const mk = (type) => {
      const rt = new THREE.WebGLRenderTarget(W, H, {
        type, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 4,
      });
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    this.albRT = mk(THREE.UnsignedByteType);
    this.detRT = mk(THREE.HalfFloatType);
    this._pass(['PASS_H'], hRT, u);
    u.tH.value = hRT.texture;
    this._pass(['PASS_ALB'], this.albRT, u);
    u.uRelief.value = this.p.relief ?? 1;
    this._pass(['PASS_DET'], this.detRT, u);
    if (this.p.clouds) {
      this.cloudRT = mk(THREE.UnsignedByteType);
      this._pass(['PASS_CLOUD'], this.cloudRT, u);
    }
    hRT.dispose();
  }

  // -------------------------------------------------------------- parçalar
  _buildSurface() {
    const p = this.p;
    const seg = p.displace > 0 ? [288, 144] : [192, 96];
    const geo = new THREE.SphereGeometry(1, seg[0], seg[1]);
    const ringTex = p.rings ? ringProfile(p.rings, hashString(this.name)) : new THREE.DataTexture(new Uint8Array(4), 1, 1);
    ringTex.needsUpdate = true;
    this.ringTex = ringTex;
    const at = p.atmosphere || {};
    const haze = p.haze;
    this.su = {
      tAlbedo: { value: this.albRT.texture }, tDetail: { value: this.detRT.texture }, tClouds: { value: this.cloudRT ? this.cloudRT.texture : this.albRT.texture }, tRing: { value: ringTex },
      uRot: { value: new THREE.Matrix3() },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunColor: { value: color('#fff6ea').multiplyScalar(1.25) },
      uFillDir: { value: new THREE.Vector3(-1, 0, 0) }, uFillColor: { value: color('#2a3b66').multiplyScalar(0.05) },
      uAmbient: { value: p.ambient ?? 0.012 }, uWrap: { value: p.wrap ?? 0 }, uTime: { value: 0 }, uFlow: { value: p.bands.flow ?? 0.004 },
      uBump: { value: 1.0 }, uDisp: { value: p.displace || 0 },
      uCloudP: { value: new THREE.Vector4(p.clouds?.speed ?? 0.006, p.clouds?.opacity ?? 0.9, p.clouds ? 1 : 0, 0) },
      uSpec: { value: new THREE.Vector2(p.specular?.amount ?? 0, p.specular?.power ?? 40) },
      uAtmoColor: { value: color(at.color || '#7fb2ff') }, uAtmoInt: { value: p.atmosphere ? (at.rim ?? 0.6) : 0 },
      uEmisColor: { value: color(p.emissive?.color || '#ff7a2a') }, uEmis: { value: p.emissive?.strength ?? 0 },
      uHaze: { value: new THREE.Vector4(haze ? haze.amount ?? 0.9 : 0, 0, 0, 0) }, uHazeColor: { value: color(haze?.color || '#d19a4a') },
      uRingSh: { value: new THREE.Vector4(p.rings?.inner ?? 1.2, p.rings?.outer ?? 2.3, p.rings && p.rings.shadow !== false ? 1 : 0, 0.85) },
      uRingN: { value: new THREE.Vector3(0, 1, 0) }, uCenter: { value: new THREE.Vector3() }, uRadiusW: { value: 1 },
      uScan: { value: V4() }, uScanAxis: { value: new THREE.Vector3(0, 1, 0) }, uScanColor: { value: color('#5ee7ff') },
      uStreak: { value: new THREE.Vector4(p.streaks?.speed ?? 0.25, 0, p.streaks?.count ?? 40, 0) }, uStreakColor: { value: color(p.streaks?.color || '#cfe8ff') },
      uExposure: { value: 1.0 },
    };
    const defines = {};
    if (this.gas) defines.GAS = '';
    if (this.cloudRT) defines.CLOUDS = '';
    this.surfMat = new THREE.ShaderMaterial({ uniforms: this.su, defines, vertexShader: SURF_VERT, fragmentShader: SURF_FRAG });
    this.surface = new THREE.Mesh(geo, this.surfMat);
    this.spinGroup.add(this.surface);
  }

  _buildAtmosphere() {
    const at = this.p.atmosphere;
    if (!at) return;
    const ra = 1 + (at.thickness ?? 0.06);
    this.au = {
      uCenter: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: color(at.color || '#7fb2ff') },
      uR: { value: 1 }, uRa: { value: ra }, uInt: { value: at.intensity ?? 1.0 }, uScatter: { value: at.scatter ?? 1.0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.au, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(ra, 96, 48), mat);
    this.atmo.renderOrder = 2;
    this.group.add(this.atmo);
  }

  _buildRings() {
    const r = this.p.rings;
    if (!r) return;
    const inner = r.inner ?? 1.24, outer = r.outer ?? 2.27;
    this.ru = {
      tRing: { value: this.ringTex }, uIn: { value: inner }, uOut: { value: outer }, uR: { value: 1 }, uOpacity: { value: r.opacity ?? 1 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uCenter: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: color('#fff6ea').multiplyScalar(1.25) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.ru, vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide,
      transparent: true, depthWrite: false });
    const geo = new THREE.RingGeometry(inner, outer, 256, 1);
    this.rings = new THREE.Mesh(geo, mat);
    this.rings.rotation.x = -Math.PI / 2;
    this.rings.renderOrder = 3;
    this.tiltGroup.add(this.rings);
  }

  _buildPlumes() {
    this.plumes = [];
    const st = this.p.stripes;
    for (const [pi, pl] of (this.p.plumes || []).entries()) {
      const vents = [];
      if (pl.along === 'stripes' && st) {
        const count = st.count ?? 4, sp = st.spacing ?? 0.085, len = st.length ?? 0.2, ang = (st.angle ?? 20) * D2R;
        const per = pl.vents ?? 5;
        for (let k = 0; k < count; k++) {
          const off = (k - (count - 1) / 2) * sp;
          const L = len * (1 - 0.12 * Math.abs(k - (count - 1) / 2));
          for (let j = 0; j < per; j++) {
            const x = (-0.8 + 1.6 * (j + 0.5) / per) * L;
            // döndürülmüş (x, off) → (px, pz)
            const px = Math.cos(-ang) * x - Math.sin(-ang) * off, pz = Math.sin(-ang) * x + Math.cos(-ang) * off;
            vents.push(new THREE.Vector3(px, -Math.sqrt(Math.max(0, 1 - px * px - pz * pz)), pz).normalize());
          }
        }
      } else {
        vents.push(dirLL(pl.lat ?? 0, pl.lon ?? 0));
      }
      const count = pl.count ?? 2500;
      const rng = mulberry32(hashString(this.name) + pi * 31);
      const base = new Float32Array(count * 3), seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const v = vents[i % vents.length];
        base.set([v.x, v.y, v.z], i * 3);
        seed.set([rng(), rng(), rng(), 0.4 + rng() * 1.2], i * 4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const u = {
        uTime: { value: 0 }, uHeight: { value: pl.height ?? 0.3 }, uSpread: { value: pl.spread ?? 0.3 }, uKind: { value: pl.kind === 'jet' ? 1 : 0 },
        uRate: { value: pl.rate ?? 0.35 }, uSize: { value: pl.size ?? 0.012 }, uProj: { value: 1500 },
        uColor: { value: color(pl.color || '#cfe4ff').multiplyScalar(pl.brightness ?? 1.0) }, uOpacity: { value: pl.opacity ?? 0.5 },
        uSunDirL: { value: new THREE.Vector3(1, 0, 0) },
      };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 4;
      this.spinGroup.add(pts);
      this.plumes.push({ pts, u, spec: pl, vent: vents[Math.floor(vents.length / 2)] });
    }
  }

  _buildGizmo() {
    const mk = (mode) => new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color('#8ff3ff').multiplyScalar(1.6) }, uReveal: { value: 0 }, uTime: { value: 0 }, uMode: { value: mode }, uOpacity: { value: 1 } },
      vertexShader: GIZMO_VERT, fragmentShader: GIZMO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.gizmo = new THREE.Group();
    this.axisMat = mk(0);
    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 3.3, 8, 1, true), this.axisMat);
    this.gizmo.add(axis);
    this.arcMat = mk(1);
    const arcLen = Math.PI * 1.55;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.016, 8, 220, arcLen), this.arcMat);
    arc.rotation.x = -Math.PI / 2;
    this.arcGroup = new THREE.Group();
    this.arcGroup.add(arc);
    const headMat = new THREE.MeshBasicMaterial({ color: color('#8ff3ff').multiplyScalar(1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 16), headMat);
    this.arcGroup.add(this.arrowHead);
    this.arcLen = arcLen;
    if (this.p.spin < 0) this.arcGroup.scale.z = -1;
    this.gizmo.add(this.arcGroup);
    this.gizmo.visible = false;
    this.gizmo.renderOrder = 5;
    this.tiltGroup.add(this.gizmo);
  }

  // -------------------------------------------------------------- arayüz
  setVisible(v) { this.group.visible = v; }

  setScale(s) { this.group.scale.setScalar(s); this.radius = s; }

  spinAngle(t) { return (this.p.phase || 0) * D2R + (this.p.spin ?? 0.025) * t; }

  // planet yerel koordinatında (enlem, boylam) yönünü dünya yönüne çevirir — t anındaki dönüşle
  dirWorld(lat, lon, t) {
    const d = dirLL(lat, lon);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle(t));
    d.applyQuaternion(q).applyQuaternion(this.tiltGroup.quaternion).applyQuaternion(this.group.quaternion);
    return d.normalize();
  }

  axisWorld() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.tiltGroup.quaternion).applyQuaternion(this.group.quaternion).normalize(); }

  anchorLocal(a) {
    const p = this.p;
    if (a && typeof a === 'object') return { lat: a.lat ?? 0, lon: a.lon ?? 0, h: a.h ?? 0 };
    if (p.anchors && p.anchors[a]) return { h: 0, ...p.anchors[a] };
    switch (a) {
      case 'north_pole': return { lat: 87, lon: 0, h: 0 };
      case 'south_pole': return { lat: -87, lon: 0, h: 0 };
      case 'volcano': { const v = (p.volcanoes || [])[0]; if (v) return { lat: v.lat, lon: v.lon, h: (v.height ?? 0.02) * (p.displace || 0) }; break; }
      case 'storm': { const s = (p.storms || [])[0]; if (s) return { lat: s.lat, lon: s.lon, h: 0 }; break; }
      case 'spot': { const s = (p.spots || [])[0]; if (s) return { lat: s.lat, lon: s.lon, h: 0 }; break; }
      case 'plume': { const pl = this.plumes[0]; if (pl) { const v = pl.vent; return { dir: v.clone(), h: (pl.spec.height ?? 0.3) * (pl.spec.kind === 'jet' ? 0.35 : 0.8) }; } break; }
      case 'ridge': { const r = p.ridge; if (r) return { lat: 0, lon: ((r.lon0 ?? 0) + (r.lon1 ?? 360)) / 2, h: r.height ?? 0 }; break; }
      case 'lakes': { const l = p.lakes; if (l) return { lat: Math.min(85, (l.lat ?? 55) + 18), lon: l.lon ?? 0, h: 0 }; break; }
      case 'hexagon': { const h = p.hexagon; if (h) return { lat: 90 - (h.size ?? 14) * 0.95, lon: h.anchorLon ?? 30, h: 0 }; break; }
      case 'stripes': return { lat: -82, lon: 0, h: 0 };
      case 'twotone': { const tt = p.twotone; if (tt) return { lat: tt.lat ?? 0, lon: tt.lon ?? 90, h: 0 }; break; }
      default: break;
    }
    return { lat: 20, lon: 0, h: 0 };
  }

  anchorWorld(a, t) {
    const al = this.anchorLocal(a);
    const d = al.dir ? al.dir.clone() : dirLL(al.lat, al.lon);
    const local = d.multiplyScalar(1 + (al.h || 0));
    this.group.updateMatrixWorld(true);
    // t anındaki dönüş zaten spinGroup'a uygulanmış olmalı
    return this.spinGroup.localToWorld(local);
  }

  anchorNormalWorld(a) {
    const al = this.anchorLocal(a);
    const d = al.dir ? al.dir.clone() : dirLL(al.lat, al.lon);
    return d.transformDirection(this.spinGroup.matrixWorld);
  }

  // ctx: { sunDir: Vector3 (dünya), proj, scan, scanAxis, axisReveal, reveal, streaks, exposure }
  update(t, ctx = {}) {
    this.spinGroup.rotation.y = this.spinAngle(t);
    this.group.updateMatrixWorld(true);
    const su = this.su;
    const L = ctx.sunDir || this._sunDir;
    su.uTime.value = t;
    su.uSunDir.value.copy(L);
    su.uFillDir.value.copy(L).multiplyScalar(-1).add(new THREE.Vector3(0, 0.4, 0)).normalize();
    const m4 = new THREE.Matrix4().extractRotation(this.spinGroup.matrixWorld);
    su.uRot.value.setFromMatrix4(m4);
    const center = new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld);
    const scale = this.group.scale.x;
    su.uCenter.value.copy(center); su.uRadiusW.value = scale;
    su.uRingN.value.set(0, 1, 0).applyQuaternion(this.tiltGroup.getWorldQuaternion(new THREE.Quaternion())).normalize();
    su.uScan.value.set(ctx.scan ?? 0, ctx.scan > 0 && ctx.scan < 1 ? 1 : 0, 0, 0);
    if (ctx.scanAxis) su.uScanAxis.value.copy(ctx.scanAxis);
    if (ctx.accent) { su.uScanColor.value.set(ctx.accent); }
    su.uHaze.value.y = ctx.reveal ?? 0;
    su.uStreak.value.y = (this.p.streaks ? (this.p.streaks.intensity ?? 0.8) : 0) * (ctx.streaks ?? 1);
    su.uExposure.value = ctx.exposure ?? 1;
    if (this.au) {
      this.au.uCenter.value.copy(center); this.au.uR.value = scale; this.au.uSunDir.value.copy(L);
      this.au.uRa.value = (1 + (this.p.atmosphere.thickness ?? 0.06)) * scale;
    }
    if (this.ru) {
      this.ru.uCenter.value.copy(center); this.ru.uR.value = scale; this.ru.uSunDir.value.copy(L); this.ru.uN.value.copy(su.uRingN.value);
    }
    const Ll = L.clone();
    for (const pl of this.plumes) {
      pl.u.uTime.value = t; pl.u.uProj.value = ctx.proj ?? 1500; pl.u.uSunDirL.value.copy(Ll);
      pl.u.uOpacity.value = (pl.spec.opacity ?? 0.5) * (ctx.plumes ?? 1);
    }
    const ar = ctx.axisReveal ?? 0;
    this.gizmo.visible = ar > 0.001;
    if (this.gizmo.visible) {
      const k = clamp(ar);
      this.axisMat.uniforms.uReveal.value = clamp(k * 1.6);
      this.axisMat.uniforms.uTime.value = t;
      const ak = clamp(k * 1.4 - 0.25);
      this.arcMat.uniforms.uReveal.value = ak;
      this.arcMat.uniforms.uTime.value = t;
      const fade = ctx.axisFade ?? 1;
      this.axisMat.uniforms.uOpacity.value = fade; this.arcMat.uniforms.uOpacity.value = fade;
      this.arrowHead.material.opacity = fade * (ak > 0.02 ? 1 : 0);
      // ok başı yay ucunda, teğet yönünde
      const u = ak * this.arcLen, R = 1.34;
      this.arrowHead.position.set(Math.cos(u) * R, 0, -Math.sin(u) * R);
      const tan = new THREE.Vector3(-Math.sin(u), 0, -Math.cos(u));
      this.arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      this.gizmo.rotation.y = this.spinAngle(t) * 0.0;
    }
  }

  dispose() {
    this.albRT.dispose(); this.detRT.dispose(); if (this.cloudRT) this.cloudRT.dispose();
  }
}
