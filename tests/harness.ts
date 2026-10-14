import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

// The stand-in engine the dashboard tests share: it answers every call the mod
// makes, keeps what was asked, and lets a test change the world between steps.

export const NOW = new Date(2026, 9, 14, 14, 2, 11).getTime()

export const WIDE_PROPS = {
  title: 'Dashboard',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

export const NARROW_PROPS = { ...WIDE_PROPS, bodyColumns: 40, scroll: { offset: 0, bodyRows: 20 } } as const

export type GitAnswer = { exitCode: number; stdout: string; isStdoutTruncated?: boolean }

export type World = {
  opened: string[]
  closed: string[]
  panes: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[]
  agents: AgentInfo[]
  settings: Record<string, unknown>
  settingsDeny: boolean
  openDeny?: string
  turns: number
  agentListCalls: number
  registered: string[]
  serverToolUses: { id: string; name: string; input: unknown; startedAt: number; endedAt?: number }[]
  onToolCall: () => Promise<void>
  /** What the shell tool answers; the default is a plain success. */
  toolResult: { result: unknown; text?: string; isError?: true } | { deny: string }
  /** Files `$.fs.read` can open, by path. */
  files: Record<string, string>
  fileReads: string[]
  /** Every `$.ui.open` argument, in order. */
  openArgs: { id: string; rows?: number; columns?: number; focus?: true }[]
  /** `$.session.usage()`'s answer. */
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  context: { tokens?: number; window: number; percent?: number }
  usageCalls: number
  /** The engine's authorization handle for the usage endpoint. */
  auth: { handle: string; kind: 'bearer' | 'api-key' } | null
  fetchOk: boolean
  fetchBody: string
  fetchCalls: { url: string; auth?: string }[]
  home: string | undefined
  /** What the `SystemRoot` variable holds; undefined when it is unset. */
  systemRoot: string | undefined
  /** Directory listings `$.fs.list` answers, by path. */
  dirs: Record<string, { name: string; kind: 'dir' | 'file' }[]>
  /** What the rollout query prints. */
  rollout: string
  processCalls: { argv: readonly string[]; rolloutPath?: string }[]
  /** Every path `$.fs.list` was asked for. */
  listed: string[]
  /** What git answers, by subcommand; the default is "not a repository". */
  git: { top: GitAnswer; status: GitAnswer; hash: GitAnswer; config?: GitAnswer }
  /** Every git run, in order (kept apart from `processCalls`, which is the Codex query's). */
  gitCalls: { argv: readonly string[]; cwd?: string; stdin?: string; env?: Record<string, string> }[]
  /** Paths `$.fs.stat` reports as symbolic links. */
  links: string[]
  /** Where `$.fs.stat(path, { resolve: true })` says a path lands, when not where it is (a junction). */
  lands: Record<string, string>
  /** Every `$.store.delete`, in order. */
  storeDeletes: string[]
  /** True: git cannot be started. */
  isGitBroken: boolean
  /** While set, every git run waits for it. */
  gitHold?: Promise<void>
  /** What `$.store` holds, every write to it, and whether it fails. */
  store: Record<string, unknown>
  storeWrites: { key: string; value: unknown }[]
  isStoreBroken: boolean
  /** The session id this process runs under. */
  sessionId: string
  /** What `tasklist` prints; a non-zero exit stands for a failing process table. */
  tasklist: GitAnswer
  /** Every `tasklist` run's argv. */
  taskCalls: (readonly string[])[]
  /** Every `$.fs.write`, in order; the file is then readable too. */
  writes: { path: string; text: string }[]
  /** What `tool.check` decides for every call. */
  checkDecision: 'allow' | 'ask'
  /** Every event the mod asked to have redrawn, in order. */
  invalidations: string[]
  /** Each `$.fs.write` takes the next of these off and waits for it before it lands: a slow disk. */
  writeHolds: Promise<void>[]
}

export const HOME = 'C:/Users/me'
/** The Windows folder `SystemRoot` names; the system tools are run from under it by full path. */
export const SYSTEM_ROOT = 'C:\\Windows'
export const TASKLIST = `${SYSTEM_ROOT}\\System32\\tasklist.exe`
export const POWERSHELL = `${SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
export const SESSIONS = `${HOME}/.codex/sessions`
export const ROLLOUT_DIRS = {
  [SESSIONS]: [{ name: '2026', kind: 'dir' as const }],
  [`${SESSIONS}/2026`]: [{ name: '10', kind: 'dir' as const }],
  [`${SESSIONS}/2026/10`]: [{ name: '14', kind: 'dir' as const }],
  [`${SESSIONS}/2026/10/14`]: [{ name: 'rollout-2026-10-14T10-00-00-abc.jsonl', kind: 'file' as const }],
}

export const codexLine = (fiveUsed: number, fiveResetSec: number, weekUsed: number, weekResetSec: number): string =>
  `{"payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":${fiveUsed}.0,"window_minutes":300,` +
  `"resets_at":${fiveResetSec}},"secondary":{"used_percent":${weekUsed}.0,"window_minutes":10080,"resets_at":${weekResetSec}}}}}`

export const inSeconds = (ms: number): number => Math.floor((NOW + ms) / 1000)
export const HOUR_MS = 3_600_000
export const iso = (ms: number): string => new Date(NOW + ms).toISOString()

const gitSubcommand = (argv: readonly string[]): 'top' | 'config' | 'status' | 'hash' | undefined => {
  if (argv.includes('rev-parse')) return 'top'
  if (argv.includes('config')) return 'config'
  if (argv.includes('status')) return 'status'

  return argv.includes('hash-object') ? 'hash' : undefined
}

/** `git config --get-regexp` finds nothing: it exits 1. */
const NO_FILTERS: GitAnswer = { exitCode: 1, stdout: '' }

// A git run: recorded, held while `gitHold` is set, and answered by its subcommand.
const runGit = async (
  state: World,
  e: { argv: readonly string[]; init?: { cwd?: string; stdin?: string; env?: Record<string, string> } },
) => {
  state.gitCalls.push({ argv: e.argv, cwd: e.init?.cwd, stdin: e.init?.stdin, env: e.init?.env })
  await state.gitHold
  if (state.isGitBroken) return { deny: 'spawn git ENOENT' }

  const sub = gitSubcommand(e.argv) ?? 'top'
  const answer = (sub === 'config' ? state.git.config : state.git[sub]) ?? NO_FILTERS

  return { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
}

/** Stands for the engine: answers every call the mod makes, and the bottom of each event chain. */
export const engine = (on: On, world: Partial<World> = {}) => {
  const state: World = {
    opened: [],
    closed: [],
    panes: [],
    agents: [],
    settings: {},
    settingsDeny: false,
    turns: 4,
    agentListCalls: 0,
    registered: [],
    serverToolUses: [],
    onToolCall: async () => undefined,
    toolResult: { result: 'ok' },
    files: {},
    fileReads: [],
    openArgs: [],
    rateLimits: [],
    context: { tokens: 10_000, window: 200_000, percent: 5 },
    usageCalls: 0,
    auth: { handle: 'h1', kind: 'bearer' },
    fetchOk: true,
    fetchBody: '{"limits":[]}',
    fetchCalls: [],
    home: HOME,
    systemRoot: SYSTEM_ROOT,
    dirs: {},
    rollout: '',
    processCalls: [],
    listed: [],
    git: { top: { exitCode: 128, stdout: '' }, status: { exitCode: 128, stdout: '' }, hash: { exitCode: 128, stdout: '' } },
    gitCalls: [],
    links: [],
    lands: {},
    storeDeletes: [],
    isGitBroken: false,
    store: {},
    storeWrites: [],
    isStoreBroken: false,
    sessionId: 'session-a',
    tasklist: { exitCode: 0, stdout: '' },
    taskCalls: [],
    writes: [],
    checkDecision: 'allow',
    invalidations: [],
    writeHolds: [],
    ...world,
  }
  const clock = mock.clock(on, { now: NOW })

  on('command.register', (_$, e) => {
    state.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    if (state.openDeny !== undefined) return { deny: state.openDeny }
    state.opened.push(e.id)
    state.openArgs.push(e)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    state.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: state.panes }))
  on('ui.invalidate', (_$, e) => {
    state.invalidations.push(e.event)
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: state.turns }))
  on('settings.read', () => (state.settingsDeny ? { deny: 'no settings' } : { value: state.settings }))
  on('session.usage', () => {
    state.usageCalls += 1
    return { value: { startedAt: NOW, context: state.context, rateLimits: state.rateLimits } }
  })
  on('session.authorize', () => ({ value: state.auth }))
  on('http.fetch', (_$, e) => {
    state.fetchCalls.push({ url: e.url, auth: e.init?.auth })
    return { value: { status: state.fetchOk ? 200 : 500, ok: state.fetchOk, headers: {}, text: state.fetchBody } }
  })
  on('env.get', (_$, e) => ({
    value: e.name === 'USERPROFILE' ? state.home : e.name === 'SystemRoot' ? state.systemRoot : undefined,
  }))
  on('fs.list', (_$, e) => {
    state.listed.push(e.path)
    // The engine hands paths on in the platform's own form; the world is written with slashes.
    const names = state.dirs[e.path.replaceAll('\\', '/')]

    return names === undefined
      ? { deny: `no such directory: ${e.path}` }
      : { value: names.map(n => ({ ...n, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return runGit(state, e)
    if (e.argv[0] === TASKLIST) {
      state.taskCalls.push(e.argv)
      return { value: { ...state.tasklist, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }

    state.processCalls.push({ argv: e.argv, rolloutPath: e.init?.env?.ROLLOUT })
    return { value: { exitCode: 0, stdout: state.rollout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: state.sessionId }))
  on('fs.write', async (_$, e) => {
    await state.writeHolds.shift()
    const path = e.path.replaceAll('\\', '/')
    state.writes.push({ path, text: e.text })
    state.files[path] = e.text
    return { value: undefined }
  })
  on('tool.check', () => ({ decision: state.checkDecision }))
  on('classic.PermissionRequest', () => ({}))
  on('store.get', (_$, e) => (state.isStoreBroken ? { deny: 'store is down' } : { value: state.store[e.key] }))
  on('store.keys', () => ({ value: Object.keys(state.store) }))
  on('store.delete', (_$, e) => {
    state.storeDeletes.push(e.key)
    delete state.store[e.key]
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    const path = e.path.replaceAll('\\', '/')
    // Where a path lands when asked: where it is, in Windows spelling, unless the world says otherwise.
    const realPath = state.lands[path] ?? path.replaceAll('/', '\\')

    return {
      value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: state.links.includes(path), ...(e.resolve ? { realPath } : {}) },
    }
  })
  on('store.set', (_$, e) => {
    if (state.isStoreBroken) return { deny: 'store is down' }
    state.storeWrites.push({ key: e.key, value: e.value })
    state.store[e.key] = e.value
    return { value: undefined }
  })
  on('agent.list', () => {
    state.agentListCalls += 1
    return { value: state.agents }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async () => {
    await state.onToolCall()
    return state.toolResult as { result: string }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.Stop', () => ({}))
  on('fs.read', (_$, e) => {
    state.fileReads.push(e.path)
    const file = state.files[e.path] ?? state.files[e.path.replaceAll('\\', '/')]

    return file === undefined ? { deny: `no such file: ${e.path}` } : { value: file }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      ...(state.serverToolUses.length > 0 ? { serverToolUses: state.serverToolUses } : {}),
      stopReason: 'end_turn',
      usage: null,
    }
  })

  return { world: state, clock }
}

export type Clock = ReturnType<typeof engine>['clock']

export const SPAWN = {
  tool_use_id: 'tu1',
  prompt: 'scan',
  description: 'scan the repo',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

export const SHOWN = { id: 'dashboard', title: 'Dashboard', isShown: true, isFocused: false, isPlaced: true }

export const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

export type PaneProps = Omit<typeof WIDE_PROPS, 'bodyColumns' | 'scroll'> & {
  bodyColumns: number
  scroll: { offset: number; bodyRows: number }
}

export const mountPane = ($: Engine, props: PaneProps = WIDE_PROPS) =>
  $.ui.mount({
    plugin: 'cc-dashboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'dashboard',
    props,
    viewport: { columns: props.bodyColumns, rows: 40 },
  })

export type Pane = Awaited<ReturnType<typeof mountPane>>

export const text = (pane: Pane, match: string | RegExp) => pane.find({ type: 'Text', text: match })

export const runDashboard = ($: Engine) =>
  $.command.run({
    command: 'dashboard',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

export const beginTurn = ($: Engine) => $.turn.start({ text: 'hi', turnId: 't1' })

export const endTurn = ($: Engine) =>
  $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 8000, isAborted: false, reason: 'answer' })

// Where each section sits, in the order the tree is drawn.
export const order = async (pane: Pane, keys: readonly string[]): Promise<string[]> => {
  const drawn = JSON.stringify(await pane.drawn())

  return keys
    .map(key => ({ key, at: drawn.indexOf(`"key":"${key}`) }))
    .filter(item => item.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(item => item.key)
}

type DrawnNode = { type: string; props?: Record<string, unknown>; children?: readonly (DrawnNode | string)[] }

// The rows a drawn tree takes: a Text or Button is one row, a column Box stacks its children, any other
// Box is as high as its highest child, and a border adds two. Nothing here wraps, so it is exact for this dashboard.
const rowsOf = (node: DrawnNode | string): number => {
  if (typeof node === 'string' || node.type !== 'Box') return 1

  const heights = (node.children ?? []).map(rowsOf)
  const inner = node.props?.flexDirection === 'column' ? heights.reduce((a, b) => a + b, 0) : Math.max(0, ...heights)

  return inner + (node.props?.borderStyle === undefined ? 0 : 2)
}

/** How many rows the pane's drawing takes; a pane shorter than that scrolls. */
export const drawnRows = async (pane: Pane): Promise<number> => rowsOf((await pane.drawn()) as DrawnNode)

const z = (...records: string[]): string => `${records.join('\0')}\0`

export const CHANGED = ['1 .M N... 100644 100644 100644 a a src/a.ts', '? new.ts']
export const SEEN = { 'src/a.ts': 'h1', 'new.ts': 'h2' }
export const REVIEW_KEY = 'git-reviewed:N:/repo'

/** A repository at N:/repo on `main`, two ahead and one behind `origin/main`, with these changes. */
export const repoWorld = (changed: readonly string[] = CHANGED, hashes = 'h1\nh2\n') => ({
  git: {
    top: { exitCode: 0, stdout: 'N:/repo\n' },
    status: {
      exitCode: 0,
      stdout: z('# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', ...changed),
    },
    hash: { exitCode: 0, stdout: hashes },
  },
})

export const topCalls = (world: World): number => world.gitCalls.filter(call => call.argv.includes('rev-parse')).length

// A machine with two live sessions: this one (pid 11, session-a) and another (pid 22, session-b).
export const REGISTRY = `${HOME}/.claude/sessions`
export const MARKS = `${HOME}/.claude/mods-state/status-sidebar/waiting`

export const registryFile = (pid: number, sessionId: string, name: string): string =>
  JSON.stringify({ pid, sessionId, name, entrypoint: 'cli', status: 'busy', statusUpdatedAt: NOW })

export const markFile = (sessionId: string, reason: 'permission' | 'question' | null, sinceMs: number): string =>
  JSON.stringify({ sessionId, reason, sinceMs })

export const PROCESSES = '"claude.exe","11","Console","1","5 K"\r\n"claude.exe","22","Console","1","5 K"\r\n'

export const twoSessions = (files: Record<string, string> = {}): Partial<World> => ({
  panes: [SHOWN],
  dirs: {
    [REGISTRY]: [
      { name: '11.json', kind: 'file' },
      { name: '22.json', kind: 'file' },
    ],
  },
  files: {
    [`${REGISTRY}/11.json`]: registryFile(11, 'session-a', 'here-session'),
    [`${REGISTRY}/22.json`]: registryFile(22, 'session-b', 'other-session'),
    ...files,
  },
  tasklist: { exitCode: 0, stdout: PROCESSES },
})

export const WAITING_B = { [`${MARKS}/22.json`]: markFile('session-b', 'permission', NOW - 120_000) }

/** Starts the session, lets the first poll run, and draws the pane. */
export const readyPane = async ($: Engine, clock: Clock, props: PaneProps = WIDE_PROPS) => {
  await start($)
  await clock.advance(3000)

  return mountPane($, props)
}
