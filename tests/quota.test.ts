import { expect, test } from 'claude-code/testing'

import { FABLE_POLL_MS, claudeWindows, fableFromUsage, nextFableDelay, readingOf } from '../hooks/lib/quota'

const RESET = '2026-10-14T20:00:00+00:00'
const RESET_MS = Date.parse(RESET)

test('claudeWindows picks the five-hour and weekly windows out of the session rate limits', async () => {
  const windows = claudeWindows([
    { kind: 'five_hour', percentUsed: 42.4, resetsAt: RESET },
    { kind: 'seven_day', percentUsed: 7 },
    { kind: 'other', percentUsed: 99 },
  ])
  expect(windows).toEqual({
    fiveHour: { usedPercent: 42.4, resetsAtMs: RESET_MS },
    sevenDay: { usedPercent: 7 },
  })
})

test('claudeWindows leaves a window out when the account reports none, and clamps a wild percent', async () => {
  expect(claudeWindows([])).toEqual({ fiveHour: undefined, sevenDay: undefined })
  expect(claudeWindows([{ kind: 'five_hour', percentUsed: 140 }]).fiveHour).toEqual({ usedPercent: 100 })
})

test('a percent that is not a number leaves that window unknown: it is never read as 0% used', async () => {
  expect(claudeWindows([{ kind: 'five_hour', percentUsed: Number.NaN }]).fiveHour).toBeUndefined()
  expect(claudeWindows([{ kind: 'seven_day', percentUsed: Number.POSITIVE_INFINITY }]).sevenDay).toBeUndefined()
  // The other window is still read.
  expect(
    claudeWindows([
      { kind: 'five_hour', percentUsed: Number.NaN },
      { kind: 'seven_day', percentUsed: 10 },
    ]),
  ).toEqual({ fiveHour: undefined, sevenDay: { usedPercent: 10 } })
})

const usageBody = (limits: unknown[]): string => JSON.stringify({ limits })

test('fableFromUsage reads the Fable weekly window from the usage body', async () => {
  const body = usageBody([
    { kind: 'weekly_scoped', scope: { model: { display_name: 'Opus' } }, percent: 5, resets_at: RESET },
    { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 12, resets_at: RESET },
  ])
  expect(fableFromUsage(body)).toEqual({ usedPercent: 12, resetsAtMs: RESET_MS })
})

test('fableFromUsage answers nothing for a body without a Fable window or that is not JSON', async () => {
  expect(fableFromUsage(usageBody([{ kind: 'weekly', percent: 3 }]))).toBeUndefined()
  expect(fableFromUsage(usageBody([{ kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } } }]))).toBeUndefined()
  expect(fableFromUsage('not json')).toBeUndefined()
  expect(fableFromUsage('[]')).toBeUndefined()
})

test('the Fable wait is the usual interval after an answer, and doubles after a failure up to ten minutes', async () => {
  expect(nextFableDelay(400_000, true, undefined)).toBe(FABLE_POLL_MS)
  expect(nextFableDelay(FABLE_POLL_MS, false, undefined)).toBe(180_000)
  expect(nextFableDelay(180_000, false, undefined)).toBe(360_000)
  expect(nextFableDelay(360_000, false, undefined)).toBe(600_000)
  expect(nextFableDelay(600_000, false, undefined)).toBe(600_000)
})

test('the Fable wait honours a longer retry-after, but never more than ten minutes', async () => {
  expect(nextFableDelay(FABLE_POLL_MS, false, '300')).toBe(300_000)
  expect(nextFableDelay(FABLE_POLL_MS, false, '5')).toBe(180_000)
  expect(nextFableDelay(FABLE_POLL_MS, false, '9999')).toBe(600_000)
  expect(nextFableDelay(FABLE_POLL_MS, false, 'soon')).toBe(180_000)
})

test('a window before its reset reads as what is left, and is not stale', async () => {
  expect(readingOf({ usedPercent: 42.4, resetsAtMs: RESET_MS }, RESET_MS - 60_000)).toEqual({ left: 58, isStale: false })
  expect(readingOf({ usedPercent: 100 }, 0)).toEqual({ left: 0, isStale: false })
})

test('a window past its reset keeps the last reading and is marked stale, never shown as full', async () => {
  const reading = readingOf({ usedPercent: 80, resetsAtMs: RESET_MS }, RESET_MS + 60_000)
  expect(reading).toEqual({ left: 20, isStale: true })
  expect(readingOf({ usedPercent: 80, resetsAtMs: RESET_MS }, RESET_MS).isStale).toBe(true)
})
