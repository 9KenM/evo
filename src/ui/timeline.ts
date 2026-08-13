import { cssRGB, gyr, type Gyr, type LifecycleTrack } from '../domain/index.js'
import { formatAge, formatAgeTick } from './format.js'

/** Colour samples along the strip. Enough for a smooth gradient without a costly rebuild. */
const STRIP_SAMPLES = 140

/** Decades of age the tick axis will consider, from a thousand years up. */
const TICK_DECADES = { from: -6, to: 3 }

const PHASE_LABEL: Record<string, string> = {
  'main sequence': 'main sequence',
  subgiant: 'Hertzsprung gap',
  giant: 'giant branch',
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
  private readonly caption: HTMLElement
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
      <div class="tl-caption"></div>
    `
    this.marks = root.querySelector('.tl-marks')!
    this.strip = root.querySelector('.tl-strip')!
    this.playhead = root.querySelector('.tl-playhead')!
    this.phases = root.querySelector('.tl-phases')!
    this.ticks = root.querySelector('.tl-ticks')!
    this.caption = root.querySelector('.tl-caption')!

    this.bindSeeking()
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

  /** The strip is tinted with the star's own colour at each point in its life. */
  private renderStrip(track: LifecycleTrack): void {
    const stops: string[] = []
    for (let i = 0; i <= STRIP_SAMPLES; i++) {
      const position = i / STRIP_SAMPLES
      const star = track.sample(track.unwarp(position))
      stops.push(`${cssRGB(star.color)} ${(position * 100).toFixed(2)}%`)
    }
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

  setAge(age: Gyr): void {
    if (!this.track) return
    this.playhead.style.left = `${this.track.warp(age) * 100}%`
    this.caption.textContent = formatAge(age)
  }
}
