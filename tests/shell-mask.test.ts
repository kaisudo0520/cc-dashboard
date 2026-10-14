import { expect, test } from 'claude-code/testing'

import { argumentsEnd, commandAfter, maskShell } from '../hooks/lib/shell-mask'
import type { Shell } from '../hooks/lib/shell-mask'

const BS = String.fromCharCode(92)
const spaces = (n: number): string => ' '.repeat(n)

// --- What is masked -------------------------------------------------------------------------

test('the mask keeps the length and the code, and blanks a single-quoted string with its quotes', async () => {
  const masked = maskShell("echo 'a b' c", 'bash')

  expect(masked).toBe(`echo ${spaces(5)} c`)
  expect(masked).toHaveLength("echo 'a b' c".length)
})

test('a double-quoted string is blanked, but a substitution inside it is code again', async () => {
  expect(maskShell('echo "codex exec"', 'bash')).toBe(`echo ${spaces(12)}`)

  const masked = maskShell('echo "x $(date -u) y"', 'bash')
  expect(masked).toContain('(date -u)')
  expect(masked).not.toContain('x')
  expect(masked).not.toContain('y')
  expect(masked).toHaveLength('echo "x $(date -u) y"'.length)
})

test('a substitution inside a string may hold strings of its own', async () => {
  const masked = maskShell('echo "a $(echo "codex" \'b\') c"', 'bash')

  expect(masked).toContain('(echo')
  expect(masked).not.toContain('a ')
  expect(masked).not.toContain('b')
})

test('an escaped quote does not open a string; in PowerShell the escape is the backtick, not the backslash', async () => {
  expect(maskShell(`echo ${BS}"; codex exec -`, 'bash')).toContain('; codex exec -')
  expect(maskShell('echo "a`"b" ; codex exec -', 'powershell')).toContain('; codex exec -')
  // A backslash before the closing quote is a path in PowerShell and an escape in bash (where the string goes on).
  expect(maskShell(`cd "C:${BS}w${BS}"; codex exec -`, 'powershell')).toContain('; codex exec -')
  expect(maskShell(`cd "C:${BS}w${BS}"; codex exec -"`, 'bash')).not.toContain('codex')
})

test('a comment is blanked to the end of its line, but a # inside a word is not a comment', async () => {
  expect(maskShell('ls # codex exec\nls', 'bash')).toBe(`ls ${spaces(12)}\nls`)
  expect(maskShell('echo a#b; codex exec -', 'bash')).toContain('codex exec -')
  expect(maskShell('echo ${#arr[@]}; codex exec -', 'bash')).toContain('codex exec -')
})

test('a heredoc body is blanked up to its terminator line, and the line end after it stays', async () => {
  const masked = maskShell("cat <<'EOF'\ncodex exec x\nmore\nEOF\nls", 'bash')

  // "codex exec x", "more" and "EOF" with the line ends between them: 12 + 1 + 4 + 1 + 3 blanks.
  expect(masked).toBe(`cat <<'EOF'\n${spaces(21)}\nls`)
})

test('heredoc delimiters: with a tab dash, quoted with a dash or a space, bare with a dot; several on one line', async () => {
  expect(maskShell('cat <<-END\n\tcodex\n\tEND\nls', 'bash')).not.toContain('codex')
  expect(maskShell("cat <<'END-OF-BRIEF'\ncodex\nEND-OF-BRIEF\nls", 'bash')).toBe(`cat <<'END-OF-BRIEF'\n${spaces(5)} ${spaces(12)}\nls`)
  expect(maskShell('cat <<"A B"\ncodex\nA B\nls', 'bash')).not.toContain('codex')
  expect(maskShell('cat <<EOF.md\ncodex\nEOF.md\nls', 'bash')).not.toContain('codex')
  expect(maskShell('cat <<A <<B\none codex\nA\ntwo codex\nB\nls', 'bash')).not.toContain('codex')
  expect(maskShell('cat <<A <<B\none\nA\ntwo\nB\nls', 'bash')).toMatch(/\nls$/)
})

test('an unterminated heredoc is masked to the end; <<< and a shift in $(( )) are not heredocs', async () => {
  expect(maskShell('cat <<EOF\ncodex exec never closed', 'bash')).not.toContain('codex')
  expect(maskShell('cat <<< "x"\ncodex exec -', 'bash')).toContain('codex exec -')
  expect(maskShell('echo $((1<<EOF))\ncodex exec -', 'bash')).toContain('codex exec -')
})

test('PowerShell has here-strings (quotes may sit inside them) and <# #> comments; bash has neither', async () => {
  const hereString = "$p = @'\ncodex it's\n'@\nls"

  expect(maskShell(hereString, 'powershell')).toBe(`$p = ${spaces(16)}\nls`)
  expect(maskShell("$p = @'\r\ncodex\r\n'@\r\nls", 'powershell')).not.toContain('codex')
  // In bash it is an ordinary quote: the apostrophe in "it's" is not hidden by a here-string.
  expect(maskShell(hereString, 'bash')).toContain("s\n'@")
  expect(maskShell('<# codex #>\nls', 'powershell')).toBe(`${spaces(11)}\nls`)
  expect(maskShell('<#\ncodex\n#>\nls', 'powershell')).not.toContain('codex')
  expect(maskShell('<# codex never closed', 'powershell')).not.toContain('codex')
  expect(maskShell('<# codex #>\nls', 'bash')).toContain('codex')
})

test('a quote that was never closed is a stray mark, unless the text was cut: then it goes on past the cut', async () => {
  expect(maskShell('echo it\'s; codex exec -', 'bash')).toContain('; codex exec -')
  expect(maskShell('echo "never; codex exec -', 'bash')).toContain('codex exec -')
  expect(maskShell("echo 'never; codex exec -", 'bash', true)).not.toContain('codex')
  expect(maskShell('echo "never; codex exec -', 'bash', true)).not.toContain('codex')
  expect(maskShell('echo "a $(echo codex', 'bash', true)).not.toContain('a ')
})

test('a quoted path to codex stays readable as a word', async () => {
  const masked = maskShell('& "C:\\tools\\codex.exe" exec -', 'powershell')

  expect(masked).toContain('codex')
  expect(commandAfter(masked)).toBeGreaterThan(0)
  expect(maskShell('echo "no codex here"', 'bash')).not.toContain('codex')
})

// --- Where a command starts -------------------------------------------------------------------

test('commandAfter finds codex exec at the start and after a separator, and answers where exec ends', async () => {
  expect(commandAfter('codex exec -')).toBe('codex exec'.length)
  expect(commandAfter('ls; codex exec -')).toBe('ls; codex exec'.length)
  expect(commandAfter('ls\ncodex exec -')).toBe('ls\ncodex exec'.length)
  expect(commandAfter('a && b || codex exec')).toBe('a && b || codex exec'.length)
  expect(commandAfter('x | codex exec')).toBeGreaterThan(0)
  expect(commandAfter('{ codex exec; }')).toBeGreaterThan(0)
  expect(commandAfter('(codex exec)')).toBeGreaterThan(0)
  expect(commandAfter('`codex exec`')).toBeGreaterThan(0)
})

test('commandAfter does not find it after other words, or with a line end between codex and exec', async () => {
  expect(commandAfter('echo codex exec')).toBe(-1)
  expect(commandAfter('codex\nexec')).toBe(-1)
  expect(commandAfter('codex execute')).toBe(-1)
  expect(commandAfter('codex')).toBe(-1)
  expect(commandAfter('')).toBe(-1)
  expect(commandAfter('xargs codex exec')).toBe(-1)
})

test('prefixes: if/while/until/then/do/else, time, nohup, assignments, env, timeout and npx with their flags', async () => {
  for (const command of [
    'if codex exec -; then :; fi',
    'while codex exec -; do :; done',
    'until codex exec -; do :; done',
    'if a; then codex exec -; fi',
    'for f in a; do codex exec -; done',
    'if a; then b; else codex exec -; fi',
    'time codex exec -',
    'nohup codex exec -',
    'A=1 B=2 codex exec -',
    'env A=1 codex exec -',
    'env -u FOO codex exec -',
    'env -i A=1 codex exec -',
    'timeout 600 codex exec -',
    'timeout -s KILL 10m codex exec -',
    'timeout -k 5 10m codex exec -',
    'timeout --foreground 10m codex exec -',
    'npx codex exec -',
    'npx -y @openai/codex@latest exec -',
    'npx --package @openai/codex codex exec -',
    '~/bin/codex exec -',
    'C:/x/codex.exe exec -',
  ]) {
    expect(`${command}: ${commandAfter(command) > 0}`).toBe(`${command}: true`)
  }
})

test('argumentsEnd stops at the next separator, but not at the & of a redirect', async () => {
  expect(argumentsEnd('codex exec -s x; ls', 'codex exec'.length)).toBe('codex exec -s x'.length)
  expect(argumentsEnd('codex exec - | tee', 'codex exec'.length)).toBe('codex exec -'.length + 1)
  expect(argumentsEnd('codex exec - 2>&1 | tee', 'codex exec'.length)).toBe('codex exec - 2>&1'.length + 1)
  expect(argumentsEnd('codex exec - >& log', 'codex exec'.length)).toBe('codex exec - >& log'.length)
  expect(argumentsEnd('codex exec -\nls', 'codex exec'.length)).toBe('codex exec -'.length)
})

// --- Heredoc delimiters, by bash's rule ---------------------------------------------------------

const seen = (command: string, shell: Shell = 'bash'): boolean => commandAfter(maskShell(command, shell)) > 0
const AFTER = '\ncodex exec -s read-only -'

test('a delimiter with any part quoted or backslash-escaped is compared with the quotes and backslashes taken out', async () => {
  for (const header of [`<<${BS}EOF`, '<<E"OF"', "<<'EOF'", '<<"EOF"', `<<E${BS}OF`, "<<'E'OF", `<<-${BS}EOF`]) {
    const command = `cat > b.md ${header}\nnotes codex exec\nEOF${AFTER} < b.md`

    expect(`${header}: ${maskShell(command, 'bash').includes('notes')}`).toBe(`${header}: false`)
    expect(`${header}: ${seen(command)}`).toBe(`${header}: true`)
  }
})

test('a quoted delimiter runs to its closing quote; a bare one is letters, digits, underscore, dot and dash', async () => {
  expect(seen(`cat <<'END-OF-BRIEF'\nx\nEND-OF-BRIEF${AFTER}`)).toBe(true)
  expect(seen(`cat <<"A B"\nx\nA B${AFTER}`)).toBe(true)
  expect(seen(`cat <<EOF.md\nx\nEOF.md${AFTER}`)).toBe(true)
  expect(seen(`cat <<END-BRIEF_2\nx\nEND-BRIEF_2${AFTER}`)).toBe(true)
  expect(maskShell('cat <<EOF.md\nnotes\nEOF.md', 'bash')).not.toContain('notes')
})

test('a heredoc opened inside backticks or a substitution is closed all the same', async () => {
  expect(seen(`\`cat <<EOF\`\nx\nEOF${AFTER}`)).toBe(true)
  expect(maskShell('`cat <<EOF`\nnotes\nEOF', 'bash')).not.toContain('notes')
  expect(seen(`x="$(cat <<EOF\ncodex exec\nEOF\n)"${AFTER}`)).toBe(true)
})

// --- A shift is arithmetic, not a heredoc -----------------------------------------------------

test('<< followed by a digit, an = or a symbol is not a heredoc: the next line is still read', async () => {
  for (const command of [
    'echo "$((1<<2))"',
    'echo "$((1<<x))"',
    '(( n = 1<<2 ))',
    '(( n <<= 1 ))',
    '((n=1<<2))',
    'echo $[1<<2]',
    'echo $[1<<x]',
    'let x=1<<2',
    'echo $((1<<2))',
    'x=$((1<<EOF))',
    'echo a <<2',
    'echo a <<=',
  ]) {
    expect(`${command}: ${seen(`${command}${AFTER}`)}`).toBe(`${command}: true`)
  }
})

test('(( at the start of a command skips to the )) that closes it, wherever the line ends fall', async () => {
  expect(seen('x=1; (( n = 1 <<\n2 ))' + AFTER)).toBe(true)
  // Never closed: a subshell, not arithmetic.
  expect(maskShell('((a; codex exec -', 'bash')).toContain('codex exec -')
})

// --- Flags that take a value belong to their own wrapper ----------------------------------------

test('each wrapper has its own value flags: npx -s is a flag with no value, timeout -s takes one', async () => {
  expect(seen('npx -s @openai/codex exec -')).toBe(true)
  expect(seen('npx --silent @openai/codex exec -')).toBe(true)
  expect(seen('npx -p @openai/codex codex exec -')).toBe(true)
  expect(seen('timeout -s KILL 10m codex exec -')).toBe(true)
  expect(seen('timeout -k 5 10m codex exec -')).toBe(true)
  expect(seen('env -u FOO -C /tmp codex exec -')).toBe(true)
  // A value is not the program: these name `codex` as a value, and nothing runs it.
  expect(seen('npx -p codex exec')).toBe(false)
  expect(seen('env -u codex exec')).toBe(false)
  expect(seen('timeout -s codex exec')).toBe(false)
})

// --- Time -------------------------------------------------------------------------------------

// Texts built to be slow for a reader, every one of them with codex in it, at a size the caller picks.
/** `unit` repeated to fill `size` characters, with a real `codex exec` at the end. */
const fill = (size: number, unit: string, head = ''): string =>
  `${head}${unit.repeat(Math.floor((size - head.length - 11) / unit.length))} codex exec`

const adversarial = (size: number): [string, string][] => [
  ['quotes around codex', fill(size, '"codex exec ')],
  ['substitutions in quotes', fill(size, '"$(codex ')],
  ['heredoc headers with codex', fill(size, '<<A codex ')],
  ['heredoc never closed', fill(size, 'codex exec\n', 'cat <<EOF\n')],
  ['here-strings with codex', fill(size, "@'\ncodex\n")],
  ['single quotes', fill(size, "'codex ")],
  ['comments', fill(size, '# codex exec\n')],
  ['block comments', fill(size, '<# codex ')],
  ['env chain to codex', fill(size, 'A=1 ')],
  ['wrapper flags to codex', fill(size, ' --a', 'npx')],
  ['timeout values', fill(size, ' -s X', 'timeout')],
  ['separators then codex', fill(size, ';')],
  ['spaces then codex', fill(size, ' ', ';')],
  ['escaped quotes', fill(size, `"${BS}`)],
  ['arithmetic never closed', fill(size, '$((')],
  ['brackets never closed', fill(size, '$[')],
  ['command-start arithmetic never closed', fill(size, '((;')],
  ['near-misses', fill(size, 'A=1 codex ')],
  ['codex words', fill(size, 'codex ')],
]

/** The best of five runs, in ms: a busy machine slows some runs, not all. */
const timeOf = (command: string, shell: Shell): number =>
  Math.min(
    ...[1, 2, 3, 4, 5].map(() => {
      const started = performance.now()
      commandAfter(maskShell(command, shell))

      return performance.now() - started
    }),
  )

const N = 100_000
// Below this a time is noise, and a ratio of two noises means nothing.
const FLOOR_MS = 5

// A test for each shell and each half of the inputs, so that each stays well inside the time a test is given.
for (const shell of ['bash', 'powershell'] as Shell[]) {
  for (const half of [0, 1]) {
    test(`${shell} (part ${half + 1} of 2): four times the text takes under eight times as long to mask and search; no input makes the reader quadratic`, async () => {
      // The first calls of a process run cold; the time that counts is the one of a warm reader.
      commandAfter(maskShell(adversarial(8_000).map(([, c]) => c).join('\n'), shell))

      const large = adversarial(4 * N)

      adversarial(N).forEach(([label, command], i) => {
        if (i % 2 !== half) return

        const ratio = Math.max(timeOf(large[i]?.[1] ?? '', shell), FLOOR_MS) / Math.max(timeOf(command, shell), FLOOR_MS)

        expect(`${label}: ${command.length >= 0.9 * N}`).toBe(`${label}: true`)
        expect(`${label}: ${ratio < 8}`).toBe(`${label}: true`)
      })
    })
  }
}
