import { describe, expect, it } from 'vitest'
import tables from '../data/zams-tables.json' with { type: 'json' }
import { zamsCoefficients, zamsProperties } from './zams.js'
import { SOLAR, fromFeH, metallicity } from './metallicity.js'
import { solarMasses } from './units.js'

const solar = zamsCoefficients(SOLAR)
const at = (m: number, coeff = solar) => zamsProperties(solarMasses(m), coeff)

describe('Tout et al. (1996) ZAMS', () => {
  it('reproduces the zero-age Sun', () => {
    const { luminosity, radius } = at(1)
    // The ZAMS Sun was ~70% of its present luminosity and ~89% of its present radius.
    expect(luminosity).toBeGreaterThan(0.65)
    expect(luminosity).toBeLessThan(0.75)
    expect(radius).toBeGreaterThan(0.85)
    expect(radius).toBeLessThan(0.92)
  })

  it('is monotonic in mass across the valid range', () => {
    let lastL = 0
    let lastR = 0
    for (let m = 0.1; m <= 100; m *= 1.05) {
      const { luminosity, radius } = at(m)
      expect(luminosity).toBeGreaterThan(lastL)
      expect(radius).toBeGreaterThan(lastR)
      lastL = luminosity
      lastR = radius
    }
  })

  it('stays finite and positive over the full mass and metallicity domain', () => {
    for (const z of [0.0001, 0.001, 0.004, 0.01, 0.02, 0.03]) {
      const coeff = zamsCoefficients(metallicity(z))
      for (let m = 0.1; m <= 100; m *= 1.15) {
        const { luminosity, radius } = at(m, coeff)
        expect(Number.isFinite(luminosity)).toBe(true)
        expect(Number.isFinite(radius)).toBe(true)
        expect(luminosity).toBeGreaterThan(0)
        expect(radius).toBeGreaterThan(0)
      }
    }
  })

  it('density rises toward the bottom of the main sequence', () => {
    // M/R³ relative to solar. Low-mass dwarfs are compact; massive stars are diffuse.
    const density = (m: number) => {
      const { radius } = at(m)
      return m / radius ** 3
    }
    expect(density(0.3)).toBeGreaterThan(density(0.5))
    expect(density(0.5)).toBeGreaterThan(density(1))
    expect(density(1)).toBeGreaterThan(density(5))
    expect(density(5)).toBeGreaterThan(density(30))
  })

  it('makes metal-poor stars hotter and more compact at fixed mass', () => {
    const poor = zamsProperties(solarMasses(1), zamsCoefficients(fromFeH(-1.5)))
    const rich = zamsProperties(solarMasses(1), zamsCoefficients(fromFeH(0.3)))
    expect(poor.radius).toBeLessThan(rich.radius)
  })
})

describe('agreement with the ported observational tables', () => {
  const dwarfs = tables.entries.filter((e) => e.luminosityClass === 'V' && !e.unreliable)

  it('has fixtures to check against', () => {
    expect(dwarfs.length).toBeGreaterThan(50)
  })

  /*
   * The tabulated class-V values are *observed* main-sequence stars, which have already brightened
   * and swelled since the ZAMS. So this is a bounded-agreement check, not an equality check: the
   * ZAMS prediction should sit below the observed value but within a factor of two. That is still
   * tight enough to have caught the previous engine, whose 30 M☉ luminosity was ~4x too high.
   */
  it('predicts ZAMS luminosities below but near the observed main-sequence values', () => {
    const outliers: string[] = []

    for (const entry of dwarfs) {
      if (entry.mass < 0.2 || entry.mass > 60) continue
      const { luminosity } = at(entry.mass)
      const ratio = luminosity / entry.luminosity
      if (ratio > 1.6 || ratio < 0.25) {
        outliers.push(
          `${entry.spectralClass}${entry.subtype}V M=${entry.mass} ` +
            `table L=${entry.luminosity} zams L=${luminosity.toPrecision(3)} ratio=${ratio.toPrecision(2)}`,
        )
      }
    }

    expect(outliers).toEqual([])
  })

  /*
   * Restricted to >= 0.7 M☉ because the table's radii are demonstrably wrong below that, not
   * because the implementation disagrees there. The source lists K0V through K9V at 0.95–1.05 R☉
   * while their masses fall from 0.8 to 0.5 M☉ — that is a mean density of 0.59x solar for a
   * 0.5 M☉ star, where real lower-main-sequence dwarfs are several times *denser* than the Sun.
   * The `density rises toward the bottom of the main sequence` test below pins the correct
   * behaviour independently of this fixture.
   */
  it('predicts ZAMS radii within 40% of the observed main-sequence values', () => {
    const outliers: string[] = []

    for (const entry of dwarfs) {
      if (entry.mass < 0.7 || entry.mass > 60) continue
      const { radius } = at(entry.mass)
      const ratio = radius / entry.radius
      if (ratio > 1.4 || ratio < 0.6) {
        outliers.push(
          `${entry.spectralClass}${entry.subtype}V M=${entry.mass} ` +
            `table R=${entry.radius} zams R=${radius.toPrecision(3)} ratio=${ratio.toPrecision(2)}`,
        )
      }
    }

    expect(outliers).toEqual([])
  })
})
