import '@fontsource/inconsolata/400.css'
import '@fontsource/inconsolata/700.css'
import './style.css'

import {
  SOLAR,
  evolve,
  fromFeH,
  gyr,
  solarMasses,
  toFeH,
  type Gyr,
  type Metallicity,
  type SolarMasses,
} from './domain/index.js'
import { Camera } from './render/camera.js'
import { Stage } from './render/stage.js'
import { visualExtent } from './render/visualExtent.js'
import { Readout } from './ui/readout.js'

interface Params {
  massInitial: SolarMasses
  metallicity: Metallicity
  age: Gyr
  /** Gyr of simulated time per second of wall-clock time. */
  timescale: number
  running: boolean
}

const params: Params = {
  massInitial: solarMasses(1),
  metallicity: SOLAR,
  age: gyr(0),
  timescale: 0.6,
  running: false,
}

/**
 * Physical yardsticks the reference ring can snap to, in solar radii. The camera crosses eight
 * decades, so a single fixed reference would be off screen almost everywhere.
 */
const REFERENCES: ReadonlyArray<{ label: string; radius: number }> = [
  { label: '10 km', radius: 1.437e-5 },
  { label: '1000 km', radius: 1.437e-3 },
  { label: 'Earth radius', radius: 0.00917 },
  { label: 'Jupiter radius', radius: 0.10045 },
  { label: '1 R☉', radius: 1 },
  { label: '10 R☉', radius: 10 },
  { label: '1 AU', radius: 215.03 },
  { label: "Jupiter's orbit", radius: 1118 },
]

function pickReference(span: number): { label: string; radius: number } {
  let best = REFERENCES[0]!
  let bestError = Infinity
  for (const candidate of REFERENCES) {
    const error = Math.abs(Math.log(candidate.radius / (span * 0.6)))
    if (error < bestError) {
      bestError = error
      best = candidate
    }
  }
  return best
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element #${id}`)
  return found as T
}

const canvas = el<HTMLCanvasElement>('canvas')
const stage = new Stage(canvas)
const camera = new Camera()
const readout = new Readout(el('info'))
const scaleLabel = el('scaleref')

const massInput = el<HTMLInputElement>('mass')
const fehInput = el<HTMLInputElement>('feh')
const ageInput = el<HTMLInputElement>('age')
const timescaleInput = el<HTMLInputElement>('timescale')
const playButton = el<HTMLButtonElement>('play')

const readNumber = (input: HTMLInputElement, fallback: number, min: number): number => {
  const parsed = Number.parseFloat(input.value)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

function syncInputs(): void {
  massInput.value = String(params.massInitial)
  fehInput.value = toFeH(params.metallicity).toFixed(2)
  ageInput.value = params.age.toPrecision(4)
  timescaleInput.value = String(params.timescale)
}

massInput.addEventListener('change', () => {
  params.massInitial = solarMasses(readNumber(massInput, params.massInitial, 0.1))
  syncInputs()
})

fehInput.addEventListener('change', () => {
  const parsed = Number.parseFloat(fehInput.value)
  params.metallicity = fromFeH(Number.isFinite(parsed) ? parsed : toFeH(params.metallicity))
  syncInputs()
})

ageInput.addEventListener('change', () => {
  params.age = gyr(readNumber(ageInput, params.age, 0))
  syncInputs()
})

timescaleInput.addEventListener('change', () => {
  params.timescale = readNumber(timescaleInput, params.timescale, 0)
  syncInputs()
})

playButton.addEventListener('click', () => {
  params.running = !params.running
  playButton.textContent = params.running ? '❚❚' : '▶'
  playButton.setAttribute('aria-label', params.running ? 'Pause' : 'Play')
})

const recentreButton = el<HTMLButtonElement>('recentre')
recentreButton.addEventListener('click', () => camera.resetZoom())

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    camera.zoomBy(event.deltaY / 400)
  },
  { passive: false },
)

/** Radians of orbit per pixel dragged. A full viewport width is a little under one revolution. */
const DRAG_SENSITIVITY = 0.005

let dragging = false
let lastPointer = { x: 0, y: 0 }

canvas.addEventListener('pointerdown', (event) => {
  dragging = true
  lastPointer = { x: event.clientX, y: event.clientY }
  canvas.setPointerCapture(event.pointerId)
  canvas.classList.add('dragging')
})

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return
  camera.orbitBy(
    (event.clientX - lastPointer.x) * DRAG_SENSITIVITY,
    (event.clientY - lastPointer.y) * DRAG_SENSITIVITY,
  )
  lastPointer = { x: event.clientX, y: event.clientY }
})

const endDrag = (event: PointerEvent) => {
  if (!dragging) return
  dragging = false
  canvas.releasePointerCapture(event.pointerId)
  canvas.classList.remove('dragging')
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)

window.addEventListener('resize', () => stage.resize())

let lastFrame = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now

  if (params.running) {
    params.age = gyr(params.age + params.timescale * dt)
    ageInput.value = params.age.toPrecision(4)
  }

  const star = evolve(params.massInitial, params.age, params.metallicity)

  camera.follow(visualExtent(star))
  camera.update(dt)

  const reference = pickReference(camera.span)
  stage.setReferenceRadius(reference.radius)
  scaleLabel.textContent = `ring: ${reference.label}`
  recentreButton.disabled = camera.isFollowing

  stage.render(star, camera, dt)
  readout.update(star)

  requestAnimationFrame(frame)
}

syncInputs()
camera.follow(visualExtent(evolve(params.massInitial, params.age, params.metallicity)))
camera.snap()
requestAnimationFrame(frame)
