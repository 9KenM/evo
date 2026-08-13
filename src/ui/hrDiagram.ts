import { cssRGB, type LifecycleTrack, type StarState } from '../domain/index.js'

/*
 * The Hertzsprung–Russell diagram.
 *
 * Doubles as the engine's most honest test. Every other check in this project compares numbers at
 * chosen points; a track's *shape* is the thing that reveals a wrong model, and shape is only
 * legible plotted. The main sequence should be a tight diagonal, the giant branch should climb
 * steeply to the right, the helium flash should drop the star onto a horizontal branch, and the
 * post-AGB crossing should run flat across the top to the left. If any of those is missing or
 * bent the wrong way, it shows here immediately and nowhere else.
 *
 * Axes follow the convention: temperature increasing to the *left*, luminosity up, both logarithmic.
 */

/** Plot bounds in log10 space. Wide enough for a white dwarf and a supergiant on the same axes. */
const LOG_T = { hot: 5.4, cool: 3.3 }
const LOG_L = { top: 7, bottom: -5 }

/** Samples along the track. Uniform in warped position, so dense where the star changes fastest. */
const SAMPLES = 260

/** Below this the object has left the diagram entirely — a black hole, effectively. */
const MIN_LUMINOSITY = 1e-6

/**
 * The model contains exactly one discontinuity, and the path is broken there and nowhere else.
 *
 * Detected by the stage transition rather than by how far the plot jumps between samples. A
 * distance threshold looks equivalent and is not: the white dwarf's first few thousand years drop it
 * two decades in luminosity, so a step-size test reports a break at the nebula-to-cooling handover
 * — which is continuous by construction — and draws a gap where the star really does pass through
 * every intermediate state.
 */
const FLASH_FROM = 'giant branch'
const FLASH_TO = 'core helium burning'

const x = (logT: number) => ((LOG_T.hot - logT) / (LOG_T.hot - LOG_T.cool)) * 100
const y = (logL: number) => ((LOG_L.top - logL) / (LOG_L.top - LOG_L.bottom)) * 100

const inside = (star: StarState) =>
  star.luminosity > MIN_LUMINOSITY &&
  star.temperature > 10 ** LOG_T.cool &&
  star.temperature < 10 ** LOG_T.hot

const place = (star: StarState) => ({
  cx: x(Math.log10(star.temperature)),
  cy: y(Math.log10(star.luminosity)),
})

export class HRDiagram {
  private readonly svg: SVGSVGElement
  private readonly path: SVGPathElement
  private readonly marker: SVGCircleElement
  private track: LifecycleTrack | null = null

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label="Hertzsprung-Russell diagram showing the star's evolutionary track">
        <g class="hr-grid"></g>
        <path class="hr-track" d="" />
        <g class="hr-sun">
          <circle cx="${x(Math.log10(5772))}" cy="${y(0)}" r="1.1" />
        </g>
        <circle class="hr-marker" r="2.2" cx="-10" cy="-10" />
      </svg>
      <div class="hr-axis hr-axis-x"><span>hot</span><span>cool</span></div>
      <div class="hr-axis hr-axis-y"><span>10⁷ L☉</span><span>10⁻⁵</span></div>
    `

    this.svg = root.querySelector('svg')!
    this.path = root.querySelector('.hr-track')!
    this.marker = root.querySelector('.hr-marker')!
    this.renderGrid()
  }

  /** Decade gridlines, so the reader can judge slopes rather than just see a squiggle. */
  private renderGrid(): void {
    const lines: string[] = []
    for (let logL = LOG_L.bottom; logL <= LOG_L.top; logL += 2) {
      lines.push(`<line x1="0" x2="100" y1="${y(logL)}" y2="${y(logL)}" />`)
    }
    for (let logT = 3.5; logT <= LOG_T.hot; logT += 0.5) {
      lines.push(`<line y1="0" y2="100" x1="${x(logT)}" x2="${x(logT)}" />`)
    }
    this.svg.querySelector('.hr-grid')!.innerHTML = lines.join('')
  }

  setTrack(track: LifecycleTrack): void {
    this.track = track

    /*
     * Broken into subpaths at the helium flash. Low-mass stars drop more than a decade in luminosity
     * there instantly, and a connecting segment would claim the star occupies states it never does.
     */
    const segments: string[] = []
    let current: string[] = []
    let previousStage = ''

    const flush = () => {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
    }

    for (let i = 0; i <= SAMPLES; i++) {
      const star = track.sample(track.unwarp(i / SAMPLES))
      if (!inside(star)) {
        flush()
        previousStage = ''
        continue
      }

      if (previousStage === FLASH_FROM && star.stage === FLASH_TO) flush()
      previousStage = star.stage

      const { cx, cy } = place(star)
      current.push(`${current.length === 0 ? 'M' : 'L'}${cx.toFixed(2)},${cy.toFixed(2)}`)
    }
    flush()

    this.path.setAttribute('d', segments.join(' '))
  }

  setStar(star: StarState): void {
    if (!this.track || !inside(star)) {
      this.marker.setAttribute('cx', '-10')
      return
    }
    const { cx, cy } = place(star)
    this.marker.setAttribute('cx', cx.toFixed(2))
    this.marker.setAttribute('cy', cy.toFixed(2))
    this.marker.setAttribute('fill', cssRGB(star.color))
  }
}
