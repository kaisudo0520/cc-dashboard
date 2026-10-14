import { expect, test } from 'claude-code/testing'

import { quotaRows } from '../hooks/lib/quota-rows'
import { apply, initialState } from '../hooks/lib/state'
import type { DashEvent } from '../hooks/lib/state'
import type { DashState } from '../types'

const NOW = 10_000_000
const HOUR = 3_600_000

const fold = (events: readonly DashEvent[]): DashState => events.reduce(apply, initialState)

test('with nothing read every row is unknown and says so with a dash', async () => {
  const rows = quotaRows(initialState, NOW)
  expect(rows.claudeTitle).toBe('Claude —')
  expect(rows.claude.map(r => [r.label, r.left, r.detail])).toEqual([
    ['5小時', undefined, '—'],
    ['1週', undefined, '—'],
    ['Fable', undefined, '—'],
  ])
  expect(rows.codexTitle).toBe('Codex —')
  expect(rows.codex.map(r => [r.label, r.left])).toEqual([
    ['5小時', undefined],
    ['每週', undefined],
  ])
  expect(rows.codexNote).toBeUndefined()
})

test('the titles name the model and effort of each side', async () => {
  const s = fold([
    { type: 'session', model: 'claude-opus-5-5', turns: 0 },
    { type: 'step', model: 'claude-opus-5-5', effort: 'xhigh' },
    { type: 'codex-quota', quota: { model: 'gpt-6-sol', effort: 'high' } },
  ])
  const rows = quotaRows(s, NOW)
  expect(rows.claudeTitle).toBe('Claude opus-5-5 · xhigh')
  expect(rows.codexTitle).toBe('Codex gpt-6-sol · high')
})

test('a window shows what is left and when it resets', async () => {
  const s = fold([
    {
      type: 'claude-quota',
      fiveHour: { usedPercent: 42.4, resetsAtMs: NOW + HOUR + 5 * 60_000 },
      sevenDay: { usedPercent: 7, resetsAtMs: NOW + 2 * 24 * HOUR + 3 * HOUR },
    },
  ])
  const [five, week] = quotaRows(s, NOW).claude
  expect(five).toEqual({ label: '5小時', left: 58, isStale: false, detail: '1h05m' })
  expect(week).toEqual({ label: '1週', left: 93, isStale: false, detail: '2d3h' })
})

test('a window past its reset keeps its last figure, marked stale, and is never shown full', async () => {
  const s = fold([{ type: 'claude-quota', fiveHour: { usedPercent: 80, resetsAtMs: NOW - 1000 } }])
  const five = quotaRows(s, NOW).claude[0]
  expect(five).toEqual({ label: '5小時', left: 20, isStale: true, detail: '過期' })
})

test('the header carries no context row: the Context bar below the CODEX block is the one context display', async () => {
  const s = fold([{ type: 'context', context: { tokens: 84_000, window: 200_000, percent: 42 } }])
  expect(quotaRows(s, NOW).claude.map(r => r.label)).toEqual(['5小時', '1週', 'Fable'])
})

test('a Fable window whose last refresh failed carries a mark on its label', async () => {
  const s = fold([
    { type: 'fable', fable: { usedPercent: 12, resetsAtMs: NOW + HOUR } },
    { type: 'fable' },
  ])
  expect(quotaRows(s, NOW).claude[2]).toEqual({ label: 'Fable~', left: 88, isStale: false, detail: '1h00m' })
})

test('Codex windows and its note come through, with the same stale rule', async () => {
  const s = fold([
    {
      type: 'codex-quota',
      quota: {
        model: 'gpt-6-sol',
        fiveHour: { usedPercent: 13, resetsAtMs: NOW + 30 * 60_000 },
        weekly: { usedPercent: 50, resetsAtMs: NOW - 1 },
        note: 'no usage recorded yet',
      },
    },
  ])
  const rows = quotaRows(s, NOW)
  expect(rows.codex[0]).toEqual({ label: '5小時', left: 87, isStale: false, detail: '30m' })
  expect(rows.codex[1]).toEqual({ label: '每週', left: 50, isStale: true, detail: '過期' })
  expect(rows.codexNote).toBe('no usage recorded yet')
})
