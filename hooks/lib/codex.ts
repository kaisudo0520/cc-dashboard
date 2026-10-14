// Reading a `codex exec` call: what the shell command says it is for and which
// Codex session it talks to. Plain text in, plain data out; the hooks do the I/O.

import { argumentsEnd, commandAfter, maskShell } from './shell-mask'
import type { Shell } from './shell-mask'

/** What a shell command that runs `codex exec` tells about the run. */
export type CodexCall = { purpose: string; note?: string; sessionId?: string }

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const UUID_RE = new RegExp(UUID)
const SESSION_LINE = new RegExp(`session id:\\s*(${UUID})`, 'i')

// `codex exec` counts only in command position (see ./shell-mask): in the code of
// the command, with quoted strings, comments and heredoc bodies taken out, so
// `echo note: codex exec`, `echo "codex exec"` and a script written by
// `cat <<'EOF'` are not runs. Only the first 64 KB of a call is read (the masking
// is one pass: 100 KB take about 20 ms); a string still open at that cut is masked on.
const MAX_CHARS = 65_536
// The flag is found in the code, where a quoted prompt cannot hold one; its value is read from the text as written.
const SANDBOX_FLAG = /(?<![\w-])(?:--sandbox|-s)(?:=|[ \t])/
const FLAG_VALUE = /^(?:[ \t]|\\\r?\n)*(?:"([^"]*)"|'([^']*)'|(\S+))/

/** `codex exec` flags that take the next word as their value. */
const VALUE_FLAGS = new Set([
  '-m', '--model', '-s', '--sandbox', '-c', '--config', '-C', '--cd', '-p', '--profile',
  '-o', '--output-last-message', '-i', '--image', '--color', '--output-schema',
])

const SANDBOX_PURPOSE: Readonly<Record<string, string>> = {
  'read-only': 'Codex 規劃草稿',
  'workspace-write': 'Codex 審查',
}
const RESUME_PURPOSE = 'Codex 續談'
const PLAIN_PURPOSE = 'Codex'

/** How much of a text is searched for the session line: codex prints it in its header. Nothing more of an output file is kept. */
export const HEAD_CHARS = 8192

// The sandbox the run asks for: `--sandbox=X`, `--sandbox X` or `-s X`, the flag as the code has it, the value as written.
const sandboxOf = (maskedArgs: string, args: string): string | undefined => {
  const flag = SANDBOX_FLAG.exec(maskedArgs)
  if (flag === null) return undefined

  const value = FLAG_VALUE.exec(args.slice(flag.index + flag[0].length))

  return value?.[1] ?? value?.[2] ?? value?.[3]
}

// The words after `resume` when it is the subcommand: the first word that is
// not a flag (or a flag's value). A `resume` further on is part of a prompt.
const resumeArgs = (args: string): string | undefined => {
  const words = args.trim().split(/\s+/)
  let i = 0

  while (words[i]?.startsWith('-') === true) i += VALUE_FLAGS.has(words[i] ?? '') ? 2 : 1

  return words[i] === 'resume' ? words.slice(i + 1).join(' ') : undefined
}

/**
 * The call as Codex run, or undefined when the command does not run `codex exec`.
 * The flags read are those of that command alone, up to the next `;`, `|` or `&`.
 */
export const describeCodex = (call: string, description?: string, shell: Shell = 'bash'): CodexCall | undefined => {
  const command = call.slice(0, MAX_CHARS)
  if (!/codex/i.test(command)) return undefined

  const code = maskShell(command, shell, call.length > MAX_CHARS)
  const execEnd = commandAfter(code)
  if (execEnd < 0) return undefined

  const argsEnd = argumentsEnd(code, execEnd)
  const args = command.slice(execEnd, argsEnd)
  const note = description === undefined || description === '' ? {} : { note: description }
  const resume = resumeArgs(args)
  if (resume !== undefined) {
    const sessionId = UUID_RE.exec(resume)?.[0]

    return { purpose: RESUME_PURPOSE, ...note, ...(sessionId === undefined ? {} : { sessionId }) }
  }

  const sandbox = sandboxOf(code.slice(execEnd, argsEnd), args)

  return { purpose: SANDBOX_PURPOSE[sandbox ?? ''] ?? PLAIN_PURPOSE, ...note }
}

/** The Codex session id from the first of `texts` that has a `session id:` line in its head. */
export const sessionIdFrom = (...texts: readonly (string | undefined)[]): string | undefined => {
  for (const text of texts) {
    const id = SESSION_LINE.exec((text ?? '').slice(0, HEAD_CHARS))?.[1]
    if (id !== undefined) return id
  }

  return undefined
}
