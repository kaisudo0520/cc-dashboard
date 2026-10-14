import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import {
  NARROW_PROPS,
  SHOWN,
  SPAWN,
  WAITING_B,
  WIDE_PROPS,
  drawnRows,
  engine,
  mountPane,
  order,
  repoWorld,
  start,
  text,
  twoSessions,
} from './harness'
import type { Pane, PaneProps } from './harness'

// The three shapes the pane takes, checked against the design's mockups and its order of giving things up:
// wide (a column of git at 98 columns and more), the dock (about 70 columns, tall) and the stacked narrow pane.
// Giving up, in order: the Footer and its hints, log lines, finished agents, the flow lines and frames, git to its summary line.
// The quota header, MAIN and CODEX are kept at every size.

const props = (columns: number, rows: number): PaneProps => ({
  ...(columns < 68 ? NARROW_PROPS : WIDE_PROPS),
  bodyColumns: columns,
  scroll: { offset: 0, bodyRows: rows },
})

const FORKS = ['f1', 'f2', 'f3'].map(id => ({ id, description: `fork ${id}`, type: 'fork', status: 'running' as const }))

/** Everything at once: the banner, an advisor in play, four subagents, a Codex run, git with two unreviewed files. */
const fullHouse = async ($: Engine, on: On, git: ReturnType<typeof repoWorld> = repoWorld()) => {
  const { world, clock } = engine(on, {
    ...twoSessions(WAITING_B),
    ...git,
    settings: { advisorModel: 'claude-fable-5-1' },
    panes: [SHOWN],
  })
  await start($)
  await clock.advance(3000)
  await $.agent.spawn(SPAWN)
  world.agents = FORKS
  await $.turn.start({ text: 'go', turnId: 't7', agentId: 'f1' })
  await $.tool.call({ tool: 'Bash', command: 'codex exec -s read-only - < a.md', tool_use_id: 'cx1' })
  for (let i = 0; i < 14; i++) await $.tool.call({ tool: 'Bash', command: `echo ${i}`, tool_use_id: `b${i}` })

  return { world, clock }
}

const logEntries = async (pane: Pane): Promise<number> => (await pane.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d$/ })).length
const agentBoxes = async (pane: Pane): Promise<number> => JSON.stringify(await pane.drawn()).split('"key":"agent-').length - 1

test('a 70-column tall pane is the wide layout, in the approved order, with git as its summary line', async ($, on) => {
  await fullHouse($, on)
  const pane = await mountPane($, props(70, 50))

  expect(await pane.find({ key: 'dash-wide' })).toBeDefined()
  expect(await pane.find({ key: 'git' })).toBeUndefined()
  const keys = ['quota', 'wait-banner', 'header', 'legend', 'main', 'flow-forward', 'advisor', 'agents', 'flow-back', 'codex', 'context', 'git-line', 'log', 'footer']
  expect(await order(pane, keys)).toEqual(keys)
  // The advisor and the subagents share one row, the advisor on the left.
  const middle = JSON.stringify((await pane.find({ key: 'middle' }))?.children)
  expect(middle.indexOf('"key":"advisor"')).toBeGreaterThanOrEqual(0)
  expect(middle.indexOf('"key":"agents"')).toBeGreaterThan(middle.indexOf('"key":"advisor"'))
})

test('a 70-column tall pane has every section at once and fits its rows', async ($, on) => {
  await fullHouse($, on)
  const pane = await mountPane($, props(70, 50))

  // 50 rows less the fixed ones, four agent boxes, the Codex block, the git line, the banner and the Footer leave 10 log lines.
  expect(await agentBoxes(pane)).toBe(4)
  expect(await logEntries(pane)).toBe(10)
  expect(await text(pane, /規劃草稿/)).toBeDefined()
  expect(await text(pane, '1額度 2分支 u路徑')).toBeDefined()
  expect(await drawnRows(pane)).toBeLessThanOrEqual(50)
})

test('at 98 columns the git panel is a column beside MAIN and the agents, and the pane still fits', async ($, on) => {
  await fullHouse($, on)
  const pane = await mountPane($, props(98, 50))

  expect(await pane.find({ key: 'git' })).toBeDefined()
  expect(await pane.find({ key: 'git-line' })).toBeUndefined()
  expect(await drawnRows(pane)).toBeLessThanOrEqual(50)
})

test('the stacked pane keeps its sections in the order of the narrow mockup', async ($, on) => {
  await fullHouse($, on)
  const pane = await mountPane($, props(40, 30))

  expect(await pane.find({ key: 'dash-narrow' })).toBeDefined()
  const keys = ['quota', 'wait-banner', 'header', 'main', 'advisor', 'agent-a1', 'codex-cx1', 'context', 'git-line', 'log', 'footer']
  expect(await order(pane, keys)).toEqual(keys)
  expect(await pane.find({ key: 'flow-forward' })).toBeUndefined()
  expect(await drawnRows(pane)).toBeLessThanOrEqual(30)
})

test('the git column, its list of 25 unreviewed paths open, fits every pane height from 16 to 60 rows at 70, 98 and 130 columns', async ($, on) => {
  const paths = Array.from({ length: 25 }, (_, i) => `? f${i}.ts`)
  const hashes = `${Array.from({ length: 25 }, (_, i) => `h${i}`).join('\n')}\n`
  await fullHouse($, on, repoWorld(paths, hashes))
  const opener = await mountPane($, props(98, 50))
  await opener.press({ key: 'git-unreviewed' })
  await opener.unmount()

  for (const columns of [70, 98, 130]) {
    for (let rows = 16; rows <= 60; rows++) {
      const pane = await mountPane($, props(columns, rows))
      const used = await drawnRows(pane)

      expect(`${columns}x${rows}: ${used}`).toBe(`${columns}x${rows}: ${Math.min(used, rows)}`)
      await pane.unmount()
    }
  }
})

type Seen = { rows: number; isWide: boolean; hasFooter: boolean; log: number; boxes: number }

test('shrinking the pane gives things up in order and never the quota header, MAIN or CODEX', async ($, on) => {
  await fullHouse($, on)
  const seen: Seen[] = []

  for (let rows = 52; rows >= 16; rows -= 2) {
    const pane = await mountPane($, props(70, rows))

    // Kept at every size.
    expect(await pane.find({ key: 'quota' })).toBeDefined()
    expect(await text(pane, /Claude/)).toBeDefined()
    expect(await pane.find({ key: 'main' })).toBeDefined()
    expect(await text(pane, /規劃草稿/)).toBeDefined()
    seen.push({
      rows,
      isWide: (await pane.find({ key: 'dash-wide' })) !== undefined,
      hasFooter: (await pane.find({ key: 'footer' })) !== undefined,
      log: await logEntries(pane),
      boxes: await agentBoxes(pane),
    })
    // The flow lines and frames go with the wide layout.
    expect((await pane.find({ key: 'flow-forward' })) !== undefined).toBe(seen.at(-1)?.isWide)
    expect(`${rows}: ${await drawnRows(pane)}`).toBe(`${rows}: ${Math.min(await drawnRows(pane), rows)}`)
    await pane.unmount()
  }

  // The Footer is never drawn where it would leave the log short of three lines.
  for (const now of seen) if (now.hasFooter) expect(now.log).toBeGreaterThanOrEqual(3)

  // The tallest pane at which each thing has been given up: the Footer first, then agent boxes, then the wide layout itself.
  const tallest = (gone: (s: Seen) => boolean): number => Math.max(...seen.filter(gone).map(s => s.rows))
  const wide = seen.filter(s => s.isWide)
  const footerGone = Math.max(...wide.filter(s => !s.hasFooter).map(s => s.rows))
  const boxGone = Math.max(...wide.filter(s => s.boxes < 4).map(s => s.rows))
  const logShort = Math.max(...wide.filter(s => s.log < 3).map(s => s.rows))

  expect(seen[0]?.isWide).toBe(true)
  expect(footerGone).toBeGreaterThan(boxGone)
  expect(boxGone).toBeGreaterThan(logShort)
  expect(tallest(s => !s.isWide)).toBeLessThan(logShort)
  // The wide layout never shows fewer than one agent box.
  expect(Math.min(...wide.map(s => s.boxes))).toBe(1)
})

test('the drawing fits the rows it is given at every width, whichever panels are folded', async ($, on) => {
  await fullHouse($, on)
  const first = await mountPane($, props(70, 40))
  await first.press({ key: 'quota-toggle' })
  await first.unmount()

  for (const columns of [40, 70, 98]) {
    for (const rows of [60, 40, 30, 22]) {
      const pane = await mountPane($, props(columns, rows))

      expect(await drawnRows(pane)).toBeLessThanOrEqual(rows)
      await pane.unmount()
    }
  }
})
