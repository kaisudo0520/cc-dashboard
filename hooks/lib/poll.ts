// The polling schedule: which sources are read, how often, and which are due.
// Plain numbers and a filter; register.tsx does the reading.

export type Source = 'claude' | 'fable' | 'codex' | 'git' | 'others'

export const SOURCES: readonly Source[] = ['claude', 'fable', 'codex', 'git', 'others']

/** What the 重新整理 button makes due at once: all but Fable, whose backoff after a failed request is not the button's to cut short. */
export const REFRESH_SOURCES: readonly Source[] = ['claude', 'codex', 'git', 'others']

/** How often the one pump looks at the schedule. */
export const PUMP_MS = 2_000
export const CLAUDE_MS = 30_000
export const CODEX_MS = 120_000
export const GIT_MS = 30_000
// The other sessions' marks are read this often; the registry and process table behind them less often.
export const OTHERS_MS = 5_000
export const SESSIONS_MS = 30_000

/** How long each source waits after a read; Fable's wait backs off and is kept by the caller. */
export const WAIT_MS: Record<Exclude<Source, 'fable'>, number> = {
  claude: CLAUDE_MS,
  codex: CODEX_MS,
  git: GIT_MS,
  others: OTHERS_MS,
}

/** The sources due at `now` that are not already being read. */
export const dueSources = (
  dueAt: Readonly<Record<Source, number>>,
  running: ReadonlySet<Source>,
  now: number,
): Source[] => SOURCES.filter(source => dueAt[source] <= now && !running.has(source))
