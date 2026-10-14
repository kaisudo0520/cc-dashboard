import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  MARKS,
  NARROW_PROPS,
  NOW,
  PROCESSES,
  REGISTRY,
  SHOWN,
  TASKLIST,
  WAITING_B,
  beginTurn,
  endTurn,
  engine,
  markFile,
  order,
  readyPane,
  registryFile,
  start,
  text,
  twoSessions,
} from './harness'
import type { Clock, World } from './harness'

// --- Wait banner ----------------------------------------------------------------

// The engine hands paths on in the platform's own form; the world is written with slashes.
const slashed = (paths: readonly string[]): string[] => paths.map(path => path.replaceAll('\\', '/'))

const myMark = (world: World): unknown => JSON.parse(world.files[`${MARKS}/11.json`] ?? '{}')
const myReason = (world: World): unknown => (myMark(world) as { reason?: unknown }).reason

test('another session waiting on the person shows one banner line below the quota header', async ($, on) => {
  const { clock } = engine(on, twoSessions(WAITING_B))
  const pane = await readyPane($, clock)

  expect(await text(pane, '! 等你回應：other-session 權限 2分前')).toBeDefined()
  expect(await order(pane, ['quota', 'wait-banner', 'header'])).toEqual(['quota', 'wait-banner', 'header'])
  // This session is never listed as waiting on itself.
  expect(await text(pane, /here-session/)).toBeUndefined()
})

test('the banner is one truncated line on a narrow pane too', async ($, on) => {
  const { clock } = engine(on, twoSessions(WAITING_B))
  const pane = await readyPane($, clock, NARROW_PROPS)

  const line = await text(pane, /! 等你回應：other-session/)
  expect(line?.props.wrap).toBe('truncate-end')
  expect(await order(pane, ['quota', 'wait-banner'])).toEqual(['quota', 'wait-banner'])
})

test('with nobody waiting there is no banner at all', async ($, on) => {
  const { clock } = engine(on, twoSessions({ [`${MARKS}/22.json`]: markFile('session-b', null, 0) }))
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()
  expect(await text(pane, /等你回應/)).toBeUndefined()
})

test('more than one waiting session adds how many more, the longest wait first', async ($, on) => {
  const base = twoSessions({
    ...WAITING_B,
    [`${REGISTRY}/33.json`]: registryFile(33, 'session-c', 'third-session'),
    [`${MARKS}/33.json`]: markFile('session-c', 'question', NOW - 5_000),
  })
  const { clock } = engine(on, {
    ...base,
    dirs: { [REGISTRY]: [...(base.dirs?.[REGISTRY] ?? []), { name: '33.json', kind: 'file' }] },
    tasklist: { exitCode: 0, stdout: `${PROCESSES}"claude.exe","33","Console","1","5 K"\r\n` },
  })
  const pane = await readyPane($, clock)

  expect(await text(pane, '! 等你回應：other-session 權限 2分前 · 另有 1')).toBeDefined()
})

test('a mark left by another session under a reused pid is not a wait', async ($, on) => {
  const { clock } = engine(on, twoSessions({ [`${MARKS}/22.json`]: markFile('some-dead-session', 'permission', NOW - 60_000) }))
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()
})

test('a session whose process is gone, or is not Claude Code, is not listed even with a mark', async ($, on) => {
  const { clock } = engine(on, {
    ...twoSessions(WAITING_B),
    tasklist: { exitCode: 0, stdout: '"claude.exe","11","Console","1","5 K"\r\n"chrome.exe","22","Console","1","5 K"\r\n' },
  })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()
})

test('when tasklist fails there is no banner: nothing is guessed', async ($, on) => {
  const { clock } = engine(on, { ...twoSessions(WAITING_B), tasklist: { exitCode: 1, stdout: '' } })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()
})

test('when the session registry cannot be read there is no banner', async ($, on) => {
  const { clock } = engine(on, { ...twoSessions(WAITING_B), dirs: {} })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()
})

test('a banner goes away once the other session stops waiting, and comes back when it waits again', async ($, on) => {
  const { world, clock } = engine(on, twoSessions(WAITING_B))
  const pane = await readyPane($, clock)
  expect(await pane.find({ key: 'wait-banner' })).toBeDefined()

  world.files[`${MARKS}/22.json`] = markFile('session-b', null, 0)
  await clock.advance(7_000)
  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()

  world.files[`${MARKS}/22.json`] = markFile('session-b', 'question', NOW)
  await clock.advance(7_000)
  expect(await text(pane, /! 等你回應：other-session 提問/)).toBeDefined()
})

test('other sessions\' marks and the process table are not read while the pane is not shown', async ($, on) => {
  const { world, clock } = engine(on, { ...twoSessions(WAITING_B), panes: [] })
  await start($)
  await clock.advance(1)
  // Starting looks the session up once, to learn which process writes its own mark.
  const afterStart = world.taskCalls.length
  world.fileReads.length = 0

  await clock.advance(600_000)
  expect(world.taskCalls).toHaveLength(afterStart)
  expect(slashed(world.fileReads)).not.toContain(`${MARKS}/22.json`)

  world.panes = [SHOWN]
  await clock.advance(7_000)
  expect(slashed(world.fileReads)).toContain(`${MARKS}/22.json`)
})

test('marks are read about every 5 seconds and the process table every 30, with one poller', async ($, on) => {
  const { world, clock } = engine(on, twoSessions(WAITING_B))
  await start($)
  await start($)
  await clock.advance(3_000)
  world.fileReads.length = 0
  const tasks = world.taskCalls.length

  await clock.advance(300_000)
  const markReads = slashed(world.fileReads).filter(path => path === `${MARKS}/22.json`).length
  expect(markReads).toBeGreaterThanOrEqual(45)
  expect(markReads).toBeLessThanOrEqual(60)
  expect(world.taskCalls.length - tasks).toBeGreaterThanOrEqual(9)
  expect(world.taskCalls.length - tasks).toBeLessThanOrEqual(11)
})

test('a poll that finds the same waits as the last one changes nothing, so nothing is redrawn', async ($, on) => {
  const { clock } = engine(on, twoSessions(WAITING_B))
  let dashWrites = 0
  on('state.set', (_$, e, next) => {
    if (e.key === 'dash') dashWrites += 1
    return next(e)
  })
  await readyPane($, clock)
  const afterFirst = dashWrites

  await clock.advance(20_000)
  expect(dashWrites).toBe(afterFirst)
})

test('the process table is asked with a fixed command and no shell', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await readyPane($, clock)

  expect(world.taskCalls[0]).toEqual([TASKLIST, '/FO', 'CSV', '/NH'])
})

test('without SystemRoot the process table is not run at all: no banner and no mark, and nothing throws', async ($, on) => {
  const { world, clock } = engine(on, { ...twoSessions(WAITING_B), systemRoot: undefined })
  const pane = await readyPane($, clock)
  await permissionDialog($)
  await clock.advance(1)

  expect(world.taskCalls).toEqual([])
  expect(world.writes).toEqual([])
  expect(await pane.find({ key: 'wait-banner' })).toBeUndefined()
})

// --- This session's own wait mark ---------------------------------------------------
// The mark is written where status-sidebar's sessions read it: the same folder, named by pid,
// {sessionId, reason, sinceMs}. It is written by events, so the pane need not be showing.

const startedSession = async ($: Engine, clock: Clock) => {
  await start($)
  await clock.advance(1)
}

const permissionDialog = ($: Engine) =>
  $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push' } })

test('starting writes the mark as it stands: no wait', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await startedSession($, clock)

  expect(world.writes.map(w => w.path)).toEqual([`${MARKS}/11.json`])
  expect(myMark(world)).toEqual({ sessionId: 'session-a', reason: null, sinceMs: 0 })
})

test('a permission dialog marks this session as waiting until its call returns', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await startedSession($, clock)

  await permissionDialog($)
  await clock.advance(1)
  expect(myMark(world)).toEqual({ sessionId: 'session-a', reason: 'permission', sinceMs: NOW + 1 })

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'git push', description: 'Push' })
  await clock.advance(1)
  expect(myReason(world)).toBe(null)
})

test('marks land in the order they were asked, so a slow write never leaves an old wait as the last word', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await startedSession($, clock)
  let release: () => void = () => undefined
  world.writeHolds = [new Promise<void>(resolve => void (release = resolve))]

  // The dialog's write is held on a slow disk; the person answers meanwhile and that write is not.
  const dialog = permissionDialog($)
  await clock.advance(1)
  const answer = $.prompt.submit({ text: 'never mind', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1)
  release()
  await Promise.all([dialog, answer])
  await clock.advance(1)

  expect(myReason(world)).toBe(null)
})

test('the mark is written with the pane closed, and a repeated dialog writes nothing new', async ($, on) => {
  const { world, clock } = engine(on, { ...twoSessions(), panes: [] })
  await startedSession($, clock)
  const afterStart = world.writes.length

  await permissionDialog($)
  await clock.advance(1)
  expect(myReason(world)).toBe('permission')
  expect(world.writes).toHaveLength(afterStart + 1)

  await permissionDialog($)
  await clock.advance(1)
  expect(world.writes).toHaveLength(afterStart + 1)
})

test('with two calls put to the person, the wait lasts until both have returned', async ($, on) => {
  const { world, clock } = engine(on, { ...twoSessions(), checkDecision: 'ask' })
  const calls = new Map<string, () => void>()
  world.onToolCall = () =>
    new Promise<void>(resolve => {
      calls.set(`g${calls.size}`, resolve)
    })
  await startedSession($, clock)

  await $.tool.check({ tool: 'Bash', input: { command: 'a' }, tool_use_id: 'A' })
  await $.tool.check({ tool: 'Bash', input: { command: 'b' }, tool_use_id: 'B' })
  await permissionDialog($)
  const callA = $.tool.call({ tool: 'Bash', tool_use_id: 'A', command: 'a', description: 'a' })
  const callB = $.tool.call({ tool: 'Bash', tool_use_id: 'B', command: 'b', description: 'b' })
  await clock.advance(1)
  expect(myReason(world)).toBe('permission')
  expect(calls.size).toBe(2)

  calls.get('g1')?.()
  await callB
  await clock.advance(1)
  expect(myReason(world)).toBe('permission')

  calls.get('g0')?.()
  await callA
  await clock.advance(1)
  expect(myReason(world)).toBe(null)
})

test('a question to the person is a wait while it is open, for any caller', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  let release: () => void = () => undefined
  world.onToolCall = () =>
    new Promise<void>(resolve => {
      release = resolve
    })
  await startedSession($, clock)

  const call = $.tool.call({
    tool: 'AskUserQuestion',
    tool_use_id: 'q1',
    questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'a', description: 'a' }, { label: 'b', description: 'b' }] }],
  })
  await clock.advance(1)
  expect(myMark(world)).toEqual({ sessionId: 'session-a', reason: 'question', sinceMs: NOW + 1 })

  release()
  await call
  await clock.advance(1)
  expect(myReason(world)).toBe(null)
})

test('a new prompt from the person, the end of a turn, or a /clear ends whatever wait was open', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await startedSession($, clock)

  await permissionDialog($)
  await clock.advance(1)
  await $.prompt.submit({ text: 'never mind', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1)
  expect(myReason(world)).toBe(null)

  await permissionDialog($)
  await clock.advance(1)
  await beginTurn($)
  await endTurn($)
  await clock.advance(1)
  expect(myReason(world)).toBe(null)

  await permissionDialog($)
  await clock.advance(1)
  expect(myReason(world)).toBe('permission')
  await $.session.end({ reason: 'clear', sessionId: 'session-a', resume: { id: 'session-a' } })
  await clock.advance(1)
  expect(myReason(world)).toBe(null)
})

test('a background notification is not the person answering: the wait stays', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await startedSession($, clock)

  await permissionDialog($)
  await clock.advance(1)
  await $.prompt.submit({ text: 'note', wait: false, origin: { kind: 'task-notification' } })
  await clock.advance(1)
  expect(myReason(world)).toBe('permission')
})

test('exiting the session clears the mark, whatever the reason', async ($, on) => {
  const { world, clock } = engine(on, twoSessions())
  await startedSession($, clock)

  await permissionDialog($)
  await clock.advance(1)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-a', resume: { id: 'session-a' } })
  await clock.advance(1)
  expect(myReason(world)).toBe(null)
})

test('the only files the dashboard writes are marks named by pid in the marks folder', async ($, on) => {
  const { world, clock } = engine(on, twoSessions(WAITING_B))
  await startedSession($, clock)
  await permissionDialog($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  await clock.advance(30_000)

  expect(world.writes.length).toBeGreaterThan(0)
  for (const write of world.writes) {
    expect(write.path).toMatch(new RegExp(`^${MARKS}/\\d+\\.json$`))
    expect(Object.keys(JSON.parse(write.text)).sort()).toEqual(['reason', 'sessionId', 'sinceMs'])
  }
})

test('with no process to name the mark by, nothing is written and nothing throws', async ($, on) => {
  const { world, clock } = engine(on, { ...twoSessions(), tasklist: { exitCode: 1, stdout: '' } })
  await startedSession($, clock)

  await permissionDialog($)
  await clock.advance(1)
  expect(world.writes).toEqual([])
})

test('with no home directory nothing is written', async ($, on) => {
  const { world, clock } = engine(on, { ...twoSessions(), home: undefined })
  await startedSession($, clock)
  await permissionDialog($)
  await clock.advance(1)

  expect(world.writes).toEqual([])
})
