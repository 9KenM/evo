/** Fullscreen-quad vertex shader. PlaneGeometry(2, 2) already spans clip space. */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** Hash-based value noise and fBm. Cheap, and adequate for convective granulation. */
export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.1, 1.0)), f.x), f.y),
    f.z);
}

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/**
 * Procedural field stars.
 *
 * The bundled starfield texture is too sparse to guarantee anything behind the lens at every
 * viewing angle, which leaves a black hole silhouetted against nothing and therefore invisible.
 * A dense procedural layer gives the deflection field something to smear everywhere, and a rich
 * star field is a fair depiction of the sky regardless.
 */
float starLayer(vec2 uv, float scale, float density, float size) {
  vec2 g = uv * scale;
  vec2 cell = floor(g);
  vec2 f = fract(g);

  float pick = hash21(cell);
  if (pick > density) return 0.0;

  vec2 centre = vec2(hash21(cell + 13.13), hash21(cell + 71.77));
  float d = length(f - centre);
  float brightness = 0.25 + 0.75 * hash21(cell + 5.31);

  return smoothstep(size, 0.0, d) * brightness;
}

float starField(vec2 uv) {
  return starLayer(uv, 260.0, 0.30, 0.09) * 0.55
       + starLayer(uv, 120.0, 0.16, 0.12) * 0.9
       + starLayer(uv, 55.0, 0.07, 0.16) * 1.6;
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * valueNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}
`

/**
 * Backdrop. Deliberately does NOT scale with the camera: distant field stars do not grow when the
 * subject is magnified, and holding it fixed keeps the zoom legible on the subject alone.
 *
 * Sampled and returned in linear light — the previous renderer composited these additively in sRGB
 * space, which is not adding light and is why everything trended white.
 */
export const BACKDROP = /* glsl */ `
uniform sampler2D uStarfield;
uniform sampler2D uNebula;
uniform sampler2D uNebula2;
uniform float uBackdropGain;
uniform vec2 uOrbit;

/** Applies the observer orientation: elevation about X, then azimuth about Y. */
vec3 orbitRotate(vec3 v) {
  float ce = cos(uOrbit.y);
  float se = sin(uOrbit.y);
  v = vec3(v.x, ce * v.y - se * v.z, se * v.y + ce * v.z);

  float ca = cos(uOrbit.x);
  float sa = sin(uOrbit.x);
  return vec3(ca * v.x + sa * v.z, v.y, -sa * v.x + ca * v.z);
}

/**
 * The sky, sampled by direction.
 *
 * Direction-based rather than a screen-space pan, so the backdrop rotates at exactly the same
 * angular rate as the stellar surface and in the same sense. An observer orbiting a star while
 * keeping it centred turns their view direction by the orbit angle, so the distant sky sweeps by
 * that same angle.
 *
 * One sky, identical for every archetype. It was briefly split — a faint diffuse component behind
 * luminous stars, a strong one behind a black hole so the shadow had something to be silhouetted
 * against — but two different skies read as two different places. The rich version is used
 * throughout, at a fixed level: the subject's exposure is applied to the subject alone, so the sky
 * is never re-lit by whatever happens to be in front of it.
 */
const float NEBULA_WEIGHT = 0.85;

vec3 skyColor(vec3 dir) {
  dir = orbitRotate(dir);

  vec2 uv = vec2(
    atan(dir.z, dir.x) / 6.2831853 + 0.5,
    acos(clamp(dir.y, -1.0, 1.0)) / 3.14159265
  );

  vec3 texels = pow(texture2D(uStarfield, uv * vec2(3.0, 1.5)).rgb, vec3(2.2));
  float procedural = starField(uv * vec2(2.4, 1.2));

  /*
   * Two tileable cloud plates at different scales, summed as octaves. One plate sampled
   * equirectangularly repeats visibly and pinches at the poles; a second at a coarser scale and an
   * offset breaks up both. The warm plate is weighted low so the field reads mostly cool, with
   * emission-coloured structure rather than a uniform blue wash.
   */
  vec3 fine = pow(texture2D(uNebula, uv * vec2(2.0, 1.0) + vec2(0.13, 0.07)).rgb, vec3(2.2));
  vec3 coarse = pow(texture2D(uNebula2, uv * vec2(0.75, 0.38) + vec2(0.61, 0.29)).rgb, vec3(2.2));
  vec3 nebula = fine * 0.65 + coarse * vec3(1.0, 0.72, 0.55) * 0.55;

  return texels * 0.5 + vec3(procedural) * 0.6 + nebula * NEBULA_WEIGHT;
}

/*
 * Angular width of the backdrop projection.
 *
 * The orbit's *direction* is faithful, but its *rate* is compressed here, and deliberately so. A
 * distant observer tracking a star turns their view by the full orbit angle while surface features
 * shift only by roughly (R/D)·sin θ, so the sky genuinely ought to sweep about D/R times faster
 * than the disk — around 150x at typical framing. Rendered honestly the background would blur past
 * unreadably. This value holds the ratio near 7x: fast enough to read as a distant sky, slow enough
 * to watch. Larger widens the projection and slows the sweep further.
 */
const float SKY_FOV = 0.55;

vec3 backdrop(vec2 ndc, float aspect) {
  vec3 dir = normalize(vec3(ndc.x * aspect * SKY_FOV, ndc.y * SKY_FOV, 1.0));
  return skyColor(dir) * uBackdropGain;
}
`
