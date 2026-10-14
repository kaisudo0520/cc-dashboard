import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { NARROW_PROPS, SPAWN, engine, mountPane, start, text } from './harness'
import type { Clock, World } from './harness'

// A finished subagent or Codex row is drawn for 60 seconds after it ended. The
// redraw timer stops when all is idle, so one one-shot redraw is kept for the
// next expiry. The SESSION LOG keeps its entries.

const PLAN_CMD = 'codex exec --sandbox read-only -m gpt-6-sol - < brief.md'

const finishAgent = ($: Engine, world: World, id: string) => {
  world.agents = [{ id, description: 'scan the repo', type: 'Explore', status: 'completed' }]

  return $.turn.complete({ turnId: 't9', agentId: id, answer: 'done', durationMs: 5000, isAborted: false, reason: 'answer' })
}

/** One subagent spawned and finished now, the clock then moved on. */
const finishedAgent = async ($: Engine, world: World, clock: Clock) => {
  await start($)
  await $.agent.spawn(SPAWN)
  await finishAgent($, world, 'a1')
  await clock.advance(1)
}

const hasRow = async ($: Engine, key: string, props?: Parameters<typeof mountPane>[1]) => {
  const pane = await mountPane($, props)
  const found = (await pane.find({ key })) !== undefined
  await pane.unmount()

  return found
}

test('a finished subagent row is drawn at 59 seconds and gone at 61, and its log entries stay', async ($, on) => {
  const { world, clock } = engine(on)
  await finishedAgent($, world, clock)

  // The row ended at the clock's start; one millisecond has passed since.
  await clock.advance(58_999)
  expect(await hasRow($, 'agent-a1')).toBe(true)

  await clock.advance(2_000)
  expect(await hasRow($, 'agent-a1')).toBe(false)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'agents' })).toBeUndefined()
  expect(await text(pane, '子代理啟動 scan the repo')).toBeDefined()
  expect(await text(pane, '子代理結束 scan the repo: completed')).toBeDefined()
})

test('a narrow pane drops the finished subagent line the same way', async ($, on) => {
  const { world, clock } = engine(on)
  await finishedAgent($, world, clock)

  const before = await mountPane($, NARROW_PROPS)
  expect(await text(before, /✓ Explore/)).toBeDefined()
  await before.unmount()

  await clock.advance(61_000)
  const after = await mountPane($, NARROW_PROPS)
  expect(await text(after, /Explore/)).toBeUndefined()
  expect(await text(after, '子代理結束 scan the repo: completed')).toBeDefined()
})

test('a running subagent is never dropped, however long it runs', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  await clock.advance(600_000)

  expect(await hasRow($, 'agent-a1')).toBe(true)
})

test('a finished Codex run, its block and its legend item go 60 seconds after it ended; the log keeps it', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: PLAN_CMD })
  await clock.advance(59_000)

  let pane = await mountPane($)
  expect(await pane.find({ key: 'codex' })).toBeDefined()
  expect(await text(pane, '■ Codex')).toBeDefined()
  await pane.unmount()

  await clock.advance(2_000)
  pane = await mountPane($)
  expect(await pane.find({ key: 'codex' })).toBeUndefined()
  expect(await text(pane, '■ Codex')).toBeUndefined()
  expect(await text(pane, 'Codex 完成 Codex 規劃草稿')).toBeDefined()
})

test('a Codex run still running is kept', async ($, on) => {
  const { clock } = engine(on, { toolResult: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } } })
  await start($)
  await $.tool.call({ tool: 'Bash', command: PLAN_CMD, run_in_background: true })
  await clock.advance(600_000)

  const pane = await mountPane($)
  expect(await pane.find({ key: 'codex' })).toBeDefined()
})

test('the dashboard redraws once when a finished row expires, though the frame timer is long stopped', async ($, on) => {
  const { world, clock } = engine(on)
  await finishedAgent($, world, clock)
  await clock.advance(2_000)
  const before = world.invalidations.length

  await clock.advance(57_000)
  expect(world.invalidations.length).toBe(before)

  await clock.advance(2_000)
  expect(world.invalidations.length - before).toBe(1)
  expect(world.invalidations.at(-1)).toBe('ui.render')

  // Nothing is left to expire: no polling loop follows.
  await clock.advance(600_000)
  expect(world.invalidations.length - before).toBe(1)
})

test('never more than one redraw is pending: rows ending at different times are redrawn once each, at their own expiry', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' })
  await finishAgent($, world, 'a1')
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: PLAN_CMD })
  const before = world.invalidations.length

  // The subagent ended 10 seconds before the Codex run did.
  await clock.advance(55_000)
  expect(world.invalidations.length - before).toBe(1)
  await clock.advance(10_000)
  expect(world.invalidations.length - before).toBe(2)
  await clock.advance(600_000)
  expect(world.invalidations.length - before).toBe(2)
})

test('events racing each other leave one redraw aimed at the expiry, not none and not two', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  const before = world.invalidations.length

  await Promise.all([
    finishAgent($, world, 'a1'),
    ...Array.from({ length: 8 }, (_, i) => $.tool.call({ tool: 'Bash', command: `echo ${i}`, tool_use_id: `r${i}` })),
  ])
  await clock.advance(61_000)

  expect(world.invalidations.length - before).toBe(1)
  expect(await hasRow($, 'agent-a1')).toBe(false)
})

test('a row that finishes later does not delay the redraw of one that finishes earlier', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  await finishAgent($, world, 'a1')
  await clock.advance(30_000)
  await $.tool.call({ tool: 'Bash', command: PLAN_CMD })
  const before = world.invalidations.length

  await clock.advance(31_000)
  expect(world.invalidations.length - before).toBe(1)
  expect(await hasRow($, 'agent-a1')).toBe(false)
  expect(await hasRow($, 'codex')).toBe(true)
})
