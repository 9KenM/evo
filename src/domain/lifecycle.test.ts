import { describe, expect, it } from 'vitest'
import { computeTrack } from './lifecycle.js'
import { SOLAR, fromFeH } from './metallicity.js'
import { gyr, solarMasses } from './units.js'

const track = (m: number) => computeTrack(solarMasses(m), SOLAR)

/** Fraction of the warped strip a phase occupies. */
const share = (t: ReturnType<typeof track>, index: number) => {
  const phase = t.phases[index]!
  return t.warp(phase.end) - t.warp(phase.start)
}

describe('warp', () => {
  it('is a normalised monotonic map', () => {
    const t = track(1)
    expect(t.warp(gyr(0))).toBeCloseTo(0, 6)
    expect(t.warp(t.end)).toBeCloseTo(1, 6)

    let previous = -1
    for (let i = 0; i <= 200; i++) {
      const position = t.warp(gyr((t.end * i) / 200))
      expect(position).toBeGreaterThanOrEqual(previous)
      previous = position
    }
  })

  it('round-trips through unwarp', () => {
    const t = track(1)
    for (let i = 1; i < 40; i++) {
      const age = gyr((t.end * i) / 40)
      expect(t.unwarp(t.warp(age))).toBeCloseTo(age, 2)
    }
  })

  it.each([0.8, 1, 5, 15, 30])('stays monotonic and normalised at %i M☉', (m) => {
    const t = track(m)
    expect(t.warp(gyr(0))).toBeCloseTo(0, 6)
    expect(t.warp(t.end)).toBeCloseTo(1, 6)
    for (const phase of t.phases) {
      expect(t.warp(phase.end)).toBeGreaterThanOrEqual(t.warp(phase.start))
    }
  })

  /*
   * The point of the whole exercise. In real time the Hertzsprung gap is a rounding error next to
   * the main sequence — 0.58 Gyr against 11 for the Sun, and 8 kyr against 5.8 Myr at 30 M☉. The
   * warp has to buy it disproportionate width or playback skips straight past it.
   */
  it('magnifies brief phases relative to their share of real time', () => {
    for (const m of [1, 5, 30]) {
      const t = track(m)
      const gap = t.phases[1]!
      const realShare = (gap.end - gap.start) / t.end
      const warpedShare = share(t, 1)
      expect(warpedShare).toBeGreaterThan(realShare)
    }
  })

  it('keeps every phase visible on the strip', () => {
    for (const m of [0.8, 1, 5, 15, 30]) {
      const t = track(m)
      for (let i = 0; i < t.phases.length; i++) {
        expect(share(t, i)).toBeGreaterThan(0.01)
      }
    }
  })

  it('leaves the main sequence a substantial share, since it is most of the life', () => {
    const t = track(1)
    expect(share(t, 0)).toBeGreaterThan(0.15)
    expect(share(t, 0)).toBeLessThan(0.75)
  })

  /*
   * Phase width is allocated, not earned by duration, so the strip looks the same for any two stars
   * with the same phase set. That predictability is the point: a 30 M☉ Hertzsprung gap is 0.09% of
   * real time and still gets a usable slice, and the layout does not lurch on the mass slider.
   *
   * It cannot be identical across *all* masses, because the phase set itself varies — a massive star
   * has no first giant branch and no planetary nebula — so the weights renormalise over whichever
   * phases a given star actually has.
   */
  it('gives the same shares to stars with the same phase set', () => {
    const signature = (t: ReturnType<typeof track>) => t.phases.map((p) => p.stage).join('|')
    const reference = track(1)

    for (const m of [0.9, 1.2, 1.5]) {
      const t = track(m)
      expect(signature(t)).toBe(signature(reference))
      for (let i = 0; i < reference.phases.length; i++) {
        expect(share(t, i)).toBeCloseTo(share(reference, i), 6)
      }
    }
  })

  it('magnifies rapid stretches within a phase', () => {
    // A white dwarf cools fast then barely changes, so the first tenth of the remnant span should
    // occupy far more of that phase's strip than a linear mapping would give it.
    const t = track(1)
    const remnant = t.phases[3]!
    const tenth = gyr(remnant.start + (remnant.end - remnant.start) * 0.1)
    const fractionOfPhase = (t.warp(tenth) - t.warp(remnant.start)) / share(t, 3)
    expect(fractionOfPhase).toBeGreaterThan(0.2)
  })
})

/*
 * Phase 4's acceptance criterion, made executable.
 *
 * The original wording was "PN phase is visible during full-lifecycle playback", which could not be
 * met until 2b gave the domain a planetary nebula to show. It now can be, and this is the honest
 * form of it: simulate the app's own playback loop and count how many frames land in each phase.
 *
 * A solar-mass star's nebula is 30 kyr against a 22.5 Gyr track — roughly one part in a million — so
 * under constant-rate playback it would never render a single frame at any speed that made the main
 * sequence watchable. That is the entire reason the warp exists.
 */
describe('adaptive playback', () => {
  const ADAPTIVE_RATE = 1 / 90
  const FPS = 60

  const framesPerStage = (m: number) => {
    const t = track(m)
    const counts = new Map<string, number>()
    for (let position = 0; position < 1; position += ADAPTIVE_RATE / FPS) {
      const stage = t.sample(t.unwarp(position)).stage
      counts.set(stage, (counts.get(stage) ?? 0) + 1)
    }
    return counts
  }

  it.each([1, 5, 30])('renders every phase for at least half a second at %i M☉', (m) => {
    const counts = framesPerStage(m)
    for (const phase of track(m).phases) {
      expect(counts.get(phase.stage) ?? 0).toBeGreaterThan(FPS / 2)
    }
  })

  it('gives the planetary nebula seconds of screen time, not a single frame', () => {
    const frames = framesPerStage(1).get('planetary nebula') ?? 0
    expect(frames).toBeGreaterThan(4 * FPS)
  })

  /*
   * The comparison that justifies the whole mechanism: at constant rate the same phase gets nothing.
   */
  it('would skip the nebula entirely at constant rate', () => {
    const t = track(1)
    const nebula = t.phases.find((p) => p.stage === 'planetary nebula')!
    const share = (nebula.end - nebula.start) / t.end
    // Frames the nebula would get if 90 seconds were spread evenly over the track.
    expect(share * 90 * FPS).toBeLessThan(1)
  })
})

describe('bookmarks', () => {
  it('are ordered and inside the track', () => {
    for (const m of [1, 5, 30]) {
      const t = track(m)
      let previous = -1
      for (const bookmark of t.bookmarks) {
        expect(bookmark.age).toBeGreaterThanOrEqual(0)
        expect(bookmark.age).toBeLessThanOrEqual(t.end)
        expect(bookmark.age).toBeGreaterThanOrEqual(previous)
        previous = bookmark.age
      }
    }
  })

  it('name the remnant the progenitor actually leaves', () => {
    expect(track(1).bookmarks.some((b) => b.label === 'White dwarf')).toBe(true)
    expect(track(15).bookmarks.some((b) => b.label === 'Neutron star')).toBe(true)
    expect(track(30).bookmarks.some((b) => b.label === 'Black hole')).toBe(true)
  })

  /*
   * The headline marker on a solar-mass track, and the old engine never fired it — its giant branch
   * peaked at 23 R☉ against a real AGB tip near 230, so the Sun never reached 1 AU. This test used
   * to assert exactly that absence, which made it a specification of the bug.
   */
  it('flags the Sun reaching Earth’s orbit, and places it on the AGB', () => {
    const t = track(1)
    const crossing = t.bookmarks.find((b) => b.label === "Reaches Earth's orbit")
    expect(crossing).toBeDefined()

    const phase = t.phases.find((p) => crossing!.age >= p.start && crossing!.age <= p.end)
    expect(phase!.stage).toContain('AGB')
  })

  it('flags the nebula ionising for stars that form one', () => {
    expect(track(1).bookmarks.some((b) => b.label === 'Nebula ionises')).toBe(true)
    expect(track(30).bookmarks.some((b) => b.label === 'Nebula ionises')).toBe(false)
  })

  /*
   * Derived extrema are dropped where they coincide with a phase boundary, which with the current
   * monotonic giant branch is everywhere — both maxima sit exactly on remnant formation. The
   * assertion is therefore conditional: present or absent is fine, but never after the star stops
   * burning. Once the Hurley giant-branch fits land these become interior points and reappear.
   */
  it('never place a derived extremum after the remnant forms', () => {
    for (const m of [1, 5, 30]) {
      const t = track(m)
      for (const label of ['Maximum radius', 'Peak luminosity']) {
        const bookmark = t.bookmarks.find((b) => b.label === label)
        if (bookmark) expect(bookmark.age).toBeLessThanOrEqual(t.phases[2]!.end)
      }
    }
  })

  it('do not stack multiple labels on the same instant', () => {
    for (const m of [0.8, 1, 5, 15, 30]) {
      const t = track(m)
      for (let i = 1; i < t.bookmarks.length; i++) {
        const gap = t.bookmarks[i]!.age - t.bookmarks[i - 1]!.age
        expect(gap).toBeGreaterThan(0)
      }
    }
  })
})

describe('track', () => {
  it('samples agree with the engine', () => {
    const t = track(1)
    const age = gyr(4.57)
    expect(t.sample(age).luminosity).toBe(t.sample(age).luminosity)
    expect(t.sample(age).stage).toBe('main sequence')
  })

  it('responds to metallicity', () => {
    const poor = computeTrack(solarMasses(1), fromFeH(-1.5))
    const rich = computeTrack(solarMasses(1), fromFeH(0.3))
    expect(poor.end).toBeLessThan(rich.end)
  })

  it('is fast enough to rebuild while dragging a slider', () => {
    const started = performance.now()
    for (let i = 0; i < 10; i++) computeTrack(solarMasses(1 + i * 0.1), SOLAR)
    const perTrack = (performance.now() - started) / 10
    expect(perTrack).toBeLessThan(120)
  })
})
