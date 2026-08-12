declare const brand: unique symbol

type Branded<B extends string> = number & { readonly [brand]: B }

export type SolarMasses = Branded<'SolarMasses'>
export type SolarRadii = Branded<'SolarRadii'>
export type SolarLuminosities = Branded<'SolarLuminosities'>
export type Kelvin = Branded<'Kelvin'>
export type Gyr = Branded<'Gyr'>
export type Years = Branded<'Years'>
export type SolarMassesPerYear = Branded<'SolarMassesPerYear'>
export type Kilometres = Branded<'Kilometres'>

/*
 * Arithmetic on branded values yields a plain `number` — the brand does not survive `*` or `-`.
 * That is the point: any result has to be re-branded explicitly, which forces the units question
 * at every assignment. `const lost: SolarMasses = rate * span` will not compile, which is exactly
 * the Reimers bug the previous engine shipped (a per-year rate multiplied by an age in Gyr).
 * Cross-unit conversions go through the helpers below rather than raw multiplication.
 */

export const solarMasses = (n: number) => n as SolarMasses
export const solarRadii = (n: number) => n as SolarRadii
export const solarLuminosities = (n: number) => n as SolarLuminosities
export const kelvin = (n: number) => n as Kelvin
export const gyr = (n: number) => n as Gyr
export const years = (n: number) => n as Years
export const solarMassesPerYear = (n: number) => n as SolarMassesPerYear
export const kilometres = (n: number) => n as Kilometres

export const YEARS_PER_GYR = 1e9

export const toYears = (t: Gyr): Years => years(t * YEARS_PER_GYR)
export const toGyr = (t: Years): Gyr => gyr(t / YEARS_PER_GYR)

/** The only sanctioned way to turn a mass-loss rate plus a duration into a mass. */
export const massLostOver = (rate: SolarMassesPerYear, span: Gyr): SolarMasses =>
  solarMasses(rate * toYears(span))
