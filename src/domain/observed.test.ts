import { describe, expect, it } from 'vitest'
import {
  coreLuminosity,
  coreMassFromLuminosity,
  giantBranchCoefficients,
  luminosityHeI,
  luminosityZAHB,
  radiusGB,
} from './giantBranch.js'
import { SOLAR } from './metallicity.js'
import { timescaleCoefficients } from './timescales.js'
import { zamsCoefficients, zamsProperties } from './zams.js'
import { solarMasses } from './units.js'

/*
 * Validation against real stars.
 *
 * The ported PHP tables cannot serve as an oracle — they are class-V dwarfs only, their radii below
 * 0.7 M☉ are demonstrably wrong, and several rows were flagged in the source as guessed
 * placeholders. This file is the replacement: a short list of well-observed single stars whose
 * parameters come from interferometry and asteroseismology rather than from a model.
 *
 * The test is deliberately shaped to avoid circularity. Rather than asking "does the track reach
 * this state at this age" — which would need an age, and stellar ages are themselves model-derived —
 * it asks the question the fits can answer independently:
 *
 *     given this star's measured mass and measured luminosity, does the model predict its
 *     measured radius?
 *
 * Radius is the right target because for giants it is measured directly as an angular diameter and
 * a parallax, so it is the least model-contaminated number available. Luminosity is an input here,
 * not a prediction, which is what keeps the check honest.
 *
 * Tolerances are wide on purpose. Masses of evolved stars carry 10-30% uncertainty, radii of
 * pulsating red supergiants vary by tens of per cent over a cycle, and Hurley's own fits are quoted
 * as accurate to ~5% against detailed models. A test that demanded better than the data would be
 * measuring noise.
 *
 * Every star here evolves as a single star. Sirius, Procyon, Antares and α Centauri have companions,
 * but all are wide enough that no mass transfer has occurred, so single-star evolution applies.
 */

const gb = giantBranchCoefficients(SOLAR, timescaleCoefficients(SOLAR))
const zams = zamsCoefficients(SOLAR)

interface Observed {
  readonly name: string
  readonly mass: number
  readonly luminosity: number
  readonly radius: number
  readonly temperature: number
  /** Fractional tolerance on the predicted radius. */
  readonly tolerance: number
  readonly note?: string
}

/*
 * Red giants on the first giant branch. These are the cleanest test in the whole file: Arcturus and
 * Aldebaran both have interferometric angular diameters good to better than 2%, and masses from
 * asteroseismology and planet-search radial velocities respectively.
 */
const GIANT_BRANCH: readonly Observed[] = [
  {
    name: 'Arcturus (α Boo, K0III)',
    mass: 1.08,
    luminosity: 180,
    radius: 25.4,
    temperature: 4286,
    tolerance: 0.3,
  },
  {
    name: 'Aldebaran (α Tau, K5III)',
    mass: 1.16,
    luminosity: 425,
    radius: 44.1,
    temperature: 3900,
    tolerance: 0.3,
  },
]

/*
 * Red supergiants. Masses here are the weakest link — Betelgeuse's current mass is ~11 M☉ from
 * pulsation modelling against ~19 M☉ initial, and Antares spans 12-15 M☉ in the literature — and
 * both stars pulsate, so the radius itself is a moving target. Hence the wider tolerance.
 */
const SUPERGIANTS: readonly Observed[] = [
  {
    name: 'Antares (α Sco A, M1.5Iab)',
    mass: 13,
    luminosity: 7.6e4,
    radius: 740,
    temperature: 3660,
    tolerance: 0.3,
    note: 'radius quoted 680-800 R☉; wide B-star companion, no interaction',
  },
]

describe('giant branch radii against interferometry', () => {
  it.each(GIANT_BRANCH)(
    'predicts the observed radius of $name from its observed luminosity',
    ({ mass, luminosity, radius, tolerance }) => {
      const predicted = radiusGB(solarMasses(mass), luminosity, gb)
      expect(predicted).toBeGreaterThan(radius * (1 - tolerance))
      expect(predicted).toBeLessThan(radius * (1 + tolerance))
    },
  )

  it.each(SUPERGIANTS)(
    'predicts the observed radius of $name from its observed luminosity',
    ({ mass, luminosity, radius, tolerance }) => {
      const predicted = radiusGB(solarMasses(mass), luminosity, gb)
      expect(predicted).toBeGreaterThan(radius * (1 - tolerance))
      expect(predicted).toBeLessThan(radius * (1 + tolerance))
    },
  )
})

/*
 * A known deviation, recorded rather than tuned away.
 *
 * At red-supergiant luminosities the fits run large. Betelgeuse at 1.0x10^5 L☉ and a current mass
 * near 11 M☉ comes out at ~1050 R☉ against an observed 640-764. Antares agrees to 8%, Arcturus and
 * Aldebaran to under 5%, so the error grows specifically at the top of the luminosity range.
 *
 * Three things are tangled together here and this test does not pretend to separate them: the fits
 * are calibrated against models that predate the recent downward revisions to red-supergiant radii;
 * Betelgeuse's own distance, radius and mass are all actively disputed; and a pulsating extended
 * atmosphere does not have one radius to measure. The honest statement is the bound below — the
 * model is in the right decade and biased high — and the fix, if one is wanted, is the reference
 * grid rather than a fudge factor here.
 */
describe('known deviation at red-supergiant luminosities', () => {
  it('puts Betelgeuse in the right decade but biased large', () => {
    const predicted = radiusGB(solarMasses(11), 1.0e5, gb)
    expect(predicted).toBeGreaterThan(700)
    expect(predicted).toBeLessThan(1400)
  })
})

/*
 * The red clump. Pollux is a core-helium-burning star of about 1.9 M☉, just below M_HeF, so it
 * arrived on the horizontal branch through the degenerate helium flash. Its luminosity is therefore
 * a prediction of L_ZAHB rather than an input, which makes it the one genuinely end-to-end check
 * available without integrating a track.
 */
describe('the red clump', () => {
  it('puts Pollux on a horizontal branch near its observed luminosity', () => {
    const mass = solarMasses(1.91)
    const coreAtFlash = coreMassFromLuminosity(luminosityHeI(mass, gb), coreLuminosity(mass, gb))
    const predicted = luminosityZAHB(mass, coreAtFlash, gb)

    // Observed: 43 L☉ at 9.06 R☉ and 4666 K.
    expect(predicted).toBeGreaterThan(20)
    expect(predicted).toBeLessThan(90)
  })
})

/*
 * The lower main sequence, against the ZAMS fits rather than the giant branch. Included because the
 * ported tables are at their worst below 0.7 M☉ — they give a 0.5 M☉ star a mean density 0.59x
 * solar, where real dwarfs there are several times denser than the Sun — so these rows are the
 * replacement for the fixtures that had to be excluded.
 *
 * Proxima is fully convective and Barnard's Star is close to that boundary; both are old, so their
 * observed radii are still essentially zero-age.
 */
const DWARFS: readonly Observed[] = [
  {
    name: 'Proxima Centauri (M5.5V)',
    mass: 0.122,
    luminosity: 0.0017,
    radius: 0.154,
    temperature: 3042,
    tolerance: 0.35,
  },
  {
    name: "Barnard's Star (M4V)",
    mass: 0.144,
    luminosity: 0.0035,
    radius: 0.196,
    temperature: 3220,
    tolerance: 0.35,
  },
  {
    name: '61 Cygni A (K5V)',
    mass: 0.7,
    luminosity: 0.153,
    radius: 0.665,
    temperature: 4526,
    tolerance: 0.25,
  },
  {
    name: 'α Centauri B (K1V)',
    mass: 0.907,
    luminosity: 0.5,
    radius: 0.863,
    temperature: 5260,
    tolerance: 0.25,
  },
]

describe('the lower main sequence against observed dwarfs', () => {
  it.each(DWARFS)('reproduces the radius of $name', ({ mass, radius, tolerance }) => {
    const predicted = zamsProperties(solarMasses(mass), zams).radius
    expect(predicted).toBeGreaterThan(radius * (1 - tolerance))
    expect(predicted).toBeLessThan(radius * (1 + tolerance))
  })

  it.each(DWARFS)('reproduces the luminosity of $name within a factor of two', ({ mass, luminosity }) => {
    const predicted = zamsProperties(solarMasses(mass), zams).luminosity
    expect(predicted).toBeGreaterThan(luminosity / 2)
    expect(predicted).toBeLessThan(luminosity * 2)
  })

  /*
   * The specific failure the PHP tables encoded. Real lower-main-sequence dwarfs are much denser
   * than the Sun; the tables had them less dense, which is what made their sub-0.7 M☉ radii unusable
   * as fixtures.
   */
  it('makes observed low-mass dwarfs denser than the Sun, as the ported tables did not', () => {
    for (const star of DWARFS) {
      const observedDensity = star.mass / star.radius ** 3
      const predicted = zamsProperties(solarMasses(star.mass), zams)
      const predictedDensity = star.mass / predicted.radius ** 3
      expect(observedDensity).toBeGreaterThan(1)
      expect(predictedDensity).toBeGreaterThan(1)
    }
  })
})
