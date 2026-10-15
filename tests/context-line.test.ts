import { expect, test } from 'claude-code/testing'

import { BLOCK_GLYPHS, PALETTES, cells, ctxTone } from '../hooks/core'

// The context bar's colour: one for the whole bar and its percent, by how full the context is.

test('ctxTone is green under 50, yellow from 50 to 79, red from 80', () => {
  expect([0, 30, 49].map(ctxTone)).toEqual(['ok', 'ok', 'ok'])
  expect([50, 58, 79].map(ctxTone)).toEqual(['amber', 'amber', 'amber'])
  expect([80, 85, 100].map(ctxTone)).toEqual(['warn', 'warn', 'warn'])
})

test('every palette has the colours ctxTone names: green apart from yellow and red', () => {
  for (const colors of Object.values(PALETTES)) {
    expect([colors.ok, colors.amber, colors.warn].every(c => typeof c === 'string' && c !== '')).toBe(true)
    expect(new Set([colors.ok, colors.amber, colors.warn]).size).toBe(3)
  }
  expect([PALETTES.theme.ok, PALETTES.pastel.ok]).toEqual(['success', '#86efac'])
})

test('the bar glyphs are a full block and a light shade, one cell each', () => {
  expect(BLOCK_GLYPHS).toEqual(['█', '░'])
  expect(BLOCK_GLYPHS.map(cells)).toEqual([1, 1])
})
