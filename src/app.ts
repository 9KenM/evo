import '@fontsource/inconsolata/400.css'
import '@fontsource/inconsolata/700.css'
import './style.css'

import {
  METALLICITY_MAX,
  METALLICITY_MIN,
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
import { HRDiagram } from './ui/hrDiagram.js'
import { Readout } from './ui/readout.js'
import { SizeScale } from './ui/sizeScale.js'
import { Timeline } from './ui/timeline.js'
import { formatAge } from './ui/format.js'

/**
 * Warped-coordinate progress per second at speed 1. A full lifecycle at unit speed takes about
 * this many seconds, whatever the star's actual lifetime.
 */
const ADAPTIVE_RATE = 1 / 90

/**
 * Fraction of the track traversed per second at speed 1 when adaptive pacing is off.
 *
 * Expressed as a fraction rather than an absolute rate so the toggle stays usable at every mass. A
 * fixed 0.5 Gyr/s played a 30 M☉ star's entire 6.7 Myr life in eighteen milliseconds. Both modes now
 * take about the same wall time; what differs is whether the clock runs in warped or real time,
 * which is the distinction the toggle is actually offering.
 */
const PROPORTIONAL_RATE = 1 / 90

/**
 * Mass range, in log10 solar masses. The upper bound is Hurley's fitted limit — above 100 M☉ the
 * formulae are extrapolation, so the control does not offer it.
 */
const MASS_RANGE = { min: -1, max: 2 }

/** Delay before a slider drag rebuilds the track. The rebuild integrates a wind and is not free. */
const REBUILD_DEBOUNCE_MS = 120

const prefersReducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

interface Params {
  massInitial: SolarMasses
  metallicity: Metallicity
  age: Gyr
  speed: number
  adaptive: boolean
  running: boolean
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element #${id}`)
  return found as T
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))

// --- State, restored from the URL ------------------------------------------

/**
 * The whole view is four numbers and a flag, so it round-trips through the address bar. That makes
 * a particular star at a particular moment linkable, which is the difference between a toy and
 * something you can point someone at.
 */
function readParams(): Params {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const number = (key: string, fallback: number) => {
    const parsed = Number.parseFloat(hash.get(key) ?? '')
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return {
    massInitial: solarMasses(clamp(number('m', 1), 0.1, 100)),
    metallicity: fromFeH(clamp(number('z', 0), toFeH(METALLICITY_MIN as Metallicity), toFeH(METALLICITY_MAX as Metallicity))),
    age: gyr(Math.max(number('t', 0), 0)),
    speed: clamp(number('s', 1), 10 ** -1.5, 10 ** 1.5),
    adaptive: hash.get('a') !== '0',
    running: false,
  }
}

const params: Params = readParams()

let urlTimer = 0
function writeParams(): void {
  window.clearTimeout(urlTimer)
  urlTimer = window.setTimeout(() => {
    const hash = new URLSearchParams({
      m: params.massInitial.toPrecision(4),
      z: toFeH(params.metallicity).toFixed(2),
      t: params.age.toPrecision(6),
      s: params.speed.toPrecision(3),
      a: params.adaptive ? '1' : '0',
    })
    // replaceState rather than a hash assignment, so scrubbing does not fill the back button.
    window.history.replaceState(null, '', `#${hash}`)
  }, 200)
}

// --- Wiring -----------------------------------------------------------------

const canvas = el<HTMLCanvasElement>('canvas')
const stage = new Stage(canvas)
const camera = new Camera()
const readout = new Readout(el('info'))
const sizeScale = new SizeScale(el('sizescale'))
const hrDiagram = new HRDiagram(el('hr'))
const timeline = new Timeline(el('timeline'), (age) => {
  params.age = age
  syncInputs()
})

const massInput = el<HTMLInputElement>('mass')
const massValue = el('massvalue')
const fehInput = el<HTMLInputElement>('feh')
const fehValue = el('fehvalue')
const speedInput = el<HTMLInputElement>('speed')
const speedValue = el('speedvalue')
const adaptiveInput = el<HTMLInputElement>('adaptive')
const playButton = el<HTMLButtonElement>('play')
const ageLabel = el('agevalue')

let track: LifecycleTrack = computeTrack(params.massInitial, params.metallicity)

function rebuildTrack(): void {
  const context = evolutionContext(params.metallicity)
  track = computeTrack(params.massInitial, params.metallicity, context)
  timeline.setTrack(track)
  hrDiagram.setTrack(track)
  params.age = gyr(Math.min(params.age, track.end))
}

let rebuildTimer = 0
function scheduleRebuild(): void {
  window.clearTimeout(rebuildTimer)
  rebuildTimer = window.setTimeout(rebuildTrack, REBUILD_DEBOUNCE_MS)
}

const formatMass = (mass: number) =>
  `${mass < 10 ? mass.toFixed(2) : mass.toFixed(1)} M☉`

function syncInputs(): void {
  massInput.value = Math.log10(params.massInitial).toFixed(4)
  massInput.setAttribute('aria-valuetext', formatMass(params.massInitial))
  massValue.textContent = formatMass(params.massInitial)

  fehInput.value = toFeH(params.metallicity).toFixed(2)
  fehValue.textContent = toFeH(params.metallicity).toFixed(2)

  speedInput.value = Math.log10(params.speed).toFixed(3)
  speedValue.textContent = `${params.speed < 1 ? params.speed.toFixed(2) : params.speed.toFixed(1)}x`

  adaptiveInput.checked = params.adaptive
  ageLabel.textContent = formatAge(params.age)
  writeParams()
}

massInput.addEventListener('input', () => {
  params.massInitial = solarMasses(
    10 ** clamp(Number.parseFloat(massInput.value), MASS_RANGE.min, MASS_RANGE.max),
  )
  massValue.textContent = formatMass(params.massInitial)
  massInput.setAttribute('aria-valuetext', formatMass(params.massInitial))
  scheduleRebuild()
  writeParams()
})

fehInput.addEventListener('input', () => {
  params.metallicity = fromFeH(Number.parseFloat(fehInput.value))
  fehValue.textContent = toFeH(params.metallicity).toFixed(2)
  scheduleRebuild()
  writeParams()
})

speedInput.addEventListener('input', () => {
  params.speed = 10 ** Number.parseFloat(speedInput.value)
  syncInputs()
})

adaptiveInput.addEventListener('change', () => {
  params.adaptive = adaptiveInput.checked
  writeParams()
})

function setRunning(running: boolean): void {
  params.running = running
  playButton.textContent = running ? '❚❚' : '▶'
  playButton.setAttribute('aria-label', running ? 'Pause' : 'Play')
}

playButton.addEventListener('click', () => setRunning(!params.running))
el<HTMLButtonElement>('restart').addEventListener('click', () => {
  params.age = gyr(0)
  syncInputs()
})

const recentreButton = el<HTMLButtonElement>('recentre')
recentreButton.addEventListener('click', () => camera.resetZoom())

// --- Keyboard ---------------------------------------------------------------

const helpButton = el<HTMLButtonElement>('help')
const shortcuts = el('shortcuts')

function toggleHelp(show = shortcuts.hidden): void {
  shortcuts.hidden = !show
  helpButton.setAttribute('aria-expanded', String(show))
}
helpButton.addEventListener('click', () => toggleHelp())

/** Seek by a fraction of the warped strip, so a keypress moves a consistent visible distance. */
function nudge(delta: number): void {
  params.age = track.unwarp(clamp(track.warp(params.age) + delta, 0, 1))
  syncInputs()
}

function toBookmark(direction: 1 | -1): void {
  const ages = track.bookmarks.map((bookmark) => bookmark.age)
  const next =
    direction > 0
      ? ages.find((age) => age > params.age * 1.0001)
      : [...ages].reverse().find((age) => age < params.age * 0.9999)
  params.age = gyr(next ?? (direction > 0 ? track.end : 0))
  syncInputs()
}

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null
  // Never steal keys from a control the viewer is actually using.
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  switch (event.key) {
    case ' ':
      setRunning(!params.running)
      break
    case 'ArrowRight':
      event.shiftKey ? toBookmark(1) : nudge(0.01)
      break
    case 'ArrowLeft':
      event.shiftKey ? toBookmark(-1) : nudge(-0.01)
      break
    case 'ArrowUp':
      params.speed = clamp(params.speed * 1.5, 10 ** -1.5, 10 ** 1.5)
      syncInputs()
      break
    case 'ArrowDown':
      params.speed = clamp(params.speed / 1.5, 10 ** -1.5, 10 ** 1.5)
      syncInputs()
      break
    case 'Home':
      params.age = gyr(0)
      syncInputs()
      break
    case 'End':
      params.age = track.end
      syncInputs()
      break
    case 'a':
    case 'A':
      params.adaptive = !params.adaptive
      syncInputs()
      break
    case 'r':
    case 'R':
      camera.resetZoom()
      break
    case '?':
      toggleHelp()
      break
    case 'Escape':
      if (!shortcuts.hidden) toggleHelp(false)
      else return
      break
    default:
      return
  }
  event.preventDefault()
})

// --- Camera interaction -----------------------------------------------------

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

/*
 * Back, forward, and pasting a link into the tab that is already open.
 *
 * None of those reload the page — a fragment-only navigation just fires this — and `writeParams`
 * uses `replaceState`, which deliberately does not fire it. So every event reaching here is the
 * viewer navigating, and applying it is always right.
 */
window.addEventListener('hashchange', () => {
  const restored = readParams()
  params.massInitial = restored.massInitial
  params.metallicity = restored.metallicity
  params.speed = restored.speed
  params.adaptive = restored.adaptive
  rebuildTrack()
  params.age = gyr(Math.min(restored.age, track.end))
  syncInputs()
})

// --- Clock ------------------------------------------------------------------

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
    params.age = gyr(
      Math.min(params.age + params.speed * PROPORTIONAL_RATE * track.end * dt, track.end),
    )
  }

  if (params.age >= track.end) {
    setRunning(false)
    writeParams()
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
  hrDiagram.setStar(star)
  timeline.setAge(params.age)
  sizeScale.update(camera.span, canvas.clientHeight, star)
  ageLabel.textContent = formatAge(params.age)

  requestAnimationFrame(frame)
}

timeline.setTrack(track)
hrDiagram.setTrack(track)
syncInputs()
camera.follow(visualExtent(track.sample(params.age)))
camera.snap()

// Reduced motion: never start moving on its own. The viewer can still press play.
if (prefersReducedMotion) setRunning(false)

requestAnimationFrame(frame)
