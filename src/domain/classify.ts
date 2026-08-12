import type { Kelvin, SolarLuminosities } from './units.js'
import type { Stage } from './stage.js'

/*
 * Harvard classes, hottest first. Subtype 0 is the HOTTEST end of a class and 9 the coolest —
 * the previous engine had this backwards, which is why it classified the Sun as G7V instead of G2V.
 */
const CLASSES = [
  { letter: 'O', lo: 30000, hi: 55000 },
  { letter: 'B', lo: 10000, hi: 30000 },
  { letter: 'A', lo: 7600, hi: 10000 },
  { letter: 'F', lo: 6000, hi: 7600 },
  { letter: 'G', lo: 5200, hi: 6000 },
  { letter: 'K', lo: 3900, hi: 5200 },
  { letter: 'M', lo: 2000, hi: 3900 },
  { letter: 'L', lo: 1300, hi: 2000 },
  { letter: 'T', lo: 600, hi: 1300 },
  { letter: 'Y', lo: 250, hi: 600 },
] as const

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export interface Spectral {
  /** Full MK designation, e.g. "G2V". Null for objects with no meaningful spectrum. */
  readonly type: string | null
  readonly letter: string | null
  readonly subtype: number | null
  readonly luminosityClass: string | null
}

function harvard(temperature: Kelvin): { letter: string; subtype: number } {
  const band = CLASSES.find((c) => temperature >= c.lo && temperature < c.hi) ?? CLASSES[0]
  const hottest = CLASSES[0]
  if (temperature >= hottest.hi) return { letter: 'O', subtype: 0 }

  const fraction = (band.hi - temperature) / (band.hi - band.lo)
  return { letter: band.letter, subtype: clamp(Math.floor(fraction * 10), 0, 9) }
}

function luminosityClass(stage: Stage, luminosity: SolarLuminosities): string {
  if (stage === 'subgiant') return 'IV'
  if (stage !== 'giant') return 'V'
  if (luminosity >= 1e6) return 'Ia0'
  if (luminosity >= 1e4) return 'I'
  if (luminosity >= 5e3) return 'II'
  return 'III'
}

export function classify(
  stage: Stage,
  temperature: Kelvin,
  luminosity: SolarLuminosities,
): Spectral {
  if (stage === 'black hole' || stage === 'neutron star') {
    return { type: null, letter: null, subtype: null, luminosityClass: null }
  }

  if (stage === 'white dwarf') {
    // Standard white dwarf temperature index: 50400 / Teff.
    const subtype = clamp(Math.round(50400 / temperature), 1, 9)
    return { type: `D${subtype}`, letter: 'D', subtype, luminosityClass: null }
  }

  const { letter, subtype } = harvard(temperature)
  const lum = luminosityClass(stage, luminosity)
  return { type: `${letter}${subtype}${lum}`, letter, subtype, luminosityClass: lum }
}
