import { expect, test } from 'claude-code/testing'

import type { GitSnap } from '../types'
import { canUnfold, gitNeed, gitSummary, pathLines, syncText, unreviewedText, upstreamText } from '../hooks/lib/git-rows'

const SNAP: GitSnap = {
  branch: 'main',
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  changed: 5,
  unreviewed: 3,
  unreviewedPaths: ['a.ts', 'b.ts', 'c.ts'],
}

const withPaths = (count: number, unreviewed = count): GitSnap => ({
  ...SNAP,
  unreviewed,
  unreviewedPaths: Array.from({ length: Math.min(count, 20) }, (_, i) => `f${i}.ts`),
})

test('the summary line is branch, changed files and unreviewed files', () => {
  expect(gitSummary(SNAP)).toBe('main · 變更 5 · 未審 3')
  expect(gitSummary({ ...SNAP, changed: 0, unreviewed: 0, unreviewedPaths: [] })).toBe('main · 變更 0 · 未審 0')
})

test('an unknown unreviewed count reads 未知, never 0', () => {
  const unknown: GitSnap = { branch: 'main', changed: 4, unreviewedPaths: [] }

  expect(unreviewedText(unknown)).toBe('未知')
  expect(gitSummary(unknown)).toBe('main · 變更 4 · 未審 未知')
  expect(unreviewedText(SNAP)).toBe('3')
  expect(unreviewedText({ ...SNAP, unreviewed: 0 })).toBe('0')
})

test('the upstream line names the upstream, or says there is none', () => {
  expect(upstreamText(SNAP)).toBe('↔ origin/main')
  expect(upstreamText({ ...SNAP, upstream: undefined })).toBe('無上游')
})

test('ahead and behind are shown with an upstream and absent without one', () => {
  expect(syncText(SNAP)).toBe('↑2 ↓1')
  expect(syncText({ ...SNAP, ahead: undefined, behind: undefined })).toBe('↑0 ↓0')
  expect(syncText({ ...SNAP, upstream: undefined, ahead: undefined, behind: undefined })).toBe(undefined)
})

test('the unreviewed list can unfold only when some files are unreviewed', () => {
  expect(canUnfold(SNAP)).toBe(true)
  expect(canUnfold({ ...SNAP, unreviewed: 0 })).toBe(false)
  expect(canUnfold({ branch: 'main', changed: 1, unreviewedPaths: [] })).toBe(false)
  expect(canUnfold(null)).toBe(false)
})

test('the layout needs nothing from a missing panel and nothing extra from a folded one', () => {
  expect(gitNeed(null, true)).toEqual({ isPresent: false, listRows: 0, isFolded: false })
  expect(gitNeed(SNAP, false)).toEqual({ isPresent: true, listRows: 0, isFolded: false })
})

test('an unfolded list wants a row per path, and one more when more files are unreviewed than are listed', () => {
  expect(gitNeed(SNAP, true)).toEqual({ isPresent: true, listRows: 3, isFolded: false })
  expect(gitNeed(withPaths(25), true)).toEqual({ isPresent: true, listRows: 21, isFolded: false })
  // Nothing unreviewed: pressing u unfolds nothing.
  expect(gitNeed({ ...SNAP, unreviewed: 0, unreviewedPaths: [] }, true)).toEqual({ isPresent: true, listRows: 0, isFolded: false })
})

test('a panel the person folded to its title line wants no list, however open the list was left', () => {
  expect(gitNeed(SNAP, true, true)).toEqual({ isPresent: true, listRows: 0, isFolded: true })
  expect(gitNeed(null, true, true)).toEqual({ isPresent: false, listRows: 0, isFolded: true })
})

test('with room every path is listed, and with less room the last row says how many are not', () => {
  expect(pathLines(SNAP, 3)).toEqual({ paths: ['a.ts', 'b.ts', 'c.ts'], hidden: 0 })
  expect(pathLines(SNAP, 10)).toEqual({ paths: ['a.ts', 'b.ts', 'c.ts'], hidden: 0 })
  expect(pathLines(SNAP, 2)).toEqual({ paths: ['a.ts'], hidden: 2 })
  expect(pathLines(SNAP, 1)).toEqual({ paths: [], hidden: 3 })
  expect(pathLines(SNAP, 0)).toEqual({ paths: [], hidden: 0 })
})

test('files beyond the listed twenty are always counted in the closing row', () => {
  const snap = withPaths(25)

  expect(pathLines(snap, 21)).toEqual({ paths: snap.unreviewedPaths, hidden: 5 })
  expect(pathLines(snap, 5)).toEqual({ paths: snap.unreviewedPaths.slice(0, 4), hidden: 21 })
})
