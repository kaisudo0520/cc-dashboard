import type { CodexQuota, UsageWindow } from '../../types'
import { CODEX_USAGE_URL, parseCodexAuth, parseCodexUsage, usageHeaders } from './codex-usage'

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
export type ListDir = (path: string) => Promise<readonly { name: string; kind: string; mtimeMs: number }[]>

/** A file's own last-modified time, as `$.fs.stat` gives it; rejects when it cannot be read. */
export type StatMtime = (path: string) => Promise<number>

// A rollout is written to for as long as its session lives, so the one Codex is working in is the one
// last modified, not the one started last (the folders and names say when it started). Looking for it
// stays bounded: the newest ROLLOUT_DAYS_WALKED day folders (Codex makes a folder only for a day it
// ran, so two weeks of use), and no further folder, month or year is listed once ROLLOUT_FILES_MAX
// files are in hand (the day folder that crosses the mark is still taken whole).
export const ROLLOUT_DAYS_WALKED = 14
export const ROLLOUT_FILES_MAX = 200

type Candidate = { path: string; mtimeMs: number }

/**
 * The rollout files under `root`/YYYY/MM/DD in the newest day folders, the most recently modified
 * first (equal times: the later name, i.e. the later-started). Only plain files with the names Codex
 * writes; a link, a folder or anything else is not listed. A folder whose listing fails counts as empty.
 *
 * A directory listing can show a file that is still held open for appending at an older time than it
 * has (NTFS updates the directory entry late), so with `stat` each candidate's time is read from the
 * file itself: one in-process call per candidate. Where that fails the listing's time stands.
 */
export const recentRollouts = async (list: ListDir, root: string, stat?: StatMtime): Promise<string[]> => {
  const found: Candidate[] = []
  let days = 0
  const full = (): boolean => days >= ROLLOUT_DAYS_WALKED || found.length >= ROLLOUT_FILES_MAX
  const entriesOf = (path: string) => list(path).catch(() => [])
  const subdirs = async (path: string, shape: RegExp): Promise<string[]> =>
    descending((await entriesOf(path)).filter(entry => entry.kind === 'dir' && shape.test(entry.name)).map(entry => entry.name))

  walk: for (const year of await subdirs(root, YEAR)) {
    if (full()) break
    for (const month of await subdirs(`${root}/${year}`, TWO_DIGITS)) {
      if (full()) break walk
      for (const day of await subdirs(`${root}/${year}/${month}`, TWO_DIGITS)) {
        if (full()) break walk

        const dir = `${root}/${year}/${month}/${day}`
        days += 1
        for (const entry of await entriesOf(dir)) {
          if (entry.kind === 'file' && ROLLOUT.test(entry.name)) found.push({ path: `${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })
        }
      }
    }
  }

  return byRecency(stat === undefined ? found : await Promise.all(found.map(file => withOwnTime(file, stat))))
}

const withOwnTime = async (file: Candidate, stat: StatMtime): Promise<Candidate> => {
  try {
    const mtimeMs = await stat(file.path)

    return Number.isFinite(mtimeMs) ? { ...file, mtimeMs } : file
  } catch {
    return file
  }
}

const byRecency = (files: readonly Candidate[]): string[] =>
  [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0)).map(file => file.path)

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

// The choice file is read by the rules and the slug ends up in `codex exec -m
// <slug>`, so only what a real model name looks like is accepted. The config's
// effort is drawn in cards and panels, so it has to look like a slug too.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

/** The reasoning effort `~/.codex/config.toml` selects; a value that is not slug-like (control characters, escapes, bidi marks) is no effort. */
export const parseCodexEffort = (toml: string): string | undefined => {
  const value = /^model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(toml)?.[1]

  return value !== undefined && SLUG.test(value) ? value : undefined
}

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
// Rollouts are queried ROLLOUTS_PER_ROUND at a time, the most recently modified first; a second round
// runs only when the first found no codex reading (a rollout of an exec that never reached a token_count),
// and nothing beyond ROLLOUTS_TRIED is read. So a refresh runs 2 PowerShell queries, at most 4.
const ROLLOUTS_PER_ROUND = 2
export const ROLLOUTS_TRIED = 4
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
  /** A file's own modified time (it rejects when it cannot be read); the listing's time can be stale for an open file. */
  stat: StatMtime
  /** What the rollout query prints for the rollout at `path`; empty when it fails. */
  queryRollout: (path: string) => Promise<string>
  /** A GET of `url` with `headers`; it may reject. Used only when the server is asked (see readCodexQuota). */
  fetch?: (url: string, headers: Record<string, string>) => Promise<{ ok: boolean; text: string }>
}

// The account's windows as the ChatGPT backend reports them, signed with the ChatGPT login Codex
// keeps in auth.json (see ./codex-usage). The token is used for this one request and goes nowhere
// else. No login, an expired token (Codex refreshes it when it next runs; this never writes it), a
// refusal or an answer of another shape: undefined, and the rollouts are read instead.
const serverWindows = async (root: string, io: CodexIo): Promise<Pick<CodexQuota, 'fiveHour' | 'weekly'> | undefined> => {
  if (io.fetch === undefined) return undefined
  const auth = parseCodexAuth(await io.readText(`${root}/auth.json`))
  if (auth === undefined) return undefined
  try {
    const answer = await io.fetch(CODEX_USAGE_URL, usageHeaders(auth))

    return answer.ok ? parseCodexUsage(answer.text) : undefined
  } catch {
    return undefined
  }
}

/**
 * Codex's model is the one the choice file pins its calls to (the rules' default
 * without one) and its reasoning effort comes from Codex's config: both are
 * only displayed. Its 5-hour and weekly windows come, when `askServer` is set (the person pressed
 * refresh) and the login allows, from the ChatGPT backend (current even when Codex has not run here,
 * dated `nowMs`); otherwise, or when that fails, from the newest
 * token_count event in a rollout, the only place the CLI records them. Of the most recently modified
 * rollouts the reading with the latest event time is shown, not the one from the rollout started last.
 */
export const readCodexQuota = async (
  home: string,
  io: CodexIo,
  options: { askServer?: boolean; nowMs?: number } = {},
): Promise<CodexQuota> => {
  const root = `${home}/.codex`
  const model = parseChoice(await io.readText(`${home}/${CHOICE_FILE}`)) ?? DEFAULT_CODEX_MODEL
  const effort = parseCodexEffort(await io.readText(`${root}/config.toml`))
  const base = { model, ...(effort === undefined ? {} : { effort }) }

  const server = options.askServer === true ? await serverWindows(root, io) : undefined
  if (server !== undefined) {
    const at = options.nowMs
    return { ...base, ...server, ...(at === undefined ? {} : { readAtMs: at, serverAtMs: at }) }
  }

  const paths = (await recentRollouts(io.list, `${root}/sessions`, io.stat).catch(() => [])).slice(0, ROLLOUTS_TRIED)
  for (let from = 0; from < paths.length; from += ROLLOUTS_PER_ROUND) {
    const latest = latestOf(await Promise.all(paths.slice(from, from + ROLLOUTS_PER_ROUND).map(path => readingOf(io, path))))
    if (latest !== undefined) return { ...base, ...latest.limits, ...(Number.isFinite(latest.atMs) ? { readAtMs: latest.atMs } : {}) }
  }

  return { ...base, note: 'no usage recorded yet' }
}

// A query that fails is a rollout with no reading: it must not take the others' readings with it.
const readingOf = async (io: CodexIo, path: string): Promise<CodexReading | undefined> => {
  try {
    return parseCodexReading(await io.queryRollout(path))
  } catch {
    return undefined
  }
}

// The latest event wins. On a tie the earlier one in `readings` stays: they come most recently
// modified first, so that is the rollout modified last.
const latestOf = (readings: readonly (CodexReading | undefined)[]): CodexReading | undefined =>
  readings.reduce<CodexReading | undefined>(
    (best, reading) => (reading !== undefined && (best === undefined || reading.atMs > best.atMs) ? reading : best),
    undefined,
  )

/**
 * The panel's figures after a new reading: the windows of whichever reading is newer (a reading of
 * unknown time is the oldest), a window the newer one lacks kept from the other. So a server reading
 * the person asked for is not undone by an older rollout at the next poll, and Codex used here later
 * shows through. The model and effort are the new reading's; the time of the last server answer stays.
 */
export const mergeCodex = (old: CodexQuota | null, fresh: CodexQuota): CodexQuota => {
  if (old === null) return fresh
  const isNewer = (fresh.readAtMs ?? Number.NEGATIVE_INFINITY) >= (old.readAtMs ?? Number.NEGATIVE_INFINITY)
  const [first, other] = isNewer ? [fresh, old] : [old, fresh]
  const fiveHour = first.fiveHour ?? other.fiveHour
  const weekly = first.weekly ?? other.weekly
  const readAtMs = isNewer ? fresh.readAtMs : old.readAtMs
  const serverAtMs = fresh.serverAtMs ?? old.serverAtMs
  const { note, readAtMs: _r, serverAtMs: _s, fiveHour: _f, weekly: _w, ...rest } = fresh
  return {
    ...rest,
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(weekly === undefined ? {} : { weekly }),
    ...(fiveHour === undefined && weekly === undefined && note !== undefined ? { note } : {}),
    ...(readAtMs === undefined ? {} : { readAtMs }),
    ...(serverAtMs === undefined ? {} : { serverAtMs }),
  }
}
