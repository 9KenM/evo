import { SOLAR, type Metallicity } from './metallicity.js'
import { isRemnant, type Remnant, type Stage } from './stage.js'
import {
  cachedTrack,
  evolutionContext,
  evolveOn,
  phasesOf,
  type EvolutionContext,
  type Phase,
  type StarState,
} from './star.js'
import { gyr, type Gyr, type SolarMasses } from './units.js'

/** Earth's orbital radius, in solar radii. */
const EARTH_ORBIT = 215.03

/** Temperature at which a post-AGB core ionises the shell it ejected and the nebula lights up. */
const IONISATION_TEMPERATURE = 30000

/**
 * How long each kind of remnant is followed for, in Gyr.
 *
 * Absolute, and set by what actually changes. A white dwarf's whole story is its cooling, which
 * takes tens of Gyr; a neutron star's surface cools appreciably over a Gyr; a black hole never
 * changes at all and is present only so it can be reached. Tying these to the progenitor's lifetime,
 * as the previous version did, gave a 30 M☉ black hole 2.3 Myr and a 0.8 M☉ white dwarf 11 Gyr for
 * no physical reason.
 */
const REMNANT_SPAN: Record<Remnant, number> = {
  'white dwarf': 10,
  'neutron star': 1,
  'black hole': 0.05,
}

/**
 * Share of the strip each phase receives, before normalising over the phases a star actually has.
 *
 * Fixed rather than proportional to duration, and that is the whole design. Real durations span
 * eight orders of magnitude — a solar-mass star spends 11 Gyr on the main sequence and crosses the
 * post-AGB in 25 kyr — so any duration-proportional axis leaves the interesting phases as sub-pixel
 * slivers. Allocating fixed shares guarantees every phase is visible and clickable at every mass.
 *
 * Weights rather than fractions because the phase set varies: a 30 M☉ star has no thermally pulsing
 * AGB and no planetary nebula, and a black hole gets less because nothing about it changes.
 *
 * The cost is that the strip no longer reads as relative duration. The time tick marks carry that
 * instead: they bunch up wherever time is compressed, the way ticks bunch on a log axis.
 */
const PHASE_WEIGHT: Record<Stage, number> = {
  'main sequence': 30,
  'hertzsprung gap': 8,
  'giant branch': 14,
  'core helium burning': 14,
  'early AGB': 8,
  'thermally pulsing AGB': 8,
  'planetary nebula': 10,
  'white dwarf': 12,
  'neutron star': 12,
  'black hole': 5,
}

/** Samples per phase. Allocated per phase so brief ones are never stepped over. */
const SAMPLES_PER_PHASE = 120

/** Samples across the remnant tail, geometrically spaced because cooling is fastest at the start. */
const REMNANT_SAMPLES = 300

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

export type PhaseSpan = Phase

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
function sampleGrid(phases: readonly PhaseSpan[], end: Gyr): Grid {
  const ages: Gyr[] = []
  const starts: number[] = []

  const burning = phases.filter((phase) => !isRemnant(phase.stage))

  for (const phase of burning) {
    starts.push(ages.length)
    for (let i = 0; i < SAMPLES_PER_PHASE; i++) {
      ages.push(gyr(phase.start + ((phase.end - phase.start) * i) / SAMPLES_PER_PHASE))
    }
  }

  starts.push(ages.length)
  const remnantStart = (burning[burning.length - 1] as PhaseSpan).end
  const tail = end - remnantStart
  for (let i = 0; i <= REMNANT_SAMPLES; i++) {
    const u = i / REMNANT_SAMPLES
    // Geometric: resolves the steep early cooling without wasting samples on the long cold tail.
    ages.push(gyr(remnantStart + tail * (Math.expm1(6 * u) / Math.expm1(6))))
  }

  starts.push(ages.length)
  return { ages, starts }
}

/**
 * Everything the timeline and the clock need for one (mass, metallicity) pair.
 *
 * The warp is the centre of it. A constant-rate playback cannot show a full lifecycle — a solar-mass
 * star spends 11 Gyr on the main sequence and crosses the post-AGB in 25 kyr, a ratio of half a
 * million to one — so at any speed that makes the main sequence watchable the transitions are gone
 * in a frame. Warping time by the rate of observable change fixes both problems at once: the
 * timeline axis magnifies exactly where things happen, and playback that advances the warped
 * coordinate at a constant rate slows down through transitions by construction.
 */
export function computeTrack(
  massInitial: SolarMasses,
  metallicity: Metallicity = SOLAR,
  context?: EvolutionContext,
): LifecycleTrack {
  const ctx = context ?? evolutionContext(metallicity)
  const track = cachedTrack(massInitial, ctx)

  const burning = phasesOf(track)
  const remnantStart = gyr(track.remnantAt / 1000)
  const end = gyr(remnantStart + REMNANT_SPAN[track.remnantStage])

  const phases: PhaseSpan[] = [
    ...burning,
    { stage: track.remnantStage, start: remnantStart, end },
  ]

  const { ages, starts } = sampleGrid(phases, end)
  const states = ages.map((age) => evolveOn(massInitial, age, ctx, track))

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

  const weights = phases.map((phase) => PHASE_WEIGHT[phase.stage] ?? 8)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)

  /*
   * Width is allocated per phase, then distributed inside each phase by local rate of change. Doing
   * it in two stages is what keeps the result predictable: the between-phase split is fixed, so no
   * phase can vanish, while the within-phase distribution still magnifies the rapid stretches.
   */
  const positions = new Array<number>(ages.length).fill(0)
  let base = 0

  for (let phase = 0; phase < phases.length; phase++) {
    const from = starts[phase] as number
    const to = starts[phase + 1] as number
    const share = (weights[phase] as number) / totalWeight

    const local = softened.slice(from + 1, to)
    const floor = quantile([...local].sort((x, y) => x - y), WARP_FLOOR_QUANTILE) || 1
    const ceiling = floor * WARP_CEILING

    let running = 0
    const cumulative = new Array<number>(to - from).fill(0)
    for (let i = from + 1; i < to; i++) {
      const dt = (ages[i] as number) - (ages[i - 1] as number)
      const weight = Math.min(ceiling, Math.max(floor, softened[i] as number)) * dt
      running += weight
      cumulative[i - from] = running
    }

    for (let i = from; i < to; i++) {
      const fraction = running > 0 ? (cumulative[i - from] as number) / running : 0
      positions[i] = base + share * fraction
    }
    base += share
  }

  positions[positions.length - 1] = 1

  const warp = (age: Gyr) => interpolate(ages, positions, Math.min(Math.max(age, 0), end))

  return {
    massInitial,
    metallicity,
    end,
    phases,
    bookmarks: findBookmarks(phases, ages, states, end, warp, (age) =>
      evolveOn(massInitial, age, ctx, track),
    ),
    warp,
    unwarp: (position) => gyr(interpolate(positions, ages, Math.min(Math.max(position, 0), 1))),
    sample: (age) => evolveOn(massInitial, age, ctx, track),
  }
}

/** Bisects a bracketed interval for the age at which `crossed` first becomes true. */
function refine(
  before: Gyr,
  after: Gyr,
  crossed: (state: StarState) => boolean,
  sample: (age: Gyr) => StarState,
): Gyr {
  let lo = before
  let hi = after
  for (let i = 0; i < 48; i++) {
    const mid = gyr((lo + hi) / 2)
    if (crossed(sample(mid))) hi = mid
    else lo = mid
  }
  return hi
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

/*
 * Only transitions that read as *events* get a bookmark. "Giant branch" and "Asymptotic giant
 * branch" were dropped because the phase band directly beneath already says exactly that, and a
 * label row that restates the row below it buries the marks that carry real information.
 */
const PHASE_ENTRY_LABEL: Partial<Record<Stage, string>> = {
  'hertzsprung gap': 'Leaves main sequence',
  'core helium burning': 'Helium ignition',
  'thermally pulsing AGB': 'Thermal pulses',
  'planetary nebula': 'Envelope ejected',
  'white dwarf': 'White dwarf',
  'neutron star': 'Neutron star',
  'black hole': 'Black hole',
}

/**
 * Bookmarks are derived, not authored.
 *
 * Phase changes fall straight out of the model's own classification, so they cost nothing. The
 * extrema, the Earth-orbit crossing and the moment the nebula ionises are scanned from the same
 * samples the warp already needed.
 */
function findBookmarks(
  phases: readonly PhaseSpan[],
  ages: readonly Gyr[],
  states: readonly StarState[],
  end: Gyr,
  warp: (age: Gyr) => number,
  sample: (age: Gyr) => StarState,
): Bookmark[] {
  const bookmarks: Bookmark[] = [{ age: gyr(0), label: 'ZAMS', stage: 'main sequence' }]

  for (const phase of phases) {
    const label = PHASE_ENTRY_LABEL[phase.stage]
    if (label) bookmarks.push({ age: phase.start, label, stage: phase.stage })
  }

  let maxRadius = -Infinity
  let maxRadiusAge = gyr(0)
  let peakLuminosity = -Infinity
  let peakLuminosityAge = gyr(0)
  let engulfed: Gyr | null = null
  let engulfedStage: Stage = 'thermally pulsing AGB'
  let maxRadiusStage: Stage = 'thermally pulsing AGB'
  let ionised: Gyr | null = null

  for (let i = 0; i < states.length; i++) {
    const state = states[i] as StarState
    const age = ages[i] as Gyr
    if (isRemnant(state.stage)) continue

    if (state.stage === 'planetary nebula' && ionised === null) {
      if (state.temperature >= IONISATION_TEMPERATURE) ionised = age
    }

    /*
     * The nebula's samples are included rather than skipped. A star's largest radius is reached at
     * the very end of the thermally pulsing AGB, and that instant is the *nebula's* first sample —
     * the phases share the boundary. Skipping them lost the maximum entirely, and with it the
     * Earth-orbit crossing on a solar-mass track. The nebula only contracts from there, so it can
     * never contribute a spurious maximum.
     */
    if (state.radius > maxRadius) {
      maxRadius = state.radius
      maxRadiusAge = age
      maxRadiusStage = state.stage
    }
    if (state.luminosity > peakLuminosity) {
      peakLuminosity = state.luminosity
      peakLuminosityAge = age
    }
    if (engulfed === null && state.radius >= EARTH_ORBIT && i > 0) {
      /*
       * Bisected rather than taken from the grid. The radius climbs by an order of magnitude across
       * the last few samples of the early AGB, so a grid-pinned crossing lands on whichever sample
       * happens to straddle it — which is usually a phase boundary, where it collides with that
       * phase's own label and gets dropped as a duplicate.
       */
      engulfed = refine(ages[i - 1] as Gyr, age, (s) => s.radius >= EARTH_ORBIT, sample)
      engulfedStage = sample(engulfed).stage
    }
  }

  if (engulfed !== null) {
    bookmarks.push({ age: engulfed, label: "Reaches Earth's orbit", stage: engulfedStage })
  }
  if (ionised !== null) {
    bookmarks.push({ age: ionised, label: 'Nebula ionises', stage: 'planetary nebula' })
  }

  /*
   * Extrema are only worth a mark where they are visibly distinct, and "visibly" means on the strip
   * — so the comparison is in warped space, not in age. Comparing ages would use a window of 90 kyr
   * at 30 M☉, eleven times wider than that star's entire Hertzsprung gap, and would silently swallow
   * whole phases.
   */
  const distinct = (age: Gyr) =>
    bookmarks.every((existing) => Math.abs(warp(existing.age) - warp(age)) > 0.02)

  if (distinct(maxRadiusAge)) {
    bookmarks.push({ age: maxRadiusAge, label: 'Maximum radius', stage: maxRadiusStage })
  }
  if (distinct(peakLuminosityAge)) {
    bookmarks.push({ age: peakLuminosityAge, label: 'Peak luminosity', stage: maxRadiusStage })
  }

  /*
   * Two derived marks can land on exactly the same instant — maximum radius and the Earth-orbit
   * crossing coincide for a star whose tip only just clears 1 AU — and two labels on one tick is
   * unreadable. First wins, which favours the phase entries since they are inserted first.
   */
  const ordered = bookmarks
    .filter((b) => b.age >= 0 && b.age <= end)
    .sort((a, b) => a.age - b.age)

  return ordered.filter((mark, i) => i === 0 || mark.age > (ordered[i - 1] as Bookmark).age)
}
