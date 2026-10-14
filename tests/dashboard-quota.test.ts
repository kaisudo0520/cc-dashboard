import { expect, test } from 'claude-code/testing'

import {
  HOME,
  HOUR_MS,
  NARROW_PROPS,
  POWERSHELL,
  ROLLOUT_DIRS,
  SESSIONS,
  SHOWN,
  codexLine,
  engine,
  inSeconds,
  iso,
  mountPane,
  start,
  text,
} from './harness'

// --- Quota header -------------------------------------------------------------

const LIMITS = [
  { kind: 'five_hour', percentUsed: 30, resetsAt: iso(HOUR_MS + 5 * 60_000) },
  { kind: 'seven_day', percentUsed: 10, resetsAt: iso(51 * HOUR_MS) },
]

const FABLE_BODY = JSON.stringify({
  limits: [
    { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } }, percent: 12, resets_at: iso(2 * HOUR_MS) },
  ],
})

const rolloutWorld = {
  dirs: ROLLOUT_DIRS,
  rollout: codexLine(13, inSeconds(31 * 60_000), 4, inSeconds(5 * 24 * HOUR_MS)),
  files: { [`${HOME}/.codex/config.toml`]: 'model_reasoning_effort = "high"\n' },
}

test('the quota header sits at the top and shows what is left of each Claude window', async ($, on) => {
  engine(on, { rateLimits: LIMITS })
  await start($)
  const pane = await mountPane($)

  expect(await pane.find({ key: 'quota' })).toBeDefined()
  expect((await pane.find({ key: 'quota-toggle' }))?.props.label).toBe('▾ 額度 · 剩餘')
  expect(await text(pane, /Claude opus-5-5/)).toBeDefined()
  expect(await text(pane, '70%')).toBeDefined()
  expect(await text(pane, '90%')).toBeDefined()
  expect(await text(pane, '1h05m')).toBeDefined()
  expect(await text(pane, '2d3h')).toBeDefined()
  // Claude's rows are the model line, 5小時, 1週 and Fable: no CTX among them.
  expect(await text(pane, /CTX/)).toBeUndefined()
  expect(await text(pane, '95%')).toBeUndefined()
})

test('a window past its reset keeps its last figure marked stale, never shown as a full window', async ($, on) => {
  engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: iso(-60_000) }] })
  await start($)
  const pane = await mountPane($)

  expect(await text(pane, '~20%')).toBeDefined()
  expect(await text(pane, '過期')).toBeDefined()
  expect(await text(pane, '100%')).toBeUndefined()
})

test('what is unknown shows a dash', async ($, on) => {
  engine(on)
  await start($)
  const pane = await mountPane($)

  expect(await text(pane, /Codex —/)).toBeDefined()
  expect(await text(pane, '—')).toBeDefined()
})

test('a narrow pane shows the quota as compact lines', async ($, on) => {
  engine(on, { rateLimits: LIMITS })
  await start($)
  const pane = await mountPane($, NARROW_PROPS)

  expect(await pane.find({ key: 'dash-narrow' })).toBeDefined()
  expect(await text(pane, /Claude opus-5-5/)).toBeDefined()
  expect(await text(pane, /CTX/)).toBeUndefined()
  expect(await text(pane, /5小時 70% 1h05m/)).toBeDefined()
  expect(await text(pane, /1週 90% 2d3h/)).toBeDefined()
  expect(await text(pane, /Fable —/)).toBeDefined()
  expect(await text(pane, /Codex —/)).toBeDefined()
})

test('Fable comes from the usage endpoint through the engine authorization, and shows once the pane is up', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], fetchBody: FABLE_BODY })
  await start($)
  await clock.advance(2500)

  expect(world.fetchCalls).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'h1' }])
  const pane = await mountPane($)
  expect(await text(pane, '88%')).toBeDefined()
})

test('without a bearer login Fable is not asked for', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], auth: { handle: 'k', kind: 'api-key' } })
  await start($)
  await clock.advance(5000)

  expect(world.fetchCalls).toEqual([])
})

test('a Fable request that fails keeps the last figure and marks it stale', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], fetchBody: FABLE_BODY })
  await start($)
  await clock.advance(2500)
  world.fetchOk = false
  await clock.advance(95_000)

  expect(world.fetchCalls).toHaveLength(2)
  const pane = await mountPane($)
  expect(await text(pane, 'Fable~')).toBeDefined()
  expect(await text(pane, '88%')).toBeDefined()
})

test('Fable backs off after failures, doubling the wait', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], fetchOk: false })
  await start($)
  await clock.advance(3000)
  expect(world.fetchCalls).toHaveLength(1)

  await clock.advance(170_000)
  expect(world.fetchCalls).toHaveLength(1)
  await clock.advance(20_000)
  expect(world.fetchCalls).toHaveLength(2)

  // The second wait is 360 seconds from the second request, made at about 180 seconds.
  await clock.advance(340_000)
  expect(world.fetchCalls).toHaveLength(2)
  await clock.advance(20_000)
  expect(world.fetchCalls).toHaveLength(3)
})

test('Codex shows its configured model and effort and the windows of its newest rollout', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], ...rolloutWorld })
  await start($)
  await clock.advance(3000)

  expect(world.processCalls).toHaveLength(1)
  expect(world.processCalls[0]?.argv.slice(0, 4)).toEqual([POWERSHELL, '-NoProfile', '-NonInteractive', '-Command'])
  expect(world.processCalls[0]?.rolloutPath).toBe(`${SESSIONS}/2026/10/14/rollout-2026-10-14T10-00-00-abc.jsonl`)
  const pane = await mountPane($)
  expect(await text(pane, 'Codex gpt-6-sol · high')).toBeDefined()
  expect(await text(pane, '87%')).toBeDefined()
  expect(await text(pane, '96%')).toBeDefined()
  expect(await text(pane, '30m')).toBeDefined()
})

test('without SystemRoot PowerShell is not run: Codex says why and shows no figures', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], ...rolloutWorld, systemRoot: undefined })
  await start($)
  await clock.advance(3000)

  expect(world.processCalls).toEqual([])
  const pane = await mountPane($)
  expect(await text(pane, 'SystemRoot is not set')).toBeDefined()
})

test('the model the choice file pins Codex to is the one shown', async ($, on) => {
  const { clock } = engine(on, {
    panes: [SHOWN],
    ...rolloutWorld,
    files: { ...rolloutWorld.files, [`${HOME}/.claude/model-choice.json`]: '{"codex":"gpt-6-terra"}' },
  })
  await start($)
  await clock.advance(3000)

  const pane = await mountPane($)
  expect(await text(pane, 'Codex gpt-6-terra · high')).toBeDefined()
})

test('Codex with no rollout yet says why, and shows no figures', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], dirs: { [SESSIONS]: [] } })
  await start($)
  await clock.advance(3000)

  const pane = await mountPane($)
  expect(await text(pane, 'no usage recorded yet')).toBeDefined()
  expect(await text(pane, /Codex gpt-6-sol/)).toBeDefined()
})

test('the heavy reads wait while the pane is not shown and resume when it is', async ($, on) => {
  const { world, clock } = engine(on, { fetchBody: FABLE_BODY, ...rolloutWorld })
  await start($)
  await clock.advance(600_000)
  expect(world.fetchCalls).toHaveLength(0)
  expect(world.processCalls).toHaveLength(0)

  world.panes = [SHOWN]
  await clock.advance(3000)
  expect(world.fetchCalls).toHaveLength(1)
  expect(world.processCalls).toHaveLength(1)
})

test('Claude usage is polled every 30 seconds, Codex every 2 minutes, Fable every 90 seconds', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], fetchBody: FABLE_BODY, ...rolloutWorld })
  await start($)
  await clock.advance(3000)
  const usage = world.usageCalls
  const fetches = world.fetchCalls.length
  const processes = world.processCalls.length

  await clock.advance(300_000)
  expect(world.usageCalls - usage).toBeGreaterThanOrEqual(9)
  expect(world.usageCalls - usage).toBeLessThanOrEqual(11)
  expect(world.fetchCalls.length - fetches).toBeGreaterThanOrEqual(3)
  expect(world.fetchCalls.length - fetches).toBeLessThanOrEqual(4)
  expect(world.processCalls.length - processes).toBeGreaterThanOrEqual(2)
  expect(world.processCalls.length - processes).toBeLessThanOrEqual(3)
})

test('a second session.start (hot reload) does not start a second set of timers', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], fetchBody: FABLE_BODY, ...rolloutWorld })
  await start($)
  await start($)
  await clock.advance(3000)
  const fetches = world.fetchCalls.length
  const processes = world.processCalls.length
  const usage = world.usageCalls

  await clock.advance(300_000)
  expect(world.fetchCalls.length - fetches).toBeLessThanOrEqual(4)
  expect(world.processCalls.length - processes).toBeLessThanOrEqual(3)
  expect(world.usageCalls - usage).toBeLessThanOrEqual(11)
})
