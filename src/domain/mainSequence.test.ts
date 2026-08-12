import { describe, expect, it } from 'vitest'
import { luminosityTAMS, mainSequenceCoefficients, radiusTAMS } from './mainSequence.js'
import { zamsCoefficients, zamsProperties } from './zams.js'
import { SOLAR } from './metallicity.js'
import { solarMasses } from './units.js'

const ms = mainSequenceCoefficients(SOLAR)
const zc = zamsCoefficients(SOLAR)

const tams = (m: number) => ({
  luminosity: luminosityTAMS(solarMasses(m), ms),
  radius: radiusTAMS(solarMasses(m), ms, zc),
})

describe('terminal-age main sequence', () => {
  it('has the Sun brighten to roughly twice its zero-age luminosity', () => {
    const zams = zamsProperties(solarMasses(1), zc)
    const end = tams(1)
    const factor = end.luminosity / zams.luminosity
    // Previously the engine brightened the Sun by 5.6% across its entire main sequence.
    expect(factor).toBeGreaterThan(1.8)
    expect(factor).toBeLessThan(3.2)
  })

  it('has the Sun swell by roughly half over the main sequence', () => {
    const zams = zamsProperties(solarMasses(1), zc)
    const end = tams(1)
    expect(end.radius / zams.radius).toBeGreaterThan(1.2)
    expect(end.radius / zams.radius).toBeLessThan(2.0)
  })

  it('always exceeds the zero-age values', () => {
    for (let m = 0.15; m <= 100; m *= 1.1) {
      const zams = zamsProperties(solarMasses(m), zc)
      const end = tams(m)
      expect(end.luminosity).toBeGreaterThan(zams.luminosity)
      expect(end.radius).toBeGreaterThan(zams.radius)
    }
  })

  it('stays finite and monotonic in mass', () => {
    let lastL = 0
    for (let m = 0.15; m <= 100; m *= 1.05) {
      const { luminosity, radius } = tams(m)
      expect(Number.isFinite(luminosity)).toBe(true)
      expect(Number.isFinite(radius)).toBe(true)
      expect(radius).toBeGreaterThan(0)
      expect(luminosity).toBeGreaterThan(lastL)
      lastL = luminosity
    }
  })
})
