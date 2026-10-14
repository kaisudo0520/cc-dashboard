import type { LiveSession } from '../../types'

// Every live Claude Code process keeps a registry file, ~/.claude/sessions/<pid>.json:
//   {"pid":31600,"sessionId":"…","name":"jev-router-41","entrypoint":"cli",…}
// A crashed process can leave its file behind, so a row counts only while its
// pid is still running as a Claude Code process (pids are reused). Only what
// the wait banner needs is read: which session, which process, what to call it.

export type SessionFile = { pid: number; sessionId: string; name: string }

const MAX_NAME = 80

export const parseSessionFile = (json: string): SessionFile | undefined => {
  try {
    const value: Record<string, unknown> | null = JSON.parse(json)
    const { pid, sessionId, name } = value ?? {}

    // The pid names a file in the marks folder, so it must be an ordinary process number.
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof sessionId !== 'string') return undefined

    return { pid, sessionId, name: typeof name === 'string' ? name.slice(0, MAX_NAME) : sessionId.slice(0, 8) }
  } catch {
    return undefined
  }
}

/** The registry files that parse; the rest are skipped. */
export const parseSessionFiles = (texts: readonly string[]): SessionFile[] =>
  texts.flatMap(text => {
    const file = parseSessionFile(text)

    return file === undefined ? [] : [file]
  })

/** The running processes in `tasklist /FO CSV /NH` output, pid to image name: `"claude.exe","31600",…`. */
export const parseTasklist = (csv: string): Map<number, string> =>
  new Map(
    csv.split('\n').flatMap(line => {
      const match = /^"([^"]*)","(\d+)"/.exec(line.trim())

      return match === null ? [] : [[Number(match[2]), match[1] ?? ''] as [number, string]]
    }),
  )

const CLAUDE_IMAGE = /^(claude|node)(\.exe)?$/i

/** The live sessions: those whose pid still runs as Claude Code. A session id appears once. */
export const liveSessions = (
  files: readonly SessionFile[],
  processes: ReadonlyMap<number, string>,
  hereId: string,
): LiveSession[] => {
  const isAlive = (file: SessionFile): boolean => CLAUDE_IMAGE.test(processes.get(file.pid) ?? '')
  const rows = files
    .filter(isAlive)
    .map<LiveSession>(file => ({ id: file.sessionId, pid: file.pid, name: file.name, isHere: file.sessionId === hereId }))

  return [...new Map(rows.map(row => [row.id, row])).values()]
}

const REGISTRY_DIR = '.claude/sessions'

/** The reads the registry needs; the caller hands them in so this stays free of `$`. */
export type SessionIo = {
  list: (dir: string) => Promise<readonly { name: string; size: number; mtimeMs: number; kind: string; isLink: boolean }[]>
  /** A file's text; empty when it cannot be read. */
  read: (path: string) => Promise<string>
  /** The process table, as `tasklist /FO CSV /NH` prints it. */
  tasklist: () => Promise<{ exitCode: number; stdout: string }>
}

/** At most this many registry files are read, the newest; and none over this many bytes (a real one is a few hundred). */
const MAX_FILES = 32
const MAX_FILE_BYTES = 65_536

/** The live sessions out of the registry and the process table; a table that fails rejects. */
export const readLiveSessions = async (home: string, hereId: string, io: SessionIo): Promise<LiveSession[]> => {
  const dir = `${home}/${REGISTRY_DIR}`
  const names = (await io.list(dir))
    .filter(entry => entry.kind === 'file' && !entry.isLink && /^\d+\.json$/.test(entry.name) && entry.size <= MAX_FILE_BYTES)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES)
    .map(entry => entry.name)
  const files = parseSessionFiles(await Promise.all(names.map(name => io.read(`${dir}/${name}`))))
  const table = await io.tasklist()
  if (table.exitCode !== 0) throw new Error(`tasklist exited ${table.exitCode}`)

  return liveSessions(files, parseTasklist(table.stdout), hereId)
}
