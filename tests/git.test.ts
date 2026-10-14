import { expect, test } from 'claude-code/testing'

import {
  UNHASHED,
  UNREVIEWED_SHOWN,
  asHashes,
  hashTargets,
  isPersonPrompt,
  isReviewCall,
  isReviewPrompt,
  parseGitStatus,
  snapOf,
  storable,
  unreviewedPaths,
  withHashes,
} from '../hooks/lib/git'

// `git status --porcelain=v2 --branch -z -uall`: NUL-separated records, a
// rename carrying its old path as one more record.
const z = (...records: string[]): string => `${records.join('\0')}\0`

const HEADERS = [
  '# branch.oid 4ce84933245937d86eebe8c6a09910cd135fb780',
  '# branch.head script-first-edition-OPUS',
  '# branch.upstream origin/script-first-edition-OPUS',
  '# branch.ab +2 -1',
]

test('parseGitStatus reads the branch, its upstream, ahead / behind and every changed path', () => {
  const status = parseGitStatus(
    z(
      ...HEADERS,
      '1 .M N... 100644 100644 100644 aaa aaa docs/劇本稿/a.md',
      '1 D. N... 100644 000000 000000 bbb 000 gone.md',
      '2 R. N... 100644 100644 100644 ccc ccc R100 new name.md',
      'old name.md',
      '? untracked.html',
      '! ignored.log',
    ),
  )

  expect(status?.branch).toBe('script-first-edition-OPUS')
  expect(status?.upstream).toBe('origin/script-first-edition-OPUS')
  expect(status?.ahead).toBe(2)
  expect(status?.behind).toBe(1)
  expect(status?.entries).toEqual([
    { path: 'docs/劇本稿/a.md', isMissing: false },
    { path: 'gone.md', isMissing: true },
    { path: 'new name.md', isMissing: false },
    { path: 'untracked.html', isMissing: false, isUntracked: true },
  ])
})

test('parseGitStatus handles no upstream, a detached head and output that is not git status', () => {
  const lonely = parseGitStatus(z('# branch.oid abc', '# branch.head topic'))
  expect(lonely?.ahead).toBe(undefined)
  expect(lonely?.upstream).toBe(undefined)
  expect(lonely?.entries).toEqual([])

  expect(parseGitStatus(z('# branch.oid abc', '# branch.head (detached)'))?.branch).toBe('(detached)')
  expect(parseGitStatus('')).toBe(undefined)
  expect(parseGitStatus('fatal: not a git repository')).toBe(undefined)
})

test('a file deleted in the work tree is missing; one deleted only from the index is not', () => {
  const status = parseGitStatus(z(...HEADERS, '1 .D N... 100644 100644 000000 a a wt.md', '1 DA N... 0 0 0 a a back.md'))
  expect(status?.entries).toEqual([
    { path: 'wt.md', isMissing: true },
    { path: 'back.md', isMissing: false },
  ])
})

test('a conflicted file is on disk unless both sides deleted it', () => {
  const status = parseGitStatus(z(...HEADERS, 'u UD N... 100644 100644 000000 100644 a b c conflict.md', 'u DD N... 0 0 0 0 a b c both.md'))
  expect(status?.entries).toEqual([
    { path: 'conflict.md', isMissing: false },
    { path: 'both.md', isMissing: true },
  ])
})

test('a copy is read like a rename, its source record skipped', () => {
  const status = parseGitStatus(z(...HEADERS, '2 C. N... 100644 100644 100644 a a C75 copy.md', 'source.md', '? after.md'))
  expect(status?.entries.map(entry => entry.path)).toEqual(['copy.md', 'after.md'])
})

test('a tracked entry whose work-tree mode is 120000 is a symlink; an untracked one is marked untracked', () => {
  const status = parseGitStatus(
    z(
      ...HEADERS,
      '1 .M N... 120000 120000 120000 aaa bbb link',
      '2 R. N... 120000 120000 120000 ccc ddd R100 moved link',
      'old link',
      'u UU N... 120000 120000 120000 120000 a b c unmerged link',
      '1 .M N... 100644 100644 120000 a a became-link',
      '1 .M N... 120000 120000 100644 a a became-file',
      '? new.ts',
    ),
  )

  expect(status?.entries).toEqual([
    { path: 'link', isMissing: false, isLink: true },
    { path: 'moved link', isMissing: false, isLink: true },
    { path: 'unmerged link', isMissing: false, isLink: true },
    { path: 'became-link', isMissing: false, isLink: true },
    { path: 'became-file', isMissing: false },
    { path: 'new.ts', isMissing: false, isUntracked: true },
  ])
})

test('a link is not a file to hash, and its content is marked unhashed, never given a hash', () => {
  const entries = [
    { path: 'a.md', isMissing: false },
    { path: 'link', isMissing: false, isLink: true as const },
    { path: 'gone', isMissing: true },
  ]

  expect(hashTargets(entries)).toEqual(['a.md'])
  expect(withHashes(entries, 'h1\n')).toEqual({ 'a.md': 'h1', link: UNHASHED, gone: 'deleted' })
})

test('what a review stores leaves out the paths it could not hash, so they stay unreviewed', () => {
  const now = { 'a.md': 'h1', link: UNHASHED }

  expect(storable(now)).toEqual({ 'a.md': 'h1' })
  expect(unreviewedPaths(now, storable(now))).toEqual(['link'])
})

test('only files that exist are hashed, and the hashes line up with them', () => {
  const entries = [
    { path: 'a.md', isMissing: false },
    { path: 'gone.md', isMissing: true },
    { path: 'b.md', isMissing: false },
  ]
  expect(hashTargets(entries)).toEqual(['a.md', 'b.md'])
  expect(withHashes(entries, 'h1\nh2\n')).toEqual({ 'a.md': 'h1', 'gone.md': 'deleted', 'b.md': 'h2' })
  // A hash list that does not line up is no answer.
  expect(withHashes(entries, 'h1\n')).toBe(undefined)
})

test('withHashes reads hash-object output with CRLF line ends', () => {
  expect(withHashes([{ path: 'a.md', isMissing: false }], 'h1\r\n')).toEqual({ 'a.md': 'h1' })
})

test('unreviewedPaths lists changed files the last review did not see as they are', () => {
  const now = { 'a.md': 'h1', 'b.md': 'h2', 'c.md': 'h3' }
  expect(unreviewedPaths(now, { 'a.md': 'h1', 'b.md': 'old' })).toEqual(['b.md', 'c.md'])
  expect(unreviewedPaths(now, now)).toEqual([])
  expect(unreviewedPaths({}, { 'a.md': 'h1' })).toEqual([])
})

test('asHashes keeps a stored path-to-hash map and drops anything else', () => {
  expect(asHashes({ 'a.md': 'h1', 'b.md': 2 })).toEqual({ 'a.md': 'h1' })
  expect(asHashes(undefined)).toEqual({})
  expect(asHashes(['h1'])).toEqual({})
})

test('a review is a reviewing skill or a reviewer subagent', () => {
  expect(isReviewCall('Skill', { skill: 'code-review' })).toBe(true)
  expect(isReviewCall('Skill', { skill: 'everything-claude-code:security-review' })).toBe(true)
  expect(isReviewCall('Agent', { subagent_type: 'fable-reviewer', prompt: 'p' })).toBe(true)
  expect(isReviewCall('Agent', { subagent_type: 'script-rewriter', prompt: 'review this' })).toBe(false)
  expect(isReviewCall('Skill', { skill: 'simplify' })).toBe(false)
  expect(isReviewCall('Bash', { command: 'echo review' })).toBe(false)
})

test('a typed /code-review or /security-review is a review; a sentence mentioning one is not', () => {
  expect(isReviewPrompt('/code-review high')).toBe(true)
  expect(isReviewPrompt('/everything-claude-code:code-review')).toBe(true)
  expect(isReviewPrompt('please run /code-review later')).toBe(false)
  expect(isReviewPrompt('/simplify')).toBe(false)
  expect(isReviewPrompt('/review-plan')).toBe(false)
  expect(isReviewPrompt('/code-review')).toBe(true)
})

test('only a person-typed prompt counts as a typed review: a notification or a peer message does not', () => {
  expect(isPersonPrompt('composer')).toBe(true)
  expect(isPersonPrompt('bridge')).toBe(true)
  expect(isPersonPrompt('sdk')).toBe(true)
  expect(isPersonPrompt('task-notification')).toBe(false)
  expect(isPersonPrompt('')).toBe(false)
})

const STATUS = { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0 }
const entriesOf = (count: number) => Array.from({ length: count }, (_, i) => ({ path: `f${i}.md`, isMissing: false }))

test('snapOf counts every unreviewed file but lists only the first UNREVIEWED_SHOWN', () => {
  const entries = entriesOf(25)
  const hashes = Object.fromEntries(entries.map(entry => [entry.path, 'h']))
  const snap = snapOf({ ...STATUS, entries }, hashes, { 'f0.md': 'h' })

  expect(snap.branch).toBe('main')
  expect(snap.upstream).toBe('origin/main')
  expect(snap.ahead).toBe(1)
  expect(snap.changed).toBe(25)
  expect(snap.unreviewed).toBe(24)
  expect(snap.unreviewedPaths).toHaveLength(UNREVIEWED_SHOWN)
  expect(snap.unreviewedPaths[0]).toBe('f1.md')
})

test('snapOf says zero unreviewed only when the hashes were had and every one was seen', () => {
  const entries = entriesOf(2)
  const hashes = { 'f0.md': 'h', 'f1.md': 'h' }

  expect(snapOf({ ...STATUS, entries }, hashes, hashes)).toMatchObject({ changed: 2, unreviewed: 0, unreviewedPaths: [] })
})

test('snapOf leaves unreviewed unknown, never zero, when the hashes could not be had', () => {
  const snap = snapOf({ ...STATUS, entries: entriesOf(3) }, undefined, {})

  expect(snap.changed).toBe(3)
  expect(snap.unreviewed).toBe(undefined)
  expect(snap.unreviewedPaths).toEqual([])
})

test('snapOf leaves unreviewed unknown when what the last review saw could not be read', () => {
  const hashes = { 'f0.md': 'h' }
  const snap = snapOf({ ...STATUS, entries: entriesOf(1) }, hashes, undefined)

  expect(snap.unreviewed).toBe(undefined)
  expect(snap.unreviewedPaths).toEqual([])
})

test('names and paths from the repository cannot carry control characters into the panel', () => {
  const entries = [{ path: 'dir/evil\u001b[31m.ts', isMissing: false }]
  const snap = snapOf({ branch: 'fix‮x', upstream: 'origin/fix\nx', entries }, { 'dir/evil\u001b[31m.ts': 'h' }, {})

  expect(snap.branch).toBe('fix x')
  expect(snap.upstream).toBe('origin/fix x')
  expect(snap.unreviewedPaths).toEqual(['dir/evil [31m.ts'])
})

test('snapOf of a clean tree with no upstream carries no upstream, ahead or behind', () => {
  const snap = snapOf({ branch: 'topic', entries: [] }, {}, {})

  expect(snap).toEqual({ branch: 'topic', changed: 0, unreviewed: 0, unreviewedPaths: [] })
})
