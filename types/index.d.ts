export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = {
  model: string
  effort: string
  mode: string
  steps: number
  isRunning: boolean
  /** The main loop's last answered request: time to its first piece of response, and output tokens
   *  per second from that piece to the stop. Null until one is measured, absent in older state. */
  speed?: { ttftMs: number; tokPerS: number | null } | null
}

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  /** `resetsAt`: when the window resets, in ms since the epoch; null when the API gave no time,
   *  absent in state saved before it was kept. */
  limits: { kind: string; pct: number; resetsAt?: number | null }[]
  compactions: number
  lastCompactAt: number | null
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done'
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

/** `gitOpen`: the 分支 panel's list of unreviewed paths is unfolded (hotkey u). */
export type View = { expanded: string | null; gateOpen: Bucket | null; layout: Layout | null; gitOpen: boolean }

export type Roster = { architectTypes: string[] }

/** A usage window as last reported: how much of it is used, and when it resets (ms since the epoch). */
export type UsageWindow = { usedPercent: number; resetsAtMs?: number }

/** Codex's model and effort are what its config selects (display only); the windows come from its newest rollout. */
export type CodexQuota = {
  model?: string
  effort?: string
  fiveHour?: UsageWindow
  weekly?: UsageWindow
  /** Why the figures are missing, when they are. */
  note?: string
}

/** The session's repository as the 分支 panel shows it. */
export type GitSnap = {
  branch: string
  /** The branch it tracks (`origin/main`); absent with no upstream. */
  upstream?: string
  /** Commits not pushed / not pulled; absent with no upstream. */
  ahead?: number
  behind?: number
  /** Files that differ from HEAD, untracked ones included. */
  changed: number
  /** Of those, the ones whose content no review has seen; absent (unknown) when the content hashes or the review record could not be had. */
  unreviewed?: number
  /** Their paths, relative to the root, the first UNREVIEWED_SHOWN of them. */
  unreviewedPaths: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'cc-dashboard': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      /** Codex's usage windows; null until read, or where Codex cannot be read (no USERPROFILE or SystemRoot). */
      codex: CodexQuota | null
      /** The session's repository; null outside one, or when git cannot be read. */
      git: GitSnap | null
    }
  }
}
