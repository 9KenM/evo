import { SOLAR, type Metallicity } from './metallicity.js'
import { isRemnant, type Stage } from './stage.js'
import {
  evolutionContext,
  evolveWith,
  lifetimes,
  stageAt,
  type EvolutionContext,
  type StarState,
} from './star.js'
import { gyr, type Gyr, type SolarMasses } from './units.js'

/** Earth's orbital radius, in solar radii. */
const EARTH_ORBIT = 215.03

/** Remnant span shown after the last burning phase, as a fraction of the burning lifetime. */
const REMNANT_SPAN = 0.35

/** Samples per burning phase. Allocated per phase so brief ones are never stepped over. */
const SAMPLES_PER_PHASE = 200

/** Samples across the remnant tail, geometrically spaced because cooling is fastest at the start. */
const REMNANT_SAMPLES = 400

/**
 * Share of the strip each phase receives: main sequence, Hertzsprung gap, giant, remnant.
 *
 * Fixed rather than proportional to duration, and that is the whole design. Real durations span
 * five orders of magnitude — a 30 M☉ star crosses the Hertzsprung gap in 8 kyr against 5.8 Myr on
 * the main sequence — so any duration-proportional axis leaves the interesting phases as sub-pixel
 * slivers. Allocating fixed shares guarantees every phase is visible and clickable at every mass.
 *
 * The cost is that the strip no longer reads as relative duration. The time tick marks carry that
 * instead: they bunch up wherever time is compressed, the way ticks bunch on a log axis.
 */
const PHASE_SHARES = [0.4, 0.14, 0.2, 0.26] as const

/**
 * Softening applied to the rate of observable change before it becomes width *within* a phase.
 *
 * At 1 the fastest moments in a phase would swallow it whole. A fractional exponent expands rapid
 * stretches enough to be seen while leaving the rest of the phase navigable.
 */
const WARP_SOFTENING = 0.6

/** Quiescent floor within a phase, as a quantile of that phase's own softened rates. */
const WARP_FLOOR_QUANTILE = 0.3

/** Ceiling on any single interval, as a multiple of its phase's floor. */
const WARP_CEILING = 30

export interface Bookmark {
  readonly age: Gyr
  readonly label: string
  readonly stage: Stage
}

export interface PhaseSpan {
  readonly stage: Stage
  readonly start: Gyr
  readonly end: Gyr
}

export interface LifecycleTrack {
  readonly massInitial: SolarMasses
  readonly metallicity: Metallicity
  /** End of the displayed track, including the remnant tail. */
  readonly end: Gyr
  readonly phases: readonly PhaseSpan[]
  readonly bookmarks: readonly Bookmark[]
  /** Age to normalised position on the warped timeline, in [0, 1]. */
  warp(age: Gyr): number
  /** Warped position back to age. */
  unwarp(position: number): Gyr
  sample(age: Gyr): StarState
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[index] as number
}

interface Grid {
  readonly ages: Gyr[]
  /** Index of the first sample of each phase; the last entry closes the final phase. */
  readonly starts: number[]
}

/** Ages at which the track is evaluated: dense within every phase, geometric across the remnant. */
function sampleGrid(life: ReturnType<typeof lifetimes>, end: Gyr): Grid {
  const boundaries = [0, life.mainSequence, life.mainSequence + life.subgiant, life.total]

  const ages: Gyr[] = []
  const starts: number[] = []

  for (let phase = 0; phase < boundaries.length - 1; phase++) {
    starts.push(ages.length)
    const from = boundaries[phase] as number
    const to = boundaries[phase + 1] as number
    for (let i = 0; i < SAMPLES_PER_PHASE; i++) {
      ages.push(gyr(from + ((to - from) * i) / SAMPLES_PER_PHASE))
    }
  }

  starts.push(ages.length)
  const tail = end - life.total
  for (let i = 0; i <= REMNANT_SAMPLES; i++) {
    const u = i / REMNANT_SAMPLES
    // Geometric: resolves the steep early cooling without wasting samples on the long cold tail.
    ages.push(gyr(life.total + tail * (Math.expm1(6 * u) / Math.expm1(6))))
  }

  starts.push(ages.length)
  return { ages, starts }
}

/**
 * Everything the timeline and the clock need for one (mass, metallicity) pair.
 *
 * The warp is the centre of it. A constant-rate playback cannot show a full lifecycle — a solar-mass
 * star spends 11 Gyr on the main sequence and crosses the Hertzsprung gap in 0.58 Gyr, and later
 * phases are shorter still, so at any speed that makes the main sequence watchable the transitions
 * are gone in a frame. Warping time by the rate of observable change fixes both problems at once:
 * the timeline axis magnifies exactly where things happen, and playback that advances the warped
 * coordinate at a constant rate slows down through transitions by construction.
 */
export function computeTrack(
  massInitial: SolarMasses,
  metallicity: Metallicity = SOLAR,
  context?: EvolutionContext,
): LifecycleTrack {
  const ctx = context ?? evolutionContext(metallicity)
  const life = lifetimes(massInitial, ctx)
  const end = gyr(life.total * (1 + REMNANT_SPAN))

  const { ages, starts } = sampleGrid(life, end)

  const states = ages.map((age) => evolveWith(massInitial, age, ctx))

  // Rate of change of the observable state, in log space so it is scale-free across six decades.
  const rate = new Array<number>(ages.length).fill(0)
  for (let i = 1; i < ages.length; i++) {
    const dt = (ages[i] as number) - (ages[i - 1] as number)
    if (dt <= 0) continue
    const a = states[i - 1] as StarState
    const b = states[i] as StarState
    const dLnL = Math.log(b.luminosity / a.luminosity)
    const dLnR = Math.log(b.radius / a.radius)
    const dLnT = Math.log(b.temperature / a.temperature)
    rate[i] = Math.sqrt(dLnL * dLnL + dLnR * dLnR + dLnT * dLnT) / dt
  }

  const softened = rate.map((v) => Math.pow(v, WARP_SOFTENING))

  /*
   * Width is allocated per phase, then distributed inside each phase by local rate of change. Doing
   * it in two stages is what keeps the result predictable: the between-phase split is fixed, so no
   * phase can vanish, while the within-phase distribution still magnifies the rapid stretches.
   */
  const positions = new Array<number>(ages.length).fill(0)
  let base = 0

  for (let phase = 0; phase < PHASE_SHARES.length; phase++) {
    const from = starts[phase] as number
    const to = starts[phase + 1] as number
    const share = PHASE_SHARES[phase] as number

    const local = softened.slice(from + 1, to)
    const floor = quantile([...local].sort((x, y) => x - y), WARP_FLOOR_QUANTILE) || 1
    const ceiling = floor * WARP_CEILING

    let running = 0
    const weights = new Array<number>(to - from).fill(0)
    for (let i = from + 1; i < to; i++) {
      const dt = (ages[i] as number) - (ages[i - 1] as number)
      const weight = Math.min(ceiling, Math.max(floor, softened[i] as number)) * dt
      running += weight
      weights[i - from] = running
    }

    for (let i = from; i < to; i++) {
      const fraction = running > 0 ? (weights[i - from] as number) / running : 0
      positions[i] = base + share * fraction
    }
    base += share
  }

  positions[positions.length - 1] = 1

  const phases: PhaseSpan[] = [
    { stage: 'main sequence', start: gyr(0), end: life.mainSequence },
    {
      stage: 'subgiant',
      start: life.mainSequence,
      end: gyr(life.mainSequence + life.subgiant),
    },
    { stage: 'giant', start: gyr(life.mainSequence + life.subgiant), end: life.total },
    { stage: stageAt(massInitial, end, life), start: life.total, end },
  ]

  return {
    massInitial,
    metallicity,
    end,
    phases,
    bookmarks: findBookmarks(massInitial, life, ages, states, end),
    warp: (age) => interpolate(ages, positions, Math.min(Math.max(age, 0), end)),
    unwarp: (position) =>
      gyr(interpolate(positions, ages, Math.min(Math.max(position, 0), 1))),
    sample: (age) => evolveWith(massInitial, age, ctx),
  }
}

/** Linear interpolation over a monotonically increasing key array. */
function interpolate(keys: readonly number[], values: readonly number[], key: number): number {
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((keys[mid] as number) <= key) lo = mid
    else hi = mid
  }

  const k0 = keys[lo] as number
  const k1 = keys[hi] as number
  const v0 = values[lo] as number
  const v1 = values[hi] as number
  if (k1 === k0) return v0
  return v0 + ((v1 - v0) * (key - k0)) / (k1 - k0)
}

const REMNANT_LABEL: Partial<Record<Stage, string>> = {
  'white dwarf': 'White dwarf',
  'neutron star': 'Neutron star',
  'black hole': 'Black hole',
}

/**
 * Bookmarks are derived, not authored.
 *
 * Phase changes fall straight out of the model's own classification, so they cost nothing. The
 * extrema and the Earth-orbit crossing are scanned from the same samples the warp already needed.
 */
function findBookmarks(
  massInitial: SolarMasses,
  life: ReturnType<typeof lifetimes>,
  ages: readonly Gyr[],
  states: readonly StarState[],
  end: Gyr,
): Bookmark[] {
  const bookmarks: Bookmark[] = [
    { age: gyr(0), label: 'ZAMS', stage: 'main sequence' },
    { age: life.mainSequence, label: 'End of main sequence', stage: 'subgiant' },
    {
      age: gyr(life.mainSequence + life.subgiant),
      label: 'Giant branch',
      stage: 'giant',
    },
  ]

  const remnantStage = stageAt(massInitial, end, life)
  bookmarks.push({
    age: life.total,
    label: REMNANT_LABEL[remnantStage] ?? 'Remnant',
    stage: remnantStage,
  })

  let maxRadius = -Infinity
  let maxRadiusAge = gyr(0)
  let peakLuminosity = -Infinity
  let peakLuminosityAge = gyr(0)
  let engulfed: Gyr | null = null

  for (let i = 0; i < states.length; i++) {
    const state = states[i] as StarState
    if (isRemnant(state.stage)) continue

    const age = ages[i] as Gyr
    if (state.radius > maxRadius) {
      maxRadius = state.radius
      maxRadiusAge = age
    }
    if (state.luminosity > peakLuminosity) {
      peakLuminosity = state.luminosity
      peakLuminosityAge = age
    }
    if (engulfed === null && state.radius >= EARTH_ORBIT) engulfed = age
  }

  if (engulfed !== null) {
    bookmarks.push({ age: engulfed, label: "Reaches Earth's orbit", stage: 'giant' })
  }

  /*
   * Derived extrema are only worth a mark where they are distinct. The provisional giant branch
   * grows monotonically to its tip, so both maxima currently land exactly on the moment the remnant
   * forms and would just stack three labels on one tick. Once the Hurley giant-branch fits land the
   * RGB tip and the AGB peak become interior points and these will separate on their own.
   */
  const distinct = (age: Gyr) =>
    bookmarks.every((existing) => Math.abs(existing.age - age) > end * 0.01)

  if (distinct(maxRadiusAge)) {
    bookmarks.push({ age: maxRadiusAge, label: 'Maximum radius', stage: 'giant' })
  }
  if (distinct(peakLuminosityAge)) {
    bookmarks.push({ age: peakLuminosityAge, label: 'Peak luminosity', stage: 'giant' })
  }

  return bookmarks
    .filter((b) => b.age >= 0 && b.age <= end)
    .sort((a, b) => a.age - b.age)
}
