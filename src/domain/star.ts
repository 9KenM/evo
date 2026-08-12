import {
  HAWKING_TEMPERATURE_SOLAR,
  NEUTRON_STAR_RADIUS_KM,
  SCHWARZSCHILD_KM_PER_SOLAR_MASS,
  SOLAR_LOG_G,
  SOLAR_TEMPERATURE,
  kmToSolarRadii,
} from './constants.js'
import { blackbodyLinearRGB, blackbodyRGB, type LinearRGB, type RGB } from './color.js'
import { classify, type Spectral } from './classify.js'
import { isRemnant, type Stage } from './stage.js'
import { SOLAR, type Metallicity } from './metallicity.js'
import { zamsCoefficients, zamsProperties, type ZamsCoefficients } from './zams.js'
import {
  mainSequenceLifetime,
  timeToBGB,
  timescaleCoefficients,
  type TimescaleCoefficients,
} from './timescales.js'
import {
  luminosityTAMS,
  mainSequenceCoefficients,
  radiusTAMS,
  type MainSequenceCoefficients,
} from './mainSequence.js'
import {
  gyr,
  kelvin,
  massLostOver,
  solarLuminosities,
  solarMasses,
  solarMassesPerYear,
  solarRadii,
  type Gyr,
  type Kelvin,
  type SolarLuminosities,
  type SolarMasses,
  type SolarMassesPerYear,
  type SolarRadii,
} from './units.js'

export interface Photosphere {
  readonly luminosity: SolarLuminosities
  readonly temperature: Kelvin
  readonly radius: SolarRadii
}

export interface Lifetimes {
  readonly mainSequence: Gyr
  /** Hertzsprung gap. t_BGB − t_MS, both Hurley quantities. */
  readonly subgiant: Gyr
  readonly giant: Gyr
  /** Age at which the remnant forms. */
  readonly total: Gyr
}

export interface StarState {
  readonly massInitial: SolarMasses
  readonly metallicity: Metallicity
  readonly age: Gyr
  readonly stage: Stage
  readonly mass: SolarMasses
  readonly luminosity: SolarLuminosities
  readonly temperature: Kelvin
  readonly radius: SolarRadii
  readonly color: RGB
  readonly colorLinear: LinearRGB
  /** log g in cgs. Sets convective granule size, so the renderer keys surface detail off it. */
  readonly surfaceGravity: number
  readonly spectral: Spectral
  readonly zams: Photosphere
  readonly tams: Pick<Photosphere, 'luminosity' | 'radius'>
  readonly lifetimes: Lifetimes
}

/**
 * Metallicity-dependent coefficients, resolved once and reused.
 *
 * Every fit in this engine is a polynomial in ζ = log10(Z/Z☉), so the whole coefficient set depends
 * only on Z. Callers sweeping a track at fixed metallicity should build one of these and reuse it.
 */
export interface EvolutionContext {
  readonly metallicity: Metallicity
  readonly zams: ZamsCoefficients
  readonly timescales: TimescaleCoefficients
  readonly mainSequence: MainSequenceCoefficients
}

export function evolutionContext(metallicity: Metallicity): EvolutionContext {
  return {
    metallicity,
    zams: zamsCoefficients(metallicity),
    timescales: timescaleCoefficients(metallicity),
    mainSequence: mainSequenceCoefficients(metallicity),
  }
}

const contextCache = new Map<number, EvolutionContext>()

function cachedContext(metallicity: Metallicity): EvolutionContext {
  const existing = contextCache.get(metallicity)
  if (existing) return existing
  const built = evolutionContext(metallicity)
  contextCache.set(metallicity, built)
  return built
}

const radiusFrom = (luminosity: number, temperature: number): SolarRadii =>
  solarRadii(Math.pow(SOLAR_TEMPERATURE / temperature, 2) * Math.sqrt(luminosity))

const temperatureFrom = (luminosity: number, radius: number): Kelvin =>
  kelvin(Math.pow(luminosity / (radius * radius), 0.25) * SOLAR_TEMPERATURE)

const lerp = (from: number, to: number, t: number) => from + (to - from) * t
const logLerp = (from: number, to: number, t: number) =>
  Math.exp(lerp(Math.log(from), Math.log(to), t))
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

export function lifetimes(mass: SolarMasses, ctx: EvolutionContext): Lifetimes {
  const ms = mainSequenceLifetime(mass, ctx.timescales)
  const bgb = timeToBGB(mass, ctx.timescales)

  // Hertzsprung gap is the real gap between the two Hurley timescales.
  const subgiant = gyr(Math.max(bgb - ms, ms * 1e-3))

  /*
   * PROVISIONAL. The giant-branch duration needs Hurley's core-mass/luminosity machinery
   * (the GB parameter block and the t_inf timescales), which is not implemented yet. This
   * fraction of t_BGB is a stand-in that keeps the phase present and ordered; it is not a fit.
   */
  const giant = gyr(0.15 * bgb)

  return { mainSequence: ms, subgiant, giant, total: gyr(ms + subgiant + giant) }
}

export function stageAt(massInitial: SolarMasses, age: Gyr, life: Lifetimes): Stage {
  if (age <= life.mainSequence) return 'main sequence'
  if (age <= life.mainSequence + life.subgiant) return 'subgiant'
  if (age <= life.total) return 'giant'
  if (massInitial <= 8) return 'white dwarf'
  if (massInitial <= 25) return 'neutron star'
  return 'black hole'
}

// --- Nuclear-burning phases -------------------------------------------------

/**
 * Luminosity, temperature and radius of a burning star at a given age.
 *
 * The main sequence interpolates in log space between the Tout ZAMS values and the Hurley
 * terminal-age values, so both endpoints are anchored on published fits.
 *
 * The post-main-sequence phases are PROVISIONAL: they start exactly at the terminal-age values, so
 * there is no discontinuity at that boundary, but their shape is a smooth stand-in rather than
 * Hurley's giant-branch fits.
 */
export function photosphereAt(
  stage: Stage,
  age: Gyr,
  mass: SolarMasses,
  ctx: EvolutionContext,
  life: Lifetimes,
): Photosphere {
  const zamsProps = zamsProperties(mass, ctx.zams)
  const lTAMS = luminosityTAMS(mass, ctx.mainSequence)
  const rTAMS = radiusTAMS(mass, ctx.mainSequence, ctx.zams)

  if (stage === 'main sequence') {
    const tau = clamp01(age / life.mainSequence)
    const luminosity = solarLuminosities(logLerp(zamsProps.luminosity, lTAMS, tau))
    const radius = solarRadii(logLerp(zamsProps.radius, rTAMS, tau))
    return { luminosity, radius, temperature: temperatureFrom(luminosity, radius) }
  }

  const tTAMS = temperatureFrom(lTAMS, rTAMS)

  if (stage === 'subgiant') {
    const tau = clamp01((age - life.mainSequence) / life.subgiant)
    // Crosses the Hertzsprung gap at near-constant luminosity, cooling toward the giant branch.
    const luminosity = solarLuminosities(logLerp(lTAMS, lTAMS * 2.5, tau))
    const temperature = kelvin(logLerp(tTAMS, Math.min(tTAMS, 4800), tau))
    return { luminosity, temperature, radius: radiusFrom(luminosity, temperature) }
  }

  const tau = clamp01((age - (life.mainSequence + life.subgiant)) / life.giant)
  const luminosity = solarLuminosities(logLerp(lTAMS * 2.5, lTAMS * 25, tau))
  const temperature = kelvin(logLerp(Math.min(tTAMS, 4800), 3200, tau))
  return { luminosity, temperature, radius: radiusFrom(luminosity, temperature) }
}

// --- Mass loss --------------------------------------------------------------

/**
 * Reimers' empirical mass-loss rate, in solar masses **per year**.
 *
 * The previous engine multiplied this rate directly by an age in Gyr, losing a factor of 10⁹ and
 * making mass loss unobservable. The branded return type means that no longer compiles.
 */
export function reimersRate(
  luminosity: SolarLuminosities,
  radius: SolarRadii,
  mass: SolarMasses,
  eta = 0.4,
): SolarMassesPerYear {
  return solarMassesPerYear(eta * 4e-13 * ((luminosity * radius) / mass))
}

const MASS_LOSS_STEPS = 32

function cumulativeMassLoss(
  massInitial: SolarMasses,
  age: Gyr,
  ctx: EvolutionContext,
  life: Lifetimes,
): SolarMasses {
  const start = life.mainSequence
  const end = Math.min(age, life.total)
  if (end <= start) return solarMasses(0)

  const step = gyr((end - start) / MASS_LOSS_STEPS)
  let lost = 0

  for (let i = 0; i < MASS_LOSS_STEPS; i++) {
    const t = gyr(start + (i + 0.5) * step)
    const stage = stageAt(massInitial, t, life)
    const { luminosity, radius } = photosphereAt(stage, t, massInitial, ctx, life)
    const rate = reimersRate(luminosity, radius, solarMasses(massInitial - lost))
    lost += massLostOver(rate, step)
  }

  return solarMasses(Math.min(lost, massInitial * 0.9))
}

// --- Remnants ---------------------------------------------------------------

/** Initial–final mass relation, Kalirai et al. (2008). */
export const whiteDwarfMass = (massInitial: SolarMasses): SolarMasses =>
  solarMasses(Math.min(0.109 * massInitial + 0.394, 1.4, massInitial))

export const neutronStarMass = (massInitial: SolarMasses): SolarMasses =>
  solarMasses(lerp(1.25, 2.0, (massInitial - 8) / (25 - 8)))

export const blackHoleMass = (massInitial: SolarMasses): SolarMasses =>
  solarMasses(Math.max(3, 0.3 * massInitial))

/** Mestel cooling. */
function whiteDwarfPhotosphere(mass: SolarMasses, cooling: Gyr): Photosphere {
  const radius = solarRadii(0.01 * Math.pow(mass, -1 / 3))
  const t = Math.max(cooling, 1e-3)
  const luminosity = solarLuminosities(6.8e-3 * mass * Math.pow(t, -7 / 5))
  return { luminosity, radius, temperature: temperatureFrom(luminosity, radius) }
}

function neutronStarPhotosphere(cooling: Gyr): Photosphere {
  const radius = kmToSolarRadii(NEUTRON_STAR_RADIUS_KM)
  const t = Math.max(cooling, 1e-6)
  const temperature = kelvin(1e6 * Math.pow(t / 1e-6, -1 / 6))
  const luminosity = solarLuminosities(
    radius * radius * Math.pow(temperature / SOLAR_TEMPERATURE, 4),
  )
  return { luminosity, radius, temperature }
}

function blackHolePhotosphere(mass: SolarMasses): Photosphere {
  const radius = kmToSolarRadii(SCHWARZSCHILD_KM_PER_SOLAR_MASS * mass)
  const temperature = kelvin(HAWKING_TEMPERATURE_SOLAR / mass)
  const luminosity = solarLuminosities(
    radius * radius * Math.pow(temperature / SOLAR_TEMPERATURE, 4),
  )
  return { luminosity, radius, temperature }
}

// --- Entry point ------------------------------------------------------------

export function evolveWith(
  massInitial: SolarMasses,
  age: Gyr,
  ctx: EvolutionContext,
): StarState {
  const zamsProps = zamsProperties(massInitial, ctx.zams)
  const life = lifetimes(massInitial, ctx)
  const stage = stageAt(massInitial, age, life)

  let mass: SolarMasses
  let photosphere: Photosphere

  if (isRemnant(stage)) {
    const cooling = gyr(Math.max(0, age - life.total))
    if (stage === 'white dwarf') {
      mass = whiteDwarfMass(massInitial)
      photosphere = whiteDwarfPhotosphere(mass, cooling)
    } else if (stage === 'neutron star') {
      mass = neutronStarMass(massInitial)
      photosphere = neutronStarPhotosphere(cooling)
    } else {
      mass = blackHoleMass(massInitial)
      photosphere = blackHolePhotosphere(mass)
    }
  } else {
    photosphere = photosphereAt(stage, age, massInitial, ctx, life)
    mass = solarMasses(massInitial - cumulativeMassLoss(massInitial, age, ctx, life))
  }

  return {
    massInitial,
    metallicity: ctx.metallicity,
    age,
    stage,
    mass,
    luminosity: photosphere.luminosity,
    temperature: photosphere.temperature,
    radius: photosphere.radius,
    color: blackbodyRGB(photosphere.temperature),
    colorLinear: blackbodyLinearRGB(photosphere.temperature),
    surfaceGravity: SOLAR_LOG_G + Math.log10(mass) - 2 * Math.log10(photosphere.radius),
    spectral: classify(stage, photosphere.temperature, photosphere.luminosity),
    zams: { ...zamsProps, temperature: temperatureFrom(zamsProps.luminosity, zamsProps.radius) },
    tams: {
      luminosity: luminosityTAMS(massInitial, ctx.mainSequence),
      radius: radiusTAMS(massInitial, ctx.mainSequence, ctx.zams),
    },
    lifetimes: life,
  }
}

/** Convenience entry point; resolves and caches the coefficient set for the given metallicity. */
export function evolve(
  massInitial: SolarMasses,
  age: Gyr,
  metallicity: Metallicity = SOLAR,
): StarState {
  return evolveWith(massInitial, age, cachedContext(metallicity))
}
