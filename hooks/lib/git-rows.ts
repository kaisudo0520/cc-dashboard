import type { GitSnap } from '../../types'
import type { GitNeed } from './layout'

// The 分支 panel as plain text and counts: what each line says and how many
// rows an unfolded list wants. The view draws these and decides nothing about them.

const UNKNOWN = '未知'

/** `3`, `0`, or `未知` when the content hashes could not be had. */
export const unreviewedText = (snap: GitSnap): string =>
  snap.unreviewed === undefined ? UNKNOWN : String(snap.unreviewed)

/** `<branch> · 變更 <n> · 未審 <n>`: the panel in one line. */
export const gitSummary = (snap: GitSnap): string =>
  `${snap.branch} · 變更 ${snap.changed} · 未審 ${unreviewedText(snap)}`

export const upstreamText = (snap: GitSnap): string => (snap.upstream === undefined ? '無上游' : `↔ ${snap.upstream}`)

/** `↑2 ↓1`; none without an upstream, which has nothing to be ahead of or behind. */
export const syncText = (snap: GitSnap): string | undefined =>
  snap.upstream === undefined ? undefined : `↑${snap.ahead ?? 0} ↓${snap.behind ?? 0}`

/** The list of unreviewed paths is only worth unfolding when there are some. */
export const canUnfold = (snap: GitSnap | null): boolean => snap !== null && (snap.unreviewed ?? 0) > 0

// A list shorter than the count (the source keeps the first twenty) ends in a row of its own.
const hasMore = (snap: GitSnap): boolean => (snap.unreviewed ?? 0) > snap.unreviewedPaths.length

/**
 * What the layout has to make room for: whether the panel exists, how many rows
 * its unfolded list wants (none while the person has folded the panel away),
 * and whether it is folded.
 */
export const gitNeed = (snap: GitSnap | null, isOpen: boolean, isFolded = false): GitNeed => ({
  isPresent: snap !== null,
  listRows:
    snap !== null && isOpen && !isFolded && canUnfold(snap) ? snap.unreviewedPaths.length + (hasMore(snap) ? 1 : 0) : 0,
  isFolded,
})

/**
 * The paths to draw in `slots` rows, and how many unreviewed files are left
 * out. Room for all of them draws every path; less room gives the last row to
 * the count of those not drawn.
 */
export const pathLines = (snap: GitSnap, slots: number): { paths: string[]; hidden: number } => {
  const listed = snap.unreviewedPaths
  const total = snap.unreviewed ?? 0
  if (slots <= 0) return { paths: [], hidden: 0 }
  if (slots >= listed.length + (hasMore(snap) ? 1 : 0)) return { paths: listed, hidden: total - listed.length }

  return { paths: listed.slice(0, slots - 1), hidden: total - (slots - 1) }
}
