// Reading a background task's notification and a shell result's hand-off to
// the background. Plain text and plain data in and out. Only which task ended
// and how is read: nothing a notification names is opened.

/** One finished background task, as its notification reports it. */
export type Notification = { id: string; toolUseId?: string; ok: boolean }

const BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g
const FAILED_STATUSES = new Set(['failed', 'killed', 'error'])

const tag = (block: string, name: string): string | undefined =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]?.trim() || undefined

const SUMMARY = '<summary>'

const parseBlock = (block: string): Notification | undefined => {
  // The task's own tags come before the summary. What follows is text a task wrote (a summary, a
  // result) and may hold tags of its own: none of it is the task's.
  const at = block.indexOf(SUMMARY)
  const head = at < 0 ? block : block.slice(0, at)
  const id = tag(head, 'task-id')
  if (id === undefined) return undefined

  const toolUseId = tag(head, 'tool-use-id')
  // The exit code is the summary's own; a result may quote any number.
  const code = /\(exit code (\d+)\)/.exec(at < 0 ? '' : (tag(block.slice(at), 'summary') ?? ''))?.[1]
  const failed = FAILED_STATUSES.has(tag(head, 'status') ?? '') || (code !== undefined && Number(code) !== 0)

  return { id, ...(toolUseId === undefined ? {} : { toolUseId }), ok: !failed }
}

/** The notifications in a text; one text may merge several. A task is reported once, by the first block that names it. */
export const parseNotifications = (text: string): Notification[] => {
  const seen = new Set<string>()
  const found: Notification[] = []

  for (const match of text.matchAll(BLOCK)) {
    const note = parseBlock(match[1] ?? '')
    if (note === undefined || seen.has(note.id)) continue
    seen.add(note.id)
    found.push(note)
  }

  return found
}

/** The background task id of a shell result that moved to the background. */
export const backgroundIdOf = (result: unknown): string | undefined => {
  const id = typeof result === 'object' && result !== null ? (result as { backgroundTaskId?: unknown }).backgroundTaskId : undefined

  return typeof id === 'string' && id !== '' ? id : undefined
}
