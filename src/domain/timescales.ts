import coefficients from '../data/sse-coefficients.json' with { type: 'json' }
import { gyr, type Gyr, type SolarMasses } from './units.js'
import { SOLAR_METALLICITY, type Metallicity } from './metallicity.js'

const xt = coefficients.xt

/** Evaluates a cubic in ζ over four consecutive constants starting at `offset`. */
function cubic(offset: number, zeta: number): number {
  const [c0, c1, c2, c3] = xt.slice(offset, offset + 4) as [number, number, number, number]
  return c0 + zeta * (c1 + zeta * (c2 + zeta * c3))
}

export interface TimescaleCoefficients {
  /** Coefficients of t_BGB. */
  readonly bgb: readonly [number, number, number, number, number]
  /** Coefficients of the main-sequence hook fraction. */
  readonly hook: readonly [number, number, number, number, number]
  /** Mass above which the main sequence develops a hook, M_hook. */
  readonly massHook: number
  /** Floor on t_MS / t_BGB for stars below M_hook. */
  readonly msFloor: number
}

export function timescaleCoefficients(metallicity: Metallicity): TimescaleCoefficients {
  const z = metallicity
  const zeta = Math.log10(z / SOLAR_METALLICITY)

  return {
    bgb: [cubic(0, zeta), cubic(4, zeta), cubic(8, zeta), cubic(12, zeta), xt[16] as number],
    hook: [cubic(17, zeta), xt[21] as number, cubic(22, zeta), cubic(26, zeta), xt[30] as number],
    massHook: 1.0185 + zeta * (0.16015 + zeta * 0.0892),
    msFloor: Math.max(
      0.95,
      Math.max(0.95 - (10 / 3) * (z - 0.01), Math.min(0.99, 0.98 - (100 / 7) * (z - 0.001))),
    ),
  }
}

/**
 * Time to the base of the giant branch — or to helium ignition where no first giant branch exists.
 * Hurley, Pols & Tout (2000) eq. 4.
 */
export function timeToBGB(mass: SolarMasses, coeff: TimescaleCoefficients): Gyr {
  const m = mass
  const [a1, a2, a3, a4, a5] = coeff.bgb
  return gyr(
    (a1 + a2 * m ** 4 + a3 * m ** 5.5 + m ** 7) / (a4 * m ** 2 + a5 * m ** 7) / 1000,
  )
}

/**
 * Main-sequence lifetime as a fraction of t_BGB. Hurley eq. 7; only meaningful above M_hook, which
 * is why the caller takes the maximum against the metallicity-dependent floor.
 *
 * Also serves as t_hook/t_BGB, the timing of the convective-core hook, which is what the
 * main-sequence perturbation terms need to place the contraction near the terminal age.
 */
export function hookFraction(mass: SolarMasses, coeff: TimescaleCoefficients): number {
  const m = mass
  const [a1, a2, a3, a4, a5] = coeff.hook
  return Math.max(0.5, 1 - 0.01 * Math.max(a1 / m ** a2, a3 + a4 / m ** a5))
}

/**
 * Main-sequence lifetime.
 *
 * Replaces the previous engine's `10 · M / L`, which had no metallicity dependence and gave a
 * 30 M☉ star 0.37 Myr against a real value near 6 Myr.
 */
export function mainSequenceLifetime(mass: SolarMasses, coeff: TimescaleCoefficients): Gyr {
  return gyr(Math.max(coeff.msFloor, hookFraction(mass, coeff)) * timeToBGB(mass, coeff))
}
