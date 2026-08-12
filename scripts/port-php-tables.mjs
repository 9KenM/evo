#!/usr/bin/env node
/*
 * Ports the tabulated stellar properties out of the retired genTables.php into JSON.
 *
 * These tables are the one genuinely valuable thing in the PHP codebase: radius, mass and
 * luminosity for every spectral type crossed with every luminosity class. They become the
 * validation fixtures for the new ZAMS implementation.
 *
 * Rows whose comment flags them as guessed (the L/T/Y brown-dwarf rows are annotated
 * "*Unknown - Copied from MIV") are carried across but marked unreliable, so tests can exclude
 * them rather than validating physics against placeholder values.
 *
 * Usage:  node scripts/port-php-tables.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const php = readFileSync(resolve('genTables.php'), 'utf8')

function parseTable(name) {
  const declaration = `$${name} = array(`
  const start = php.indexOf(declaration)
  if (start === -1) throw new Error(`no table named ${name}`)
  const end = php.indexOf('\n\t);', start)
  // Skip past the declaration's own `array(` so it is not matched as a data row.
  const body = php.slice(start + declaration.length, end)

  const rows = []
  const pattern = /array\(([^)]*)\)\s*,\s*\/\/\s*(.+)/g
  let match
  while ((match = pattern.exec(body)) !== null) {
    const [, numbers, rawLabel] = match
    const values = numbers
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map(Number)

    if (values.some((v) => !Number.isFinite(v))) throw new Error(`bad row in ${name}: ${rawLabel}`)

    const label = rawLabel.trim()
    const unreliable = label.includes('*Unknown')
    const [spectralClass, luminosityClass] = label.replace(/\s*\*.*$/, '').split(/\s+/)

    rows.push({
      label: label.replace(/\s*\*.*$/, '').trim(),
      spectralClass,
      luminosityClass: luminosityClass ?? null,
      unreliable,
      values,
    })
  }
  return rows
}

const radius = parseTable('radiusTable')
const mass = parseTable('massTable')
const luminosity = parseTable('luminosityTable')

/** Joins the three tables into one record per (spectral class, luminosity class, subtype). */
const entries = []
for (const [index, radiusRow] of radius.entries()) {
  const massRow = mass[index]
  const lumRow = luminosity[index]
  if (!massRow || !lumRow) continue
  if (massRow.label !== radiusRow.label || lumRow.label !== radiusRow.label) {
    throw new Error(`row ${index} label mismatch: ${radiusRow.label} / ${massRow.label}`)
  }

  for (let subtype = 0; subtype < 10; subtype++) {
    const r = radiusRow.values[subtype]
    const m = massRow.values[subtype]
    const l = lumRow.values[subtype]
    if (r === undefined || m === undefined || l === undefined) continue

    entries.push({
      spectralClass: radiusRow.spectralClass,
      luminosityClass: radiusRow.luminosityClass,
      subtype,
      mass: m,
      radius: r,
      luminosity: l,
      unreliable: radiusRow.unreliable,
    })
  }
}

const target = resolve('src/data/zams-tables.json')
writeFileSync(
  target,
  `${JSON.stringify(
    {
      $provenance:
        'Ported from genTables.php (retired) by scripts/port-php-tables.mjs. Mass in M_sun, ' +
        'radius in R_sun, luminosity in L_sun. Entries marked unreliable were annotated in the ' +
        'source as guessed placeholders rather than tabulated values.',
      entries,
    },
    null,
    1,
  )}\n`,
)

const usable = entries.filter((e) => !e.unreliable).length
console.log(`wrote ${target}`)
console.log(`  ${entries.length} entries (${usable} usable, ${entries.length - usable} flagged)`)
