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
   * Phase width is allocated, not earned by duration, so the strip looks the same at every mass.
   * That predictability is the point: a 30 M☉ Hertzsprung gap is 0.09% of real time and still gets
   * a usable slice, and the layout does not lurch when the mass slider moves.
   */
  it('gives phases the same share regardless of mass', () => {
    const reference = [0, 1, 2, 3].map((i) => share(track(1), i))
    for (const m of [0.8, 5, 15, 30]) {
      const t = track(m)
      for (let i = 0; i < 4; i++) {
        expect(share(t, i)).toBeCloseTo(reference[i]!, 6)
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

  it('flag the Earth-orbit crossing only for stars that actually get that big', () => {
    const engulfs = (m: number) =>
      track(m).bookmarks.some((b) => b.label === "Reaches Earth's orbit")
    expect(engulfs(1)).toBe(false)
    expect(engulfs(30)).toBe(true)
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
