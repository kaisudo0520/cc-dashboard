/** The statuses `$.agent.list()` reports. */
export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** What the main conversation is doing right now. */
export type MainActivity = { kind: 'idle' } | { kind: 'thinking' } | { kind: 'tool'; name: string }

export type MainState = {
  /** The model id as `$.session.model()` / the latest request names it. */
  model?: string
  /** The effort the latest main request carried. */
  effort?: string
  activity: MainActivity
  /** Turns of the main conversation. */
  turns: number
  /** When the turn in flight began, epoch ms. */
  turnStartedAt?: number
  /** Main-loop tool calls started and not yet returned (tools may run in parallel). */
  toolsInFlight: number
}

export type AdvisorState = {
  /** The `advisorModel` setting, when one is set. */
  model?: string
  /** Advisor calls seen in `turn.step` results (`serverToolUses`). */
  consults: number
  /** When the latest consult ended (or started, when no end is stamped), epoch ms. */
  lastAt?: number
}

export type AgentRow = {
  id: string
  /** The agent type (`Explore`, `general-purpose`, ...). */
  type: string
  /** The task description the agent was started with. */
  description: string
  model?: string
  status: AgentStatus
  isTeammate: boolean
  /** When it started; unknown for an agent first seen in `$.agent.list()`. */
  startedAt?: number
  /** When it was first seen finished, epoch ms. */
  endedAt?: number
}

/** One rate-limit window: `usedPercent` 0-100 as last reported, `resetsAtMs` in epoch ms. */
export type UsageWindow = { usedPercent: number; resetsAtMs?: number }

export type ClaudeQuota = {
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
  /** The Fable weekly window, from /api/oauth/usage. */
  fable?: UsageWindow
  /** True when the last refresh of the Fable window failed, so the figure may be old. */
  isFableStale?: boolean
}

/** Codex's model and effort are what its config selects (display only); the windows come from its newest rollout. */
export type CodexQuota = {
  model?: string
  effort?: string
  fiveHour?: UsageWindow
  weekly?: UsageWindow
  /** Why the figures are missing, when they are. */
  note?: string
}

export type QuotaState = { claude: ClaudeQuota; codex: CodexQuota }

/** How a `codex exec` run the main session launched stands. */
export type CodexStatus = 'running' | 'done' | 'failed'

export type CodexJob = {
  /** The tool call's id; a run that moved to the background takes its task id instead. */
  id: string
  /** The Bash/PowerShell tool call that launched the run. */
  toolUseId: string
  background: boolean
  /** What the run is for, from the command: planning draft, review, resumed talk. */
  purpose: string
  /** The call's own `description`, when it had one. */
  note?: string
  /** The Codex session id; unknown until the command or its output names it. */
  sessionId?: string
  status: CodexStatus
  startedAt: number
  endedAt?: number
  /** True when the end was concluded from the engine's task list, not reported by the run. */
  inferred?: true
}

/** What a session waits on the person for: a permission dialog, or a question or plan to approve. */
export type WaitReason = 'permission' | 'question'

/** Another live session waiting on the person; the longest wait is first in a list of them. */
export type WaitingRow = { id: string; name: string; reason: WaitReason; sinceMs: number }

/** A Claude Code process the session registry lists and the process table confirms. */
export type LiveSession = {
  id: string
  /** The process it runs in, which names its wait mark. */
  pid: number
  name: string
  /** True for the session this dashboard belongs to. */
  isHere: boolean
}

/** The work tree of the session's repository. */
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

export type LogKind =
  | 'turn-start'
  | 'turn-end'
  | 'tool'
  | 'spawn'
  | 'agent-end'
  | 'advisor'
  | 'codex-start'
  | 'codex-done'
  | 'codex-fail'

export type LogEntry = { at: number; kind: LogKind; detail: string; durationMs?: number }

/** The context window: `tokens` of `window` in use, once a response has reported it. */
export type ContextUse = { tokens?: number; window: number; percent?: number }

export type DashState = {
  main: MainState
  advisor: AdvisorState
  agents: AgentRow[]
  /** `codex exec` runs the main session launched through Bash or PowerShell. */
  codex: CodexJob[]
  /** The account's usage windows; kept across /clear and /resume. */
  quota: QuotaState
  /** The session's repository as last read; null outside one, or before the first look. Kept across /clear and /resume. */
  git: GitSnap | null
  /** The other live sessions waiting on the person, longest wait first; kept across /clear and /resume. */
  waitingOthers: WaitingRow[]
  /** Newest last. */
  log: LogEntry[]
  context: ContextUse | null
}

declare module 'claude-code' {
  interface PluginState {
    'cc-dashboard': {
      dash: DashState
      /** True once the pane has been opened without being asked: a reload must not reopen it. */
      autoOpened: boolean
      /** The body rows the pane asked for, once the terminal's height was known. */
      paneRows: number | undefined
      /** The 分支 panel's list of unreviewed paths is unfolded. */
      unreviewedOpen: boolean
      /** The quota header and the 分支 panel the person folded to their title line. */
      folded: { quota: boolean; git: boolean }
      /** This session's own wait on the person, null when there is none. */
      waiting: { reason: WaitReason; sinceMs: number } | null
      /** The live Claude Code sessions, from the registry and the process table. */
      sessions: LiveSession[]
    }
  }
}
