import { expect, test } from 'claude-code/testing'

import { visibleCodex } from '../hooks/lib/codex-state'
import { apply, initialState, isActive } from '../hooks/lib/state'
import type { DashEvent } from '../hooks/lib/state'
import type { CodexJob, DashState } from '../types'

const ID = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6071'

const fold = (events: readonly DashEvent[], from: DashState = initialState): DashState => events.reduce(apply, from)

const start = (toolUseId: string, at = 100, extra: Partial<Extract<DashEvent, { type: 'codex-start' }>> = {}): DashEvent => ({
  type: 'codex-start',
  at,
  toolUseId,
  purpose: 'Codex 審查',
  ...extra,
})

test('the initial state has no Codex runs', async () => {
  expect(initialState.codex).toEqual([])
})

test('a started run is a running foreground job, logged once with its purpose', async () => {
  const s = fold([start('tu1', 100, { note: '審 diff' })])
  expect(s.codex).toEqual([
    {
      id: 'tu1',
      toolUseId: 'tu1',
      background: false,
      purpose: 'Codex 審查',
      note: '審 diff',
      status: 'running',
      startedAt: 100,
    },
  ])
  expect(s.log.at(-1)).toEqual({ at: 100, kind: 'codex-start', detail: 'Codex 審查' })
})

test('a start carries the session id when the command already named it', async () => {
  expect(fold([start('tu1', 100, { sessionId: ID })]).codex[0]?.sessionId).toBe(ID)
})

test('a run that comes back done is stamped once and logged once', async () => {
  const s = fold([
    start('tu1'),
    { type: 'codex-end', at: 900, id: 'tu1', ok: true, sessionId: ID },
    { type: 'codex-end', at: 950, id: 'tu1', ok: false },
  ])
  expect(s.codex[0]).toMatchObject({ status: 'done', endedAt: 900, sessionId: ID })
  expect(s.log.filter(l => l.kind === 'codex-done')).toEqual([{ at: 900, kind: 'codex-done', detail: 'Codex 審查' }])
  expect(s.log.some(l => l.kind === 'codex-fail')).toBe(false)
})

test('a failed run is logged as failed', async () => {
  const s = fold([start('tu1'), { type: 'codex-end', at: 500, id: 'tu1', ok: false }])
  expect(s.codex[0]).toMatchObject({ status: 'failed', endedAt: 500 })
  expect(s.log.at(-1)).toEqual({ at: 500, kind: 'codex-fail', detail: 'Codex 審查' })
})

test('the session id the command named is not replaced by a later reading', async () => {
  const s = fold([start('tu1', 100, { sessionId: ID }), { type: 'codex-end', at: 5, id: 'tu1', ok: true, sessionId: 'other' }])
  expect(s.codex[0]?.sessionId).toBe(ID)
})

test('an end for a run nobody started changes nothing', async () => {
  const s = fold([start('tu1')])
  expect(fold([{ type: 'codex-end', at: 5, id: 'ghost', ok: true }], s)).toBe(s)
})

test('a run moved to the background takes the task id and keeps running', async () => {
  const s = fold([start('tu1'), { type: 'codex-background', toolUseId: 'tu1', backgroundId: 'b9' }])
  expect(s.codex[0]).toMatchObject({ id: 'b9', toolUseId: 'tu1', background: true, status: 'running' })
  expect(s.codex[0]?.endedAt).toBeUndefined()
})

test('a notification finds its run by task id, or by the call id when the task id is unknown', async () => {
  const moved = fold([start('tu1'), { type: 'codex-background', toolUseId: 'tu1', backgroundId: 'b9' }])
  const byTask = fold([{ type: 'codex-end', at: 800, id: 'b9', toolUseId: 'tu1', ok: true, sessionId: ID }], moved)
  expect(byTask.codex[0]).toMatchObject({ status: 'done', endedAt: 800, sessionId: ID })

  const byCall = fold([{ type: 'codex-end', at: 800, id: 'zz', toolUseId: 'tu1', ok: false }], moved)
  expect(byCall.codex[0]).toMatchObject({ status: 'failed', endedAt: 800 })
})

test('a stop concludes a background run missing from the live list as done, and an abandoned foreground run as failed', async () => {
  const s = fold([
    start('fg', 10),
    start('bg', 20),
    { type: 'codex-background', toolUseId: 'bg', backgroundId: 'b1' },
    start('alive', 30),
    { type: 'codex-background', toolUseId: 'alive', backgroundId: 'b2' },
    { type: 'codex-stop', at: 700, liveIds: ['b2'] },
  ])
  const by = (id: string): CodexJob | undefined => s.codex.find(j => j.id === id)
  expect(by('fg')).toMatchObject({ status: 'failed', endedAt: 700, inferred: true })
  expect(by('b1')).toMatchObject({ status: 'done', endedAt: 700, inferred: true })
  expect(by('b2')).toMatchObject({ status: 'running' })
})

test('a stop that carries no task list leaves background runs alone', async () => {
  const s = fold([
    start('bg', 20),
    { type: 'codex-background', toolUseId: 'bg', backgroundId: 'b1' },
    { type: 'codex-stop', at: 700 },
  ])
  expect(s.codex[0]?.status).toBe('running')
})

test('a real report overrides an end the dashboard only inferred', async () => {
  const s = fold([
    start('bg', 20),
    { type: 'codex-background', toolUseId: 'bg', backgroundId: 'b1' },
    { type: 'codex-stop', at: 700, liveIds: [] },
    { type: 'codex-end', at: 900, id: 'b1', ok: false, sessionId: ID },
  ])
  expect(s.codex[0]).toMatchObject({ status: 'failed', endedAt: 900, sessionId: ID })
  expect(s.codex[0]?.inferred).toBeUndefined()
})

test('a run settled by a stop can still move to the background when the call returns late', async () => {
  const s = fold([
    start('tu1', 10),
    { type: 'codex-stop', at: 700 },
    { type: 'codex-background', toolUseId: 'tu1', backgroundId: 'b9' },
  ])
  expect(s.codex[0]).toMatchObject({ id: 'b9', status: 'running' })
  expect(s.codex[0]?.endedAt).toBeUndefined()
  expect(s.codex[0]?.inferred).toBeUndefined()
})

test('finished runs are trimmed to the newest, running ones never dropped', async () => {
  const events: DashEvent[] = [start('live', 1)]
  for (let i = 0; i < 20; i++) {
    events.push(start(`t${i}`, 10 + i), { type: 'codex-end', at: 100 + i, id: `t${i}`, ok: true })
  }
  const s = fold(events)
  expect(s.codex.some(j => j.id === 'live')).toBe(true)
  expect(s.codex.filter(j => j.status === 'done')).toHaveLength(6)
  expect(s.codex.some(j => j.id === 't19')).toBe(true)
  expect(s.codex.some(j => j.id === 't0')).toBe(false)
})

test('isActive is true while a Codex run is running, so the dashboard keeps animating', async () => {
  const running = fold([start('tu1')])
  expect(isActive(running)).toBe(true)
  expect(isActive(fold([{ type: 'codex-end', at: 5, id: 'tu1', ok: true }], running))).toBe(false)
})

test('apply does not mutate the state it is given', async () => {
  const before = JSON.stringify(initialState)
  apply(initialState, start('tu1'))
  expect(JSON.stringify(initialState)).toBe(before)
})

test('reset clears the runs', async () => {
  expect(fold([start('tu1'), { type: 'reset' }]).codex).toEqual([])
})

test('visibleCodex shows running runs first, oldest first, then the newest finished, within the slots', async () => {
  const job = (id: string, status: CodexJob['status'], startedAt: number, endedAt?: number): CodexJob => ({
    id,
    toolUseId: id,
    background: false,
    purpose: 'p',
    status,
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
  })
  const jobs = [job('old', 'done', 1, 10), job('late', 'running', 50), job('new', 'failed', 2, 40), job('early', 'running', 5)]
  expect(visibleCodex(jobs, 3, 100).map(j => j.id)).toEqual(['early', 'late', 'new'])
  expect(visibleCodex(jobs, 1, 100).map(j => j.id)).toEqual(['early'])
  expect(visibleCodex(jobs, 0, 100)).toEqual([])
})

test('a finished run is shown for 60 seconds after it ended and then not; a running one always is', async () => {
  const job = (id: string, status: CodexJob['status'], endedAt?: number): CodexJob => ({
    id,
    toolUseId: id,
    background: false,
    purpose: 'p',
    status,
    startedAt: 0,
    ...(endedAt === undefined ? {} : { endedAt }),
  })
  const jobs = [job('done', 'done', 1_000), job('run', 'running'), job('unknown', 'failed')]

  expect(visibleCodex(jobs, 3, 60_999).map(j => j.id)).toEqual(['run', 'done'])
  expect(visibleCodex(jobs, 3, 61_000).map(j => j.id)).toEqual(['run'])
})
