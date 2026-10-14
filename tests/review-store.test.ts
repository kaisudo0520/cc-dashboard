import { expect, test } from 'claude-code/testing'

import { INDEX_KEY, MAX_PATHS, MAX_REPOS, TOO_MANY, readReviewed, recordReviewed } from '../hooks/lib/review-store'
import type { ReviewStore } from '../hooks/lib/review-store'

/** A store in memory that keeps the insertion order of its keys and counts what is deleted. */
const memory = (start: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(start))
  const deleted: string[] = []
  const store: ReviewStore = {
    get: async key => data.get(key),
    set: async (key, value) => void data.set(key, value),
    delete: async key => void (data.delete(key), deleted.push(key)),
    keys: async () => [...data.keys()],
  }

  return { store, data, deleted }
}

const key = (root: string): string => `git-reviewed:${root}`

test('a review stores what it saw under its repository\'s key, and answers what it stored', async () => {
  const { store, data } = memory()

  expect(await recordReviewed(store, 'N:/a', { 'x.ts': 'h1' })).toEqual({ 'x.ts': 'h1' })
  expect(data.get(key('N:/a'))).toEqual({ 'x.ts': 'h1' })
  expect(await readReviewed(store, 'N:/a')).toEqual({ 'x.ts': 'h1' })
})

test('paths whose content could not be hashed are not stored, so they stay unreviewed', async () => {
  const { store, data } = memory()

  expect(await recordReviewed(store, 'N:/a', { 'x.ts': 'h1', link: 'unhashed' })).toEqual({ 'x.ts': 'h1' })
  expect(data.get(key('N:/a'))).toEqual({ 'x.ts': 'h1' })
})

test('with no record every changed file is unreviewed, which is an empty record, not an unknown one', async () => {
  expect(await readReviewed(memory().store, 'N:/new')).toEqual({})
})

test('a store that cannot be read is an unknown record', async () => {
  const { store } = memory()

  expect(await readReviewed({ ...store, get: async () => Promise.reject(new Error('store is down')) }, 'N:/a')).toBeUndefined()
})

test('past 2000 paths nothing of the review is stored, and the repository then reads as unknown, never reviewed', async () => {
  const { store, data } = memory({ [key('N:/a')]: { 'old.ts': 'h' } })
  const many = Object.fromEntries(Array.from({ length: MAX_PATHS + 1 }, (_, i) => [`f${i}.ts`, `h${i}`]))

  expect(MAX_PATHS).toBe(2000)
  expect(await recordReviewed(store, 'N:/a', many)).toBeUndefined()
  expect(data.get(key('N:/a'))).toBe(TOO_MANY)
  expect(await readReviewed(store, 'N:/a')).toBeUndefined()
})

test('exactly 2000 paths are still stored', async () => {
  const { store } = memory()
  const all = Object.fromEntries(Array.from({ length: MAX_PATHS }, (_, i) => [`f${i}.ts`, `h${i}`]))

  expect(Object.keys((await recordReviewed(store, 'N:/a', all)) ?? {})).toHaveLength(MAX_PATHS)
})

test('the index lists the repositories most recently written first, each once', async () => {
  const { store, data } = memory()
  await recordReviewed(store, 'N:/a', {})
  await recordReviewed(store, 'N:/b', {})
  await recordReviewed(store, 'N:/a', { 'x.ts': 'h' })

  expect(data.get(INDEX_KEY)).toEqual(['N:/a', 'N:/b'])
})

test('only the 8 most recently written repositories are kept: the oldest record is deleted', async () => {
  const { store, data, deleted } = memory()
  for (let i = 0; i < MAX_REPOS; i++) await recordReviewed(store, `N:/r${i}`, { 'x.ts': 'h' })
  expect(MAX_REPOS).toBe(8)
  expect(deleted).toEqual([])

  await recordReviewed(store, 'N:/r8', { 'x.ts': 'h' })

  expect(deleted).toEqual([key('N:/r0')])
  expect(data.has(key('N:/r0'))).toBe(false)
  expect(data.get(INDEX_KEY)).toEqual(['N:/r8', 'N:/r7', 'N:/r6', 'N:/r5', 'N:/r4', 'N:/r3', 'N:/r2', 'N:/r1'])
})

test('writing a repository again makes it the newest, so it is not the one evicted', async () => {
  const { store, data } = memory()
  for (let i = 0; i < MAX_REPOS; i++) await recordReviewed(store, `N:/r${i}`, {})
  await recordReviewed(store, 'N:/r0', { 'x.ts': 'h' })
  await recordReviewed(store, 'N:/r8', {})

  expect(data.has(key('N:/r0'))).toBe(true)
  expect(data.has(key('N:/r1'))).toBe(false)
})

test('records the index does not know (left by an older version) are deleted too, and other keys are left alone', async () => {
  const { store, data } = memory({ [key('N:/old1')]: { a: 'h' }, [key('N:/old2')]: { a: 'h' }, unrelated: 1 })
  await recordReviewed(store, 'N:/a', {})

  expect([...data.keys()].sort()).toEqual([INDEX_KEY, key('N:/a'), 'unrelated'].sort())
})

test('a repository another writer put in the index while this one worked is not deleted', async () => {
  const { store, data } = memory()
  for (let i = 0; i < MAX_REPOS; i++) await recordReviewed(store, `N:/r${i}`, {})
  // Between this write of the index and the cleanup, another session recorded N:/other: the index now lists it.
  let reads = 0
  const racing: ReviewStore = {
    ...store,
    get: async key => {
      if (key !== INDEX_KEY) return store.get(key)
      reads += 1

      return reads === 1 ? store.get(key) : ['N:/other', 'N:/r8', 'N:/r7', 'N:/r6', 'N:/r5', 'N:/r4', 'N:/r3', 'N:/r2']
    },
  }
  data.set(key('N:/other'), { 'x.ts': 'h' })

  await recordReviewed(racing, 'N:/r8', {})

  expect(data.has(key('N:/other'))).toBe(true)
  expect(data.has(key('N:/r8'))).toBe(true)
})

test('a store that refuses the write is not hidden', async () => {
  const { store } = memory()

  await expect(recordReviewed({ ...store, set: async () => Promise.reject(new Error('store is full')) }, 'N:/a', {})).rejects.toThrow(
    'store is full',
  )
})
