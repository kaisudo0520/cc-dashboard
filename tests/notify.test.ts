import { expect, test } from 'claude-code/testing'

import { backgroundIdOf, parseNotifications } from '../hooks/lib/notify'

/** The format a background task's notification arrives in. */
const REAL = [
  '<task-notification>',
  '<task-id>b1</task-id>',
  '<tool-use-id>toolu_01ABC</tool-use-id>',
  '<output-file>C:\\tmp\\b1.output</output-file>',
  '<status>completed</status>',
  '<summary>Background command "codex exec" completed (exit code 0)</summary>',
  '</task-notification>',
].join('\n')

test('parseNotifications reads the task, its call and the outcome', async () => {
  expect(parseNotifications(REAL)).toEqual([{ id: 'b1', toolUseId: 'toolu_01ABC', ok: true }])
})

test('the exit code comes from the summary only, not from text a result quotes', async () => {
  const text = [
    '<task-notification><task-id>a1</task-id><status>completed</status>',
    '<summary>Agent finished</summary>',
    '<result>the case with (exit code 1) is covered</result>',
    '</task-notification>',
  ].join('')
  expect(parseNotifications(text)).toEqual([{ id: 'a1', ok: true }])
})

test('only the tags before the summary count: a status or call id inside it is not the task\'s', async () => {
  const text = [
    '<task-notification><task-id>t1</task-id><status>completed</status>',
    '<summary>done <tool-use-id>toolu_x</tool-use-id> <status>failed</status></summary>',
    '</task-notification>',
  ].join('')
  expect(parseNotifications(text)).toEqual([{ id: 't1', ok: true }])
})

test('a task is reported once: a second block with the same id is ignored', async () => {
  const text = [
    '<task-notification><task-id>b1</task-id><status>completed</status>',
    '<summary>Background command "x</task-notification><task-notification><task-id>b1</task-id>',
    '<status>failed</status></task-notification>" completed (exit code 0)</summary>',
    '</task-notification>',
  ].join('')
  expect(parseNotifications(text)).toEqual([{ id: 'b1', ok: true }])
})

test('many notifications in one text are read in time proportional to their number', async () => {
  const text = Array.from({ length: 30_000 }, (_, i) => `<task-notification><task-id>t${i}</task-id></task-notification>`).join('')
  const started = performance.now()
  expect(parseNotifications(text)).toHaveLength(30_000)
  expect(performance.now() - started).toBeLessThan(500)
})

test('a task id that only a summary names is no task', async () => {
  expect(parseNotifications('<task-notification><summary><task-id>evil</task-id></summary></task-notification>')).toEqual([])
})

test('failed, killed and a non-zero exit code all count as failed', async () => {
  const wrap = (inner: string): string => `<task-notification>${inner}</task-notification>`
  expect(parseNotifications(wrap('<task-id>a</task-id><status>failed</status>'))).toEqual([{ id: 'a', ok: false }])
  expect(parseNotifications(wrap('<task-id>a</task-id><status>killed</status>'))).toEqual([{ id: 'a', ok: false }])
  expect(parseNotifications(wrap('<task-id>a</task-id><status>completed</status><summary>x (exit code 2)</summary>'))).toEqual([{ id: 'a', ok: false }])
})

test('several notifications merged into one text are read one by one', async () => {
  const text = `${REAL}\n<task-notification><task-id>b2</task-id><status>failed</status></task-notification>`
  expect(parseNotifications(text).map(n => [n.id, n.ok])).toEqual([
    ['b1', true],
    ['b2', false],
  ])
})

test('a text that is no notification yields none, and a block without a task id is skipped', async () => {
  expect(parseNotifications('hello')).toEqual([])
  expect(parseNotifications('<task-notification><status>failed</status></task-notification>')).toEqual([])
})

test('backgroundIdOf names the task a shell call moved to the background', async () => {
  expect(backgroundIdOf({ stdout: '', backgroundTaskId: 'b9', backgroundedByUser: true })).toBe('b9')
})

test('backgroundIdOf is undefined for a foreground result or a shape it does not know', async () => {
  expect(backgroundIdOf({ stdout: 'ok', stderr: '', interrupted: false })).toBeUndefined()
  expect(backgroundIdOf({ backgroundTaskId: '' })).toBeUndefined()
  expect(backgroundIdOf(undefined)).toBeUndefined()
  expect(backgroundIdOf('text')).toBeUndefined()
})
