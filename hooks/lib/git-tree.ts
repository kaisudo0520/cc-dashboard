import { hashTargets, parseGitStatus, withHashes } from './git'
import type { GitEntry, GitStatus } from './git'
import { CONFIG_QUERY, filterDrivers, filterOverrides } from './git-filters'

// Reading the session's work tree through git. Nothing here reaches `$`: the
// caller hands in a runner, so the exact commands are spelled in one place and
// a test can see every one of them. Only read-only git runs: `rev-parse`,
// `config` (to list), `status` and `hash-object` without `-w`;
// `--no-optional-locks` keeps even `status` from refreshing the index, so a poll
// never writes into the repository or takes a lock a person's own git command
// could trip over.
//
// The repository's own configuration is not trusted either, since a poll would
// otherwise run whatever a hostile one names:
//   - `core.fsmonitor=false` stops `status` from running a hook program;
//   - `protocol.ext.allow=never` refuses the `ext::` transport, which runs a command;
//   - `GIT_NO_LAZY_FETCH=1` keeps a partial clone from contacting its promisor remote
//     (git 2.44 and later; older git ignores it, so a repository that is a partial
//     clone at all is not read, see ./git-filters);
//   - `status --ignore-submodules=all` leaves submodules (and their filters) out;
//   - each `filter.<driver>` is listed first and switched off for `status` and
//     `hash-object` (see ./git-filters), and `hash-object --no-filters` skips filters anyway.
// Review time and poll time hash the same way, so their hashes still compare.
// If the filters cannot be listed, nothing more is read. Output the engine cut
// short (it keeps the first 4 MiB) is never taken for a whole answer: a listing
// that was cut could hide a driver, and a cut status would give partial counts.

export type GitRun = (
  argv: readonly string[],
  init?: { cwd?: string; stdin?: string; env?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; isStdoutTruncated?: boolean }>

/** What is known of a path (absolute): whether it is itself a symbolic link, and where it really lands (absent: nowhere). */
export type Inspect = (path: string) => Promise<{ isLink: boolean; realPath?: string }>

/** The repository root, what differs from HEAD and each changed file's content hash. */
export type Tree = {
  root: string
  status: GitStatus
  /** Undefined when the hashes could not be had: nothing is then counted as unreviewed. */
  hashes?: Record<string, string>
}

export const GIT_TIMEOUT_MS = 15_000

/** Set on every git call. */
export const GIT_ENV: Readonly<Record<string, string>> = { GIT_NO_LAZY_FETCH: '1' }

/** More untracked files than this are not each looked at for being a link: the hashes are then unknown. */
export const MAX_UNTRACKED = 500

const GIT = [
  'git',
  '--no-optional-locks',
  '-c',
  'core.quotePath=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.ext.allow=never',
] as const

/** What the last review saw is kept per repository root. */
export const reviewedKey = (root: string): string => `git-reviewed:${root}`

const call = (run: GitRun, argv: readonly string[], init: { cwd?: string; stdin?: string } = {}) =>
  run(argv, { ...init, env: { ...GIT_ENV } })

// The `-c` options that switch off every configured filter driver. `git config --get-regexp`
// exits 1 and prints nothing when nothing matches: that is no filters, not a failure. Any
// other failure, a listing the engine cut short, or a name that cannot be passed safely
// (or a partial clone) is undefined: read nothing further.
const filterArgs = async (run: GitRun, root: string): Promise<string[] | undefined> => {
  const listed = await call(run, [...GIT, 'config', '-z', '--name-only', '--get-regexp', CONFIG_QUERY], { cwd: root })
  if (listed.isStdoutTruncated === true) return undefined
  if (listed.exitCode === 1) return listed.stdout === '' ? [] : undefined
  if (listed.exitCode !== 0) return undefined

  const drivers = filterDrivers(listed.stdout)

  return drivers === undefined ? undefined : filterOverrides(drivers)
}

// Paths are compared in one spelling: forward slashes, no trailing one, lower case (Windows paths).
const spelled = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

// A symbolic link or a junction (which lands elsewhere) has to be told by the file system for the
// paths status does not describe (untracked ones). One that is a link, lands outside the
// repository (under its root as spelled, or under the root's own real path) or leads nowhere,
// counts as a link. Undefined when there are too many to check.
const markLinks = async (entries: readonly GitEntry[], root: string, inspect: Inspect): Promise<GitEntry[] | undefined> => {
  const untracked = entries.filter(entry => entry.isUntracked === true && !entry.isMissing)
  if (untracked.length > MAX_UNTRACKED) return undefined
  if (untracked.length === 0) return [...entries]

  const rootReal = (await inspect(root)).realPath
  const inside = [root, ...(rootReal === undefined ? [] : [rootReal])].map(spelled)
  const isOutside = ({ isLink, realPath }: { isLink: boolean; realPath?: string }): boolean => {
    if (isLink || realPath === undefined) return true
    const real = spelled(realPath)

    return !inside.some(base => real === base || real.startsWith(`${base}/`))
  }
  const links = new Set(
    (await Promise.all(untracked.map(async entry => [entry.path, isOutside(await inspect(`${root}/${entry.path}`))] as const)))
      .filter(([, outside]) => outside)
      .map(([path]) => path),
  )

  return entries.map(entry => (links.has(entry.path) ? { ...entry, isLink: true as const } : entry))
}

const hashesOf = async (
  run: GitRun,
  root: string,
  entries: readonly GitEntry[],
  off: readonly string[],
): Promise<Record<string, string> | undefined> => {
  const targets = hashTargets(entries)
  if (targets.length === 0) return withHashes(entries, '')

  const hashed = await call(run, [...GIT, ...off, 'hash-object', '--no-filters', '--stdin-paths'], {
    cwd: root,
    stdin: `${targets.join('\n')}\n`,
  })

  return hashed.exitCode === 0 && hashed.isStdoutTruncated !== true ? withHashes(entries, hashed.stdout) : undefined
}

/**
 * The session's repository, or undefined outside one (or when `status` fails,
 * or the filters could not be listed). A runner that throws (git cannot start,
 * the call times out) is passed on.
 */
export const readTree = async (run: GitRun, inspect: Inspect): Promise<Tree | undefined> => {
  const top = await call(run, [...GIT, 'rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0 || top.isStdoutTruncated === true) return undefined

  const root = top.stdout.trim()
  const off = await filterArgs(run, root)
  if (off === undefined) return undefined

  const listed = await call(run, [...GIT, ...off, 'status', '--ignore-submodules=all', '--porcelain=v2', '--branch', '-z', '-uall'], {
    cwd: root,
  })
  // A status the engine cut short would give partial counts: it is no status.
  const status = listed.exitCode === 0 && listed.isStdoutTruncated !== true ? parseGitStatus(listed.stdout) : undefined
  if (status === undefined) return undefined

  const entries = await markLinks(status.entries, root, inspect)
  if (entries === undefined) return { root, status }

  return { root, status: { ...status, entries }, hashes: await hashesOf(run, root, entries, off) }
}
