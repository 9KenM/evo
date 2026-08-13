import type { StarState } from '../domain/index.js'
import { cssRGB, toFeH } from '../domain/index.js'
import type { CameraOptics } from '../render/exposure.js'
import { formatAge, formatLength, num } from './format.js'

const ROW = (label: string, value: string) =>
  `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`

export class Readout {
  private readonly root: HTMLElement
  private last = ''

  constructor(root: HTMLElement) {
    this.root = root
  }

  update(star: StarState, optics?: CameraOptics | null): void {
    const camera = optics
      ? [
          '<hr>',
          ROW('camera distance', formatLength(optics.distance)),
          ROW('exposure', `${optics.stops >= 0 ? '+' : ''}${optics.stops.toFixed(1)} stops`),
        ]
      : []

    // The core mass is the quantity that drives everything past the main sequence, so it earns a
    // row of its own — it is not a derived curiosity, it is the state variable.
    const core =
      star.coreMass > 0 ? [ROW('core mass', num(star.coreMass, 'M☉'))] : []

    const html = [
      `<div class="swatch" style="background:${cssRGB(star.color)}"></div>`,
      `<div class="type">${star.spectral.type ?? star.stage}</div>`,
      ROW('stage', star.stage),
      ROW('age', formatAge(star.age)),
      ROW('mass', num(star.mass, 'M☉')),
      ...core,
      ROW('initial mass', num(star.massInitial, 'M☉')),
      ROW('[Fe/H]', toFeH(star.metallicity).toFixed(2)),
      ROW('radius', formatLength(star.radius)),
      ROW('luminosity', num(star.luminosity, 'L☉')),
      ROW('temperature', num(star.temperature, 'K')),
      '<hr>',
      ROW('ZAMS', `${num(star.zams.luminosity)} L☉ / ${num(star.zams.radius)} R☉`),
      ROW('TAMS', `${num(star.tams.luminosity)} L☉ / ${num(star.tams.radius)} R☉`),
      ...camera,
    ].join('')

    // Rebuilt every frame otherwise, which tears down and recreates ~15 nodes at 60 Hz and makes
    // the panel's text unselectable.
    if (html !== this.last) {
      this.last = html
      this.root.innerHTML = html
    }
  }
}
