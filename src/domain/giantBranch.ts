import coefficients from '../data/sse-coefficients.json' with { type: 'json' }
import { SOLAR_METALLICITY, type Metallicity } from './metallicity.js'
import { timeToBGB, type TimescaleCoefficients } from './timescales.js'
import { solarMasses, type SolarMasses } from './units.js'

/*
 * Giant branch, core helium burning and AGB. Hurley, Pols & Tout (2000) sections 5-7.
 *
 * The organising idea, and the reason this module exists at all: past the main sequence a star's
 * luminosity is set by its **core mass**, not by its envelope. L = min(B·Mc^q, D·Mc^p) is a function
 * of core mass alone. The engine previously anchored the giant branch to L_TMS × 25 — a
 * main-sequence, and therefore envelope, quantity — which is why its error changed sign with mass:
 * ~50x too faint at 1 M☉ and fifteen times Eddington at 30 M☉.
 *
 * The `gbp` block below is deliberately kept as a **1-based indexed array** rather than named
 * fields. There are 77 slots feeding thirteen different fits, several of which are raised to powers
 * of each other during assembly and five of which are finished only after other fits can be
 * evaluated. Renaming them one by one is the single most likely way to introduce a silent
 * off-by-one, and the published indexing is itself the clearest documentation of which constant
 * belongs where. Index ranges are commented by role instead.
 */

const xg = coefficients.xg
const xh = coefficients.xh

/** Horner evaluation of `terms` consecutive constants as a polynomial in ζ. 1-based `first`. */
function poly(table: readonly number[], first: number, terms: number, zeta: number): number {
  let value = 0
  for (let i = terms - 1; i >= 0; i--) value = value * zeta + (table[first - 1 + i] as number)
  return value
}

/** Mass thresholds that partition the post-main-sequence into its three regimes. */
export interface MassThresholds {
  /** M_HeF — above this, helium ignites non-degenerately, so there is no helium flash. */
  readonly heliumFlash: number
  /** M_FGB — above this, helium ignites in the Hertzsprung gap and there is no first giant branch. */
  readonly firstGiantBranch: number
  /** M_up — below this, carbon never ignites. */
  readonly carbonIgnition: number
  /** M_ec — above this, carbon ignites in the centre and the star is bound for core collapse. */
  readonly centralCarbon: number
}

export interface GiantBranchCoefficients {
  /** 1-based; index 0 is unused padding. */
  readonly gbp: readonly number[]
  readonly thresholds: MassThresholds
  /** log D for M ≤ M_FGB, the low-luminosity branch of the core-mass–luminosity relation. */
  readonly logD: number
  /** Exponent x in R_GB ∝ M^−x. */
  readonly radiusExponent: number
  /** Core mass at the base of the giant branch for a star at M_HeF. */
  readonly coreMassBGB: number
  /** Core mass at helium ignition for a star at M_HeF. */
  readonly coreMassHeI: number
}

/**
 * Core-mass–luminosity parameters for one mass.
 *
 * `p`/`q` and `D`/`B` are the two branches of L(Mc); they cross at `massX`, above which the shallower
 * branch takes over. `aH`, `aHe` and `aHHe` are the fuel-burning efficiencies that turn luminosity
 * into core growth on the giant branch, the early AGB and the thermally pulsing AGB respectively.
 */
export interface CoreLuminosity {
  readonly aH: number
  readonly aHe: number
  readonly aHHe: number
  readonly b: number
  readonly d: number
  readonly p: number
  readonly q: number
  readonly massX: number
  readonly luminosityX: number
}

const SOLAR_RADIUS_EXPONENT = [
  3.040581e-1, 8.049509e-2, 8.967485e-2, 8.780198e-2, 2.21917e-2,
] as const

export function giantBranchCoefficients(
  metallicity: Metallicity,
  timescales: TimescaleCoefficients,
): GiantBranchCoefficients {
  const z = metallicity
  const zeta = Math.log10(z / SOLAR_METALLICITY)
  const lz = Math.log10(z)
  // Offset used by the blue-loop fits, which are anchored at a tenth of solar rather than at solar.
  const lzd = zeta + 1

  const heliumFlash = 1.995 + zeta * (0.25 + zeta * 0.087)
  const firstGiantBranch = (16.5 * z ** 0.06) / (1 + (1e-4 / z) ** 1.27)
  const carbonIgnition = Math.max(6.11044 + 1.02167 * zeta, 5)

  const thresholds: MassThresholds = {
    heliumFlash,
    firstGiantBranch,
    carbonIgnition,
    centralCarbon: carbonIgnition + 1.8,
  }

  const logD = 5.37 + zeta * 0.135
  const radiusExponent = SOLAR_RADIUS_EXPONENT.reduce(
    (acc, c, i) => acc + c * zeta ** i,
    0,
  )

  const g = new Array<number>(78).fill(0)

  // --- L_BGB, luminosity at the base of the giant branch (xg 1-24) ---
  g[1] = poly(xg, 1, 4, zeta)
  g[2] = poly(xg, 5, 4, zeta)
  g[3] = poly(xg, 9, 4, zeta)
  g[4] = poly(xg, 13, 4, zeta)
  g[5] = poly(xg, 17, 3, zeta)
  g[6] = poly(xg, 20, 3, zeta)
  g[3] = g[3] ** g[6]
  g[7] = xg[22] as number
  g[8] = xg[23] as number

  // --- L_BAGB, luminosity at the base of the AGB ---
  g[9] = poly(xg, 25, 3, zeta)
  g[10] = poly(xg, 28, 3, zeta)
  g[11] = 15
  g[12] = poly(xg, 31, 4, zeta)
  g[13] = poly(xg, 35, 4, zeta)
  g[14] = poly(xg, 39, 4, zeta)
  g[15] = poly(xg, 43, 2, zeta)
  g[12] = g[12] ** g[15]
  g[14] = g[14] ** g[15]
  g[16] = 1 // placeholder; finished below once L_BAGB can be evaluated at M_HeF

  // --- R_GB, radius on the giant branch (xg 45-66) ---
  g[17] = Math.min(
    Math.max(10 ** (-4.6739 - 0.9394 * lz), -0.04167 + 55.67 * z),
    0.4771 - 9329.21 * z ** 2.94,
  )
  g[18] = Math.min(0.54, 0.397 + zeta * (0.28826 + 0.5293 * zeta))
  g[19] = 10 ** Math.max(-0.1451, -2.2794 - lz * (1.5175 + 0.254 * lz))
  if (z > 0.004) g[19] = Math.max(g[19], 0.7307 + 14265.1 * z ** 3.395)
  g[20] = poly(xg, 45, 6, zeta)
  g[21] = poly(xg, 51, 5, zeta)
  g[22] = poly(xg, 56, 6, zeta)
  g[23] = poly(xg, 62, 4, zeta)

  // --- R_AGB (xg 67-100) ---
  g[24] = Math.min(0.99164 - 743.123 * z ** 2.83, 1.0422 + zeta * (0.13156 + 0.045 * zeta))
  g[25] = poly(xg, 67, 6, zeta)
  g[26] = poly(xg, 73, 5, zeta)
  g[27] = poly(xg, 78, 6, zeta)
  g[28] = poly(xg, 84, 5, zeta)
  g[29] = poly(xg, 89, 6, zeta)
  g[30] = poly(xg, 95, 6, zeta)
  const belowFlash = heliumFlash - 0.2
  g[31] = g[29] + g[30] * belowFlash
  g[32] = Math.min(g[25] / heliumFlash ** g[26], g[27] / heliumFlash ** g[28])

  // --- Core mass at helium ignition and at the base of the AGB (xg 101-112) ---
  g[33] = (xg[100] as number) ** 4
  g[34] = (xg[101] as number) * 4
  g[35] = poly(xg, 103, 4, zeta) ** 4
  g[36] = poly(xg, 107, 4, zeta) * 4
  g[37] = poly(xg, 111, 2, zeta) ** 4

  // --- L_HeI, helium ignition luminosity (xh 1-14) ---
  g[38] = (xh[0] as number) + zeta * (xh[1] as number)
  g[39] = (xh[2] as number) + zeta * (xh[3] as number)
  g[40] = xh[4] as number
  g[41] = -1 // placeholder; finished below
  g[42] = poly(xh, 6, 3, zeta) ** 2
  g[43] = poly(xh, 9, 3, zeta)
  g[44] = poly(xh, 12, 3, zeta) ** 2

  // --- L_He, the minimum core-helium-burning luminosity as a fraction of L_HeI (xh 15-25) ---
  g[45] = poly(xh, 15, 3, zeta)
  g[46] = zeta > -1 ? 1 - (xh[18] as number) * (zeta + 1) ** (xh[17] as number) : 1
  g[47] = poly(xh, 20, 3, zeta)
  g[48] = poly(xh, 23, 3, zeta)
  g[45] = g[45] ** g[48]
  g[47] = g[47] ** g[48]
  g[46] =
    g[46] / firstGiantBranch ** 0.1 +
    (g[46] * g[47] - g[45]) / firstGiantBranch ** (g[48] + 0.1)

  // --- R_min, the minimum radius during helium burning: the blue loop (xh 26-43) ---
  g[49] = poly(xh, 26, 4, zeta)
  g[50] = poly(xh, 30, 4, zeta)
  g[51] = poly(xh, 34, 4, zeta)
  g[52] = 5 + (xh[37] as number) * z ** (xh[38] as number)
  g[53] = poly(xh, 40, 4, zeta)
  g[49] = g[49] ** g[53]
  g[51] = g[51] ** (2 * g[53])

  // --- t_He, the core-helium-burning lifetime (xh 44-65) ---
  g[54] = poly(xh, 44, 4, zeta)
  g[55] = Math.max(poly(xh, 48, 3, zeta), 1)
  g[56] = xh[50] as number
  g[57] = -1 // placeholder; finished below
  g[58] = poly(xh, 52, 4, zeta)
  g[59] = poly(xh, 56, 4, zeta)
  g[60] = poly(xh, 60, 4, zeta) ** 5
  g[61] = (xh[63] as number) + zeta * (xh[64] as number)
  g[58] = g[58] ** g[61]

  // --- Blue-loop fraction of the helium-burning lifetime (xh 66-79) ---
  const flashRatio = heliumFlash / firstGiantBranch
  g[62] = -((xh[65] as number) + zeta * (xh[66] as number)) * Math.log10(flashRatio)
  g[63] = xh[67] as number
  g[64] =
    lzd > 0 ? 1 - lzd * ((xh[68] as number) + lzd * ((xh[69] as number) + lzd * (xh[70] as number))) : 1
  g[65] = 1 - g[64] * flashRatio ** g[63]
  g[66] =
    1 - lzd * ((xh[76] as number) + lzd * ((xh[77] as number) + lzd * (xh[78] as number)))
  g[67] = poly(xh, 72, 4, zeta)
  g[68] = xh[75] as number

  // --- L_ZAHB and R_ZAHB, the zero-age horizontal branch (xh 80-99) ---
  g[69] = poly(xh, 80, 3, zeta)
  g[70] = poly(xh, 83, 3, zeta)
  g[71] = 15
  g[72] = xh[85] as number
  g[73] = xh[86] as number
  g[75] = poly(xh, 88, 4, zeta)
  g[76] = poly(xh, 92, 4, zeta)
  g[77] = poly(xh, 96, 4, zeta)

  /*
   * Five coefficients are self-referential: they exist to force continuity between the low-mass and
   * intermediate-mass branches of their own fit, so they can only be computed once the rest of the
   * block evaluates. The order below matters — g[41] needs L_HeI at M_HeF, which needs g[42..44].
   */
  const draft: GiantBranchCoefficients = {
    gbp: g,
    thresholds,
    logD,
    radiusExponent,
    coreMassBGB: 0,
    coreMassHeI: 0,
  }

  // A helium-flash mass evaluated against a zero threshold always takes the intermediate-mass
  // branch, which is exactly the continuity anchor each of these needs.
  const anchor = solarMasses(heliumFlash)
  g[16] = luminosityBAGB(anchor, { ...draft, thresholds: { ...thresholds, heliumFlash: 0 } })

  const heIAtFlash =
    (g[42] + g[43] * heliumFlash ** 3.8) / (g[44] + heliumFlash ** 2)
  g[41] = (g[38] * heliumFlash ** g[39] - heIAtFlash) / (Math.exp(heliumFlash * g[40]) * heIAtFlash)

  /*
   * Above M_HeF the helium-burning fit returns a *fraction of t_BGB*, while below it the fit returns
   * an absolute time in Myr. The continuity anchor therefore has to convert, and `timeToBGB` is in
   * Gyr — hence the factor of 1000. Getting this wrong scales every low-mass horizontal branch by
   * a thousand and is invisible in any test that only checks monotonicity.
   */
  const heBurningFraction =
    (g[58] * heliumFlash ** g[61] + g[59] * heliumFlash ** 5) / (g[60] + heliumFlash ** 5)
  const heBurningAtFlash = heBurningFraction * timeToBGB(anchor, timescales) * 1000
  g[57] = (heBurningAtFlash - g[54]) / (g[54] * Math.exp(g[56] * heliumFlash))

  const fgb = solarMasses(firstGiantBranch)
  const agbRadius = radiusAGB(fgb, luminosityHeI(fgb, draft), {
    ...draft,
    thresholds: { ...thresholds, heliumFlash: 0 },
  })
  const loopDepth = Math.max(1 - radiusMinimum(fgb, draft) / agbRadius, 1e-12)
  g[66] = g[66] / (firstGiantBranch ** g[67] * loopDepth ** g[68])

  g[74] = heIAtFlash * luminosityHeRatio(anchor, draft)

  // Core masses at M_HeF, the continuity anchors for the intermediate-mass core-mass fits.
  const core = coreLuminosity(anchor, draft)
  const finished: GiantBranchCoefficients = {
    gbp: g,
    thresholds,
    logD,
    radiusExponent,
    coreMassBGB: coreMassFromLuminosity(luminosityBGB(anchor, draft), core),
    coreMassHeI: coreMassFromLuminosity(heIAtFlash, core),
  }

  return finished
}

// --- Core-mass–luminosity relation -----------------------------------------

/**
 * The two-branch core-mass–luminosity relation, plus the fuel-burning efficiencies.
 *
 * `p` and `q` steepen below 2.5 M☉ because the core is degenerate there. The transition between
 * them is linear across 2.0-2.5 M☉ rather than a step, so nothing lurches at the boundary.
 */
export function coreLuminosity(
  mass: SolarMasses,
  coeff: GiantBranchCoefficients,
): CoreLuminosity {
  const m = mass
  const { logD } = coeff

  const aH = 10 ** Math.max(-4.8, Math.min(-5.7 + 0.8 * m, -4.1 + 0.14 * m))
  const b = Math.max(3.0e4, 500 + 1.75e4 * m ** 0.6)

  let logDm: number
  let p: number
  let q: number
  if (m <= 2) {
    logDm = logD
    p = 6
    q = 3
  } else if (m < 2.5) {
    const dx = logD - (0.975 * logD - 0.18 * 2.5)
    logDm = logD - (dx * (m - 2)) / 0.5
    p = 6 - (m - 2) / 0.5
    q = 3 - (m - 2) / 0.5
  } else {
    logDm = Math.max(-1, Math.max(0.5 * logD - 0.06 * m, 0.975 * logD - 0.18 * m))
    p = 5
    q = 2
  }

  const d = 10 ** logDm
  const massX = (b / d) ** (1 / (p - q))

  return {
    aH,
    // Helium burning on the early AGB, and the combined H+He shell rate on the thermally
    // pulsing AGB. Hurley section 7.
    aHe: 8.0e-5,
    aHHe: 1.27e-5,
    b,
    d,
    p,
    q,
    massX,
    luminosityX: d * massX ** p,
  }
}

export const luminosityFromCoreMass = (coreMass: number, core: CoreLuminosity): number =>
  coreMass <= core.massX ? core.d * coreMass ** core.p : core.b * coreMass ** core.q

export const coreMassFromLuminosity = (luminosity: number, core: CoreLuminosity): number =>
  luminosity <= core.luminosityX
    ? (luminosity / core.d) ** (1 / core.p)
    : (luminosity / core.b) ** (1 / core.q)

/**
 * The `t_inf` machinery.
 *
 * Core growth on a shell-burning branch obeys dMc/dt = A·L(Mc), which integrates to a power law
 * that diverges at a finite time `tInf`. Because L(Mc) has two branches, so does the integral: one
 * constant of integration for each, meeting at `tX`. Age then maps to core mass in closed form,
 * which is what makes the whole track analytic rather than something that has to be stepped.
 */
export interface ShellTimescales {
  readonly tInf1: number
  readonly tX: number
  readonly tInf2: number
}

export function shellTimescales(
  start: number,
  startLuminosity: number,
  rate: number,
  core: CoreLuminosity,
): ShellTimescales {
  const { b, d, p, q, luminosityX } = core

  /*
   * Which branch the star starts on matters. The usual case begins below the crossing, on the steep
   * branch, and passes through it partway along. But a phase can also *begin* above the crossing —
   * the thermally pulsing AGB does, because second dredge-up hands it a core already past Mx — and
   * then the star is on the shallow branch for the whole phase. Anchoring such a phase with the
   * steep-branch integral puts its starting luminosity in the wrong place, which shows up as a step
   * at the phase boundary rather than as anything obviously wrong inside it.
   */
  if (startLuminosity > luminosityX) {
    return {
      tInf1: start,
      tX: start,
      tInf2: start + (1 / ((q - 1) * rate * b)) * (b / startLuminosity) ** ((q - 1) / q),
    }
  }

  const tInf1 = start + (1 / ((p - 1) * rate * d)) * (d / startLuminosity) ** ((p - 1) / p)
  const tX = tInf1 - (tInf1 - start) * (startLuminosity / luminosityX) ** ((p - 1) / p)
  const tInf2 = tX + (1 / ((q - 1) * rate * b)) * (b / luminosityX) ** ((q - 1) / q)

  return { tInf1, tX, tInf2 }
}

/** Luminosity at a given age on a shell-burning branch. */
export function luminosityAtAge(
  age: number,
  rate: number,
  core: CoreLuminosity,
  t: ShellTimescales,
): number {
  const { b, d, p, q } = core
  return age < t.tX
    ? d * ((p - 1) * rate * d * (t.tInf1 - age)) ** (p / (1 - p))
    : b * ((q - 1) * rate * b * (t.tInf2 - age)) ** (q / (1 - q))
}

/** Core mass at a given age on a shell-burning branch. */
export function coreMassAtAge(
  age: number,
  rate: number,
  core: CoreLuminosity,
  t: ShellTimescales,
): number {
  const { b, d, p, q } = core
  return age < t.tX
    ? ((p - 1) * rate * d * (t.tInf1 - age)) ** (1 / (1 - p))
    : ((q - 1) * rate * b * (t.tInf2 - age)) ** (1 / (1 - q))
}

/** Age at which a shell-burning branch reaches a given core mass. */
export function ageAtCoreMass(
  coreMass: number,
  rate: number,
  core: CoreLuminosity,
  t: ShellTimescales,
): number {
  const { b, d, p, q, massX } = core
  return coreMass <= massX
    ? t.tInf1 - (1 / ((p - 1) * rate * d)) * coreMass ** (1 - p)
    : t.tInf2 - (1 / ((q - 1) * rate * b)) * coreMass ** (1 - q)
}

/** Age at which a shell-burning branch reaches a given luminosity. */
export function ageAtLuminosity(
  luminosity: number,
  rate: number,
  core: CoreLuminosity,
  t: ShellTimescales,
): number {
  const { b, d, p, q, luminosityX } = core
  return luminosity <= luminosityX
    ? t.tInf1 - (1 / ((p - 1) * rate * d)) * (d / luminosity) ** ((p - 1) / p)
    : t.tInf2 - (1 / ((q - 1) * rate * b)) * (b / luminosity) ** ((q - 1) / q)
}

// --- Luminosity fits --------------------------------------------------------

/** Luminosity at the base of the giant branch. Only meaningful below M_FGB. */
export function luminosityBGB(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const m = mass
  const a = coeff.gbp
  return (
    ((a[1] as number) * m ** (a[5] as number) + (a[2] as number) * m ** (a[8] as number)) /
    ((a[3] as number) + (a[4] as number) * m ** (a[7] as number) + m ** (a[6] as number))
  )
}

/** Luminosity at helium ignition. */
export function luminosityHeI(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const m = mass
  const a = coeff.gbp
  if (m < coeff.thresholds.heliumFlash) {
    return (
      ((a[38] as number) * m ** (a[39] as number)) /
      (1 + (a[41] as number) * Math.exp(m * (a[40] as number)))
    )
  }
  return ((a[42] as number) + (a[43] as number) * m ** 3.8) / ((a[44] as number) + m ** 2)
}

/** Ratio L_He,min / L_HeI. Everywhere ≤ 1, and only valid for intermediate-mass stars. */
export function luminosityHeRatio(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const m = mass
  const a = coeff.gbp
  return (
    ((a[45] as number) + (a[46] as number) * m ** ((a[48] as number) + 0.1)) /
    ((a[47] as number) + m ** (a[48] as number))
  )
}

/** Luminosity at the base of the AGB. */
export function luminosityBAGB(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const m = mass
  const a = coeff.gbp
  const flash = coeff.thresholds.heliumFlash
  const shift =
    ((a[9] as number) * flash ** (a[10] as number) - (a[16] as number)) /
    (Math.exp(flash * (a[11] as number)) * (a[16] as number))

  if (m < flash) {
    return ((a[9] as number) * m ** (a[10] as number)) / (1 + shift * Math.exp(m * (a[11] as number)))
  }
  return (
    ((a[12] as number) + (a[13] as number) * m ** ((a[15] as number) + 1.8)) /
    ((a[14] as number) + m ** (a[15] as number))
  )
}

/** Zero-age horizontal branch luminosity, for stars that ignite helium degenerately. */
export function luminosityZAHB(
  mass: SolarMasses,
  coreMass: number,
  coeff: GiantBranchCoefficients,
): number {
  const a = coeff.gbp
  const flash = coeff.thresholds.heliumFlash
  const heliumZAMS = luminosityHeliumZAMS(coreMass)
  const shift =
    ((a[69] as number) + heliumZAMS - (a[74] as number)) /
    (((a[74] as number) - heliumZAMS) * Math.exp((a[71] as number) * flash))
  const envelope = Math.max((mass - coreMass) / (flash - coreMass), 1e-12)

  return (
    heliumZAMS +
    ((1 + (a[72] as number)) * (a[69] as number) * envelope ** (a[70] as number)) /
      ((1 + (a[72] as number) * envelope ** (a[73] as number)) *
        (1 + shift * Math.exp(mass * (a[71] as number))))
  )
}

/** Naked helium star zero-age luminosity — the limit a horizontal branch star tends to. */
export const luminosityHeliumZAMS = (mass: number): number =>
  (1.5262e4 * mass ** (41 / 4)) /
  (0.0469 + mass ** 6 * (31.18 + mass ** 1.5 * (29.54 + mass ** 1.5)))

/** Naked helium star zero-age radius. */
export const radiusHeliumZAMS = (mass: number): number =>
  (0.2391 * mass ** 4.6) / (0.0065 + (0.162 + mass) * mass ** 3)

// --- Radius fits ------------------------------------------------------------

/** Radius on the giant branch, as a function of luminosity. */
export function radiusGB(
  mass: SolarMasses,
  luminosity: number,
  coeff: GiantBranchCoefficients,
): number {
  const m = mass
  const a = coeff.gbp
  const scale = Math.min(
    (a[20] as number) / m ** (a[21] as number),
    (a[22] as number) / m ** (a[23] as number),
  )
  return scale * (luminosity ** (a[18] as number) + (a[17] as number) * luminosity ** (a[19] as number))
}

/** Radius on the AGB. Wider than R_GB at the same luminosity, and mass-dependent near M_HeF. */
export function radiusAGB(
  mass: SolarMasses,
  luminosity: number,
  coeff: GiantBranchCoefficients,
): number {
  const m = mass
  const a = coeff.gbp
  const flash = coeff.thresholds.heliumFlash
  const lower = flash - 0.2

  const blend = m >= flash ? (a[24] as number) : m >= lower ? 1 + 5 * ((a[24] as number) - 1) * (m - lower) : 1
  const exponent = blend * (a[19] as number)

  const scale =
    m <= lower
      ? (a[29] as number) + (a[30] as number) * m
      : m >= flash
        ? Math.min((a[25] as number) / m ** (a[26] as number), (a[27] as number) / m ** (a[28] as number))
        : (a[31] as number) + 5 * ((a[32] as number) - (a[31] as number)) * (m - lower)

  return scale * (luminosity ** (a[18] as number) + (a[17] as number) * luminosity ** exponent)
}

/** Minimum radius reached during core helium burning — the blue end of the loop. */
export function radiusMinimum(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const m = mass
  const a = coeff.gbp
  const mx = m ** (a[53] as number)
  return (
    ((a[49] as number) * m + ((a[50] as number) * m) ** (a[52] as number) * mx) /
    ((a[51] as number) + mx)
  )
}

/** Zero-age horizontal branch radius. */
export function radiusZAHB(
  mass: SolarMasses,
  coreMass: number,
  coeff: GiantBranchCoefficients,
): number {
  const a = coeff.gbp
  const flash = coeff.thresholds.heliumFlash
  const compact = radiusHeliumZAMS(coreMass)
  const giant = radiusGB(mass, luminosityZAHB(mass, coreMass, coeff), coeff)
  const envelope = Math.max((mass - coreMass) / (flash - coreMass), 1e-12)
  const blend =
    ((1 + (a[76] as number)) * envelope ** (a[75] as number)) /
    (1 + (a[76] as number) * envelope ** (a[77] as number))
  return (1 - blend) * compact + blend * giant
}

// --- Core mass fits ---------------------------------------------------------

/** Core mass at the base of the AGB. */
export function coreMassBAGB(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const a = coeff.gbp
  return ((a[37] as number) + (a[35] as number) * mass ** (a[36] as number)) ** 0.25
}

/** Core mass at helium ignition, for stars that ignite it non-degenerately. */
export function coreMassHeIgnition(
  mass: SolarMasses,
  anchor: number,
  coeff: GiantBranchCoefficients,
): number {
  const a = coeff.gbp
  const flash = coeff.thresholds.heliumFlash
  const offset = anchor ** 4 - (a[33] as number) * flash ** (a[34] as number)
  return Math.min(
    0.95 * coreMassBAGB(mass, coeff),
    (offset + (a[33] as number) * mass ** (a[34] as number)) ** 0.25,
  )
}

/** Core mass at the end of the main sequence, as a fraction of the base-of-giant-branch value. */
export const coreMassFractionTAMS = (mass: SolarMasses): number => {
  const m525 = mass ** (21 / 4)
  return (1.586 + m525) / (2.434 + 1.02 * m525)
}

// --- Helium burning ---------------------------------------------------------

/** Naked helium star main-sequence lifetime, in Myr. */
export const heliumMainSequenceLifetime = (mass: number): number =>
  (0.4129 + 18.81 * mass ** 4 + 1.853 * mass ** 6) / mass ** 6.5

/**
 * Core-helium-burning lifetime.
 *
 * Below M_HeF this is an absolute time in Myr; above it, it is a fraction of t_BGB. That asymmetry
 * is Hurley's, and it is why callers have to know which regime they are in.
 */
export function heliumBurningTime(
  mass: SolarMasses,
  coreMass: number,
  coeff: GiantBranchCoefficients,
): number {
  const m = mass
  const a = coeff.gbp
  const flash = coeff.thresholds.heliumFlash

  if (m <= flash) {
    const envelope = Math.max((flash - m) / (flash - coreMass), 1e-12)
    return (
      ((a[54] as number) +
        (heliumMainSequenceLifetime(coreMass) - (a[54] as number)) * envelope ** (a[55] as number)) *
      (1 + (a[57] as number) * Math.exp(m * (a[56] as number)))
    )
  }

  const m5 = m ** 5
  return ((a[58] as number) * m ** (a[61] as number) + (a[59] as number) * m5) / ((a[60] as number) + m5)
}

/**
 * Fraction of the helium-burning lifetime spent on the blue loop.
 *
 * This is what makes intermediate-mass stars leave the giant branch, cross to the blue and come
 * back, rather than sitting at the red edge for the whole of helium burning.
 */
export function blueLoopFraction(mass: SolarMasses, coeff: GiantBranchCoefficients): number {
  const m = mass
  const a = coeff.gbp
  const { heliumFlash, firstGiantBranch } = coeff.thresholds

  let value: number
  if (m <= firstGiantBranch) {
    const ratio = m / firstGiantBranch
    const logRatio = Math.max(
      Math.log10(ratio) / Math.log10(heliumFlash / firstGiantBranch),
      1e-12,
    )
    value = (a[64] as number) * ratio ** (a[63] as number) + (a[65] as number) * logRatio ** (a[62] as number)
  } else {
    const depth = Math.max(1 - radiusMinimum(mass, coeff) / radiusAGB(mass, luminosityHeI(mass, coeff), coeff), 1e-12)
    value = (a[66] as number) * m ** (a[67] as number) * depth ** (a[68] as number)
  }

  const clamped = Math.min(1, Math.max(0, value))
  return clamped < 1e-10 ? 0 : clamped
}
