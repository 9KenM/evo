import { describe, expect, it } from 'vitest'
import { evolve, neutronStarMass, whiteDwarfMass, zams } from './star.js'
import { classify } from './classify.js'
import { gyr, kelvin, solarLuminosities, solarMasses } from './units.js'

const sun = solarMasses(1)

/*
 * Each block below pins one of the six defects confirmed in the original engine by running it.
 * The "previously" numbers are what that engine actually returned.
 */

describe('spectral classification', () => {
  it('classifies the Sun as G2V (previously G7V — subtype index was inverted)', () => {
    const star = evolve(sun, gyr(4.57))
    expect(star.spectral.type).toBe('G2V')
  })

  it('assigns lower subtypes to hotter stars within a class', () => {
    const hot = classify('main sequence', kelvin(5950), solarLuminosities(1))
    const cool = classify('main sequence', kelvin(5250), solarLuminosities(1))
    expect(hot.letter).toBe('G')
    expect(cool.letter).toBe('G')
    expect(hot.subtype!).toBeLessThan(cool.subtype!)
  })
})

describe('remnant masses', () => {
  it('leaves a ~0.5 M☉ white dwarf from a solar progenitor (previously 0.057)', () => {
    expect(whiteDwarfMass(sun)).toBeGreaterThan(0.45)
    expect(whiteDwarfMass(sun)).toBeLessThan(0.65)
  })

  it('never produces a white dwarf above the Chandrasekhar limit', () => {
    for (let m = 0.5; m <= 8; m += 0.25) {
      expect(whiteDwarfMass(solarMasses(m))).toBeLessThanOrEqual(1.4)
    }
  })

  it('leaves a neutron star in the observed 1.2–2.2 M☉ range (previously 0.74)', () => {
    for (let m = 8; m <= 25; m += 0.5) {
      const mass = neutronStarMass(solarMasses(m))
      expect(mass).toBeGreaterThan(1.2)
      expect(mass).toBeLessThan(2.2)
    }
  })
})

describe('mass loss', () => {
  it('sheds mass on the giant branch (previously stayed at exactly 1.000)', () => {
    const star = evolve(sun, gyr(11.9))
    expect(star.stage).toBe('giant')
    expect(star.mass).toBeLessThan(0.99)
    expect(star.mass).toBeGreaterThan(0.5)
  })

  it('loses no mass on the main sequence', () => {
    expect(evolve(sun, gyr(5)).mass).toBeCloseTo(1, 10)
  })

  it('is monotonic in age', () => {
    let previous = Infinity
    for (let t = 10; t <= 12; t += 0.05) {
      const { mass } = evolve(sun, gyr(t))
      expect(mass).toBeLessThanOrEqual(previous + 1e-12)
      previous = mass
    }
  })
})

describe('white dwarf cooling', () => {
  it('cools below 6000 K within 10 Gyr (previously still 20,000 K at 1000 Gyr)', () => {
    const { lifetimes } = evolve(sun, gyr(0))
    const star = evolve(sun, gyr(lifetimes.total + 10))
    expect(star.stage).toBe('white dwarf')
    expect(star.temperature).toBeLessThan(6000)
  })

  it('is hot and luminous immediately after formation', () => {
    const { lifetimes } = evolve(sun, gyr(0))
    const young = evolve(sun, gyr(lifetimes.total + 0.001))
    expect(young.temperature).toBeGreaterThan(50000)
    expect(young.temperature).toBeLessThan(200000)
  })

  it('cools monotonically', () => {
    const { lifetimes } = evolve(sun, gyr(0))
    let previous = Infinity
    for (let t = 0.01; t <= 12; t *= 1.5) {
      const { temperature } = evolve(sun, gyr(lifetimes.total + t))
      expect(temperature).toBeLessThan(previous)
      previous = temperature
    }
  })
})

describe('high-mass luminosity', () => {
  it('does not steepen above 20 M☉ (previously 810,000 L☉ for a 30 M☉ star)', () => {
    const { luminosity } = zams(solarMasses(30))
    expect(luminosity).toBeGreaterThan(1e5)
    expect(luminosity).toBeLessThan(3e5)
  })

  it('keeps the mass–luminosity relation monotonic across the full mass range', () => {
    let previous = 0
    for (let m = 0.1; m <= 150; m *= 1.1) {
      const { luminosity } = zams(solarMasses(m))
      expect(luminosity).toBeGreaterThan(previous)
      previous = luminosity
    }
  })

  it('gives a 30 M☉ star a main-sequence lifetime over 1 Myr (previously 0.37 Myr)', () => {
    const { lifetimes } = evolve(solarMasses(30), gyr(0))
    expect(lifetimes.mainSequence).toBeGreaterThan(1e-3)
  })
})

describe('engine invariants', () => {
  it('is pure — repeated calls agree exactly', () => {
    const a = evolve(solarMasses(2.5), gyr(1.2))
    const b = evolve(solarMasses(2.5), gyr(1.2))
    expect(a).toEqual(b)
  })

  it('produces finite values across the whole parameter space', () => {
    for (let m = 0.1; m <= 150; m *= 1.6) {
      for (let t = 0; t <= 200; t = t * 2 + 0.01) {
        const star = evolve(solarMasses(m), gyr(t))
        for (const value of [star.mass, star.luminosity, star.radius, star.temperature]) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThan(0)
        }
      }
    }
  })

  it('picks the remnant type from the progenitor mass', () => {
    const beyond = (m: number) => {
      const mass = solarMasses(m)
      return evolve(mass, gyr(evolve(mass, gyr(0)).lifetimes.total * 1.5)).stage
    }
    expect(beyond(1)).toBe('white dwarf')
    expect(beyond(15)).toBe('neutron star')
    expect(beyond(30)).toBe('black hole')
  })
})
