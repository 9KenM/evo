import { describe, expect, it } from 'vitest'
import { cachedTrack, evolutionContext, evolve, phasesOf } from './star.js'
import { classify } from './classify.js'
import { isRemnant } from './stage.js'
import { zamsCoefficients, zamsProperties } from './zams.js'
import { SOLAR, fromFeH } from './metallicity.js'
import { gyr, kelvin, solarLuminosities, solarMasses, type Gyr } from './units.js'

const sun = solarMasses(1)
const ctx = evolutionContext(SOLAR)
const trackFor = (m: number) => cachedTrack(solarMasses(m), ctx)

/** Age at which the remnant forms, in Gyr. */
const remnantAt = (m: number) => trackFor(m).remnantAt / 1000
const solarMS = phasesOf(trackFor(1))[0]!.end

/** Age as a multiple of the solar main-sequence lifetime. */
const atMS = (fraction: number): Gyr => gyr(solarMS * fraction)

describe('spectral classification', () => {
  it('classifies the zero-age Sun as a mid-G dwarf', () => {
    // 5597 K against Pecaut & Mamajek's G6V = 5600 K. The real zero-age Sun was near 5620 K.
    expect(evolve(sun, gyr(0)).spectral.type).toBe('G6V')
  })

  /*
   * The whole point of the main-sequence perturbation terms.
   *
   * Before them the main sequence was a straight line in log space between two correct endpoints,
   * which grows the radius too fast early on — and since T = (L/R²)^¼, a small radius error becomes
   * a temperature one. The Sun read 5540 K and G5V. With Hurley's α/β/η and hook corrections it
   * reads 5752 K against a real 5772 K, and lands on the right spectral type.
   */
  it('classifies the present-day Sun as G2V', () => {
    const star = evolve(sun, gyr(4.57))
    expect(star.spectral.type).toBe('G2V')
    expect(star.temperature).toBeGreaterThan(5700)
    expect(star.temperature).toBeLessThan(5850)
  })

  it('assigns lower subtypes to hotter stars within a class', () => {
    const hot = classify('main sequence', kelvin(5900), solarLuminosities(1))
    const cool = classify('main sequence', kelvin(5400), solarLuminosities(1))
    expect(hot.letter).toBe('G')
    expect(cool.letter).toBe('G')
    expect(hot.subtype!).toBeLessThan(cool.subtype!)
  })

  /*
   * The tabulated scale exists because MK subtypes are not evenly spaced in temperature. Linear
   * subdivision of the G class put the Sun a full subtype out, which is the error this replaces.
   */
  it('reproduces the anchor points of the Pecaut & Mamajek sequence', () => {
    const at = (t: number) => classify('main sequence', kelvin(t), solarLuminosities(1)).type
    expect(at(5770)).toBe('G2V')
    expect(at(5930)).toBe('G0V')
    expect(at(5270)).toBe('K0V')
    expect(at(9700)).toBe('A0V')
    expect(at(3850)).toBe('M0V')
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

/*
 * The phase set is now Hurley's, and which phases a star has depends on its mass. Every star has a
 * main sequence and a Hertzsprung gap; only stars below M_FGB have a first giant branch; only stars
 * that avoid core collapse get a planetary nebula.
 */
describe('the phase set', () => {
  const stages = (m: number) => phasesOf(trackFor(m)).map((phase) => phase.stage)

  it('gives a solar-mass star the full low-mass sequence', () => {
    expect(stages(1)).toEqual([
      'main sequence',
      'hertzsprung gap',
      'giant branch',
      'core helium burning',
      'early AGB',
      'thermally pulsing AGB',
      'planetary nebula',
    ])
  })

  it('gives a massive star no first giant branch, because helium ignites in the gap', () => {
    expect(stages(30)).not.toContain('giant branch')
  })

  it('gives a massive star no planetary nebula, because it core-collapses instead', () => {
    expect(stages(30)).not.toContain('planetary nebula')
    expect(stages(1)).toContain('planetary nebula')
  })

  it('orders phases contiguously with no gaps or overlaps', () => {
    for (const m of [0.8, 1, 2, 5, 15, 30]) {
      const phases = phasesOf(trackFor(m))
      expect(phases[0]!.start).toBe(0)
      for (let i = 1; i < phases.length; i++) {
        expect(phases[i]!.start).toBeCloseTo(phases[i - 1]!.end, 12)
      }
    }
  })
})

describe('the giant branch', () => {
  /*
   * The headline fix. The old engine anchored the giant branch to L_TMS × 25, an envelope quantity,
   * which put the solar RGB tip at 52 L☉ and 23 R☉ against a real ~2500 L☉ and ~170 R☉.
   */
  it('takes the Sun to a realistic red-giant tip', () => {
    const phases = phasesOf(trackFor(1))
    const gb = phases.find((phase) => phase.stage === 'giant branch')!
    const tip = evolve(sun, gyr(gb.end - (gb.end - gb.start) * 1e-6))
    expect(tip.luminosity).toBeGreaterThan(1500)
    expect(tip.radius).toBeGreaterThan(120)
  })

  /*
   * The plan called this the most engaging marker on a solar-mass track, and the old engine never
   * fired it because its giant branch was fifty times too faint.
   */
  it('swells the Sun past Earth’s orbit on the AGB', () => {
    /*
     * Sampled inside the AGB phases rather than over the whole track. The thermally pulsing AGB is
     * 280 kyr out of 12.5 Gyr — twenty-two parts per million — so any grid laid over the full
     * lifetime steps straight over the tip. That ratio is the entire reason the timeline needs a
     * warp.
     */
    let maximum = 0
    for (const phase of phasesOf(trackFor(1))) {
      if (!phase.stage.includes('AGB')) continue
      for (let i = 0; i <= 1000; i++) {
        const age = gyr(phase.start + ((phase.end - phase.start) * i) / 1000)
        maximum = Math.max(maximum, evolve(sun, age).radius)
      }
    }
    expect(maximum).toBeGreaterThan(215.03)
  })

  it('never exceeds the Eddington luminosity at any mass or age', () => {
    for (const m of [1, 5, 15, 30, 60]) {
      const eddington = 3.3e4 * m
      const end = remnantAt(m)
      for (let f = 0; f <= 1; f += 0.01) {
        const star = evolve(solarMasses(m), gyr(end * f))
        if (star.stage === 'planetary nebula') continue
        expect(star.luminosity).toBeLessThan(eddington)
      }
    }
  })
})

describe('remnants', () => {
  it('leaves a ~0.5 M☉ white dwarf from a solar progenitor (previously 0.057)', () => {
    const { remnantMass, remnantStage } = trackFor(1)
    expect(remnantStage).toBe('white dwarf')
    expect(remnantMass).toBeGreaterThan(0.45)
    expect(remnantMass).toBeLessThan(0.7)
  })

  it('never produces a white dwarf above the Chandrasekhar limit', () => {
    for (let m = 0.8; m <= 7; m += 0.5) {
      const track = trackFor(m)
      if (track.remnantStage !== 'white dwarf') continue
      expect(track.remnantMass).toBeLessThanOrEqual(1.44)
    }
  })

  it('leaves a neutron star in the observed mass range', () => {
    for (let m = 9; m <= 20; m += 1) {
      const track = trackFor(m)
      if (track.remnantStage !== 'neutron star') continue
      expect(track.remnantMass).toBeGreaterThan(1.1)
      expect(track.remnantMass).toBeLessThan(2.5)
    }
  })

  /*
   * Conservation. The old `max(3, 0.3 M_initial)` could hand a 30 M☉ star that mass loss had
   * stripped to 3 M☉ a nine-solar-mass black hole.
   */
  it('never produces a remnant heavier than the star that made it', () => {
    for (let m = 0.8; m <= 80; m *= 1.3) {
      const track = trackFor(m)
      expect(track.remnantMass).toBeLessThanOrEqual(track.massAtEnd + 1e-9)
    }
  })

  it('picks the remnant type from the core, not from a hardcoded mass cut', () => {
    expect(trackFor(1).remnantStage).toBe('white dwarf')
    expect(trackFor(15).remnantStage).toBe('neutron star')
    expect(trackFor(40).remnantStage).toBe('black hole')
  })
})

describe('mass loss', () => {
  it('sheds mass after the main sequence (previously stayed at exactly 1.000)', () => {
    const star = evolve(sun, gyr(remnantAt(1) * 0.999))
    expect(star.mass).toBeLessThan(star.massInitial)
  })

  it('loses no mass on the main sequence', () => {
    expect(evolve(sun, atMS(0.5)).mass).toBeCloseTo(1, 10)
  })

  /*
   * The Sun should lose 0.2-0.3 M☉ before it becomes a white dwarf, most of it on the giant branch
   * and the AGB. The old engine lost none at all; with the real tip luminosity and the superwind it
   * now lands in the observed range.
   */
  it('strips a realistic amount from the Sun by the end of the AGB', () => {
    const lost = 1 - trackFor(1).massAtEnd
    expect(lost).toBeGreaterThan(0.15)
    expect(lost).toBeLessThan(0.6)
  })

  /*
   * The failure this replaces: Reimers alone at supergiant L·R/M stripped 27 M☉ off a 30 M☉ star
   * and hit the 90% safety clamp. With the Nieuwenhuijzen & de Jager and LBV terms competing it
   * stays in the range massive-star evolution actually shows.
   */
  it('keeps a massive star from being stripped to nothing', () => {
    const track = trackFor(30)
    expect(track.massAtEnd).toBeGreaterThan(5)
    expect(track.massAtEnd).toBeLessThan(30)
  })

  it('is monotonic in age', () => {
    let previous = Infinity
    const end = remnantAt(1)
    for (let f = 0.5; f <= 0.999; f += 0.005) {
      const { mass } = evolve(sun, gyr(end * f))
      expect(mass).toBeLessThanOrEqual(previous + 1e-9)
      previous = mass
    }
  })
})

/*
 * The planetary nebula. This is the phase the whole rewrite exists to make visible: the envelope is
 * gone, the exposed core crosses the diagram at constant luminosity, and the shell it ejected lights
 * up when the core passes ~30,000 K.
 */
describe('the planetary nebula', () => {
  it('exists for a solar-mass star and lasts tens of kyr', () => {
    const pn = phasesOf(trackFor(1)).find((phase) => phase.stage === 'planetary nebula')!
    const years = (pn.end - pn.start) * 1e9
    expect(years).toBeGreaterThan(1000)
    expect(years).toBeLessThan(60000)
  })

  it('crosses at nearly constant luminosity while heating by more than a decade', () => {
    const pn = phasesOf(trackFor(1)).find((phase) => phase.stage === 'planetary nebula')!
    const start = evolve(sun, gyr(pn.start + (pn.end - pn.start) * 0.01))
    const middle = evolve(sun, gyr(pn.start + (pn.end - pn.start) * 0.6))
    expect(middle.luminosity / start.luminosity).toBeCloseTo(1, 1)
    expect(middle.temperature / start.temperature).toBeGreaterThan(5)
  })

  it('gets hot enough to ionise the shell', () => {
    const pn = phasesOf(trackFor(1)).find((phase) => phase.stage === 'planetary nebula')!
    const hot = evolve(sun, gyr(pn.end - (pn.end - pn.start) * 1e-5))
    expect(hot.temperature).toBeGreaterThan(30000)
  })
})

describe('metallicity', () => {
  it('changes the main-sequence lifetime at fixed mass', () => {
    const poor = phasesOf(cachedTrack(sun, evolutionContext(fromFeH(-1.5))))[0]!.end
    const rich = phasesOf(cachedTrack(sun, evolutionContext(fromFeH(0.3))))[0]!.end
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
   * Every boundary is continuous except one, and the exception is real physics rather than a defect.
   * A low-mass star ignites helium degenerately at the tip of the giant branch, and the flash drops
   * it from ~2500 L☉ to the ~50 L☉ horizontal branch essentially instantly. That step is the helium
   * flash and it is asserted separately below.
   */
  it.each([0.8, 1, 2, 5, 12, 30])('is continuous across every other boundary at %i M☉', (m) => {
    const mass = solarMasses(m)
    const phases = phasesOf(trackFor(m))

    for (let i = 1; i < phases.length; i++) {
      const previous = phases[i - 1]!
      if (previous.stage === 'giant branch') continue // the helium flash

      /*
       * The nudge is a fraction of the *shorter adjacent phase*, not of the absolute age. A
       * planetary nebula can last 124 years against a 1.5 Gyr clock, so an age-relative epsilon
       * lands a percent of the way into it and measures real evolution as if it were a step.
       */
      const boundary = previous.end
      const span = Math.min(previous.end - previous.start, phases[i]!.end - phases[i]!.start)
      const nudge = Math.max(span * 1e-5, Number.MIN_VALUE)
      const left = evolve(mass, gyr(boundary - nudge))
      const right = evolve(mass, gyr(boundary + nudge))

      expect(right.luminosity / left.luminosity).toBeCloseTo(1, 2)
      expect(right.radius / left.radius).toBeCloseTo(1, 2)
    }
  })

  it('is continuous from the nebula onto the cooling track', () => {
    const phases = phasesOf(trackFor(1))
    const pn = phases.find((phase) => phase.stage === 'planetary nebula')!
    const nudge = (pn.end - pn.start) * 1e-5
    const before = evolve(sun, gyr(pn.end - nudge))
    const after = evolve(sun, gyr(pn.end + nudge))
    expect(after.luminosity / before.luminosity).toBeCloseTo(1, 1)
    expect(after.radius / before.radius).toBeCloseTo(1, 1)
  })

  it('drops the star onto the horizontal branch at the helium flash', () => {
    const gb = phasesOf(trackFor(1)).find((phase) => phase.stage === 'giant branch')!
    const nudge = (gb.end - gb.start) * 1e-6
    const tip = evolve(sun, gyr(gb.end - nudge))
    const horizontal = evolve(sun, gyr(gb.end + nudge))
    expect(horizontal.luminosity).toBeLessThan(tip.luminosity / 10)
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

  it('reaches a remnant and stays there', () => {
    for (const m of [1, 15, 30]) {
      const end = remnantAt(m)
      expect(isRemnant(evolve(solarMasses(m), gyr(end * 2 + 1)).stage)).toBe(true)
    }
  })
})
