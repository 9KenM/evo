import { describe, expect, it } from 'vitest'
import { mainSequenceLifetime, timeToBGB, timescaleCoefficients } from './timescales.js'
import { SOLAR, fromFeH } from './metallicity.js'
import { solarMasses } from './units.js'

const solar = timescaleCoefficients(SOLAR)
const tMS = (m: number, coeff = solar) => mainSequenceLifetime(solarMasses(m), coeff)

describe('Hurley main-sequence lifetimes', () => {
  it('gives the Sun roughly 10 Gyr', () => {
    expect(tMS(1)).toBeGreaterThan(9)
    expect(tMS(1)).toBeLessThan(12)
  })

  it('gives a 30 M☉ star a few Myr (previously 0.37 Myr)', () => {
    const myr = tMS(30) * 1000
    expect(myr).toBeGreaterThan(4)
    expect(myr).toBeLessThan(8)
  })

  it('gives a 5 M☉ star roughly 100 Myr', () => {
    const myr = tMS(5) * 1000
    expect(myr).toBeGreaterThan(70)
    expect(myr).toBeLessThan(130)
  })

  it('leaves low-mass stars on the main sequence longer than the age of the universe', () => {
    expect(tMS(0.5)).toBeGreaterThan(50)
  })

  it('decreases monotonically with mass', () => {
    let previous = Infinity
    for (let m = 0.1; m <= 100; m *= 1.08) {
      const t = tMS(m)
      expect(t).toBeLessThan(previous)
      previous = t
    }
  })

  it('is shorter than the time to the base of the giant branch', () => {
    for (let m = 0.5; m <= 50; m *= 1.3) {
      expect(tMS(m)).toBeLessThanOrEqual(timeToBGB(solarMasses(m), solar))
    }
  })

  it('makes metal-poor stars evolve faster at fixed mass', () => {
    const poor = tMS(1, timescaleCoefficients(fromFeH(-1.5)))
    const rich = tMS(1, timescaleCoefficients(fromFeH(0.3)))
    expect(poor).toBeLessThan(rich)
  })

  it('stays finite and positive across the full domain', () => {
    for (const z of [0.0001, 0.001, 0.02, 0.03]) {
      const coeff = timescaleCoefficients(z as never)
      for (let m = 0.1; m <= 100; m *= 1.2) {
        const t = tMS(m, coeff)
        expect(Number.isFinite(t)).toBe(true)
        expect(t).toBeGreaterThan(0)
      }
    }
  })
})
