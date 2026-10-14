// A repository's configuration may name programs git runs while it reads files:
// `filter.<driver>.clean`, `.smudge` and `.process` (a `.gitattributes` line
// picks the files they apply to). Looking at a repository must not run them, so
// the dashboard lists the drivers (`git config -z --name-only --get-regexp
// "^filter\."`) and switches each one off with `-c` for the git calls that read
// file contents. Plain text in, plain data out; the caller runs git.

/**
 * What `git config --get-regexp` is asked for: every filter driver, and the
 * settings that make a repository a partial clone (which may fetch on its own).
 */
export const CONFIG_QUERY = '^(filter\\.|extensions\\.partialclone$|remote\\..*\\.(promisor|partialclonefilter)$)'

// `filter.<driver>.<variable>`: the driver may hold dots, the variable is the last part.
const NAME = /^filter\.(.+)\.([^.]+)$/
const PARTIAL_CLONE = /^(extensions\.partialclone|remote\..+\.(promisor|partialclonefilter))$/i

/**
 * The filter drivers a `git config -z --name-only` listing names, each once.
 * Undefined, a refusal to go on, when the listing is cut short (a non-empty one
 * must end in a NUL), when it shows a partial clone, or when a name cannot be
 * put in a `-c` option as it is (an `=`, a line end) or is not a filter name.
 */
export const filterDrivers = (output: string): string[] | undefined => {
  if (output !== '' && !output.endsWith('\0')) return undefined

  const drivers = new Set<string>()

  for (const record of output.split('\0')) {
    if (record === '') continue
    if (PARTIAL_CLONE.test(record)) return undefined

    const driver = NAME.exec(record)?.[1]
    if (driver === undefined || /[=\r\n]/.test(driver)) return undefined
    drivers.add(driver)
  }

  return [...drivers]
}

/** The `-c` options that leave each driver nothing to run, and nothing it may insist on. */
export const filterOverrides = (drivers: readonly string[]): string[] =>
  drivers.flatMap(driver => [
    '-c',
    `filter.${driver}.clean=`,
    '-c',
    `filter.${driver}.smudge=`,
    '-c',
    `filter.${driver}.process=`,
    '-c',
    `filter.${driver}.required=false`,
  ])
