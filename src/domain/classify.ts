import type { Kelvin, SolarLuminosities } from './units.js'
import type { Stage } from './stage.js'

/*
 * Spectral classification.
 *
 * The temperature scale is Pecaut & Mamajek's modern mean dwarf sequence, tabulated rather than
 * interpolated from class boundaries. That matters more than it looks: MK subtypes are *not* evenly
 * spaced in temperature. Across the G class the steps run 70, 90, 50, 40, 20, 60, 50, 70, 100 K, so
 * subdividing a class linearly — as this engine did before — misplaces subtypes by one or more near
 * the Sun, where the sequence is at its most compressed.
 *
 * Subtype 0 is the HOTTEST end of a class and 9 the coolest. The original engine had this inverted,
 * which is why it classified the Sun as G7V.
 *
 * One known simplification: this is the *dwarf* scale, applied to giants and supergiants too. A
 * G8III is cooler than a G8V, so evolved stars carry a systematic subtype offset. Fixing it needs
 * separate luminosity-class scales, which is a larger job than the classification is currently worth.
 */

/** Spectral type against effective temperature. Pecaut & Mamajek (2013), 2022 revision. */
const SEQUENCE: ReadonlyArray<readonly [string, number, number]> = [
  ['O', 3, 44900],
  ['O', 4, 42900],
  ['O', 5, 41400],
  ['O', 5.5, 40500],
  ['O', 6, 39500],
  ['O', 6.5, 38300],
  ['O', 7, 37100],
  ['O', 7.5, 36100],
  ['O', 8, 35100],
  ['O', 8.5, 34300],
  ['O', 9, 33300],
  ['O', 9.5, 31900],
  ['B', 0, 31400],
  ['B', 0.5, 29000],
  ['B', 1, 26000],
  ['B', 1.5, 24500],
  ['B', 2, 20600],
  ['B', 2.5, 18500],
  ['B', 3, 17000],
  ['B', 4, 16400],
  ['B', 5, 15700],
  ['B', 6, 14500],
  ['B', 7, 14000],
  ['B', 8, 12300],
  ['B', 9, 10700],
  ['B', 9.5, 10400],
  ['A', 0, 9700],
  ['A', 1, 9300],
  ['A', 2, 8800],
  ['A', 3, 8600],
  ['A', 4, 8250],
  ['A', 5, 8100],
  ['A', 6, 7910],
  ['A', 7, 7760],
  ['A', 8, 7590],
  ['A', 9, 7400],
  ['F', 0, 7220],
  ['F', 1, 7020],
  ['F', 2, 6820],
  ['F', 3, 6750],
  ['F', 4, 6670],
  ['F', 5, 6550],
  ['F', 6, 6350],
  ['F', 7, 6280],
  ['F', 8, 6180],
  ['F', 9, 6050],
  ['F', 9.5, 5990],
  ['G', 0, 5930],
  ['G', 1, 5860],
  ['G', 2, 5770],
  ['G', 3, 5720],
  ['G', 4, 5680],
  ['G', 5, 5660],
  ['G', 6, 5600],
  ['G', 7, 5550],
  ['G', 8, 5480],
  ['G', 9, 5380],
  ['K', 0, 5270],
  ['K', 1, 5170],
  ['K', 2, 5100],
  ['K', 3, 4830],
  ['K', 4, 4600],
  ['K', 5, 4440],
  ['K', 6, 4300],
  ['K', 7, 4100],
  ['K', 8, 3990],
  ['K', 9, 3930],
  ['M', 0, 3850],
  ['M', 0.5, 3770],
  ['M', 1, 3660],
  ['M', 1.5, 3620],
  ['M', 2, 3560],
  ['M', 2.5, 3470],
  ['M', 3, 3430],
  ['M', 3.5, 3270],
  ['M', 4, 3210],
  ['M', 4.5, 3110],
  ['M', 5, 3060],
  ['M', 5.5, 2930],
  ['M', 6, 2810],
  ['M', 6.5, 2740],
  ['M', 7, 2680],
  ['M', 7.5, 2630],
  ['M', 8, 2570],
  ['M', 8.5, 2420],
  ['M', 9, 2380],
  ['M', 9.5, 2350],
  ['L', 0, 2270],
  ['L', 1, 2160],
  ['L', 2, 2060],
  ['L', 3, 1920],
  ['L', 4, 1870],
  ['L', 5, 1710],
  ['L', 6, 1550],
  ['L', 7, 1530],
  ['L', 8, 1420],
  ['L', 9, 1370],
  ['T', 0, 1255],
  ['T', 1, 1240],
  ['T', 2, 1220],
  ['T', 3, 1200],
  ['T', 4, 1180],
  ['T', 4.5, 1170],
  ['T', 5, 1160],
  ['T', 5.5, 1040],
  ['T', 6, 950],
  ['T', 7, 825],
  ['T', 7.5, 750],
  ['T', 8, 680],
  ['T', 8.5, 600],
  ['T', 9, 560],
  ['T', 9.5, 510],
  ['Y', 0, 450],
  ['Y', 0.5, 400],
  ['Y', 1, 360],
  ['Y', 1.5, 325],
  ['Y', 2, 320],
  ['Y', 4, 250],
]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export interface Spectral {
  /** Full MK designation, e.g. "G2V". Null for objects with no meaningful spectrum. */
  readonly type: string | null
  readonly letter: string | null
  readonly subtype: number | null
  readonly luminosityClass: string | null
}

/** Nearest tabulated type, matched in log temperature so the choice is scale-free. */
function harvard(temperature: Kelvin): { letter: string; subtype: number } {
  const target = Math.log(temperature)
  let best = SEQUENCE[0] as readonly [string, number, number]
  let bestDistance = Infinity

  for (const entry of SEQUENCE) {
    const distance = Math.abs(Math.log(entry[2]) - target)
    if (distance < bestDistance) {
      bestDistance = distance
      best = entry
    }
  }

  return { letter: best[0], subtype: best[1] }
}

function luminosityClass(stage: Stage, luminosity: SolarLuminosities): string {
  if (stage === 'main sequence') return 'V'
  if (stage === 'hertzsprung gap') return 'IV'
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
  /*
   * No MK type for these. A planetary nebula's central star does have one — they are extremely hot
   * O, [WR] or PG 1159 objects — but the thing on screen is the nebula, and labelling the whole
   * object by its core would be the wrong identification.
   */
  if (stage === 'black hole' || stage === 'neutron star' || stage === 'planetary nebula') {
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
