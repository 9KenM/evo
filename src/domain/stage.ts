/**
 * Hurley's stellar type index, restricted to what a single star reaches on its own.
 *
 * Omitted deliberately: the naked helium star types (7-9) and the helium white dwarf (10). A helium
 * white dwarf needs the giant branch truncated before the helium flash, which for a single star
 * does not happen. The naked helium types are reachable without a companion — a star above roughly
 * 25-30 M☉ strips its own envelope through its winds — but they are a distinct track rather than a
 * point on this one, and nothing renders them yet.
 */
export const STAGES = [
  'main sequence',
  'hertzsprung gap',
  'giant branch',
  'core helium burning',
  'early AGB',
  'thermally pulsing AGB',
  'planetary nebula',
  'white dwarf',
  'neutron star',
  'black hole',
] as const

export type Stage = (typeof STAGES)[number]

export const REMNANTS = ['white dwarf', 'neutron star', 'black hole'] as const

export type Remnant = (typeof REMNANTS)[number]

export const isRemnant = (stage: Stage): stage is Remnant =>
  stage === 'white dwarf' || stage === 'neutron star' || stage === 'black hole'

/** Whether the star is on the asymptotic giant branch, where the superwind applies. */
export const isAsymptotic = (stage: Stage): boolean =>
  stage === 'early AGB' || stage === 'thermally pulsing AGB'

/** Whether the star is a giant with a convective envelope, for granulation and limb darkening. */
export const isGiant = (stage: Stage): boolean =>
  stage === 'giant branch' ||
  stage === 'core helium burning' ||
  isAsymptotic(stage)
