import { describe, expect, it } from 'vitest'
import {
  blueLoopFraction,
  coreLuminosity,
  coreMassBAGB,
  coreMassFromLuminosity,
  giantBranchCoefficients,
  heliumBurningTime,
  luminosityBAGB,
  luminosityBGB,
  luminosityFromCoreMass,
  luminosityHeI,
  luminosityZAHB,
  radiusAGB,
  radiusGB,
} from './giantBranch.js'
import { SOLAR, fromFeH } from './metallicity.js'
import { timescaleCoefficients } from './timescales.js'
import { solarMasses } from './units.js'

const ts = timescaleCoefficients(SOLAR)
const solar = giantBranchCoefficients(SOLAR, ts)
const at = (m: number) => solarMasses(m)

describe('mass thresholds', () => {
  it('places the helium flash and first-giant-branch boundaries where Hurley does', () => {
    expect(solar.thresholds.heliumFlash).toBeCloseTo(1.995, 3)
    expect(solar.thresholds.firstGiantBranch).toBeGreaterThan(12)
    expect(solar.thresholds.firstGiantBranch).toBeLessThan(14)
    expect(solar.thresholds.carbonIgnition).toBeCloseTo(6.11, 1)
  })

  it('moves the helium-flash boundary with metallicity', () => {
    const poor = giantBranchCoefficients(fromFeH(-1.5), timescaleCoefficients(fromFeH(-1.5)))
    expect(poor.thresholds.heliumFlash).toBeLessThan(solar.thresholds.heliumFlash)
  })
})

/*
 * These are the numbers the whole rewrite exists to produce, so they are asserted against published
 * values rather than against the implementation. A solar-mass star ignites helium at the tip of the
 * giant branch at roughly 2500 L☉ and 170 R☉, with a degenerate core of about 0.47 M☉.
 *
 * The previous engine put that tip at 52 L☉ and 23 R☉, because it anchored the giant branch to the
 * main-sequence luminosity rather than to the core mass.
 */
describe('the solar giant branch', () => {
  const sun = at(1)

  it('ignites helium at the observed tip luminosity', () => {
    expect(luminosityHeI(sun, solar)).toBeGreaterThan(2000)
    expect(luminosityHeI(sun, solar)).toBeLessThan(3200)
  })

  it('reaches the observed tip radius, which is most of an AU', () => {
    const tip = radiusGB(sun, luminosityHeI(sun, solar), solar)
    expect(tip).toBeGreaterThan(140)
    expect(tip).toBeLessThan(220)
  })

  it('builds a degenerate helium core of about 0.47 M☉ before the flash', () => {
    const core = coreMassFromLuminosity(luminosityHeI(sun, solar), coreLuminosity(sun, solar))
    expect(core).toBeGreaterThan(0.44)
    expect(core).toBeLessThan(0.50)
  })

  it('leaves a core matching the observed white dwarf mass peak', () => {
    expect(coreMassBAGB(sun, solar)).toBeGreaterThan(0.50)
    expect(coreMassBAGB(sun, solar)).toBeLessThan(0.60)
  })

  it('sits on a horizontal branch near 50-60 L☉', () => {
    const core = coreMassFromLuminosity(luminosityHeI(sun, solar), coreLuminosity(sun, solar))
    expect(luminosityZAHB(sun, core, solar)).toBeGreaterThan(40)
    expect(luminosityZAHB(sun, core, solar)).toBeLessThan(80)
  })

  it('burns helium for roughly a hundred Myr', () => {
    const core = coreMassFromLuminosity(luminosityHeI(sun, solar), coreLuminosity(sun, solar))
    const t = heliumBurningTime(sun, core, solar)
    expect(t).toBeGreaterThan(80)
    expect(t).toBeLessThan(200)
  })
})

/*
 * The degenerate flash is nearly mass-independent below M_HeF — that is what makes the RGB tip a
 * standard candle and globular-cluster distances measurable. Above M_HeF helium ignites
 * non-degenerately, far earlier and far fainter, and the tip luminosity drops sharply.
 */
describe('the helium flash boundary', () => {
  it('ignites at nearly the same core mass for every low-mass star', () => {
    // This near-invariance is why the RGB tip works as a standard candle.
    const cores = [0.8, 1.0, 1.2, 1.5].map((m) =>
      coreMassFromLuminosity(luminosityHeI(at(m), solar), coreLuminosity(at(m), solar)),
    )
    for (const core of cores) {
      expect(core).toBeGreaterThan(0.44)
      expect(core).toBeLessThan(0.50)
    }
  })

  /*
   * Approaching M_HeF from below the core is progressively less degenerate, so it ignites earlier
   * and fainter. The tip therefore falls away toward the boundary rather than holding flat up to it.
   */
  it('lowers the ignition core mass as the flash boundary is approached', () => {
    const near = coreMassFromLuminosity(luminosityHeI(at(1.9), solar), coreLuminosity(at(1.9), solar))
    const far = coreMassFromLuminosity(luminosityHeI(at(1.0), solar), coreLuminosity(at(1.0), solar))
    expect(near).toBeLessThan(far)
    expect(near).toBeGreaterThan(solar.coreMassHeI)
  })

  /*
   * The point of the gbp(41) continuity anchor. Helium ignition changes character completely at
   * M_HeF — degenerate flash below, quiet ignition above — and the fit has to cross that boundary
   * without a step, or every track through it would jump.
   */
  it('is continuous in luminosity across the boundary', () => {
    const flash = solar.thresholds.heliumFlash
    const below = luminosityHeI(at(flash * (1 - 1e-9)), solar)
    const above = luminosityHeI(at(flash * (1 + 1e-9)), solar)
    expect(above / below).toBeCloseTo(1, 6)
  })

  it('turns the ignition luminosity back upward above the boundary', () => {
    expect(luminosityHeI(at(2.5), solar)).toBeGreaterThan(luminosityHeI(at(2.05), solar))
    expect(luminosityHeI(at(3), solar)).toBeGreaterThan(luminosityHeI(at(2.5), solar))
  })
})

describe('massive stars', () => {
  /*
   * The failure this replaces: the old giant branch put a 30 M☉ star at 6e6 L☉ and 7350 R☉ — fifteen
   * times its Eddington luminosity, and three times wider than the largest star ever observed.
   */
  it.each([15, 30, 60])('keeps a %i M☉ supergiant below its Eddington luminosity', (m) => {
    const eddington = 3.3e4 * m
    expect(luminosityHeI(at(m), solar)).toBeLessThan(eddington)
    expect(luminosityBAGB(at(m), solar)).toBeLessThan(eddington)
  })

  it.each([15, 30])('keeps a %i M☉ supergiant radius physically plausible', (m) => {
    const radius = radiusAGB(at(m), luminosityBAGB(at(m), solar), solar)
    expect(radius).toBeGreaterThan(300)
    expect(radius).toBeLessThan(2600)
  })

  it('loses the blue loop as mass rises', () => {
    expect(blueLoopFraction(at(5), solar)).toBeGreaterThan(0.3)
    expect(blueLoopFraction(at(15), solar)).toBeLessThan(0.2)
    expect(blueLoopFraction(at(30), solar)).toBe(0)
  })
})

describe('the core-mass–luminosity relation', () => {
  it('round-trips core mass and luminosity across both branches', () => {
    const core = coreLuminosity(at(1), solar)
    for (const mc of [0.2, 0.4, core.massX * 0.99, core.massX * 1.01, 0.8, 1.2]) {
      expect(coreMassFromLuminosity(luminosityFromCoreMass(mc, core), core)).toBeCloseTo(mc, 6)
    }
  })

  it('is continuous where the two branches cross', () => {
    const core = coreLuminosity(at(1), solar)
    const below = luminosityFromCoreMass(core.massX * (1 - 1e-9), core)
    const above = luminosityFromCoreMass(core.massX * (1 + 1e-9), core)
    expect(above / below).toBeCloseTo(1, 6)
  })

  it('makes luminosity depend on the core, not the envelope', () => {
    // Same core mass, wildly different total mass: the luminosity must barely move.
    const light = luminosityFromCoreMass(0.45, coreLuminosity(at(0.9), solar))
    const heavy = luminosityFromCoreMass(0.45, coreLuminosity(at(1.8), solar))
    expect(heavy / light).toBeCloseTo(1, 6)
  })
})

describe('ordering', () => {
  it.each([0.8, 1, 3, 8, 15, 30])('keeps the luminosity sequence ordered at %i M☉', (m) => {
    const bgb = luminosityBGB(at(m), solar)
    const bagb = luminosityBAGB(at(m), solar)
    expect(bgb).toBeGreaterThan(0)
    expect(bagb).toBeGreaterThan(bgb)
  })

  it('grows the core monotonically with mass', () => {
    let previous = 0
    for (let m = 0.8; m <= 40; m *= 1.2) {
      const core = coreMassBAGB(at(m), solar)
      expect(core).toBeGreaterThan(previous)
      previous = core
    }
  })
})
