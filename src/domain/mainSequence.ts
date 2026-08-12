import coefficients from '../data/sse-coefficients.json' with { type: 'json' }
import { SOLAR_METALLICITY, type Metallicity } from './metallicity.js'
import { zamsProperties, type ZamsCoefficients } from './zams.js'
import {
  solarLuminosities,
  solarRadii,
  type SolarLuminosities,
  type SolarMasses,
  type SolarRadii,
} from './units.js'

const xl = coefficients.xl
const xr = coefficients.xr

const poly = (table: readonly number[], offset: number, terms: number, zeta: number): number => {
  let value = 0
  for (let i = terms - 1; i >= 0; i--) value = value * zeta + (table[offset + i] as number)
  return value
}

export interface MainSequenceCoefficients {
  readonly lum: readonly [number, number, number, number, number, number]
  readonly rad: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  /** Mass below which the terminal-age radius fit switches branch, with its blend endpoints. */
  readonly radBreak: { readonly mass: number; readonly low: number; readonly high: number }
}

/** Terminal-age main-sequence coefficients. Hurley, Pols & Tout (2000) Appendix A. */
export function mainSequenceCoefficients(metallicity: Metallicity): MainSequenceCoefficients {
  const zeta = Math.log10(metallicity / SOLAR_METALLICITY)
  const lz = Math.log10(metallicity)

  // Ltms
  const l30 = poly(xl, 14, 5, zeta)
  const lum = [
    poly(xl, 0, 5, zeta) * l30,
    poly(xl, 5, 5, zeta) * l30,
    poly(xl, 10, 4, zeta),
    l30,
    poly(xl, 19, 4, zeta),
    poly(xl, 23, 4, zeta),
  ] as const

  // Rtms
  const r54 = poly(xr, 10, 5, zeta)
  const r52 = poly(xr, 0, 5, zeta) * r54
  const r53 = poly(xr, 5, 5, zeta) * r54
  const r55 = poly(xr, 15, 4, zeta)
  const r56 = poly(xr, 19, 4, zeta)
  const r57 = xr[23] as number
  const r58 = poly(xr, 24, 4, zeta)
  const r59 = poly(xr, 28, 4, zeta)
  const r60 = poly(xr, 32, 4, zeta)
  const r61 = poly(xr, 36, 4, zeta)

  const breakMass =
    10 **
    Math.max(
      0.097 - 0.1072 * (lz + 3),
      Math.max(0.097, Math.min(0.1461, 0.1461 + 0.1237 * (lz + 2))),
    )
  const upper = breakMass + 0.1

  return {
    lum,
    rad: [r52, r53, r54, r55, r56, r57, r58, r59, r60, r61] as const,
    radBreak: {
      mass: breakMass,
      low: (r52 + r53 * breakMass ** r55) / (r54 + breakMass ** r56),
      high: (r57 * upper ** 3 + r58 * upper ** r61 + r59 * upper ** (r61 + 1.5)) / (r60 + upper ** 5),
    },
  }
}

/** Luminosity at the end of the main sequence. */
export function luminosityTAMS(
  mass: SolarMasses,
  coeff: MainSequenceCoefficients,
): SolarLuminosities {
  const m = mass
  const [a27, a28, a29, a30, a31, a32] = coeff.lum
  return solarLuminosities(
    (a27 * m ** 3 + a28 * m ** 4 + a29 * m ** (a32 + 1.8)) / (a30 + a31 * m ** 5 + m ** a32),
  )
}

/** Radius at the end of the main sequence, floored so it never drops below the ZAMS radius. */
export function radiusTAMS(
  mass: SolarMasses,
  coeff: MainSequenceCoefficients,
  zamsCoeff: ZamsCoefficients,
): SolarRadii {
  const m = mass
  const [a52, a53, a54, a55, a56, a57, a58, a59, a60, a61] = coeff.rad
  const { mass: breakMass, low, high } = coeff.radBreak
  const upper = breakMass + 0.1

  if (m <= breakMass) {
    const fit = (a52 + a53 * m ** a55) / (a54 + m ** a56)
    const floor = 1.5 * zamsProperties(mass, zamsCoeff).radius
    return solarRadii(Math.max(floor, fit))
  }

  if (m >= upper) {
    return solarRadii((a57 * m ** 3 + a58 * m ** a61 + a59 * m ** (a61 + 1.5)) / (a60 + m ** 5))
  }

  // Linear blend across the narrow gap between the two fits.
  return solarRadii(low + ((high - low) / 0.1) * (m - breakMass))
}
