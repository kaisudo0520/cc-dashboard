// Looking at a shell command (bash or PowerShell) for the commands it runs, as
// text and without running anything. `maskShell` blanks what is not code: quoted
// strings, comments, heredoc bodies and PowerShell here-strings, so a word in
// them cannot pass for a command (it keeps the length and the line ends of
// code, and keeps `$( … )` inside double quotes, which does run).
// `commandAfter` then walks the code's command positions. Both read the text in
// one pass, so a command built to be slow is not slower than a plain one.

export type Shell = 'bash' | 'powershell'

type Frame = { kind: 'dq'; start: number } | { kind: 'sub'; depth: number }
type DoubleQuote = Extract<Frame, { kind: 'dq' }>

// The state of one pass over a text. `out` is the text as it is masked so far.
type Scan = {
  text: string
  out: string[]
  shell: Shell
  esc: string
  /** The text was cut short: whatever is open at its end goes on past it, and stays masked. */
  isCut: boolean
  stack: Frame[]
  heredocs: { id: string; hasTabs: boolean }[]
  hasNoSingle: boolean
  /** Closers (`))`, `]`) already searched for to the end of the text without finding one: not searched for again. */
  unclosed: Set<string>
  i: number
}

const CODEX_NAME = /^codex(?:\.cmd|\.exe)?$/i
const HEREDOC = /<<(-?)[ \t]*/y
// What ends a bare heredoc delimiter.
const WORD_END = /[\s;&|()<>`]/

/** The last part of a path, in either slash, without a `@version`. */
const baseName = (word: string): string => {
  const name = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1)
  const version = name.indexOf('@')

  return version < 0 ? name : name.slice(0, version)
}

/** Whether the word names the `codex` program: `codex`, `codex.cmd`, `C:\tools\codex.exe`, `@openai/codex@latest`. */
const isCodex = (word: string): boolean => CODEX_NAME.test(baseName(word))

const blank = (s: Scan, from: number, to: number): void => {
  for (let k = from; k < Math.min(to, s.text.length); k++) s.out[k] = ' '
}

// A quoted path to codex stays readable as a word, so `& "C:\tools\codex.exe" exec` still reads as one.
const keepName = (s: Scan, from: number, to: number): void => {
  const inside = s.text.slice(from + 1, to - 1)

  if (!inside.includes('$(') && isCodex(inside)) [...'codex'].forEach((letter, k) => (s.out[from + 1 + k] = letter))
}

const lineEnd = (s: Scan, from: number): number => {
  const found = s.text.indexOf('\n', from)

  return found < 0 ? s.text.length : found
}

// --- Heredocs ---------------------------------------------------------------------------

// Where one heredoc's body ends: the end of its terminator line, or of the text.
const bodyEnd = (s: Scan, from: number, { id, hasTabs }: Scan['heredocs'][number]): number => {
  for (let start = from; start < s.text.length; ) {
    const end = lineEnd(s, start)
    const line = s.text.slice(start, end).replace(/\r$/, '')

    if ((hasTabs ? line.replace(/^\t+/, '') : line) === id) return end
    start = end + 1
  }

  return s.text.length
}

// The bodies of the heredocs opened on the line that ends at `at` are blanked. Answers where the last
// one ends: the line end after it, which is an ordinary one.
const skipHeredocs = (s: Scan, at: number): number => {
  let last = at

  for (const heredoc of s.heredocs.splice(0)) last = bodyEnd(s, last + 1, heredoc)
  blank(s, at + 1, last)

  return last
}

// The delimiter word at `from`, by bash's rule: the text with its quotes and backslashes taken out, compared as it is.
// A bare word starts with a letter or underscore and holds letters, digits, `_`, `.` and `-`; a word that starts
// with a quote or a backslash may hold anything the quote allows. Undefined when what follows `<<` is no such word
// (`<<2`, `<<=`, `<<$x`): a shift, not a heredoc.
const delimiterAt = (s: Scan, from: number): { id: string; end: number } | undefined => {
  const { text } = s
  if (!/[A-Za-z_'"\\]/.test(text[from] ?? '')) return undefined

  let id = ''
  let at = from
  while (at < text.length && !WORD_END.test(text[at] ?? '')) {
    const c = text[at] ?? ''
    const close = c === "'" || c === '"' ? text.indexOf(c, at + 1) : -1

    if (c === "'" || c === '"') {
      if (close < 0 || text.slice(at, close).includes('\n')) return undefined
      id += text.slice(at + 1, close)
      at = close + 1
    } else if (c === '\\') {
      id += text[at + 1] ?? ''
      at += 2
    } else if (/[\w.-]/.test(c)) {
      id += c
      at += 1
    } else {
      break
    }
  }

  return { id, end: at }
}

const openHeredoc = (s: Scan): boolean => {
  const { text, i } = s
  if (s.shell !== 'bash' || text[i] !== '<' || text[i + 1] !== '<' || text[i - 1] === '<' || text[i + 2] === '<') return false

  HEREDOC.lastIndex = i
  const lead = HEREDOC.exec(text)
  const word = lead === null ? undefined : delimiterAt(s, i + lead[0].length)

  if (word !== undefined) s.heredocs.push({ id: word.id, hasTabs: lead?.[1] === '-' })
  s.i = word === undefined ? i + 2 : word.end

  return true
}

// --- Other things that are not code -----------------------------------------------------

// A PowerShell here-string (`@'` or `@"` ending the line) runs to a line that starts with the same quote and `@`.
const skipHereString = (s: Scan): boolean => {
  const { text, i } = s
  const quote = text[i + 1]
  if (s.shell !== 'powershell' || text[i] !== '@' || (quote !== "'" && quote !== '"') || !/^\r?\n/.test(text.slice(i + 2, i + 4))) return false

  const close = text.indexOf(`\n${quote}@`, i + 2)
  const end = close < 0 ? text.length : close + 3

  blank(s, i, end)
  s.i = end

  return true
}

// A `#` that starts a word comments out the rest of the line; PowerShell also has `<# … #>`.
const skipComment = (s: Scan): boolean => {
  const { text, i } = s

  if (s.shell === 'powershell' && text[i] === '<' && text[i + 1] === '#') {
    const close = text.indexOf('#>', i + 2)
    const end = close < 0 ? text.length : close + 2

    blank(s, i, end)
    s.i = end

    return true
  }
  if (text[i] !== '#' || !(i === 0 || /[ \t\n;&|(]/.test(text[i - 1] ?? ''))) return false

  const end = lineEnd(s, i)
  blank(s, i, end)
  s.i = end

  return true
}

// Arithmetic: `$(( … ))`, `$[ … ]`, and `(( … ))` at the start of a command. A `<<` in it is a shift, not a heredoc.
const arithmeticAt = (s: Scan): { closer: string; length: number } | undefined => {
  const { text, i } = s
  if (s.shell !== 'bash') return undefined
  if (text.startsWith('$((', i)) return { closer: '))', length: 3 }
  if (text.startsWith('$[', i)) return { closer: ']', length: 2 }
  if (!text.startsWith('((', i)) return undefined

  let before = i - 1
  while (text[before] === ' ' || text[before] === '\t') before -= 1

  return before < 0 || /[\n;&|({`]/.test(text[before] ?? '') ? { closer: '))', length: 2 } : undefined
}

// Where the closer is, searched for to the end of the text only once if there is none.
const closerAt = (s: Scan, closer: string, from: number): number => {
  if (s.unclosed.has(closer)) return -1

  const close = s.text.indexOf(closer, from)
  if (close < 0) s.unclosed.add(closer)

  return close
}

const skipArithmetic = (s: Scan): boolean => {
  const open = arithmeticAt(s)
  if (open === undefined) return false

  const close = closerAt(s, open.closer, s.i + open.length)
  s.i = close < 0 ? s.i + open.length : close + open.closer.length

  return true
}

// Inside a double quote the same arithmetic is data: blanked to its closer, and not taken for a substitution.
const skipQuotedArithmetic = (s: Scan): boolean => {
  const open = s.text[s.i] === '$' ? arithmeticAt(s) : undefined
  if (open === undefined) return false

  const close = closerAt(s, open.closer, s.i + open.length)
  if (close < 0) return false

  blank(s, s.i, close + open.closer.length)
  s.i = close + open.closer.length

  return true
}

const skipSingleQuote = (s: Scan): boolean => {
  if (s.text[s.i] !== "'" || s.hasNoSingle) return false

  const close = s.text.indexOf("'", s.i + 1)
  if (close < 0) {
    // Never closed: only a quote mark, unless the text was cut and the string went on.
    s.hasNoSingle = true
    if (s.isCut) blank(s, s.i, s.text.length)
    s.i = s.isCut ? s.text.length : s.i + 1

    return true
  }
  blank(s, s.i, close + 1)
  keepName(s, s.i, close + 1)
  s.i = close + 1

  return true
}

// --- The two states a character can be read in -----------------------------------------

const stepDoubleQuote = (s: Scan, frame: DoubleQuote): void => {
  const { text, i } = s
  if (skipQuotedArithmetic(s)) return

  if (text[i] === s.esc && i + 1 < text.length) {
    blank(s, i, i + 2)
    s.i += 2
  } else if (text[i] === '"') {
    s.out[i] = ' '
    keepName(s, frame.start, i + 1)
    s.stack.pop()
    s.i += 1
  } else if (text[i] === '$' && text[i + 1] === '(') {
    // A substitution inside a string runs: its text is code again, up to the matching parenthesis.
    s.out[i] = ' '
    s.stack.push({ kind: 'sub', depth: 1 })
    s.i += 2
  } else {
    s.out[i] = ' '
    s.i += 1
  }
}

// The end of a substitution's parenthesis closes it, and the string it sat in carries on.
const trackSub = (s: Scan, frame: Frame | undefined): void => {
  if (frame?.kind !== 'sub') return
  if (s.text[s.i] === '(') frame.depth += 1
  if (s.text[s.i] === ')') frame.depth -= 1
  if (frame.depth === 0) s.stack.pop()
}

// The characters that can start something that is not plain code (or close a substitution); any other is passed over.
const SPECIAL = new Set(['\\', '`', '"', "'", '\n', '#', '$', '<', '@', '(', ')'])

const stepCode = (s: Scan, frame: Frame | undefined): void => {
  const { text, i } = s

  if (!SPECIAL.has(text[i] ?? '')) {
    s.i += 1
  } else if (text[i] === s.esc && i + 1 < text.length) {
    blank(s, i, i + 2)
    s.i += 2
  } else if (text[i] === '"') {
    s.stack.push({ kind: 'dq', start: i })
    s.out[i] = ' '
    s.i += 1
  } else if (text[i] === '\n' && s.heredocs.length > 0) {
    s.i = skipHeredocs(s, i)
  } else if (!(skipComment(s) || skipSingleQuote(s) || skipArithmetic(s) || openHeredoc(s) || skipHereString(s))) {
    trackSub(s, frame)
    s.i += 1
  }
}

/**
 * The same text with everything that is not code blanked to spaces (see the top).
 * `shell` decides the escape character and which constructs exist; `isCut` says
 * the text is the front of a longer one, so a string still open at its end is
 * masked to the end rather than taken for a stray quote mark.
 */
export const maskShell = (text: string, shell: Shell, isCut = false): string => {
  const s: Scan = {
    text,
    out: text.split(''),
    shell,
    esc: shell === 'powershell' ? '`' : '\\',
    isCut,
    stack: [],
    heredocs: [],
    hasNoSingle: false,
    unclosed: new Set(),
    i: 0,
  }

  while (s.i < text.length) {
    const frame = s.stack[s.stack.length - 1]

    if (frame?.kind === 'dq') stepDoubleQuote(s, frame)
    else stepCode(s, frame)
  }

  // A double quote that was never closed was only a quote mark, unless the text was cut.
  const open = s.stack.find(frame => frame.kind === 'dq')
  if (open?.kind === 'dq' && !isCut) for (let k = open.start; k < text.length; k++) s.out[k] = text[k] ?? ' '

  return s.out.join('')
}

// --- Finding the command ----------------------------------------------------------------

// What ends a word: a blank, a separator, a bracket or a redirect.
const BREAKS = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '{', '}', '<', '>', '`'])
// Words that run the command that follows; `env`, `timeout` and `npx` have flags of their own, and some take a value.
const LEADING = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'time', 'nohup', 'command', 'env', 'timeout', 'npx'])
// The flags of each wrapper that take a value (`timeout -s KILL`, `env -u FOO`, `npx -p pkg`); a flag of
// another wrapper with the same letters takes none (`npx -s` is `--silent`).
const FLAGS_WITH_VALUE: Readonly<Record<string, ReadonlySet<string>>> = {
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  npx: new Set(['-p', '--package', '-c', '--call']),
}
const MAX_PREFIXES = 12

const isSeparator = (c: string | undefined): boolean => c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === '{' || c === '`'

const wordAt = (code: string, from: number): { word: string; end: number } | undefined => {
  let start = from
  while (code[start] === ' ' || code[start] === '\t') start += 1

  let end = start
  while (end < code.length && !BREAKS.has(code[end] ?? '')) end += 1

  return end === start ? undefined : { word: code.slice(start, end), end }
}

// A word that may stand between the start of a command and `codex`: an assignment (`A=1`), or, after
// `env`/`timeout`/`npx`, a flag or a duration.
const isPrefix = (word: string, wrapper: string | undefined): boolean =>
  /^[A-Za-z_]\w*=/.test(word) || (wrapper !== undefined && /^(?:-.*|\d+(?:\.\d+)?[smhd]?)$/.test(word))

// Where `codex exec` ends if a command that starts at `from` is one; else -1.
// The word `exec` has to follow `codex` on the same line.
const execEndFrom = (code: string, from: number): number => {
  let at = from
  let wrapper: string | undefined
  let isValue = false

  for (let step = 0; step < MAX_PREFIXES; step++) {
    const next = wordAt(code, at)
    if (next === undefined) return -1

    at = next.end
    if (isValue) {
      isValue = false
    } else if (isCodex(next.word)) {
      const after = wordAt(code, at)

      return after?.word === 'exec' ? after.end : -1
    } else if (LEADING.has(next.word)) {
      wrapper = next.word in FLAGS_WITH_VALUE ? next.word : wrapper
    } else if (isPrefix(next.word, wrapper)) {
      isValue = wrapper !== undefined && FLAGS_WITH_VALUE[wrapper]?.has(next.word) === true
    } else {
      return -1
    }
  }

  return -1
}

/**
 * Where the `exec` of a `codex exec` command ends in masked code, or -1. A
 * command starts at the beginning, and after a line end, `;`, `&`, `|`, `(`,
 * `{` or a backtick.
 */
export const commandAfter = (code: string): number => {
  // Only a command with the word `codex` in it can be the one, so each command that has one is tried, once.
  let start = 0
  let tried = -1

  for (let i = 0; i < code.length; i++) {
    if (isSeparator(code[i])) {
      start = i + 1
    } else if (start !== tried && (code.charCodeAt(i) | 32) === 99 && code.slice(i, i + 5).toLowerCase() === 'codex') {
      tried = start

      const end = execEndFrom(code, start)
      if (end >= 0) return end
    }
  }

  return -1
}

/** Where the arguments of the command whose `exec` ended at `from` stop: at the next `;`, `|`, `&` (not in `2>&1`) or line end. */
export const argumentsEnd = (code: string, from: number): number => {
  const stop = code.slice(from).search(/(?<![<>])&|[;|\n]/)

  return stop < 0 ? code.length : from + stop
}
