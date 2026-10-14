import type { AgentStatus, CodexStatus, LogEntry, MainActivity } from '../../types'

// Plain text for the dashboard: durations, clock times, token counts, bars and
// the words of the log. Pure functions of plain data; nothing here draws.

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `12s`, `1m05s`, `1h02m`. */
export const duration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) return `${hours}h${pad2(minutes)}m`
  if (minutes > 0) return `${minutes}m${pad2(seconds)}s`

  return `${seconds}s`
}

/** The local `HH:MM:SS` of an epoch time. */
export const clock = (ms: number): string => {
  const d = new Date(ms)

  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const trimZero = (text: string): string => text.replace(/\.0$/, '')

/** `842`, `1.2k`, `84k`, `1.2M`. */
export const tokens = (n: number): string => {
  if (n < 1_000) return String(n)
  if (n < 10_000) return `${trimZero((n / 1_000).toFixed(1))}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`

  return `${trimZero((n / 1_000_000).toFixed(1))}M`
}

/** How long ago `thenMs` was: `剛剛`, `3分前`, `2時前`; `—` when it never happened. */
export const ago = (thenMs: number | undefined, nowMs: number): string => {
  if (thenMs === undefined) return '—'

  const minutes = Math.max(0, Math.floor((nowMs - thenMs) / 60000))
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes}分前`

  return `${Math.floor(minutes / 60)}時前`
}

/**
 * Text from outside (a session name, a branch, a path) drawn as a child of
 * `Text`: the engine refuses the whole tree if one child holds a control
 * character, a tab and an escape sequence included. Those, and the zero-width
 * and bidirectional marks that make a line read as something else, become
 * spaces: every control (Cc) and format (Cf: zero-width and directional marks,
 * the soft hyphen, the word joiner, invisible operators, annotation marks), the
 * line and paragraph separators (Zl, Zp), and the tag characters (U+E0000-E007F).
 */
export const plain = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{e0000}-\u{e007f}]/gu, ' ')

/** A model id without its vendor prefix and trailing date: `claude-haiku-4-5-20251001` is `haiku-4-5`. Drawable: made plain. */
export const modelLabel = (id: string | undefined): string =>
  id === undefined || id === '' ? '—' : plain(id.replace(/^claude-/, '').replace(/-\d{8}$/, ''))

/** The legend word for the subagents: their model when they share one, `mixed` when they differ. */
export const swarmLabel = (models: readonly (string | undefined)[]): string => {
  const distinct = [...new Set(models.filter((m): m is string => m !== undefined).map(modelLabel))]

  if (distinct.length === 0) return 'subagents'

  return distinct.length === 1 ? (distinct[0] ?? 'subagents') : 'mixed'
}

/** An effort level as written, a thinking budget as its number. */
export const effortLabel = (effort: string | number | undefined): string | undefined =>
  effort === undefined ? undefined : String(effort)

const ICON: Record<AgentStatus, string> = {
  pending: '○',
  running: '◐',
  waiting: '…',
  idle: '·',
  completed: '✓',
  failed: '✗',
  killed: '■',
}

export const statusIcon = (status: AgentStatus): string => ICON[status]

/** A `width`-cell bar filled to `percent`. */
export const bar = (percent: number, width: number): string => {
  if (width <= 0) return ''
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** How many of a bar's `width` cells are filled at `percent` (0-100). */
export const fillCells = (percent: number, width: number): number =>
  Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

/** Time left until `resetsAtMs`, two units at most: `2d3h`, `1h05m`, `7m`; `—` when unknown. */
export const countdown = (resetsAtMs: number | undefined, nowMs: number): string => {
  if (resetsAtMs === undefined) return '—'

  const minutes = Math.max(0, Math.floor((resetsAtMs - nowMs) / 60000))
  if (minutes === 0) return '<1m'

  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`

  return hours > 0 ? `${hours}h${pad2(minutes % 60)}m` : `${minutes}m`
}

/** A line of `width` cells; while `isActive`, a dot sits on it at the cell `frame` steps along. */
export const track = (width: number, frame: number, direction: 'forward' | 'back', isActive: boolean): string => {
  if (width <= 0) return ''
  if (!isActive) return '─'.repeat(width)

  const step = frame % width
  const at = direction === 'forward' ? step : width - 1 - step

  return '─'.repeat(at) + '●' + '─'.repeat(width - at - 1)
}

export const activityText = (activity: MainActivity): string => {
  if (activity.kind === 'idle') return '閒置'
  if (activity.kind === 'thinking') return '思考中'

  return `執行工具 ${plain(activity.name)}`
}

const logWords = (entry: LogEntry): string => {
  switch (entry.kind) {
    case 'turn-start':
      return `回合 ${entry.detail} 開始`
    case 'turn-end':
      return `回合 ${entry.detail} 完成 · ${duration(entry.durationMs ?? 0)}`
    case 'tool':
      return `工具 ${entry.detail}`
    case 'spawn':
      return `子代理啟動 ${entry.detail}`
    case 'agent-end':
      return `子代理結束 ${entry.detail}`
    case 'advisor':
      return entry.detail === '' ? '顧問諮詢' : `顧問諮詢 · ${modelLabel(entry.detail)}`
    case 'codex-start':
      return `Codex 啟動 ${entry.detail}`
    case 'codex-done':
      return `Codex 完成 ${entry.detail}`
    case 'codex-fail':
      return `Codex 失敗 ${entry.detail}`
  }
}

/** One log line without its time; the words come from outside (tool names, descriptions), so it is made plain. */
export const logText = (entry: LogEntry): string => plain(logWords(entry))

const CODEX_AS_AGENT: Record<CodexStatus, AgentStatus> = { running: 'running', done: 'completed', failed: 'failed' }
const CODEX_WORD: Record<CodexStatus, string> = { running: '執行中', done: '完成', failed: '失敗' }

export const codexIcon = (status: CodexStatus): string => statusIcon(CODEX_AS_AGENT[status])

export const codexStatusText = (status: CodexStatus): string => CODEX_WORD[status]
