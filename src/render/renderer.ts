import type { StarState } from '../domain/index.js'
import { cssRGB } from '../domain/index.js'

interface Layer {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  /** Parallax divisor — larger means the layer scrolls more slowly. */
  readonly depth: number
  loaded: boolean
}

const MAP_SIZE = 3000
const MIN_ZOOM = 0.25
const MAX_ZOOM = 8

const BACKGROUNDS: ReadonlyArray<{ src: string; depth: number }> = [
  { src: 'img/starfield.png', depth: 3 },
  { src: 'img/cloudsR2.jpg', depth: 2 },
  { src: 'img/cloudsB2.jpg', depth: 1.5 },
]

/*
 * Carried over from the original 2D renderer so phase 1 stays visually comparable. Phase 3 replaces
 * this wholesale with the WebGL pipeline.
 *
 * Two defects from the original are not reproduced here, because reproducing them faithfully would
 * have meant preserving the mechanisms that caused them:
 *
 *  - Zoom was stored implicitly in a canvas transform that was never reset, so the tracked zoom
 *    value drifted away from the actual transform (measured 1.88 vs 2.389) and neither end was
 *    clamped. Zoom is now an explicit, clamped number applied via setTransform.
 *  - Resize updated the frame dimensions but never recentred the frame origin, so after any resize
 *    the star drifted to the top-left corner and disappeared behind the controls.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly layers: Layer[] = []

  private width = 0
  private height = 0
  private frameX = 0
  private frameY = 0
  private zoom = 1

  private dragging = false
  private dragOrigin = { x: 0, y: 0, frameX: 0, frameY: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx

    this.loadBackgrounds()
    this.resize()
    this.centre()
    this.bindEvents()
  }

  private loadBackgrounds(): void {
    for (const { src, depth } of BACKGROUNDS) {
      const canvas = document.createElement('canvas')
      canvas.width = MAP_SIZE
      canvas.height = MAP_SIZE
      const context = canvas.getContext('2d')
      if (!context) continue

      const layer: Layer = { canvas, context, depth, loaded: false }
      this.layers.push(layer)

      const image = new Image()
      image.addEventListener('load', () => {
        const pattern = context.createPattern(image, 'repeat')
        if (!pattern) return
        context.fillStyle = pattern
        context.fillRect(0, 0, MAP_SIZE, MAP_SIZE)
        layer.loaded = true
      })
      image.src = src
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize())

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.dragOrigin = { x: e.clientX, y: e.clientY, frameX: this.frameX, frameY: this.frameY }
      this.canvas.setPointerCapture(e.pointerId)
      this.canvas.classList.add('drag')
    })

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      this.frameX = this.dragOrigin.frameX + (this.dragOrigin.x - e.clientX) / this.zoom
      this.frameY = this.dragOrigin.frameY + (this.dragOrigin.y - e.clientY) / this.zoom
      this.clampFrame()
    })

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      this.canvas.releasePointerCapture(e.pointerId)
      this.canvas.classList.remove('drag')
    }
    this.canvas.addEventListener('pointerup', endDrag)
    this.canvas.addEventListener('pointercancel', endDrag)

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        // Constant ratio per notch, so zooming is symmetric in both directions.
        const factor = Math.exp(-e.deltaY / 500)
        this.setZoom(this.zoom * factor)
      },
      { passive: false },
    )
  }

  /** Map coordinate currently at the middle of the viewport. */
  private viewCentre(): { x: number; y: number } {
    return {
      x: this.frameX + this.width / this.zoom / 2,
      y: this.frameY + this.height / this.zoom / 2,
    }
  }

  /** Moves the frame so `x, y` sits at the middle of the viewport. */
  private setViewCentre(x: number, y: number): void {
    this.frameX = x - this.width / this.zoom / 2
    this.frameY = y - this.height / this.zoom / 2
    this.clampFrame()
  }

  private setZoom(next: number): void {
    const anchor = this.viewCentre()
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    this.setViewCentre(anchor.x, anchor.y)
  }

  private resize(): void {
    // Anchor on what the viewer is looking at, not on the frame origin — otherwise content slides
    // toward the top-left as the window grows, which is how the original lost the star entirely.
    const hadSize = this.width > 0
    const anchor = this.viewCentre()

    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    this.width = rect.width
    this.height = rect.height
    this.canvas.width = Math.round(rect.width * dpr)
    this.canvas.height = Math.round(rect.height * dpr)

    if (hadSize) this.setViewCentre(anchor.x, anchor.y)
    else this.clampFrame()
  }

  /** Centres the viewport on the middle of the map, where the star is drawn. */
  private centre(): void {
    this.setViewCentre(MAP_SIZE / 2, MAP_SIZE / 2)
  }

  private clampFrame(): void {
    const visibleW = this.width / this.zoom
    const visibleH = this.height / this.zoom
    this.frameX = Math.min(Math.max(0, this.frameX), Math.max(0, MAP_SIZE - visibleW))
    this.frameY = Math.min(Math.max(0, this.frameY), Math.max(0, MAP_SIZE - visibleH))
  }

  recentre(): void {
    this.centre()
    this.clampFrame()
  }

  render(star: StarState): void {
    const dpr = window.devicePixelRatio || 1
    const { ctx } = this

    ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, 0, 0)
    ctx.clearRect(0, 0, this.width / this.zoom, this.height / this.zoom)

    ctx.globalCompositeOperation = 'lighter'
    for (const layer of this.layers) {
      if (layer.loaded) this.compositeLayer(layer)
    }

    this.drawStar(star)
    ctx.globalCompositeOperation = 'source-over'
  }

  private compositeLayer(layer: Layer): void {
    const w = this.width / this.zoom
    const h = this.height / this.zoom
    this.ctx.drawImage(
      layer.canvas,
      Math.floor(this.frameX / layer.depth),
      Math.floor(this.frameY / layer.depth),
      w,
      h,
      0,
      0,
      w,
      h,
    )
  }

  private drawStar(star: StarState): void {
    const { ctx } = this
    const x = MAP_SIZE / 2 - this.frameX
    const y = MAP_SIZE / 2 - this.frameY
    const radius = Math.max(1, star.radius * 5)

    const gradient = ctx.createRadialGradient(x, y, radius / 4, x, y, radius)
    gradient.addColorStop(0, 'white')
    gradient.addColorStop(0.5, cssRGB(star.color))
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
  }
}
