import { expect, test } from 'claude-code/testing'

import { WAIT_MS, dueSources } from '../hooks/lib/poll'
import type { Source } from '../hooks/lib/poll'

const NONE: Record<Source, number> = { claude: 0, fable: 0, codex: 0, git: 0, others: 0 }

test('every source is due at the start, in the schedule\'s order', () => {
  expect(dueSources(NONE, new Set(), 1)).toEqual(['claude', 'fable', 'codex', 'git', 'others'])
})

test('a source is due once its time has come, and not before', () => {
  const dueAt = { ...NONE, claude: 100, fable: 50, codex: 200, git: 101, others: 99 }

  expect(dueSources(dueAt, new Set(), 100)).toEqual(['claude', 'fable', 'others'])
})

test('a source being read is not started again', () => {
  expect(dueSources(NONE, new Set<Source>(['git', 'fable']), 5)).toEqual(['claude', 'codex', 'others'])
})

test('the waits are 30 seconds for Claude and git, 2 minutes for Codex, 5 seconds for the other sessions', () => {
  expect(WAIT_MS).toEqual({ claude: 30_000, codex: 120_000, git: 30_000, others: 5_000 })
})
