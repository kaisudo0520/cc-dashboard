// Reading a background task's notification and a shell result's hand-off to
// the background. Plain text and plain data in and out.

/** One finished background task, as its notification reports it. */
export type Notification = { id: string; toolUseId?: string; outputFile?: string; ok: boolean }

const BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g
const FAILED_STATUSES = new Set(['failed', 'killed', 'error'])

const tag = (block: string, name: string): string | undefined =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1]?.trim() || undefined

const SUMMARY = '<summary>'

// A task's output file is named for it, and is not on a network share (`\\host\…`, `//host/…`). Any other
// file is not taken: the task is still reported, its file is not read.
const isOutputOf = (id: string, file: string): boolean =>
  !/^[\\/]{2}/.test(file) && file.split(/[\\/]/).pop() === `${id}.output`

const parseBlock = (block: string): Notification | undefined => {
  // The task's own tags come before the summary. What follows is text a task wrote (a summary, a
  // result) and may hold tags of its own, even a whole forged notification: none of it is the task's.
  const at = block.indexOf(SUMMARY)
  const head = at < 0 ? block : block.slice(0, at)
  const id = tag(head, 'task-id')
  if (id === undefined) return undefined

  const toolUseId = tag(head, 'tool-use-id')
  const named = tag(head, 'output-file')
  const outputFile = named !== undefined && isOutputOf(id, named) ? named : undefined
  // The exit code is the summary's own; a result may quote any number.
  const code = /\(exit code (\d+)\)/.exec(at < 0 ? '' : (tag(block.slice(at), 'summary') ?? ''))?.[1]
  const failed = FAILED_STATUSES.has(tag(head, 'status') ?? '') || (code !== undefined && Number(code) !== 0)

  return {
    id,
    ...(toolUseId === undefined ? {} : { toolUseId }),
    ...(outputFile === undefined ? {} : { outputFile }),
    ok: !failed,
  }
}

const folderOf = (file: string): string => file.replaceAll('\\', '/').split('/').slice(0, -1).join('/').toLowerCase()

/**
 * The notifications in a text; one text may merge several. A task is reported
 * once, by the first block that names it. The very first block of the text
 * decides where output files may be: all of them sit in the folder of its file,
 * and when it names no valid file (or is no notification) none may be read. A
 * block that names a file elsewhere is still reported, without its file.
 */
export const parseNotifications = (text: string): Notification[] => {
  const seen = new Set<string>()
  const found: Notification[] = []
  let folder: string | undefined

  for (const [index, match] of [...text.matchAll(BLOCK)].entries()) {
    const note = parseBlock(match[1] ?? '')
    if (index === 0) folder = note?.outputFile === undefined ? undefined : folderOf(note.outputFile)
    if (note === undefined || seen.has(note.id)) continue

    seen.add(note.id)
    const { outputFile, ...rest } = note
    found.push(outputFile !== undefined && folder !== undefined && folderOf(outputFile) === folder ? note : rest)
  }

  return found
}

/** The background task id of a shell result that moved to the background. */
export const backgroundIdOf = (result: unknown): string | undefined => {
  const id = typeof result === 'object' && result !== null ? (result as { backgroundTaskId?: unknown }).backgroundTaskId : undefined

  return typeof id === 'string' && id !== '' ? id : undefined
}
