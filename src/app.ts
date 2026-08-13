import '@fontsource/inconsolata/400.css'
import '@fontsource/inconsolata/700.css'
import './style.css'

import {
  SOLAR,
  computeTrack,
  evolutionContext,
  fromFeH,
  gyr,
  solarMasses,
  toFeH,
  type Gyr,
  type LifecycleTrack,
  type Metallicity,
  type SolarMasses,
} from './domain/index.js'
import { Camera } from './render/camera.js'
import { Stage } from './render/stage.js'
import { visualExtent } from './render/visualExtent.js'
import { Readout } from './ui/readout.js'
import { SizeScale } from './ui/sizeScale.js'
import { Timeline } from './ui/timeline.js'
import { formatAge } from './ui/format.js'

/**
 * Warped-coordinate progress per second at speed 1. A full lifecycle at unit speed takes about
 * this many seconds, whatever the star's actual lifetime.
 */
const ADAPTIVE_RATE = 1 / 90

/** Gyr per second at speed 1 when adaptive pacing is off. */
const PROPORTIONAL_RATE = 0.5

interface Params {
  massInitial: SolarMasses
  metallicity: Metallicity
  age: Gyr
  speed: number
  adaptive: boolean
  running: boolean
}

const params: Params = {
  massInitial: solarMasses(1),
  metallicity: SOLAR,
  age: gyr(0),
  speed: 1,
  adaptive: true,
  running: false,
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
const sizeScale = new SizeScale(el('sizescale'))
const timeline = new Timeline(el('timeline'), (age) => {
  params.age = age
  syncInputs()
})

const massInput = el<HTMLInputElement>('mass')
const fehInput = el<HTMLInputElement>('feh')
const speedInput = el<HTMLInputElement>('speed')
const speedLabel = el('speedvalue')
const adaptiveInput = el<HTMLInputElement>('adaptive')
const playButton = el<HTMLButtonElement>('play')
const ageLabel = el('agevalue')

let track: LifecycleTrack = computeTrack(params.massInitial, params.metallicity)
timeline.setTrack(track)

function rebuildTrack(): void {
  const context = evolutionContext(params.metallicity)
  track = computeTrack(params.massInitial, params.metallicity, context)
  timeline.setTrack(track)
  params.age = gyr(Math.min(params.age, track.end))
}

function syncInputs(): void {
  massInput.value = String(params.massInitial)
  fehInput.value = toFeH(params.metallicity).toFixed(2)
  speedInput.value = String(Math.log10(params.speed))
  speedLabel.textContent = `${params.speed < 1 ? params.speed.toFixed(2) : params.speed.toFixed(1)}x`
  ageLabel.textContent = formatAge(params.age)
}

massInput.addEventListener('change', () => {
  const parsed = Number.parseFloat(massInput.value)
  params.massInitial = solarMasses(
    Number.isFinite(parsed) ? Math.min(150, Math.max(0.1, parsed)) : params.massInitial,
  )
  rebuildTrack()
  syncInputs()
})

fehInput.addEventListener('change', () => {
  const parsed = Number.parseFloat(fehInput.value)
  params.metallicity = fromFeH(Number.isFinite(parsed) ? parsed : toFeH(params.metallicity))
  rebuildTrack()
  syncInputs()
})

speedInput.addEventListener('input', () => {
  params.speed = Math.pow(10, Number.parseFloat(speedInput.value))
  syncInputs()
})

adaptiveInput.addEventListener('change', () => {
  params.adaptive = adaptiveInput.checked
})

playButton.addEventListener('click', () => {
  params.running = !params.running
  playButton.textContent = params.running ? '❚❚' : '▶'
  playButton.setAttribute('aria-label', params.running ? 'Pause' : 'Play')
})

el<HTMLButtonElement>('restart').addEventListener('click', () => {
  params.age = gyr(0)
  syncInputs()
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

/**
 * Advances the age.
 *
 * Adaptive pacing walks the track's warped coordinate at a constant rate rather than walking time
 * itself, which makes playback slow through transitions and sprint through quiescent burning
 * automatically — the same warp the timeline axis uses. Constant-rate playback cannot show a full
 * lifecycle at any speed setting; this can.
 */
function advance(dt: number): void {
  if (!params.running) return

  if (params.adaptive) {
    const position = track.warp(params.age) + params.speed * ADAPTIVE_RATE * dt
    params.age = position >= 1 ? track.end : track.unwarp(position)
  } else {
    params.age = gyr(Math.min(params.age + params.speed * PROPORTIONAL_RATE * dt, track.end))
  }

  if (params.age >= track.end) {
    params.running = false
    playButton.textContent = '▶'
  }
}

let lastFrame = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now

  advance(dt)

  const star = track.sample(params.age)

  camera.follow(visualExtent(star))
  camera.update(dt)

  recentreButton.disabled = camera.isFollowing

  stage.render(star, camera, dt)
  readout.update(star, stage.optics)
  timeline.setAge(params.age)
  sizeScale.update(camera.span, canvas.clientHeight)
  ageLabel.textContent = formatAge(params.age)

  requestAnimationFrame(frame)
}

syncInputs()
camera.follow(visualExtent(track.sample(params.age)))
camera.snap()
requestAnimationFrame(frame)
