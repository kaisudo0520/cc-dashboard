import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { canUnfold, changedLabel, pathLines, syncLabel, unreviewedLabel, windowShort, windowView } from '../hooks/core'
import type { GitSnap } from '../types'

// The panels cc-dashboard adds to Flightdeck: Codex's usage windows and the 分支 panel (how many
// changed files no review has seen, and how many changed). A stand-in engine answers the reads.

const NOW = new Date(2026, 9, 14, 14, 2, 11).getTime()
const HOUR_MS = 3_600_000
const HOME = '/home/me'
const SYSTEM_ROOT = 'C:\\Windows'
const POWERSHELL = `${SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
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
  on('tool.call', () => w.toolResult as { result: string })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? w.home : e.name === 'SystemRoot' ? w.systemRoot : undefined }))
  on('fs.list', (_$, e) => {
    const names = DIRS[e.path.replaceAll('\\', '/')]
    return names === undefined ? { deny: `no such directory: ${e.path}` } : { value: names.map(n => ({ ...n, size: 0, mtimeMs: 0, isLink: false })) }
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
  expect([windowShort('5小時', { usedPercent: 13 }, NOW), windowShort('每週', { usedPercent: 40, resetsAtMs: NOW - 1 }, NOW), windowShort('每週', undefined, NOW)]).toEqual([
    '5小時 13%',
    '每週 ~40%',
    '每週 —',
  ])
})

const snap = (over: Partial<GitSnap> = {}): GitSnap => ({ branch: 'main', changed: 5, unreviewed: 3, unreviewedPaths: ['a', 'b', 'c'], ...over })

test('the branch counts read as files unreviewed and files changed; unknown is never zero', () => {
  expect([unreviewedLabel(snap()), changedLabel(snap())]).toEqual(['未審 3 個檔案', '更新 5 個檔案'])
  expect(unreviewedLabel(snap({ unreviewed: 0, unreviewedPaths: [] }))).toBe('✓ 未審 0')
  expect(unreviewedLabel(snap({ unreviewed: undefined, unreviewedPaths: [] }))).toBe('未審 未知')
  expect(canUnfold(snap({ unreviewed: undefined }))).toBe(false)
  expect(syncLabel(snap())).toBe('無上游')
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
  expect(await ui.find({ text: /分支/ })).toBeUndefined()
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
    expect(await ui.find({ text: /13% ↻2h10m/ })).toBeDefined()
    expect(await ui.find({ text: /40% ↻4d2h/ })).toBeDefined()
    expect(await ui.find({ text: /^ Codex$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Codex with no rollout yet says why and shows no figures', async ($, on) => {
  engine(on)
  await refresh($)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: 'no usage recorded yet' })).toBeDefined()
  expect(await ui.find({ text: /5小時 —/ })).toBeDefined()
  await ui.unmount()
})

test('a Codex window past its reset keeps its last reading, marked stale', async ($, on) => {
  const { clock } = engine(on, { rollout: codexLine(13, inSeconds(60_000), 40, inSeconds(2 * 24 * HOUR_MS)) })
  await refresh($)
  await clock.advance(2 * 60_000)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: /~13% 過期/ })).toBeDefined()
  await ui.unmount()
})

test('the 分支 panel says how many files are unreviewed and how many changed, and u lists them', async ($, on) => {
  const { w } = engine(on, repo())
  await refresh($)
  for (const g of w.gitCalls) {
    expect(g).toContain('--no-optional-locks')
    expect(g).not.toContain('-w')
  }
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: '分支 · main' })).toBeDefined()
  expect(await ui.find({ text: '未審 2 個檔案' })).toBeDefined()
  expect(await ui.find({ text: '更新 2 個檔案' })).toBeDefined()
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
  expect(await ui.find({ text: '✓ 未審 0' })).toBeDefined()
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

test('hashes that cannot be had read as 未審 未知, never as reviewed', async ($, on) => {
  engine(on, repo('only-one\n'))
  await refresh($)
  const ui = await $.ui.mount(props(64))
  expect(await ui.find({ text: '未審 未知' })).toBeDefined()
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
  expect(await ui.find({ text: /Codex 5小時 13% · 每週 40%   ⎇ main 未審 2 個檔案 · 更新 2 個檔案/ })).toBeDefined()
  expect(await ui.find({ text: /\+3 個子代理/ })).toBeDefined()
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
