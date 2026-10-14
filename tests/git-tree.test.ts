import { expect, test } from 'claude-code/testing'

import { GIT_ENV, GIT_TIMEOUT_MS, MAX_UNTRACKED, readTree, reviewedKey } from '../hooks/lib/git-tree'
import type { GitRun, Inspect } from '../hooks/lib/git-tree'

const z = (...records: string[]): string => `${records.join('\0')}\0`

const STATUS = z(
  '# branch.oid abc',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +1 -0',
  '1 .M N... 100644 100644 100644 a a src/a.ts',
  '1 .D N... 100644 100644 000000 a a gone.ts',
  '? new.ts',
)

type Call = { argv: readonly string[]; cwd?: string; stdin?: string; env?: Record<string, string> }
type Answer = { exitCode: number; stdout: string; isStdoutTruncated?: boolean }
type Answers = { top?: Answer; config?: Answer; status?: Answer; hash?: Answer }

const NONE: Answer = { exitCode: 1, stdout: '' }
/** Every path is a plain file where it says it is. */
const noLinks: Inspect = async path => ({ isLink: false, realPath: path })

/** A runner standing in for git: records every call and answers by subcommand. `git config` finds no filters unless told. */
const fakeGit = (answers: Answers = {}) => {
  const calls: Call[] = []
  const run: GitRun = async (argv, init) => {
    calls.push({ argv, ...init })
    if (argv.includes('rev-parse')) return answers.top ?? { exitCode: 0, stdout: 'N:/repo\n' }
    if (argv.includes('config')) return answers.config ?? NONE
    if (argv.includes('status')) return answers.status ?? { exitCode: 0, stdout: STATUS }
    if (argv.includes('hash-object')) return answers.hash ?? { exitCode: 0, stdout: 'h1\nh2\n' }
    throw new Error(`unexpected git call: ${argv.join(' ')}`)
  }

  return { run, calls }
}

// What opens every git call: no index lock, plain paths, no fsmonitor hook, no `ext::` transport.
const BASE = [
  'git',
  '--no-optional-locks',
  '-c',
  'core.quotePath=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.ext.allow=never',
]

// What `git config` is asked for: every filter driver, and any sign of a partial clone.
const CONFIG_ARGV = [
  ...BASE,
  'config',
  '-z',
  '--name-only',
  '--get-regexp',
  '^(filter\\.|extensions\\.partialclone$|remote\\..*\\.(promisor|partialclonefilter)$)',
]

const LFS = z('filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process', 'filter.lfs.required')
const LFS_OFF = [
  '-c',
  'filter.lfs.clean=',
  '-c',
  'filter.lfs.smudge=',
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.required=false',
]

test('the tree is the repository root, its status and the hash of each changed file that is still on disk', async () => {
  const { run } = fakeGit()
  const tree = await readTree(run, noLinks)

  expect(tree?.root).toBe('N:/repo')
  expect(tree?.status.branch).toBe('main')
  expect(tree?.status.entries.map(entry => entry.path)).toEqual(['src/a.ts', 'gone.ts', 'new.ts'])
  expect(tree?.hashes).toEqual({ 'src/a.ts': 'h1', 'gone.ts': 'deleted', 'new.ts': 'h2' })
})

test('git is asked, with exactly these arguments, for the root, the filters, the status and the hashes', async () => {
  const { run, calls } = fakeGit()
  await readTree(run, noLinks)

  expect(calls.map(call => call.argv)).toEqual([
    [...BASE, 'rev-parse', '--show-toplevel'],
    CONFIG_ARGV,
    [...BASE, 'status', '--ignore-submodules=all', '--porcelain=v2', '--branch', '-z', '-uall'],
    [...BASE, 'hash-object', '--no-filters', '--stdin-paths'],
  ])
  expect(calls.map(call => call.cwd)).toEqual([undefined, 'N:/repo', 'N:/repo', 'N:/repo'])
  expect(calls[3]?.stdin).toBe('src/a.ts\nnew.ts\n')
})

test('every git call carries GIT_NO_LAZY_FETCH, so a partial clone\'s promisor remote is never contacted', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: LFS } })
  await readTree(run, noLinks)

  expect(GIT_ENV).toEqual({ GIT_NO_LAZY_FETCH: '1' })
  expect(calls).toHaveLength(4)
  for (const call of calls) expect(call.env).toEqual({ GIT_NO_LAZY_FETCH: '1' })
})

test('only read-only git commands are run: no writing hash-object, no lock taken by status', async () => {
  const { run, calls } = fakeGit()
  await readTree(run, noLinks)

  const subcommands = calls.map(call => call.argv.find(arg => ['rev-parse', 'config', 'status', 'hash-object'].includes(arg)))
  expect(subcommands).toEqual(['rev-parse', 'config', 'status', 'hash-object'])
  for (const { argv } of calls) {
    expect(argv[0]).toBe('git')
    expect(argv).toContain('--no-optional-locks')
    expect(argv).not.toContain('-w')
    expect(argv).not.toContain('--write')
    // Nothing that sets a value: `config` only reads.
    expect(argv).not.toContain('--add')
    expect(argv).not.toContain('--unset')
  }
})

test('each configured filter driver is switched off for status and for hash-object, and for no other call', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: z('filter.lfs.clean', 'filter.evil.process') } })
  await readTree(run, noLinks)

  const off = [
    '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
    '-c', 'filter.evil.clean=', '-c', 'filter.evil.smudge=', '-c', 'filter.evil.process=', '-c', 'filter.evil.required=false',
  ]
  expect(calls[0]?.argv).toEqual([...BASE, 'rev-parse', '--show-toplevel'])
  expect(calls[1]?.argv).toEqual(CONFIG_ARGV)
  expect(calls[2]?.argv).toEqual([...BASE, ...off, 'status', '--ignore-submodules=all', '--porcelain=v2', '--branch', '-z', '-uall'])
  expect(calls[3]?.argv).toEqual([...BASE, ...off, 'hash-object', '--no-filters', '--stdin-paths'])
})

test('a single driver gives the four overrides ahead of the subcommand', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: LFS } })
  await readTree(run, noLinks)

  expect(calls[2]?.argv.slice(0, BASE.length + 8)).toEqual([...BASE, ...LFS_OFF])
  expect(calls[2]?.argv[BASE.length + 8]).toBe('status')
})

test('git config exiting 1 means no filter is configured: that is not a failure', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 1, stdout: '' } })
  const tree = await readTree(run, noLinks)

  expect(tree?.status.branch).toBe('main')
  expect(calls).toHaveLength(4)
  expect(calls[2]?.argv).toEqual([...BASE, 'status', '--ignore-submodules=all', '--porcelain=v2', '--branch', '-z', '-uall'])
})

test('a config listing that fails (any other exit) hides the panel and reads no further', async () => {
  for (const exitCode of [2, 3, 128]) {
    const { run, calls } = fakeGit({ config: { exitCode, stdout: LFS } })

    expect(await readTree(run, noLinks)).toBe(undefined)
    expect(calls).toHaveLength(2)
  }
})

test('a driver name git cannot be given safely hides the panel and reads no further', async () => {
  for (const stdout of [z('filter.a=b.clean'), z('filter.a\nb.clean'), z('core.editor'), 'filter.lfs.clean\0\0filter.x']) {
    const { run, calls } = fakeGit({ config: { exitCode: 0, stdout } })

    expect(await readTree(run, noLinks)).toBe(undefined)
    expect(calls).toHaveLength(2)
  }
})

test('a config listing that is empty but exits 0 is no filters', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: '' } })

  expect((await readTree(run, noLinks))?.root).toBe('N:/repo')
  expect(calls[2]?.argv).toEqual([...BASE, 'status', '--ignore-submodules=all', '--porcelain=v2', '--branch', '-z', '-uall'])
})

test('exit 1 with output is not "no filters": it is no answer', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 1, stdout: LFS } })

  expect(await readTree(run, noLinks)).toBe(undefined)
  expect(calls).toHaveLength(2)
})

// --- Output the engine cut short is not a whole answer -------------------------------------

test('a filter listing the engine truncated (4 MiB) hides the panel: the driver past the cut would not be switched off', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: LFS, isStdoutTruncated: true } })

  expect(await readTree(run, noLinks)).toBe(undefined)
  expect(calls).toHaveLength(2)
})

test('a filter listing whose last name is cut off (no closing NUL) hides the panel, truncated or not', async () => {
  const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: 'filter.lfs.clean\0filter.evil.cl' } })

  expect(await readTree(run, noLinks)).toBe(undefined)
  expect(calls).toHaveLength(2)
})

test('a status the engine truncated is no tree: partial counts are never shown', async () => {
  const { run, calls } = fakeGit({ status: { exitCode: 0, stdout: STATUS, isStdoutTruncated: true } })

  expect(await readTree(run, noLinks)).toBe(undefined)
  expect(calls.some(call => call.argv.includes('hash-object'))).toBe(false)
})

test('hash-object output the engine truncated leaves the hashes unknown', async () => {
  const tree = await readTree(fakeGit({ hash: { exitCode: 0, stdout: 'h1\nh2\n', isStdoutTruncated: true } }).run, noLinks)

  expect(tree?.status.branch).toBe('main')
  expect(tree?.hashes).toBe(undefined)
})

// --- A repository that is a partial clone may fetch on its own -------------------------------

test('a partial clone (extensions.partialclone, a promisor remote) hides the panel: GIT_NO_LAZY_FETCH is not relied on alone', async () => {
  for (const name of ['extensions.partialclone', 'remote.origin.promisor', 'remote.up.stream.partialclonefilter']) {
    const { run, calls } = fakeGit({ config: { exitCode: 0, stdout: z('filter.lfs.clean', name) } })

    expect(await readTree(run, noLinks)).toBe(undefined)
    expect(calls).toHaveLength(2)
  }
})

test('a clean tree runs no hash-object at all', async () => {
  const { run, calls } = fakeGit({ status: { exitCode: 0, stdout: z('# branch.oid abc', '# branch.head main') } })
  const tree = await readTree(run, noLinks)

  expect(calls.some(call => call.argv.includes('hash-object'))).toBe(false)
  expect(tree?.hashes).toEqual({})
})

test('outside a repository there is no tree, and nothing more is run', async () => {
  const { run, calls } = fakeGit({ top: { exitCode: 128, stdout: '' } })

  expect(await readTree(run, noLinks)).toBe(undefined)
  expect(calls).toHaveLength(1)
})

test('a status that fails or is not git status is no tree', async () => {
  expect(await readTree(fakeGit({ status: { exitCode: 1, stdout: '' } }).run, noLinks)).toBe(undefined)
  expect(await readTree(fakeGit({ status: { exitCode: 0, stdout: 'garbage' } }).run, noLinks)).toBe(undefined)
})

test('a failed hash-object keeps the tree but leaves the hashes unknown', async () => {
  const tree = await readTree(fakeGit({ hash: { exitCode: 128, stdout: '' } }).run, noLinks)

  expect(tree?.status.branch).toBe('main')
  expect(tree?.hashes).toBe(undefined)
})

test('hash-object output that does not line up with the files leaves the hashes unknown', async () => {
  const tree = await readTree(fakeGit({ hash: { exitCode: 0, stdout: 'h1\n' } }).run, noLinks)

  expect(tree?.hashes).toBe(undefined)
})

test('a runner that throws (git cannot start, a timeout) is not swallowed here', async () => {
  const run: GitRun = async () => {
    throw new Error('spawn git ENOENT')
  }

  await expect(readTree(run, noLinks)).rejects.toThrow('spawn git ENOENT')
})

// --- Symbolic links are not hashed: hash-object would follow them to whatever they point at -------

const LINKED = z(
  '# branch.oid abc',
  '# branch.head main',
  '1 .M N... 100644 100644 100644 a a src/a.ts',
  '1 .M N... 120000 120000 120000 a a tracked-link',
  '? new.ts',
  '? untracked-link',
)

test('a tracked symlink (work-tree mode 120000) is not handed to hash-object, and cannot be called reviewed', async () => {
  const { run, calls } = fakeGit({ status: { exitCode: 0, stdout: LINKED }, hash: { exitCode: 0, stdout: 'h1\nh2\n' } })
  const checked: string[] = []
  const tree = await readTree(run, async path => (checked.push(path), { isLink: path.endsWith('untracked-link'), realPath: path }))

  expect(calls[3]?.stdin).toBe('src/a.ts\nnew.ts\n')
  // Its content is not known: it is marked, and the marker is never one a review stores.
  expect(tree?.hashes).toEqual({ 'src/a.ts': 'h1', 'tracked-link': 'unhashed', 'new.ts': 'h2', 'untracked-link': 'unhashed' })
  // The root, once, and only the untracked paths: git already said what a tracked one is.
  expect(checked).toEqual(['N:/repo', 'N:/repo/new.ts', 'N:/repo/untracked-link'])
})

test('with only links changed no hash-object runs', async () => {
  const only = z('# branch.oid abc', '# branch.head main', '1 .M N... 120000 120000 120000 a a tracked-link')
  const { run, calls } = fakeGit({ status: { exitCode: 0, stdout: only } })
  const tree = await readTree(run, noLinks)

  expect(calls.some(call => call.argv.includes('hash-object'))).toBe(false)
  expect(tree?.hashes).toEqual({ 'tracked-link': 'unhashed' })
})

test('a path that cannot be checked (reported as a link) is not hashed', async () => {
  const { run, calls } = fakeGit({ hash: { exitCode: 0, stdout: 'h1\n' } })
  const tree = await readTree(run, async () => ({ isLink: true }))

  expect(calls[3]?.stdin).toBe('src/a.ts\n')
  expect(tree?.hashes).toEqual({ 'src/a.ts': 'h1', 'gone.ts': 'deleted', 'new.ts': 'unhashed' })
})

// --- A path that lands outside the repository (a junction) is not hashed either ----------------

/** An inspector that puts each named path where it says, and every other path where it is. */
const landing = (where: Record<string, string | null>): Inspect => async path => {
  const real = where[path]

  return real === null ? { isLink: false } : { isLink: false, realPath: real ?? path }
}

const hashedOf = async (inspect: Inspect) => {
  const { run, calls } = fakeGit({ hash: { exitCode: 0, stdout: 'h1\n' } })
  const tree = await readTree(run, inspect)

  return { stdin: calls[3]?.stdin, hashes: tree?.hashes }
}

test('an untracked path that lands outside the repository root is not handed to hash-object', async () => {
  const outside = await hashedOf(landing({ 'N:/repo/new.ts': 'D:\\elsewhere\\new.ts' }))

  expect(outside.stdin).toBe('src/a.ts\n')
  expect(outside.hashes).toEqual({ 'src/a.ts': 'h1', 'gone.ts': 'deleted', 'new.ts': 'unhashed' })
})

test('a path that leads nowhere (no real path) is not hashed', async () => {
  expect((await hashedOf(landing({ 'N:/repo/new.ts': null }))).stdin).toBe('src/a.ts\n')
})

test('a landing under the root in another spelling (slashes, case) is still inside', async () => {
  expect((await hashedOf(landing({ 'N:/repo/new.ts': 'n:\\REPO\\new.ts' }))).stdin).toBe('src/a.ts\nnew.ts\n')
})

test('a sibling folder that merely starts with the root\'s name is outside', async () => {
  expect((await hashedOf(landing({ 'N:/repo/new.ts': 'N:\\repo-evil\\new.ts' }))).stdin).toBe('src/a.ts\n')
})

test('a repository reached through a junction or a drive mapping: its files land under the root\'s own real path', async () => {
  const inside = await hashedOf(landing({ 'N:/repo': 'D:\\real\\repo', 'N:/repo/new.ts': 'D:\\real\\repo\\new.ts' }))

  expect(inside.stdin).toBe('src/a.ts\nnew.ts\n')
})

test('more untracked files than can be checked leave the hashes unknown, and run no hash-object', async () => {
  const many = Array.from({ length: MAX_UNTRACKED + 1 }, (_, i) => `? f${i}.ts`)
  const { run, calls } = fakeGit({ status: { exitCode: 0, stdout: z('# branch.oid abc', '# branch.head main', ...many) } })
  const tree = await readTree(run, noLinks)

  expect(tree?.status.entries).toHaveLength(MAX_UNTRACKED + 1)
  expect(tree?.hashes).toBe(undefined)
  expect(calls.some(call => call.argv.includes('hash-object'))).toBe(false)
})

test('what a review saw is kept per repository root, under this plugin\'s own key', () => {
  expect(reviewedKey('N:/repo')).toBe('git-reviewed:N:/repo')
  expect(GIT_TIMEOUT_MS).toBe(15_000)
})
