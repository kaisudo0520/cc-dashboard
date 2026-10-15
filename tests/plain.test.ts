import { expect, test } from 'claude-code/testing'

import { ago, plain } from '../hooks/lib/plain'

test('ago says how long ago in minutes or hours, and never in the future', async () => {
  const now = 10 * 3_600_000
  expect(ago(now - 5_000, now)).toBe('just now')
  expect(ago(now + 5_000, now)).toBe('just now')
  expect(ago(now - 60_000, now)).toBe('1m ago')
  expect(ago(now - 59 * 60_000, now)).toBe('59m ago')
  expect(ago(now - 3_600_000, now)).toBe('1h ago')
  expect(ago(now - 7 * 3_600_000, now)).toBe('7h ago')
  expect(ago(undefined, now)).toBe('—')
})

test('plain turns control, format and tag characters into spaces', async () => {
  expect(plain('a\u001b[31mb\u200ec\u2028d\u{e0041}e')).toBe('a [31mb c d e')
  expect(plain('main')).toBe('main')
})
