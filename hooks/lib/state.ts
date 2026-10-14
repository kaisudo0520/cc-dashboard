import type { AgentRow, AgentStatus, ContextUse, DashState, GitSnap, LogEntry, WaitingRow } from '../../types'
import { isCodexRunning, reduceCodex } from './codex-state'
import type { CodexEvent } from './codex-state'
import { isFresh, nextExpiry } from './expiry'
import { initialQuota, reduceQuota } from './quota-state'
import type { QuotaEvent } from './quota-state'

// The dashboard's whole state and the one function that changes it. Nothing
// here reads `$`: the hooks turn what the engine reports into a DashEvent and
// the reducer folds it into a new state, so every rule below is a plain test.

/** One agent as `$.agent.list()` reports it, reduced to what the dashboard keeps. */
export type ListedAgent = {
  id: string
  agentType: string
  description: string
  status: AgentStatus
  isTeammate: boolean
}

/** Why a turn ended, as `turn.complete` reports it. */
export type TurnEndReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type DashEvent =
  | { type: 'reset' }
  | { type: 'session'; model: string; turns: number; advisorModel?: string }
  | { type: 'advisor-model'; model?: string }
  | { type: 'turn-start'; at: number; turns: number }
  | { type: 'turn-end'; at: number; durationMs: number }
  | { type: 'step'; model: string; effort?: string }
  | { type: 'tool-start'; at: number; name: string }
  | { type: 'tool-end' }
  | { type: 'advisor-consult'; at: number }
  | {
      type: 'agent-spawn'
      at: number
      id: string
      agentType: string
      description: string
      model?: string
      isTeammate: boolean
    }
  | { type: 'agent-model'; id: string; model: string }
  | { type: 'agent-done'; at: number; id: string; reason: TurnEndReason }
  | { type: 'agent-resume'; id: string }
  | { type: 'agents-sync'; at: number; agents: readonly ListedAgent[] }
  | { type: 'context'; context: ContextUse }
  /** What git last said of the session's repository; null outside one. */
  | { type: 'git'; git: GitSnap | null }
  /** The other live sessions that wait on the person, as their marks last said. */
  | { type: 'waiting-others'; rows: WaitingRow[] }
  | CodexEvent
  | QuotaEvent

const LOG_KEEP = 50
const FINISHED_KEEP = 12

export const initialState: DashState = {
  main: { activity: { kind: 'idle' }, turns: 0, toolsInFlight: 0 },
  advisor: { consults: 0 },
  agents: [],
  codex: [],
  quota: initialQuota,
  git: null,
  waitingOthers: [],
  log: [],
  context: null,
}

const FINISHED: readonly AgentStatus[] = ['completed', 'failed', 'killed']

/** Pending, running, waiting and idle agents are still part of the session's work. */
export const isLive = (status: AgentStatus): boolean => !FINISHED.includes(status)

const withLog = (state: DashState, entry: LogEntry): DashState => ({
  ...state,
  log: [...state.log, entry].slice(-LOG_KEEP),
})

// Every live row stays; of the finished ones only the newest are kept.
const trimAgents = (agents: readonly AgentRow[]): AgentRow[] => {
  const finished = agents
    .filter(a => !isLive(a.status))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, FINISHED_KEEP)
  const keep = new Set(finished.map(a => a.id))

  return agents.filter(a => isLive(a.status) || keep.has(a.id))
}

const replaceAgent = (state: DashState, id: string, change: (row: AgentRow) => AgentRow): DashState => ({
  ...state,
  agents: state.agents.map(row => (row.id === id ? change(row) : row)),
})

const spawnRow = (e: Extract<DashEvent, { type: 'agent-spawn' }>): AgentRow => ({
  id: e.id,
  type: e.agentType,
  description: e.description,
  model: e.model,
  status: 'running',
  isTeammate: e.isTeammate,
  startedAt: e.at,
})

// `logAt` is when the start is logged; none for a row that was already over when first seen.
const addAgent = (state: DashState, row: AgentRow, logAt: number | undefined): DashState => {
  const next = { ...state, agents: trimAgents([...state.agents, row]) }

  return logAt === undefined ? next : withLog(next, { at: logAt, kind: 'spawn', detail: row.description })
}

const finishRow = (row: AgentRow, status: AgentStatus, at: number): AgentRow => ({ ...row, status, endedAt: at })

// A row whose status changed: finishing is stamped once and logged once. A
// teammate listed as live again is live again; a subagent an event finished
// stays finished (the list may not have caught up) until agent-resume. A row
// first seen in the list has no known start: its elapsed time is unknown.
const syncOne = (state: DashState, listed: ListedAgent, at: number): DashState => {
  const row = state.agents.find(a => a.id === listed.id)
  if (row === undefined) {
    const added: AgentRow = {
      id: listed.id,
      type: listed.agentType,
      description: listed.description,
      status: listed.status,
      isTeammate: listed.isTeammate,
      endedAt: isLive(listed.status) ? undefined : at,
    }

    return addAgent(state, added, isLive(listed.status) ? at : undefined)
  }

  if (isLive(listed.status)) {
    if (!isLive(row.status) && !row.isTeammate) return state

    return replaceAgent(state, row.id, r => ({ ...r, status: listed.status, endedAt: undefined }))
  }
  if (!isLive(row.status)) return replaceAgent(state, row.id, r => ({ ...r, status: listed.status }))

  const ended = replaceAgent(state, row.id, r => finishRow(r, listed.status, at))

  return withLog({ ...ended, agents: trimAgents(ended.agents) }, endEntry(row, listed.status, at))
}

const endEntry = (row: AgentRow, status: AgentStatus, at: number): LogEntry => ({
  at,
  kind: 'agent-end',
  detail: `${row.description}: ${status}`,
})

const endStatus = (reason: TurnEndReason): AgentStatus => {
  if (reason === 'aborted') return 'killed'

  return reason === 'answer' ? 'completed' : 'failed'
}

const agentDone = (state: DashState, e: Extract<DashEvent, { type: 'agent-done' }>): DashState => {
  const row = state.agents.find(a => a.id === e.id)
  if (row === undefined || row.isTeammate || !isLive(row.status)) return state

  const status = endStatus(e.reason)
  const ended = replaceAgent(state, row.id, r => finishRow(r, status, e.at))

  return withLog({ ...ended, agents: trimAgents(ended.agents) }, endEntry(row, status, e.at))
}

const agentResume = (state: DashState, id: string): DashState => {
  const row = state.agents.find(a => a.id === id)
  if (row === undefined || isLive(row.status)) return state

  return replaceAgent(state, id, r => ({ ...r, status: 'running', endedAt: undefined }))
}

// With tools still in flight the activity stays on a tool; with none, it is
// thinking while a turn runs and idle otherwise.
const toolEnded = (main: DashState['main']): DashState['main'] => {
  const toolsInFlight = Math.max(0, main.toolsInFlight - 1)
  if (toolsInFlight > 0) return { ...main, toolsInFlight }

  return { ...main, toolsInFlight, activity: main.turnStartedAt === undefined ? { kind: 'idle' } : { kind: 'thinking' } }
}

const applyCodex = (state: DashState, event: CodexEvent): DashState => {
  const change = reduceCodex(state.codex, event)
  if (change.jobs === state.codex) return state

  return change.logs.reduce(withLog, { ...state, codex: change.jobs })
}

export const apply = (state: DashState, event: DashEvent): DashState => {
  switch (event.type) {
    case 'reset':
      // The conversation starts over; the account's usage, the repository, the other sessions' waits
      // and the advisor model (a setting) do not.
      return {
        ...initialState,
        advisor: { ...initialState.advisor, model: state.advisor.model },
        quota: state.quota,
        git: state.git,
        waitingOthers: state.waitingOthers,
      }
    case 'session':
      return {
        ...state,
        main: { ...state.main, model: event.model, turns: event.turns },
        advisor: { ...state.advisor, model: event.advisorModel },
      }
    case 'advisor-model':
      return { ...state, advisor: { ...state.advisor, model: event.model } }
    case 'turn-start': {
      // The engine's own count when it is ahead (a resumed session); otherwise one more than before.
      const turns = Math.max(event.turns, state.main.turns + 1)
      const main = { ...state.main, turns, activity: { kind: 'thinking' } as const, turnStartedAt: event.at, toolsInFlight: 0 }

      return withLog({ ...state, main }, { at: event.at, kind: 'turn-start', detail: String(turns) })
    }
    case 'turn-end': {
      const main = { ...state.main, activity: { kind: 'idle' } as const, turnStartedAt: undefined, toolsInFlight: 0 }

      return withLog(
        { ...state, main },
        { at: event.at, kind: 'turn-end', detail: String(state.main.turns), durationMs: event.durationMs },
      )
    }
    case 'step':
      return { ...state, main: { ...state.main, model: event.model, effort: event.effort } }
    case 'tool-start': {
      const main = {
        ...state.main,
        activity: { kind: 'tool', name: event.name } as const,
        toolsInFlight: state.main.toolsInFlight + 1,
      }

      return withLog({ ...state, main }, { at: event.at, kind: 'tool', detail: event.name })
    }
    case 'tool-end':
      return { ...state, main: toolEnded(state.main) }
    case 'advisor-consult': {
      const advisor = { ...state.advisor, consults: state.advisor.consults + 1, lastAt: event.at }

      return withLog({ ...state, advisor }, { at: event.at, kind: 'advisor', detail: state.advisor.model ?? '' })
    }
    case 'agent-spawn':
      return state.agents.some(a => a.id === event.id)
        ? replaceAgent(state, event.id, row => ({
            ...row,
            type: event.agentType,
            description: event.description,
            model: event.model ?? row.model,
            startedAt: row.startedAt ?? event.at,
          }))
        : addAgent(state, spawnRow(event), event.at)
    case 'agent-model':
      return replaceAgent(state, event.id, row => ({ ...row, model: event.model }))
    case 'agent-resume':
      return agentResume(state, event.id)
    case 'agent-done':
      return agentDone(state, event)
    case 'agents-sync':
      return event.agents.reduce((s, listed) => syncOne(s, listed, event.at), state)
    case 'context':
      return { ...state, context: event.context }
    case 'git':
      return { ...state, git: event.git }
    case 'waiting-others':
      return { ...state, waitingOthers: event.rows }
    case 'codex-start':
    case 'codex-background':
    case 'codex-end':
    case 'codex-stop':
      return applyCodex(state, event)
    case 'claude-quota':
    case 'fable':
    case 'codex-quota':
      return { ...state, quota: reduceQuota(state.quota, event) }
  }
}

/** The ADVISOR block is for an advisor in play: a model is set, or it has been consulted. */
export const hasAdvisor = (state: DashState): boolean => state.advisor.model !== undefined || state.advisor.consults > 0

/** True while the main session works or a subagent or a Codex run is running: the dashboard animates. */
export const isActive = (state: DashState): boolean =>
  state.main.activity.kind !== 'idle' ||
  state.agents.some(a => a.status === 'pending' || a.status === 'running') ||
  isCodexRunning(state.codex)

// A row first seen in the list has no known start: it sorts after the rest.
const startKey = (row: AgentRow): number => row.startedAt ?? Number.MAX_SAFE_INTEGER

/**
 * The rows to draw in `slots` places at `now`: live ones first (oldest first),
 * then the newest finished that ended less than a minute ago.
 */
export const visibleAgents = (agents: readonly AgentRow[], slots: number, now: number): AgentRow[] => {
  const live = agents.filter(a => isLive(a.status)).sort((a, b) => startKey(a) - startKey(b))
  const finished = agents
    .filter(a => !isLive(a.status) && isFresh(a.endedAt, now))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  return [...live, ...finished].slice(0, Math.max(0, slots))
}

/** When the next finished row, subagent or Codex run, stops being drawn; none when no row is waiting to. */
export const nextRowExpiry = (state: DashState, now: number): number | undefined =>
  nextExpiry(
    [
      ...state.agents.filter(a => !isLive(a.status)).map(a => a.endedAt),
      ...state.codex.filter(j => j.status !== 'running').map(j => j.endedAt),
    ],
    now,
  )
