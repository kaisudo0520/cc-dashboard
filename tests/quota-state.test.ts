import { expect, test } from 'claude-code/testing'

import { apply, initialState } from '../hooks/lib/state'
import type { DashEvent } from '../hooks/lib/state'
import type { DashState, UsageWindow } from '../types'

const fold = (events: readonly DashEvent[], from: DashState = initialState): DashState => events.reduce(apply, from)

const W = (usedPercent: number, resetsAtMs?: number): UsageWindow =>
  resetsAtMs === undefined ? { usedPercent } : { usedPercent, resetsAtMs }

test('the initial quota knows nothing', async () => {
  expect(initialState.quota).toEqual({ claude: {}, codex: {} })
})

test('claude-quota sets the five-hour and weekly windows', async () => {
  const s = fold([{ type: 'claude-quota', fiveHour: W(40, 100), sevenDay: W(7) }])
  expect(s.quota.claude).toEqual({ fiveHour: W(40, 100), sevenDay: W(7) })
})

test('a reading with no window keeps the last one rather than blanking it', async () => {
  const s = fold([
    { type: 'claude-quota', fiveHour: W(40, 100), sevenDay: W(7) },
    { type: 'claude-quota', sevenDay: W(8) },
  ])
  expect(s.quota.claude.fiveHour).toEqual(W(40, 100))
  expect(s.quota.claude.sevenDay).toEqual(W(8))
})

test('a Fable answer sets the window and clears the stale mark', async () => {
  const s = fold([{ type: 'fable' }, { type: 'fable', fable: W(12, 500) }])
  expect(s.quota.claude.fable).toEqual(W(12, 500))
  expect(s.quota.claude.isFableStale).toBe(false)
})

test('a Fable failure keeps the last window and marks it stale, and marks nothing when there never was one', async () => {
  const known = fold([{ type: 'fable', fable: W(12, 500) }, { type: 'fable' }])
  expect(known.quota.claude).toMatchObject({ fable: W(12, 500), isFableStale: true })

  const never = fold([{ type: 'fable' }])
  expect(never.quota.claude.fable).toBeUndefined()
  expect(never.quota.claude.isFableStale).toBe(false)
})

test('a Codex reading replaces the model, effort and note, and its windows when it has them', async () => {
  const s = fold([
    { type: 'codex-quota', quota: { model: 'gpt-6-sol', effort: 'high', fiveHour: W(10, 1), weekly: W(2, 2) } },
    { type: 'codex-quota', quota: { model: 'gpt-6-sol', effort: 'low', fiveHour: W(30, 3), weekly: W(4, 4) } },
  ])
  expect(s.quota.codex).toEqual({ model: 'gpt-6-sol', effort: 'low', fiveHour: W(30, 3), weekly: W(4, 4) })
})

test('a Codex read that finds no figures keeps the last windows and carries its note', async () => {
  const s = fold([
    { type: 'codex-quota', quota: { model: 'gpt-6-sol', fiveHour: W(10, 1), weekly: W(2, 2) } },
    { type: 'codex-quota', quota: { model: 'gpt-6-sol', note: 'no usage recorded yet' } },
  ])
  expect(s.quota.codex).toEqual({ model: 'gpt-6-sol', fiveHour: W(10, 1), weekly: W(2, 2), note: 'no usage recorded yet' })
})

test('reset starts the conversation over but keeps the account quota', async () => {
  const s = fold([
    { type: 'claude-quota', fiveHour: W(40, 100) },
    { type: 'turn-start', at: 1, turns: 1 },
    { type: 'reset' },
  ])
  expect(s.quota.claude.fiveHour).toEqual(W(40, 100))
  expect(s.main.turns).toBe(0)
})

test('quota events never mutate the state they are given', async () => {
  const before = JSON.stringify(initialState)
  apply(initialState, { type: 'claude-quota', fiveHour: W(1) })
  apply(initialState, { type: 'fable', fable: W(1) })
  apply(initialState, { type: 'codex-quota', quota: { model: 'm' } })
  expect(JSON.stringify(initialState)).toBe(before)
})
