import type { StarState } from '../domain/index.js'
import { cssRGB, toFeH } from '../domain/index.js'

function num(value: number, unit = ''): string {
  const abs = Math.abs(value)
  const text =
    abs === 0
      ? '0'
      : abs < 1e-3 || abs >= 1e5
        ? value.toExponential(2)
        : abs < 1
          ? value.toPrecision(3)
          : value.toFixed(abs < 100 ? 2 : 0)
  return unit ? `${text} ${unit}` : text
}

function age(gyrValue: number): string {
  if (gyrValue < 1e-6) return `${num(gyrValue * 1e9)} yr`
  if (gyrValue < 1e-3) return `${num(gyrValue * 1e6)} kyr`
  if (gyrValue < 1) return `${num(gyrValue * 1e3)} Myr`
  return `${num(gyrValue)} Gyr`
}

const ROW = (label: string, value: string) =>
  `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`

export class Readout {
  constructor(private readonly root: HTMLElement) {}

  update(star: StarState): void {
    const { lifetimes: life } = star

    this.root.innerHTML = [
      `<div class="swatch" style="background:${cssRGB(star.color)}"></div>`,
      `<div class="type">${star.spectral.type ?? star.stage}</div>`,
      ROW('stage', star.stage),
      ROW('age', age(star.age)),
      ROW('mass', num(star.mass, 'M☉')),
      ROW('initial mass', num(star.massInitial, 'M☉')),
      ROW('[Fe/H]', toFeH(star.metallicity).toFixed(2)),
      ROW('radius', num(star.radius, 'R☉')),
      ROW('luminosity', num(star.luminosity, 'L☉')),
      ROW('temperature', num(star.temperature, 'K')),
      '<hr>',
      ROW('ZAMS', `${num(star.zams.luminosity)} L☉ / ${num(star.zams.radius)} R☉`),
      ROW('TAMS', `${num(star.tams.luminosity)} L☉ / ${num(star.tams.radius)} R☉`),
      '<hr>',
      ROW('main sequence', age(life.mainSequence)),
      ROW('subgiant', age(life.subgiant)),
      ROW('giant', age(life.giant)),
      ROW('remnant at', age(life.total)),
    ].join('')
  }
}
