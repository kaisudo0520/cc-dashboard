import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { cells } from '../hooks/core'

// The single-column pane seats main|Codex and branch|gate side by side from 70 columns. A stand-in
// engine answers the reads (as dashboard-extras does); the test kit hands back the tree, not its paint,
// so a row of equal height is read from its props: a row Box that stretches two boxes with no height.

const NOW = new Date(2026, 9, 14, 14, 2, 11).getTime()
const HOUR_MS = 3_600_000
const HOME = '/home/me'
const SYSTEM_ROOT = 'C:\\Windows'
const SESSIONS = `${HOME}/.codex/sessions`
const DIRS: Record<string, { name: string; kind: 'dir' | 'file' }[]> = {
  [SESSIONS]: [{ name: '2026', kind: 'dir' }],
  [`${SESSIONS}/2026`]: [{ name: '10', kind: 'dir' }],
  [`${SESSIONS}/2026/10`]: [{ name: '14', kind: 'dir' }],
  [`${SESSIONS}/2026/10/14`]: [{ name: 'rollout-2026-10-14T10-00-00-abc.jsonl', kind: 'file' }],
}
const inSeconds = (ms: number) => Math.floor((NOW + ms) / 1000)
const ROLLOUT =
  `{"payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":13.0,"window_minutes":300,"resets_at":${inSeconds(2 * HOUR_MS)}},` +
  `"secondary":{"used_percent":40.0,"window_minutes":10080,"resets_at":${inSeconds(48 * HOUR_MS)}}}}}`
const z = (...records: string[]) => `${records.join('\0')}\0`
const STATUS = z('# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a a src/a.ts', '? new.ts')
const GIT = { top: { exitCode: 0, stdout: 'N:/repo\n' }, status: { exitCode: 0, stdout: STATUS }, hash: { exitCode: 0, stdout: 'h1\nh2\n' } }

const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/')
// What the pane may read: Codex's newest rollout and a repository, each switched off by a flag.
const engine = (on: On, world: { codex?: boolean; git?: boolean } = {}) => {
  const { codex = true, git = true } = world
  // Without a home directory the pane finds no Codex at all (with one and no rollout it says "no usage recorded yet").
  const clock = mock.clock(on, { now: NOW })
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'dashboard' } }))
  on('session.usage', () => ({ deny: 'no usage here' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  // The model beneath: 800 ms to its first words, then 2 s more to stop after 120 tokens.
  on('turn.step', async function* () {
    await clock.sleep(800)
    yield { kind: 'text' as const, index: 0, text: 'hello' }
    await clock.sleep(2000)
    const usage = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'S1', index: 0, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', (_$, e) => ({ messages: e.messages }))
  on('session.id', () => ({ value: 'session-a' }))
  on('session.authorize', () => ({ value: null }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? (codex ? HOME : undefined) : e.name === 'SystemRoot' ? SYSTEM_ROOT : undefined }))
  on('fs.list', (_$, e) => {
    const names = DIRS[norm(e.path)]
    return names === undefined ? { deny: `no such directory: ${e.path}` } : { value: names.map(n => ({ ...n, size: 100, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_$, e) => ({ deny: `no such file: ${e.path}` }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }))
  on('process.run', (_$, e) => {
    const done = (a: { exitCode: number; stdout: string }) => ({ value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...a } })
    if (e.argv[0] === 'git') {
      if (!git) return done({ exitCode: 128, stdout: '' })
      if (e.argv.includes('rev-parse')) return done(GIT.top)
      if (e.argv.includes('config')) return done({ exitCode: 1, stdout: '' })
      return done(e.argv.includes('status') ? GIT.status : GIT.hash)
    }
    return done({ exitCode: 0, stdout: ROLLOUT })
  })
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', (_$, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  return clock
}

const dashboard = ($: Engine, args: string) =>
  $.command.run({ command: 'dashboard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

const props = (bodyColumns: number, bodyRows = 70) => ({
  plugin: 'cc-dashboard',
  component: 'Pane' as const,
  requestId: 'dashboard',
  surface: 'terminal' as const,
  props: { title: 'Dashboard', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
})

// Gate checks: one allowed, one asked, so the gate panel has something to show.
const check = async ($: Engine) => {
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'k2' })
}

// ---------------------------------------------------------------- reading the drawn tree

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null
const kids = (n: Node | undefined): Node[] => (n?.children ?? []).filter(isNode)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
const within = (n: unknown, pick: (x: Node) => boolean): Node[] => (isNode(n) ? [...(pick(n) ? [n] : []), ...kids(n).flatMap(c => within(c, pick))] : [])
const isBox = (n: Node) => n.type === 'Box'

/** The row Box whose two Box children hold the given texts: two panels side by side. */
const rowOf = (tree: unknown, left: RegExp, right: RegExp) =>
  within(tree, n => isBox(n) && kids(n).length === 2 && kids(n).every(isBox) && left.test(textOf(kids(n)[0])) && right.test(textOf(kids(n)[1])))[0]
/** The round-bordered panel Box whose text opens with the title. */
const panelOf = (tree: unknown, title: RegExp) => within(tree, n => isBox(n) && n.props?.borderStyle === 'round' && title.test(textOf(n)))[0]

// The main box opens `<model> · main`; the branch box `🔀 main` has no dot before its name.
const MAIN = /^[^·]* · main/
const CODEX = /^Codex · /
const BRANCH = /^🔀 /
const GATE = /^GATE · /

test('at 78 columns main|Codex and branch|gate share rows, each pair stretched to one height', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const ui = await $.ui.mount(props(78))
  const tree = await ui.drawn()
  for (const [left, right] of [[MAIN, CODEX], [BRANCH, GATE]] as const) {
    const row = rowOf(tree, left, right)
    expect(row).toBeDefined()
    expect([row?.props?.flexDirection, row?.props?.alignItems, row?.props?.columnGap]).toEqual(['row', 'stretch', 1])
    expect(kids(row).map(k => k.props?.width)).toEqual([39, 38])
    // Nothing fixes either box's height or lets it align itself: the shorter one stretches.
    expect(kids(row).map(k => [k.props?.height, k.props?.alignSelf])).toEqual([[undefined, undefined], [undefined, undefined]])
  }
  await ui.unmount()
})

test('main|Codex come first, then branch|gate above the architect, the session log last', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  // A server-side advisor consult makes the architect panel appear.
  await $.session
    .append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'server_tool_use', id: 'srv1', name: 'advisor', input: {} }] as never },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'u1',
    })
    .catch(() => undefined) // the test has no transcript to store rows in
  const ui = await $.ui.mount(props(78))
  const panels = within(await ui.drawn(), n => isBox(n) && n.props?.borderStyle === 'round').map(n => textOf(n))
  const at = (re: RegExp) => panels.findIndex(t => re.test(t))
  const order = [MAIN, CODEX, BRANCH, GATE, /^ARCHITECT · /, /^session log/].map(at)
  expect(order.every(i => i >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  await ui.unmount()
})

test('under 70 columns the panels stack as before', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const ui = await $.ui.mount(props(64))
  const tree = await ui.drawn()
  expect(rowOf(tree, MAIN, CODEX)).toBeUndefined()
  expect(rowOf(tree, BRANCH, GATE)).toBeUndefined()
  expect(panelOf(tree, MAIN)?.props?.width).toBe(64)
  expect(panelOf(tree, CODEX)?.props?.width).toBe(64)
  await ui.unmount()
})

test('a panel whose partner is absent has the row to itself: no Codex, the main box fills it', async ($, on) => {
  engine(on, { codex: false })
  await dashboard($, 'refresh')
  await check($)
  const ui = await $.ui.mount(props(78))
  const tree = await ui.drawn()
  expect(panelOf(tree, MAIN)?.props?.width).toBe(78)
  expect(rowOf(tree, BRANCH, GATE)).toBeDefined()
  await ui.unmount()
})

test('a panel whose partner is absent has the row to itself: no checks, the branch box fills it', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  const ui = await $.ui.mount(props(78))
  const tree = await ui.drawn()
  expect(panelOf(tree, BRANCH)?.props?.width).toBe(78)
  expect(panelOf(tree, GATE)).toBeUndefined()
  expect(rowOf(tree, MAIN, CODEX)).toBeDefined()
  await ui.unmount()
})

test('the compact layout never pairs', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  await dashboard($, 'layout compact')
  const ui = await $.ui.mount(props(78))
  const tree = await ui.drawn()
  expect(rowOf(tree, MAIN, CODEX)).toBeUndefined()
  expect(rowOf(tree, BRANCH, GATE)).toBeUndefined()
  expect([panelOf(tree, MAIN)?.props?.width, panelOf(tree, BRANCH)?.props?.width, panelOf(tree, GATE)?.props?.width]).toEqual([78, 78, 78])
  await ui.unmount()
})

// A request that went through, in the mode the person set: the main box has an effort, a mode and a count (and no speed line).
const requested = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'auto' } as never)
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', messageCount: 1, effort: 'xhigh' } as never)
  const first = s.next()
  await clock.advance(800)
  await first
  const stop = s.next()
  await clock.advance(2000)
  await stop
  for await (const _ of s) void _
  await s.result
}

test('two to a row, the main box says its effort, mode and count on one dotted line, and neither layout draws a speed line', async ($, on) => {
  const clock = engine(on)
  await dashboard($, 'refresh')
  await requested($, clock)
  const narrow = await $.ui.mount(props(78))
  expect(await narrow.find({ text: /^▮▮▮▮ xhigh · auto · 1 req$/ })).toBeDefined()
  expect(await narrow.find({ text: /ttft|tok\/s|^last/ })).toBeUndefined()
  expect(await narrow.find({ text: /^effort / })).toBeUndefined()
  await narrow.unmount()
  // Stacked, it reads as it always did.
  const stacked = await $.ui.mount(props(64))
  expect(await stacked.find({ text: /^effort ▮▮▮▮ xhigh {3}mode auto {3}1 req$/ })).toBeDefined()
  expect(await stacked.find({ text: /ttft|tok\/s|last req/ })).toBeUndefined()
  await stacked.unmount()
})

test('two to a row, the Codex box drops its quota tag', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  const narrow = await $.ui.mount(props(78))
  expect(await narrow.find({ text: /^Codex · / })).toBeDefined()
  expect(await narrow.find({ text: 'quota · used' })).toBeUndefined()
  await narrow.unmount()
  const stacked = await $.ui.mount(props(64))
  expect(await stacked.find({ text: 'quota · used' })).toBeDefined()
  await stacked.unmount()
})

test('two to a row, the branch box has its sync on a row of its own and the two counts on two rows', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const narrow = await $.ui.mount(props(78))
  const box = panelOf(await narrow.drawn(), BRANCH)
  expect(kids(box).slice(0, 4).map(textOf)).toEqual(['🔀 main', '↔ origin/main ↑2 ↓1', 'unreviewed 2 files', 'changed 2 files'])
  expect(kids(box)[1]?.props?.dimColor).toBe(true)
  await narrow.unmount()
  const stacked = await $.ui.mount(props(64))
  const alone = panelOf(await stacked.drawn(), BRANCH)
  expect(kids(alone).slice(0, 2).map(textOf)).toEqual(['🔀 main↔ origin/main ↑2 ↓1', 'unreviewed 2 files · changed 2 files'])
  await stacked.unmount()
})

test('two to a row, the gate wraps its summary and its buttons, so the denied count is never cut off', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const ui = await $.ui.mount(props(78))
  const wraps = within(await ui.drawn(), n => isBox(n) && n.props?.flexWrap === 'wrap' && n.props?.columnGap === 2)
  const summary = wraps.find(n => /denied/.test(textOf(n)))
  expect(kids(summary).map(textOf)).toEqual(['■ 1 allowed', '■ 0 you', '■ 1 pending', '✗ 0 denied'])
  const buttons = wraps.find(n => kids(n).length > 0 && kids(n).every(k => k.type === 'Button'))
  expect(kids(buttons).map(k => k.props?.key)).toEqual(['gate-file', 'gate-shell', 'gate-other'])
  await ui.unmount()
})

test('two to a row, the unfolded lists work: the branch lists its files, the gate a bucket', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const ui = await $.ui.mount(props(78))
  await ui.press({ key: 'git-unreviewed' })
  expect(await ui.find({ text: 'src/a.ts' })).toBeDefined()
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /^■ pending +Bash → ls$/ })).toBeDefined()
  expect(rowOf(await ui.drawn(), BRANCH, GATE)).toBeDefined() // still one row, the shorter box stretched
  await ui.unmount()
})

// The log takes the rows the panels leave. Two to a row the pairs take the taller box's rows, not both:
// with 36 body rows the stacked pane leaves the log its 4, the paired one has room for 7.
test('the log is given the rows two to a row leave it, not the sum of both boxes', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  for (let i = 1; i <= 9; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `L${i}` })
  const logRowsOf = async (columns: number) => {
    const ui = await $.ui.mount(props(columns, 36))
    const n = within(await ui.drawn(), x => x.type === 'Text' && /^\d\d:\d\d:\d\d$/.test(textOf(x))).length
    await ui.unmount()
    return n
  }
  expect([await logRowsOf(64), await logRowsOf(78)]).toEqual([4, 7])
})

test('the pairs begin at 70 columns and end where the wide layout takes over, at 110', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const widthsAt = async (columns: number) => {
    const ui = await $.ui.mount(props(columns))
    const row = rowOf(await ui.drawn(), MAIN, CODEX)
    await ui.unmount()
    return row ? kids(row).map(k => k.props?.width) : null
  }
  expect([await widthsAt(69), await widthsAt(70), await widthsAt(109), await widthsAt(110)]).toEqual([null, [35, 34], [54, 54], null])
})

test('only panels the person listed side by side pair', { options: { panels: 'main,log,codex,git,gate' } }, async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  const ui = await $.ui.mount(props(78))
  const tree = await ui.drawn()
  expect(rowOf(tree, MAIN, CODEX)).toBeUndefined() // the log sits between them
  expect(rowOf(tree, BRANCH, GATE)).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- the context line

// The engine reads a context of 116k of 200k tokens ...
const measured = async ($: Engine) => {
  await $.session.measure({ context: { window: 200_000, tokens: 116_000, percent: 58 }, rateLimits: [], changed: ['context'] } as never)
}
// ... and, after this, one compaction has happened.
const compacted = async ($: Engine) => {
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
}
const CTX = /^ctx +[━─]+ +58% 116k\/200k {2}⟲1$/

/** The Text nodes in drawing order, and whether each sits inside a round-bordered box. */
const textLines = (n: unknown, inside = false): { text: string; inside: boolean }[] =>
  !isNode(n)
    ? []
    : n.type === 'Text'
      ? [{ text: textOf(n), inside }]
      : kids(n).flatMap(c => textLines(c, inside || (isBox(n) && n.props?.borderStyle === 'round')))

for (const [columns, shape] of [[78, 'two to a row'], [64, 'stacked']] as const) {
  test(`${shape}: the context is a line of its own, no box, below the Codex box and above the branch`, async ($, on) => {
    engine(on)
    await dashboard($, 'refresh')
    await check($)
    await measured($)
    await compacted($)
    const ui = await $.ui.mount(props(columns))
    const lines = textLines(await ui.drawn())
    await ui.unmount()
    const at = (re: RegExp) => lines.findIndex(l => re.test(l.text))
    const [weekly, ctx, branch] = [at(/^weekly /), at(CTX), at(/^🔀 main/)]
    expect([weekly >= 0, ctx > weekly, branch > ctx]).toEqual([true, true, true])
    expect(lines[ctx]?.inside).toBe(false) // not in the main box, nor in any
    expect(lines.filter(l => l.inside).some(l => /^ctx /.test(l.text))).toBe(false)
  })
}

// The ctx bar takes what the label, percent and detail leave of the whole pane (no 40-cell cap): the line is W cells.
test('the context line spans the whole pane, with the compaction note and without', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  await measured($)
  const widths = async (columns: number) => {
    const ui = await $.ui.mount(props(columns))
    const text = textLines(await ui.drawn()).find(l => /^ctx /.test(l.text))?.text ?? ''
    await ui.unmount()
    return cells(text)
  }
  expect([await widths(78), await widths(64), await widths(100)]).toEqual([78, 64, 100])
  await compacted($)
  expect([await widths(78), await widths(64), await widths(100)]).toEqual([78, 64, 100])
})

test('the context line follows the main box when there is no Codex box', async ($, on) => {
  engine(on, { codex: false })
  await dashboard($, 'refresh')
  await measured($)
  await compacted($)
  const ui = await $.ui.mount(props(78))
  const lines = textLines(await ui.drawn())
  await ui.unmount()
  const at = (re: RegExp) => lines.findIndex(l => re.test(l.text))
  expect(at(/^Codex · /)).toBe(-1)
  expect([at(/ · main/) < at(CTX), at(CTX) < at(/^🔀 main/), lines[at(CTX)]?.inside]).toEqual([true, true, false])
})

test('the context belongs to the main box: without it in the panels list there is no context line', { options: { panels: 'codex,git,gate,log' } }, async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await measured($)
  const ui = await $.ui.mount(props(78))
  expect(await ui.find({ text: /^ctx / })).toBeUndefined()
  await ui.unmount()
})

// With the context line in the column, the main box is a row shorter and the line takes that row.
test('the log is given the rows the context line leaves it', async ($, on) => {
  engine(on)
  await dashboard($, 'refresh')
  await check($)
  await measured($)
  for (let i = 1; i <= 9; i++) await $.turn.start({ text: `prompt ${i}`, turnId: `L${i}` })
  const logRowsOf = async (columns: number, bodyRows: number) => {
    const ui = await $.ui.mount(props(columns, bodyRows))
    const n = within(await ui.drawn(), x => x.type === 'Text' && /^\d\d:\d\d:\d\d$/.test(textOf(x))).length
    await ui.unmount()
    return n
  }
  // Stacked: 35 rows of panels (the main box 4, the context 1), so 44 rows leave 6; two to a row: 27, so 36 leave 6.
  expect([await logRowsOf(64, 44), await logRowsOf(78, 36)]).toEqual([6, 6])
})
