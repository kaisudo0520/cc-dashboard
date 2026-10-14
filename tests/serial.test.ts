import { expect, test } from 'claude-code/testing'

import { serial } from '../hooks/lib/serial'

test('jobs run one after another in the order given, even when an earlier one is slower', async () => {
  const run = serial()
  const order: string[] = []
  let release: () => void = () => undefined
  const slow = run(async () => {
    await new Promise<void>(resolve => void (release = resolve))
    order.push('slow')
  })
  const quick = run(async () => void order.push('quick'))

  await Promise.resolve()
  expect(order).toEqual([])
  release()
  await Promise.all([slow, quick])

  expect(order).toEqual(['slow', 'quick'])
})

test('each job answers with its own result', async () => {
  const run = serial()

  expect(await run(async () => 1)).toBe(1)
  expect(await run(async () => 'two')).toBe('two')
})

test('a job that fails rejects for its caller and does not stop the jobs behind it', async () => {
  const run = serial()
  const failed = run(async () => Promise.reject(new Error('boom')))
  const after = run(async () => 'still runs')

  await expect(failed).rejects.toThrow('boom')
  expect(await after).toBe('still runs')
})
