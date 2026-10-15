import { expect, test } from 'claude-code/testing'

import type { Panel } from '../hooks/core'
import { cells, narrowEffort, pairRows, pairWidths, wrapRows } from '../hooks/core'

// Side-by-side panels: in a single-column pane at least 70 columns wide, main|Codex and branch|gate
// share a row. These are the pure pieces; tests/pairs-pane.test.ts draws them.

test('a pair of panels splits the pane around a one-cell gap, the left taking the odd cell; under 70 columns there is no pair', () => {
  expect([pairWidths(69), pairWidths(40)]).toEqual([null, null])
  expect(pairWidths(70)).toEqual([35, 34])
  expect(pairWidths(78)).toEqual([39, 38])
  expect(pairWidths(94)).toEqual([47, 46])
  for (const w of [70, 71, 78, 109]) {
    const [l, r] = pairWidths(w) ?? [0, 0]
    expect(l + 1 + r).toBe(w)
  }
})

const ALL: Panel[] = ['main', 'codex', 'git', 'architect', 'gate', 'agents', 'loops', 'receipt', 'log']

test('main|codex pair where main sits and branch|gate where the branch sits, the gate rising over the architect', () => {
  expect(pairRows(ALL)).toEqual([['main', 'codex'], ['git', 'gate'], 'architect', 'agents', 'loops', 'receipt', 'log'])
})

test('a panel whose partner is absent keeps its row to itself', () => {
  expect(pairRows(ALL.filter(p => p !== 'codex'))).toEqual(['main', ['git', 'gate'], 'architect', 'agents', 'loops', 'receipt', 'log'])
  expect(pairRows(ALL.filter(p => p !== 'gate'))).toEqual([['main', 'codex'], 'git', 'architect', 'agents', 'loops', 'receipt', 'log'])
  expect(pairRows(['main', 'architect', 'agents', 'log'])).toEqual(['main', 'architect', 'agents', 'log'])
})

test('only panels the person listed side by side pair: others between them keep the stack, either order pairs', () => {
  expect(pairRows(['main', 'log', 'codex'])).toEqual(['main', 'log', 'codex'])
  expect(pairRows(['git', 'agents', 'gate'])).toEqual(['git', 'agents', 'gate'])
  expect(pairRows(['gate', 'architect', 'git'])).toEqual(['gate', 'architect', 'git'])
  expect(pairRows(['git', 'gate', 'architect'])).toEqual([['git', 'gate'], 'architect'])
  expect(pairRows(['codex', 'main', 'log'])).toEqual([['main', 'codex'], 'log'])
  expect(pairRows(['log', 'main', 'codex', 'receipt'])).toEqual(['log', ['main', 'codex'], 'receipt'])
})

test('the narrow effort line is the bar, the effort, the mode and the count on one dotted line, the mode cut to fit', () => {
  expect(narrowEffort('high', 'auto', 12, 31)).toEqual({ effort: 'high', tail: ' · auto · 12 req' })
  expect(narrowEffort('', '', 0, 31)).toEqual({ effort: '—', tail: ' · 0 req' })
  // The bar and its space take 5 cells; whatever the effort, mode and count, the line stays within the box.
  for (const effort of ['', 'low', 'medium', 'xhigh', 'max']) {
    for (const mode of ['', 'auto', 'acceptEdits', 'bypassPermissions', 'a-very-long-mode-name-indeed']) {
      for (const steps of [0, 7, 123, 12_345]) {
        for (const inner of [26, 31, 35, 46]) {
          const { effort: label, tail } = narrowEffort(effort, mode, steps, inner)
          expect(5 + cells(label) + cells(tail)).toBeLessThanOrEqual(inner)
          expect(tail.endsWith(` · ${steps} req`)).toBe(true)
        }
      }
    }
  }
  expect(narrowEffort('xhigh', 'bypassPermissions', 123, 31).tail).toBe(' · bypassP… · 123 req')
})

test('items that wrap onto rows are counted by how many fit a row with the gap between them', () => {
  expect(wrapRows([], 30, 2)).toBe(0)
  expect(wrapRows([12, 14, 10], 40, 2)).toBe(1) // 12 + 2 + 14 + 2 + 10 = 40
  expect(wrapRows([12, 14, 10], 39, 2)).toBe(2)
  expect(wrapRows([12, 14, 10], 28, 2)).toBe(2) // 12 + 2 + 14, then 10
  expect(wrapRows([20, 20, 20], 30, 2)).toBe(3)
  expect(wrapRows([50], 30, 2)).toBe(1) // one too wide for a row still takes one
})
