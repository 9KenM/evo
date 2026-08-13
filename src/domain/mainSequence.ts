import coefficients from '../data/sse-coefficients.json' with { type: 'json' }
import { SOLAR_METALLICITY, type Metallicity } from './metallicity.js'
import { zamsProperties, type ZamsCoefficients } from './zams.js'
import {
  solarLuminosities,
  solarRadii,
  type SolarLuminosities,
  type SolarMasses,
  type SolarRadii,
} from './units.js'

/*
 * Main sequence. Hurley, Pols & Tout (2000) section 5.1.
 *
 * The terminal-age anchors L_TMS and R_TMS say where the star ends up; the perturbation terms below
 * say how it gets there. Without them the main sequence is a straight line in log space between two
 * correct endpoints, which grows the radius too fast early on — and since T = (L/R²)^¼, a small
 * radius error becomes a temperature one. That is why the Sun used to read 5540 K and G5V at
 * 4.57 Gyr instead of 5772 K and G2V.
 *
 * The hook terms are a separate correction again. Above M_hook a star develops a convective core
 * whose exhaustion produces a brief contraction near the end of the main sequence; τ₁ and τ₂ below
 * are what switch that on and off.
 *
 * Indexing is 1-based throughout, matching the published coefficient tables. `poly` takes a 1-based
 * start so the index in the code is the index in the paper.
 */

const xl = coefficients.xl
const xr = coefficients.xr

/** Horner evaluation of `terms` consecutive constants as a polynomial in ζ. 1-based `first`. */
const poly = (table: readonly number[], first: number, terms: number, zeta: number): number => {
  let value = 0
  for (let i = terms - 1; i >= 0; i--) value = value * zeta + (table[first - 1 + i] as number)
  return value
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

export interface MainSequenceCoefficients {
  readonly lum: readonly [number, number, number, number, number, number]
  readonly rad: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  /** Mass below which the terminal-age radius fit switches branch, with its blend endpoints. */
  readonly radBreak: { readonly mass: number; readonly low: number; readonly high: number }
  /** Perturbation block, 1-based on Hurley's `a` indices 33-51 and 65-97. */
  readonly perturbation: readonly number[]
}

/** Terminal-age main-sequence coefficients. Hurley, Pols & Tout (2000) Appendix A. */
export function mainSequenceCoefficients(metallicity: Metallicity): MainSequenceCoefficients {
  const z = metallicity
  const zeta = Math.log10(metallicity / SOLAR_METALLICITY)
  const lz = Math.log10(metallicity)

  // Ltms
  const l30 = poly(xl, 15, 5, zeta)
  const lum = [
    poly(xl, 1, 5, zeta) * l30,
    poly(xl, 6, 5, zeta) * l30,
    poly(xl, 11, 4, zeta),
    l30,
    poly(xl, 20, 4, zeta),
    poly(xl, 24, 4, zeta),
  ] as const

  // Rtms
  const r54 = poly(xr, 11, 5, zeta)
  const r52 = poly(xr, 1, 5, zeta) * r54
  const r53 = poly(xr, 6, 5, zeta) * r54
  const r55 = poly(xr, 16, 4, zeta)
  const r56 = poly(xr, 20, 4, zeta)
  const r57 = xr[23] as number
  const r58 = poly(xr, 25, 4, zeta)
  const r59 = poly(xr, 29, 4, zeta)
  const r60 = poly(xr, 33, 4, zeta)
  const r61 = poly(xr, 37, 4, zeta)

  const breakMass =
    10 **
    Math.max(
      0.097 - 0.1072 * (lz + 3),
      Math.max(0.097, Math.min(0.1461, 0.1461 + 0.1237 * (lz + 2))),
    )
  const upper = breakMass + 0.1

  const a = new Array<number>(98).fill(0)

  // --- Luminosity alpha (xl 28-43) ---
  a[33] = poly(xl, 28, 4, zeta)
  a[34] = poly(xl, 32, 4, zeta)
  a[35] = poly(xl, 36, 4, zeta)
  a[36] = poly(xl, 40, 4, zeta)
  a[37] = Math.max(0.9, 1.1064 + zeta * (0.415 + 0.18 * zeta))
  a[38] = Math.max(1, 1.19 + zeta * (0.377 + 0.176 * zeta))
  if (z > 0.01) {
    a[37] = Math.min(a[37], 1)
    a[38] = Math.min(a[38], 1.1)
  }
  a[39] = Math.max(0.145, 0.0977 - zeta * (0.231 + 0.0753 * zeta))
  a[40] = Math.min(0.24 + zeta * (0.18 + 0.595 * zeta), 0.306 + 0.053 * zeta)
  a[41] = Math.min(0.33 + zeta * (0.132 + 0.218 * zeta), 0.3625 + 0.062 * zeta)
  a[42] = (a[33] + a[34] * 2 ** a[36]) / (2 ** 0.4 + a[35] * 2 ** 1.9)

  // --- Luminosity beta (xl 44-56) ---
  a[43] = poly(xl, 44, 5, zeta)
  a[44] = poly(xl, 49, 5, zeta)
  a[45] = poly(xl, 54, 3, zeta)
  a[46] = Math.max(0.6355 - 0.4192 * zeta, Math.max(1.25, Math.min(1.4, 1.5135 + 0.3769 * zeta)))

  // --- Luminosity hook (xl 57-72) ---
  a[47] = poly(xl, 57, 4, zeta)
  a[48] = poly(xl, 61, 4, zeta)
  a[49] = poly(xl, 65, 4, zeta)
  a[50] = poly(xl, 69, 4, zeta)
  a[51] = a[46]

  // --- Radius alpha (xr 41-64) ---
  a[65] = poly(xr, 41, 4, zeta)
  a[66] = poly(xr, 45, 4, zeta)
  a[67] = poly(xr, 49, 4, zeta)
  a[68] = poly(xr, 53, 4, zeta)
  a[69] = poly(xr, 57, 5, zeta)
  a[70] = Math.max(0.9, Math.min(1, 1.116 + 0.166 * zeta))
  a[71] = Math.max(1.477 + 0.296 * zeta, Math.min(1.6, -0.308 - 1.046 * zeta))
  a[71] = Math.max(0.8, Math.min(0.8 - 2 * zeta, a[71]))
  a[72] = poly(xr, 62, 3, zeta)
  a[73] = Math.max(0.065, 0.0843 - zeta * (0.0475 + 0.0352 * zeta))
  a[74] = 0.0736 + zeta * (0.0749 + 0.04426 * zeta)
  if (z < 0.004) a[74] = Math.min(0.055, a[74])
  a[75] = Math.max(0.091, Math.min(0.121, 0.136 + 0.0352 * zeta))
  a[76] = (a[65] * a[71] ** a[67]) / (a[66] + a[71] ** a[68])
  if (a[70] > a[71]) {
    a[70] = a[71]
    a[75] = a[76]
  }

  // --- Radius beta (xr 65-83) ---
  a[77] = poly(xr, 65, 4, zeta)
  a[78] = poly(xr, 69, 4, zeta)
  a[79] = poly(xr, 73, 4, zeta)
  a[80] = poly(xr, 77, 4, zeta)
  // Not a polynomial: the published form skips the linear term in ζ.
  a[81] = (xr[80] as number) + zeta * ((xr[81] as number) + zeta * zeta * (xr[82] as number))
  if (z > 0.01) a[81] = Math.max(a[81], 0.95)
  a[82] = Math.max(1.4, Math.min(1.6, 1.6 + zeta * (0.764 + 0.3322 * zeta)))

  // --- Radius gamma (xr 84-103) ---
  a[83] = Math.max(poly(xr, 84, 4, zeta), poly(xr, 96, 3, zeta))
  a[84] = Math.max(Math.min(0, poly(xr, 88, 4, zeta)), poly(xr, 99, 3, zeta))
  a[85] = Math.max(0, Math.min(poly(xr, 92, 4, zeta), 7.454 + 9.046 * zeta))
  a[86] = Math.min(
    (xr[101] as number) + zeta * (xr[102] as number),
    Math.max(2, -13.3 - 18.6 * zeta),
  )
  a[87] = Math.min(1.5, Math.max(0.4, 2.493 + 1.1475 * zeta))
  a[88] = Math.max(
    Math.max(1, Math.min(1.27, 0.8109 - 0.6282 * zeta)),
    0.6355 - 0.4192 * zeta,
  )
  a[89] = Math.max(5.85542e-2, -0.2711 - zeta * (0.5756 + 0.0838 * zeta))

  // --- Radius hook (xr 104-119) ---
  a[90] = poly(xr, 104, 4, zeta)
  a[91] = poly(xr, 108, 4, zeta)
  a[92] = poly(xr, 112, 4, zeta)
  a[93] = poly(xr, 116, 4, zeta)
  a[94] = Math.min(1.25, Math.max(1.1, 1.9848 + zeta * (1.1386 + 0.3564 * zeta)))
  a[95] = 0.063 + zeta * (0.0481 + 0.00984 * zeta)
  a[96] = Math.min(1.3, Math.max(0.45, 1.2 + 2.45 * zeta))

  // Ceiling on the luminosity exponent η.
  a[97] = z > 0.0009 ? 10 : 20

  return {
    lum,
    rad: [r52, r53, r54, r55, r56, r57, r58, r59, r60, r61] as const,
    radBreak: {
      mass: breakMass,
      low: (r52 + r53 * breakMass ** r55) / (r54 + breakMass ** r56),
      high: (r57 * upper ** 3 + r58 * upper ** r61 + r59 * upper ** (r61 + 1.5)) / (r60 + upper ** 5),
    },
    perturbation: a,
  }
}

/** Luminosity at the end of the main sequence. */
export function luminosityTAMS(
  mass: SolarMasses,
  coeff: MainSequenceCoefficients,
): SolarLuminosities {
  const m = mass
  const [a27, a28, a29, a30, a31, a32] = coeff.lum
  return solarLuminosities(
    (a27 * m ** 3 + a28 * m ** 4 + a29 * m ** (a32 + 1.8)) / (a30 + a31 * m ** 5 + m ** a32),
  )
}

/** Radius at the end of the main sequence, floored so it never drops below the ZAMS radius. */
export function radiusTAMS(
  mass: SolarMasses,
  coeff: MainSequenceCoefficients,
  zamsCoeff: ZamsCoefficients,
): SolarRadii {
  const m = mass
  const [a52, a53, a54, a55, a56, a57, a58, a59, a60, a61] = coeff.rad
  const { mass: breakMass, low, high } = coeff.radBreak
  const upper = breakMass + 0.1

  if (m <= breakMass) {
    const fit = (a52 + a53 * m ** a55) / (a54 + m ** a56)
    const floor = 1.5 * zamsProperties(mass, zamsCoeff).radius
    return solarRadii(Math.max(floor, fit))
  }

  if (m >= upper) {
    return solarRadii((a57 * m ** 3 + a58 * m ** a61 + a59 * m ** (a61 + 1.5)) / (a60 + m ** 5))
  }

  // Linear blend across the narrow gap between the two fits.
  return solarRadii(low + ((high - low) / 0.1) * (m - breakMass))
}

// --- Perturbation terms -----------------------------------------------------

/** α_L: the initial slope of log L against fractional main-sequence age. */
function alphaL(m: number, a: readonly number[]): number {
  if (m >= 2) {
    return ((a[33] as number) + (a[34] as number) * m ** (a[36] as number)) /
      (m ** 0.4 + (a[35] as number) * m ** 1.9)
  }
  if (m <= 0.5) return a[39] as number
  if (m <= 0.7) return (a[39] as number) + ((0.3 - (a[39] as number)) / 0.2) * (m - 0.5)
  if (m <= (a[37] as number)) {
    return 0.3 + (((a[40] as number) - 0.3) / ((a[37] as number) - 0.7)) * (m - 0.7)
  }
  if (m <= (a[38] as number)) {
    return (
      (a[40] as number) +
      (((a[41] as number) - (a[40] as number)) / ((a[38] as number) - (a[37] as number))) *
        (m - (a[37] as number))
    )
  }
  return (
    (a[41] as number) +
    (((a[42] as number) - (a[41] as number)) / (2 - (a[38] as number))) * (m - (a[38] as number))
  )
}

/** β_L: the high-order term that bends the early main sequence. */
function betaL(m: number, a: readonly number[]): number {
  let value = Math.max((a[43] as number) - (a[44] as number) * m ** (a[45] as number), 0)
  if (m > (a[46] as number) && value > 0) {
    const at = (a[43] as number) - (a[44] as number) * (a[46] as number) ** (a[45] as number)
    value = Math.max(at - 10 * at * (m - (a[46] as number)), 0)
  }
  return value
}

/** η: the exponent β_L is applied at. */
function etaL(m: number, a: readonly number[]): number {
  const value = m <= 1 ? 10 : m >= 1.1 ? 20 : 10 + 100 * (m - 1)
  return Math.min(value, a[97] as number)
}

/** Δ_L: depth of the luminosity dip produced by the convective-core hook. */
function deltaL(m: number, massHook: number, a: readonly number[]): number {
  if (m <= massHook) return 0
  if (m >= (a[51] as number)) {
    return Math.min(
      (a[47] as number) / m ** (a[48] as number),
      (a[49] as number) / m ** (a[50] as number),
    )
  }
  const at = Math.min(
    (a[47] as number) / (a[51] as number) ** (a[48] as number),
    (a[49] as number) / (a[51] as number) ** (a[50] as number),
  )
  return at * ((m - massHook) / ((a[51] as number) - massHook)) ** 0.4
}

/** α_R: the initial slope of log R against fractional main-sequence age. */
function alphaR(m: number, a: readonly number[]): number {
  if (m <= 0.5) return a[73] as number
  if (m <= 0.65) {
    return (a[73] as number) + (((a[74] as number) - (a[73] as number)) / 0.15) * (m - 0.5)
  }
  if (m <= (a[70] as number)) {
    return (
      (a[74] as number) +
      (((a[75] as number) - (a[74] as number)) / ((a[70] as number) - 0.65)) * (m - 0.65)
    )
  }
  if (m <= (a[71] as number)) {
    return (
      (a[75] as number) +
      (((a[76] as number) - (a[75] as number)) / ((a[71] as number) - (a[70] as number))) *
        (m - (a[70] as number))
    )
  }
  const fit = (x: number) =>
    ((a[65] as number) * x ** (a[67] as number)) / ((a[66] as number) + x ** (a[68] as number))
  if (m <= (a[72] as number)) return fit(m)
  return fit(a[72] as number) + (a[69] as number) * (m - (a[72] as number))
}

/** β_R: the τ¹⁰ term. */
function betaR(m: number, a: readonly number[]): number {
  const fit = (x: number) =>
    ((a[77] as number) * x ** 3.5) / ((a[78] as number) + x ** (a[79] as number))

  let value: number
  if (m <= 1) value = 1.06
  else if (m <= (a[82] as number)) {
    value = 1.06 + (((a[81] as number) - 1.06) / ((a[82] as number) - 1)) * (m - 1)
  } else if (m <= 2) {
    value =
      (a[81] as number) + ((fit(2) - (a[81] as number)) / (2 - (a[82] as number))) * (m - (a[82] as number))
  } else if (m <= 16) value = fit(m)
  else value = fit(16) + (a[80] as number) * (m - 16)

  return value - 1
}

/** γ_R: the τ⁴⁰ term, which only bites at low mass. */
function gammaR(m: number, a: readonly number[]): number {
  if (m > (a[88] as number) + 0.1) return 0

  const atOne = Math.max(
    0,
    (a[83] as number) + (a[84] as number) * (1 - (a[85] as number)) ** (a[86] as number),
  )

  let value: number
  if (m <= 1) {
    value =
      (a[83] as number) + (a[84] as number) * Math.abs(m - (a[85] as number)) ** (a[86] as number)
  } else if (m <= (a[88] as number)) {
    value =
      atOne +
      ((a[89] as number) - atOne) * ((m - 1) / ((a[88] as number) - 1)) ** (a[87] as number)
  } else {
    const base = (a[88] as number) > 1 ? (a[89] as number) : atOne
    value = base - 10 * base * (m - (a[88] as number))
  }

  return Math.max(value, 0)
}

/** Δ_R: size of the radius contraction produced by the hook. */
function deltaR(m: number, massHook: number, a: readonly number[]): number {
  if (m <= massHook) return 0

  const fit = (x: number) =>
    ((a[90] as number) + (a[91] as number) * x ** 3.5) /
      ((a[92] as number) * x ** 3 + x ** (a[93] as number)) -
    1

  if (m <= (a[94] as number)) {
    return (a[95] as number) * Math.sqrt((m - massHook) / ((a[94] as number) - massHook))
  }
  if (m <= 2) {
    return (
      (a[95] as number) +
      (fit(2) - (a[95] as number)) *
        ((m - (a[94] as number)) / (2 - (a[94] as number))) ** (a[96] as number)
    )
  }
  return fit(m)
}

export interface MainSequenceState {
  readonly luminosity: number
  readonly radius: number
}

/**
 * Luminosity and radius partway along the main sequence.
 *
 * `age` and `hookTime` are in the same unit; only their ratio to `lifetime` matters. The hook window
 * is the last per cent of `hookTime`, which is why τ₂ is scaled by ε — the contraction switches on
 * over the approach and off again sharply at the end.
 */
export function mainSequenceState(
  mass: SolarMasses,
  age: number,
  lifetime: number,
  hookTime: number,
  massHook: number,
  zams: MainSequenceState,
  tams: MainSequenceState,
  coeff: MainSequenceCoefficients,
): MainSequenceState {
  const a = coeff.perturbation
  const m = mass
  const tau = lifetime > 0 ? clamp(age / lifetime, 0, 1) : 1

  const epsilon = 0.01
  const tau1 = hookTime > 0 ? Math.min(1, age / hookTime) : 1
  const tau2 =
    hookTime > 0
      ? clamp((age - (1 - epsilon) * hookTime) / (epsilon * hookTime), 0, 1)
      : 1

  const logL = Math.log10(tams.luminosity / zams.luminosity)
  const aL = alphaL(m, a)
  const bL = betaL(m, a)
  const nL = etaL(m, a)
  const dL = deltaL(m, massHook, a)
  const exponentL =
    aL * tau + bL * tau ** nL + (logL - aL - bL) * tau ** 2 - dL * (tau1 ** 2 - tau2 ** 2)

  const logR = Math.log10(tams.radius / zams.radius)
  const aR = alphaR(m, a)
  const bR = betaR(m, a)
  const gR = gammaR(m, a)
  const dR = deltaR(m, massHook, a)
  const exponentR =
    aR * tau +
    bR * tau ** 10 +
    gR * tau ** 40 +
    (logR - aR - bR - gR) * tau ** 3 -
    dR * (tau1 ** 3 - tau2 ** 3)

  return {
    luminosity: zams.luminosity * 10 ** exponentL,
    radius: zams.radius * 10 ** exponentR,
  }
}
