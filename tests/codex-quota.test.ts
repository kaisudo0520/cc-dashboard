import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_CODEX_MODEL,
  ROLLOUT_QUERY,
  newestRollouts,
  parseChoice,
  parseCodexEffort,
  parseCodexLimits,
  readCodexQuota,
} from '../hooks/lib/codex-quota'
import type { CodexIo } from '../hooks/lib/codex-quota'

const event = (primary: string, secondary: string): string =>
  `{"timestamp":"2026-10-14T10:00:00Z","payload":{"type":"token_count","rate_limits":{"limit_id":"codex",` +
  `"primary":${primary},"secondary":${secondary},"credits":null}}}`

const window = (used: string, minutes: number, resetsAt: string): string =>
  `{"used_percent":${used},"window_minutes":${minutes},"resets_at":${resetsAt}}`

test('parseCodexLimits tells the five-hour and weekly windows apart by their length', async () => {
  const line = event(window('13.0', 300, '1791132451'), window('4.5', 10080, '1791600000'))
  expect(parseCodexLimits(line)).toEqual({
    fiveHour: { usedPercent: 13, resetsAtMs: 1791132451000 },
    weekly: { usedPercent: 4.5, resetsAtMs: 1791600000000 },
  })
})

test('parseCodexLimits does not depend on which of primary and secondary is which', async () => {
  const line = event(window('50', 10080, '1791600000'), window('9', 300, '1791132451'))
  expect(parseCodexLimits(line)).toMatchObject({
    fiveHour: { usedPercent: 9 },
    weekly: { usedPercent: 50 },
  })
})

test('a plan with a single window has just that one, and a window with no reset time has none', async () => {
  const line = event(window('20', 10080, 'null'), 'null')
  const limits = parseCodexLimits(line)
  expect(limits?.fiveHour).toBeUndefined()
  expect(limits?.weekly).toEqual({ usedPercent: 20 })
})

test('parseCodexLimits takes the newest reading, and skips lines of other limits', async () => {
  const older = event(window('10', 300, '1791100000'), window('1', 10080, '1791500000'))
  const newer = event(window('30', 300, '1791200000'), window('2', 10080, '1791500000'))
  const other = '{"rate_limits":{"limit_id":"other","primary":' + window('99', 300, '1') + '}}'
  expect(parseCodexLimits([older, newer, other].join('\n'))?.fiveHour?.usedPercent).toBe(30)
})

test('parseCodexLimits answers nothing when no line carries a reading', async () => {
  expect(parseCodexLimits('')).toBeUndefined()
  expect(parseCodexLimits('{"limit_id":"codex"}')).toBeUndefined()
  expect(parseCodexLimits('{"x":1}')).toBeUndefined()
})

test('a window whose percent is not a number is left out, never shown as a figure', async () => {
  const line = event(window('1.2.3', 300, '1791132451'), window('4.5', 10080, '1791600000'))

  expect(parseCodexLimits(line)).toEqual({ fiveHour: undefined, weekly: { usedPercent: 4.5, resetsAtMs: 1791600000000 } })
})

test('parseCodexEffort reads the reasoning effort the config selects', async () => {
  expect(parseCodexEffort('model = "gpt-6-sol"\nmodel_reasoning_effort = "high"\n')).toBe('high')
  expect(parseCodexEffort('# model_reasoning_effort = "low"\n')).toBeUndefined()
  expect(parseCodexEffort('')).toBeUndefined()
})

test('parseChoice reads the codex model the rules are pinned to, and only a model-like name', async () => {
  expect(parseChoice('{"codex":"gpt-6-sol","other":1}')).toBe('gpt-6-sol')
  expect(parseChoice('{"codex":"gpt 6; rm -rf"}')).toBeUndefined()
  expect(parseChoice('{"codex":5}')).toBeUndefined()
  expect(parseChoice('[]')).toBeUndefined()
  expect(parseChoice('nope')).toBeUndefined()
  expect(parseChoice('')).toBeUndefined()
})

type Entry = { name: string; kind: string }
const dirOf = (...names: string[]): Entry[] => names.map(name => ({ name, kind: 'dir' }))
const fileOf = (...names: string[]): Entry[] => names.map(name => ({ name, kind: 'file' }))

// A listing over a made-up tree, standing for `$.fs.list`.
const tree =
  (entries: Record<string, Entry[]>) =>
  async (path: string): Promise<Entry[]> => {
    const found = entries[path]
    if (found === undefined) throw new Error(`no such directory: ${path}`)

    return found
  }

test('newestRollouts walks year, month and day downwards and lists the newest rollout files first, up to the limit', async () => {
  const list = tree({
    '/s': dirOf('2025', '2026', 'notes'),
    '/s/2026': dirOf('09', '10', 'x'),
    '/s/2026/10': dirOf('13', '14'),
    '/s/2026/10/14': [...fileOf('rollout-2026-10-14T09-a.jsonl', 'rollout-2026-10-14T11-b.jsonl', 'other.txt')],
    '/s/2026/10/13': fileOf('rollout-2026-10-13T08-c.jsonl'),
  })

  expect(await newestRollouts(list, '/s', 3)).toEqual([
    '/s/2026/10/14/rollout-2026-10-14T11-b.jsonl',
    '/s/2026/10/14/rollout-2026-10-14T09-a.jsonl',
    '/s/2026/10/13/rollout-2026-10-13T08-c.jsonl',
  ])
  expect(await newestRollouts(list, '/s', 1)).toEqual(['/s/2026/10/14/rollout-2026-10-14T11-b.jsonl'])
})

test('newestRollouts reads only the names Codex writes, and a folder with none gives none', async () => {
  const list = tree({ '/s': dirOf('2026', 'evil'), '/s/2026': dirOf('10'), '/s/2026/10': dirOf('14'), '/s/2026/10/14': fileOf('x.jsonl', 'rollout-a b.jsonl') })

  expect(await newestRollouts(list, '/s', 4)).toEqual([])
  expect(await newestRollouts(tree({ '/s': [] }), '/s', 4)).toEqual([])
})

test('the model the rules fall back to without a choice is gpt-6-sol', async () => {
  expect(DEFAULT_CODEX_MODEL).toBe('gpt-6-sol')
})

const READING = event(window('13.0', 300, '1791132451'), window('4.5', 10080, '1791600000'))
const ROLLOUT_TREE = tree({
  '/h/.codex/sessions': dirOf('2026'),
  '/h/.codex/sessions/2026': dirOf('10'),
  '/h/.codex/sessions/2026/10': dirOf('14'),
  '/h/.codex/sessions/2026/10/14': fileOf('rollout-2026-10-14T11-b.jsonl', 'rollout-2026-10-14T09-a.jsonl'),
})

const codexIo = (files: Record<string, string>, outputs: Record<string, string>, asked: string[] = []): CodexIo => ({
  readText: async path => files[path] ?? '',
  list: ROLLOUT_TREE,
  queryRollout: async path => {
    asked.push(path)

    return outputs[path] ?? ''
  },
})

test('readCodexQuota shows the pinned model, the configured effort and the windows of the newest rollout that has any', async () => {
  const asked: string[] = []
  const io = codexIo(
    { '/h/.claude/model-choice.json': '{"codex":"gpt-6-terra"}', '/h/.codex/config.toml': 'model_reasoning_effort = "high"\n' },
    { '/h/.codex/sessions/2026/10/14/rollout-2026-10-14T09-a.jsonl': READING },
    asked,
  )

  expect(await readCodexQuota('/h', io)).toEqual({
    model: 'gpt-6-terra',
    effort: 'high',
    fiveHour: { usedPercent: 13, resetsAtMs: 1791132451000 },
    weekly: { usedPercent: 4.5, resetsAtMs: 1791600000000 },
  })
  expect(asked).toEqual([
    '/h/.codex/sessions/2026/10/14/rollout-2026-10-14T11-b.jsonl',
    '/h/.codex/sessions/2026/10/14/rollout-2026-10-14T09-a.jsonl',
  ])
})

test('readCodexQuota falls back to the default model and says why when no rollout has a reading', async () => {
  expect(await readCodexQuota('/h', codexIo({}, {}))).toEqual({ model: 'gpt-6-sol', note: 'no usage recorded yet' })
})

test('the rollout query takes the path from the environment, not from its own text', async () => {
  expect(ROLLOUT_QUERY).toContain('$env:ROLLOUT')
  expect(ROLLOUT_QUERY).toContain('"limit_id":"codex"')
})
