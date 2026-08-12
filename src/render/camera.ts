/** Smallest half-height the camera will frame, in solar radii — roughly 0.7 km. */
const MIN_SPAN = 1e-6
/** Largest half-height, roughly 4600 AU. */
const MAX_SPAN = 1e6

/** Fraction of the viewport half-height the framed object should occupy under auto-fit. */
const FIT_MARGIN = 2.6

/** e-folding time of the easing, in seconds. */
const EASE_TAU = 0.45

const clampSpan = (span: number) => Math.min(MAX_SPAN, Math.max(MIN_SPAN, span))

/**
 * Framing for a scene whose subject spans eight orders of magnitude.
 *
 * Everything is held and interpolated as log(span), because a supergiant collapsing to a black hole
 * moves the framing by ~7 decades. Easing that linearly would spend the entire animation in the
 * first decade and then snap; easing it in log space gives a constant *rate of magnification*,
 * which reads as a smooth continuous zoom.
 *
 * `span` is the half-height of the viewport measured in solar radii.
 */
/**
 * Radians per second of the slow observer orbit.
 *
 * Two jobs. Schwarzschild lensing is rotationally symmetric, so a still frame gives no cue that the
 * background is being bent at all; drifting the viewpoint sweeps field stars through the deflection
 * field where they visibly smear around the photon ring. On stellar surfaces the same orbit carries
 * granulation across the disk, which is what makes the object read as a sphere rather than a
 * shaded circle.
 *
 * About one revolution every five minutes — slow enough to register as drift, not motion.
 */
const ORBIT_RATE = 0.02

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export class Camera {
  private logSpan: number
  private logTarget: number
  private manualBias = 0
  private following = true
  private azimuth = 0
  private elevation = 0
  private readonly orbitRate: number

  constructor(initialSpan = 3) {
    this.logSpan = Math.log(clampSpan(initialSpan))
    this.logTarget = this.logSpan
    this.orbitRate = prefersReducedMotion() ? 0 : ORBIT_RATE
  }

  get span(): number {
    return Math.exp(this.logSpan)
  }

  /** Observer orientation in radians: azimuth, then elevation. */
  get orbit(): { azimuth: number; elevation: number } {
    return { azimuth: this.azimuth, elevation: this.elevation }
  }

  /**
   * Manual orbit, in radians. Elevation is clamped short of the poles, where an equirectangular sky
   * lookup degenerates.
   */
  orbitBy(deltaAzimuth: number, deltaElevation: number): void {
    this.azimuth += deltaAzimuth
    this.elevation = Math.min(1.3, Math.max(-1.3, this.elevation + deltaElevation))
  }

  get isFollowing(): boolean {
    return this.following
  }

  /** Auto-fit target for the current subject. Ignored while the viewer has taken manual control. */
  follow(extent: number): void {
    const fitted = clampSpan(extent * FIT_MARGIN)
    this.logTarget = Math.log(fitted) + this.manualBias
    this.clampTarget()
  }

  /**
   * Manual zoom. `notches` is signed wheel movement; each unit is a constant *ratio*, which is what
   * makes zooming symmetric. The previous renderer added a linear delta to a multiplicative
   * transform, so zooming out compounded and ran away.
   */
  zoomBy(notches: number): void {
    this.manualBias += notches
    this.following = false
    this.logTarget += notches
    this.clampTarget()
  }

  /** Drops the manual offset and resumes auto-fit. */
  resetZoom(): void {
    this.manualBias = 0
    this.following = true
  }

  private clampTarget(): void {
    const lo = Math.log(MIN_SPAN)
    const hi = Math.log(MAX_SPAN)
    if (this.logTarget < lo) {
      this.manualBias += lo - this.logTarget
      this.logTarget = lo
    } else if (this.logTarget > hi) {
      this.manualBias += hi - this.logTarget
      this.logTarget = hi
    }
  }

  /** Eases toward the target and advances the orbit. `dt` in seconds; frame-rate independent. */
  update(dt: number): void {
    const alpha = 1 - Math.exp(-dt / EASE_TAU)
    this.logSpan += (this.logTarget - this.logSpan) * alpha
    this.azimuth += this.orbitRate * dt
  }

  /** Snaps to the target without easing — for parameter changes that should not animate. */
  snap(): void {
    this.logSpan = this.logTarget
  }
}
