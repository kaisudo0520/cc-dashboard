import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { claudeWindows, dockColumns, limitOf, parseConfig } from '../hooks/core'

// The side dock: in the fullscreen layout the pane sits beside the transcript, asking for a share
// of the terminal's width (50% unless /config says otherwise), and follows the terminal as it is
// resized. Inline above the prompt, the summary carries Claude's own 5-hour and 7-day windows.

const NOW = new Date(2026, 9, 15, 13, 0, 0).getTime()
const HOUR_MS = 3_600_000

type Opened = { id: string; columns?: number; rows?: number }

const engine = (on: On) => {
  const w = { shown: false, opens: [] as Opened[] }
  const clock = mock.clock(on, { now: NOW })
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: w.shown ? [{ id: 'dashboard', title: 'Dashboard', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', (_$, e) => {
    w.opens.push({ id: e.id, columns: e.columns, rows: e.rows })
    return { value: { isPlaced: true } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ deny: 'no usage here' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.authorize', () => ({ value: null }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return { w, clock }
}

const open = ($: Engine, columns: number) =>
  $.command.run({ command: 'dashboard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns } })

type Seat = { placement?: 'dock' | 'inline'; isFullscreen?: boolean; surface?: 'terminal' | 'desktop'; bodyColumns?: number }

const dock = (terminalColumns: number, seat: Seat = {}) => {
  const placement = seat.placement ?? 'dock'
  return {
    plugin: 'cc-dashboard',
    component: 'Pane' as const,
    requestId: 'dashboard',
    surface: seat.surface ?? ('terminal' as const),
    viewport: { columns: terminalColumns, rows: 50, isFullscreen: seat.isFullscreen ?? placement === 'dock' },
    props: {
      title: 'Dashboard',
      isFocused: false,
      bodyColumns: seat.bodyColumns ?? (placement === 'dock' ? dockColumns(terminalColumns, 50) : terminalColumns),
      placement,
      scroll: { offset: 0, bodyRows: 48 },
      view: {},
    },
  }
}

// One pump tick, then the work it left running unawaited.
const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  await clock.advance(2_000)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

// ---------------------------------------------------------------- pure

test('the dock asks for its share of the terminal, less the frame, and never under 40 body columns', () => {
  expect(dockColumns(200, 40)).toBe(78)
  expect(dockColumns(150, 40)).toBe(58)
  expect(dockColumns(110, 40)).toBe(42)
  expect(dockColumns(80, 40)).toBe(40)
  expect(dockColumns(200, 50)).toBe(98)
})

test('the dock share is read leniently: 50 by default, kept between 20 and 80', () => {
  expect(parseConfig({}).dockPercent).toBe(50)
  expect(parseConfig({ dockPercent: 55 }).dockPercent).toBe(55)
  expect(parseConfig({ dockPercent: 95 }).dockPercent).toBe(80)
  expect(parseConfig({ dockPercent: 5 }).dockPercent).toBe(20)
  expect(parseConfig({ dockPercent: 'wide' }).dockPercent).toBe(50)
})

test("Claude's windows read short by kind: 5h then 7d, marked past their reset, absent when unknown", () => {
  const limits = [
    limitOf({ kind: 'seven_day', percentUsed: 3.4, resetsAt: new Date(NOW - 1).toISOString() }),
    limitOf({ kind: 'seven_day_opus', percentUsed: 60 }),
    limitOf({ kind: 'five_hour', percentUsed: 19, resetsAt: new Date(NOW + 3 * HOUR_MS).toISOString() }),
  ]
  expect(claudeWindows(limits, NOW)).toBe('5h 19% · 7d ~3%')
  expect(claudeWindows([limitOf({ kind: 'five_hour', percentUsed: 2 })], NOW)).toBe('5h 2%')
  expect(claudeWindows([limitOf({ kind: 'spend_limit', percentUsed: 40 })], NOW)).toBe(null)
  expect(claudeWindows([], NOW)).toBe(null)
})

// ---------------------------------------------------------------- the dock

test('before any width is known, the pane opens at the engine share and asks for none', async ($, on) => {
  const { w } = engine(on)
  await $.session.start({ cwd: '/work' } as never)
  expect(w.opens).toEqual([{ id: 'dashboard', columns: undefined, rows: 8 }])
})

test('/dashboard in a 200-column fullscreen terminal asks the dock for half of it', async ($, on) => {
  const { w } = engine(on)
  await open($, 200)
  expect(w.opens.at(-1)).toEqual({ id: 'dashboard', columns: 98, rows: 8 })
})

test('the share comes from /config', { options: { dockPercent: 40 } }, async ($, on) => {
  const { w } = engine(on)
  await open($, 200)
  expect(w.opens.at(-1)?.columns).toBe(78)
})

test('a docked pane follows the terminal when it is resized, and asks once per width', async ($, on) => {
  const { w, clock } = engine(on)
  await $.session.start({ cwd: '/work' } as never)
  await open($, 200)
  w.shown = true
  const before = w.opens.length

  const narrower = await $.ui.mount(dock(150))
  await narrower.unmount()
  await settle(clock)
  expect(w.opens.length).toBe(before + 1)
  expect(w.opens.at(-1)?.columns).toBe(73)

  const same = await $.ui.mount(dock(150))
  await same.unmount()
  await settle(clock)
  expect(w.opens.length).toBe(before + 1)
})

test('hidden, inline, or drawn by another surface, the dock width is left alone', async ($, on) => {
  const { w, clock } = engine(on)
  await $.session.start({ cwd: '/work' } as never)
  await open($, 200)
  const before = w.opens.length

  const hidden = await $.ui.mount(dock(150))
  await hidden.unmount()
  await settle(clock)
  expect(w.opens.length).toBe(before)

  w.shown = true
  // Fullscreen but under 110 columns: the engine seats the pane inline.
  const inline = await $.ui.mount(dock(100, { placement: 'inline', isFullscreen: true }))
  await inline.unmount()
  await settle(clock)
  expect(w.opens.length).toBe(before)

  // A desktop attached to the session measures its own pane, not the terminal.
  const docked = await $.ui.mount(dock(200))
  await docked.unmount()
  const desktop = await $.ui.mount(dock(70, { surface: 'desktop' }))
  await desktop.unmount()
  await settle(clock)
  expect(w.opens.length).toBe(before)
})

test('a dock the person dragged to another width is not pulled back', async ($, on) => {
  const { w, clock } = engine(on)
  await $.session.start({ cwd: '/work' } as never)
  await open($, 200)
  w.shown = true
  const before = w.opens.length
  const dragged = await $.ui.mount(dock(200, { bodyColumns: 120 }))
  await dragged.unmount()
  await settle(clock)
  expect(w.opens.length).toBe(before)
})

// ---------------------------------------------------------------- inline summary

test("inline above the prompt, the summary's first row carries Claude's 5-hour and 7-day windows", async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 2, resetsAt: new Date(NOW + 5 * HOUR_MS).toISOString() },
      { kind: 'seven_day', percentUsed: 3, resetsAt: new Date(NOW + 3 * 24 * HOUR_MS).toISOString() },
    ],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount(dock(100, { placement: 'inline' }))
  expect(await ui.find({ text: ' · 5h 2% · 7d 3%' })).toBeDefined()
  await ui.unmount()
})
