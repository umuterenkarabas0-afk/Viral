// Son işlem: sahne render hedefi → küçültme zinciri (1/4, 1/8, 1/16) →
// tek tam ekran geçişinde FXAA, bloom, derinlik alanı (DOF), yönlü/zoom hareket
// bulanıklığı (geçişler), kromatik sapma, ACES ton eşleme, renk derecelendirme,
// vinyet, film greni, flaş ve "rüya" (halüsinasyon) efekti.
// Yazılım GPU'sunda (SwiftShader) hızlı olacak şekilde tasarlandı: MSAA ve
// glGenerateMipmap yerine FXAA + elle küçültme kullanılır.
import * as THREE from 'three';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Post {
  constructor(renderer, w, h, { msaa = 0 } = {}) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    const canHalf = renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
    const type = canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      samples: msaa, type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.rt.depthTexture = new THREE.DepthTexture(w, h);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    const mk = (d) => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d)), {
      type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false,
    });
    this.d1 = mk(4); this.d2 = mk(8); this.d3 = mk(16);

    // 4 bilineer örnekle küçültme (kutu filtresi)
    this.downU = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } };
    this.downMat = new THREE.ShaderMaterial({
      uniforms: this.downU, depthTest: false, depthWrite: false, vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
          gl_FragColor = vec4(min(c, vec3(16.0)), 1.0);
        }`,
    });

    this.u = {
      tScene: { value: this.rt.texture }, tD1: { value: this.d1.texture }, tD2: { value: this.d2.texture }, tD3: { value: this.d3.texture },
      tDepth: { value: this.rt.depthTexture },
      uRes: { value: new THREE.Vector2(w, h) },
      uTime: { value: 0 },
      uBlur: { value: 0 }, uBlurDir: { value: new THREE.Vector2(1, 0) }, uZoom: { value: 0 },
      uCA: { value: 0.0025 }, uVig: { value: 0.55 }, uGrain: { value: 0.035 },
      uFlash: { value: 0 }, uDream: { value: 0 }, uExposure: { value: 1.05 }, uBloom: { value: 0.65 },
      uSat: { value: 1.12 }, uContrast: { value: 1.06 }, uTint: { value: new THREE.Color(1.0, 1.0, 1.0) },
      uFade: { value: 0 }, uNear: { value: 0.05 }, uFar: { value: 900 }, uFocus: { value: 6 }, uDof: { value: 1.0 },
      uFxaa: { value: msaa > 0 ? 0 : 1 }, uFish: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      depthTest: false, depthWrite: false,
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D tScene, tD1, tD2, tD3, tDepth; uniform vec2 uRes; uniform float uTime;
        uniform float uBlur, uZoom, uCA, uVig, uGrain, uFlash, uDream, uExposure, uBloom, uSat, uContrast, uFade;
        uniform float uNear, uFar, uFocus, uDof, uFxaa, uFish;
        uniform vec2 uBlurDir; uniform vec3 uTint;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
        vec3 hueRot(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
        vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
        float viewZ(vec2 uv){ float d = texture2D(tDepth, uv).x; float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
        float luma(vec3 c){ return dot(min(c, vec3(1.5)), vec3(0.299, 0.587, 0.114)); }
        vec3 fxaa(vec2 uv){
          vec2 px = 1.0 / uRes;
          vec3 cM = texture2D(tScene, uv).rgb;
          vec3 cNW = texture2D(tScene, uv + vec2(-1.0, -1.0) * px).rgb, cNE = texture2D(tScene, uv + vec2(1.0, -1.0) * px).rgb;
          vec3 cSW = texture2D(tScene, uv + vec2(-1.0, 1.0) * px).rgb, cSE = texture2D(tScene, uv + vec2(1.0, 1.0) * px).rgb;
          float lM = luma(cM), lNW = luma(cNW), lNE = luma(cNE), lSW = luma(cSW), lSE = luma(cSE);
          float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
          if (lMax - lMin < max(0.03, lMax * 0.12)) return cM;
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
          float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
          float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
          dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
          vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0/3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0/3.0 - 0.5)).rgb);
          vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
          float lB = luma(b);
          return (lB < lMin || lB > lMax) ? a : b;
        }
        void main(){
          vec2 uv = vUv;
          if (uFish > 0.0) { vec2 dd = uv - 0.5; dd.y *= 1.7778; float r2 = dot(dd, dd); dd *= 1.0 - uFish * r2 * 0.9; dd.y /= 1.7778; uv = 0.5 + dd; }
          if (uDream > 0.001) uv += uDream * 0.010 * vec2(sin(uv.y * 16.0 + uTime * 2.7), cos(uv.x * 12.0 + uTime * 2.1));
          vec3 col = vec3(0.0);
          bool moving = uBlur > 0.0005 || uZoom > 0.0005;
          if (moving) {
            const int N = 12;
            float tot = 0.0;
            for (int i = 0; i < N; i++) {
              float k = float(i) / float(N - 1) - 0.5;
              float w = 1.0 - abs(k) * 0.8;
              vec2 o = uBlurDir * uBlur * k + (uv - 0.5) * uZoom * k;
              vec2 ca = (uv - 0.5) * uCA * 2.0;
              col.r += texture2D(tScene, uv + o + ca).r * w;
              col.g += texture2D(tScene, uv + o).g * w;
              col.b += texture2D(tScene, uv + o - ca).b * w;
              tot += w;
            }
            col /= tot;
          } else if (uFxaa > 0.5) {
            col = fxaa(uv);
            vec2 d = (uv - 0.5) * uCA;
            col.r = mix(col.r, texture2D(tScene, uv + d).r, 0.6);
            col.b = mix(col.b, texture2D(tScene, uv - d).b, 0.6);
          } else {
            vec2 d = (uv - 0.5) * uCA;
            col = vec3(texture2D(tScene, uv + d).r, texture2D(tScene, uv).g, texture2D(tScene, uv - d).b);
          }
          if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
          col = min(col, vec3(16.0));
          // derinlik alanı (arka plan + yakın ön plan yumuşar)
          if (uDof > 0.0) {
            float z = viewZ(vUv);
            float coc = clamp(abs(z - uFocus) / max(z, 0.001) * 3.2 - 0.12, 0.0, 1.0) * uDof;
            vec3 b1 = texture2D(tD1, uv).rgb, b2 = texture2D(tD2, uv).rgb;
            vec3 blurred = mix(b1, b2, smoothstep(0.45, 1.0, coc));
            col = mix(col, blurred, smoothstep(0.05, 0.55, coc));
          }
          // bloom
          vec3 g1 = texture2D(tD1, uv).rgb, g2 = texture2D(tD2, uv).rgb, g3 = texture2D(tD3, uv).rgb;
          vec3 bloom = max(g1 - 0.6, 0.0) * 0.45 + max(g2 - 0.5, 0.0) * 0.6 + max(g3 - 0.38, 0.0) * 0.85;
          col += bloom * uBloom;
          col *= uExposure * uTint;
          if (uDream > 0.001) {
            float a = uDream * (2.2 * sin(uv.y * 5.0 + uTime * 1.3) + 1.4 * cos(uv.x * 4.0 - uTime));
            col = mix(col, hueRot(col, a) * 1.25, clamp(uDream, 0.0, 1.0));
          }
          col = aces(col);
          col = (col - 0.5) * uContrast + 0.5;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = clamp(mix(vec3(l), col, uSat), 0.0, 1.0);
          vec2 q = (vUv - 0.5) * vec2(1.0, 1.25);
          col *= mix(1.0, smoothstep(0.95, 0.25, length(q)), uVig);
          col = toSRGB(col);
          col += (hash(floor(vUv * uRes) + fract(uTime * 13.7) * 100.0) - 0.5) * uGrain;
          col = mix(col, vec3(1.0), uFlash);
          col = mix(col, vec3(0.0), uFade);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.downQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.downMat);
    this.downQuad.frustumCulled = false;
    this.downScene = new THREE.Scene(); this.downScene.add(this.downQuad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  _down(src, dst, srcW, srcH, spread) {
    this.downU.tSrc.value = src;
    this.downU.uTexel.value.set(spread / srcW, spread / srcH);
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.downScene, this.cam);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    const W = this.rt.width, H = this.rt.height;
    this._down(this.rt.texture, this.d1, W, H, 1.5);
    this._down(this.d1.texture, this.d2, this.d1.width, this.d1.height, 1.0);
    this._down(this.d2.texture, this.d3, this.d2.width, this.d2.height, 1.0);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
