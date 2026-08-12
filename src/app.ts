import '@fontsource/inconsolata/400.css'
import '@fontsource/inconsolata/700.css'
import './style.css'

import { evolve, gyr, solarMasses, type Gyr, type SolarMasses } from './domain/index.js'
import { Renderer } from './render/renderer.js'
import { Readout } from './ui/readout.js'

interface Params {
  massInitial: SolarMasses
  age: Gyr
  /** Gyr of simulated time per second of wall-clock time. */
  timescale: number
  running: boolean
}

const params: Params = {
  massInitial: solarMasses(1),
  age: gyr(0),
  timescale: 0.6,
  running: false,
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element #${id}`)
  return found as T
}

const canvas = el<HTMLCanvasElement>('canvas')
const renderer = new Renderer(canvas)
const readout = new Readout(el('info'))

const massInput = el<HTMLInputElement>('mass')
const ageInput = el<HTMLInputElement>('age')
const timescaleInput = el<HTMLInputElement>('timescale')
const playButton = el<HTMLButtonElement>('play')

const readNumber = (input: HTMLInputElement, fallback: number, min: number): number => {
  const parsed = Number.parseFloat(input.value)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

function syncInputs(): void {
  massInput.value = String(params.massInitial)
  ageInput.value = params.age.toPrecision(4)
  timescaleInput.value = String(params.timescale)
}

massInput.addEventListener('change', () => {
  params.massInitial = solarMasses(readNumber(massInput, params.massInitial, 0.08))
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

el<HTMLButtonElement>('recentre').addEventListener('click', () => renderer.recentre())

let lastFrame = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now

  if (params.running) {
    params.age = gyr(params.age + params.timescale * dt)
    ageInput.value = params.age.toPrecision(4)
  }

  const star = evolve(params.massInitial, params.age)
  renderer.render(star)
  readout.update(star)

  requestAnimationFrame(frame)
}

syncInputs()
requestAnimationFrame(frame)
