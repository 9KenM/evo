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
import { giantBranchCoefficients, type GiantBranchCoefficients } from './giantBranch.js'
import { buildTrack, type EvolutionTrack } from './track.js'
import { peakTemperature } from './postAGB.js'
import { SOLAR, type Metallicity } from './metallicity.js'
import { zamsCoefficients, zamsProperties, type ZamsCoefficients } from './zams.js'
import {
  hookFraction,
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
  solarLuminosities,
  solarMasses,
  solarRadii,
  type Gyr,
  type Kelvin,
  type SolarLuminosities,
  type SolarMasses,
  type SolarRadii,
} from './units.js'

export interface Photosphere {
  readonly luminosity: SolarLuminosities
  readonly temperature: Kelvin
  readonly radius: SolarRadii
}

/** A nuclear-burning phase, in Gyr. */
export interface Phase {
  readonly stage: Stage
  readonly start: Gyr
  readonly end: Gyr
}

export interface StarState {
  readonly massInitial: SolarMasses
  readonly metallicity: Metallicity
  readonly age: Gyr
  readonly stage: Stage
  readonly mass: SolarMasses
  /** Mass of the burning core, in solar masses. Zero on the main sequence. */
  readonly coreMass: SolarMasses
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
  readonly giantBranch: GiantBranchCoefficients
}

export function evolutionContext(metallicity: Metallicity): EvolutionContext {
  const timescales = timescaleCoefficients(metallicity)
  return {
    metallicity,
    zams: zamsCoefficients(metallicity),
    timescales,
    mainSequence: mainSequenceCoefficients(metallicity),
    giantBranch: giantBranchCoefficients(metallicity, timescales),
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

const MYR_PER_GYR = 1000

/**
 * The full evolutionary track for one (mass, metallicity) pair.
 *
 * Building it integrates the wind across the whole post-main-sequence, so it is far from free and
 * every caller should hold onto the result rather than rebuilding per sample.
 */
export function starTrack(massInitial: SolarMasses, ctx: EvolutionContext): EvolutionTrack {
  const zams = zamsProperties(massInitial, ctx.zams)
  return buildTrack({
    mass: massInitial,
    metallicity: ctx.metallicity,
    giantBranch: ctx.giantBranch,
    mainSequence: mainSequenceLifetime(massInitial, ctx.timescales) * MYR_PER_GYR,
    bgb: timeToBGB(massInitial, ctx.timescales) * MYR_PER_GYR,
    zamsLuminosity: zams.luminosity,
    zamsRadius: zams.radius,
    tamsLuminosity: luminosityTAMS(massInitial, ctx.mainSequence),
    tamsRadius: radiusTAMS(massInitial, ctx.mainSequence, ctx.zams),
    mainSequenceCoefficients: ctx.mainSequence,
    hookTime:
      hookFraction(massInitial, ctx.timescales) *
      timeToBGB(massInitial, ctx.timescales) *
      MYR_PER_GYR,
    massHook: ctx.timescales.massHook,
  })
}

const trackCache = new Map<string, EvolutionTrack>()

export function cachedTrack(massInitial: SolarMasses, ctx: EvolutionContext): EvolutionTrack {
  const key = `${massInitial}|${ctx.metallicity}`
  const existing = trackCache.get(key)
  if (existing) return existing
  const built = starTrack(massInitial, ctx)
  if (trackCache.size > 64) trackCache.clear()
  trackCache.set(key, built)
  return built
}

/** Phase spans in Gyr, for the timeline. */
export const phasesOf = (track: EvolutionTrack): Phase[] =>
  track.phases.map((phase) => ({
    stage: phase.stage,
    start: gyr(phase.start / MYR_PER_GYR),
    end: gyr(phase.end / MYR_PER_GYR),
  }))

// --- Remnants ---------------------------------------------------------------

/**
 * White dwarf radius from the mass-radius relation for a degenerate carbon-oxygen configuration.
 * Diverges toward zero at the Chandrasekhar mass, hence the clamp.
 */
export const whiteDwarfRadius = (mass: number): SolarRadii =>
  solarRadii(0.0115 * Math.pow(Math.min(mass, 1.43), -1 / 3))

/**
 * White dwarf cooling, Mestel.
 *
 * The cooling clock carries an offset so that the star's luminosity is continuous with the end of
 * the planetary nebula rather than starting from an arbitrary floor. Without it there is a step at
 * the moment the nebula disperses, which is precisely the kind of discontinuity this rewrite
 * exists to remove.
 */
function whiteDwarfPhotosphere(
  mass: SolarMasses,
  cooling: number,
  handoverLuminosity: number,
): Photosphere {
  const radius = whiteDwarfRadius(mass)
  const offset = Math.pow((6.8e-3 * mass) / handoverLuminosity, 1 / 1.4)
  const t = Math.max(offset + cooling, 1e-6)
  const luminosity = solarLuminosities(6.8e-3 * mass * Math.pow(t, -7 / 5))
  return {
    luminosity,
    radius,
    temperature: kelvin(
      Math.pow(luminosity / (radius * radius), 0.25) * SOLAR_TEMPERATURE,
    ),
  }
}

function neutronStarPhotosphere(cooling: Gyr): Photosphere {
  const radius = kmToSolarRadii(NEUTRON_STAR_RADIUS_KM)
  const t = Math.max(cooling, 1e-6)
  const temperature = kelvin(1e6 * Math.pow(t / 1e-6, -1 / 6))
  return {
    luminosity: solarLuminosities(
      radius * radius * Math.pow(temperature / SOLAR_TEMPERATURE, 4),
    ),
    radius,
    temperature,
  }
}

function blackHolePhotosphere(mass: SolarMasses): Photosphere {
  const radius = kmToSolarRadii(SCHWARZSCHILD_KM_PER_SOLAR_MASS * mass)
  const temperature = kelvin(HAWKING_TEMPERATURE_SOLAR / mass)
  return {
    luminosity: solarLuminosities(
      radius * radius * Math.pow(temperature / SOLAR_TEMPERATURE, 4),
    ),
    radius,
    temperature,
  }
}

// --- Entry point ------------------------------------------------------------

export function evolveOn(
  massInitial: SolarMasses,
  age: Gyr,
  ctx: EvolutionContext,
  track: EvolutionTrack,
): StarState {
  const zams = zamsProperties(massInitial, ctx.zams)
  const ageMyr = age * MYR_PER_GYR

  let stage: Stage
  let mass: SolarMasses
  let coreMass: SolarMasses
  let photosphere: Photosphere

  if (ageMyr <= track.remnantAt) {
    const sample = track.sample(ageMyr)
    stage = sample.stage
    mass = solarMasses(sample.mass)
    coreMass = solarMasses(sample.coreMass)
    photosphere = {
      luminosity: solarLuminosities(sample.luminosity),
      radius: solarRadii(sample.radius),
      temperature: kelvin(sample.temperature),
    }
  } else {
    stage = track.remnantStage
    mass = solarMasses(track.remnantMass)
    coreMass = mass
    const cooling = gyr((ageMyr - track.remnantAt) / MYR_PER_GYR)

    if (stage === 'white dwarf') {
      // Luminosity the nebula handed over: the cooling track starts exactly where it ended.
      const handover =
        whiteDwarfRadius(mass) ** 2 *
        Math.pow(peakTemperature(track.coreMassFinal) / SOLAR_TEMPERATURE, 4)
      photosphere = whiteDwarfPhotosphere(mass, cooling, handover)
    } else if (stage === 'neutron star') {
      photosphere = neutronStarPhotosphere(cooling)
    } else {
      photosphere = blackHolePhotosphere(mass)
    }
  }

  return {
    massInitial,
    metallicity: ctx.metallicity,
    age,
    stage,
    mass,
    coreMass,
    luminosity: photosphere.luminosity,
    temperature: photosphere.temperature,
    radius: photosphere.radius,
    color: blackbodyRGB(photosphere.temperature),
    colorLinear: blackbodyLinearRGB(photosphere.temperature),
    surfaceGravity: SOLAR_LOG_G + Math.log10(mass) - 2 * Math.log10(photosphere.radius),
    spectral: classify(stage, photosphere.temperature, photosphere.luminosity),
    zams: {
      ...zams,
      temperature: kelvin(
        Math.pow(zams.luminosity / (zams.radius * zams.radius), 0.25) * SOLAR_TEMPERATURE,
      ),
    },
    tams: {
      luminosity: luminosityTAMS(massInitial, ctx.mainSequence),
      radius: radiusTAMS(massInitial, ctx.mainSequence, ctx.zams),
    },
  }
}

export function evolveWith(
  massInitial: SolarMasses,
  age: Gyr,
  ctx: EvolutionContext,
): StarState {
  return evolveOn(massInitial, age, ctx, cachedTrack(massInitial, ctx))
}

/** Convenience entry point; resolves and caches the coefficient set for the given metallicity. */
export function evolve(
  massInitial: SolarMasses,
  age: Gyr,
  metallicity: Metallicity = SOLAR,
): StarState {
  return evolveWith(massInitial, age, cachedContext(metallicity))
}
