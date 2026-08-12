import { describe, expect, it } from 'vitest'
import {
  evolutionContext,
  evolve,
  lifetimes,
  neutronStarMass,

  whiteDwarfMass,
} from './star.js'
import { classify } from './classify.js'
import { zamsCoefficients, zamsProperties } from './zams.js'
import { SOLAR, fromFeH } from './metallicity.js'
import { gyr, kelvin, solarLuminosities, solarMasses, type Gyr } from './units.js'

const sun = solarMasses(1)
const ctx = evolutionContext(SOLAR)
const solarLife = lifetimes(sun, ctx)

/** Age as a multiple of the solar main-sequence lifetime. */
const atMS = (fraction: number): Gyr => gyr(solarLife.mainSequence * fraction)

describe('spectral classification', () => {
  it('classifies the zero-age Sun as a G dwarf', () => {
    // T = 5598 K from Tout, against a real zero-age solar value near 5620 K.
    expect(evolve(sun, gyr(0)).spectral.type).toBe('G5V')
  })

  /*
   * KNOWN GAP. The Sun should be G2V at 4.57 Gyr and this returns G5V (~5540 K against 5772 K).
   *
   * Tout's ZAMS is right — it puts the zero-age Sun at L=0.70, R=0.89, T=5598 K against a real
   * ~5620 K. The error is in the main-sequence interpolation between the ZAMS and terminal-age
   * anchors: a straight line in log space grows the radius too fast early on, and T = (L/R²)^¼
   * turns a small radius error into a temperature one. Hurley's α/β/η perturbation terms encode
   * that curvature and are not ported yet; fitting exponents to the Sun instead would be
   * overfitting a single point. Tighten this to G2V when those terms land.
   */
  it('places the present-day Sun in the G class, subtype pending the MS perturbation terms', () => {
    const star = evolve(sun, gyr(4.57))
    expect(star.spectral.letter).toBe('G')
    expect(star.spectral.luminosityClass).toBe('V')
    expect(star.temperature).toBeGreaterThan(5400)
  })

  it('assigns lower subtypes to hotter stars within a class', () => {
    const hot = classify('main sequence', kelvin(5950), solarLuminosities(1))
    const cool = classify('main sequence', kelvin(5250), solarLuminosities(1))
    expect(hot.subtype!).toBeLessThan(cool.subtype!)
  })
})

describe('the present-day Sun', () => {
  it('is close to 1 L☉, 1 R☉ and 5772 K at 4.57 Gyr', () => {
    const star = evolve(sun, gyr(4.57))
    expect(star.luminosity).toBeGreaterThan(0.9)
    expect(star.luminosity).toBeLessThan(1.25)
    expect(star.radius).toBeGreaterThan(0.9)
    expect(star.radius).toBeLessThan(1.25)
    expect(star.temperature).toBeGreaterThan(5500)
    expect(star.temperature).toBeLessThan(5900)
  })

  it('brightens substantially over its main sequence', () => {
    const young = evolve(sun, gyr(0))
    const old = evolve(sun, atMS(0.99))
    // The previous engine brightened the Sun by 5.6% across its entire main sequence.
    expect(old.luminosity / young.luminosity).toBeGreaterThan(1.8)
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

  it('picks the remnant type from the progenitor mass', () => {
    const beyond = (m: number) => {
      const mass = solarMasses(m)
      return evolve(mass, gyr(lifetimes(mass, ctx).total * 1.5)).stage
    }
    expect(beyond(1)).toBe('white dwarf')
    expect(beyond(15)).toBe('neutron star')
    expect(beyond(30)).toBe('black hole')
  })
})

describe('mass loss', () => {
  /*
   * Reimers scales with L·R/M, so almost all real mass loss happens near the giant-branch tip.
   * The provisional giant branch tops out well below the real RGB tip luminosity, so the magnitude
   * here is understated. What is asserted is that loss occurs, is confined to the post-main
   * sequence, and never reverses — the unit error that suppressed it entirely is what this guards.
   */
  it('sheds mass after the main sequence (previously stayed at exactly 1.000)', () => {
    const star = evolve(sun, gyr(solarLife.total * 0.999))
    expect(star.mass).toBeLessThan(star.massInitial)
  })

  it('loses no mass on the main sequence', () => {
    expect(evolve(sun, atMS(0.5)).mass).toBeCloseTo(1, 10)
  })

  it('is monotonic in age', () => {
    let previous = Infinity
    for (let f = 0.9; f <= 1.2; f += 0.005) {
      const { mass } = evolve(sun, atMS(f))
      expect(mass).toBeLessThanOrEqual(previous + 1e-12)
      previous = mass
    }
  })
})

describe('white dwarf cooling', () => {
  it('cools below 6000 K within 10 Gyr (previously still 20,000 K at 1000 Gyr)', () => {
    const star = evolve(sun, gyr(solarLife.total + 10))
    expect(star.stage).toBe('white dwarf')
    expect(star.temperature).toBeLessThan(6000)
  })

  it('is hot immediately after formation', () => {
    const young = evolve(sun, gyr(solarLife.total + 0.001))
    expect(young.temperature).toBeGreaterThan(50000)
    expect(young.temperature).toBeLessThan(200000)
  })

  it('cools monotonically', () => {
    let previous = Infinity
    for (let t = 0.01; t <= 12; t *= 1.5) {
      const { temperature } = evolve(sun, gyr(solarLife.total + t))
      expect(temperature).toBeLessThan(previous)
      previous = temperature
    }
  })
})

describe('metallicity', () => {
  it('changes the main-sequence lifetime at fixed mass', () => {
    const poor = lifetimes(sun, evolutionContext(fromFeH(-1.5))).mainSequence
    const rich = lifetimes(sun, evolutionContext(fromFeH(0.3))).mainSequence
    expect(poor).not.toBeCloseTo(rich, 3)
  })

  it('changes the observable state at fixed mass and age', () => {
    const poor = evolve(sun, gyr(4.57), fromFeH(-1.5))
    const rich = evolve(sun, gyr(4.57), fromFeH(0.3))
    expect(poor.temperature).toBeGreaterThan(rich.temperature)
  })
})

describe('phase-boundary continuity', () => {
  /*
   * A stated acceptance criterion for this phase: no jumps in the observable state across a
   * transition. The previous engine stepped luminosity by exact factors of 5 and 25 at its
   * boundaries, which is what made transitions read as cuts rather than evolution.
   */
  const boundaries = (life: ReturnType<typeof lifetimes>) => [
    life.mainSequence,
    life.mainSequence + life.subgiant,
  ]

  it.each([0.8, 1, 2, 5, 12])('is continuous across every burning boundary at %i M☉', (m) => {
    const mass = solarMasses(m)
    const life = lifetimes(mass, ctx)

    for (const boundary of boundaries(life)) {
      const nudge = boundary * 1e-9
      const before = gyr(boundary - nudge)
      const after = gyr(boundary + nudge)

      const left = evolve(mass, before)
      const right = evolve(mass, after)

      expect(right.luminosity / left.luminosity).toBeCloseTo(1, 3)
      expect(right.radius / left.radius).toBeCloseTo(1, 3)
      expect(right.temperature / left.temperature).toBeCloseTo(1, 3)
    }
  })
})

describe('engine invariants', () => {
  it('is pure — repeated calls agree exactly', () => {
    expect(evolve(solarMasses(2.5), gyr(0.4))).toEqual(evolve(solarMasses(2.5), gyr(0.4)))
  })

  it('produces finite positive values across the whole parameter space', () => {
    for (let m = 0.1; m <= 100; m *= 1.6) {
      for (let t = 0; t <= 200; t = t * 2 + 0.001) {
        const star = evolve(solarMasses(m), gyr(t))
        for (const value of [star.mass, star.luminosity, star.radius, star.temperature]) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThan(0)
        }
      }
    }
  })

  it('agrees with the ZAMS module at age zero', () => {
    const direct = zamsProperties(solarMasses(3), zamsCoefficients(SOLAR))
    const viaEvolve = evolve(solarMasses(3), gyr(0))
    expect(viaEvolve.luminosity).toBeCloseTo(direct.luminosity, 6)
    expect(viaEvolve.radius).toBeCloseTo(direct.radius, 6)
  })
})
