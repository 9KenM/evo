import { SOLAR_METALLICITY, type Metallicity } from './metallicity.js'
import { solarMassesPerYear, type SolarMassesPerYear } from './units.js'

/**
 * Stellar winds. Hurley, Pols & Tout (2000) section 7.1.
 *
 * Five prescriptions, and the rule is **take the maximum of whichever apply**, not pick one. The
 * previous engine ran Reimers alone at every mass, which is calibrated for red giants and nowhere
 * else; applied at supergiant L·R/M with nothing competing and no superwind cutoff it stripped
 * 27 M☉ off a 30 M☉ star and hit the safety clamp.
 *
 * The LBV term is the one that matters most for the top of the mass range. Real stars cannot sit
 * above the Humphreys–Davidson limit — they shed the envelope violently instead — and this is the
 * mechanism that enforces it.
 */

/** Reimers efficiency. Hurley's default; the previous engine used 0.4. */
const REIMERS_ETA = 0.5

/** Reference luminosity for the envelope-thinning term that ramps in WR-like winds. */
const WR_REFERENCE_LUMINOSITY = 7.0e4

/** Humphreys–Davidson limit, above which a star is an LBV rather than a stable supergiant. */
const HD_LUMINOSITY = 6.0e5

export interface WindInput {
  readonly luminosity: number
  readonly radius: number
  readonly mass: number
  readonly coreMass: number
  /** Whether the star is on the AGB, where the pulsation-driven superwind applies. */
  readonly asymptotic: boolean
}

/**
 * Mira pulsation period in days, which is what sets the AGB superwind.
 *
 * Capped at 2000 days: beyond that the fit is extrapolating well past the observed Miras it was
 * built from, and the superwind has saturated anyway.
 */
const miraPeriod = (mass: number, radius: number): number =>
  Math.min(10 ** (-2.07 - 0.9 * Math.log10(mass) + 1.94 * Math.log10(radius)), 2000)

/** Total wind mass-loss rate, in solar masses per year. */
export function windMassLoss(
  star: WindInput,
  metallicity: Metallicity,
): SolarMassesPerYear {
  const { luminosity: l, radius: r, mass: m, coreMass, asymptotic } = star
  let rate = 0

  // Nieuwenhuijzen & de Jager (1990), for luminous stars across the whole diagram, with the
  // Kudritzki metallicity scaling. Ramped in over 4000-4500 L☉ so it does not switch on as a step.
  if (l > 4000) {
    const ramp = Math.min(1, (l - 4000) / 500)
    rate = 9.6e-15 * ramp * r ** 0.81 * l ** 1.24 * m ** 0.16
    rate *= Math.sqrt(metallicity / SOLAR_METALLICITY)
  }

  // Kudritzki & Reimers (1978), the classic red-giant wind.
  rate = Math.max(rate, (REIMERS_ETA * 4.0e-13 * r * l) / m)

  // Vassiliadis & Wood (1993). The pulsation-driven superwind, which is what actually ends the AGB
  // and ejects the nebula. The cap is the radiation-pressure limit on a dust-driven wind.
  if (asymptotic) {
    const period = miraPeriod(m, r)
    const pulsation = 10 ** (-11.4 + 0.0125 * (period - 100 * Math.max(m - 2.5, 0)))
    rate = Math.max(rate, Math.min(pulsation, 1.36e-9 * l))
  }

  /*
   * Wolf-Rayet-like enhancement as the hydrogen envelope thins. `envelope` falls below 1 only when
   * the star is nearly stripped, which for a single star means the top of the mass range — this is
   * the term that lets a massive star strip itself down to a naked helium star with no companion.
   */
  const envelope =
    ((m - coreMass) / m) *
    Math.min(5, Math.max(1.2, (l / WR_REFERENCE_LUMINOSITY) ** -0.5))
  if (envelope < 1) {
    rate = Math.max(rate, 1.0e-13 * l ** 1.5 * (1 - envelope))
  }

  // LBV mass loss past the Humphreys-Davidson limit. Added rather than maximised, because it is a
  // distinct instability operating on top of the radiative wind, not an alternative to it.
  const hd = 1.0e-5 * r * Math.sqrt(l)
  if (l > HD_LUMINOSITY && hd > 1) {
    rate += 0.1 * (hd - 1) ** 3 * (l / HD_LUMINOSITY - 1)
  }

  return solarMassesPerYear(rate)
}
