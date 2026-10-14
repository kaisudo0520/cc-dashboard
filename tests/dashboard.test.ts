import { expect, test } from 'claude-code/testing'

import {
  NARROW_PROPS,
  NOW,
  SHOWN,
  SPAWN,
  WIDE_PROPS,
  beginTurn,
  endTurn,
  engine,
  mountPane,
  order,
  runDashboard,
  start,
  text,
} from './harness'

test('session start registers /dashboard and opens the pane', async ($, on) => {
  const { world } = engine(on)

  await start($)

  expect(world.registered).toEqual(['dashboard'])
  expect(world.opened).toEqual(['dashboard'])
})

test('a failure in the first-open bookkeeping at session start does not stop the session being read in or polled', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN] })
  on('state.get', (_$, e, next) => (e.key === 'autoOpened' ? { deny: 'state is down' } : next(e)))
  await start($)
  await clock.advance(3000)

  expect(world.registered).toEqual(['dashboard'])
  // The session was read in (usage) and the poller started (a second read within the first poll).
  expect(world.usageCalls).toBeGreaterThanOrEqual(2)
})

test('/dashboard closes the pane when it is up and opens it when it is not', async ($, on) => {
  const { world } = engine(on)

  await runDashboard($)
  expect(world.opened).toEqual(['dashboard'])
  expect(world.closed).toEqual([])

  world.panes = [{ id: 'dashboard', title: 'Dashboard', isShown: true, isFocused: false, isPlaced: true }]
  await runDashboard($)
  expect(world.closed).toEqual(['dashboard'])

  // A pane that waits undrawn for a wider terminal counts as not up: the command opens it.
  world.panes = [{ id: 'dashboard', title: 'Dashboard', isShown: false, isFocused: false, isPlaced: false }]
  await runDashboard($)
  expect(world.opened).toEqual(['dashboard', 'dashboard'])

  // A pane placed but behind another tab is not showing: the command brings it up, not closes it.
  world.panes = [{ id: 'dashboard', title: 'Dashboard', isShown: false, isFocused: false, isPlaced: true }]
  await runDashboard($)
  expect(world.opened).toHaveLength(3)
  expect(world.closed).toEqual(['dashboard'])
})

test('the pane shows the main session from start to finish of a turn', async ($, on) => {
  engine(on)
  await start($)
  let pane = await mountPane($)
  expect(await text(pane, /MAIN\s+opus-5-5/)).toBeDefined()
  expect(await text(pane, /閒置 · 回合 4/)).toBeDefined()
  await pane.unmount()

  await beginTurn($)
  pane = await mountPane($)
  expect(await text(pane, /思考中 · 回合 5/)).toBeDefined()
  await pane.unmount()

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await endTurn($)
  pane = await mountPane($)
  expect(await text(pane, /閒置 · 回合 5/)).toBeDefined()
  expect(await text(pane, '回合 5 完成 · 8s')).toBeDefined()
  expect(await text(pane, '工具 Bash')).toBeDefined()
  expect(await text(pane, '14:02:11')).toBeDefined()
})

test('a tool call shows as the main activity while it runs', async ($, on) => {
  let seen = 'never'
  engine(on, {
    onToolCall: async () => {
      const pane = await mountPane($)
      seen = (await text(pane, /執行工具 Bash/)) === undefined ? 'missing' : 'shown'
    },
  })
  await start($)
  await beginTurn($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(seen).toBe('shown')
})

test('the model and effort of the main request show in the header', async ($, on) => {
  engine(on)
  await start($)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()

  const pane = await mountPane($)
  expect(await text(pane, /MAIN\s+opus-5-5 · xhigh/)).toBeDefined()
})

test('the configured advisor model shows with its consult count and last time', async ($, on) => {
  engine(on, {
    settings: { advisorModel: 'claude-fable-5-1' },
    serverToolUses: [
      { id: 'u1', name: 'advisor', input: {}, startedAt: NOW, endedAt: NOW + 3000 },
      { id: 'u2', name: 'advisor', input: {}, startedAt: NOW + 4000, endedAt: NOW + 5000 },
    ],
  })
  await start($)
  let pane = await mountPane($)
  expect(await text(pane, 'fable-5-1')).toBeDefined()
  expect(await text(pane, '尚未諮詢')).toBeDefined()
  await pane.unmount()

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()

  pane = await mountPane($)
  expect(await text(pane, '2 次 · 14:02:16')).toBeDefined()
  expect(await text(pane, '顧問諮詢 · fable-5-1')).toBeDefined()
})

test('a spawned subagent gets a box with its type, model and task, and a finished one shows its end', async ($, on) => {
  const { world } = engine(on)
  await start($)
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'scan',
    description: 'scan the repo',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

  let pane = await mountPane($)
  expect(await pane.find({ key: 'agent-a1' })).toBeDefined()
  expect(await text(pane, /Explore · haiku-5-5/)).toBeDefined()
  expect(await text(pane, 'scan the repo')).toBeDefined()
  expect(await text(pane, '◐')).toBeDefined()
  await pane.unmount()

  world.agents = [{ id: 'a1', description: 'scan the repo', type: 'Explore', status: 'completed' }]
  await $.turn.complete({
    turnId: 't9',
    agentId: 'a1',
    answer: 'done',
    durationMs: 5000,
    isAborted: false,
    reason: 'answer',
  })
  pane = await mountPane($)
  expect(await text(pane, '✓')).toBeDefined()
  expect(await text(pane, '子代理結束 scan the repo: completed')).toBeDefined()
})

test('with no subagent the pane draws no agent area', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'agents' })).toBeUndefined()
  expect(await text(pane, '尚無子代理')).toBeUndefined()
})

test('the Context bar is the only context display: it follows the measurement as what is used, and the quota header has no CTX row', async ($, on) => {
  engine(on)
  await start($)
  await $.session.measure({
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [],
    changed: ['context'],
  })
  const pane = await mountPane($)
  expect(await pane.find({ key: 'context' })).toBeDefined()
  expect(await text(pane, /Context .* 42%\s+84k\/200k/)).toBeDefined()
  expect(await text(pane, /CTX/)).toBeUndefined()
  expect(await text(pane, '58%')).toBeUndefined()
})

test('a narrow pane has the same Context bar and no CTX line', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($, NARROW_PROPS)

  expect(await pane.find({ key: 'context' })).toBeDefined()
  expect(await text(pane, /Context .* 5%\s+10k\/200k/)).toBeDefined()
  expect(await text(pane, /CTX/)).toBeUndefined()
})

test('before any reading the Context bar says it does not know', async ($, on) => {
  engine(on)
  const pane = await mountPane($)

  expect(await text(pane, 'Context —')).toBeDefined()
})

test('the Context bar sits below the CODEX block and above the SESSION LOG, wide and narrow', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'codex exec --sandbox read-only -m gpt-6-sol - < brief.md' })
  const wide = await mountPane($)
  expect(await order(wide, ['quota', 'main', 'codex', 'context', 'log'])).toEqual(['quota', 'main', 'codex', 'context', 'log'])
  await wide.unmount()

  const narrow = await mountPane($, NARROW_PROPS)
  expect(await order(narrow, ['quota', 'main', 'codex', 'context', 'log'])).toEqual(['quota', 'main', 'codex', 'context', 'log'])
})

test('a narrow pane stacks the sections instead of drawing columns', async ($, on) => {
  engine(on, { settings: { advisorModel: 'claude-fable-5-1' } })
  await start($)
  const pane = await mountPane($, NARROW_PROPS)

  expect(await pane.find({ key: 'dash-narrow' })).toBeDefined()
  expect(await pane.find({ key: 'dash-wide' })).toBeUndefined()
  expect(await pane.find({ key: 'main' })).toBeDefined()
  expect(await pane.find({ key: 'advisor' })).toBeDefined()
  expect(await pane.find({ key: 'quota' })).toBeDefined()
})

test('a wide pane draws the columns', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'dash-wide' })).toBeDefined()
  expect(await pane.find({ key: 'dash-narrow' })).toBeUndefined()
})

test('while something runs the dashboard keeps looking at the agents, and when all is idle it stops', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN] })
  await start($)
  const afterStart = world.agentListCalls

  await beginTurn($)
  await clock.advance(2000)
  const whileBusy = world.agentListCalls
  expect(whileBusy).toBeGreaterThan(afterStart)

  await endTurn($)
  const afterEnd = world.agentListCalls
  await clock.advance(10_000)
  expect(world.agentListCalls).toBe(afterEnd)
})

test('with the pane closed, or behind another tab, the animation does no work', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  const afterStart = world.agentListCalls

  await beginTurn($)
  await clock.advance(5000)
  expect(world.agentListCalls).toBe(afterStart)

  world.panes = [{ ...SHOWN, isShown: false }]
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(5000)
  expect(world.agentListCalls).toBe(afterStart)
})

test('the animation resumes when the pane is shown again', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  await beginTurn($)
  await clock.advance(2000)
  const whileClosed = world.agentListCalls

  // The command opens the pane; the engine then shows it.
  await runDashboard($)
  world.panes = [SHOWN]
  await clock.advance(2000)
  expect(world.agentListCalls).toBeGreaterThan(whileClosed)
})

test('a failing look-up at start does not stop the dashboard from drawing', async ($, on) => {
  engine(on, { settingsDeny: true })
  await start($)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'dash-wide' })).toBeDefined()
  expect(await pane.find({ key: 'advisor' })).toBeUndefined()
})

test('a subagent spawned without a description is logged under its type', async ($, on) => {
  engine(on)
  await start($)
  await $.agent.spawn({
    tool_use_id: 'tu2',
    prompt: 'scan',
    description: '',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  const pane = await mountPane($)
  expect(await text(pane, '子代理啟動 Explore')).toBeDefined()
})

test('the dashboard draws on the desktop surface as well', async ($, on) => {
  engine(on)
  await start($)
  const pane = await $.ui.mount({
    plugin: 'cc-dashboard',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'dashboard',
    props: WIDE_PROPS,
    viewport: { columns: 100, rows: 40 },
  })
  expect(await pane.find({ key: 'dash-wide' })).toBeDefined()
})

test('/dashboard says why when the pane cannot open', async ($, on) => {
  engine(on, { openDeny: 'no-surface: no surface is attached' })

  const answer = await runDashboard($)
  expect(answer.text).toMatch(/^dashboard: .*no-surface: no surface is attached/)
})

test('a hot reload does not reopen a pane the person closed', async ($, on) => {
  const { world } = engine(on)
  await start($)
  await start($)
  expect(world.opened).toEqual(['dashboard'])
})

test('the turn count follows the engine when it is ahead of what was counted', async ($, on) => {
  const { world } = engine(on)
  await start($)
  world.turns = 9
  await beginTurn($)
  const pane = await mountPane($)
  expect(await text(pane, /思考中 · 回合 9/)).toBeDefined()
})

test('the legend and the advisor box agree when the advisor is not in the settings', async ($, on) => {
  engine(on, { serverToolUses: [{ id: 'u1', name: 'advisor', input: {}, startedAt: NOW, endedAt: NOW + 1000 }] })
  await start($)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()

  const pane = await mountPane($)
  expect(await text(pane, '■ on · advisor')).toBeDefined()
  expect(await text(pane, 'on')).toBeDefined()
})

test('a subagent first seen in the list shows no elapsed time', async ($, on) => {
  engine(on, { agents: [{ id: 'f1', description: 'forked skill', type: 'fork', status: 'running' }] })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't7', agentId: 'f1' })

  const pane = await mountPane($)
  expect(await text(pane, 'forked skill')).toBeDefined()
  expect(await text(pane, '—')).toBeDefined()
})

test('a list that has not caught up does not make a finished subagent flicker back to running', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN] })
  await start($)
  await $.agent.spawn(SPAWN)
  world.agents = [{ id: 'a1', description: 'scan the repo', type: 'Explore', status: 'running' }]
  await clock.advance(3000)

  // The subagent's turn ends, but the list still reads running.
  await $.turn.complete({ turnId: 't9', agentId: 'a1', answer: 'done', durationMs: 3000, isAborted: false, reason: 'answer' })
  world.agents = [{ id: 'a1', description: 'scan the repo', type: 'Explore', status: 'completed' }]
  await clock.advance(1000)
  const calls = world.agentListCalls
  await clock.advance(5000)

  const pane = await mountPane($)
  expect(await text(pane, '3s')).toBeDefined()
  expect(await text(pane, '✓')).toBeDefined()
  expect(world.agentListCalls).toBe(calls)
})

test('a subagent that starts a new turn after it finished is running again', async ($, on) => {
  const { world } = engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ turnId: 't9', agentId: 'a1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
  world.agents = [{ id: 'a1', description: 'scan the repo', type: 'Explore', status: 'running' }]
  await $.turn.start({ text: 'again', turnId: 't10', agentId: 'a1' })

  const pane = await mountPane($)
  expect(await text(pane, '◐')).toBeDefined()
  expect(await text(pane, '✓')).toBeUndefined()
})

test('an errored subagent turn shows as failed', async ($, on) => {
  engine(on)
  await start($)
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ turnId: 't9', agentId: 'a1', answer: '', durationMs: 1, isAborted: false, reason: 'error' })

  const pane = await mountPane($)
  expect(await text(pane, '✗')).toBeDefined()
})

test('the pane opens with no size request, since the terminal height is not known yet', async ($, on) => {
  const { world } = engine(on)
  await start($)

  expect(world.openArgs).toHaveLength(1)
  expect(world.openArgs[0]).toEqual({ id: 'dashboard', title: 'Dashboard' })
})

test('once the first drawing tells the terminal height, the pane asks once for 60% of it, with no columns', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  let pane = await mountPane($)
  await clock.advance(10)
  await pane.unmount()
  pane = await mountPane($)
  await pane.unmount()
  await mountPane($, NARROW_PROPS)
  await clock.advance(10)

  expect(world.openArgs).toEqual([
    { id: 'dashboard', title: 'Dashboard' },
    { id: 'dashboard', title: 'Dashboard', rows: 24 },
  ])
})

test('a size request the engine refused is asked again at the next drawing', async ($, on) => {
  const { world, clock } = engine(on, { openDeny: 'no-surface: no surface is attached' })
  await start($)
  await (await mountPane($)).unmount()
  await clock.advance(10)
  expect(world.openArgs).toEqual([])

  delete world.openDeny
  await (await mountPane($)).unmount()
  await clock.advance(10)

  expect(world.openArgs).toEqual([{ id: 'dashboard', title: 'Dashboard', rows: 24 }])
})

test('/dashboard opens the pane with the requested rows once the height is known', async ($, on) => {
  const { world, clock } = engine(on)
  await start($)
  await (await mountPane($)).unmount()
  await clock.advance(10)
  await runDashboard($)

  expect(world.openArgs.at(-1)).toMatchObject({ id: 'dashboard', rows: 24, focus: true })
  expect(world.openArgs.at(-1)).not.toHaveProperty('columns')
})
