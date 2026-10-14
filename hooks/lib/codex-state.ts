import type { CodexJob, LogEntry } from '../../types'
import { isFresh } from './expiry'

// How the `codex exec` runs the main session launched move from start to end.
// Pure: a list of jobs and an event in, the new list and the log entries out.
// state.ts folds the result into the dashboard's state.

export type CodexEvent =
  | { type: 'codex-start'; at: number; toolUseId: string; purpose: string; note?: string; sessionId?: string }
  | { type: 'codex-background'; toolUseId: string; backgroundId: string }
  | { type: 'codex-end'; at: number; id: string; toolUseId?: string; ok: boolean; sessionId?: string }
  | { type: 'codex-stop'; at: number; liveIds?: readonly string[] }

export type CodexChange = { jobs: CodexJob[]; logs: LogEntry[] }

const FINISHED_KEEP = 6

/** A run is open until the run itself reports its end: running, or ended only by inference. */
const isOpen = (job: CodexJob): boolean => job.status === 'running' || job.inferred === true

const startKey = (job: CodexJob): number => job.startedAt

const trim = (jobs: readonly CodexJob[]): CodexJob[] => {
  const finished = jobs
    .filter(j => j.status !== 'running')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, FINISHED_KEEP)
  const keep = new Set(finished.map(j => j.id))

  return jobs.filter(j => j.status === 'running' || keep.has(j.id))
}

const none = (jobs: CodexJob[]): CodexChange => ({ jobs, logs: [] })

const endLog = (job: CodexJob, ok: boolean, at: number): LogEntry => ({
  at,
  kind: ok ? 'codex-done' : 'codex-fail',
  detail: job.purpose,
})

// The end is the run's own word: it clears an earlier inference.
const finish = (job: CodexJob, ok: boolean, at: number, inferred: boolean, sessionId?: string): CodexJob => {
  const { inferred: _inferred, ...rest } = job
  const known = job.sessionId ?? sessionId

  return {
    ...rest,
    status: ok ? 'done' : 'failed',
    endedAt: at,
    ...(known === undefined ? {} : { sessionId: known }),
    ...(inferred ? { inferred: true as const } : {}),
  }
}

const start = (jobs: CodexJob[], e: Extract<CodexEvent, { type: 'codex-start' }>): CodexChange => {
  const job: CodexJob = {
    id: e.toolUseId,
    toolUseId: e.toolUseId,
    background: false,
    purpose: e.purpose,
    ...(e.note === undefined ? {} : { note: e.note }),
    ...(e.sessionId === undefined ? {} : { sessionId: e.sessionId }),
    status: 'running',
    startedAt: e.at,
  }

  return {
    jobs: trim([...jobs.filter(j => j.id !== job.id), job]),
    logs: [{ at: e.at, kind: 'codex-start', detail: e.purpose }],
  }
}

const background = (jobs: CodexJob[], e: Extract<CodexEvent, { type: 'codex-background' }>): CodexChange => {
  const move = (job: CodexJob): CodexJob => {
    const { endedAt: _endedAt, inferred: _inferred, ...rest } = job

    return { ...rest, id: e.backgroundId, background: true, status: 'running' }
  }
  const isTarget = (j: CodexJob): boolean => j.id === e.toolUseId || j.toolUseId === e.toolUseId

  return none(jobs.map(j => (isTarget(j) ? move(j) : j)))
}

const end = (jobs: CodexJob[], e: Extract<CodexEvent, { type: 'codex-end' }>): CodexChange => {
  const target = jobs.find(j => j.id === e.id) ?? (e.toolUseId === undefined ? undefined : jobs.find(j => j.toolUseId === e.toolUseId))
  if (target === undefined || !isOpen(target)) return none(jobs)

  const ended = finish(target, e.ok, e.at, false, e.sessionId)

  return { jobs: trim(jobs.map(j => (j === target ? ended : j))), logs: [endLog(target, e.ok, e.at)] }
}

// A foreground run still open at a stop was abandoned; a background run the
// engine no longer lists has finished, though not in a way the run told.
const stop = (jobs: CodexJob[], e: Extract<CodexEvent, { type: 'codex-stop' }>): CodexChange => {
  const live = e.liveIds === undefined ? undefined : new Set(e.liveIds)
  const outcome = (j: CodexJob): boolean | undefined => {
    if (j.status !== 'running') return undefined
    if (!j.background) return false

    return live !== undefined && !live.has(j.id) ? true : undefined
  }
  const logs: LogEntry[] = []
  const next = jobs.map(job => {
    const ok = outcome(job)
    if (ok === undefined) return job
    logs.push(endLog(job, ok, e.at))

    return finish(job, ok, e.at, true)
  })

  return { jobs: trim(next), logs }
}

export const reduceCodex = (jobs: CodexJob[], event: CodexEvent): CodexChange => {
  switch (event.type) {
    case 'codex-start':
      return start(jobs, event)
    case 'codex-background':
      return background(jobs, event)
    case 'codex-end':
      return end(jobs, event)
    case 'codex-stop':
      return stop(jobs, event)
  }
}

/** True while any Codex run is running. */
export const isCodexRunning = (jobs: readonly CodexJob[]): boolean => jobs.some(j => j.status === 'running')

/** The same run the notification names: by its task id, else by the call that launched it. */
export const findCodex = (jobs: readonly CodexJob[], id: string, toolUseId?: string): CodexJob | undefined =>
  jobs.find(j => j.id === id) ?? (toolUseId === undefined ? undefined : jobs.find(j => j.toolUseId === toolUseId))

/** Every run to draw at `now`: running ones first (oldest first), then the newest finished that ended less than a minute ago. */
export const shownCodex = (jobs: readonly CodexJob[], now: number): CodexJob[] => {
  const running = jobs.filter(j => j.status === 'running').sort((a, b) => startKey(a) - startKey(b))
  const finished = jobs
    .filter(j => j.status !== 'running' && isFresh(j.endedAt, now))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  return [...running, ...finished]
}

/** The first `slots` of them. */
export const visibleCodex = (jobs: readonly CodexJob[], slots: number, now: number): CodexJob[] =>
  shownCodex(jobs, now).slice(0, Math.max(0, slots))
