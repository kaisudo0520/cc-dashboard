import type { GitSnap } from '../../types'
import { plain } from './plain'

/** How many unreviewed paths the branch panel can unfold. */
export const UNREVIEWED_SHOWN = 20

// The work tree as `git status --porcelain=v2 --branch -z -uall` reports it:
// NUL-separated records, `# branch.*` headers first, a rename (`2`) followed
// by one more record holding its old path. Paths are relative to the root.

/**
 * One changed path. A symbolic link is not hashed (`hash-object` would follow
 * it to whatever it points at): `isLink` when status says the work tree holds
 * one. Status does not say that of an untracked path, so `isUntracked` tells
 * the caller which to look at itself.
 */
export type GitEntry = { path: string; isMissing: boolean; isUntracked?: true; isLink?: true }

/** Stands for the content of a changed path that was not hashed. A review never stores it, so the path stays unreviewed. */
export const UNHASHED = 'unhashed'

export type GitStatus = { branch: string; upstream?: string; ahead?: number; behind?: number; entries: GitEntry[] }

// How many space-separated fields come before the path, per record kind.
const PATH_AFTER: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 }

const pathOf = (record: string, fields: number): string => record.split(' ').slice(fields).join(' ')

// Gone from the work tree: deleted there, or deleted from the index and not put back.
const isMissing = (xy: string): boolean => xy[1] === 'D' || (xy[0] === 'D' && xy[1] === '.')

// The work-tree mode sits after the head and index modes: `1`/`2` records read `<kind> <XY> <sub> <mH> <mI> <mW> …`,
// an unmerged one `u <XY> <sub> <m1> <m2> <m3> <mW> …`. 120000 is a symbolic link.
const MODE_AT: Record<string, number> = { '1': 5, '2': 5, u: 6 }
const SYMLINK = '120000'

const linkFlag = (kind: string, fields: readonly string[]): { isLink?: true } =>
  fields[MODE_AT[kind] ?? -1] === SYMLINK ? { isLink: true } : {}

export const parseGitStatus = (output: string): GitStatus | undefined => {
  const records = output.split('\0')
  let branch: string | undefined
  let upstream: string | undefined
  let ahead: number | undefined
  let behind: number | undefined
  const entries: GitEntry[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ''
    const kind = record.split(' ', 1)[0] ?? ''

    if (record.startsWith('# branch.head ')) branch = record.slice('# branch.head '.length)
    if (record.startsWith('# branch.upstream ')) upstream = record.slice('# branch.upstream '.length)
    const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
    if (ab !== null) {
      ahead = Number(ab[1])
      behind = Number(ab[2])
    }

    const fields = PATH_AFTER[kind]
    if (fields === undefined) continue
    const xy = kind === '?' ? '??' : (record.split(' ')[1] ?? '')
    // A conflicted file is on disk in some form unless both sides deleted it.
    entries.push({
      path: pathOf(record, fields),
      isMissing: kind === 'u' ? xy === 'DD' : isMissing(xy),
      ...(kind === '?' ? { isUntracked: true as const } : linkFlag(kind, record.split(' '))),
    })
    if (kind === '2') i++
  }

  return branch === undefined ? undefined : { branch, upstream, ahead, behind, entries }
}

/** The paths `git hash-object --stdin-paths` is given: the files still on disk (not a deleted path, not a link). */
export const hashTargets = (entries: readonly GitEntry[]): string[] =>
  entries.filter(entry => !entry.isMissing && entry.isLink !== true).map(entry => entry.path)

/**
 * Each changed path with its content hash (`deleted` for a missing one,
 * `unhashed` for a link), from the hash-object output for
 * `hashTargets(entries)`; undefined when the two do not line up.
 */
export const withHashes = (entries: readonly GitEntry[], output: string): Record<string, string> | undefined => {
  const hashes = output.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (hashes.length !== hashTargets(entries).length) return undefined

  let next = 0

  const valueOf = (entry: GitEntry): string => {
    if (entry.isMissing) return 'deleted'

    return entry.isLink === true ? UNHASHED : (hashes[next++] ?? '')
  }

  return Object.fromEntries(entries.map(entry => [entry.path, valueOf(entry)]))
}

/** What a review stores of the hashes it saw: not the paths that were not hashed, which must stay unreviewed. */
export const storable = (hashes: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(hashes).filter(([, hash]) => hash !== UNHASHED))

/** A stored path-to-hash map as read back from the store; anything else is no record. */
export const asHashes = (value: unknown): Record<string, string> =>
  value === null || typeof value !== 'object' || Array.isArray(value)
    ? {}
    : Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))

/** Changed files whose content the last review did not see as it is now. */
export const unreviewedPaths = (current: Record<string, string>, reviewed: Record<string, string>): string[] =>
  Object.entries(current)
    .filter(([path, hash]) => reviewed[path] !== hash)
    .map(([path]) => path)

const REVIEW = /review/i

const field = (input: unknown, key: string): string => {
  const value = (input as Record<string, unknown> | null)?.[key]

  return typeof value === 'string' ? value : ''
}

/** A tool call that starts a review: a reviewing skill, or a reviewer subagent. */
export const isReviewCall = (tool: string, input: unknown): boolean =>
  (tool === 'Skill' && REVIEW.test(field(input, 'skill'))) ||
  (tool === 'Agent' && REVIEW.test(field(input, 'subagent_type')))

/** A typed slash command that starts a review (`/code-review high`). */
export const isReviewPrompt = (text: string): boolean => /^\/[\w:-]*review(?=\s|$)/i.test(text.trim())

/** Only a person's own prompt can be a typed review: a notification or a peer message is not one. */
export const isPersonPrompt = (originKind: string): boolean =>
  originKind === 'composer' || originKind === 'bridge' || originKind === 'sdk'

/**
 * The branch panel's figures from a status, its hashes and what the last review
 * saw. When either the hashes or the review record could not be had, how many
 * files are unreviewed is unknown (absent), never zero.
 */
export const snapOf = (
  status: GitStatus,
  hashes: Record<string, string> | undefined,
  reviewed: Record<string, string> | undefined,
): GitSnap => {
  // What the repository names (branch, upstream, paths) is drawn as text, so it is made plain first.
  const base = {
    branch: plain(status.branch),
    upstream: status.upstream === undefined ? undefined : plain(status.upstream),
    ahead: status.ahead,
    behind: status.behind,
    changed: status.entries.length,
  }
  if (hashes === undefined || reviewed === undefined) return { ...base, unreviewedPaths: [] }

  const unseen = unreviewedPaths(hashes, reviewed)

  return { ...base, unreviewed: unseen.length, unreviewedPaths: unseen.slice(0, UNREVIEWED_SHOWN).map(plain) }
}
