/**
 * Isolated Schwarzschild black hole.
 *
 * Rays are traced backwards from the observer through curved spacetime rather than distorted in
 * screen space, so the shadow, the Einstein ring and the multiply-imaged background all fall out of
 * the integration instead of being drawn. Working units are Schwarzschild radii (R_s = 1), which
 * puts the horizon at r = 1, the photon sphere at r = 1.5, and the shadow a distant observer sees
 * at an impact parameter of √27 M = 2.598 R_s — a shadow diameter of ~5.2 R_s, matching the Event
 * Horizon Telescope geometry.
 *
 * Angular momentum h is conserved along a null geodesic, so it is evaluated once and reused; the
 * acceleration is then d²r⃗/dλ² = −3M h² r⃗ / r⁵, with M = 0.5 in these units.
 *
 * No accretion disk. A companionless stellar remnant has no donor, so what is actually there is a
 * lensing shadow against a lensed sky.
 */
import { BACKDROP, NOISE } from './common.js'

export const BLACK_HOLE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uSpan;
uniform float uSchwarzschild;

${NOISE}
${BACKDROP}

const int MAX_STEPS = 280;
const float OBSERVER_DISTANCE = 24.0;
const float ESCAPE_RADIUS = 28.0;

/*
 * The observer orbit is applied inside skyColor rather than to the ray start. A Schwarzschild hole
 * is spherically symmetric, so moving around it changes only which part of the sky sits behind the
 * lens, not the deflection pattern — rotating the sampled direction is the physically equivalent
 * and much cheaper expression of that, and it shares one rotation with every other archetype.
 */

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 world = vec2(ndc.x * aspect, ndc.y) * uSpan;

  // Into units of the Schwarzschild radius.
  vec2 impact = world / max(uSchwarzschild, 1e-30);

  vec3 pos = vec3(impact, -OBSERVER_DISTANCE);
  vec3 dir = vec3(0.0, 0.0, 1.0);

  vec3 angularMomentum = cross(pos, dir);
  float h2 = dot(angularMomentum, angularMomentum);

  bool captured = false;
  bool escaped = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(pos);

    if (r < 1.0) { captured = true; break; }
    if (r > ESCAPE_RADIUS && dot(pos, dir) > 0.0) { escaped = true; break; }

    // Coarser steps far from the hole, fine steps where the curvature matters.
    float step = clamp(0.035 * r * r, 0.012, 0.9);

    vec3 accel = -1.5 * h2 * pos / pow(r, 5.0);
    dir += accel * step;
    pos += dir * step;
  }

  vec3 color = vec3(0.0);
  if (!captured && escaped) {
    // Rays still bound after the step budget are treated as captured rather than faked.
    color = skyColor(normalize(dir)) * uBackdropGain;
  }

  gl_FragColor = vec4(color, 1.0);
}
`
