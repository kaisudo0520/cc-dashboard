import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { NARROW_PROPS, SPAWN, WIDE_PROPS, engine, mountPane, start, text } from './harness'
import type { Pane, PaneProps, World } from './harness'

// The agent area is as big as the agent rows there are to draw (live ones, and finished ones within
// their minute); the rows it does not need go to the SESSION LOG.

const props = (columns: number, rows: number): PaneProps => ({
  ...(columns < 68 ? NARROW_PROPS : WIDE_PROPS),
  bodyColumns: columns,
  scroll: { offset: 0, bodyRows: rows },
})

const logEntries = async (pane: Pane): Promise<number> => (await pane.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d$/ })).length

const logLines = async ($: Engine, columns: number, rows: number): Promise<number> => {
  const pane = await mountPane($, props(columns, rows))
  const count = await logEntries(pane)
  await pane.unmount()

  return count
}

/** A session with plenty in its log, so the log always has more entries than lines. */
const busySession = async ($: Engine) => {
  await start($)
  for (let i = 0; i < 14; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}`, tool_use_id: `b${i}` })
}

const finishAgent = ($: Engine, world: World) => {
  world.agents = [{ id: 'a1', description: 'scan the repo', type: 'Explore', status: 'completed' }]

  return $.turn.complete({ turnId: 't9', agentId: 'a1', answer: 'done', durationMs: 5000, isAborted: false, reason: 'answer' })
}

test('with no agent row nothing is drawn for agents: no column, no empty box', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($, props(70, 30))

  expect(await pane.find({ key: 'dash-wide' })).toBeDefined()
  expect(await pane.find({ key: 'agents' })).toBeUndefined()
  expect(await text(pane, '尚無子代理')).toBeUndefined()
  expect(await pane.find({ key: 'flow-forward' })).toBeDefined()
  expect(await pane.find({ key: 'flow-back' })).toBeDefined()
})

test('the log takes the rows an agent box would have had: 12 lines with no agent, fewer with one', async ($, on) => {
  engine(on)
  await busySession($)

  expect(await logLines($, 70, 30)).toBe(12)
  await $.agent.spawn(SPAWN)
  // One box is four rows: 30 less the 21 fixed and boxed rows leaves 9, the Footer and 8 log lines.
  expect(await logLines($, 70, 30)).toBe(8)
})

test('a stacked pane gives the log the line of an agent that is not there', async ($, on) => {
  engine(on)
  await busySession($)
  const before = await logLines($, 40, 20)
  await $.agent.spawn(SPAWN)

  expect(await logLines($, 40, 20)).toBe(before - 1)
})

test('when the finished row expires, the next draw gives its rows back to the log', async ($, on) => {
  const { world, clock } = engine(on)
  await busySession($)
  await $.agent.spawn(SPAWN)
  await finishAgent($, world)
  await clock.advance(1000)
  expect(await logLines($, 70, 30)).toBe(8)

  await clock.advance(60_000)
  expect(await logLines($, 70, 30)).toBe(12)
})

test('a new agent takes its rows back from the log at the next draw', async ($, on) => {
  engine(on)
  await busySession($)
  const pane = await mountPane($, props(70, 30))
  expect(await logEntries(pane)).toBe(12)

  await $.agent.spawn(SPAWN)
  expect(await logEntries(pane)).toBe(8)
})
