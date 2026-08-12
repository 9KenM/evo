#!/usr/bin/env node
/*
 * Extracts the fitting-formula coefficient tables into JSON.
 *
 * The numbers are published data: Tout, Pols, Eggleton & Han (1996) MNRAS 281, 257 Table 1 for the
 * ZAMS sets, and Hurley, Pols & Tout (2000) MNRAS 315, 543 Appendix for the rest. They are read
 * mechanically out of a reference `zdata.h` rather than typed in, because hand-transcribing several
 * hundred constants is the single most likely way to end up with plausible-looking wrong physics.
 *
 * Usage:  node scripts/extract-sse-coefficients.mjs <path-to-zdata.h>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = process.argv[2]
if (!source) {
  console.error('usage: node scripts/extract-sse-coefficients.mjs <path-to-zdata.h>')
  process.exit(1)
}

const text = readFileSync(source, 'utf8')

/** Pulls one `data <name> / ... /` block and returns its numbers in order. */
function block(name) {
  const start = text.indexOf(`data ${name} /`)
  if (start === -1) throw new Error(`no data block for ${name}`)
  const end = text.indexOf('/', start + `data ${name} /`.length)
  const body = text.slice(start + `data ${name} /`.length, end)

  return body
    .split('\n')
    .map((line) => line.replace(/^\s*&/, ''))
    .join(' ')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const value = Number(token.replace(/[dD]/, 'e'))
      if (!Number.isFinite(value)) throw new Error(`unparsed constant in ${name}: "${token}"`)
      return value
    })
}

const expected = { xz: 76, xt: 31, xl: 72, xr: 119, xg: 112, xh: 99 }
const out = {}

for (const [name, count] of Object.entries(expected)) {
  const values = block(name)
  if (values.length !== count) {
    throw new Error(`${name}: expected ${count} constants, parsed ${values.length}`)
  }
  out[name] = values
}

const target = resolve('src/data/sse-coefficients.json')
writeFileSync(
  target,
  `${JSON.stringify(
    {
      $provenance:
        'Tout, Pols, Eggleton & Han (1996) MNRAS 281, 257 Table 1 (xz); ' +
        'Hurley, Pols & Tout (2000) MNRAS 315, 543 Appendix (xt, xl, xr, xg, xh). ' +
        'Extracted mechanically by scripts/extract-sse-coefficients.mjs.',
      ...out,
    },
    null,
    1,
  )}\n`,
)

console.log(`wrote ${target}`)
for (const [name, count] of Object.entries(expected)) console.log(`  ${name}: ${count}`)
