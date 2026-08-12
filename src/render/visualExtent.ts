import type { StarState } from '../domain/index.js'
import { SCHWARZSCHILD_KM_PER_SOLAR_MASS, SOLAR_RADIUS_KM } from '../domain/index.js'

/**
 * The radius, in solar radii, that the camera should frame — deliberately not `state.radius`.
 *
 * For most stages the object *is* its photosphere. Two stages break that identity: a black hole's
 * interesting structure (shadow, photon ring, lensed background) extends to several Schwarzschild
 * radii, so framing the bare horizon would show almost nothing; and a neutron star is so small that
 * framing it alone leaves no visual context.
 */
export function visualExtent(star: StarState): number {
  switch (star.stage) {
    case 'black hole': {
      const schwarzschild = (SCHWARZSCHILD_KM_PER_SOLAR_MASS * star.mass) / SOLAR_RADIUS_KM
      // The shadow a distant observer sees has radius √27·M = 2.598 R_s, so framing must be sized
      // against that rather than the horizon — the horizon itself is never what is visible.
      return schwarzschild * 3
    }
    case 'neutron star':
      return star.radius * 6
    default:
      return star.radius
  }
}
