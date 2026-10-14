import { expect, test } from 'claude-code/testing'

import { apply, hasAdvisor, initialState, isActive, nextRowExpiry, visibleAgents } from '../hooks/lib/state'
import type { DashEvent } from '../hooks/lib/state'
import type { AgentRow, CodexJob, DashState } from '../types'

const fold = (events: readonly DashEvent[], from: DashState = initialState): DashState =>
  events.reduce(apply, from)

test('the initial state is idle with nothing counted', async () => {
  expect(initialState.main.activity).toEqual({ kind: 'idle' })
  expect(initialState.main.turns).toBe(0)
  expect(initialState.advisor.consults).toBe(0)
  expect(initialState.agents).toEqual([])
  expect(initialState.log).toEqual([])
  expect(initialState.context).toBeNull()
})

test('apply never mutates the state it is given', async () => {
  const before = JSON.stringify(initialState)
  apply(initialState, { type: 'turn-start', at: 1, turns: 1 })
  expect(JSON.stringify(initialState)).toBe(before)
})

test('session sets the model, the turns seen so far and the advisor model', async () => {
  const s = fold([{ type: 'session', model: 'claude-opus-5-5', turns: 7, advisorModel: 'claude-fable-5-1' }])
  expect(s.main.model).toBe('claude-opus-5-5')
  expect(s.main.turns).toBe(7)
  expect(s.advisor.model).toBe('claude-fable-5-1')
})

test('advisor-model sets or clears the configured advisor', async () => {
  const set = fold([{ type: 'advisor-model', model: 'fable' }])
  expect(set.advisor.model).toBe('fable')
  expect(fold([{ type: 'advisor-model' }], set).advisor.model).toBeUndefined()
})

test('turn-start counts the turn, goes to thinking and logs it', async () => {
  const s = fold([
    { type: 'turn-start', at: 1000, turns: 1 },
    { type: 'turn-start', at: 2000, turns: 2 },
  ])
  expect(s.main.turns).toBe(2)
  expect(s.main.activity).toEqual({ kind: 'thinking' })
  expect(s.main.turnStartedAt).toBe(2000)
  expect(s.log.map(l => [l.at, l.kind, l.detail])).toEqual([
    [1000, 'turn-start', '1'],
    [2000, 'turn-start', '2'],
  ])
})

test('turn-end goes idle and logs the duration', async () => {
  const s = fold([
    { type: 'turn-start', at: 1000, turns: 1 },
    { type: 'turn-end', at: 9000, durationMs: 8000 },
  ])
  expect(s.main.activity).toEqual({ kind: 'idle' })
  expect(s.main.turnStartedAt).toBeUndefined()
  expect(s.log.at(-1)).toEqual({ at: 9000, kind: 'turn-end', detail: '1', durationMs: 8000 })
})

test('step records the model and effort of the main request', async () => {
  const s = fold([{ type: 'step', model: 'claude-opus-5-5', effort: 'xhigh' }])
  expect(s.main.model).toBe('claude-opus-5-5')
  expect(s.main.effort).toBe('xhigh')
})

test('a tool shows as the activity and falls back to thinking when it returns', async () => {
  const running = fold([
    { type: 'turn-start', at: 1, turns: 1 },
    { type: 'tool-start', at: 2, name: 'Bash' },
  ])
  expect(running.main.activity).toEqual({ kind: 'tool', name: 'Bash' })
  expect(running.log.at(-1)).toMatchObject({ at: 2, kind: 'tool', detail: 'Bash' })

  const done = fold([{ type: 'tool-end' }], running)
  expect(done.main.activity).toEqual({ kind: 'thinking' })
})

test('tool-end after the turn has ended leaves the session idle', async () => {
  const s = fold([
    { type: 'turn-start', at: 1, turns: 1 },
    { type: 'turn-end', at: 2, durationMs: 1 },
    { type: 'tool-end' },
  ])
  expect(s.main.activity).toEqual({ kind: 'idle' })
})

test('an advisor consult is counted, stamped and logged', async () => {
  const s = fold([
    { type: 'advisor-model', model: 'fable' },
    { type: 'advisor-consult', at: 5000 },
    { type: 'advisor-consult', at: 8000 },
  ])
  expect(s.advisor).toEqual({ model: 'fable', consults: 2, lastAt: 8000 })
  expect(s.log.filter(l => l.kind === 'advisor')).toHaveLength(2)
})

test('a spawned agent is a running row and is logged once', async () => {
  const spawn: DashEvent = {
    type: 'agent-spawn',
    at: 100,
    id: 'a1',
    agentType: 'Explore',
    description: 'scan the repo',
    model: 'haiku',
    isTeammate: false,
  }
  const s = fold([spawn, spawn])
  expect(s.agents).toEqual([
    {
      id: 'a1',
      type: 'Explore',
      description: 'scan the repo',
      model: 'haiku',
      status: 'running',
      isTeammate: false,
      startedAt: 100,
    },
  ])
  expect(s.log.filter(l => l.kind === 'spawn')).toEqual([{ at: 100, kind: 'spawn', detail: 'scan the repo' }])
})

test('a spawn that arrives after a sync already added the row fills in what the sync lacked', async () => {
  const s = fold([
    {
      type: 'agents-sync',
      at: 50,
      agents: [{ id: 'a1', agentType: 'teammate', description: 'x', status: 'running', isTeammate: false }],
    },
    { type: 'agent-spawn', at: 100, id: 'a1', agentType: 'Explore', description: 'scan', model: 'haiku', isTeammate: false },
  ])
  expect(s.agents).toHaveLength(1)
  expect(s.agents[0]).toMatchObject({ type: 'Explore', description: 'scan', model: 'haiku', startedAt: 100 })
  expect(s.log.filter(l => l.kind === 'spawn')).toHaveLength(1)
})

test('agent-model fills in the model a subagent request names', async () => {
  const s = fold([
    { type: 'agent-spawn', at: 1, id: 'a1', agentType: 'Explore', description: 'd', isTeammate: false },
    { type: 'agent-model', id: 'a1', model: 'claude-haiku-5-5' },
    { type: 'agent-model', id: 'ghost', model: 'x' },
  ])
  expect(s.agents).toHaveLength(1)
  expect(s.agents[0]?.model).toBe('claude-haiku-5-5')
})

const spawned = fold([
  { type: 'agent-spawn', at: 100, id: 'a1', agentType: 'Explore', description: 'scan', isTeammate: false },
])

test('sync moves a row to its listed status and stamps endedAt once, logging the end', async () => {
  const sync = (at: number, status: 'running' | 'completed' | 'failed'): DashEvent => ({
    type: 'agents-sync',
    at,
    agents: [{ id: 'a1', agentType: 'Explore', description: 'scan', status, isTeammate: false }],
  })
  const running = fold([sync(200, 'running')], spawned)
  expect(running.agents[0]).toMatchObject({ status: 'running' })
  expect(running.agents[0]?.endedAt).toBeUndefined()

  const done = fold([sync(300, 'completed'), sync(400, 'completed')], running)
  expect(done.agents[0]).toMatchObject({ status: 'completed', endedAt: 300 })
  expect(done.log.filter(l => l.kind === 'agent-end')).toEqual([{ at: 300, kind: 'agent-end', detail: 'scan: completed' }])

  const failed = fold([sync(500, 'failed')], done)
  expect(failed.agents[0]).toMatchObject({ status: 'failed', endedAt: 300 })
  expect(failed.log.filter(l => l.kind === 'agent-end')).toHaveLength(1)
})

test('sync adds an agent the spawn hook never saw, with no known start', async () => {
  const s = fold([
    {
      type: 'agents-sync',
      at: 700,
      agents: [{ id: 'f1', agentType: 'fork', description: 'forked skill', status: 'running', isTeammate: false }],
    },
  ])
  expect(s.agents[0]).toMatchObject({ id: 'f1', type: 'fork', status: 'running' })
  expect(s.agents[0]?.startedAt).toBeUndefined()
  expect(s.log.filter(l => l.kind === 'spawn')).toHaveLength(1)
})

test('a listed agent missing from a later sync keeps its row untouched', async () => {
  const s = fold([{ type: 'agents-sync', at: 300, agents: [] }], spawned)
  expect(s.agents[0]).toMatchObject({ id: 'a1', status: 'running' })
})

test('agent-done ends a live subagent, but not a teammate and not a finished one', async () => {
  const done = fold([{ type: 'agent-done', at: 900, id: 'a1', reason: 'answer' }], spawned)
  expect(done.agents[0]).toMatchObject({ status: 'completed', endedAt: 900 })

  const killed = fold([{ type: 'agent-done', at: 900, id: 'a1', reason: 'aborted' }], spawned)
  expect(killed.agents[0]).toMatchObject({ status: 'killed', endedAt: 900 })

  const again = fold([{ type: 'agent-done', at: 1200, id: 'a1', reason: 'answer' }], done)
  expect(again.agents[0]?.endedAt).toBe(900)

  const mate = fold([
    { type: 'agent-spawn', at: 1, id: 't1', agentType: 'teammate', description: 'mate', isTeammate: true },
    { type: 'agent-done', at: 2, id: 't1', reason: 'answer' },
  ])
  expect(mate.agents[0]?.status).toBe('running')
})

test('the context reading replaces the previous one', async () => {
  const s = fold([
    { type: 'context', context: { tokens: 10, window: 200 } },
    { type: 'context', context: { tokens: 84_000, window: 200_000, percent: 42 } },
  ])
  expect(s.context).toEqual({ tokens: 84_000, window: 200_000, percent: 42 })
})

test('the log keeps only the newest entries', async () => {
  const events: DashEvent[] = Array.from({ length: 80 }, (_, i) => ({ type: 'tool-start', at: i, name: 'Read' }))
  const s = fold(events)
  expect(s.log).toHaveLength(50)
  expect(s.log[0]?.at).toBe(30)
  expect(s.log.at(-1)?.at).toBe(79)
})

test('finished agents are trimmed to the newest, live ones are never dropped', async () => {
  const events: DashEvent[] = []
  for (let i = 0; i < 30; i++) {
    events.push({ type: 'agent-spawn', at: i, id: `a${i}`, agentType: 'x', description: `d${i}`, isTeammate: false })
    if (i > 0) events.push({ type: 'agent-done', at: 1000 + i, id: `a${i}`, reason: 'answer' })
  }
  const s = fold(events)
  expect(s.agents.some(a => a.id === 'a0')).toBe(true)
  expect(s.agents.filter(a => a.status === 'completed')).toHaveLength(12)
  expect(s.agents.some(a => a.id === 'a29')).toBe(true)
  expect(s.agents.some(a => a.id === 'a1')).toBe(false)
})

test('isActive is true while the main session works or a subagent runs', async () => {
  expect(isActive(initialState)).toBe(false)
  expect(isActive(fold([{ type: 'turn-start', at: 1, turns: 1 }]))).toBe(true)
  expect(isActive(fold([{ type: 'turn-start', at: 1, turns: 1 }, { type: 'turn-end', at: 2, durationMs: 1 }]))).toBe(false)
  expect(
    isActive(fold([{ type: 'agent-spawn', at: 1, id: 'a1', agentType: 'x', description: 'd', isTeammate: false }])),
  ).toBe(true)
  const idleMate = fold([
    { type: 'agents-sync', at: 1, agents: [{ id: 't', agentType: 'teammate', description: 'm', status: 'idle', isTeammate: true }] },
  ])
  expect(isActive(idleMate)).toBe(false)
})

test('a list that still reads running does not revive a subagent an event finished', async () => {
  const sync = (at: number, status: 'running' | 'completed'): DashEvent => ({
    type: 'agents-sync',
    at,
    agents: [{ id: 'a1', agentType: 'Explore', description: 'scan', status, isTeammate: false }],
  })
  const s = fold(
    [{ type: 'agent-done', at: 900, id: 'a1', reason: 'answer' }, sync(950, 'running'), sync(1900, 'completed')],
    spawned,
  )
  expect(s.agents[0]).toMatchObject({ status: 'completed', endedAt: 900 })
  expect(s.log.filter(l => l.kind === 'agent-end')).toHaveLength(1)
  expect(isActive(s)).toBe(false)
})

test('a list that reads running does revive a teammate', async () => {
  const mate = (status: 'idle' | 'running') => ({
    id: 't1',
    agentType: 'teammate',
    description: 'mate',
    status,
    isTeammate: true,
  })
  const s = fold([
    { type: 'agents-sync', at: 1, agents: [mate('running')] },
    { type: 'agents-sync', at: 2, agents: [mate('idle')] },
    { type: 'agents-sync', at: 3, agents: [mate('running')] },
  ])
  expect(s.agents[0]).toMatchObject({ status: 'running' })
  expect(s.agents[0]?.endedAt).toBeUndefined()
})

test('agent-resume brings a finished subagent back to running, and leaves a live one alone', async () => {
  const done = fold([{ type: 'agent-done', at: 900, id: 'a1', reason: 'answer' }], spawned)
  const back = fold([{ type: 'agent-resume', id: 'a1' }], done)
  expect(back.agents[0]).toMatchObject({ status: 'running' })
  expect(back.agents[0]?.endedAt).toBeUndefined()
  expect(fold([{ type: 'agent-resume', id: 'a1' }], spawned)).toEqual(spawned)
  expect(fold([{ type: 'agent-resume', id: 'ghost' }], spawned)).toEqual(spawned)
})

test('agent-done maps why the turn ended: error and refusal fail, an interrupt kills', async () => {
  const end = (reason: 'answer' | 'aborted' | 'refusal' | 'error') =>
    fold([{ type: 'agent-done', at: 5, id: 'a1', reason }], spawned).agents[0]?.status
  expect(end('answer')).toBe('completed')
  expect(end('aborted')).toBe('killed')
  expect(end('error')).toBe('failed')
  expect(end('refusal')).toBe('failed')
})

test('a tool that ends while another still runs leaves the activity on a tool', async () => {
  const two = fold([
    { type: 'turn-start', at: 1, turns: 1 },
    { type: 'tool-start', at: 2, name: 'Read' },
    { type: 'tool-start', at: 3, name: 'Grep' },
  ])
  const one = fold([{ type: 'tool-end' }], two)
  expect(one.main.activity).toEqual({ kind: 'tool', name: 'Grep' })
  expect(fold([{ type: 'tool-end' }], one).main.activity).toEqual({ kind: 'thinking' })
})

test('a tool that ends with no turn running leaves the session idle, and a stray end never goes below zero', async () => {
  const s = fold([{ type: 'tool-start', at: 1, name: 'Bash' }, { type: 'tool-end' }, { type: 'tool-end' }])
  expect(s.main.activity).toEqual({ kind: 'idle' })
  expect(s.main.toolsInFlight).toBe(0)
})

test('turn-start takes the engine turn count when it is ahead, and otherwise counts one more', async () => {
  const base = fold([{ type: 'session', model: 'm', turns: 4 }])
  expect(fold([{ type: 'turn-start', at: 1, turns: 4 }], base).main.turns).toBe(5)
  expect(fold([{ type: 'turn-start', at: 1, turns: 5 }], base).main.turns).toBe(5)
  expect(fold([{ type: 'turn-start', at: 1, turns: 9 }], base).main.turns).toBe(9)
})

test('reset returns to the initial state', async () => {
  expect(fold([{ type: 'turn-start', at: 1, turns: 1 }, { type: 'reset' }])).toEqual(initialState)
})

test('a /clear starts the consults over but keeps the advisor model, which is a setting, not part of the conversation', async () => {
  const state = fold([{ type: 'advisor-model', model: 'claude-fable-5-1' }, { type: 'advisor-consult', at: 5 }, { type: 'reset' }])

  expect(state.advisor).toEqual({ model: 'claude-fable-5-1', consults: 0 })
  expect(hasAdvisor(state)).toBe(true)
})

test('the advisor is in play once a model is set or a consult has been seen', async () => {
  expect(hasAdvisor(initialState)).toBe(false)
  expect(hasAdvisor(fold([{ type: 'advisor-model', model: 'claude-fable-5-1' }]))).toBe(true)
  expect(hasAdvisor(fold([{ type: 'advisor-consult', at: 1 }]))).toBe(true)
  expect(hasAdvisor(fold([{ type: 'advisor-model', model: undefined }]))).toBe(false)
})

const SNAP = { branch: 'main', changed: 2, unreviewed: 1, unreviewedPaths: ['a.ts'] }

test('there is no work tree until git reports one, and a report replaces the last', async () => {
  expect(initialState.git).toBeNull()
  expect(fold([{ type: 'git', git: SNAP }]).git).toEqual(SNAP)
  expect(fold([{ type: 'git', git: SNAP }, { type: 'git', git: { ...SNAP, changed: 3 } }]).git?.changed).toBe(3)
})

test('leaving a repository (git reports none) empties the panel', async () => {
  expect(fold([{ type: 'git', git: SNAP }, { type: 'git', git: null }]).git).toBeNull()
})

test('a /clear starts the conversation over but the work tree stays what git last said', async () => {
  expect(fold([{ type: 'git', git: SNAP }, { type: 'reset' }]).git).toEqual(SNAP)
})

const WAITER = { id: 'b', name: 'other', reason: 'permission', sinceMs: 1000 } as const

test('no other session is waiting until the marks say so, and each report replaces the last', async () => {
  expect(initialState.waitingOthers).toEqual([])
  expect(fold([{ type: 'waiting-others', rows: [WAITER] }]).waitingOthers).toEqual([WAITER])
  expect(fold([{ type: 'waiting-others', rows: [WAITER] }, { type: 'waiting-others', rows: [] }]).waitingOthers).toEqual([])
})

test('a /clear leaves the other sessions\' waits alone: they are not part of this conversation', async () => {
  expect(fold([{ type: 'waiting-others', rows: [WAITER] }, { type: 'reset' }]).waitingOthers).toEqual([WAITER])
})

test('visibleAgents shows live rows first, then the newest finished, within the slot count', async () => {
  const row = (id: string, status: AgentRow['status'], startedAt: number, endedAt?: number): AgentRow => ({
    id,
    type: 't',
    description: id,
    status,
    isTeammate: false,
    startedAt,
    endedAt,
  })
  const agents = [
    row('old-done', 'completed', 1, 10),
    row('live-late', 'running', 50),
    row('new-done', 'failed', 2, 40),
    row('live-early', 'running', 5),
  ]
  expect(visibleAgents(agents, 3, 100).map(a => a.id)).toEqual(['live-early', 'live-late', 'new-done'])
  expect(visibleAgents(agents, 1, 100).map(a => a.id)).toEqual(['live-early'])
  expect(visibleAgents(agents, 0, 100)).toEqual([])
})

const agentRow = (id: string, status: AgentRow['status'], endedAt?: number): AgentRow => ({
  id,
  type: 't',
  description: id,
  status,
  isTeammate: false,
  startedAt: 0,
  endedAt,
})

test('a finished agent row is shown for 60 seconds after it ended and then not; a live row always is', async () => {
  const agents = [agentRow('done', 'completed', 1_000), agentRow('live', 'running')]

  expect(visibleAgents(agents, 4, 60_999).map(a => a.id)).toEqual(['live', 'done'])
  expect(visibleAgents(agents, 4, 61_000).map(a => a.id)).toEqual(['live'])
  expect(visibleAgents(agents, 4, 3_600_000).map(a => a.id)).toEqual(['live'])
})

test('a finished agent row whose end is unknown is not shown at all', async () => {
  expect(visibleAgents([agentRow('done', 'failed'), agentRow('also', 'killed', undefined)], 4, 0)).toEqual([])
})

test('an expired row does not take a slot from a fresher one', async () => {
  const agents = [agentRow('stale', 'completed', 1_000), agentRow('fresh', 'completed', 50_000)]

  expect(visibleAgents(agents, 1, 70_000).map(a => a.id)).toEqual(['fresh'])
})

test('the next row to expire is the earliest end still within its 60 seconds, agents and Codex runs alike', async () => {
  const codex: CodexJob = { id: 'c', toolUseId: 'c', background: false, purpose: 'p', status: 'done', startedAt: 0, endedAt: 20_000 }
  const state: DashState = {
    ...initialState,
    agents: [agentRow('done', 'completed', 30_000), agentRow('old', 'completed', 1_000), agentRow('live', 'running')],
    codex: [codex],
  }

  expect(nextRowExpiry(state, 10_000)).toBe(61_000)
  expect(nextRowExpiry(state, 61_000)).toBe(80_000)
  expect(nextRowExpiry(state, 80_000)).toBe(90_000)
  expect(nextRowExpiry(state, 90_000)).toBeUndefined()
  expect(nextRowExpiry(initialState, 0)).toBeUndefined()
})
