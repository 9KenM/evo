import { BACKDROP, NOISE } from './common.js'

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
 * rather than by the colour, and the camera's exposure decides what blows out.
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

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 world = vec2(ndc.x * aspect, ndc.y) * uSpan;

  float r = length(world) / uRadius;

  if (r < 1.0) {
    // Direction cosine between the surface normal and the line of sight.
    float mu = sqrt(max(0.0, 1.0 - r * r));

    /*
     * The observer sits at -z looking toward +z, matching the ray setup used for lensing, so the
     * hemisphere facing back at the camera carries -mu. This is the surface actually in view.
     *
     * It makes the disk and the sky counter-rotate, which is correct rather than a defect: circling
     * a star while keeping it centred brings fresh longitude into view on the side you move toward,
     * while the view rotation needed to hold it centred sweeps the distant sky the other way.
     * Measured across a 0.15 rad orbit: disk +17px, background -138px.
     */
    vec3 normal = vec3(world / uRadius, -mu);

    // Rotate the surface with the observer so granulation sweeps across the disk. Without this the
    // pattern is pinned to screen space and the star reads as a shaded circle rather than a sphere.
    vec3 surface = orbitRotate(normal);

    // Empirical linear limb-darkening law.
    float intensity = 1.0 - uLimbDarkening * (1.0 - mu);

    // Rotation gives viewpoint motion; the time term lets the convection pattern itself evolve.
    float cells = fbm(surface * uGranuleScale + vec3(0.0, 0.0, uTime * 0.03));
    intensity *= 1.0 + uGranulation * (cells - 0.5);

    // A photosphere is opaque. The backdrop is replaced here, not added to, so background stars are
    // properly occluded rather than showing through the disk.
    gl_FragColor = vec4(uColor * uRadiance * max(intensity, 0.0), 1.0);
    return;
  }

  // Chromosphere falling off just outside the limb. Bloom carries the rest of the glow.
  float halo = exp(-(r - 1.0) * 5.0);
  vec3 color = backdrop(ndc, aspect) + uColor * uRadiance * halo * 0.12;

  gl_FragColor = vec4(color, 1.0);
}
`
