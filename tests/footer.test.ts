import { expect, test } from 'claude-code/testing'

import { footerHint } from '../hooks/lib/footer'

test('the Footer always names 1', async () => {
  expect(footerHint(false, false)).toBe('1額度')
})

test('with the 分支 panel it names 2, and u only when there is a list to unfold', async () => {
  expect(footerHint(true, false)).toBe('1額度 2分支')
  expect(footerHint(true, true)).toBe('1額度 2分支 u路徑')
})

test('without the panel there is no u even if a list was left over', async () => {
  expect(footerHint(false, true)).toBe('1額度')
})
