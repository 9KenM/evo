import {
  HAWKING_TEMPERATURE_SOLAR,
  NEUTRON_STAR_RADIUS_KM,
  SCHWARZSCHILD_KM_PER_SOLAR_MASS,
  SOLAR_TEMPERATURE,
  kmToSolarRadii,
} from './constants.js'
import { blackbodyRGB, type RGB } from './color.js'
import { classify, type Spectral } from './classify.js'
import { isRemnant, type Stage } from './stage.js'
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
  readonly subgiant: Gyr
  readonly giant: Gyr
  /** Age at which the remnant forms. */
  readonly total: Gyr
}

export interface StarState {
  readonly massInitial: SolarMasses
  readonly age: Gyr
  readonly stage: Stage
  readonly mass: SolarMasses
  readonly luminosity: SolarLuminosities
  readonly temperature: Kelvin
  readonly radius: SolarRadii
  readonly color: RGB
  readonly spectral: Spectral
  readonly zams: Photosphere
  readonly lifetimes: Lifetimes
}

const radiusFrom = (luminosity: number, temperature: number): SolarRadii =>
  solarRadii(Math.pow(SOLAR_TEMPERATURE / temperature, 2) * Math.sqrt(luminosity))

const temperatureFrom = (luminosity: number, radius: number): Kelvin =>
  kelvin(Math.pow(luminosity / (radius * radius), 0.25) * SOLAR_TEMPERATURE)

const lerp = (from: number, to: number, t: number) => from + (to - from) * t

// --- Zero-age main sequence -------------------------------------------------

/*
 * Mass–luminosity relation. The previous engine steepened the exponent to M⁴ above 20 M☉, which
 * is the wrong direction — it made a 30 M☉ star 810,000 L☉ with a 0.37 Myr main-sequence lifetime.
 * The relation flattens at high mass toward the Eddington-limited regime, it does not steepen.
 */
function zamsLuminosity(mass: number): SolarLuminosities {
  if (mass < 0.43) return solarLuminosities(0.23 * Math.pow(mass, 2.3))
  if (mass < 2) return solarLuminosities(Math.pow(mass, 4))
  if (mass < 55) return solarLuminosities(1.4 * Math.pow(mass, 3.5))
  return solarLuminosities(32000 * mass)
}

const zamsRadius = (mass: number): SolarRadii =>
  solarRadii(mass < 1 ? Math.pow(mass, 0.57) : Math.pow(mass, 0.8))

export function zams(massInitial: SolarMasses): Photosphere {
  const luminosity = zamsLuminosity(massInitial)
  const radius = zamsRadius(massInitial)
  return { luminosity, radius, temperature: temperatureFrom(luminosity, radius) }
}

export function lifetimes(massInitial: SolarMasses, zamsLum: SolarLuminosities): Lifetimes {
  const mainSequence = gyr(10 * (massInitial / zamsLum))
  const subgiant = gyr(mainSequence / 10)
  const giant = gyr(mainSequence / 10)
  return {
    mainSequence,
    subgiant,
    giant,
    total: gyr(mainSequence + subgiant + giant),
  }
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

const eddingtonLimit = (massInitial: number) => 32000 * massInitial

/**
 * Luminosity, temperature and radius of a hydrogen/helium-burning star at a given age.
 * Defined for the main sequence, subgiant and giant stages only.
 */
export function photosphereAt(
  stage: Stage,
  age: Gyr,
  massInitial: SolarMasses,
  zamsProps: Photosphere,
  life: Lifetimes,
): Photosphere {
  const eddington = eddingtonLimit(massInitial)
  const peakMS = zamsProps.luminosity * (1 + 1 / (18 * massInitial))

  if (stage === 'main sequence') {
    const luminosity = solarLuminosities(
      lerp(zamsProps.luminosity, peakMS, age / life.mainSequence),
    )
    const temperature = zamsProps.temperature
    return { luminosity, temperature, radius: radiusFrom(luminosity, temperature) }
  }

  if (stage === 'subgiant') {
    const luminosity = solarLuminosities(Math.min(peakMS * 5, eddington))
    const from = Math.min(zamsProps.temperature, 7000)
    const to = Math.min(zamsProps.temperature, 4800)
    const elapsed = (age - life.mainSequence) / life.subgiant
    const temperature = kelvin(lerp(from, to, elapsed))
    return { luminosity, temperature, radius: radiusFrom(luminosity, temperature) }
  }

  const luminosity = solarLuminosities(Math.min(peakMS * 25, eddington))
  const elapsed = (age - (life.mainSequence + life.subgiant)) / life.giant
  const temperature = kelvin(lerp(4800, 3000, elapsed))
  return { luminosity, temperature, radius: radiusFrom(luminosity, temperature) }
}

// --- Mass loss --------------------------------------------------------------

/**
 * Reimers' empirical mass-loss rate, in solar masses **per year**.
 *
 * The previous engine multiplied this rate directly by an age expressed in Gyr, losing a factor of
 * 10⁹ and making mass loss unobservable — a solar-mass star finished the giant branch at exactly
 * 1.000 M☉. The branded return type means that mistake no longer compiles.
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

/** Integrates Reimers loss over the post-main-sequence time elapsed so far. */
function cumulativeMassLoss(
  massInitial: SolarMasses,
  age: Gyr,
  zamsProps: Photosphere,
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
    const { luminosity, radius } = photosphereAt(stage, t, massInitial, zamsProps, life)
    const rate = reimersRate(luminosity, radius, solarMasses(massInitial - lost))
    lost += massLostOver(rate, step)
  }

  return solarMasses(Math.min(lost, massInitial * 0.9))
}

// --- Remnants ---------------------------------------------------------------

/**
 * Initial–final mass relation, Kalirai et al. (2008).
 *
 * The previous engine used `(M - 0.1) / (8 - 0.1) * (1.4 - 0.9)`, which omits the additive term and
 * returned 0.057 M☉ for a solar progenitor — well below the ~0.5 M☉ a 1 M☉ star actually leaves.
 */
export const whiteDwarfMass = (massInitial: SolarMasses): SolarMasses =>
  solarMasses(Math.min(0.109 * massInitial + 0.394, 1.4, massInitial))

/** Neutron star gravitational mass, spanning the observed ~1.2–2.2 M☉ range. */
export const neutronStarMass = (massInitial: SolarMasses): SolarMasses =>
  solarMasses(lerp(1.25, 2.0, (massInitial - 8) / (25 - 8)))

/** Black hole mass after fallback; the progenitor sheds most of its envelope first. */
export const blackHoleMass = (massInitial: SolarMasses): SolarMasses =>
  solarMasses(Math.max(3, 0.3 * massInitial))

/**
 * Mestel cooling. The previous engine divided the post-remnant age by 99,999,999, which put the
 * white dwarf cooling timescale at 10⁸ Gyr — it was still 20,000 K at an age of 1000 Gyr.
 */
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

/**
 * Full state of a star of the given initial mass at the given age.
 *
 * Pure and single-pass: every quantity is computed exactly once, in dependency order. The previous
 * engine called its radius, temperature and mass functions two or three times each, and some of
 * those calls read fields that had not been assigned yet.
 */
export function evolve(massInitial: SolarMasses, age: Gyr): StarState {
  const zamsProps = zams(massInitial)
  const life = lifetimes(massInitial, zamsProps.luminosity)
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
    photosphere = photosphereAt(stage, age, massInitial, zamsProps, life)
    mass = solarMasses(massInitial - cumulativeMassLoss(massInitial, age, zamsProps, life))
  }

  return {
    massInitial,
    age,
    stage,
    mass,
    luminosity: photosphere.luminosity,
    temperature: photosphere.temperature,
    radius: photosphere.radius,
    color: blackbodyRGB(photosphere.temperature),
    spectral: classify(stage, photosphere.temperature, photosphere.luminosity),
    zams: zamsProps,
    lifetimes: life,
  }
}
