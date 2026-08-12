export const STAGES = [
  'main sequence',
  'subgiant',
  'giant',
  'white dwarf',
  'neutron star',
  'black hole',
] as const

export type Stage = (typeof STAGES)[number]

export const isRemnant = (stage: Stage): boolean =>
  stage === 'white dwarf' || stage === 'neutron star' || stage === 'black hole'
