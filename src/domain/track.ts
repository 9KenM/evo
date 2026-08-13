import {
  ageAtCoreMass,
  ageAtLuminosity,
  coreLuminosity,
  coreMassBAGB,
  coreMassFromLuminosity,
  luminosityAtAge,
  luminosityBAGB,
  luminosityBGB,
  luminosityFromCoreMass,
  luminosityHeI,
  luminosityHeRatio,
  luminosityZAHB,
  radiusAGB,
  radiusGB,
  radiusMinimum,
  shellTimescales,
  heliumBurningTime,
  blueLoopFraction,
  type CoreLuminosity,
  type GiantBranchCoefficients,
} from './giantBranch.js'
import { mainSequenceState, type MainSequenceCoefficients } from './mainSequence.js'
import { windMassLoss } from './massLoss.js'
import { postAGBState, crossingTime } from './postAGB.js'
import { isAsymptotic, type Remnant, type Stage } from './stage.js'
import type { Metallicity } from './metallicity.js'
import type { SolarMasses } from './units.js'
import { SOLAR_TEMPERATURE } from './constants.js'

/*
 * The evolutionary track: where every phase boundary falls, and what the star looks like at any age
 * inside it.
 *
 * Working unit is Myr, because that is what every Hurley timescale is expressed in and converting
 * at each use is how unit bugs get in. Conversion to Gyr happens once, at the boundary of this
 * module.
 *
 * Mass loss is integrated along the track rather than applied afterwards, because it is what
 * *terminates* the AGB — the superwind removes the envelope, and the moment it is gone the star
 * becomes a post-AGB core. That coupling is physical, not incidental, and it is why the phase list
 * cannot be computed from the fits alone.
 */

/** Steps used to integrate the wind across the post-main-sequence. */
const WIND_STEPS = 600

/** Chandrasekhar mass. */
const CHANDRASEKHAR = 1.44

export interface PhaseSpan {
  readonly stage: Stage
  /** Myr. */
  readonly start: number
  /** Myr. */
  readonly end: number
}

export interface TrackSample {
  readonly stage: Stage
  readonly luminosity: number
  readonly radius: number
  readonly temperature: number
  readonly mass: number
  readonly coreMass: number
}

export interface EvolutionTrack {
  /** Nuclear-burning phases plus the planetary nebula, in order. Myr. */
  readonly phases: readonly PhaseSpan[]
  /** Age at which the remnant forms, in Myr. */
  readonly remnantAt: number
  readonly remnantStage: Remnant
  readonly remnantMass: number
  /** Mass of the star at the moment the remnant forms. */
  readonly massAtEnd: number
  readonly coreMassFinal: number
  sample(ageMyr: number): TrackSample
}

export interface TrackInput {
  readonly mass: SolarMasses
  readonly metallicity: Metallicity
  readonly giantBranch: GiantBranchCoefficients
  /** Main-sequence lifetime, Myr. */
  readonly mainSequence: number
  /** Time to the base of the giant branch, Myr. */
  readonly bgb: number
  readonly zamsLuminosity: number
  readonly zamsRadius: number
  readonly tamsLuminosity: number
  readonly tamsRadius: number
  readonly mainSequenceCoefficients: MainSequenceCoefficients
  /** Time of the convective-core hook, Myr. */
  readonly hookTime: number
  /** M_hook — below this there is no convective core to exhaust, so no hook. */
  readonly massHook: number
}

const logLerp = (from: number, to: number, t: number) =>
  Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * Math.min(1, Math.max(0, t)))

const temperatureFrom = (luminosity: number, radius: number) =>
  (luminosity / (radius * radius)) ** 0.25 * SOLAR_TEMPERATURE

/**
 * Remnant mass from the carbon-oxygen core. Fryer et al. (2012), "delayed" engine.
 *
 * Chosen over the "rapid" engine because it does not impose an artificial gap between the heaviest
 * neutron stars and the lightest black holes, which the observed mass function does not show
 * either. Replaces two invented formulae — a linear interpolation and `max(3, 0.3 M)` — neither of
 * which was fitted to anything, and the second of which could return a black hole heavier than the
 * star that made it.
 */
function remnantFromCore(coreMass: number, preSupernovaMass: number): {
  mass: number
  stage: Remnant
} {
  const proto =
    coreMass < 3.5 ? 1.2 : coreMass < 6 ? 1.3 : coreMass < 11 ? 1.4 : 1.6

  const available = Math.max(preSupernovaMass - proto, 0)

  let fallback: number
  if (coreMass < 2.5) {
    fallback = available > 0 ? 0.2 / available : 0
  } else if (coreMass < 3.5) {
    fallback = available > 0 ? (0.5 * coreMass - 1.05) / available : 0
  } else if (coreMass < 11) {
    const a = 0.133 - 0.093 / available
    fallback = a * coreMass + (1 - 11 * a)
  } else {
    fallback = 1
  }

  fallback = Math.min(1, Math.max(0, fallback))
  const mass = Math.min(proto + fallback * available, preSupernovaMass)

  return { mass, stage: mass > 2.5 ? 'black hole' : 'neutron star' }
}

export function buildTrack(input: TrackInput): EvolutionTrack {
  const {
    mass: massInitial,
    metallicity,
    giantBranch: gb,
    mainSequence: tMS,
    bgb: tBGB,
    zamsLuminosity,
    zamsRadius,
    tamsLuminosity,
    tamsRadius,
    mainSequenceCoefficients,
    hookTime,
    massHook,
  } = input

  const m = massInitial
  const { heliumFlash, firstGiantBranch, centralCarbon } = gb.thresholds
  const core = coreLuminosity(m, gb)

  const lBGB = luminosityBGB(m, gb)
  const lHeI = luminosityHeI(m, gb)
  const lBAGB = luminosityBAGB(m, gb)
  const mcBAGB = coreMassBAGB(m, gb)

  const hasGiantBranch = m <= firstGiantBranch
  const explodes = m >= centralCarbon

  // --- Giant branch ---------------------------------------------------------
  const gbTimes = shellTimescales(tBGB, lBGB, core.aH, core)
  const tHeI = hasGiantBranch ? ageAtLuminosity(lHeI, core.aH, core, gbTimes) : tBGB

  // --- Core helium burning --------------------------------------------------
  const degenerate = m <= heliumFlash
  const coreAtHeI = degenerate
    ? coreMassFromLuminosity(lHeI, core)
    : Math.min(0.95 * mcBAGB, coreMassFromLuminosity(lHeI, core))

  const tHe = degenerate
    ? heliumBurningTime(m, coreAtHeI, gb)
    : heliumBurningTime(m, 1, gb) * tBGB
  const tBAGB = tHeI + tHe

  /*
   * Where helium burning starts depends on how it ignited. A degenerate flash drops the star from
   * the giant-branch tip onto the zero-age horizontal branch — a real discontinuity of more than a
   * decade in luminosity, and the only one left in the whole track. Non-degenerate ignition has no
   * flash: the star arrives at L_HeI and then settles to the minimum before climbing to the AGB.
   */
  const lHeStart = degenerate ? luminosityZAHB(m, coreAtHeI, gb) : lHeI
  const lHeMin = degenerate ? lHeStart : lHeI * luminosityHeRatio(m, gb)
  const settleFraction = degenerate ? 0 : 0.15
  const loop = blueLoopFraction(m, gb)
  const rLoopMin = radiusMinimum(m, gb)

  // --- Early AGB, burning helium in a shell ---------------------------------
  const eagbTimes = shellTimescales(tBAGB, lBAGB, core.aHe, core)
  // Second dredge-up cuts the core back before thermal pulsing begins.
  const coreDredged =
    mcBAGB >= 0.8 && mcBAGB < 2.25 ? 0.44 * mcBAGB + 0.448 : mcBAGB
  const lTP = luminosityFromCoreMass(coreDredged, core)
  const tTP = ageAtCoreMass(coreDredged, core.aHe, core, eagbTimes)

  // --- Thermally pulsing AGB, both shells burning ---------------------------
  const tpTimes = shellTimescales(tTP, lTP, core.aHHe, core)
  const coreMax = Math.max(CHANDRASEKHAR, 0.773 * mcBAGB - 0.35)

  /*
   * Walk the post-main-sequence with the wind switched on. The AGB ends the moment the envelope is
   * gone or the core reaches its ceiling, and which of those happens first is exactly the
   * low-mass / high-mass divide: a solar-mass star runs out of envelope, a massive one runs out of
   * core headroom and ignites carbon.
   */
  /*
   * The thermally pulsing AGB diverges at tInf2 — the core-mass integral runs away — so that is the
   * hard horizon. It has to be approached as a *fraction of the remaining interval*, never by
   * scaling the absolute age: these are ages since the zero-age main sequence, so trimming a
   * solar-mass star's 12.4 Gyr clock by even a tenth of a per cent removes twelve million years,
   * which is more than the entire AGB it was meant to bound.
   */
  const horizon = Math.max(
    tpTimes.tInf2 - (tpTimes.tInf2 - tTP) * 1e-4,
    tBAGB + Math.max(tBAGB, 1) * 1e-9,
  )

  const ages: number[] = [tMS]
  const masses: number[] = [m]
  let mass: number = m
  let end = horizon
  let coreAtEnd = coreDredged
  let terminated = false

  const advance = (age: number): boolean => {
    const previous = ages[ages.length - 1] as number
    if (age <= previous) return false

    const at = photosphereAt((age + previous) / 2, mass)
    const rate = windMassLoss(
      {
        luminosity: at.luminosity,
        radius: at.radius,
        mass,
        coreMass: at.coreMass,
        asymptotic: isAsymptotic(at.stage),
      },
      metallicity,
    )

    mass = Math.max(at.coreMass, mass - rate * (age - previous) * 1e6)
    ages.push(age)
    masses.push(mass)
    coreAtEnd = at.coreMass

    if (mass - at.coreMass <= 1e-3 || at.coreMass >= coreMax) {
      end = age
      return true
    }
    return false
  }

  /*
   * Two segments. Uniform up to the base of the AGB, where the wind is weak and steady, then
   * refining geometrically toward the horizon, because the superwind accelerates by orders of
   * magnitude over the last few per cent of the AGB and a uniform grid would step straight over the
   * moment the envelope goes.
   */
  const approach = Math.round(WIND_STEPS / 3)
  for (let i = 1; i <= approach && !terminated; i++) {
    terminated = advance(tMS + ((tBAGB - tMS) * i) / approach)
  }
  for (let i = 0; i < WIND_STEPS && !terminated; i++) {
    const previous = ages[ages.length - 1] as number
    terminated = advance(previous + (horizon - previous) * 0.02)
  }

  const massAtEnd = mass

  /** Mass at an age, from the integrated wind history. */
  function massAt(age: number): number {
    if (age <= (ages[0] as number)) return m
    if (age >= (ages[ages.length - 1] as number)) return masses[masses.length - 1] as number
    let lo = 0
    let hi = ages.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if ((ages[mid] as number) <= age) lo = mid
      else hi = mid
    }
    const a0 = ages[lo] as number
    const a1 = ages[hi] as number
    const m0 = masses[lo] as number
    const m1 = masses[hi] as number
    return a1 === a0 ? m0 : m0 + ((m1 - m0) * (age - a0)) / (a1 - a0)
  }

  /** Photosphere during the nuclear-burning phases. `currentMass` is passed during integration. */
  function photosphereAt(age: number, currentMass?: number): TrackSample {
    const mt = currentMass ?? massAt(age)

    if (age <= tMS) {
      const { luminosity, radius } = mainSequenceState(
        m,
        age,
        tMS,
        hookTime,
        massHook,
        { luminosity: zamsLuminosity, radius: zamsRadius },
        { luminosity: tamsLuminosity, radius: tamsRadius },
        mainSequenceCoefficients,
      )
      return {
        stage: 'main sequence',
        luminosity,
        radius,
        temperature: temperatureFrom(luminosity, radius),
        mass: mt,
        coreMass: 0,
      }
    }

    if (age <= tBGB) {
      /*
       * Hertzsprung gap. Ends at the base of the giant branch, or at helium ignition for stars above
       * M_FGB which never have a first giant branch. Interpolating in log space between the
       * terminal-age and giant-branch anchors keeps both endpoints exact; the path between them is
       * Hurley's remaining perturbation work.
       */
      const target = hasGiantBranch ? lBGB : lHeI
      const tau = tBGB > tMS ? (age - tMS) / (tBGB - tMS) : 1
      const luminosity = logLerp(tamsLuminosity, target, tau)
      const endRadius = hasGiantBranch
        ? radiusGB(m, lBGB, gb)
        : radiusGB(m, lHeI, gb)
      const radius = logLerp(tamsRadius, endRadius, tau)
      return {
        stage: 'hertzsprung gap',
        luminosity,
        radius,
        temperature: temperatureFrom(luminosity, radius),
        mass: mt,
        coreMass: coreMassFromLuminosity(luminosity, core),
      }
    }

    if (hasGiantBranch && age <= tHeI) {
      // First giant branch: luminosity is set entirely by the growing core.
      const luminosity = luminosityAtAge(age, core.aH, core, gbTimes)
      const radius = radiusGB(m, luminosity, gb)
      return {
        stage: 'giant branch',
        luminosity,
        radius,
        temperature: temperatureFrom(luminosity, radius),
        mass: mt,
        coreMass: coreMassFromLuminosity(luminosity, core),
      }
    }

    if (age <= tBAGB) {
      const tau = tHe > 0 ? (age - tHeI) / tHe : 1
      const luminosity =
        tau < settleFraction
          ? logLerp(lHeStart, lHeMin, tau / settleFraction)
          : logLerp(lHeMin, lBAGB, (tau - settleFraction) / (1 - settleFraction))

      /*
       * The red edge migrates from the giant-branch relation to the AGB one across the phase, which
       * is what hands the star over to the early AGB without a step — R_AGB is systematically wider
       * than R_GB at the same luminosity, so switching functions abruptly would leave one.
       */
      const red = logLerp(radiusGB(m, luminosity, gb), radiusAGB(m, luminosity, gb), tau)

      /*
       * The blue loop. Intermediate-mass stars leave the red edge partway through helium burning,
       * contract and heat, then return — which is what puts Cepheids in the instability strip. The
       * excursion is weighted to vanish at both ends of the loop so the radius stays continuous.
       */
      let radius = red
      if (loop > 0 && tau < loop) {
        const weight = Math.sin(Math.PI * (tau / loop))
        radius = Math.exp(Math.log(red) + (Math.log(rLoopMin) - Math.log(red)) * weight)
      }

      return {
        stage: 'core helium burning',
        luminosity,
        radius,
        temperature: temperatureFrom(luminosity, radius),
        mass: mt,
        coreMass: coreAtHeI,
      }
    }

    if (age <= tTP) {
      const luminosity = luminosityAtAge(age, core.aHe, core, eagbTimes)
      const radius = radiusAGB(m, luminosity, gb)
      return {
        stage: 'early AGB',
        luminosity,
        radius,
        temperature: temperatureFrom(luminosity, radius),
        mass: mt,
        coreMass: coreMassAtAgeSafe(age, core.aHe, eagbTimes),
      }
    }

    const luminosity = luminosityAtAge(age, core.aHHe, core, tpTimes)
    const radius = radiusAGB(m, luminosity, gb)
    return {
      stage: 'thermally pulsing AGB',
      luminosity,
      radius,
      temperature: temperatureFrom(luminosity, radius),
      mass: mt,
      coreMass: coreMassAtAgeSafe(age, core.aHHe, tpTimes),
    }
  }

  function coreMassAtAgeSafe(
    age: number,
    rate: number,
    times: { tInf1: number; tX: number; tInf2: number },
  ): number {
    const luminosity = luminosityAtAge(age, rate, core, times)
    return Math.max(coreDredged, coreMassFromLuminosity(luminosity, core))
  }

  // --- Assemble the phase list ----------------------------------------------
  const tipState = photosphereAt(end)
  const coreFinal = Math.min(Math.max(coreAtEnd, tipState.coreMass), coreMax)

  const whiteDwarfRadius = 0.0115 * Math.pow(Math.min(coreFinal, 1.43), -1 / 3)
  const nebula = explodes ? 0 : crossingTime(coreFinal) / 1e6
  const remnantAt = end + nebula

  const spans: PhaseSpan[] = []
  const add = (stage: Stage, start: number, stop: number) => {
    if (stop > start) spans.push({ stage, start, end: stop })
  }

  add('main sequence', 0, tMS)
  add('hertzsprung gap', tMS, Math.min(tBGB, end))
  if (hasGiantBranch) add('giant branch', Math.min(tBGB, end), Math.min(tHeI, end))
  add('core helium burning', Math.min(tHeI, end), Math.min(tBAGB, end))
  add('early AGB', Math.min(tBAGB, end), Math.min(tTP, end))
  add('thermally pulsing AGB', Math.min(tTP, end), end)
  if (!explodes) add('planetary nebula', end, remnantAt)

  const remnant = explodes
    ? remnantFromCore(coreFinal, massAtEnd)
    : { mass: Math.min(coreFinal, CHANDRASEKHAR, massAtEnd), stage: 'white dwarf' as Remnant }

  return {
    phases: spans,
    remnantAt,
    remnantStage: remnant.stage,
    remnantMass: remnant.mass,
    massAtEnd,
    coreMassFinal: coreFinal,
    sample(age) {
      if (!explodes && age > end && age <= remnantAt) {
        const tau = nebula > 0 ? (age - end) / nebula : 1
        const state = postAGBState(
          tau,
          tipState.luminosity,
          tipState.temperature,
          coreFinal,
          whiteDwarfRadius,
        )
        return {
          stage: 'planetary nebula',
          luminosity: state.luminosity,
          radius: state.radius,
          temperature: state.temperature,
          mass: massAtEnd,
          coreMass: coreFinal,
        }
      }
      return photosphereAt(Math.min(age, end))
    },
  }
}
