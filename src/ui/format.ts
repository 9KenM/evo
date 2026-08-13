const AU_IN_SOLAR_RADII = 215.03
const KM_IN_SOLAR_RADII = 1 / 695700

export function num(value: number, unit = ''): string {
  const abs = Math.abs(value)
  const text =
    abs === 0
      ? '0'
      : abs < 1e-3 || abs >= 1e5
        ? value.toExponential(2)
        : abs < 1
          ? value.toPrecision(3)
          : value.toFixed(abs < 100 ? 2 : 0)
  return unit ? `${text} ${unit}` : text
}

/** Ages span from kiloyears to hundreds of Gyr, so the unit follows the magnitude. */
export function formatAge(gyrValue: number): string {
  if (gyrValue < 1e-6) return `${num(gyrValue * 1e9)} yr`
  if (gyrValue < 1e-3) return `${num(gyrValue * 1e6)} kyr`
  if (gyrValue < 1) return `${num(gyrValue * 1e3)} Myr`
  return `${num(gyrValue)} Gyr`
}

/** Compact age label for axis ticks — no decimals, since ticks land on round values. */
export function formatAgeTick(gyrValue: number): string {
  const pick = (scaled: number, unit: string) => {
    const rounded = scaled >= 100 ? Math.round(scaled) : Number(scaled.toPrecision(2))
    return `${rounded} ${unit}`
  }
  if (gyrValue < 1e-6) return pick(gyrValue * 1e9, 'yr')
  if (gyrValue < 1e-3) return pick(gyrValue * 1e6, 'kyr')
  if (gyrValue < 1) return pick(gyrValue * 1e3, 'Myr')
  return pick(gyrValue, 'Gyr')
}

/** Lengths span from neutron-star kilometres to supergiant AU. */
export function formatLength(solarRadii: number): string {
  if (solarRadii >= AU_IN_SOLAR_RADII) return `${num(solarRadii / AU_IN_SOLAR_RADII)} AU`
  if (solarRadii < 0.01) return `${num(solarRadii / KM_IN_SOLAR_RADII)} km`
  return `${num(solarRadii)} R☉`
}

/** Unit a length is best expressed in, with the divisor to reach it. */
export function lengthUnit(solarRadii: number): { unit: string; scale: number } {
  if (solarRadii >= AU_IN_SOLAR_RADII) return { unit: 'AU', scale: AU_IN_SOLAR_RADII }
  if (solarRadii < 0.01) return { unit: 'km', scale: KM_IN_SOLAR_RADII }
  return { unit: 'R☉', scale: 1 }
}

/**
 * Smallest 1–2–5 value at or above `value`.
 *
 * Rounds up, not down: callers pass the step implied by a target pixel spacing, and rounding down
 * packs the ticks tighter than asked for rather than looser.
 */
export function niceStep(value: number): number {
  if (!(value > 0)) return 1
  const decade = Math.pow(10, Math.floor(Math.log10(value)))
  const mantissa = value / decade
  if (mantissa <= 1) return decade
  if (mantissa <= 2) return 2 * decade
  if (mantissa <= 5) return 5 * decade
  return 10 * decade
}
