import { expect, test } from 'claude-code/testing'

import { FINISHED_SHOWN_MS, isFresh, nextExpiry } from '../hooks/lib/expiry'

test('a finished row is shown for 60 seconds after it ended', async () => {
  expect(FINISHED_SHOWN_MS).toBe(60_000)
  expect(isFresh(1_000, 1_000)).toBe(true)
  expect(isFresh(1_000, 60_999)).toBe(true)
  expect(isFresh(1_000, 61_000)).toBe(false)
})

test('a row whose end is unknown is never fresh', async () => {
  expect(isFresh(undefined, 0)).toBe(false)
})

test('the next expiry is the earliest end time still fresh, plus 60 seconds', async () => {
  expect(nextExpiry([5_000, 1_000, 30_000], 2_000)).toBe(61_000)
  expect(nextExpiry([5_000, 1_000, 30_000], 61_000)).toBe(65_000)
  expect(nextExpiry([1_000], 61_000)).toBeUndefined()
  expect(nextExpiry([], 0)).toBeUndefined()
})
