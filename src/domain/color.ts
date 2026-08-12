import type { Kelvin } from './units.js'

export interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

const clamp255 = (n: number) => Math.min(255, Math.max(0, n))

/*
 * Tanner Helland's incandescent-lamp approximation, carried over from the original engine.
 * It is an approximation of a tungsten filament, not a stellar blackbody, and it clamps hard at
 * 1000–40000 K. Phase 2 replaces this with a real Planck curve -> CIE XYZ -> linear sRGB path.
 */
export function blackbodyRGB(temperature: Kelvin): RGB {
  const t = Math.min(40000, Math.max(1000, temperature)) / 100

  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)

  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492)

  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307

  return { r: Math.round(clamp255(r)), g: Math.round(clamp255(g)), b: Math.round(clamp255(b)) }
}

export const cssRGB = ({ r, g, b }: RGB) => `rgb(${r}, ${g}, ${b})`
