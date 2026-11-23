// Su altı kostik ışık deseni: hem zemin shader'ında hem de balık/kaya
// materyallerine onBeforeCompile ile enjekte edilir.

export const CAUSTIC_GLSL = /* glsl */ `
float causticPattern(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}
`;

// Ortak uniform nesnesi: tüm patch'lenmiş materyaller aynı referansı paylaşır.
export const causticUniforms = {
  uCTime: { value: 0 },
  uCStrength: { value: 0.55 },
  uCScale: { value: 0.33 },
  uCColor: { value: null },
};

export function patchCaustics(material, { strength = 1.0 } = {}) {
  const local = { uCLocal: { value: strength } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, causticUniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCWorld;
uniform float uCTime; uniform float uCStrength; uniform float uCScale; uniform vec3 uCColor; uniform float uCLocal;
${CAUSTIC_GLSL}`)
      .replace('#include <opaque_fragment>', `{
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  vec2 cuv = vCWorld.xz * uCScale + vec2(vCWorld.y * 0.15, vCWorld.y * 0.1);
  float cst = causticPattern(cuv, uCTime) * 0.65 + causticPattern(cuv * 1.7 + 3.1, uCTime * 1.3) * 0.35;
  float facing = smoothstep(-0.25, 0.85, wN.y);
  outgoingLight += diffuseColor.rgb * uCColor * cst * facing * uCStrength * uCLocal;
  // firefly kelepçesi: aşırı parlak spekülerlerin bloom'da blok oluşturmasını engeller
  if (any(isnan(outgoingLight)) || any(isinf(outgoingLight))) outgoingLight = vec3(0.0);
  outgoingLight = min(outgoingLight, vec3(6.0));
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'caustic-v2';
  return material;
}
