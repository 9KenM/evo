import { BACKDROP, NOISE, REFERENCE_RING } from './common.js'

/**
 * Every self-luminous archetype — main sequence, subgiant, giant, white dwarf, neutron star.
 *
 * They differ only in uniforms, not in code: granulation amplitude falls to zero for the radiative
 * surfaces of compact remnants, and granule *size* is driven by surface gravity, because convective
 * cell size scales with the pressure scale height. The Sun carries millions of small cells; a red
 * giant carries a handful of enormous ones. That single uniform is what makes giants read as giant
 * rather than as a larger orange ball.
 *
 * Output is linear-light HDR, with radiance ∝ (T/T☉)⁴. Brightness is therefore carried by physics
 * rather than by the colour, and the tonemap decides what blows out.
 */
export const SPHERE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uSpan;
uniform float uRadius;
uniform vec3 uColor;
uniform float uRadiance;
uniform float uGranulation;
uniform float uGranuleScale;
uniform float uLimbDarkening;
uniform float uTime;

${NOISE}
${BACKDROP}
${REFERENCE_RING}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 world = vec2(ndc.x * aspect, ndc.y) * uSpan;

  float pixelWorld = (2.0 * uSpan) / uResolution.y;

  vec3 color = backdrop(ndc, aspect);

  float r = length(world) / uRadius;

  if (r < 1.0) {
    // Direction cosine between the surface normal and the line of sight.
    float mu = sqrt(max(0.0, 1.0 - r * r));

    // Empirical linear limb-darkening law.
    float intensity = 1.0 - uLimbDarkening * (1.0 - mu);

    vec3 normal = vec3(world / uRadius, mu);

    // Rotate the surface with the observer so granulation sweeps across the disk. Without this the
    // pattern is pinned to screen space and the star reads as a shaded circle rather than a sphere.
    vec3 surface = orbitRotate(normal);

    // Rotation gives viewpoint motion; the time term lets the convection pattern itself evolve.
    float cells = fbm(surface * uGranuleScale + vec3(0.0, 0.0, uTime * 0.03));
    intensity *= 1.0 + uGranulation * (cells - 0.5);

    color += uColor * uRadiance * max(intensity, 0.0);
  } else {
    // Chromosphere falling off just outside the limb. Bloom carries the rest of the glow.
    float halo = exp(-(r - 1.0) * 5.0);
    color += uColor * uRadiance * halo * 0.12;
  }

  color += referenceRing(world, uSpan, pixelWorld);

  gl_FragColor = vec4(color, 1.0);
}
`
