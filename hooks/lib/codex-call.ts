import type { ToolCallResult } from 'claude-code'

import { sessionIdFrom } from './codex'
import { backgroundIdOf } from './notify'
import type { DashEvent } from './state'

// What a finished Bash/PowerShell call tells about the `codex exec` run it
// launched. Plain data in, the dashboard event out; the hooks do the dispatching.

const rec = (v: unknown): Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null ? (v as Readonly<Record<string, unknown>>) : {}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Where a foreground run prints its session id: its stderr header, else anywhere in what the model reads. */
const sessionOfResult = (res: ToolCallResult): string | undefined => {
  const out = rec(res.result)

  return sessionIdFrom(str(out.stderr), str(out.stdout), res.text)
}

/**
 * The event the call's result stands for, once the clock has stamped it: the
 * run moved to the background, or it is over (failed on a deny or an error result).
 */
export const callEnd = (toolUseId: string, res: ToolCallResult): ((at: number) => DashEvent) => {
  const backgroundId = res.deny === undefined ? backgroundIdOf(res.result) : undefined
  if (backgroundId !== undefined) return () => ({ type: 'codex-background', toolUseId, backgroundId })

  const ok = res.deny === undefined && res.isError !== true
  const sessionId = sessionOfResult(res)

  return at => ({ type: 'codex-end', at, id: toolUseId, ok, ...(sessionId === undefined ? {} : { sessionId }) })
}
