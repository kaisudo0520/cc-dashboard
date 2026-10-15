import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_CODEX_MODEL,
  ROLLOUTS_TRIED,
  ROLLOUT_DAYS_WALKED,
  ROLLOUT_FILES_MAX,
  ROLLOUT_QUERY,
  parseChoice,
  parseCodexEffort,
  parseCodexLimits,
  readCodexQuota,
  recentRollouts,
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

type Entry = { name: string; kind: string; mtimeMs: number }
const dirOf = (...names: string[]): Entry[] => names.map(name => ({ name, kind: 'dir', mtimeMs: 0 }))
const fileAt = (name: string, mtimeMs: number, kind = 'file'): Entry => ({ name, kind, mtimeMs })
// Files with no stated modification time all share 0, so the newer name goes first.
const fileOf = (...names: string[]): Entry[] => names.map(name => fileAt(name, 0))

// A listing over a made-up tree, standing for `$.fs.list`.
const tree =
  (entries: Record<string, Entry[]>, asked: string[] = []) =>
  async (path: string): Promise<Entry[]> => {
    asked.push(path)
    const found = entries[path]
    if (found === undefined) throw new Error(`no such directory: ${path}`)

    return found
  }

test('recentRollouts lists the most recently modified rollout first, whichever folder it is in', async () => {
  const list = tree({
    '/s': dirOf('2025', '2026', 'notes'),
    '/s/2025': [],
    '/s/2026': dirOf('09', '10', 'x'),
    '/s/2026/10': dirOf('13', '14'),
    '/s/2026/10/14': [fileAt('rollout-2026-10-14T09-a.jsonl', 200), fileAt('rollout-2026-10-14T11-b.jsonl', 100), fileAt('other.txt', 999)],
    '/s/2026/10/13': [fileAt('rollout-2026-10-13T08-c.jsonl', 300)],
    '/s/2026/09': dirOf('30'),
    '/s/2026/09/30': [fileAt('rollout-2026-09-30T08-d.jsonl', 400)],
  })

  expect(await recentRollouts(list, '/s')).toEqual([
    '/s/2026/09/30/rollout-2026-09-30T08-d.jsonl',
    '/s/2026/10/13/rollout-2026-10-13T08-c.jsonl',
    '/s/2026/10/14/rollout-2026-10-14T09-a.jsonl',
    '/s/2026/10/14/rollout-2026-10-14T11-b.jsonl',
  ])
})

test('recentRollouts reads only the names Codex writes, only plain files, and a folder with none gives none', async () => {
  const list = tree({
    '/s': dirOf('2026', 'evil'),
    '/s/2026': dirOf('10'),
    '/s/2026/10': dirOf('14'),
    '/s/2026/10/14': [...fileOf('x.jsonl', 'rollout-a b.jsonl'), fileAt('rollout-link.jsonl', 5, 'other'), fileAt('rollout-dir.jsonl', 5, 'dir')],
  })

  expect(await recentRollouts(list, '/s')).toEqual([])
  expect(await recentRollouts(tree({ '/s': [] }), '/s')).toEqual([])
})

test('recentRollouts walks only the newest day folders, however fresh a file in an older one is', async () => {
  const days = Array.from({ length: ROLLOUT_DAYS_WALKED + 2 }, (_, i) => String(i + 1).padStart(2, '0'))
  const entries: Record<string, Entry[]> = { '/s': dirOf('2026'), '/s/2026': dirOf('10'), '/s/2026/10': dirOf(...days) }
  for (const day of days) entries[`/s/2026/10/${day}`] = [fileAt(`rollout-2026-10-${day}T01-a.jsonl`, 1000 - Number(day))]
  const asked: string[] = []

  const found = await recentRollouts(tree(entries, asked), '/s')

  expect(found.length).toBe(ROLLOUT_DAYS_WALKED)
  expect(found).toContain(`/s/2026/10/${days[2]}/rollout-2026-10-${days[2]}T01-a.jsonl`)
  expect(asked).not.toContain('/s/2026/10/01')
  expect(asked).not.toContain('/s/2026/10/02')
})

test('recentRollouts stops descending once enough files are listed', async () => {
  const many = Array.from({ length: ROLLOUT_FILES_MAX }, (_, i) => fileAt(`rollout-2026-10-14T${String(i).padStart(5, '0')}.jsonl`, i))
  const asked: string[] = []
  const list = tree({ '/s': dirOf('2026'), '/s/2026': dirOf('10'), '/s/2026/10': dirOf('13', '14'), '/s/2026/10/14': many, '/s/2026/10/13': fileOf('rollout-2026-10-13T08-c.jsonl') }, asked)

  expect((await recentRollouts(list, '/s')).length).toBe(ROLLOUT_FILES_MAX)
  expect(asked).not.toContain('/s/2026/10/13')
})

test('recentRollouts counts a folder whose listing rejects as empty and keeps the others', async () => {
  const list = tree({
    '/s': dirOf('2026'),
    '/s/2026': dirOf('09', '10'),
    '/s/2026/10': dirOf('13', '14'),
    // '/s/2026/10/14' is missing: its listing rejects
    '/s/2026/10/13': [fileAt('rollout-2026-10-13T08-c.jsonl', 300)],
    // '/s/2026/09' is missing too: a month whose listing rejects
  })

  expect(await recentRollouts(list, '/s')).toEqual(['/s/2026/10/13/rollout-2026-10-13T08-c.jsonl'])
  expect(await recentRollouts(tree({}), '/s')).toEqual([])
})

test('recentRollouts lists no further folder, month or year once enough files are in hand', async () => {
  const many = Array.from({ length: ROLLOUT_FILES_MAX }, (_, i) => fileAt(`rollout-2026-10-14T${String(i).padStart(5, '0')}.jsonl`, i))
  const asked: string[] = []
  const list = tree({ '/s': dirOf('2025', '2026'), '/s/2026': dirOf('09', '10'), '/s/2026/10': dirOf('14'), '/s/2026/10/14': many }, asked)

  expect((await recentRollouts(list, '/s')).length).toBe(ROLLOUT_FILES_MAX)
  expect(asked).toEqual(['/s', '/s/2026', '/s/2026/10', '/s/2026/10/14'])
})

test('recentRollouts walks 14 day folders across a month and a year boundary, and no more', async () => {
  const days = (count: number, last: number) => Array.from({ length: count }, (_, i) => String(last - i).padStart(2, '0'))
  const entries: Record<string, Entry[]> = { '/s': dirOf('2025', '2026'), '/s/2026': dirOf('01'), '/s/2025': dirOf('11', '12'), '/s/2025/12': dirOf(...days(31, 31)), '/s/2025/11': dirOf(...days(5, 30)) }
  entries['/s/2026/01'] = dirOf(...days(5, 5))
  for (const [dir, names] of [['2026/01', days(5, 5)], ['2025/12', days(31, 31)], ['2025/11', days(5, 30)]] as const) {
    for (const day of names) entries[`/s/${dir}/${day}`] = [fileAt(`rollout-${dir.replace('/', '-')}-${day}T01-a.jsonl`, 1)]
  }
  const asked: string[] = []

  const found = await recentRollouts(tree(entries, asked), '/s')

  // 5 days of January 2026, then the 9 newest of December 2025
  expect(found.length).toBe(ROLLOUT_DAYS_WALKED)
  expect(asked).toContain('/s/2025/12/23')
  expect(asked).not.toContain('/s/2025/12/22')
  expect(asked).not.toContain('/s/2025/11')
})

test('recentRollouts ranks by the file own time when asked for it, and by the listing time where that fails', async () => {
  const list = tree({
    '/s': dirOf('2026'),
    '/s/2026': dirOf('10'),
    '/s/2026/10': dirOf('14'),
    '/s/2026/10/14': [fileAt('rollout-2026-10-14T09-a.jsonl', 900), fileAt('rollout-2026-10-14T10-b.jsonl', 100), fileAt('rollout-2026-10-14T11-c.jsonl', 500)],
  })
  const own: Record<string, number> = {
    '/s/2026/10/14/rollout-2026-10-14T10-b.jsonl': 2000,
    '/s/2026/10/14/rollout-2026-10-14T09-a.jsonl': Number.NaN,
  }
  const stat = async (path: string): Promise<number> => {
    const mtimeMs = own[path]
    if (mtimeMs === undefined) throw new Error(`cannot stat ${path}`)

    return mtimeMs
  }

  expect(await recentRollouts(list, '/s', stat)).toEqual([
    '/s/2026/10/14/rollout-2026-10-14T10-b.jsonl',
    '/s/2026/10/14/rollout-2026-10-14T09-a.jsonl',
    '/s/2026/10/14/rollout-2026-10-14T11-c.jsonl',
  ])
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
  // no stat answer by default: the listing's own time stands
  stat: async path => {
    throw new Error(`no stat: ${path}`)
  },
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

// A long-running older session can hold a newer reading than a later-started idle one.
const reading = (stamp: string, used: string, resetsAt: string): string =>
  `{"timestamp":"${stamp}","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex",` +
  `"primary":${window(used, 300, resetsAt)},"secondary":${window('26.0', 10080, '1792513794')},"credits":null}}}`

const RESUMED_TREE = tree({
  '/h/.codex/sessions': dirOf('2026'),
  '/h/.codex/sessions/2026': dirOf('10'),
  '/h/.codex/sessions/2026/10': dirOf('14', '13'),
  '/h/.codex/sessions/2026/10/14': fileOf('rollout-2026-10-14T03-00-38-b.jsonl'),
  '/h/.codex/sessions/2026/10/13': fileOf('rollout-2026-10-13T08-59-55-a.jsonl'),
})
const IDLE_NEWER = '/h/.codex/sessions/2026/10/14/rollout-2026-10-14T03-00-38-b.jsonl'
const RESUMED_OLDER = '/h/.codex/sessions/2026/10/13/rollout-2026-10-13T08-59-55-a.jsonl'

test('readCodexQuota keeps the reading with the latest event time, not the one from the newest-started rollout', async () => {
  const outputs = {
    [IDLE_NEWER]: reading('2026-10-13T19:07:28.000Z', '62.0', '1791926994'),
    [RESUMED_OLDER]: reading('2026-10-13T22:56:28.000Z', '8.0', '1791949200'),
  }
  const io: CodexIo = { ...codexIo({}, outputs), list: RESUMED_TREE }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(8)
})

test('a reading with no parseable event time loses to any timestamped one, whichever rollout it is in', async () => {
  const outputs = {
    [IDLE_NEWER]: reading('not a time', '62.0', '1791926994'),
    [RESUMED_OLDER]: reading('2026-10-13T22:56:28.000Z', '8.0', '1791949200'),
  }
  const io: CodexIo = { ...codexIo({}, outputs), list: RESUMED_TREE }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(8)
})

test('readCodexQuota falls back to the default model and says why when no rollout has a reading', async () => {
  expect(await readCodexQuota('/h', codexIo({}, {}))).toEqual({ model: 'gpt-6-sol', note: 'no usage recorded yet' })
})

test('the rollout query takes the path from the environment, not from its own text', async () => {
  expect(ROLLOUT_QUERY).toContain('$env:ROLLOUT')
  expect(ROLLOUT_QUERY).toContain('"limit_id":"codex"')
})

// ---- the rollout Codex is working in is the one most recently modified, not the one started last
const SESSIONS = '/h/.codex/sessions'
const DAY14 = `${SESSIONS}/2026/10/14`
const OLD_RESUMED = `${SESSIONS}/2026/10/10/rollout-2026-10-10T08-old.jsonl`

// Five rollouts started on the 14th (three hold older readings, the newest-named holds none) and a
// session started on the 10th that is still being appended to: its file was modified last.
const longLivedTree = (asked: string[] = []) =>
  tree(
    {
      [SESSIONS]: dirOf('2026'),
      [`${SESSIONS}/2026`]: dirOf('10'),
      [`${SESSIONS}/2026/10`]: dirOf('14', '10'),
      [DAY14]: [
        fileAt('rollout-2026-10-14T09-a.jsonl', 100),
        fileAt('rollout-2026-10-14T10-b.jsonl', 200),
        fileAt('rollout-2026-10-14T11-c.jsonl', 300),
        fileAt('rollout-2026-10-14T12-d.jsonl', 400),
        fileAt('rollout-2026-10-14T13-e.jsonl', 500),
      ],
      [`${SESSIONS}/2026/10/10`]: [fileAt('rollout-2026-10-10T08-old.jsonl', 900)],
    },
    asked,
  )

test('the most recently modified rollout wins even when it is in an older folder than four newer-named ones', async () => {
  const asked: string[] = []
  const outputs = {
    [`${DAY14}/rollout-2026-10-14T09-a.jsonl`]: reading('2026-10-14T09:30:00.000Z', '30.0', '1791926994'),
    [`${DAY14}/rollout-2026-10-14T10-b.jsonl`]: reading('2026-10-14T10:30:00.000Z', '35.0', '1791926994'),
    [`${DAY14}/rollout-2026-10-14T12-d.jsonl`]: reading('2026-10-14T12:30:00.000Z', '40.0', '1791926994'),
    [OLD_RESUMED]: reading('2026-10-14T20:00:00.000Z', '7.0', '1791949200'),
  }
  const io: CodexIo = { ...codexIo({}, outputs, asked), list: longLivedTree() }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(7)
  expect(asked.length).toBeLessThanOrEqual(2)
  expect(asked).toContain(OLD_RESUMED)
})

test('when the most recently modified rollouts hold no codex line, the next ones are read, up to a bound', async () => {
  const asked: string[] = []
  const io: CodexIo = {
    ...codexIo({}, { [`${DAY14}/rollout-2026-10-14T11-c.jsonl`]: reading('2026-10-14T11:30:00.000Z', '35.0', '1791926994') }, asked),
    list: longLivedTree(),
  }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(35)
  expect(asked.length).toBeLessThanOrEqual(ROLLOUTS_TRIED)

  const none: string[] = []
  const bounded: CodexIo = {
    ...codexIo({}, { [`${DAY14}/rollout-2026-10-14T10-b.jsonl`]: reading('2026-10-14T10:30:00.000Z', '30.0', '1791926994') }, none),
    list: longLivedTree(),
  }

  expect(await readCodexQuota('/h', bounded)).toEqual({ model: 'gpt-6-sol', note: 'no usage recorded yet' })
  expect(none.length).toBe(ROLLOUTS_TRIED)
})

test('one query that rejects does not drop the readings of the others', async () => {
  const io: CodexIo = {
    ...codexIo({}, {}),
    list: longLivedTree(),
    queryRollout: async path => {
      if (path === `${DAY14}/rollout-2026-10-14T13-e.jsonl`) throw new Error('powershell died')

      return reading('2026-10-14T20:00:00.000Z', '7.0', '1791949200')
    },
  }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(7)
})

const TWO_FILES = tree({
  [SESSIONS]: dirOf('2026'),
  [`${SESSIONS}/2026`]: dirOf('10'),
  [`${SESSIONS}/2026/10`]: dirOf('14'),
  // a was modified after b, though b is the newer-named
  [DAY14]: [fileAt('rollout-2026-10-14T09-a.jsonl', 200), fileAt('rollout-2026-10-14T10-b.jsonl', 100)],
})
const A = `${DAY14}/rollout-2026-10-14T09-a.jsonl`
const B = `${DAY14}/rollout-2026-10-14T10-b.jsonl`

test('readings with the same event time: the more recently modified rollout stays', async () => {
  const same = '2026-10-14T20:00:00.000Z'
  const io: CodexIo = { ...codexIo({}, { [A]: reading(same, '11.0', '1791949200'), [B]: reading(same, '22.0', '1791949200') }), list: TWO_FILES }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(11)
})

test('event times are compared to the millisecond', async () => {
  const outputs = {
    [A]: reading('2026-10-14T20:00:28.026Z', '11.0', '1791949200'),
    [B]: reading('2026-10-14T20:00:28.500Z', '22.0', '1791949200'),
  }
  const io: CodexIo = { ...codexIo({}, outputs), list: TWO_FILES }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(22)
})

test('a day folder that cannot be listed does not hide the readings of the others', async () => {
  const io: CodexIo = {
    ...codexIo({}, { [`${SESSIONS}/2026/10/13/rollout-2026-10-13T08-c.jsonl`]: reading('2026-10-13T20:00:00.000Z', '9.0', '1791949200') }),
    list: tree({
      [SESSIONS]: dirOf('2026'),
      [`${SESSIONS}/2026`]: dirOf('10'),
      [`${SESSIONS}/2026/10`]: dirOf('14', '13'),
      [`${SESSIONS}/2026/10/13`]: [fileAt('rollout-2026-10-13T08-c.jsonl', 300)],
    }),
  }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(9)
})

test('a rollout whose own modified time is newest is read first, though its listing time is old', async () => {
  const asked: string[] = []
  const live = `${DAY14}/rollout-2026-10-14T09-a.jsonl`
  const io: CodexIo = {
    ...codexIo({}, { [live]: reading('2026-10-14T20:00:00.000Z', '7.0', '1791949200') }, asked),
    list: longLivedTree(),
    // the directory listing shows a file still held open at its old time; a stat shows the fresh one
    stat: async path => (path === live ? 5000 : 0),
  }

  expect((await readCodexQuota('/h', io)).fiveHour?.usedPercent).toBe(7)
  expect(asked[0]).toBe(live)
})
