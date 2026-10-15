import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import {
  canUnfold,
  changedLabel,
  codexCard,
  codexCardFor,
  endCard,
  gauge,
  LINE_GLYPHS,
  limitWindow,
  meterPercent,
  meterWidth,
  padCells,
  pathLines,
  stopCodex,
  syncLabel,
  unreviewedLabel,
  windowMeter,
  windowShort,
  windowView,
} from '../hooks/core'
import type { GitSnap } from '../types'

// The panels cc-dashboard adds to Flightdeck: Codex's usage windows and the branch panel (how many
// changed files no review has seen, and how many changed). A stand-in engine answers the reads.

const NOW = new Date(2026, 9, 14, 14, 2, 11).getTime()
const HOUR_MS = 3_600_000
const HOME = '/home/me'
const SYSTEM_ROOT = 'C:\\Windows'
const POWERSHELL = `${SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const TASKLIST = `${SYSTEM_ROOT}\\System32\\tasklist.exe`
const SESSIONS = `${HOME}/.codex/sessions`
const ROLLOUT = `${SESSIONS}/2026/10/14/rollout-2026-10-14T10-00-00-abc.jsonl`
const DIRS: Record<string, { name: string; kind: 'dir' | 'file' }[]> = {
  [SESSIONS]: [{ name: '2026', kind: 'dir' }],
  [`${SESSIONS}/2026`]: [{ name: '10', kind: 'dir' }],
  [`${SESSIONS}/2026/10`]: [{ name: '14', kind: 'dir' }],
  [`${SESSIONS}/2026/10/14`]: [{ name: 'rollout-2026-10-14T10-00-00-abc.jsonl', kind: 'file' }],
}
const inSeconds = (ms: number) => Math.floor((NOW + ms) / 1000)
const codexLine = (fiveUsed: number, fiveResetSec: number, weekUsed: number, weekResetSec: number) =>
  `{"payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":${fiveUsed}.0,"window_minutes":300,` +
  `"resets_at":${fiveResetSec}},"secondary":{"used_percent":${weekUsed}.0,"window_minutes":10080,"resets_at":${weekResetSec}}}}}`

const z = (...records: string[]) => `${records.join('\0')}\0`
const STATUS = z(
  '# branch.oid abc',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 a a src/a.ts',
  '? new.ts',
)

type GitAnswer = { exitCode: number; stdout: string }
type World = {
  home?: string
  systemRoot?: string
  files: Record<string, string>
  rollout: string
  git: { top: GitAnswer; status: GitAnswer; hash: GitAnswer } | null
  store: Record<string, unknown>
  shown: boolean
  processCalls: { argv: readonly string[]; rollout?: string }[]
  gitCalls: (readonly string[])[]
  toolResult: { result: unknown; isError?: true } | { deny: string }
  /** Answers the shell tool gives while a test looks at the pane mid-call. */
  onToolCall: () => Promise<void>
  auth: { handle: string; kind: 'bearer' | 'api-key' } | null
  fetchOk: boolean
  fetchBody: string
  fetchCalls: number
  dirs: Record<string, { name: string; kind: 'dir' | 'file' }[]>
  tasklist: string
  writes: { path: string; text: string }[]
}

const engine = (on: On, world: Partial<World> = {}) => {
  const w: World = {
    home: HOME,
    systemRoot: SYSTEM_ROOT,
    files: {},
    rollout: '',
    git: null,
    store: {},
    shown: false,
    processCalls: [],
    gitCalls: [],
    toolResult: { result: 'ok' },
    onToolCall: async () => undefined,
    auth: { handle: 'h1', kind: 'bearer' },
    fetchOk: true,
    fetchBody: '{"limits":[]}',
    fetchCalls: 0,
    dirs: {},
    tasklist: '',
    writes: [],
    ...world,
  }
  const clock = mock.clock(on, { now: NOW })
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: w.shown ? [{ id: 'dashboard', title: 'Dashboard', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('session.usage', () => ({ deny: 'no usage here' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async () => {
    await w.onToolCall()
    return w.toolResult as { result: string }
  })
  on('classic.PermissionRequest', () => ({}))
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.Stop', () => ({}))
  on('session.id', () => ({ value: 'session-a' }))
  on('session.authorize', () => ({ value: w.auth }))
  on('http.fetch', () => {
    w.fetchCalls += 1
    return { value: { status: w.fetchOk ? 200 : 500, ok: w.fetchOk, headers: {}, text: w.fetchBody } }
  })
  on('fs.write', (_$, e) => {
    w.writes.push({ path: e.path, text: e.text })
    w.files[e.path] = e.text
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? w.home : e.name === 'SystemRoot' ? w.systemRoot : undefined }))
  on('fs.list', (_$, e) => {
    const names = DIRS[e.path] ?? w.dirs[e.path]
    return names === undefined ? { deny: `no such directory: ${e.path}` } : { value: names.map(n => ({ ...n, size: 100, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_$, e) => {
    const file = w.files[e.path.replaceAll('\\', '/')]
    return file === undefined ? { deny: `no such file: ${e.path}` } : { value: file }
  })
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }))
  on('process.run', (_$, e) => {
    const done = (a: GitAnswer) => ({ value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...a } })
    if (e.argv[0] === 'git') {
      w.gitCalls.push(e.argv)
      if (w.git === null) return done({ exitCode: 128, stdout: '' })
      if (e.argv.includes('rev-parse')) return done(w.git.top)
      if (e.argv.includes('config')) return done({ exitCode: 1, stdout: '' })
      if (e.argv.includes('status')) return done(w.git.status)
      return done(w.git.hash)
    }
    if (e.argv[0] === TASKLIST) return done({ exitCode: 0, stdout: w.tasklist })
    w.processCalls.push({ argv: e.argv, rollout: e.init?.env?.ROLLOUT })
    return done({ exitCode: 0, stdout: w.rollout })
  })
  on('store.get', (_$, e) => ({ value: w.store[e.key] }))
  on('store.set', (_$, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(w.store) }))
  on('store.delete', (_$, e) => {
    delete w.store[e.key]
    return { value: undefined }
  })
  return { w, clock }
}

const repo = (hash = 'h1\nh2\n') => ({
  git: { top: { exitCode: 0, stdout: 'N:/repo\n' }, status: { exitCode: 0, stdout: STATUS }, hash: { exitCode: 0, stdout: hash } },
})

const props = (bodyColumns: number, placement: 'dock' | 'inline' = 'dock') => ({
  plugin: 'cc-dashboard',
  component: 'Pane' as const,
  requestId: 'dashboard',
  surface: 'terminal' as const,
  props: { title: 'Dashboard', isFocused: true, bodyColumns, placement, scroll: { offset: 0, bodyRows: 70 }, view: {} },
})

const refresh = ($: Engine) =>
  $.command.run({ command: 'dashboard', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

// ---------------------------------------------------------------- pure

test('a Codex window shows percent used, kept and marked past its reset, never guessed', () => {
  expect(windowView({ usedPercent: 13.4, resetsAtMs: NOW + 2 * HOUR_MS + 10 * 60_000 }, NOW)).toEqual({ pct: 13, isStale: false, resetIn: '2h10m' })
  expect(windowView({ usedPercent: 40, resetsAtMs: NOW - 1 }, NOW)).toEqual({ pct: 40, isStale: true, resetIn: '' })
  expect(windowView(undefined, NOW)).toBe(null)
  expect([windowShort('5h', { usedPercent: 13 }, NOW), windowShort('weekly', { usedPercent: 40, resetsAtMs: NOW - 1 }, NOW), windowShort('weekly', undefined, NOW)]).toEqual([
    '5h 13%',
    'weekly ~40%',
    'weekly —',
  ])
})

test('a usage window as a row: the time to its reset, stale once past it, a dash before any reading', () => {
  expect(windowMeter('5h', { usedPercent: 13.4, resetsAtMs: NOW + 2 * HOUR_MS + 10 * 60_000 }, NOW)).toEqual({ label: '5h', pct: 13, isStale: false, detail: '⏱ 2h10m' })
  expect(windowMeter('weekly', { usedPercent: 40, resetsAtMs: NOW - 1 }, NOW)).toEqual({ label: 'weekly', pct: 40, isStale: true, detail: 'stale' })
  expect(windowMeter('weekly', { usedPercent: 40 }, NOW)).toEqual({ label: 'weekly', pct: 40, isStale: false, detail: '' })
  expect(windowMeter('weekly', undefined, NOW)).toEqual({ label: 'weekly', pct: null, isStale: false, detail: '' })
  expect(limitWindow({ pct: 19, resetsAt: NOW })).toEqual({ usedPercent: 19, resetsAtMs: NOW })
  expect(limitWindow({ pct: 19, resetsAt: null })).toEqual({ usedPercent: 19 })
})

test('usage rows line up: the percent right-aligned, one bar width for the whole panel', () => {
  expect([meterPercent({ label: '', pct: 7, isStale: false, detail: '' }), meterPercent({ label: '', pct: 58, isStale: true, detail: '' }), meterPercent({ label: '', pct: 100, isStale: true, detail: '' })]).toEqual(['   7%', ' ~58%', '~100%'])
  // 40 columns: 36 inside the frame, less a 5-cell label, three spaces, the percent and a 9-cell detail.
  expect(meterWidth(40, 5, ['⏱ 3h10m', '⏱ 4d2h', ''])).toBe(14)
  expect(meterWidth(40, 5, ['⏱ 3h10m', '116k/200k  ⟲2'])).toBe(10) // the widest detail sets every row's bar
  expect(meterWidth(20, 5, [])).toBe(4) // never under four cells
  expect(meterWidth(200, 5, [''])).toBe(40) // never over forty
  expect(padCells('7d', 5)).toBe('7d   ')
  expect(padCells('分支', 6)).toBe('分支  ') // a wide character counts two
  expect(padCells('Fable~', 4)).toBe('Fable~')
  expect(gauge(50, 6, LINE_GLYPHS)).toEqual({ on: '━━━', off: '───' })
  expect(gauge(150, 4, LINE_GLYPHS)).toEqual({ on: '━━━━', off: '' })
  expect(gauge(50, 4)).toEqual({ on: '▰▰', off: '▱▱' })
})

const snap = (over: Partial<GitSnap> = {}): GitSnap => ({ branch: 'main', changed: 5, unreviewed: 3, unreviewedPaths: ['a', 'b', 'c'], ...over })

test('the branch counts read as files unreviewed and files changed; unknown is never zero', () => {
  expect([unreviewedLabel(snap()), changedLabel(snap())]).toEqual(['unreviewed 3 files', 'changed 5 files'])
  expect(unreviewedLabel(snap({ unreviewed: 0, unreviewedPaths: [] }))).toBe('✓ unreviewed 0')
  expect(unreviewedLabel(snap({ unreviewed: undefined, unreviewedPaths: [] }))).toBe('unreviewed ?')
  expect(canUnfold(snap({ unreviewed: undefined }))).toBe(false)
  expect(syncLabel(snap())).toBe('no upstream')
  expect(syncLabel(snap({ upstream: 'origin/main', ahead: 2, behind: 1 }))).toBe('↔ origin/main ↑2 ↓1')
})

test('the unfolded list gives its last row to the count of paths it cannot draw', () => {
  const many = snap({ unreviewed: 25, unreviewedPaths: Array.from({ length: 20 }, (_, i) => `p${i}`) })
  expect(pathLines(many, 8)).toEqual({ paths: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'], hidden: 18 })
  expect(pathLines(snap(), 8)).toEqual({ paths: ['a', 'b', 'c'], hidden: 0 })
  expect(pathLines(snap(), 0)).toEqual({ paths: [], hidden: 0 })
})

// ---------------------------------------------------------------- drawing

test('without Codex or a repository, neither panel nor legend entry is drawn', async ($, on) => {
  engine(on, { home: undefined })
  await refresh($)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /^Codex/ })).toBeUndefined()
  expect(await ui.find({ text: /^branch/ })).toBeUndefined()
  expect(await ui.find({ text: /^ branch$/ })).toBeUndefined()
  await ui.unmount()
})

test('the Codex panel shows its model, effort and both windows from the newest rollout', async ($, on) => {
  const { w } = engine(on, {
    rollout: codexLine(13, inSeconds(2 * HOUR_MS + 10 * 60_000), 40, inSeconds(4 * 24 * HOUR_MS + 2 * HOUR_MS)),
    files: { [`${HOME}/.codex/config.toml`]: 'model_reasoning_effort = "high"\n', [`${HOME}/.claude/model-choice.json`]: '{"codex":"gpt-6-sol"}' },
  })
  await refresh($)
  expect(w.processCalls[0]?.argv[0]).toBe(POWERSHELL)
  expect(w.processCalls[0]?.rollout).toBe(ROLLOUT)
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount(props(cols))
    expect(await ui.find({ text: 'Codex · gpt-6-sol · high' })).toBeDefined()
    expect(await ui.find({ text: /13% ⏱ 2h10m/ })).toBeDefined()
    expect(await ui.find({ text: /40% ⏱ 4d2h/ })).toBeDefined()
    expect(await ui.find({ text: /^ Codex$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Codex with no rollout yet says why and shows no figures', async ($, on) => {
  engine(on)
  await refresh($)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: 'no usage recorded yet' })).toBeDefined()
  expect(await ui.find({ text: /^5h +—$/ })).toBeDefined()
  await ui.unmount()
})

test('a Codex window past its reset keeps its last reading, marked stale', async ($, on) => {
  const { clock } = engine(on, { rollout: codexLine(13, inSeconds(60_000), 40, inSeconds(2 * 24 * HOUR_MS)) })
  await refresh($)
  await clock.advance(2 * 60_000)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /~13% stale/ })).toBeDefined()
  await ui.unmount()
})

test('the branch panel says how many files are unreviewed and how many changed, and u lists them', async ($, on) => {
  const { w } = engine(on, repo())
  await refresh($)
  for (const g of w.gitCalls) {
    expect(g).toContain('--no-optional-locks')
    expect(g).not.toContain('-w')
  }
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: 'branch · main' })).toBeDefined()
  expect(await ui.find({ text: 'unreviewed 2 files' })).toBeDefined()
  expect(await ui.find({ text: 'changed 2 files' })).toBeDefined()
  expect(await ui.find({ text: '↔ origin/main ↑2 ↓1' })).toBeDefined()
  expect(await ui.find({ text: 'src/a.ts' })).toBeUndefined()
  expect((await ui.find({ key: 'git-unreviewed' }))?.props.hotkey).toBe('u')
  await ui.press({ key: 'git-unreviewed' })
  expect(await ui.find({ text: 'src/a.ts' })).toBeDefined()
  expect(await ui.find({ text: 'new.ts' })).toBeDefined()
  await ui.unmount()
})

test('a review that runs marks what it saw as reviewed; a refused one does not', async ($, on) => {
  const { w } = engine(on, repo())
  w.toolResult = { deny: 'no' }
  await $.tool.call({ tool: 'Skill', skill: 'code-review', tool_use_id: 'r1' } as never).catch(() => undefined)
  await new Promise(done => setTimeout(done, 20))
  expect(w.store['git-reviewed:N:/repo']).toBeUndefined()

  w.toolResult = { result: 'ok' }
  await $.tool.call({ tool: 'Skill', skill: 'code-review', tool_use_id: 'r2' } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(w.store['git-reviewed:N:/repo']).toEqual({ 'src/a.ts': 'h1', 'new.ts': 'h2' })
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: '✓ unreviewed 0' })).toBeDefined()
  expect(await ui.find({ key: 'git-unreviewed' })).toBeUndefined()
  await ui.unmount()
})

test('a /…review the person types counts as it is sent; a notification does not', async ($, on) => {
  const { w } = engine(on, repo())
  await $.prompt.submit({ text: '/code-review high', wait: false, origin: { kind: 'task-notification' } } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(w.store['git-reviewed:N:/repo']).toBeUndefined()
  await $.prompt.submit({ text: '/code-review high', wait: false, origin: { kind: 'composer' } } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(w.store['git-reviewed:N:/repo']).toEqual({ 'src/a.ts': 'h1', 'new.ts': 'h2' })
})

test('hashes that cannot be had read as unreviewed ?, never as reviewed', async ($, on) => {
  engine(on, repo('only-one\n'))
  await refresh($)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: 'unreviewed ?' })).toBeDefined()
  expect(await ui.find({ text: /✓/ })).toBeUndefined()
  await ui.unmount()
})

test('the inline summary carries Codex and the branch on one row and stays within 8 rows', async ($, on) => {
  engine(on, { ...repo(), rollout: codexLine(13, inSeconds(HOUR_MS), 40, inSeconds(24 * HOUR_MS)) })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  await refresh($)
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five']) {
    await $.agent.spawn({
      prompt: d,
      description: `task ${d}`,
      subagentType: 'general-purpose',
      tool_use_id: `s-${d}`,
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    } as never)
  }
  const ui = await $.ui.mount(props(110, 'inline'))
  const root = (await ui.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
  expect(await ui.find({ text: /Codex 5h 13% · weekly 40%   ⎇ main unreviewed 2 files · changed 2 files/ })).toBeDefined()
  expect(await ui.find({ text: /\+3 more agents/ })).toBeDefined()
  await ui.unmount()
})

test('Codex and git are polled only while the pane shows', async ($, on) => {
  const { w, clock } = engine(on, repo())
  await $.session.start({ cwd: 'N:/repo' } as never)
  await clock.advance(5_000)
  expect(w.gitCalls.length).toBe(0)
  expect(w.processCalls.length).toBe(0)
  w.shown = true
  await clock.advance(2_000)
  await new Promise(done => setTimeout(done, 20))
  expect(w.gitCalls.length > 0).toBe(true)
  expect(w.processCalls.length > 0).toBe(true)
})

// ---------------------------------------------------------------- Fable

const FABLE_BODY = JSON.stringify({
  limits: [{ kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 12, resets_at: new Date(NOW + 2 * 24 * HOUR_MS + 3 * HOUR_MS).toISOString() }],
})

// The pane shows: the pump reads every source that is due.
const showAndPump = async ($: Engine, w: World, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.session.start({ cwd: '/repo' } as never)
  w.shown = true
  await clock.advance(2_000)
  await new Promise(done => setTimeout(done, 20))
}

test('Fable weekly usage shows in the main box, read through the engine\'s own authorization', async ($, on) => {
  const { w, clock } = engine(on, { fetchBody: FABLE_BODY })
  await showAndPump($, w, clock)
  expect(w.fetchCalls).toBe(1)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /12% ⏱ 2d2h/ })).toBeDefined()
  expect(await ui.find({ text: 'Fable ' })).toBeDefined()
  await ui.unmount()
})

test('a failed Fable refresh keeps the last figure, marked Fable~; without a bearer login nothing is asked', async ($, on) => {
  const { w, clock } = engine(on, { fetchBody: FABLE_BODY })
  await showAndPump($, w, clock)
  w.fetchOk = false
  await clock.advance(90_000)
  await new Promise(done => setTimeout(done, 20))
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: 'Fable~ ' })).toBeDefined()
  expect(await ui.find({ text: /12%/ })).toBeDefined()
  await ui.unmount()
})

test('an account with no bearer login never asks for Fable and shows no Fable row', async ($, on) => {
  const { w, clock } = engine(on, { fetchBody: FABLE_BODY, auth: { handle: 'k', kind: 'api-key' } })
  await showAndPump($, w, clock)
  expect(w.fetchCalls).toBe(0)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /^Fable/ })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- waits on the person

const REGISTRY = `${HOME}/.claude/sessions`
const MARKS = `${HOME}/.claude/mods-state/status-sidebar/waiting`
const registryFile = (pid: number, sessionId: string, name: string) => JSON.stringify({ pid, sessionId, name })
const twoSessions = (marks: Record<string, string> = {}): Partial<World> => ({
  dirs: { [REGISTRY]: [{ name: '11.json', kind: 'file' }, { name: '22.json', kind: 'file' }] },
  files: { [`${REGISTRY}/11.json`]: registryFile(11, 'session-a', 'here'), [`${REGISTRY}/22.json`]: registryFile(22, 'session-b', 'jev-router-41'), ...marks },
  tasklist: '"claude.exe","11","Console","1","5 K"\r\n"claude.exe","22","Console","1","5 K"\r\n',
})
const myMark = (w: World) => JSON.parse(w.files[`${MARKS}/11.json`] ?? 'null')

test('another live session waiting on the person shows as one red line under the header', async ($, on) => {
  const { w, clock } = engine(on, twoSessions({ [`${MARKS}/22.json`]: JSON.stringify({ sessionId: 'session-b', reason: 'permission', sinceMs: NOW - 3 * 60_000 }) }))
  await showAndPump($, w, clock)
  for (const [cols, placement] of [[64, 'dock'], [120, 'dock'], [110, 'inline']] as const) {
    const ui = await $.ui.mount(props(cols, placement))
    const line = await ui.find({ text: /^! waiting on you: jev-router-41 permission 3m ago$/ })
    expect(line?.props.color).toBe('error')
    await ui.unmount()
  }
})

test('a mark left by a reused pid, or no mark at all, shows no line', async ($, on) => {
  const { w, clock } = engine(on, twoSessions({ [`${MARKS}/22.json`]: JSON.stringify({ sessionId: 'someone-else', reason: 'question', sinceMs: 0 }) }))
  await showAndPump($, w, clock)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /waiting on you/ })).toBeUndefined()
  await ui.unmount()
})

test('this session marks its own permission wait for the others, and clears it when the call returns', async ($, on) => {
  const { w, clock } = engine(on, twoSessions())
  await $.session.start({ cwd: '/repo' } as never)
  await clock.advance(1)
  await new Promise(done => setTimeout(done, 20))
  expect(myMark(w)).toEqual({ sessionId: 'session-a', reason: null, sinceMs: 0 })
  await $.tool.check({ tool: 'Bash', input: { command: 'git push' }, tool_use_id: 'p1' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push' } } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(myMark(w)?.reason).toBe('permission')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'p1', command: 'git push' } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(myMark(w)?.reason).toBe(null)
})

test('a question to the person is a wait until the person answers', async ($, on) => {
  const { w, clock } = engine(on, twoSessions())
  await $.session.start({ cwd: '/repo' } as never)
  await clock.advance(1)
  let during: unknown = null
  w.onToolCall = async () => {
    await new Promise(done => setTimeout(done, 20))
    during = myMark(w)?.reason
  }
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [] } as never)
  await new Promise(done => setTimeout(done, 20))
  expect(during).toBe('question')
  expect(myMark(w)?.reason).toBe(null)
})

// ---------------------------------------------------------------- Codex runs as subagents

const PLAN = 'codex exec --sandbox read-only -m gpt-6-sol - < brief.md'
const SHELL_OUT = { stdout: '', stderr: '', interrupted: false }
const notify = ($: Engine, taskId: string, status = 'completed', exit = 0) =>
  $.prompt.submit({
    text: `<task-notification><task-id>${taskId}</task-id><tool-use-id>c1</tool-use-id><status>${status}</status><summary>Background command "codex exec" ${status} (exit code ${exit})</summary></task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  } as never)

test('the Codex helpers: a run is a card, ended once, settled at a stop, found by task or call id', () => {
  const card = codexCard('c1', { purpose: 'Codex plan draft', note: '寫計畫' }, 'gpt-6-sol', 5)
  expect([card.type, card.description, card.status, card.spawnedAt]).toEqual(['Codex', 'Codex plan draft: 寫計畫', 'running', 5])
  const done = endCard(card, true, 9)
  expect([done.status, done.endedAt]).toEqual(['done', 9])
  expect(endCard(done, false, 20)).toBe(done)
  const bg = { ...codexCard('c2', { purpose: 'Codex' }, '', 1), codex: { taskId: 'b2' } }
  expect(stopCodex([card, bg], ['b2'])).toEqual([{ id: 'c1', ok: false }])
  expect(stopCodex([card, bg], [])).toEqual([{ id: 'c1', ok: false }, { id: 'c2', ok: true }])
  expect(stopCodex([bg], undefined)).toEqual([])
  expect(codexCardFor([card, bg], 'b2', undefined)?.id).toBe('c2')
  expect(codexCardFor([card, bg], 'zz', 'c1')?.id).toBe('c1')
})

test('a codex exec is a running subagent card while its call runs, then done, with no session id', async ($, on) => {
  const { w } = engine(on, { toolResult: { result: SHELL_OUT } })
  let during: { running?: unknown; title?: unknown } = {}
  w.onToolCall = async () => {
    const ui = await $.ui.mount(props(64))
    during = { running: await ui.find({ text: /agents · 1 running/ }), title: await ui.find({ text: /Codex plan draft/ }) }
    await ui.unmount()
  }
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c1', command: PLAN, description: '寫計畫' } as never)
  expect(during.running).toBeDefined()
  expect(during.title).toBeDefined()
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /agents · 0 running · 1 total/ })).toBeDefined()
  expect(await ui.find({ text: /✓ done/ })).toBeDefined()
  expect(await ui.find({ text: 'codex exec' })).toBeDefined()
  expect(await ui.find({ text: /[0-9a-f]{8}-[0-9a-f]{4}-/ })).toBeUndefined()
  await ui.unmount()
})

test('a codex exec that fails is a failed card; a mention of codex exec is no card', async ($, on) => {
  const { w } = engine(on, { toolResult: { result: SHELL_OUT, isError: true } })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c1', command: PLAN } as never)
  w.toolResult = { result: SHELL_OUT }
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c2', command: 'echo "codex exec"' } as never)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /1 total/ })).toBeDefined()
  expect(await ui.find({ text: /✗ failed/ })).toBeDefined()
  await ui.unmount()
})

test('a codex exec moved to the background keeps running until its notification ends it', async ($, on) => {
  const { w } = engine(on, { toolResult: { result: { ...SHELL_OUT, backgroundTaskId: 'b1' } } })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c1', command: PLAN, run_in_background: true } as never)
  const mid = await $.ui.mount(props(64))
  expect(await mid.find({ text: /1 running/ })).toBeDefined()
  await mid.unmount()
  await notify($, 'b1', 'failed', 1)
  const after = await $.ui.mount(props(64))
  expect(await after.find({ text: /0 running/ })).toBeDefined()
  expect(await after.find({ text: /✗ failed/ })).toBeDefined()
  await after.unmount()
  void w
})

test('at a stop, a background run the engine no longer lists is done; one it lists keeps running', async ($, on) => {
  engine(on, { toolResult: { result: { ...SHELL_OUT, backgroundTaskId: 'b1' } } })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c1', command: PLAN } as never)
  const stop = (ids: string[]) =>
    $.classic.Stop({ stop_hook_active: false, background_tasks: ids.map(id => ({ id, type: 'shell', status: 'running', description: 'codex exec' })) } as never)
  await stop(['b1'])
  const still = await $.ui.mount(props(64))
  expect(await still.find({ text: /1 running/ })).toBeDefined()
  await still.unmount()
  await stop([])
  const done = await $.ui.mount(props(64))
  expect(await done.find({ text: /✓ done/ })).toBeDefined()
  await done.unmount()
})
