import { expect, test } from 'claude-code/testing'

import { FABLE_POLL_MS, fableFromUsage, nextFableDelay } from '../hooks/lib/fable'

const RESET = '2026-10-14T20:00:00+00:00'
const RESET_MS = Date.parse(RESET)

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
