declare const brand: unique symbol

/** Total mass fraction in elements heavier than helium. */
export type Metallicity = number & { readonly [brand]: 'Metallicity' }

export const SOLAR_METALLICITY = 0.02

/** Range over which the Tout and Hurley fits are valid. */
export const METALLICITY_MIN = 0.0001
export const METALLICITY_MAX = 0.03

export const metallicity = (z: number): Metallicity =>
  Math.min(METALLICITY_MAX, Math.max(METALLICITY_MIN, z)) as Metallicity

export const SOLAR = metallicity(SOLAR_METALLICITY)

/** [Fe/H], the logarithmic abundance relative to the Sun — the usual observational handle. */
export const toFeH = (z: Metallicity): number => Math.log10(z / SOLAR_METALLICITY)

export const fromFeH = (feH: number): Metallicity => metallicity(SOLAR_METALLICITY * 10 ** feH)
