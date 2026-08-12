import coefficients from '../data/sse-coefficients.json' with { type: 'json' }
import { solarLuminosities, solarRadii, type SolarLuminosities, type SolarMasses, type SolarRadii } from './units.js'
import type { Metallicity } from './metallicity.js'
import { SOLAR_METALLICITY } from './metallicity.js'

const xz = coefficients.xz

/** Evaluates a quartic in ζ = log10(Z/Z☉) over five consecutive constants starting at `offset`. */
function quartic(offset: number, zeta: number): number {
  const c = xz.slice(offset, offset + 5)
  const [c0, c1, c2, c3, c4] = c as [number, number, number, number, number]
  return c0 + zeta * (c1 + zeta * (c2 + zeta * (c3 + zeta * c4)))
}

export interface ZamsCoefficients {
  readonly l: readonly [number, number, number, number, number, number, number]
  readonly r: readonly [number, number, number, number, number, number, number, number, number]
}

/**
 * Metallicity-dependent coefficients of the Tout et al. (1996) ZAMS fits.
 *
 * Cheap enough to call per evaluation, but it is pure and depends only on Z, so callers that sweep
 * a track at fixed metallicity should hoist it.
 */
export function zamsCoefficients(metallicity: Metallicity): ZamsCoefficients {
  const zeta = Math.log10(metallicity / SOLAR_METALLICITY)

  return {
    l: [
      quartic(0, zeta),
      quartic(5, zeta),
      quartic(10, zeta),
      quartic(15, zeta),
      quartic(20, zeta),
      quartic(25, zeta),
      quartic(30, zeta),
    ],
    r: [
      quartic(35, zeta),
      quartic(40, zeta),
      quartic(45, zeta),
      quartic(50, zeta),
      quartic(55, zeta),
      xz[60] as number, // constant term — the one coefficient with no metallicity dependence
      quartic(61, zeta),
      quartic(66, zeta),
      quartic(71, zeta),
    ],
  }
}

/**
 * Zero-age main-sequence luminosity and radius.
 *
 * Tout, Pols, Eggleton & Han (1996) MNRAS 281, 257. Valid for 0.1–100 M☉ and Z = 0.0001–0.03,
 * quoted to better than 7.5% in luminosity and 5% in radius against detailed models.
 *
 * This replaces the previous engine's piecewise power laws, which had no metallicity dependence at
 * all and steepened in the wrong direction above 20 M☉.
 */
export function zamsProperties(
  mass: SolarMasses,
  coeff: ZamsCoefficients,
): { luminosity: SolarLuminosities; radius: SolarRadii } {
  const m = mass
  const root = Math.sqrt(m)
  const [l1, l2, l3, l4, l5, l6, l7] = coeff.l
  const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = coeff.r

  const luminosity =
    (l1 * m ** 5 * root + l2 * m ** 11) /
    (l3 + m ** 3 + l4 * m ** 5 + l5 * m ** 7 + l6 * m ** 8 + l7 * m ** 9 * root)

  const radius =
    ((r1 * m ** 2 + r2 * m ** 6) * root + r3 * m ** 11 + (r4 + r5 * root) * m ** 19) /
    (r6 + r7 * m ** 2 + (r8 * m ** 8 + m ** 18 + r9 * m ** 19) * root)

  return { luminosity: solarLuminosities(luminosity), radius: solarRadii(radius) }
}
