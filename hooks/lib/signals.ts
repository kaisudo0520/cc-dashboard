import type { DashEvent, ListedAgent } from './state'
import type { AgentStatus } from '../../types'

// Reading what the engine reports into the shapes the reducer takes. Plain
// data in, plain data out; the hooks do the calling.

/** The part of a `turn.step` server tool call the dashboard reads. */
type ServerToolUse = { name: string; startedAt: number; endedAt?: number }

/**
 * The advisor is a server tool: the API runs it inside the request, so no
 * `tool.call` fires for it. It shows only in the step result's
 * `serverToolUses`, named `advisor`. Each call is stamped when it ended.
 */
export const advisorTimes = (uses: readonly ServerToolUse[] | undefined): number[] =>
  (uses ?? []).filter(use => use.name === 'advisor').map(use => use.endedAt ?? use.startedAt)

/** The `advisorModel` setting, when it holds a model. */
export const advisorModelOf = (settings: Readonly<Record<string, unknown>>): string | undefined => {
  const model = settings.advisorModel

  return typeof model === 'string' && model !== '' ? model : undefined
}

/** The `agent.spawn` call, as far as the dashboard reads it. */
type SpawnCall = { subagentType: string; description: string; isTeammate?: boolean }

/** A spawned agent: with no description of its own it is known by its type. */
export const spawnEvent = (call: SpawnCall, id: string, model: string | undefined, at: number): DashEvent => ({
  type: 'agent-spawn',
  at,
  id,
  agentType: call.subagentType,
  description: call.description === '' ? call.subagentType : call.description,
  model,
  isTeammate: call.isTeammate === true,
})

/** One `$.agent.list()` row, as far as the dashboard reads it. */
type ListedRow = { id: string; description: string; type: string; status: AgentStatus; teammateId?: string }

export const listedAgents = (rows: readonly ListedRow[]): ListedAgent[] =>
  rows.map(row => ({
    id: row.id,
    agentType: row.type,
    description: row.description,
    status: row.status,
    isTeammate: row.teammateId !== undefined,
  }))
