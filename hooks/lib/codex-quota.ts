import type { CodexQuota, UsageWindow } from '../../types'

// Codex's usage windows, model and effort, read from what Codex itself writes.
// One `token_count` event in a Codex rollout carries
//   "rate_limits":{"limit_id":"codex","primary":{"used_percent":13.0,
//   "window_minutes":300,"resets_at":1791132451},"secondary":{...}|null,...}
// Lines are huge (tool output rides along), so the figures are cut out with a
// regex instead of parsing the whole line. Windows are told apart by their
// length, not by position (which of primary/secondary is the weekly one is the
// plan's choice), and a plan with a single window just has one.
const WINDOW = /\{"used_percent":([\d.]+),"window_minutes":(\d+),"resets_at":(\d+|null)\}/g

const FIVE_HOUR_MAX_MINUTES = 360
const CODEX_MARK = '"limit_id":"codex"'

const descending = (names: readonly string[]): string[] => [...names].sort().reverse()

// Names are what Codex itself writes; anything else in these folders is not read.
const YEAR = /^\d{4}$/
const TWO_DIGITS = /^\d{2}$/
const ROLLOUT = /^rollout-[\w.-]+\.jsonl$/

/** A directory listing, as `$.fs.list` gives it; the caller hands it in so this stays free of `$`. */
export type ListDir = (path: string) => Promise<readonly { name: string; kind: string }[]>

/** Up to `limit` of the newest rollout files under `root`/YYYY/MM/DD, newest first. */
export const newestRollouts = async (list: ListDir, root: string, limit: number): Promise<string[]> => {
  const found: string[] = []
  const subdirs = async (path: string, shape: RegExp): Promise<string[]> =>
    descending((await list(path)).filter(entry => entry.kind === 'dir' && shape.test(entry.name)).map(entry => entry.name))

  for (const year of await subdirs(root, YEAR)) {
    for (const month of await subdirs(`${root}/${year}`, TWO_DIGITS)) {
      for (const day of await subdirs(`${root}/${year}/${month}`, TWO_DIGITS)) {
        const dir = `${root}/${year}/${month}/${day}`
        const names = (await list(dir)).map(entry => entry.name)

        found.push(...descending(names.filter(name => ROLLOUT.test(name))).map(name => `${dir}/${name}`))
        if (found.length >= limit) return found.slice(0, limit)
      }
    }
  }

  return found
}

/** What the rules fall back to when no choice has been made. */
export const DEFAULT_CODEX_MODEL = 'gpt-6-sol'

type Raw = { usedPercent: number; minutes: number; resetsAtMs: number | undefined }

const toWindow = ({ usedPercent, resetsAtMs }: Raw): UsageWindow =>
  resetsAtMs === undefined ? { usedPercent } : { usedPercent, resetsAtMs }

// A percent that is not a number (`1.2.3`) says nothing: that window is left out.
const windowsOf = (line: string): Raw[] =>
  [...line.slice(line.indexOf(CODEX_MARK)).matchAll(WINDOW)]
    .slice(0, 2)
    .map(match => ({
      usedPercent: Number(match[1]),
      minutes: Number(match[2]),
      resetsAtMs: match[3] === 'null' ? undefined : Number(match[3]) * 1000,
    }))
    .filter(window => Number.isFinite(window.usedPercent))

// The event's own time is the line's first key. A line without a parseable one is a reading of
// unknown age: -Infinity, older than any reading that has a time.
const EVENT_TIME = /^\{\s*"timestamp"\s*:\s*"([^"]+)"/
const UNKNOWN_TIME = Number.NEGATIVE_INFINITY

const eventTimeOf = (line: string): number => {
  const stamp = EVENT_TIME.exec(line)?.[1]
  const ms = stamp === undefined ? Number.NaN : Date.parse(stamp)

  return Number.isNaN(ms) ? UNKNOWN_TIME : ms
}

/** A Codex rate-limit reading and the time of the event that carried it. */
export type CodexReading = { atMs: number; limits: Pick<CodexQuota, 'fiveHour' | 'weekly'> }

/** The newest Codex rate-limit reading in `text` (a rollout's tail), if any. */
export const parseCodexReading = (text: string): CodexReading | undefined => {
  const lines = text.split('\n')

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (!line.includes(CODEX_MARK)) continue

    const windows = windowsOf(line)
    if (windows.length === 0) continue

    const five = windows.find(w => w.minutes <= FIVE_HOUR_MAX_MINUTES)
    const week = windows.find(w => w.minutes > FIVE_HOUR_MAX_MINUTES)

    return {
      atMs: eventTimeOf(line),
      limits: {
        fiveHour: five === undefined ? undefined : toWindow(five),
        weekly: week === undefined ? undefined : toWindow(week),
      },
    }
  }

  return undefined
}

/** The newest Codex rate-limit windows in `text` (a rollout's tail), if any. */
export const parseCodexLimits = (text: string): Pick<CodexQuota, 'fiveHour' | 'weekly'> | undefined =>
  parseCodexReading(text)?.limits

/** The reasoning effort `~/.codex/config.toml` selects. */
export const parseCodexEffort = (toml: string): string | undefined =>
  /^model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(toml)?.[1]

// The choice file is read by the rules and the slug ends up in `codex exec -m
// <slug>`, so only what a real model name looks like is accepted.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

/** The model `~/.claude/model-choice.json` pins Codex calls to: its `codex` key. Read only. */
export const parseChoice = (json: string): string | undefined => {
  try {
    const value: unknown = JSON.parse(json)
    const choice = typeof value === 'object' && value !== null ? (value as { codex?: unknown }).codex : undefined

    return typeof choice === 'string' && SLUG.test(choice) ? choice : undefined
  } catch {
    return undefined
  }
}

const ROLLOUT_TAIL_LINES = 2000
const ROLLOUTS_TRIED = 4
const CHOICE_FILE = '.claude/model-choice.json'

// The newest codex reading in a rollout's tail. The path rides in the
// environment, never in the command text, and only the matching lines come
// back, so a big rollout cannot push the figures out of the output limit.
export const ROLLOUT_QUERY =
  `Get-Content -LiteralPath $env:ROLLOUT -Tail ${ROLLOUT_TAIL_LINES} | ` +
  `Select-String -SimpleMatch '${CODEX_MARK}' | Select-Object -Last 5 | ForEach-Object { $_.Line }`

/** The reads Codex's figures need; the caller hands them in so this stays free of `$`. */
export type CodexIo = {
  /** A file's text; empty when it cannot be read. */
  readText: (path: string) => Promise<string>
  list: ListDir
  /** What the rollout query prints for the rollout at `path`; empty when it fails. */
  queryRollout: (path: string) => Promise<string>
}

/**
 * Codex's model is the one the choice file pins its calls to (the rules' default
 * without one) and its reasoning effort comes from Codex's config: both are
 * only displayed. Its 5-hour and weekly windows come from the newest
 * token_count event in a rollout, the only place the CLI records them. Of the newest few rollouts
 * the reading with the latest event time is shown, not the one from the rollout started last.
 */
export const readCodexQuota = async (home: string, io: CodexIo): Promise<CodexQuota> => {
  const root = `${home}/.codex`
  const model = parseChoice(await io.readText(`${home}/${CHOICE_FILE}`)) ?? DEFAULT_CODEX_MODEL
  const effort = parseCodexEffort(await io.readText(`${root}/config.toml`))
  const base = { model, ...(effort === undefined ? {} : { effort }) }

  // The newest-started rollout may be idle while an older, resumed one is where Codex is working:
  // every candidate is read (at most ROLLOUTS_TRIED, one query each) and the latest event wins; on a
  // tie the one listed first, the newer-started, stays.
  const paths = await newestRollouts(io.list, `${root}/sessions`, ROLLOUTS_TRIED).catch(() => [])
  const readings = await Promise.all(paths.map(async path => parseCodexReading(await io.queryRollout(path))))
  const latest = readings.reduce<CodexReading | undefined>(
    (best, reading) => (reading !== undefined && (best === undefined || reading.atMs > best.atMs) ? reading : best),
    undefined,
  )

  if (latest !== undefined) return { ...base, ...latest.limits }

  return { ...base, note: 'no usage recorded yet' }
}
