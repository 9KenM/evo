import { SOLAR_TEMPERATURE, type StarState } from '../domain/index.js'

/**
 * Half-angle of the virtual sensor's vertical field of view, used to derive an observer distance
 * from the framing. Narrow and telephoto-like, which puts the implied observer at a plausible
 * remove — a solar-radius star framed this way sits about 0.6 AU away rather than inside the corona.
 *
 * Deliberately not the same as the shader's SKY_FOV, which projects the backdrop over a much wider
 * angle. At a true 2° field a small orbit would sweep the sky several screen widths per second,
 * so the backdrop is drawn wide to keep its motion readable. The star itself is framed
 * orthographically from the camera span, so there is no single field of view to reconcile: this
 * constant is a stated convention for reporting distance, not a projection the renderer uses.
 */
const SENSOR_HALF_FOV = (1 * Math.PI) / 180

/**
 * Display level a reference photosphere is exposed to, before tonemapping.
 *
 * Sits just under the ACES knee. Higher and the disk clips to flat white, taking limb darkening,
 * granulation and the blackbody hue with it; lower and ordinary stars read as dull grey. The margin
 * is what leaves shape and colour visible while still reading as bright.
 */
const EXPOSURE_TARGET = 1.1

/**
 * How completely exposure cancels the scene's own brightness.
 *
 * At 1.0 every star would be exposed to the same display level and all sense of absolute brightness
 * would be lost. At 0 nothing is compensated and the range — roughly six decades of surface radiance
 * between a cool giant and a freshly exposed white dwarf — would blow out one end or crush the
 * other. Partial compensation keeps hotter objects visibly brighter while holding the whole range
 * inside what the tonemap can render.
 */
const EXPOSURE_COMPENSATION = 0.8

/**
 * Backdrop level, fixed for every archetype.
 *
 * A constant rather than an exposure-compensated gain. Exposure is applied to the subject inside
 * the shader, so the sky needs no correction and cannot be dragged through the bloom threshold by
 * a dim subject opening the aperture up.
 */
export const BACKDROP_LEVEL = 1.0

export interface CameraOptics {
  /** Surface radiance relative to the Sun, (T/T☉)⁴. A surface brightness, so distance-invariant. */
  readonly radiance: number
  /** Observer distance in solar radii, implied by the framing and the sensor field of view. */
  readonly distance: number
  /** Linear exposure multiplier handed to the tonemap. */
  readonly exposure: number
  /** Exposure in stops relative to unity. Negative is stopped down. */
  readonly stops: number
}

/**
 * Camera characteristics for framing a given star at a given zoom.
 *
 * Kept separate from the renderer so the values are inspectable and can be surfaced in the UI: the
 * star is rendered at its true brightness and the *camera* is what adapts, which is both how real
 * astrophotography works and what keeps a 10⁵ L☉ remnant from destroying the viewport.
 */
export function opticsFor(star: StarState, span: number): CameraOptics {
  const distance = span / Math.tan(SENSOR_HALF_FOV)

  if (star.stage === 'black hole') {
    // Nothing self-luminous in frame. Hawking radiance is ~10⁻⁵⁷ of solar and would drive the
    // exposure to absurdity, so expose for the lensed sky instead of for a photosphere.
    return { radiance: 0, distance, exposure: 1, stops: 0 }
  }

  const radiance = Math.pow(star.temperature / SOLAR_TEMPERATURE, 4)
  const exposure = EXPOSURE_TARGET / Math.pow(radiance, EXPOSURE_COMPENSATION)

  return { radiance, distance, exposure, stops: Math.log2(exposure) }
}
