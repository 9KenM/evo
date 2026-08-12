import type { Kelvin } from './units.js'

export interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** Linear-light sRGB, normalised so the largest channel is 1. Feed this to the shader pipeline. */
export type LinearRGB = RGB

/** Display-encoded sRGB, 0–255. For CSS and the 2D canvas. */
export type DisplayRGB = RGB

const PLANCK_H = 6.62607015e-34
const LIGHT_C = 2.99792458e8
const BOLTZMANN_K = 1.380649e-23

/** Spectral radiance at wavelength λ (nm) for a blackbody at temperature T. */
function planck(lambdaNm: number, temperature: number): number {
  const l = lambdaNm * 1e-9
  const numerator = 2 * PLANCK_H * LIGHT_C ** 2
  const exponent = (PLANCK_H * LIGHT_C) / (l * BOLTZMANN_K * temperature)
  return numerator / (l ** 5 * (Math.exp(exponent) - 1))
}

/**
 * Piecewise-Gaussian lobe used by the analytic CIE colour matching approximation of
 * Wyman, Sloan & Shirley (2013), "Simple Analytic Approximations to the CIE XYZ Color Matching
 * Functions", Journal of Computer Graphics Techniques 2(2).
 */
function lobe(x: number, mu: number, sigmaLow: number, sigmaHigh: number): number {
  const t = (x - mu) * (x < mu ? 1 / sigmaLow : 1 / sigmaHigh)
  return Math.exp(-0.5 * t * t)
}

const xBar = (l: number) =>
  1.056 * lobe(l, 599.8, 37.9, 31.0) +
  0.362 * lobe(l, 442.0, 16.0, 26.7) -
  0.065 * lobe(l, 501.1, 20.4, 26.2)

const yBar = (l: number) => 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1)

const zBar = (l: number) => 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8)

export interface XYZ {
  readonly X: number
  readonly Y: number
  readonly Z: number
}

/** Integrates the Planck spectrum against the CIE 1931 2° observer. */
export function blackbodyXYZ(temperature: Kelvin): XYZ {
  const from = 360
  const to = 830
  const step = 2

  let X = 0
  let Y = 0
  let Z = 0

  for (let l = from; l <= to; l += step) {
    const radiance = planck(l, temperature)
    X += radiance * xBar(l)
    Y += radiance * yBar(l)
    Z += radiance * zBar(l)
  }

  const total = X + Y + Z
  return total > 0 ? { X: X / total, Y: Y / total, Z: Z / total } : { X: 0, Y: 0, Z: 0 }
}

/** CIE 1931 xy chromaticity — the coordinate the Planckian locus is normally quoted in. */
export function blackbodyChromaticity(temperature: Kelvin): { x: number; y: number } {
  const { X, Y } = blackbodyXYZ(temperature)
  return { x: X, y: Y }
}

/** sRGB primaries, D65 white point. */
function xyzToLinearRGB({ X, Y, Z }: XYZ): RGB {
  return {
    r: 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    g: -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    b: 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  }
}

/**
 * Blackbody colour in linear light, normalised to a peak channel of 1.
 *
 * Chromaticity only — brightness is carried separately by the star's actual luminosity, so that the
 * HDR pipeline controls exposure rather than the colour being pre-dimmed.
 *
 * Replaces the previous engine's Tanner Helland fit, which approximated a tungsten filament rather
 * than a blackbody and clamped hard at 1000–40000 K.
 */
export function blackbodyLinearRGB(temperature: Kelvin): LinearRGB {
  const raw = xyzToLinearRGB(blackbodyXYZ(temperature))

  // Hot and cool blackbodies fall outside the sRGB gamut. Desaturate toward white by lifting the
  // whole triple until nothing is negative, which preserves hue far better than clipping.
  const floor = Math.min(raw.r, raw.g, raw.b)
  const lifted =
    floor < 0 ? { r: raw.r - floor, g: raw.g - floor, b: raw.b - floor } : raw

  const peak = Math.max(lifted.r, lifted.g, lifted.b)
  if (peak <= 0) return { r: 0, g: 0, b: 0 }

  return { r: lifted.r / peak, g: lifted.g / peak, b: lifted.b / peak }
}

const encode = (channel: number): number => {
  const c = Math.min(1, Math.max(0, channel))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

/** Display-encoded 0–255 sRGB for CSS and the 2D canvas. */
export function blackbodyRGB(temperature: Kelvin): DisplayRGB {
  const { r, g, b } = blackbodyLinearRGB(temperature)
  return {
    r: Math.round(encode(r) * 255),
    g: Math.round(encode(g) * 255),
    b: Math.round(encode(b) * 255),
  }
}

export const cssRGB = ({ r, g, b }: DisplayRGB) => `rgb(${r}, ${g}, ${b})`
