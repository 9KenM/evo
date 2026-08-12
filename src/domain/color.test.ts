import { describe, expect, it } from 'vitest'
import { blackbodyChromaticity, blackbodyLinearRGB, blackbodyRGB } from './color.js'
import { kelvin } from './units.js'

/*
 * Published CIE 1931 xy coordinates of the Planckian locus. If the Planck integration and the
 * analytic colour matching approximation are both right, the computed chromaticity lands on these.
 * This is the check that makes the colour path trustworthy rather than merely plausible.
 */
const PLANCKIAN_LOCUS: ReadonlyArray<[number, number, number]> = [
  [2856, 0.4476, 0.4074], // CIE Illuminant A
  [4000, 0.3805, 0.3768],
  [5000, 0.3451, 0.3516],
  [6500, 0.3135, 0.3237],
  [10000, 0.2807, 0.2884],
  [20000, 0.2565, 0.2577],
]

describe('blackbody chromaticity', () => {
  it.each(PLANCKIAN_LOCUS)('lands on the Planckian locus at %i K', (t, x, y) => {
    const c = blackbodyChromaticity(kelvin(t))
    expect(c.x).toBeCloseTo(x, 1)
    expect(c.y).toBeCloseTo(y, 1)
  })

  it('moves monotonically toward blue as temperature rises', () => {
    let previous = Infinity
    for (const t of [2000, 3000, 5000, 8000, 15000, 30000]) {
      const { x } = blackbodyChromaticity(kelvin(t))
      expect(x).toBeLessThan(previous)
      previous = x
    }
  })
})

describe('blackbody rendering colour', () => {
  it('renders the Sun as near-white with a warm bias', () => {
    const { r, g, b } = blackbodyRGB(kelvin(5772))
    expect(r).toBe(255)
    expect(b).toBeGreaterThan(200)
    expect(b).toBeLessThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('renders cool giants red and hot stars blue', () => {
    const cool = blackbodyRGB(kelvin(3000))
    const hot = blackbodyRGB(kelvin(30000))
    expect(cool.r).toBeGreaterThan(cool.b)
    expect(hot.b).toBeGreaterThan(hot.r)
  })

  it('never emits a negative or out-of-range linear channel', () => {
    for (let t = 500; t <= 1_000_000; t *= 1.3) {
      const { r, g, b } = blackbodyLinearRGB(kelvin(t))
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
        expect(Number.isFinite(channel)).toBe(true)
      }
    }
  })

  it('peaks at 1 in linear light so brightness is carried by luminosity, not colour', () => {
    for (const t of [2000, 5772, 40000]) {
      const { r, g, b } = blackbodyLinearRGB(kelvin(t))
      expect(Math.max(r, g, b)).toBeCloseTo(1, 6)
    }
  })
})
