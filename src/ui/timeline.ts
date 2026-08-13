import { gyr, type Gyr, type LifecycleTrack } from '../domain/index.js'
import { formatAge, formatAgeTick } from './format.js'

/** Colour samples along the strip. Enough for a smooth gradient without a costly rebuild. */
const STRIP_SAMPLES = 140

/** Decades of luminosity the strip's brightness ramp spans below the track's peak. */
const DYNAMIC_RANGE_DECADES = 6

/** Floor on the brightness ramp, so the faintest stretch is still visibly coloured. */
const MIN_LEVEL = 0.22

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Decades of age the tick axis will consider, from a thousand years up. */
const TICK_DECADES = { from: -6, to: 3 }

/** Short forms, because a phase band is often only a few dozen pixels wide. */
const PHASE_LABEL: Record<string, string> = {
  'main sequence': 'main sequence',
  'hertzsprung gap': 'Hertzsprung gap',
  'giant branch': 'giant branch',
  'core helium burning': 'He burning',
  'early AGB': 'AGB',
  'thermally pulsing AGB': 'TP-AGB',
  'planetary nebula': 'nebula',
  'white dwarf': 'white dwarf',
  'neutron star': 'neutron star',
  'black hole': 'black hole',
}

/**
 * The lifecycle strip.
 *
 * Horizontal axis is the track's warped coordinate, not age, so brief phases get usable width and
 * rapid stretches within a phase are magnified. The age ticks are what carry real time: they bunch
 * together wherever the axis is compressed, the same way ticks bunch on a log plot.
 *
 * Laid out with percentage-positioned HTML rather than SVG so labels keep their type size at any
 * viewport width, and the strip itself is a single CSS gradient rebuilt only when the track changes.
 */
export class Timeline {
  private readonly strip: HTMLElement
  private readonly phases: HTMLElement
  private readonly marks: HTMLElement
  private readonly ticks: HTMLElement
  private readonly playhead: HTMLElement
  private track: LifecycleTrack | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly onSeek: (age: Gyr) => void,
  ) {
    root.innerHTML = `
      <div class="tl-marks"></div>
      <div class="tl-strip"><div class="tl-playhead"></div></div>
      <div class="tl-phases"></div>
      <div class="tl-ticks"></div>
    `
    this.marks = root.querySelector('.tl-marks')!
    this.strip = root.querySelector('.tl-strip')!
    this.playhead = root.querySelector('.tl-playhead')!
    this.phases = root.querySelector('.tl-phases')!
    this.ticks = root.querySelector('.tl-ticks')!

    /*
     * The strip is a scrubber, so it is announced as one. Arrow-key handling lives in the app's
     * global keydown handler rather than here — the same keys do the same thing whether or not the
     * strip happens to hold focus, and duplicating it would double-apply every press.
     */
    this.strip.setAttribute('role', 'slider')
    this.strip.setAttribute('tabindex', '0')
    this.strip.setAttribute('aria-label', 'Age')
    this.strip.setAttribute('aria-valuemin', '0')
    this.strip.setAttribute('aria-valuemax', '1')

    this.bindSeeking()
    /*
     * Bookmark rows and end-anchoring are measured in pixels at layout time, so they go stale when
     * the window changes width — labels re-overlap and the end ones spill outside the strip.
     */
    window.addEventListener('resize', () => {
      if (this.track) this.renderBookmarks(this.track)
    })
  }

  private bindSeeking(): void {
    let scrubbing = false

    const seekTo = (clientX: number) => {
      if (!this.track) return
      const rect = this.strip.getBoundingClientRect()
      const position = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      this.onSeek(this.track.unwarp(position))
    }

    this.strip.addEventListener('pointerdown', (event) => {
      scrubbing = true
      this.strip.setPointerCapture(event.pointerId)
      seekTo(event.clientX)
    })
    this.strip.addEventListener('pointermove', (event) => {
      if (scrubbing) seekTo(event.clientX)
    })
    const end = (event: PointerEvent) => {
      if (!scrubbing) return
      scrubbing = false
      this.strip.releasePointerCapture(event.pointerId)
    }
    this.strip.addEventListener('pointerup', end)
    this.strip.addEventListener('pointercancel', end)
  }

  setTrack(track: LifecycleTrack): void {
    this.track = track
    this.renderStrip(track)
    this.renderPhases(track)
    this.renderBookmarks(track)
    this.renderTicks(track)
  }

  /**
   * The strip carries the star's own colour *and* its brightness at each point in its life.
   *
   * Colour alone is misleading. A cooling white dwarf drops five decades in luminosity while its
   * blackbody colour runs blue to white — so a purely chromatic strip shows it getting *lighter* as
   * it dies. Modulating by log luminosity makes the strip dim as the star does.
   *
   * The range is floored at six decades below the peak because a black hole's Hawking luminosity is
   * ~10⁻⁵⁷ L☉ and would otherwise crush the entire rest of the track to black.
   */
  private renderStrip(track: LifecycleTrack): void {
    const samples = Array.from({ length: STRIP_SAMPLES + 1 }, (_, i) =>
      track.sample(track.unwarp(i / STRIP_SAMPLES)),
    )
    const logs = samples.map((star) => Math.log10(Math.max(star.luminosity, 1e-30)))
    const peak = Math.max(...logs)
    const floor = Math.max(Math.min(...logs), peak - DYNAMIC_RANGE_DECADES)

    const stops = samples.map((star, i) => {
      const t = clamp01(((logs[i] as number) - floor) / Math.max(peak - floor, 1e-9))
      const level = MIN_LEVEL + (1 - MIN_LEVEL) * t
      const { r, g, b } = star.color
      const shade = (channel: number) => Math.round(channel * level)
      const position = ((i / STRIP_SAMPLES) * 100).toFixed(2)
      return `rgb(${shade(r)}, ${shade(g)}, ${shade(b)}) ${position}%`
    })

    this.strip.style.background = `linear-gradient(to right, ${stops.join(', ')})`
  }

  private renderPhases(track: LifecycleTrack): void {
    this.phases.innerHTML = track.phases
      .map((phase) => {
        const from = track.warp(phase.start)
        const width = track.warp(phase.end) - from
        const label = PHASE_LABEL[phase.stage] ?? phase.stage
        return `<div class="tl-phase" style="left:${from * 100}%;width:${width * 100}%">
          <span>${label}</span>
        </div>`
      })
      .join('')
  }

  /**
   * Bookmarks, stacked into rows so labels never overprint each other.
   *
   * Positions are dictated by the track, so labels genuinely do collide — a solar-mass star reaches
   * maximum radius and peak luminosity within a few percent of the strip. Rows are assigned greedily
   * against each row's occupied right edge, and labels near the ends are anchored inward so they do
   * not spill outside the timeline.
   */
  private renderBookmarks(track: LifecycleTrack): void {
    const width = this.marks.clientWidth || this.root.clientWidth || 1000
    // Labels are centred, so each claims roughly half its width either side of its tick.
    const estimateWidth = (label: string) => label.length * 5.6 + 14

    const rowEnds: number[] = []
    const placed = track.bookmarks.map((bookmark) => {
      const fraction = track.warp(bookmark.age)
      const px = fraction * width
      const half = estimateWidth(bookmark.label) / 2

      // Keep end labels inside the strip.
      const anchor = px - half < 0 ? 'start' : px + half > width ? 'end' : 'centre'
      const left = anchor === 'start' ? px : anchor === 'end' ? px - 2 * half : px - half
      const right = left + 2 * half

      let row = rowEnds.findIndex((end) => left > end + 6)
      if (row === -1) {
        row = rowEnds.length
        rowEnds.push(right)
      } else {
        rowEnds[row] = right
      }

      return { bookmark, fraction, anchor, row }
    })

    const rows = Math.max(1, rowEnds.length)
    this.marks.style.height = `${rows * 15 + 14}px`

    this.marks.innerHTML = placed
      .map(({ bookmark, fraction, anchor, row }) => {
        // Stem height grows with the row so every stacked label still connects to the strip.
        const stem = 8 + (rows - 1 - row) * 15

        /*
         * The whole button is shifted, not just its text, so the click target tracks what is
         * actually visible. The stem then has to move the opposite way to stay on the tick.
         */
        const translate =
          anchor === 'centre' ? 'translateX(-50%)' : anchor === 'end' ? 'translateX(-100%)' : 'none'
        const stemLeft = anchor === 'centre' ? '50%' : anchor === 'end' ? '100%' : '0'

        return `<button class="tl-mark"
          style="left:${fraction * 100}%;bottom:${stem}px;transform:${translate}"
          data-age="${bookmark.age}" title="${bookmark.label} — ${formatAge(bookmark.age)}">
          <span>${bookmark.label}</span>
          <i style="height:${stem}px;left:${stemLeft}"></i>
        </button>`
      })
      .join('')

    for (const button of this.marks.querySelectorAll<HTMLButtonElement>('.tl-mark')) {
      button.addEventListener('click', () => this.onSeek(gyr(Number(button.dataset.age))))
    }
  }

  /**
   * Age ticks at round decade values. Their spacing is the honest record of how much the axis has
   * been warped — where they crowd together, real time is being compressed.
   */
  private renderTicks(track: LifecycleTrack): void {
    const marks: string[] = []
    let previous = -1

    for (let decade = TICK_DECADES.from; decade <= TICK_DECADES.to; decade++) {
      for (const multiple of [1, 3]) {
        const age = multiple * Math.pow(10, decade)
        if (age <= 0 || age > track.end) continue

        const position = track.warp(gyr(age)) * 100
        // Drop ticks that would overprint their neighbour.
        if (position - previous < 4) continue
        previous = position

        marks.push(`<div class="tl-tick" style="left:${position}%">
          <span>${formatAgeTick(age)}</span>
        </div>`)
      }
    }

    this.ticks.innerHTML = marks.join('')
  }

  /** Phase covering an age, for the scrubber's spoken value. */
  private stageAt(age: Gyr): string {
    const phase = this.track?.phases.find((p) => age >= p.start && age <= p.end)
    return phase ? (PHASE_LABEL[phase.stage] ?? phase.stage) : ''
  }

  setAge(age: Gyr): void {
    if (!this.track) return
    const position = this.track.warp(age)
    this.playhead.style.left = `${position * 100}%`
    this.strip.setAttribute('aria-valuenow', position.toFixed(3))
    this.strip.setAttribute('aria-valuetext', `${formatAge(age)} — ${this.stageAt(age)}`)
  }
}
