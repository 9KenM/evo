import { SOLAR_TEMPERATURE } from './constants.js'

/**
 * The post-AGB crossing — the planetary nebula phase.
 *
 * This is the one part of the engine that does **not** come from Hurley. SSE goes from the
 * thermally pulsing AGB straight to a white dwarf, instantaneously, so the most spectacular moment
 * in a solar-mass star's life is a single-frame discontinuity there. Modelling it needs post-AGB
 * tracks, and the modern reference is Miller Bertolami (2016), whose timescales are three to ten
 * times shorter than the Vassiliadis & Wood and Blöcker tracks that preceded them.
 *
 * The physics is simple once the core mass exists. The envelope is gone, the core is not growing,
 * so luminosity is pinned while the star contracts at constant L and heats up. That constant-L
 * horizontal crossing is what ionises the ejected shell from inside, and it is why the nebula
 * lights up at all.
 */

/**
 * Crossing time against remnant mass at solar metallicity, from Miller Bertolami (2016) table 3.
 * Years, against core mass in M☉.
 *
 * The dependence is ferocious — roughly a decade of time per 0.1 M☉ of core — which is why a
 * planetary nebula is common around a solar-mass remnant and essentially never seen around a heavy
 * one. Interpolated in log time, since that is where the relation is close to straight.
 */
const CROSSING: readonly (readonly [number, number])[] = [
  [0.528, 24900],
  [0.576, 4490],
  [0.657, 378],
]

/** Bounds on the extrapolation, so a core outside the tabulated range cannot produce nonsense. */
const CROSSING_MIN_YEARS = 20
const CROSSING_MAX_YEARS = 60000

/** Fraction of the phase spent crossing at constant luminosity, before the star settles. */
const CROSSING_FRACTION = 0.7

/** Duration of the post-AGB crossing, in years. */
export function crossingTime(coreMass: number): number {
  const points = CROSSING
  const first = points[0] as readonly [number, number]
  const last = points[points.length - 1] as readonly [number, number]

  const logAt = (index: number) => Math.log10((points[index] as readonly [number, number])[1])

  let value: number
  if (coreMass <= first[0]) {
    const slope = (logAt(1) - logAt(0)) / ((points[1] as readonly [number, number])[0] - first[0])
    value = logAt(0) + slope * (coreMass - first[0])
  } else if (coreMass >= last[0]) {
    const n = points.length - 1
    const slope =
      (logAt(n) - logAt(n - 1)) / (last[0] - (points[n - 1] as readonly [number, number])[0])
    value = logAt(n) + slope * (coreMass - last[0])
  } else {
    let i = 0
    while ((points[i + 1] as readonly [number, number])[0] < coreMass) i++
    const [m0] = points[i] as readonly [number, number]
    const [m1] = points[i + 1] as readonly [number, number]
    value = logAt(i) + ((logAt(i + 1) - logAt(i)) * (coreMass - m0)) / (m1 - m0)
  }

  return Math.min(CROSSING_MAX_YEARS, Math.max(CROSSING_MIN_YEARS, 10 ** value))
}

/**
 * Peak effective temperature reached before the star turns down onto the cooling track.
 *
 * A smooth stand-in for the turnaround temperature of the published tracks rather than a
 * transcribed fit: heavier cores are hotter, spanning roughly 10⁵ K for a solar-mass remnant to
 * 2×10⁵ K for the heaviest. The value that matters observationally is that it comfortably clears
 * the ~30,000 K needed to ionise the shell, which every core does.
 */
export const peakTemperature = (coreMass: number): number =>
  Math.min(2.5e5, Math.max(6e4, 10 ** (5.0 + 1.4 * (coreMass - 0.53))))

export interface PostAGBState {
  readonly luminosity: number
  readonly temperature: number
  readonly radius: number
}

/**
 * State a fraction `tau` of the way through the post-AGB phase.
 *
 * Two legs, and both are needed for the track to join up. The star first crosses at constant
 * luminosity, contracting and heating to its peak temperature; then it settles at roughly that
 * temperature while the luminosity falls to what the white dwarf radius can support. The endpoint
 * is therefore exactly the start of the cooling track, by construction, which is what removes the
 * 1850x radius discontinuity the engine used to have here.
 */
export function postAGBState(
  tau: number,
  luminosityTip: number,
  temperatureTip: number,
  coreMass: number,
  whiteDwarfRadius: number,
): PostAGBState {
  const peak = peakTemperature(coreMass)
  const radiusFrom = (l: number, t: number) => Math.sqrt(l) / (t / SOLAR_TEMPERATURE) ** 2

  if (tau <= CROSSING_FRACTION) {
    const progress = tau / CROSSING_FRACTION
    const temperature = Math.exp(
      Math.log(temperatureTip) + (Math.log(peak) - Math.log(temperatureTip)) * progress,
    )
    return {
      luminosity: luminosityTip,
      temperature,
      radius: radiusFrom(luminosityTip, temperature),
    }
  }

  const progress = (tau - CROSSING_FRACTION) / (1 - CROSSING_FRACTION)
  const settled = whiteDwarfRadius ** 2 * (peak / SOLAR_TEMPERATURE) ** 4
  const luminosity = Math.exp(
    Math.log(luminosityTip) + (Math.log(settled) - Math.log(luminosityTip)) * progress,
  )
  return { luminosity, temperature: peak, radius: radiusFrom(luminosity, peak) }
}
