// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call or a
// permission check inside a call; these functions are what the hooks apply).
import type {
  AgentCard,
  Architect,
  Bucket,
  Check,
  Gate,
  Layout,
  LogLine,
  Loop,
  Main,
  Moment,
  Receipt,
  Roster,
  Tally,
  ToolNote,
  Turn,
  Usage,
  UsageWindow,
  GitSnap,
  View,
} from '../types'

export const SCHEMA_VERSION = 3

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false }
export const DEFAULT_USAGE: Usage = {
  pct: null,
  tokens: null,
  window: 0,
  limits: [],
  compactions: 0,
  lastCompactAt: null,
}
export const DEFAULT_ARCHITECT: Architect = { consults: [], ids: [], seen: [], lastAdvice: '' }
const ZERO: Tally = { rule: 0, ask: 0, cleared: 0, deny: 0 }
export const DEFAULT_GATE: Gate = { recent: [], totals: { file: ZERO, shell: ZERO, other: ZERO } }
export const DEFAULT_TURN: Turn = { edits: 0, errorStreak: 0, errors: 0, isReviewing: false, startedAt: 0 }
export const DEFAULT_VIEW: View = { expanded: null, gateOpen: null, layout: null, gitOpen: false }
export const DEFAULT_ROSTER: Roster = { architectTypes: [] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const normalizeGate = (stored: unknown): Gate => {
  const g = normalize(DEFAULT_GATE, stored)
  const totals = normalize(DEFAULT_GATE.totals, g.totals)
  return {
    recent: listOf<Check>(g.recent),
    totals: { file: normalize(ZERO, totals.file), shell: normalize(ZERO, totals.shell), other: normalize(ZERO, totals.other) },
  }
}

export const normalizeCard = (stored: unknown): AgentCard =>
  normalize<AgentCard>(
    {
      id: '',
      type: 'agent',
      model: '',
      description: '',
      status: 'running',
      spawnedAt: 0,
      endedAt: null,
      ctx: 0,
      out: 0,
      steps: 0,
      lastStop: null,
      tools: [],
      answer: '',
    },
    stored,
  )

export const normalizeLog = (stored: unknown): LogLine[] =>
  listOf<Record<string, unknown>>(stored).map(l => ({
    at: typeof l.at === 'number' ? l.at : 0,
    who: String(l.who ?? ''),
    text: String(l.text ?? ''),
    agentId: typeof l.agentId === 'string' ? l.agentId : null,
    kind: l.kind === 'error' || l.kind === 'consult' || l.kind === 'done' ? l.kind : 'info',
  }))

// ---------------------------------------------------------------- config

export type Panel = 'main' | 'codex' | 'git' | 'architect' | 'gate' | 'agents' | 'loops' | 'receipt' | 'log'
const PANELS: readonly Panel[] = ['main', 'codex', 'git', 'architect', 'gate', 'agents', 'loops', 'receipt', 'log']

export type Config = {
  architect: RegExp
  architectLabel: string
  gateLabel: string
  panels: Panel[]
  motion: boolean
  moments: boolean
  matchDescriptions: boolean
  maxCards: number
  layout: Layout
  palette: Palette
  openOnStart: boolean
  statusLine: boolean
  /** The share of the terminal's width the dock asks for in the fullscreen layout, in percent. */
  dockPercent: number
}

const safeRegExp = (source: string, fallback: string) => {
  try {
    return new RegExp(source || fallback, 'i')
  } catch {
    return new RegExp(fallback, 'i')
  }
}

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const panels = str('panels', PANELS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter((p): p is Panel => (PANELS as readonly string[]).includes(p))
  const layout = str('layout', 'auto')
  const max = typeof o.maxCards === 'number' ? Math.round(o.maxCards) : 3
  const dock = typeof o.dockPercent === 'number' && Number.isFinite(o.dockPercent) ? Math.round(o.dockPercent) : DOCK_PERCENT
  return {
    architect: safeRegExp(str('architectPattern', ''), 'advisor|architect'),
    architectLabel: str('architectLabel', 'ARCHITECT'),
    gateLabel: str('gateLabel', 'GATE'),
    panels: panels.length > 0 ? [...new Set(panels)] : [...PANELS],
    motion: str('motion', 'while-active') !== 'off',
    moments: bool('moments', true),
    matchDescriptions: bool('matchDescriptions', false),
    maxCards: Math.min(6, Math.max(1, max)),
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    openOnStart: bool('openOnStart', true),
    statusLine: bool('statusLine', true),
    dockPercent: Math.min(DOCK_PERCENT_MAX, Math.max(DOCK_PERCENT_MIN, dock)),
  }
}

// ---------------------------------------------------------------- dock

const DOCK_PERCENT = 40
const DOCK_PERCENT_MIN = 20
const DOCK_PERCENT_MAX = 80
/** The cells the dock's frame takes beside its body: the divider and the edge. */
const DOCK_FRAME_COLUMNS = 2
/** The narrowest body the pane lays out for; the drawing never goes below it either. */
export const DOCK_MIN_COLUMNS = 40

/** The body columns to ask the dock for: `percent` of the terminal's width, less the frame. */
export const dockColumns = (terminalColumns: number, percent: number) =>
  Math.max(DOCK_MIN_COLUMNS, Math.round((terminalColumns * percent) / 100) - DOCK_FRAME_COLUMNS)

/** The cell the engine draws beside a docked pane's body, for the person to drag it by. */
const DOCK_GRIP_COLUMNS = 1

/**
 * The terminal's width from a docked drawing: on the terminal `viewport.columns` is the transcript's
 * columns only, so the dock (its body and its grip) is added back.
 */
export const terminalWidth = (viewportColumns: number, bodyColumns: number) =>
  viewportColumns + bodyColumns + DOCK_GRIP_COLUMNS

// ---------------------------------------------------------------- palette

export type Palette = 'theme' | 'pastel'
export type Colors = Record<'main' | 'agent' | 'gate' | 'cleared' | 'arch' | 'codex' | 'branch' | 'amber' | 'warn' | 'dim' | 'faint' | 'text', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals.
 */
export const PALETTES: Record<Palette, Colors> = {
  theme: {
    main: 'claude',
    agent: 'suggestion',
    gate: 'success',
    cleared: 'permission',
    arch: 'merged',
    codex: 'planMode',
    branch: 'promptBorder',
    amber: 'warning',
    warn: 'error',
    dim: 'inactive',
    faint: 'subtle',
    text: 'text',
  },
  pastel: {
    main: '#7dd3fc',
    agent: '#93c5fd',
    gate: '#86efac',
    cleared: '#5eead4',
    arch: '#c4b5fd',
    codex: '#fdba74',
    branch: '#d0d7de',
    amber: '#fcd34d',
    warn: '#fca5a5',
    dim: '#6b7280',
    faint: '#3f4654',
    text: '#e5e7eb',
  },
}

/** SVG cannot name theme keys: mid-tone colours that read on light and dark backgrounds. */
export const SVG_COLORS = { running: '#3b82f6', done: '#16a34a', failed: '#dc2626', other: '#8b5cf6', label: '#6b7280' }

// ---------------------------------------------------------------- formatting

/** `claude-opus-5-5` → `Opus 5.5`; anything else is shown as given. */
/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`, `claude-3-5-haiku-20241022` →
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

export const kTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A running clock as the live cards draw it: m:ss, or XhYY past an hour. */
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtClock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')

/** `1 error`, `2 errors`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A gauge of `width` cells: ▰ filled, ▱ empty, or in the glyphs given. */
export const gauge = (pct: number, width: number, [filled, empty]: readonly [string, string] = ['▰', '▱']) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: filled.repeat(full), off: empty.repeat(Math.max(0, width - full)) }
}

/** The usage rows' glyphs, as the first version drew its quota bars: ━ used, ─ the rest. */
export const LINE_GLYPHS = ['━', '─'] as const

/** A rate-limit reading as the pane keeps it, its ISO reset time turned into ms since the epoch. */
export const limitOf = (r: { kind: string; percentUsed: number; resetsAt?: string }) => {
  const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  return { kind: r.kind, pct: r.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
}

/** Time left until a window resets, its two largest units: `25m`, `3h10m`, `4d2h`; empty when unknown or past. */
export const fmtResetIn = (resetsAt: number | null | undefined, now: number) => {
  if (resetsAt === null || resetsAt === undefined || resetsAt <= now) return ''
  const m = Math.max(1, Math.floor((resetsAt - now) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

/** A rate-limit window's short name: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
export const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

// ---------------------------------------------------------------- redaction

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** What the gate drill-down may store: credentials masked before anything is written to state. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// ---------------------------------------------------------------- tools and gate

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const bucketOf = (tool: string): Bucket =>
  FILE_TOOLS.has(tool) ? 'file' : SHELL_TOOLS.has(tool) ? 'shell' : 'other'

/** One line saying what a call was about: its command, path or pattern; redacted. */
export const describeInput = (tool: string, input: unknown) => {
  const i = isObject(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what =
    typeof i.command === 'string'
      ? i.command
      : path || (typeof i.pattern === 'string' ? i.pattern : typeof i.url === 'string' ? i.url : typeof i.description === 'string' ? i.description : '')
  return redact(what ? `${tool} → ${what}` : tool)
}

/** Keeps the last `max` checks, but never drops a pending ask: its settle must still find it. */
export const trimRecent = (list: Check[], max: number): Check[] => {
  let extra = list.length - max
  if (extra <= 0) return list
  const out: Check[] = []
  for (const c of list) {
    if (extra > 0 && c.verdict !== 'ask') {
      extra -= 1
      continue
    }
    out.push(c)
  }
  return out.slice(-max * 2)
}

export const recordCheck = (g: Gate, c: Check): Gate => {
  const t = g.totals[c.bucket]
  return {
    recent: trimRecent([...g.recent, c], 80),
    totals: { ...g.totals, [c.bucket]: { ...t, [c.verdict]: t[c.verdict] + 1 } },
  }
}

/** An `ask` settled by the call that followed it: it ran (cleared) or was refused (deny). */
export const settleCheck = (g: Gate, id: string, didRun: boolean): Gate => {
  const c = g.recent.find(r => r.id === id && r.verdict === 'ask')
  if (!c) return g
  const verdict = didRun ? 'cleared' : 'deny'
  const t = g.totals[c.bucket]
  return {
    recent: g.recent.map(r => (r === c ? { ...r, verdict } : r)),
    totals: { ...g.totals, [c.bucket]: { ...t, ask: Math.max(0, t.ask - 1), [verdict]: t[verdict] + 1 } },
  }
}

export const gateSummary = (g: Gate) => {
  const all = (['file', 'shell', 'other'] as const).reduce(
    (s, k) => ({
      rule: s.rule + g.totals[k].rule,
      ask: s.ask + g.totals[k].ask,
      cleared: s.cleared + g.totals[k].cleared,
      deny: s.deny + g.totals[k].deny,
    }),
    { ...ZERO },
  )
  return { ...all, total: all.rule + all.ask + all.cleared + all.deny }
}

// ---------------------------------------------------------------- turn and architect

/**
 * The turn after one tool call. Errors count in the main loop only (a subagent's failure is its
 * own); edits count from every loop, so delegated work still reaches "before done".
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

/** Which of the architect's three moments a consult falls at: an inference over this turn so far. */
export const momentOf = (t: Pick<Turn, 'edits' | 'errorStreak'>): Moment =>
  t.errorStreak >= 2 ? 'error repeats' : t.edits === 0 ? 'before a plan' : 'before done'

export const startConsult = (a: Architect, c: { id: string; at: number; moment: Moment; via: string }): Architect =>
  a.consults.some(x => x.id === c.id) ? a : { ...a, consults: [...a.consults, { ...c, endAt: null }].slice(-40) }

/** Ends the open consult (the latest without an end), or the one named. */
export const endConsult = (a: Architect, at: number, advice: string | null, id?: string): Architect => {
  const open = [...a.consults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  return {
    ...a,
    consults: a.consults.map(c => (c === open ? { ...c, endAt: at } : c)),
    lastAdvice: advice ?? a.lastAdvice,
  }
}

export const isAdvising = (a: Architect) => a.consults.some(c => c.endAt === null)

/** A one-row timeline of consults across `width` cells: ◆ a consult, ━ while it ran. */
export const consultTimeline = (a: Architect, now: number, width: number) => {
  if (a.consults.length === 0 || width < 4) return '─'.repeat(Math.max(0, width))
  const first = a.consults[0]?.at ?? now
  const span = Math.max(1, now - first)
  const cells = Array.from({ length: width }, () => '─')
  for (const c of a.consults) {
    const from = Math.min(width - 1, Math.floor(((c.at - first) / span) * (width - 1)))
    const to = Math.min(width - 1, Math.floor((((c.endAt ?? now) - first) / span) * (width - 1)))
    for (let i = from + 1; i <= to; i += 1) cells[i] = '━'
    cells[from] = '◆'
  }
  return cells.join('')
}

export const receiptOf = (t: Turn, o: { durationMs: number; agentsSince: number; reason: string }): Receipt => ({
  durationMs: o.durationMs,
  agents: o.agentsSince,
  edits: t.edits,
  errors: t.errors,
  reason: o.reason,
})

// ---------------------------------------------------------------- agents and loops

type StepUsage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | null

/** A card after one of its model requests: its context is the latest step's whole input; output adds up. */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...c,
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    out: c.out + (u.output_tokens ?? 0),
    lastStop: s.stopReason,
  }
}

export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({ ...c, tools: [...c.tools, n].slice(-3) })

export const stepLoop = (loops: Loop[], id: string, at: number): Loop[] => {
  const found = loops.find(l => l.id === id)
  const next = found
    ? loops.map(l => (l === found ? { ...l, steps: l.steps + 1, lastAt: at } : l))
    : [...loops, { id, steps: 1, firstAt: at, lastAt: at, isDone: false }]
  return next.slice(-60)
}

export const LOOP_ACTIVE_MS = 15_000
export const isLoopActive = (l: Loop, now: number) => !l.isDone && now - l.lastAt < LOOP_ACTIVE_MS

/** Swimlane geometry: each agent's bar on one shared axis from the first spawn to now. */
export const lanes = (cards: AgentCard[], now: number, width: number) => {
  const start = Math.min(...cards.map(c => c.spawnedAt).filter(n => n > 0), now)
  const span = Math.max(1, now - start)
  return cards.map(c => {
    const from = Math.floor(((Math.max(c.spawnedAt, start) - start) / span) * width)
    const to = Math.max(from + 1, Math.ceil((((c.endedAt ?? now) - start) / span) * width))
    return { id: c.id, before: Math.min(from, width), bar: Math.min(to, width) - Math.min(from, width), after: width - Math.min(to, width) }
  })
}

// ---------------------------------------------------------------- layout

/** How many log lines fit: what the other panels leave, never fewer than 4 nor more than 8. */
export const logRows = (bodyRows: number, used: number) => Math.max(4, Math.min(8, bodyRows - used - 3))

/** Terminal cells a string takes: CJK, full-width characters and emoji (U+1F300 to U+1FAFF, the branch marker among them) take two. */
export const cells = (s: string) =>
  [...s].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1), 0)

/** Legend items that fit on one row of `width` cells, in order; the rest are dropped. */
export const fitLegend = <T extends { label: string }>(items: T[], width: number) => {
  const out: T[] = []
  let used = 0
  for (const it of items) {
    const w = cells(it.label) + 4
    if (used + w > width) break
    out.push(it)
    used += w
  }
  return out
}

/** A card's title row: the task in the agent's own words, the type only when there is none. */
export const cardTitle = (c: AgentCard) => c.description || c.type

/** A title split over two rows at a word boundary: `first` cells on row one, `rest` on row two. */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= first) return [t, '']
  const cut = t.lastIndexOf(' ', first)
  const at = cut > 0 ? cut : first
  return [t.slice(0, at).trim(), shorten(t.slice(at), rest)]
}

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 */
export const promptLine = (text: string): { who: string; text: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(text, 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  return { who: 'engine', text: shorten(`${tag.replace(/[-_]/g, ' ')}${from ? ` from ${from.slice(0, 8)}` : ''}`, 70) }
}

/**
 * A subagent's hand-back message: who sent it and the first line of what it said. The report
 * follows a framing header in the message; without one, the first line after the opening tag.
 */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const afterHeader = text.split(/The report follows:\s*\n/)[1]
  const rest = afterHeader ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body =
    rest
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('</')) ?? ''
  return body ? { from, body } : null
}

/** The advice line a pane shows for a report: its first real line, markdown markers stripped, cut to 160. */
export const adviceLine = (report: string) => {
  const first = report.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return shorten(first.replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, ''), 160)
}

export const elapsedOf = (c: AgentCard, now: number) => (c.endedAt ?? now) - c.spawnedAt

// ---------------------------------------------------------------- Codex usage

/**
 * A usage window as the pane draws it: percent used, whether the reading is past its reset, and the
 * time left to the reset. A window past its reset has restarted (the next request opens a new one),
 * so it reads 0% used, still marked until a fresh reading arrives. Null when the window is unknown.
 */
export const windowView = (w: UsageWindow | undefined, now: number) => {
  if (w === undefined || !Number.isFinite(w.usedPercent)) return null
  const isStale = w.resetsAtMs !== undefined && w.resetsAtMs <= now
  const pct = isStale ? 0 : Math.max(0, Math.min(100, Math.round(w.usedPercent)))
  return { pct, isStale, resetIn: isStale ? '' : fmtResetIn(w.resetsAtMs ?? null, now) }
}

/** `5h 13%`, `~0%` past its reset, `—` unknown: the window in a few cells. */
export const windowShort = (label: string, w: UsageWindow | undefined, now: number) => {
  const v = windowView(w, now)
  return `${label} ${v === null ? '—' : `${v.isStale ? '~' : ''}${v.pct}%`}`
}

const CLAUDE_WINDOWS = ['five_hour', 'seven_day']

/** A rate-limit reading as a usage window, its reset kept when the API gave one. */
export const limitWindow = (l: { pct: number; resetsAt?: number | null }): UsageWindow =>
  l.resetsAt == null ? { usedPercent: l.pct } : { usedPercent: l.pct, resetsAtMs: l.resetsAt }

/** Claude's 5-hour and 7-day windows in a few cells, `5h 19% · 7d 3%`; null before any reading. */
export const claudeWindows = (limits: readonly { kind: string; pct: number; resetsAt?: number | null }[], now: number) => {
  const shown = CLAUDE_WINDOWS.flatMap(kind => limits.filter(l => l.kind === kind).slice(0, 1))
  return shown.length === 0 ? null : shown.map(l => windowShort(limitLabel(l.kind), limitWindow(l), now)).join(' · ')
}

// ---------------------------------------------------------------- usage rows

/** The cells a round-bordered panel with one cell of padding on each side takes from its width. */
export const PANEL_FRAME = 4
const METER_MIN = 4
const METER_MAX = 40
/** The percent column, right-aligned after a space: `100%`, or `~100%` past its reset. */
const METER_PCT_W = 5
/** The detail column: `⏱  10d23h` (two spaces after the clock), `stale`, or the context's `116k/200k`. */
const METER_DETAIL_W = 9

/** One usage row as the pane draws it: `pct` null is a window not read yet. */
export type Meter = { label: string; pct: number | null; isStale: boolean; detail: string }

/** A usage window as a row: the time to its reset, or `stale` once past it, at 0% used. */
export const windowMeter = (label: string, w: UsageWindow | undefined, now: number): Meter => {
  const v = windowView(w, now)
  if (v === null) return { label, pct: null, isStale: false, detail: '' }
  return { label, pct: v.pct, isStale: v.isStale, detail: v.isStale ? 'stale' : v.resetIn ? `⏱  ${v.resetIn}` : '' }
}

/** `  58%`, ` ~58%` past its reset: right-aligned in the percent column. */
export const meterPercent = (m: Meter) => `${m.isStale ? '~' : ''}${m.pct ?? 0}%`.padStart(METER_PCT_W)

/**
 * The bar's cells for the rows of a panel `panelW` wide: the label column, a space, the bar, a space,
 * the percent, a space, then the widest of the rows' details. One width for every row of the panel,
 * so the bars start and end together whatever each row's detail is.
 */
export const meterWidth = (panelW: number, labelW: number, details: readonly string[]) =>
  Math.min(METER_MAX, Math.max(METER_MIN, panelW - PANEL_FRAME - labelW - METER_PCT_W - 3 - Math.max(METER_DETAIL_W, ...details.map(cells))))

/**
 * The bar of a line drawn without a box, alone in its row (the context): whatever the label, the
 * percent and its own detail leave of the whole `lineW`, with no upper cap, so the line spans the pane.
 */
export const lineMeterWidth = (lineW: number, labelW: number, detail: string) =>
  Math.max(METER_MIN, lineW - labelW - METER_PCT_W - 3 - cells(detail))

/** `s` padded with spaces to `width` cells, a wide character counting two. */
export const padCells = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - cells(s)))

// ---------------------------------------------------------------- branch

/** How many unreviewed paths the unfolded list draws before counting the rest. */
export const GIT_PATH_ROWS = 8

/** `unreviewed 3 files`; `✓ unreviewed 0` when every change was seen; `unreviewed ?` when that cannot be known, never 0. */
export const unreviewedLabel = (s: GitSnap) =>
  s.unreviewed === undefined ? 'unreviewed ?' : s.unreviewed === 0 ? '✓ unreviewed 0' : `unreviewed ${plural(s.unreviewed, 'file')}`

/** `changed 5 files`: files that differ from HEAD, untracked ones included. */
export const changedLabel = (s: GitSnap) => `changed ${plural(s.changed, 'file')}`

/** `↔ origin/main ↑2 ↓1`, or `no upstream`. */
export const syncLabel = (s: GitSnap) => (s.upstream === undefined ? 'no upstream' : `↔ ${s.upstream} ↑${s.ahead ?? 0} ↓${s.behind ?? 0}`)

/** The list of unreviewed paths is only worth unfolding when there are some. */
export const canUnfold = (s: GitSnap) => (s.unreviewed ?? 0) > 0

/**
 * The paths to draw in `slots` rows, and how many unreviewed files are left out. Room for all of
 * them draws every path; less room gives the last row to the count of those not drawn.
 */
export const pathLines = (s: GitSnap, slots: number): { paths: string[]; hidden: number } => {
  const listed = s.unreviewedPaths
  const total = s.unreviewed ?? 0
  const more = total > listed.length ? 1 : 0
  if (slots <= 0 || total === 0) return { paths: [], hidden: 0 }
  if (slots >= listed.length + more) return { paths: listed, hidden: total - listed.length }
  return { paths: listed.slice(0, slots - 1), hidden: total - (slots - 1) }
}

/** The rows the unfolded list takes: its paths and a closing count, within GIT_PATH_ROWS. */
export const pathRows = (s: GitSnap, isOpen: boolean) => {
  if (!isOpen) return 0
  const { paths, hidden } = pathLines(s, GIT_PATH_ROWS)
  return paths.length + (hidden > 0 ? 1 : 0)
}

// ---------------------------------------------------------------- Codex runs as cards

/** A `codex exec` run the main session started, as a running card: no steps or tokens to tell. */
export const codexCard = (id: string, call: { purpose: string; note?: string }, model: string, at: number): AgentCard => ({
  ...normalizeCard({}),
  id,
  type: 'Codex',
  model,
  description: call.note ? `${call.purpose}: ${call.note}` : call.purpose,
  spawnedAt: at,
  codex: {},
})

/** A card ended: done when it went well, failed otherwise. A card already ended stays as it ended. */
export const endCard = (c: AgentCard, ok: boolean, at: number): AgentCard =>
  c.status !== 'running' ? c : { ...c, status: ok ? 'done' : 'failed', endedAt: at }

/**
 * The Codex runs a turn's stop settles: a foreground run still open was abandoned (failed); a
 * background run the engine no longer lists has finished (done). Unknown lists settle nothing
 * in the background. Answers the ids it ended, with how.
 */
export const stopCodex = (cards: AgentCard[], liveIds: readonly string[] | undefined): { id: string; ok: boolean }[] =>
  cards.flatMap((c): { id: string; ok: boolean }[] => {
    if (c.codex === undefined || c.status !== 'running') return []
    if (c.codex.taskId === undefined) return [{ id: c.id, ok: false }]
    return liveIds !== undefined && !liveIds.includes(c.codex.taskId) ? [{ id: c.id, ok: true }] : []
  })

/** The card a notification ends: by its background task id, else by the shell call that started it. */
export const codexCardFor = (cards: AgentCard[], taskId: string, toolUseId: string | undefined) =>
  cards.find(c => c.codex !== undefined && (c.codex.taskId === taskId || (toolUseId !== undefined && c.id === toolUseId)))

// ---------------------------------------------------------------- panels side by side

/** The narrowest pane that seats two panels in a row. */
const PAIR_MIN_COLUMNS = 70

/** The two panels' widths in a pane `w` wide, a cell between them, the left one taking the odd cell; null when too narrow. */
export const pairWidths = (w: number): [number, number] | null =>
  w < PAIR_MIN_COLUMNS ? null : [Math.ceil((w - 1) / 2), Math.floor((w - 1) / 2)]

/** A row of the single column: one panel, or two side by side (the left one first). */
export type PairRow = Panel | readonly [Panel, Panel]

const PAIRS: readonly (readonly [Panel, Panel])[] = [
  ['main', 'codex'],
  ['git', 'gate'],
]

/**
 * The single column's rows when panels may share one. The gate rises over the architect to sit
 * beside the branch; a pair forms only for panels listed next to each other (in either order),
 * so a person's own `panels` order is kept and a panel without its partner has a row to itself.
 */
export const pairRows = (panels: readonly Panel[]): PairRow[] => {
  const g = panels.indexOf('git')
  const k = panels.indexOf('gate')
  const lifted =
    g >= 0 && k > g && panels.slice(g + 1, k).every(p => p === 'architect')
      ? [...panels.slice(0, g + 1), 'gate' as const, ...panels.slice(g + 1, k), ...panels.slice(k + 1)]
      : [...panels]
  const rows: PairRow[] = []
  for (let i = 0; i < lifted.length; i++) {
    const [a, b] = [lifted[i], lifted[i + 1]]
    const pair = PAIRS.find(([x, y]) => (a === x && b === y) || (a === y && b === x))
    if (pair) i++
    rows.push(pair ?? (a as Panel))
  }
  return rows
}

/** A row of the single column: a panel, two side by side, or the context line under the main box. */
export type ColumnRow = PairRow | 'ctx'

/**
 * The column's rows with the context line put in: right after the row that holds the main box, or
 * after the Codex box when that is the next row. The context belongs to the main box, so a column
 * without the main box has no context line.
 */
export const withCtx = (rows: readonly PairRow[]): ColumnRow[] => {
  const main = rows.findIndex(r => r === 'main' || (typeof r !== 'string' && r.includes('main')))
  if (main < 0) return [...rows]
  const at = rows[main] === 'main' && rows[main + 1] === 'codex' ? main + 2 : main + 1
  return [...rows.slice(0, at), 'ctx', ...rows.slice(at)]
}

/** The cells the effort bar and its space take ahead of the narrow effort line's effort. */
const EFFORT_LEAD = 5

/**
 * The main box's effort line when two boxes share a row: `▮▮▮▯ high · auto · 12 req`. The bar is
 * drawn by the caller; the mode is cut (or left out) so the line fits `inner` cells.
 */
export const narrowEffort = (effort: string, mode: string, steps: number, inner: number) => {
  const label = effort || '—'
  const count = ` · ${steps} req`
  const room = inner - EFFORT_LEAD - cells(label) - cells(count) - 3
  const shown = mode && room >= 2 ? shorten(mode, room) : ''
  return { effort: label, tail: `${shown ? ` · ${shown}` : ''}${count}` }
}

/** The rows that items `widths` wide take in a wrapping row of `inner` cells with `gap` cells between them. */
export const wrapRows = (widths: readonly number[], inner: number, gap: number) =>
  widths.reduce(
    (s, w) => (s.rows > 0 && s.used + gap + w <= inner ? { rows: s.rows, used: s.used + gap + w } : { rows: s.rows + 1, used: w }),
    { rows: 0, used: 0 },
  ).rows
