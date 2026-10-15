import type { LiveSession, WaitReason, WaitingRow } from '../../types'
import { ago, plain } from './plain'

// Each session keeps one small mark file, named by its pid, saying whether it
// is waiting on the person right now and since when. The session id inside it
// tells a live session's mark from one a reused pid left behind. The format is
// the one status-sidebar writes and reads, so sessions running either see each other.

const MARK_DIR = '.claude/mods-state/status-sidebar/waiting'

/** The mark file of the session running as `pid`. */
export const markPath = (home: string, pid: number): string => `${home}/${MARK_DIR}/${pid}.json`

export const markText = (sessionId: string, reason: WaitReason | null, sinceMs: number): string =>
  JSON.stringify({ sessionId, reason, sinceMs })

const REASONS: readonly string[] = ['permission', 'question']

/** The wait a mark records for `sessionId`; undefined when cleared, broken or another session's. */
export const parseMark = (text: string, sessionId: string): { reason: WaitReason; sinceMs: number } | undefined => {
  try {
    const value: Record<string, unknown> | null = JSON.parse(text)
    const { reason, sinceMs } = value ?? {}

    if (value?.sessionId !== sessionId || typeof reason !== 'string' || !REASONS.includes(reason)) return undefined

    return { reason: reason as WaitReason, sinceMs: typeof sinceMs === 'number' ? sinceMs : 0 }
  } catch {
    return undefined
  }
}

/** The other live sessions waiting on the person, the longest wait first. */
export const waitingRows = (rows: readonly LiveSession[], markOf: (pid: number) => string): WaitingRow[] =>
  rows
    .filter(row => !row.isHere)
    .flatMap(row => {
      const mark = parseMark(markOf(row.pid), row.id)

      return mark === undefined ? [] : [{ id: row.id, name: row.name, ...mark }]
    })
    .sort((a, b) => a.sinceMs - b.sinceMs)

/** The other live sessions waiting on the person: each one's mark file is read (`readFile`; empty when it cannot be). */
export const readWaits = async (
  home: string,
  rows: readonly LiveSession[],
  readFile: (path: string) => Promise<string>,
): Promise<WaitingRow[]> => {
  const marks = new Map(
    await Promise.all(rows.filter(row => !row.isHere).map(async row => [row.pid, await readFile(markPath(home, row.pid))] as const)),
  )

  return waitingRows(rows, pid => marks.get(pid) ?? '')
}

/** True when two reads found the same waits, in the same order. */
export const sameWaits = (a: readonly WaitingRow[], b: readonly WaitingRow[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/** A tool that stops to ask the person: a question, or a plan to approve. */
export const isQuestionTool = (tool: string): boolean => tool === 'AskUserQuestion' || tool === 'ExitPlanMode'

const WAIT_LABEL: Record<WaitReason, string> = { permission: 'permission', question: 'question' }

/**
 * The banner line: the session that has waited longest, why, and since when,
 * with how many more wait. Undefined while nobody does. Permission waits are
 * known to start and not to end until their call returns, hence "waiting on you".
 */
export const bannerText = (rows: readonly WaitingRow[], nowMs: number): string | undefined => {
  const [first] = rows
  if (first === undefined) return undefined

  const more = rows.length > 1 ? ` · +${rows.length - 1} more` : ''

  return `! waiting on you: ${plain(first.name)} ${WAIT_LABEL[first.reason]} ${ago(first.sinceMs, nowMs)}${more}`
}
