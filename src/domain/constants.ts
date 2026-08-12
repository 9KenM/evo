import { kelvin, kilometres, solarRadii } from './units.js'

/** IAU 2015 nominal solar effective temperature. */
export const SOLAR_TEMPERATURE = kelvin(5772)

export const SOLAR_RADIUS_KM = kilometres(695700)

/** Schwarzschild radius per solar mass: 2GM/c². */
export const SCHWARZSCHILD_KM_PER_SOLAR_MASS = 2.953

/** Hawking temperature of a 1 M☉ black hole, in K. Scales as 1/M. */
export const HAWKING_TEMPERATURE_SOLAR = 6.169e-8

/** Radius of a typical neutron star. Treated as mass-independent at this fidelity. */
export const NEUTRON_STAR_RADIUS_KM = kilometres(11)

export const kmToSolarRadii = (km: number) => solarRadii(km / SOLAR_RADIUS_KM)
