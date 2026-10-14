import { expect, test } from 'claude-code/testing'

import type { Engine } from 'claude-code/testing'

import { NARROW_PROPS, NOW, SPAWN, engine, mountPane, start, text } from './harness'

// The ADVISOR block is for an advisor that is in play: a model is set, or it has been consulted.

const consult = async ($: Engine) => {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
}

const ADVISOR_CALL = { serverToolUses: [{ id: 'u1', name: 'advisor', input: {}, startedAt: NOW, endedAt: NOW + 1000 }] }

test('with no advisor model and no consult the ADVISOR block and its legend item are not drawn, wide or narrow', async ($, on) => {
  engine(on)
  await start($)

  const wide = await mountPane($)
  expect(await wide.find({ key: 'advisor' })).toBeUndefined()
  expect(await text(wide, /advisor/)).toBeUndefined()
  expect(await text(wide, 'off')).toBeUndefined()
  // The legend keeps the lead and the swarm.
  expect(await text(wide, /· lead/)).toBeDefined()
  expect(await text(wide, /· swarm/)).toBeDefined()
  await wide.unmount()

  const narrow = await mountPane($, NARROW_PROPS)
  expect(await narrow.find({ key: 'advisor' })).toBeUndefined()
  expect(await text(narrow, /顧問/)).toBeUndefined()
})

test('its width goes to the subagent boxes: with no advisor column beside it the agent column has no gap on its left', async ($, on) => {
  engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  const pane = await mountPane($)

  expect(await pane.find({ key: 'agents' })).toBeDefined()
  expect((await pane.find({ key: 'agents' }))?.props.marginLeft).toBeUndefined()
})

test('beside the ADVISOR column the agent column keeps its gap', async ($, on) => {
  engine(on, { settings: { advisorModel: 'claude-fable-5-1' } })
  await start($)
  await $.agent.spawn(SPAWN)
  const pane = await mountPane($)

  expect((await pane.find({ key: 'agents' }))?.props.marginLeft).toBe(1)
})

test('setting an advisor model brings the block and its legend item in, wide and narrow', async ($, on) => {
  engine(on, { settings: { advisorModel: 'claude-fable-5-1' } })
  await start($)

  const wide = await mountPane($)
  expect(await wide.find({ key: 'advisor' })).toBeDefined()
  expect(await text(wide, '■ fable-5-1 · advisor')).toBeDefined()
  expect(await text(wide, '尚未諮詢')).toBeDefined()
  await wide.unmount()

  const narrow = await mountPane($, NARROW_PROPS)
  expect(await narrow.find({ key: 'advisor' })).toBeDefined()
  expect(await text(narrow, /顧問 fable-5-1/)).toBeDefined()
})

test('a consult brings the block in by itself, even with no model in the settings', async ($, on) => {
  engine(on, ADVISOR_CALL)
  await start($)
  const before = await mountPane($)
  expect(await before.find({ key: 'advisor' })).toBeUndefined()
  await before.unmount()

  await consult($)
  const wide = await mountPane($)
  expect(await wide.find({ key: 'advisor' })).toBeDefined()
  expect(await text(wide, '■ on · advisor')).toBeDefined()
  expect(await text(wide, /1 次/)).toBeDefined()
  await wide.unmount()

  const narrow = await mountPane($, NARROW_PROPS)
  expect(await narrow.find({ key: 'advisor' })).toBeDefined()
})

test('a /clear takes the block away again when the settings name no advisor', async ($, on) => {
  engine(on, ADVISOR_CALL)
  await start($)
  await consult($)
  const before = await mountPane($)
  expect(await before.find({ key: 'advisor' })).toBeDefined()
  await before.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const after = await mountPane($)
  expect(await after.find({ key: 'advisor' })).toBeUndefined()
})
