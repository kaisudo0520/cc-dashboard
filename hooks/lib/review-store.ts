import { asHashes, storable } from './git'
import { reviewedKey } from './git-tree'

// What each review saw is the one thing the dashboard keeps in its store (per
// repository root, under `git-reviewed:<root>`). The store is capped so it
// cannot grow without bound: only the 8 repositories written to last keep a
// record (a small index key keeps their order), and a review of more than 2000
// changed paths stores nothing of them. A repository with no stored record
// has every changed file unreviewed; one that was too big reads as unknown,
// never as reviewed. The caller hands in the store's four calls, so this stays free of `$`.

export type ReviewStore = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

export const INDEX_KEY = 'git-reviewed-index'
export const MAX_REPOS = 8
export const MAX_PATHS = 2000
/** Stored in place of a record that was too big to keep. */
export const TOO_MANY = 'too-many-paths'

const PREFIX = 'git-reviewed:'

/** What the last review of the repository saw; `{}` when there is none; undefined when it cannot be known. */
export const readReviewed = async (store: ReviewStore, root: string): Promise<Record<string, string> | undefined> => {
  try {
    const value = await store.get(reviewedKey(root))

    return value === TOO_MANY ? undefined : asHashes(value)
  } catch {
    return undefined
  }
}

const roots = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((root): root is string => typeof root === 'string') : []

/**
 * Keeps what a review saw (`hashes`), and answers what was kept: the paths that were
 * hashed, or undefined when there were too many to keep. Then only the newest
 * 8 repositories keep a record; older ones, and records an older version left
 * that the index does not know, are deleted.
 */
export const recordReviewed = async (
  store: ReviewStore,
  root: string,
  hashes: Record<string, string>,
): Promise<Record<string, string> | undefined> => {
  const isTooMany = Object.keys(hashes).length > MAX_PATHS
  const kept = isTooMany ? undefined : storable(hashes)

  await store.set(reviewedKey(root), kept ?? TOO_MANY)
  const index = [root, ...roots(await store.get(INDEX_KEY)).filter(other => other !== root)].slice(0, MAX_REPOS)
  await store.set(INDEX_KEY, index)

  // The index is read again just before deleting: a record another session has listed meanwhile is kept.
  const fresh = roots(await store.get(INDEX_KEY))
  const live = new Set([...index, ...fresh].map(reviewedKey))
  for (const key of await store.keys()) {
    if (key.startsWith(PREFIX) && !live.has(key)) await store.delete(key)
  }

  return kept
}
