import { expect, test } from 'claude-code/testing'

import { describeCodex } from '../hooks/lib/codex'

const ID = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6071'

test('codex exec read-only is a planning draft, and the call description rides along as a note', async () => {
  expect(
    describeCodex('codex exec --sandbox read-only -m gpt-6-sol -C "$(pwd)" - < brief.md', '草擬規劃'),
  ).toEqual({ purpose: 'Codex 規劃草稿', note: '草擬規劃' })
})

test('codex exec workspace-write is a review; --sandbox= and -s forms are read too', async () => {
  expect(describeCodex('codex exec --sandbox=workspace-write - < r.md')).toEqual({ purpose: 'Codex 審查' })
  expect(describeCodex('codex exec -s workspace-write - < r.md')?.purpose).toBe('Codex 審查')
  expect(describeCodex('codex exec -s "read-only" - < r.md')?.purpose).toBe('Codex 規劃草稿')
})

test('a codex exec with no sandbox flag is plain Codex', async () => {
  expect(describeCodex('codex exec - < x.md')).toEqual({ purpose: 'Codex' })
})

test('only the flags after codex exec decide the purpose, not an earlier -s', async () => {
  expect(describeCodex('git status -s && codex exec - < x')?.purpose).toBe('Codex')
})

test('a command that does not run codex exec is not Codex', async () => {
  expect(describeCodex('codex --version')).toBeUndefined()
  expect(describeCodex('ls')).toBeUndefined()
})

test('codex found after cd, a pipe or as codex.cmd', async () => {
  expect(describeCodex('cd repo && codex exec - < x')?.purpose).toBe('Codex')
  expect(describeCodex('codex.cmd exec - < x')?.purpose).toBe('Codex')
  expect(describeCodex('codex.exe exec --sandbox read-only -')?.purpose).toBe('Codex 規劃草稿')
})

test('codex exec counts only in command position: at the start, or after ; && || | ( or &', async () => {
  expect(describeCodex('  codex exec - < x')?.purpose).toBe('Codex')
  expect(describeCodex('cd repo; codex exec - < x')?.purpose).toBe('Codex')
  expect(describeCodex('make || codex exec - < x')?.purpose).toBe('Codex')
  expect(describeCodex('cat brief.md | codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('(codex exec -)')?.purpose).toBe('Codex')
  expect(describeCodex('& codex.exe exec --sandbox read-only -')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('cd repo && & codex exec -')?.purpose).toBe('Codex')
})

test('env assignments and npx in front of codex are fine', async () => {
  expect(describeCodex('CODEX_HOME=/x codex exec - < r.md')?.purpose).toBe('Codex')
  expect(describeCodex('A=1 B="two words" codex exec -s workspace-write -')?.purpose).toBe('Codex 審查')
  expect(describeCodex('npx codex exec - < r.md')?.purpose).toBe('Codex')
  expect(describeCodex('npx -y codex exec -')?.purpose).toBe('Codex')
})

test('the words codex exec after something else on the line are not a run', async () => {
  expect(describeCodex('git log && echo note: codex exec flags')).toBeUndefined()
  expect(describeCodex('echo codex exec')).toBeUndefined()
  expect(describeCodex('grep codex exec README.md')).toBeUndefined()
})

test('a line end between two commands is a command position, but one between codex and exec is not', async () => {
  expect(describeCodex('echo hi\ncodex exec - < x')?.purpose).toBe('Codex')
  expect(describeCodex('codex\nexec -')).toBeUndefined()
  expect(describeCodex('codex \\\n exec -')?.purpose).toBe('Codex')
})

// Where a run can start besides the beginning of a line.
test('command positions in the shells: after a line end, { , then / do / else, $( and a backtick, and at the start of a call operator', async () => {
  const model = 'CODEX_MODEL=$(jq -r .codex ~/.claude/model-choice.json)\ncodex exec --sandbox read-only -m "$CODEX_MODEL" - < brief.md'

  expect(describeCodex(model)?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('cd x\ncodex exec -s workspace-write -')?.purpose).toBe('Codex 審查')
  expect(describeCodex('if true; then codex exec - < b.md; fi')?.purpose).toBe('Codex')
  expect(describeCodex('for f in a b; do codex exec -s workspace-write - < $f; done')?.purpose).toBe('Codex 審查')
  expect(describeCodex('if x; then a; else codex exec -s read-only -; fi')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('{ codex exec -; }')?.purpose).toBe('Codex')
  expect(describeCodex('out=$(codex exec - < b.md)')?.purpose).toBe('Codex')
  expect(describeCodex('out="$(codex exec - < b.md)"')?.purpose).toBe('Codex')
  expect(describeCodex('echo "$(codex exec -s workspace-write -)"')?.purpose).toBe('Codex 審查')
  expect(describeCodex('out=`codex exec -`')?.purpose).toBe('Codex')
})

test('prefixes in front of codex: timeout, env, nohup, time, npx with a package, and a path to it', async () => {
  expect(describeCodex('timeout 600 codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('timeout --foreground 10m codex exec -s read-only -')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('env A=1 codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('env -i A=1 B=2 codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('nohup codex exec - &')?.purpose).toBe('Codex')
  expect(describeCodex('time codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('npx @openai/codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('~/bin/codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('/usr/local/bin/codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('C:\\tools\\codex.exe exec -s workspace-write -', undefined, 'powershell')?.purpose).toBe('Codex 審查')
  expect(describeCodex('C:/tools/codex.exe exec -')?.purpose).toBe('Codex')
  expect(describeCodex('"$HOME/bin/codex" exec -')?.purpose).toBe('Codex')
})

test('PowerShell: the call operator on a quoted path, and a string that ends in a backslash', async () => {
  expect(describeCodex('& "C:\\tools\\codex.exe" exec -', undefined, 'powershell')?.purpose).toBe('Codex')
  expect(describeCodex("& 'C:\\tools\\codex.cmd' exec -s read-only -", undefined, 'powershell')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('Set-Location "C:\\work\\"; codex exec -o "out.md" -', undefined, 'powershell')?.purpose).toBe('Codex')
  expect(describeCodex('$x = "a`" b"; codex exec -', undefined, 'powershell')?.purpose).toBe('Codex')
})

test('a comment is not a command, and neither is a mention after another command', async () => {
  expect(describeCodex('ls # then codex exec later')).toBeUndefined()
  expect(describeCodex("ls # don't; codex exec x")).toBeUndefined()
  expect(describeCodex('echo hello codex exec')).toBeUndefined()
  expect(describeCodex('echo "line one\ncodex exec x"')).toBeUndefined()
  expect(describeCodex('codex execute x')).toBeUndefined()
  expect(describeCodex('mycodex exec x')).toBeUndefined()
})

test('the flags that decide the purpose are the run\'s own: not those of a later command on the line', async () => {
  expect(describeCodex('codex exec - < b.md && echo "-s workspace-write"')?.purpose).toBe('Codex')
  expect(describeCodex('codex exec -m x - ; ls -s workspace-write')?.purpose).toBe('Codex')
  expect(describeCodex('codex exec \\\n  --sandbox read-only - < b.md')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('codex exec - 2>&1 | tee log')?.purpose).toBe('Codex')
})

// A command that was built to make the reader slow is read in bounded time: only the first 64 KB is looked at.
// (How the masking scales is tested in shell-mask.test.ts.) Every text here has codex in it, so none is turned
// away at the door: each ends in a `codex exec` of its own.
const BS = String.fromCharCode(92)
const TAIL = '\ncodex exec -s read-only -'
const ADVERSARIAL: [string, string][] = [
  ['npx with many flags', `npx${' --a'.repeat(25_000)} x${TAIL}`],
  ['env assignments', `${'A=1 '.repeat(25_000)}${TAIL}`],
  ['separators', `${';'.repeat(100_000)}${TAIL}`],
  ['spaces after a separator', `;${' '.repeat(100_000)}x${TAIL}`],
  ['unclosed heredoc headers', `${'<<A '.repeat(25_000)}${TAIL}`],
  ['heredoc, never closed', `<<EOF\n${'a\n'.repeat(50_000)}${TAIL}`],
  ['here-strings, never closed', `${"@'\n".repeat(33_000)}${TAIL}`],
  ['unclosed double quotes', `${'"'.repeat(100_000)}${TAIL}`],
  ['escaped unclosed double quote', `${`"${BS}`.repeat(50_000)}${TAIL}`],
  ['unclosed single quotes', `${"'".repeat(100_000)}${TAIL}`],
  ['substitutions in quotes', `${'"$('.repeat(33_000)}${TAIL}`],
  ['comments', `${'# '.repeat(50_000)}${TAIL}`],
  ['arithmetic never closed', `${'$(('.repeat(33_000)}${TAIL}`],
  ['codex near-misses', `${'A=1 codex '.repeat(10_000)}${TAIL}`],
  ['assignment chain', `${'A=B=C='.repeat(16_000)}${TAIL}`],
]

test('adversarial 100 KB commands that all mention codex are read in under 50 ms each', async () => {
  for (const [label, command] of ADVERSARIAL) {
    expect(`${label}: ${/codex/i.test(command)}`).toBe(`${label}: true`)

    for (const shell of ['bash', 'powershell'] as const) {
      // The best of three: a busy machine slows one run, not all.
      const took = Math.min(
        ...[1, 2, 3].map(() => {
          const started = performance.now()
          describeCodex(command, undefined, shell)

          return performance.now() - started
        }),
      )

      expect(`${label} (${shell}): ${took < 50}`).toBe(`${label} (${shell}): true`)
    }
  }
})

test('a command with no mention of codex is not examined at all, and one past 64 KB is cut there', async () => {
  expect(describeCodex(`${'x'.repeat(70_000)}\ncodex exec -`)).toBeUndefined()
  expect(describeCodex(`${'x'.repeat(20_000)}\ncodex exec -`)?.purpose).toBe('Codex')
})

// A text that is cut short is the front of something longer: a string open at the cut goes on past it.
const COMMIT = `git ${'com'}mit`

test('a long commit message with codex exec in it is not a run, whether the cut falls inside the message or not', async () => {
  const quoted = (quote: string, filler: number): string =>
    `${COMMIT} -m ${quote}docs: notes\n\ncodex exec -s workspace-write - < r.md\n${'y'.repeat(filler)}${quote}`

  for (const quote of ['"', "'"]) {
    expect(describeCodex(quoted(quote, 10_000))).toBeUndefined()
    expect(describeCodex(quoted(quote, 70_000))).toBeUndefined()
  }
})

test('a long heredoc brief followed by the real codex exec within the cap is seen, with that run\'s own flags', async () => {
  const brief = `cat > brief.md <<'EOF'\n${'line of brief, codex exec -s workspace-write\n'.repeat(1_000)}EOF\ncodex exec -s read-only - < brief.md`

  expect(brief.length).toBeGreaterThan(40_000)
  expect(describeCodex(brief)?.purpose).toBe('Codex 規劃草稿')
})

test('a heredoc brief longer than the cap hides what follows it: it is masked to the end, not guessed at', async () => {
  const brief = `cat > brief.md <<'EOF'\n${'line of brief\n'.repeat(6_000)}EOF\ncodex exec - < brief.md`

  expect(describeCodex(brief)).toBeUndefined()
})

// Heredoc delimiters: a quoted one runs to its closing quote, a bare one to the next metacharacter.
test('heredoc delimiters with a dash or a dot in them close at the same word', async () => {
  expect(describeCodex("cat > brief.md <<'END-OF-BRIEF'\nnotes\ncodex exec -s workspace-write\nEND-OF-BRIEF\nls")).toBeUndefined()
  expect(describeCodex('cat > brief.md <<EOF.md\nnotes\ncodex exec -s workspace-write\nEOF.md\nls')).toBeUndefined()
  expect(describeCodex('cat > brief.md <<"A B"\ncodex exec x\nA B\nls')).toBeUndefined()
  expect(describeCodex("cat > brief.md <<'END-OF-BRIEF'\nnotes\nEND-OF-BRIEF\ncodex exec -s read-only - < brief.md")?.purpose).toBe(
    'Codex 規劃草稿',
  )
  expect(describeCodex('cat > brief.md <<EOF.md\nnotes\nEOF.md\ncodex exec -s read-only - < brief.md')?.purpose).toBe('Codex 規劃草稿')
})

test('a shift inside $(( )) is arithmetic, not a heredoc', async () => {
  expect(describeCodex('echo $((1<<x))\ncodex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('echo $((1<<EOF)) && codex exec -s read-only -')?.purpose).toBe('Codex 規劃草稿')
})

test('more words that run a command: if, while, until, and wrapper flags that take a value', async () => {
  expect(describeCodex('if codex exec - < b.md; then echo ok; fi')?.purpose).toBe('Codex')
  expect(describeCodex('while codex exec - < b.md; do :; done')?.purpose).toBe('Codex')
  expect(describeCodex('until codex exec - < b.md; do :; done')?.purpose).toBe('Codex')
  expect(describeCodex('timeout -s KILL 10m codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('timeout -k 5 10m codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('env -u FOO codex exec -')?.purpose).toBe('Codex')
  expect(describeCodex('npx -y @openai/codex@latest exec -')?.purpose).toBe('Codex')
  expect(describeCodex('npx --package @openai/codex codex exec -s read-only -')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('echo x | xargs codex exec')).toBeUndefined()
})

test('here-strings and block comments belong to PowerShell, and only to it', async () => {
  const hereString = "$p = @'\ncodex exec -s workspace-write\n'@\n$p | codex exec -s read-only -"

  expect(describeCodex(hereString, undefined, 'powershell')?.purpose).toBe('Codex 規劃草稿')
  // In bash `@'` opens an ordinary quote: the first line reads differently, and no here-string hides anything.
  expect(describeCodex("echo user@'\nhost'\ncodex exec -", undefined, 'bash')?.purpose).toBe('Codex')
  expect(describeCodex('<# codex exec #>\nls', undefined, 'powershell')).toBeUndefined()
  expect(describeCodex('<#\ncodex exec -\n#>\nls', undefined, 'powershell')).toBeUndefined()
  expect(describeCodex('<# note #>\ncodex exec -', undefined, 'powershell')?.purpose).toBe('Codex')
  expect(describeCodex('<#\ncodex exec -\n', undefined, 'powershell')).toBeUndefined()
})

test('the sandbox flag is found in the code and read as written: a prompt that holds one does not decide it', async () => {
  expect(describeCodex('codex exec "x -s workspace-write" -s read-only')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('codex exec "use -s workspace-write"')?.purpose).toBe('Codex')
  expect(describeCodex("codex exec 'a --sandbox workspace-write' --sandbox=\"read-only\"")?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('codex exec -s "workspace-write" -')?.purpose).toBe('Codex 審查')
  expect(describeCodex('codex exec -s \\\n  workspace-write -')?.purpose).toBe('Codex 審查')
})

test('a heredoc body that mentions codex exec is not a run', async () => {
  expect(describeCodex("cat > run.sh <<'EOF'\ncodex exec --sandbox read-only - < brief.md\nEOF")).toBeUndefined()
  expect(describeCodex('cat <<EOF\ncodex exec x\nEOF\nls')).toBeUndefined()
  expect(describeCodex('cat <<-END\n\tcodex exec x\n\tEND')).toBeUndefined()
  expect(describeCodex("cat <<'EOF'\ncodex exec never closed")).toBeUndefined()
  expect(describeCodex("$x = @'\ncodex exec x\n'@\nWrite-Output $x")).toBeUndefined()
})

test('quoted words that mention codex exec are not a run', async () => {
  expect(describeCodex('echo "codex exec - < x"')).toBeUndefined()
  expect(describeCodex("grep 'codex exec' notes.md")).toBeUndefined()
})

test('a heredoc after codex exec is the prompt: the run is seen, and the prompt\'s words do not set its purpose', async () => {
  expect(describeCodex("codex exec --sandbox read-only - <<'EOF'\nplease use -s workspace-write and codex exec\nEOF")?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex("codex exec - <<'EOF'\n--sandbox workspace-write\nEOF")?.purpose).toBe('Codex')
})

test('codex exec resume is a continued talk, with or without an id on the line', async () => {
  expect(describeCodex(`codex exec resume ${ID} - < next.md`)).toEqual({ purpose: 'Codex 續談' })
  expect(describeCodex(`codex exec -m gpt-6-sol -c model_reasoning_effort=high resume ${ID} -`)).toEqual({ purpose: 'Codex 續談' })
  expect(describeCodex('codex exec resume --last -')).toEqual({ purpose: 'Codex 續談' })
})

test('the word resume inside a prompt is not a resume', async () => {
  expect(describeCodex('codex exec "please resume the work" --sandbox read-only')?.purpose).toBe('Codex 規劃草稿')
  expect(describeCodex('codex exec --sandbox read-only resume-notes.md')?.purpose).toBe('Codex 規劃草稿')
})
