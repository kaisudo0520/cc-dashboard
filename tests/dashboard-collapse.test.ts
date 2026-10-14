import { expect, test } from 'claude-code/testing'

import {
  CHANGED,
  HOUR_MS,
  NARROW_PROPS,
  SEEN,
  REVIEW_KEY,
  SHOWN,
  WAITING_B,
  WIDE_PROPS,
  engine,
  iso,
  mountPane,
  readyPane,
  repoWorld,
  start,
  text,
  topCalls,
  twoSessions,
} from './harness'
import type { Pane, PaneProps } from './harness'

// Panel collapse (1 = 額度, 2 = 分支), the Footer line and its refresh button.
// A Button's hotkey works only while the pane has the focus; that is the engine's rule.

const LIMITS = [
  { kind: 'five_hour', percentUsed: 30, resetsAt: iso(HOUR_MS + 5 * 60_000) },
  { kind: 'seven_day', percentUsed: 10, resetsAt: iso(51 * HOUR_MS) },
]

const rowsProps = (props: PaneProps, bodyRows: number): PaneProps => ({ ...props, scroll: { offset: 0, bodyRows } })

const hotkeys = async (pane: Pane): Promise<string[]> =>
  (await pane.findAll({ type: 'Button' })).flatMap(button => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : [])).sort()

const label = async (pane: Pane, key: string): Promise<unknown> => (await pane.find({ key }))?.props.label

// --- 1 額度 --------------------------------------------------------------------

test('the quota title is a button on hotkey 1; pressing it folds the header to that one line and again unfolds it', async ($, on) => {
  engine(on, { rateLimits: LIMITS })
  await start($)
  const pane = await mountPane($)

  expect((await pane.find({ key: 'quota-toggle' }))?.props.hotkey).toBe('1')
  expect(await label(pane, 'quota-toggle')).toBe('▾ 額度 · 剩餘')
  expect(await text(pane, '70%')).toBeDefined()

  await pane.press({ key: 'quota-toggle' })
  expect(await label(pane, 'quota-toggle')).toBe('▸ 額度 · 剩餘')
  expect(await text(pane, '70%')).toBeUndefined()
  expect(await text(pane, /Claude/)).toBeUndefined()
  expect(await text(pane, /Codex/)).toBeUndefined()

  await pane.press({ key: 'quota-toggle' })
  expect(await label(pane, 'quota-toggle')).toBe('▾ 額度 · 剩餘')
  expect(await text(pane, '70%')).toBeDefined()
})

test('a narrow pane folds its quota lines the same way', async ($, on) => {
  engine(on, { rateLimits: LIMITS })
  await start($)
  const pane = await mountPane($, NARROW_PROPS)

  expect((await pane.find({ key: 'quota-toggle' }))?.props.hotkey).toBe('1')
  expect(await text(pane, /5小時 70%/)).toBeDefined()
  await pane.press({ key: 'quota-toggle' })
  expect(await text(pane, /5小時 70%/)).toBeUndefined()
  expect(await label(pane, 'quota-toggle')).toBe('▸ 額度 · 剩餘')
})

test('the fold is a session UI state: a redraw and a /clear keep it', async ($, on) => {
  engine(on, { rateLimits: LIMITS })
  await start($)
  const pane = await mountPane($)
  await pane.press({ key: 'quota-toggle' })
  await pane.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const again = await mountPane($)
  expect(await label(again, 'quota-toggle')).toBe('▸ 額度 · 剩餘')
})

// --- 2 分支 --------------------------------------------------------------------

test('the 分支 title is a button on hotkey 2; folded, the panel is one line with its summary, and unfolds again', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)

  expect((await pane.find({ key: 'git-toggle' }))?.props.hotkey).toBe('2')
  expect(await label(pane, 'git-toggle')).toBe('▾ 分支')
  expect(await pane.find({ key: 'git' })).toBeDefined()

  await pane.press({ key: 'git-toggle' })
  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(await pane.find({ key: 'git-line' })).toBeDefined()
  expect(await label(pane, 'git-toggle')).toBe('▸ 分支')
  expect(await text(pane, 'main · 變更 2 · 未審 2')).toBeDefined()
  expect(await pane.find({ key: 'git-unreviewed' })).toBeUndefined()

  await pane.press({ key: 'git-toggle' })
  expect(await pane.find({ key: 'git' })).toBeDefined()
  expect(await label(pane, 'git-toggle')).toBe('▾ 分支')
})

test('folded, the panel hides an unfolded list of paths; the summary line has the same title button', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock, NARROW_PROPS)
  expect((await pane.find({ key: 'git-toggle' }))?.props.hotkey).toBe('2')

  await pane.press({ key: 'git-unreviewed' })
  expect(await text(pane, 'src/a.ts')).toBeDefined()
  await pane.press({ key: 'git-toggle' })
  expect(await text(pane, 'src/a.ts')).toBeUndefined()
  expect(await label(pane, 'git-toggle')).toBe('▸ 分支')
})

test('outside a repository there is no 分支 title to press', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN] })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'git-toggle' })).toBeUndefined()
})

test('only the hotkeys 1, 2 and u are drawn: 3 to 6 belong to panels that were not ported', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)
  expect(await hotkeys(pane)).toEqual(['1', '2', 'u'])
  await pane.unmount()

  const narrow = await mountPane($, NARROW_PROPS)
  expect(await hotkeys(narrow)).toEqual(['1', '2', 'u'])
})

test('without a repository only 1 is drawn', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($)

  expect(await hotkeys(pane)).toEqual(['1'])
})

// --- Footer -------------------------------------------------------------------

test('the Footer names the hotkeys that exist and carries the refresh button', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'footer' })).toBeDefined()
  expect(await text(pane, '1額度 2分支 u路徑')).toBeDefined()
  expect((await pane.find({ key: 'refresh' }))?.props.label).toBe('↻ 重新整理')
})

test('without a repository the Footer names 1 alone', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($)

  expect(await text(pane, '1額度')).toBeDefined()
  expect(await text(pane, /2分支/)).toBeUndefined()
})

test('with every changed file reviewed the Footer has no u', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld(CHANGED), store: { [REVIEW_KEY]: SEEN } })
  const pane = await readyPane($, clock)

  expect(await text(pane, '1額度 2分支')).toBeDefined()
  expect(await text(pane, /u路徑/)).toBeUndefined()
})

test('a narrow pane with rows to spare has the Footer too', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($, NARROW_PROPS)

  expect(await pane.find({ key: 'footer' })).toBeDefined()
  expect(await pane.find({ key: 'refresh' })).toBeDefined()
})

test('the Footer sits last, below the SESSION LOG', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($)
  const drawn = JSON.stringify(await pane.drawn())

  expect(drawn.indexOf('"key":"footer"')).toBeGreaterThan(drawn.indexOf('"key":"log"'))
})

test('short of rows the Footer and its hints are the first thing dropped', async ($, on) => {
  engine(on)
  await start($)
  // With no advisor and no agent row the wide layout needs 17 fixed rows: 20 leave it its three log lines and nothing over; 21 leave one row for the Footer.
  const tight = await mountPane($, rowsProps(WIDE_PROPS, 20))
  expect(await tight.find({ key: 'footer' })).toBeUndefined()
  expect(await tight.find({ key: 'refresh' })).toBeUndefined()
  expect(await text(tight, /1額度/)).toBeUndefined()
  await tight.unmount()

  const roomy = await mountPane($, rowsProps(WIDE_PROPS, 21))
  expect(await roomy.find({ key: 'footer' })).toBeDefined()
})

// --- ↻ 重新整理 ---------------------------------------------------------------

const refreshWorld = () => ({
  panes: [SHOWN],
  rateLimits: LIMITS,
  ...repoWorld(),
  ...twoSessions(WAITING_B),
})

test('refresh reads the quota, git and the other sessions\' waits at once, but not Fable', async ($, on) => {
  const { world, clock } = engine(on, refreshWorld())
  const pane = await readyPane($, clock)
  const usage = world.usageCalls
  const git = topCalls(world)
  const tasks = world.taskCalls.length
  const fetches = world.fetchCalls.length

  await pane.press({ key: 'refresh' })
  await clock.advance(100)

  expect(world.usageCalls).toBe(usage + 1)
  expect(topCalls(world)).toBe(git + 1)
  expect(world.taskCalls.length).toBe(tasks + 1)
  expect(world.fetchCalls.length).toBe(fetches)
})

test('refresh shows what changed since the last poll, with no wait for the next one', async ($, on) => {
  const { world, clock } = engine(on, refreshWorld())
  const pane = await readyPane($, clock)
  expect(await text(pane, '變更 2')).toBeDefined()

  world.git = repoWorld([...CHANGED, '? third.ts'], 'h1\nh2\nh3\n').git
  await pane.press({ key: 'refresh' })
  await clock.advance(100)

  expect(await text(pane, '變更 3')).toBeDefined()
})

test('refresh does not start a read that is still in flight', async ($, on) => {
  let release: () => void = () => undefined
  const { world, clock } = engine(on, refreshWorld())
  world.gitHold = new Promise<void>(resolve => {
    release = resolve
  })
  await start($)
  await clock.advance(3000)
  const pane = await mountPane($)
  expect(topCalls(world)).toBe(1)

  await pane.press({ key: 'refresh' })
  await pane.press({ key: 'refresh' })
  await clock.advance(100)
  expect(topCalls(world)).toBe(1)

  release()
  await clock.advance(100)
  expect(topCalls(world)).toBe(1)
})

test('refresh leaves the Fable backoff as it was', async ($, on) => {
  const { world, clock } = engine(on, { ...refreshWorld(), fetchOk: false })
  const pane = await readyPane($, clock)
  expect(world.fetchCalls).toHaveLength(1)

  await pane.press({ key: 'refresh' })
  await clock.advance(100_000)
  expect(world.fetchCalls).toHaveLength(1)
  await clock.advance(90_000)
  expect(world.fetchCalls).toHaveLength(2)
})

test('after a refresh the schedules go on from there: the next poll is a full interval later', async ($, on) => {
  const { world, clock } = engine(on, refreshWorld())
  const pane = await readyPane($, clock)

  await clock.advance(20_000)
  await pane.press({ key: 'refresh' })
  await clock.advance(100)
  const afterRefresh = topCalls(world)

  await clock.advance(20_000)
  expect(topCalls(world)).toBe(afterRefresh)
  await clock.advance(12_000)
  expect(topCalls(world)).toBe(afterRefresh + 1)
})
