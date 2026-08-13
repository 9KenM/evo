import type { StarState } from '../domain/index.js'
import { lengthUnit, niceStep, num } from './format.js'

/** Target spacing between ruler ticks, in CSS pixels. */
const TICK_SPACING = 70

/** Pixels of clearance kept at the bottom so ticks never slide under the transport bar. */
const BOTTOM_MARGIN = 150

/** Pixels of clearance kept at the top, under the controls bar. */
const TOP_MARGIN = 48

interface Reference {
  readonly label: string
  /** Solar radii. */
  readonly radius: number
}

/** Physical yardsticks worth calling out when they fall within the current view. */
const REFERENCES: readonly Reference[] = [
  { label: 'Earth radius', radius: 0.00917 },
  { label: 'Jupiter radius', radius: 0.10045 },
  { label: '1 R☉', radius: 1 },
  { label: "Earth's orbit", radius: 215.03 },
  { label: "Jupiter's orbit", radius: 1118 },
]

/**
 * Markers that only exist for one kind of object.
 *
 * A black hole framed at a few Schwarzschild radii sits eight decades below the smallest fixed
 * reference — Earth's radius is 6371 km against a horizon of 26 — so without these the reference
 * rail is empty during the most dramatic part of the whole simulation. `star.radius` is the
 * Schwarzschild radius for a black hole; the photon sphere sits at 1.5 of it, and the shadow a
 * distant observer actually sees at √27/2 ≈ 2.598.
 */
function dynamicReferences(star: StarState): readonly Reference[] {
  if (star.stage !== 'black hole') return []
  return [
    { label: 'event horizon', radius: star.radius },
    { label: 'photon sphere', radius: star.radius * 1.5 },
    { label: 'shadow', radius: star.radius * 2.598 },
  ]
}

/**
 * Vertical ruler measuring outward from the centre of the view, where the subject sits.
 *
 * The camera crosses eight orders of magnitude and auto-fit holds the subject at a roughly constant
 * size on screen, so without a scale the collapse of a supergiant into a black hole would look like
 * nothing happening. This is the readout that makes the zoom legible.
 *
 * Positions are computed in canvas pixels rather than as percentages of this element, because the
 * ruler is inset from the viewport edges while the world-to-screen mapping belongs to the canvas.
 */
export class SizeScale {
  private readonly ticks: HTMLElement
  private readonly references: HTMLElement
  private readonly unitLabel: HTMLElement
  private lastTicks = ''
  private lastReferences = ''

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="ss-unit"></div>
      <div class="ss-ticks"></div>
      <div class="ss-references"></div>
    `
    this.unitLabel = root.querySelector('.ss-unit')!
    this.ticks = root.querySelector('.ss-ticks')!
    this.references = root.querySelector('.ss-references')!
  }

  /** `span` is the world half-height of the canvas, in solar radii. */
  update(span: number, canvasHeight: number, star: StarState): void {
    if (!(span > 0) || !(canvasHeight > 0)) return

    const centre = canvasHeight / 2
    const pixelsPerSolarRadius = centre / span
    const { unit, scale } = lengthUnit(span)

    // A round 1–2–5 step that lands near the target pixel spacing.
    const step = niceStep(TICK_SPACING / pixelsPerSolarRadius / scale) * scale
    const visible = (y: number) => y >= TOP_MARGIN && y <= canvasHeight - BOTTOM_MARGIN

    const marks: string[] = []
    for (let value = 0; value <= span; value += step) {
      const y = centre - value * pixelsPerSolarRadius
      if (!visible(y)) continue
      marks.push(`<div class="ss-tick" style="top:${y}px">
        <span>${value === 0 ? '0' : num(value / scale)}</span>
      </div>`)
    }

    const marksHtml = marks.join('')
    if (marksHtml !== this.lastTicks) {
      this.lastTicks = marksHtml
      this.ticks.innerHTML = marksHtml
      this.unitLabel.textContent = unit
    }

    const referenceHtml = [...REFERENCES, ...dynamicReferences(star)]
      .map((reference) => {
        const y = centre - reference.radius * pixelsPerSolarRadius
        // Skip anything that would sit on top of the centre line or off the ruler entirely.
        if (!visible(y) || reference.radius < span * 0.06) return ''
        return `<div class="ss-reference" style="top:${y}px">
          <span>${reference.label}</span>
        </div>`
      })
      .join('')

    // Rebuilt every frame otherwise, which churns the DOM at 60 Hz for values that barely move.
    if (referenceHtml !== this.lastReferences) {
      this.lastReferences = referenceHtml
      this.references.innerHTML = referenceHtml
    }
  }
}
