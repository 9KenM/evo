import { it } from 'vitest'
import { computeTrack } from './lifecycle.js'
import { evolve } from './star.js'
import { SOLAR } from './metallicity.js'
import { gyr, solarMasses } from './units.js'
import { blackbodyRGB } from './color.js'

it('probe', () => {
  for (const m of [0.8, 1, 5, 15, 30]) {
    const t = computeTrack(solarMasses(m), SOLAR)
    const s = t.sample(gyr(t.phases[2]!.end * 0.999))
    const life = s.lifetimes
    console.log(
      `M=${m}  tMS=${life.mainSequence.toExponential(3)} tHG=${life.subgiant.toExponential(3)} tG=${life.giant.toExponential(3)} total=${life.total.toExponential(3)} end=${t.end.toExponential(3)}`,
    )
    console.log(
      `      tip: L=${s.luminosity.toExponential(3)} R=${s.radius.toFixed(1)} T=${s.temperature.toFixed(0)} type=${s.spectral.type}  mass=${s.mass.toFixed(3)}`,
    )
    console.log(
      `      bookmarks: ${t.bookmarks.map((b) => `${b.label}@${b.age.toExponential(2)}(${(t.warp(b.age) * 100).toFixed(1)}%)`).join(' | ')}`,
    )
    // real-time share of each phase
    console.log(
      `      real shares: ${t.phases.map((p) => (((p.end - p.start) / t.end) * 100).toFixed(4) + '%').join(' ')}`,
    )
  }

  // remnant colours
  console.log('--- remnant appearance ---')
  for (const [m, label] of [
    [1, 'WD'],
    [15, 'NS'],
    [30, 'BH'],
  ] as const) {
    const t = computeTrack(solarMasses(m), SOLAR)
    for (const f of [0.0, 0.1, 0.5, 1.0]) {
      const r = t.phases[3]!
      const age = gyr(r.start + (r.end - r.start) * f + 1e-9)
      const s = t.sample(age)
      console.log(
        `${label} f=${f}: T=${s.temperature.toExponential(3)} L=${s.luminosity.toExponential(2)} R=${s.radius.toExponential(2)} type=${s.spectral.type} rgb=${JSON.stringify(blackbodyRGB(s.temperature))}`,
      )
    }
  }

  // Sun today
  const sun = evolve(solarMasses(1), gyr(4.57))
  console.log(
    `Sun@4.57: L=${sun.luminosity.toFixed(3)} R=${sun.radius.toFixed(3)} T=${sun.temperature.toFixed(0)} ${sun.spectral.type}`,
  )

  // timing
  const t0 = performance.now()
  for (let i = 0; i < 10; i++) computeTrack(solarMasses(1 + i * 0.1), SOLAR)
  console.log(`computeTrack: ${((performance.now() - t0) / 10).toFixed(1)} ms each`)

  const t1 = performance.now()
  const tr = computeTrack(solarMasses(1), SOLAR)
  for (let i = 0; i <= 140; i++) tr.sample(tr.unwarp(i / 140))
  console.log(`strip rebuild (141 samples): ${(performance.now() - t1).toFixed(1)} ms`)
})
