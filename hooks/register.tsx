import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentCard, Architect, Bucket, Check, CodexQuota, Gate, GitSnap, Layout, LogLine, Loop, Main, Roster, Turn, Usage, View, WaitReason, WaitingRow } from '../types'
import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  SCHEMA_VERSION,
  afterCall,
  applyStep,
  cardKind,
  bucketOf,
  cardTitle,
  titleLines,
  consultTimeline,
  describeInput,
  endConsult,
  fitLegend,
  fmtClock,
  fmtDuration,
  fmtTimer,
  plural,
  windowShort,
  windowMeter,
  meterPercent,
  meterWidth,
  lineMeterWidth,
  padCells,
  LINE_GLYPHS,
  BLOCK_GLYPHS,
  CTX_LINE_SHARE,
  ctxTone,
  limitWindow,
  claudeWindows,
  DOCK_MIN_COLUMNS,
  dockColumns,
  terminalWidth,
  GIT_PATH_ROWS,
  unreviewedLabel,
  changedLabel,
  syncLabel,
  canUnfold,
  cells,
  pathLines,
  pathRows,
  codexCard,
  codexCardFor,
  endCard,
  stopCodex,
  gateSummary,
  gauge,
  isAdvising,
  isLoopActive,
  kTokens,
  lanes,
  limitLabel,
  limitOf,
  listOf,
  logRows,
  momentOf,
  narrowEffort,
  normalize,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  noteTool,
  PALETTES,
  PANEL_FRAME,
  pairRows,
  pairWidths,
  withCtx,
  SVG_COLORS,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  settleCheck,
  shorten,
  startConsult,
  stepLoop,
  wrapRows,
} from './core'
import type { ColumnRow, Config, Meter, Panel, PairRow } from './core'
import { describeCodex } from './lib/codex'
import { ROLLOUT_QUERY, readCodexQuota } from './lib/codex-quota'
import { FABLE_POLL_MS, fableFromUsage, nextFableDelay } from './lib/fable'
import { backgroundIdOf, parseNotifications } from './lib/notify'
import { serial } from './lib/serial'
import { readLiveSessions } from './lib/sessions'
import { bannerText, isQuestionTool, markPath, markText, readWaits, sameWaits } from './lib/waiting'
import { isPersonPrompt, isReviewCall, isReviewPrompt, snapOf } from './lib/git'
import { GIT_TIMEOUT_MS, readTree } from './lib/git-tree'
import type { GitRun, Inspect, Tree } from './lib/git-tree'
import { plain } from './lib/plain'
import { readReviewed, recordReviewed } from './lib/review-store'
import type { ReviewStore } from './lib/review-store'
import { powershellExe, tasklistExe } from './lib/system'

const PANE = 'dashboard'
const TITLE = 'Dashboard'


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'cc-dashboard', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'cc-dashboard', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'cc-dashboard', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'cc-dashboard', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'cc-dashboard', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'cc-dashboard', key: 'agents' } as const, [])
const loops = atom({ plugin: 'cc-dashboard', key: 'loops' } as const, [])
const log = atom({ plugin: 'cc-dashboard', key: 'log' } as const, [])
const turn = atom({ plugin: 'cc-dashboard', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'cc-dashboard', key: 'receipt' } as const, null)
const view = atom({ plugin: 'cc-dashboard', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'cc-dashboard', key: 'roster' } as const, DEFAULT_ROSTER)
const codex = atom({ plugin: 'cc-dashboard', key: 'codex' } as const, null)
const git = atom({ plugin: 'cc-dashboard', key: 'git' } as const, null)
const fable = atom({ plugin: 'cc-dashboard', key: 'fable' } as const, null)
const waiting = atom({ plugin: 'cc-dashboard', key: 'waiting' } as const, null)
const sessions = atom({ plugin: 'cc-dashboard', key: 'sessions' } as const, [])
const waitingOthers = atom({ plugin: 'cc-dashboard', key: 'waitingOthers' } as const, [])

const swallow = (): void => undefined

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getLog($: EngineInterface): Promise<LogLine[]> {
  return normalizeLog(await read($, log))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, log, list => normalizeLog(list))
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

async function say($: EngineInterface, who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  const line: LogLine = { at: await $.clock.now(), who, text, kind, agentId }
  await update($, log, list => [...normalizeLog(list), line].slice(-60))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [u, a, g, cards] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($)])
  const running = cards.filter(c => c.status === 'running').length
  const s = gateSummary(g)
  const parts = [
    u.pct !== null ? `ctx ${Math.round(u.pct)}%` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    s.deny > 0 ? `denied ${s.deny}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
}

async function whoIs($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return 'main'
  const card = (await getCards($)).find(c => c.id === agentId)
  return card ? shorten(cardTitle(card), 14) : 'agent'
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = await $.clock.now()
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await say($, cfg.architectLabel.toLowerCase(), cfg.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const first = advice?.split('\n').find(l => l.trim()) ?? null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  await say($, cfg.architectLabel.toLowerCase(), text ? `advice: ${shorten(text, 60)}` : 'advice returned', 'consult')
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
  await say($, cfg.architectLabel.toLowerCase(), `advice: ${shorten(advice, 60)}`, 'consult')
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

// The dock's width is a share of the terminal's, and the terminal's width is known only from a
// drawing or a command's presentation. A docked drawing gives the transcript's columns, so the
// dock's body and grip are added back. A drawing may not act, so it notes the width here and the
// pump asks the dock again (see syncDock). What a person dragged the dock to still wins.
let terminalColumns: number | undefined
let lastPlacement: 'dock' | 'inline' | undefined
let requestedColumns: number | undefined

async function openPane($: EngineInterface, dockPercent: number) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  // Before any width is known the dock keeps the engine's share; the pump asks once it is.
  requestedColumns = terminalColumns === undefined ? undefined : dockColumns(terminalColumns, dockPercent)
  try {
    return await $.ui.open({ id: PANE, title: TITLE, rows: 8, ...(requestedColumns === undefined ? {} : { columns: requestedColumns }) })
  } catch (error) {
    requestedColumns = undefined // a refused open is asked again on the next tick
    throw error
  }
}

// A docked pane asks again when the terminal's width moved its share; inline, or hidden, it is left alone.
async function syncDock($: EngineInterface, dockPercent: number) {
  if (lastPlacement !== 'dock' || terminalColumns === undefined) return
  if (dockColumns(terminalColumns, dockPercent) === requestedColumns) return
  if (await isPaneShown($)) await openPane($, dockPercent)
}

async function resetAll($: EngineInterface) {
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, log, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  await update($, view, () => DEFAULT_VIEW)
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null }))
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

// ---------------------------------------------------------------- Codex usage
// Codex's figures are only displayed (see ./lib/codex-quota): its model from the choice file, its
// effort from its config, and its 5-hour and weekly windows from the most recently modified rollouts
// (the latest event time among the top two wins; the next two are read only when those hold none),
// read through Windows PowerShell by full path. The rollout's path rides in the environment, never in
// the command text. Without USERPROFILE or SystemRoot nothing is read and the panel stays hidden.

async function readCodex($: EngineInterface): Promise<CodexQuota | null> {
  const home = await $.env.get('USERPROFILE')
  const root = await $.env.get('SystemRoot')
  if (home === undefined || root === undefined) return null
  return readCodexQuota(home, {
    readText: path => $.fs.read(path).catch(() => ''),
    list: dir => $.fs.list(dir),
    stat: path => $.fs.stat(path).then(info => info.mtimeMs),
    queryRollout: path =>
      $.process
        .run([powershellExe(root), '-NoProfile', '-NonInteractive', '-Command', ROLLOUT_QUERY], { env: { ROLLOUT: path }, timeoutMs: 20_000 })
        .then(done => done.stdout, () => ''),
  })
}

// A reading without a window keeps the last figure for it: the pane shows it as 0%, marked stale, past its reset.
async function refreshCodex($: EngineInterface) {
  const reading = await readCodex($)
  await update($, codex, old =>
    reading === null ? null : { ...reading, fiveHour: reading.fiveHour ?? old?.fiveHour, weekly: reading.weekly ?? old?.weekly },
  )
}

// ---------------------------------------------------------------- branch (git)
// The session's repository, read with read-only git (the commands are spelled in ./lib/git-tree).
// A changed file is unreviewed when the last review did not see its contents as they are now. What
// a review saw is the one thing this plugin writes: under `git-reviewed:<root>` in its own `$.store`.

const gitRun = ($: EngineInterface): GitRun => (argv, init) => $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS, ...init })

const reviewStore = ($: EngineInterface): ReviewStore => ({
  get: key => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
  delete: key => $.store.delete(key),
  keys: () => $.store.keys(),
})

// Whether a path is a link, and where it lands (a junction lands elsewhere without being a link); one that cannot be checked counts as a link.
const inspect = ($: EngineInterface): Inspect => path =>
  $.fs.stat(path, { resolve: true }).then(
    st => ({ isLink: st.isLink, ...(st.realPath === undefined ? {} : { realPath: st.realPath }) }),
    () => ({ isLink: true }),
  )

const readGitTree = ($: EngineInterface): Promise<Tree | undefined> => readTree(gitRun($), inspect($))
const readTreeQuietly = ($: EngineInterface): Promise<Tree | undefined> => readGitTree($).catch(() => undefined)

// Outside a repository, or with a git that cannot run, the panel empties: old figures are not kept.
async function refreshGit($: EngineInterface) {
  const tree = await readGitTree($).catch(() => undefined)
  const snap: GitSnap | null = tree === undefined ? null : snapOf(tree.status, tree.hashes, await readReviewed(reviewStore($), tree.root))
  await update($, git, () => snap)
}

// The tree read as a review started is what that review saw: once it is under way (not refused,
// not failed) those contents count as reviewed. This runs whether or not the pane is showing.
async function recordReview($: EngineInterface, tree: Tree | undefined) {
  if (tree?.hashes === undefined) return
  const kept = await recordReviewed(reviewStore($), tree.root, tree.hashes)
  await update($, git, () => snapOf(tree.status, tree.hashes, kept))
}

// ---------------------------------------------------------------- Fable
// Fable's weekly window is not in the session's rate limits: it comes from /api/oauth/usage. The
// request is authorised by the engine's own handle (the credential never reaches this plugin), and
// only a bearer login can use that endpoint. A failed answer keeps the last figure and marks it
// stale. Answers how long to wait before asking again: 90 seconds, doubled after a failure up to
// ten minutes, or as long as the server asks in `retry-after`.

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
let fableDelayMs = FABLE_POLL_MS

async function refreshFable($: EngineInterface): Promise<number> {
  const auth = await $.session.authorize().catch(() => null)
  const response =
    auth === null || auth.kind !== 'bearer'
      ? undefined
      : await $.http
          .fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' } })
          .catch(() => undefined)
  const window = response?.ok === true ? fableFromUsage(response.text) : undefined
  await update($, fable, old =>
    window !== undefined ? { window, isStale: false } : old?.window === undefined ? { isStale: false } : { window: old.window, isStale: true },
  )
  fableDelayMs = nextFableDelay(fableDelayMs, response?.ok === true, response?.headers['retry-after'])
  return fableDelayMs
}

// ---------------------------------------------------------------- waits on the person
// A session that waits on the person (a permission dialog, a question, a plan to approve) says so
// in a small mark file named by its pid, in the folder and format status-sidebar uses, so sessions
// running either mod see each other. Writing this session's own mark follows its events, whether
// or not the pane shows; reading the others' (and the registry and process table that say which
// marks to trust) only serves the banner, so it waits for the pane to show.

let herePid: number | undefined
let pidLookup: Promise<void> | undefined
let sessionsAt = 0
// Calls whose permission is put to the decider, so a dialog's wait ends with its own call.
const asked = new Set<string>()

// The live sessions: the registry in ~/.claude/sessions, kept to the pids still running as Claude
// Code. A registry or process table that cannot be read leaves no sessions, and so no banner.
async function refreshSessions($: EngineInterface) {
  try {
    const home = await $.env.get('USERPROFILE')
    if (home === undefined) throw new Error('USERPROFILE is not set')
    const root = await $.env.get('SystemRoot')
    if (root === undefined) throw new Error('SystemRoot is not set')
    const rows = await readLiveSessions(home, await $.session.id(), {
      list: dir => $.fs.list(dir),
      read: path => $.fs.read(path).catch(() => ''),
      tasklist: () => $.process.run([tasklistExe(root), '/FO', 'CSV', '/NH'], { timeoutMs: 15_000 }),
    })
    herePid = rows.find(row => row.isHere)?.pid ?? herePid
    await update($, sessions, () => rows)
  } catch (error) {
    await update($, sessions, () => [])
    throw error
  }
}

function learnPid($: EngineInterface): Promise<void> {
  pidLookup ??= refreshSessions($)
    .catch(swallow)
    .finally(() => {
      pidLookup = undefined
    })
  return pidLookup
}

// What the mark says is the wait as it stands when the write begins. Until the pid is known nothing
// waits for it, so a dialog is never held up on it.
async function putMark($: EngineInterface) {
  if (herePid === undefined) {
    void learnPid($)
      .then(() => (herePid === undefined ? undefined : writeMark($)))
      .catch(swallow)
    return
  }
  const home = await $.env.get('USERPROFILE')
  if (home === undefined) return
  const value = await read($, waiting)
  await $.fs.write(markPath(home, herePid), markText(await $.session.id(), value?.reason ?? null, value?.sinceMs ?? 0))
}

// The writes go one after another, so a slow one never lands after a newer one.
const inMarkOrder = serial()
function writeMark($: EngineInterface): Promise<void> {
  return inMarkOrder(() => putMark($))
}

async function setWaiting($: EngineInterface, reason: WaitReason | null) {
  if (((await read($, waiting))?.reason ?? null) === reason) return
  const value = reason === null ? null : { reason, sinceMs: await $.clock.now() }
  await update($, waiting, () => value)
  await writeMark($)
}

// A new prompt, the turn ending, or the session ending means whatever was asked is over.
async function endWaiting($: EngineInterface) {
  asked.clear()
  await setWaiting($, null)
}

// A call that returned has had its question answered or its dialog closed. A permission wait ends
// once no call put to the decider is still pending.
async function settleWait($: EngineInterface, tool: string, toolUseId: string | undefined) {
  if (toolUseId !== undefined) asked.delete(toolUseId)
  const now = (await read($, waiting))?.reason
  if ((now === 'question' && isQuestionTool(tool)) || (now === 'permission' && asked.size === 0)) await setWaiting($, null)
}

// The same waits as the last read change nothing: no write, no redraw.
async function noteOthers($: EngineInterface, rows: WaitingRow[]) {
  if (sameWaits(await read($, waitingOthers), rows)) return
  await update($, waitingOthers, () => rows)
}

// The other live sessions that wait on the person: each one's mark, if the session id inside it is
// the one the registry names. Whatever cannot be read leaves no banner: nothing is guessed.
async function readOthers($: EngineInterface): Promise<number> {
  try {
    const now = await $.clock.now()
    if (now - sessionsAt >= 30_000) {
      sessionsAt = now
      await refreshSessions($)
    }
    const home = await $.env.get('USERPROFILE')
    await noteOthers($, home === undefined ? [] : await readWaits(home, await read($, sessions), path => $.fs.read(path).catch(() => '')))
  } catch {
    await noteOthers($, [])
  }
  return 5_000
}

// ---------------------------------------------------------------- Codex runs as subagents
// A `codex exec` the main session starts through Bash or PowerShell is drawn as a subagent card:
// running from the call's start, ended by its result, by a background task's notification, or
// (inferred) by the turn's stop. No Codex session id is read.

async function codexStarted($: EngineInterface, id: string, call: { purpose: string; note?: string }) {
  const codexNow = await read($, codex)
  const card = codexCard(id, call, codexNow?.model ?? '', await $.clock.now(), codexNow?.effort ?? '')
  await update($, agents, list => [...listOf<unknown>(list).map(normalizeCard), card].slice(-24))
  await say($, shorten(cardTitle(card), 12), 'spawned · Codex', 'info', id)
}

async function codexEnded($: EngineInterface, id: string, ok: boolean) {
  const card = (await getCards($)).find(c => c.id === id)
  if (card?.codex === undefined || card.status !== 'running') return
  const now = await $.clock.now()
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? endCard(c, ok, now) : c)))
  await say($, await whoIs($, id), ok ? `done · ${fmtDuration(now - card.spawnedAt)}` : 'failed', ok ? 'done' : 'error', id)
}

// The call's result: the run moved to the background (kept running, under its task id), or is over.
async function codexSettled($: EngineInterface, id: string, ran: { deny?: string; isError?: boolean; result?: unknown }) {
  const taskId = ran.deny === undefined ? backgroundIdOf(ran.result) : undefined
  if (taskId === undefined) return codexEnded($, id, ran.deny === undefined && ran.isError !== true)
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id && c.codex ? { ...c, codex: { taskId } } : c)))
}

// ---------------------------------------------------------------- polling
// Fable, Codex, git and the other sessions' waits are read on their own schedules, and only while
// the pane is showing: a pane nobody sees costs no request and no process. One pump looks every 2
// seconds and starts whichever is due and not already running.

type Source = 'fable' | 'codex' | 'git' | 'others'
const SOURCES: readonly Source[] = ['fable', 'codex', 'git', 'others']
const dueAt: Record<Source, number> = { fable: 0, codex: 0, git: 0, others: 0 }
const busy = new Set<Source>()
let pump: Timer | undefined

async function isPaneShown($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
}

// Each source reads, then answers how long to wait before it is read again.
async function readSource($: EngineInterface, source: Source): Promise<number> {
  switch (source) {
    case 'fable':
      return refreshFable($)
    case 'codex':
      await refreshCodex($)
      return 120_000
    case 'git':
      await refreshGit($)
      return 30_000
    case 'others':
      return readOthers($)
  }
}

// A read that throws is tried again after the usual wait, or for Fable after its next backoff.
function failureWait(source: Source) {
  if (source === 'fable') return (fableDelayMs = nextFableDelay(fableDelayMs, false, undefined))
  return source === 'codex' ? 120_000 : source === 'git' ? 30_000 : 5_000
}

async function runSource($: EngineInterface, source: Source) {
  busy.add(source)
  try {
    const wait = await readSource($, source).catch(() => failureWait(source))
    dueAt[source] = (await $.clock.now()) + wait
  } finally {
    busy.delete(source)
  }
}

async function pumpPolls($: EngineInterface) {
  if (!(await isPaneShown($).catch(() => false))) return
  const now = await $.clock.now()
  for (const source of SOURCES) {
    if (!busy.has(source) && dueAt[source] <= now) void runSource($, source).catch(swallow)
  }
}

// One pump per plugin instance: a second start (a hot reload) replaces the first.
function startPolling($: EngineInterface, dockPercent: number) {
  pump?.cancel()
  pump = $.clock.every(2_000, () => {
    void pumpPolls($).catch(swallow)
    void syncDock($, dockPercent).catch(swallow)
  })
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dashboard',
      description: 'CC Dashboard, the live agent dashboard: open, close, reset, refresh, or set the layout',
      argumentHint: '[open|close|reset|refresh|layout auto|compact|wide|mini]',
    })
    await migrate($)
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        limits: u.rateLimits.map(limitOf),
      }))
    }
    if (cfg.openOnStart) void openPane($, cfg.dockPercent).catch(() => undefined)
    await refreshStatus($, cfg)
    startPolling($, cfg.dockPercent)
    void pumpPolls($).catch(swallow)
    // A fresh load writes the wait as it stands: none on a start, the open one when a reload lands while a dialog is up.
    void writeMark($).catch(swallow)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
      await refreshStatus($, cfg)
    }
    await endWaiting($).catch(swallow)
    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async ($, e) => {
    const [verb = 'open', arg = ''] = e.args.trim().split(/\s+/)
    if (e.presentation.isFullscreen) terminalColumns = e.presentation.columns
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Dashboard closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      await refreshStatus($, cfg)
      return { text: 'Dashboard reset.' }
    }
    if (verb === 'refresh') {
      // Read now, whether or not the pane shows; the schedules start over from here. Fable keeps its own.
      sessionsAt = 0
      await Promise.all((['codex', 'git', 'others'] as const).filter(src => !busy.has(src)).map(src => runSource($, src)))
      return { text: 'Read Codex usage, the branch and the other sessions waiting on you again.' }
    }
    if (verb === 'layout') {
      const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
      if (!layout) return { text: 'Usage: /dashboard layout auto|compact|wide|mini' }
      await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
      const opened = await openPane($, cfg.dockPercent)
      return { text: opened.isPlaced ? `Dashboard layout: ${layout}.` : `Layout set to ${layout}; the pane is not shown yet: ${opened.reason}` }
    }
    const opened = await openPane($, cfg.dockPercent)
    if (!opened.isPlaced) return { text: `Dashboard is not shown yet: ${opened.reason}` }
    void pumpPolls($).catch(swallow)
    return { text: 'Dashboard opened. Focus it with ctrl+x tab; 1-6 expand cards, f/s/o open the gate rows, u lists the unreviewed files.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const back = e.text ? handbackOf(e.text) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    } else if (e.text) {
      const p = promptLine(e.text)
      await say($, p.who, p.text)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, model: e.model, effort: String(e.effort ?? x.effort), steps: x.steps + 1 }
      })
      return yield* next(e)
    }
    const result = yield* next(e)
    const id = e.agentId
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, effort: e.effort, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
      if (result.stopReason === 'max_tokens') await say($, await whoIs($, id), 'hit max_tokens', 'error', id)
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, x => ({
      ...normalize(DEFAULT_USAGE, x),
      pct: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      limits: e.rateLimits.map(limitOf),
    }))
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, usage, x => {
        const u = normalize(DEFAULT_USAGE, x)
        return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
      })
      await say($, 'main', `context compacted (${e.trigger})`)
    }
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id) asked.add(e.tool_use_id)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await say($, 'gate', `denied by rule · ${check.detail}`, 'error')
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  // A permission dialog opens: this session waits on the person until the call returns.
  on('classic.PermissionRequest', async ($, e, next) => {
    await setWaiting($, 'permission').catch(swallow)
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  // At the end of a turn the engine's own list of background tasks says which Codex runs still live.
  on('classic.Stop', async ($, e, next) => {
    const liveIds = e.background_tasks?.map(task => task.id)
    for (const end of stopCodex(await getCards($), liveIds)) await codexEnded($, end.id, end.ok)
    await refreshStatus($, cfg)
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    // A review is noted whoever starts it: the tree is read as the call begins, and kept only if
    // the call is not refused and does not fail.
    const review = isReviewCall(tool, e) ? readTreeQuietly($) : undefined
    // A question put to the person is a wait from the call's start to its return, whoever asks.
    if (isQuestionTool(tool)) await setWaiting($, 'question').catch(swallow)
    // A `codex exec` the main session runs is a subagent card from here to its end.
    const shell = !e.agentId && (tool === 'Bash' || tool === 'PowerShell') ? (e as unknown as { command?: unknown; description?: unknown }) : null
    const run =
      shell && typeof shell.command === 'string'
        ? describeCodex(shell.command, typeof shell.description === 'string' ? shell.description : undefined, tool === 'PowerShell' ? 'powershell' : 'bash')
        : undefined
    if (run) {
      await codexStarted($, e.tool_use_id, run).catch(swallow)
      await refreshStatus($, cfg)
    }
    const ran = await next(e)
      .catch(async error => {
        if (run) await codexEnded($, e.tool_use_id, false).catch(swallow)
        throw error
      })
      .finally(() => {
        callLoop.delete(e.tool_use_id)
        void settleWait($, tool, e.tool_use_id).catch(swallow)
      })
    if (run) await codexSettled($, e.tool_use_id, ran).catch(swallow)
    const didRun = ran.deny === undefined
    if (review !== undefined && didRun && ran.isError !== true) void review.then(tree => recordReview($, tree)).catch(swallow)
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    if (ran.deny !== undefined) await say($, await whoIs($, e.agentId), `${text}  denied`, 'error', e.agentId ?? null)
    else if (hasFailed) await say($, await whoIs($, e.agentId), `${text}  ✗`, 'error', e.agentId ?? null)
    else if (isEdit) await say($, await whoIs($, e.agentId), text, 'info', e.agentId ?? null)
    if (isSettled || !didRun || run) await refreshStatus($, cfg)
    return ran
  })

  // A typed /…review has no result to wait for: it counts as it is sent, if the person typed it.
  // A background task's notification arrives as a prompt of its own origin: it ends a Codex run.
  // What the person types answers whatever was asked.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      for (const n of parseNotifications(e.text)) {
        const card = codexCardFor(await getCards($), n.id, n.toolUseId)
        if (card) await codexEnded($, card.id, n.ok).catch(swallow)
      }
      await refreshStatus($, cfg)
    }
    const result = await next(e)
    if (result.drop === undefined && isPersonPrompt(e.origin.kind)) {
      if (isReviewPrompt(e.text)) {
        void readTreeQuietly($)
          .then(tree => recordReview($, tree))
          .catch(swallow)
      }
      await endWaiting($).catch(swallow)
    }
    return result
  }).catch(async (_$, e, next) => next(e))

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, `${block.name} tool`)
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => [...listOf<unknown>(list).map(normalizeCard), card].slice(-24))
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    await say($, shorten(cardTitle(card), 12), `spawned · ${card.type}`, 'info', id)
    await refreshStatus($, cfg)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    const now = await $.clock.now()
    if (!id) {
      const [t, cards] = await Promise.all([getTurn($), getCards($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        reason: e.reason,
      })
      await update($, receipt, () => r)
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      // The turn may have changed files: the next pump reads git without waiting out its 30 seconds.
      dueAt.git = 0
      await endWaiting($).catch(swallow)
      await refreshStatus($, cfg)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    if (cards.some(c => c.id === id)) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(e.answer, 400) } : c)),
      )
      const card = cards.find(c => c.id === id)
      const took = card ? fmtDuration(now - card.spawnedAt) : ''
      await say($, await whoIs($, id), status === 'done' ? `done · ${took}` : status, status === 'done' ? 'done' : 'error', id)
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  const receiptText = (x: { durationMs: number; agents: number; edits: number; errors: number }) =>
    `last turn ${fmtDuration(x.durationMs)} · ${plural(x.agents, 'agent')} · ${plural(x.edits, 'edit')} · ${plural(x.errors, 'error')}`

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Noted for the pump, which sizes the dock: a drawing itself only reads. Only the terminal's
    // drawing counts; a desktop or phone attached to the session measures a pane of its own.
    if (e.surface === 'terminal') {
      lastPlacement = e.props.placement
      // Docked, the viewport is the transcript beside the dock, so the dock is added back.
      if (e.viewport?.isFullscreen === true) {
        terminalColumns = e.props.placement === 'dock' ? terminalWidth(e.viewport.columns, e.props.bodyColumns) : e.viewport.columns
      }
    }
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const hasClient = 'Client' in els
    const [m, u, a, g, cards, lp, lines, t, r, v, now, cx, gs, fb, others] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getLog($),
      getTurn($),
      read($, receipt),
      getView($),
      $.clock.now(),
      read($, codex),
      read($, git),
      read($, fable),
      read($, waitingOthers),
    ])
    // Another live session waiting on the person: one red line, absent while nobody waits.
    const banner = bannerText(others, now)
    const fableWindow = fb?.window
    const W = Math.max(DOCK_MIN_COLUMNS, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = cfg.motion && hasClient
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      codex: cx === null,
      git: gs === null,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      receipt: !m.isRunning && !r,
      log: false,
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    // The single column seats two panels to a row when the pane is wide enough and the person left the layout on auto.
    const pairing = layout === 'auto' && !isWide ? pairWidths(W) : null
    // The context is a line of its own under the main box (under the Codex box when that comes next), once it is read.
    const ctxMeter: Meter | null =
      u.pct !== null
        ? { label: 'Context', pct: Math.round(u.pct), isStale: false, detail: u.tokens !== null ? `${kTokens(u.tokens)}/${kTokens(u.window)}` : '' }
        : null
    const ctxNote = u.compactions > 0 ? `  ⟲${u.compactions}` : ''
    const withContext = (list: readonly PairRow[]): ColumnRow[] => (ctxMeter ? withCtx(list) : [...list])
    const rows = withContext(pairing ? pairRows(panels) : panels)
    const isPaired = (a: Panel, b: Panel) => rows.some(r => typeof r !== 'string' && r[0] === a && r[1] === b)
    const decider = m.mode === 'auto' ? 'classifier' : 'you'

    // A connector between panels: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: C.faint, marks, isMerge }}
        />
      ) : (
        <Text color={C.faint}>{'─'.repeat(Math.max(1, width))}</Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClient ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    // A usage row as the first version drew its quota header: the label, a bar across the line, the
    // percent in a column of its own, then the time to the reset. The rows
    // of one panel share a label column and a bar width (see meterLayout), so their bars line up.
    // Past its reset a window reads 0%, marked `~` and `stale`; a window not read yet is a dash.
    const meterRow = (key: string, row: Meter, layout: { labelW: number; barW: number }, color: string) => {
      const label = padCells(row.label, layout.labelW)
      if (row.pct === null) return <Text key={key} dimColor wrap="truncate">{`${label} —`}</Text>
      const bar = gauge(row.pct, layout.barW, LINE_GLYPHS)
      const tone = row.isStale ? C.dim : row.pct >= 80 ? C.warn : color
      return (
        <Text key={key} wrap="truncate">
          <Text dimColor>{`${label} `}</Text>
          <Text color={tone}>{bar.on}</Text>
          <Text color={C.faint}>{bar.off}</Text>
          <Text color={tone} bold={!row.isStale}>{` ${meterPercent(row)}`}</Text>
          {row.detail ? <Text dimColor>{` ${row.detail}`}</Text> : null}
        </Text>
      )
    }
    // The label column and bar width a panel's rows share, the bar sized by the widest detail after a percent.
    const meterLayout = (rows: Meter[], w: number) => {
      const labelW = Math.max(0, ...rows.map(r => cells(r.label)))
      return { labelW, barW: meterWidth(w, labelW, rows.map(r => r.detail)) }
    }

    // ---- main
    const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
    // Claude's windows and Fable, a row each.
    const usageMeters = [
      ...u.limits.slice(0, 2).map(l => windowMeter(limitLabel(l.kind), limitWindow(l), now)),
      ...(fableWindow ? [windowMeter(fb?.isStale ? 'Fable~' : 'Fable', fableWindow, now)] : []),
    ]
    const mainPanel = (w: number, isNarrow = false) => {
      const layout = meterLayout(usageMeters, w)
      const effortBar = '▮'.repeat(effortN) + '▯'.repeat(4 - effortN)
      const narrowLine = narrowEffort(m.effort, m.mode, m.steps, w - PANEL_FRAME)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.main} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.main} bold>
              {modelName} · main
            </Text>
            <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? '● working' : '○ idle'}</Text>
          </Box>
          {isNarrow ? (
            <Text wrap="truncate">
              <Text color={C.main}>{effortBar} </Text>
              <Text color={C.main} bold>
                {narrowLine.effort}
              </Text>
              <Text dimColor>{narrowLine.tail}</Text>
            </Text>
          ) : (
            <Text wrap="truncate">
              <Text dimColor>effort </Text>
              <Text color={C.main}>{effortBar} </Text>
              <Text color={C.main} bold>
                {m.effort || '—'}
              </Text>
              {m.mode ? <Text dimColor>{`   mode ${m.mode}`}</Text> : null}
              <Text dimColor>{`   ${m.steps} req`}</Text>
            </Text>
          )}
          {usageMeters.map((row, i) => meterRow(`usage-${i}`, row, layout, C.main))}
        </Box>
      )
    }
    // The context: one line about half the pane wide, no box, left-aligned in its column with a blank row below; its bar
    // is sized by its own detail and note, and the filled cells and the percent share one colour by how full it is.
    const ctxLine = (w: number) => {
      if (!ctxMeter || ctxMeter.pct === null) return null
      const barW = lineMeterWidth(Math.round(w * CTX_LINE_SHARE), cells(ctxMeter.label), ctxMeter.detail, ctxNote)
      const bar = gauge(ctxMeter.pct, barW, BLOCK_GLYPHS)
      const tone = C[ctxTone(ctxMeter.pct)]
      return (
        <Box key="context" width={w} marginBottom={1}>
          <Text wrap="truncate">
            <Text dimColor>{`${ctxMeter.label} `}</Text>
            <Text color={tone}>{bar.on}</Text>
            <Text color={C.faint}>{bar.off}</Text>
            <Text color={tone} bold>{` ${meterPercent(ctxMeter)}`}</Text>
            {ctxMeter.detail ? <Text dimColor>{` ${ctxMeter.detail}`}</Text> : null}
            {ctxNote ? <Text color={C.amber}>{ctxNote}</Text> : null}
          </Text>
        </Box>
      )
    }

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    const architectPanel = (w: number) => {
      const tl = consultTimeline(a, now, Math.max(8, w - 4))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.arch} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.arch} bold>
              {cfg.architectLabel} · {advising ? 'advising' : 'on call'}
            </Text>
            <Text>
              <Text dimColor>consults </Text>
              <Text color={C.arch} bold>
                {a.consults.length}
              </Text>
            </Text>
          </Box>
          <Text color={C.arch}>{tl}</Text>
          {lastConsult ? (
            <Text dimColor wrap="truncate">
              {advising
                ? `consulting since ${fmtClock(lastConsult.at)}`
                : `last ${fmtDuration(now - (lastConsult.endAt ?? lastConsult.at))} ago · took ${fmtDuration((lastConsult.endAt ?? now) - lastConsult.at)}`}
            </Text>
          ) : (
            <Text dimColor>not consulted yet</Text>
          )}
          {cfg.moments ? (
            <Box flexWrap="wrap" columnGap={2}>
              {(['before a plan', 'error repeats', 'before done'] as const).map(mo => {
                const isOn = lastConsult?.moment === mo
                return (
                  <Text color={isOn ? C.arch : C.dim} bold={isOn}>
                    {isOn ? '◆' : '◇'} {mo}
                  </Text>
                )
              })}
              <Text color={C.faint}>(inferred)</Text>
            </Box>
          ) : null}
          {a.lastAdvice ? (
            <Text color={C.arch} wrap="truncate">
              » {a.lastAdvice}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- gate
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    const GATE_BUCKETS = ['file', 'shell', 'other'] as const
    const bucketCount = (b: Bucket) => {
      const tl = g.totals[b]
      return tl.rule + tl.ask + tl.cleared + tl.deny
    }
    const gateButtonLabel = (b: Bucket) => `${b} ${bucketCount(b)}${v.gateOpen === b ? ' ▾' : ''}`
    const gatePanel = (w: number, isNarrow = false) => {
      const strip = g.recent.slice(-Math.max(8, w - 4))
      const open = v.gateOpen
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gate} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.gate} bold>
              {cfg.gateLabel} · permissions
            </Text>
            <Text dimColor>{`${s.total} checks`}</Text>
          </Box>
          <Box>
            {strip.length === 0 ? <Text color={C.faint}>no checks yet</Text> : null}
            {strip.map(c => (
              <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                {c.verdict === 'deny' ? '✗' : '■'}
              </Text>
            ))}
          </Box>
          {isNarrow ? (
            <Box flexWrap="wrap" columnGap={2}>
              <Text>
                <Text color={C.gate}>■</Text>
                <Text dimColor>{` ${s.rule} allowed`}</Text>
              </Text>
              <Text>
                <Text color={C.cleared}>■</Text>
                <Text dimColor>{` ${s.cleared} ${decider}`}</Text>
              </Text>
              {s.ask > 0 ? <Text color={C.amber}>{`■ ${s.ask} pending`}</Text> : null}
              <Text color={s.deny > 0 ? C.warn : C.dim}>{`✗ ${s.deny} denied`}</Text>
            </Box>
          ) : (
            <Text wrap="truncate">
              <Text color={C.gate}>■</Text>
              <Text dimColor>{` ${s.rule} allowed  `}</Text>
              <Text color={C.cleared}>■</Text>
              <Text dimColor>{` ${s.cleared} ${decider}  `}</Text>
              {s.ask > 0 ? <Text color={C.amber}>{`■ ${s.ask} pending  `}</Text> : null}
              <Text color={s.deny > 0 ? C.warn : C.dim}>{`✗ ${s.deny} denied`}</Text>
              {w >= 80 && g.recent.some(c => c.inSubagent) ? <Text color={C.faint}>{'  dim: in subagents'}</Text> : null}
            </Text>
          )}
          <Box columnGap={2} {...(isNarrow ? { flexWrap: 'wrap' as const } : {})}>
            {GATE_BUCKETS.map((b: Bucket) => (
              <Button
                key={`gate-${b}`}
                plain
                hotkey={b[0]}
                label={gateButtonLabel(b)}
                dimColor={bucketCount(b) === 0}
                onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
              />
            ))}
          </Box>
          {open
            ? g.recent
                .filter(c => c.bucket === open)
                .slice(-5)
                .map(c => (
                  <Text wrap="truncate">
                    <Text color={verdictColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                    <Text color={C.dim}>{`${(c.verdict === 'rule' ? 'allowed' : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? 'pending' : 'denied').padEnd(10)} `}</Text>
                    <Text dimColor={c.inSubagent}>{shorten(c.detail, Math.max(10, w - 18))}</Text>
                  </Text>
                ))
            : null}
        </Box>
      )
    }

    // ---- agents: cards up to the limit, swimlanes beyond it
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    const agentsPanel = (w: number) => {
      // Cards need 20 columns each; when the pane can't hold the limit, lanes take over.
      const fit = Math.max(1, Math.min(cfg.maxCards, Math.floor((w + 1) / 21)))
      const useLanes = cards.length > fit
      const header = (
        <Box justifyContent="space-between" width={w}>
          <Text bold>{`agents · ${running.length} running · ${cards.length} total`}</Text>
          {cards.length > 0 ? <Text color={C.faint}>1-{Math.min(cards.length, useLanes ? 6 : fit)} expand</Text> : null}
        </Box>
      )
      if (cards.length === 0) {
        return (
          <Box flexDirection="column" width={w}>
            {header}
            <Text color={C.faint}>no subagents yet</Text>
          </Box>
        )
      }
      if (useLanes) {
        const shown = cards.slice(-6)
        const barW = Math.max(8, w - 28)
        const geo = lanes(shown, now, barW)
        return (
          <Box flexDirection="column" width={w}>
            {header}
            {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} earlier`}</Text> : null}
            {shown.map((c, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              return (
                <Box>
                  <Text color={statusColor(c)} bold={isViewed}>{`${isViewed ? '▶' : glyph(c)} `}</Text>
                  <Box width={17}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), 14)} onPress={expandOnPress(c.id)} />
                  </Box>
                  <Text color={C.faint}>{' ' + '·'.repeat(gm?.before ?? 0)}</Text>
                  <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                  <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0) + ' '}</Text>
                  {clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                </Box>
              )
            })}
          </Box>
        )
      }
      const shown = cards.slice(-fit)
      const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
      const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
      return (
        <Box flexDirection="column" width={w}>
          {header}
          {rail('fan-out', running.length > 0, C.agent, w, centers)}
          <Box columnGap={1}>
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              return (
                <Box
                  flexDirection="column"
                  borderStyle={isViewed ? 'double' : 'round'}
                  borderColor={c.lastStop === 'max_tokens' ? C.warn : C.agent}
                  borderDimColor={c.status !== 'running' && !isViewed}
                  width={cardW}
                  paddingX={1}
                >
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={titleLines(cardTitle(c), cardW - 7, cardW - 4)[0]} onPress={expandOnPress(c.id)} />
                  <Text bold wrap="truncate">
                    {titleLines(cardTitle(c), cardW - 7, cardW - 4)[1]}
                  </Text>
                  <Text color={C.dim} wrap="truncate">
                    {cardKind(c, modelName)}
                  </Text>
                  <Text dimColor wrap="truncate">
                    {c.codex ? 'codex exec' : c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${c.steps} st` : 'starting…'}
                  </Text>
                  <Box>
                    <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>
                      {cardW >= 26 ? `${glyph(c)} ${c.lastStop === 'max_tokens' ? 'max_tokens' : c.status} ` : `${glyph(c)} `}
                    </Text>
                    <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
          {rail('merge', running.length > 0, C.agent, w, centers, true)}
        </Box>
      )
    }

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Text bold wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          <Text dimColor wrap="truncate">{`${expandedCard.type} · ${prettyModel(expandedCard.model)}${expandedCard.effort ? ` · ${expandedCard.effort}` : ''} · ${expandedCard.status} · ${expandedCard.steps} steps`}</Text>
          {expandedCard.tools.length === 0 && !expandedCard.codex ? <Text color={C.faint}>no tool calls yet</Text> : null}
          {expandedCard.tools.map(n => (
            <Text color={n.isError ? C.warn : C.text} wrap="truncate">
              {`${n.isError ? '✗' : '·'} ${n.text}`}
            </Text>
          ))}
          {expandedCard.answer ? (
            <Text dimColor wrap="wrap">
              {`» ${shorten(expandedCard.answer, 240)}`}
            </Text>
          ) : null}
        </Box>
      ) : null

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const active = lp.filter(l => isLoopActive(l, now)).length
      const dots = lp.slice(-Math.max(4, w - 38))
      return (
        <Box width={w}>
          <Text bold>other loops </Text>
          <Text dimColor>{`${lp.length} seen · ${active} active  `}</Text>
          {dots.map(l => (
            <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
          ))}
        </Box>
      )
    }

    // ---- receipt: the turn now, or the last one
    const receiptPanel = (w: number) => {
      const isReview = t.isReviewing
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.main} borderDimColor={!m.isRunning && !isReview} paddingX={1} width={w}>
          {m.isRunning ? (
            <Box>
              <Text color={C.main} wrap="truncate">{`◐ back to ${modelName.toLowerCase()} · turn `}</Text>
              <Box flexShrink={0}>{clock('turn-clock', t.startedAt, null, C.main)}</Box>
              {w >= 60 ? <Text dimColor wrap="truncate">{` · ${plural(t.edits, 'edit')} · ${plural(t.errors, 'error')}`}</Text> : null}
            </Box>
          ) : r ? (
            <Text wrap="truncate">
              <Text color={r.reason === 'answer' ? C.gate : C.warn}>{r.reason === 'answer' ? '✓ ' : '✗ '}</Text>
              <Text>{receiptText(r)}</Text>
            </Text>
          ) : (
            <Text color={C.faint}>no turn finished yet</Text>
          )}
          {isReview ? <Text color={C.arch}>{`${cfg.architectLabel.toLowerCase()} reviewing before done (inferred)`}</Text> : null}
        </Box>
      )
    }

    // ---- Codex usage: percent used per window, a row each, as the main box shows Claude's
    const codexMeters = cx ? [windowMeter('5h', cx.fiveHour, now), windowMeter('weekly', cx.weekly, now)] : []
    const codexPanel = (w: number, isNarrow = false) =>
      cx ? (
        <Box flexDirection="column" borderStyle="round" borderColor={C.codex} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.codex} bold wrap="truncate">
              {plain(`Codex · ${cx.model ?? '—'}${cx.effort ? ` · ${cx.effort}` : ''}`)}
            </Text>
            {isNarrow ? null : (
              <Box flexShrink={0}>
                <Text dimColor>quota · used</Text>
              </Box>
            )}
          </Box>
          {codexMeters.map((row, i) => meterRow(`codex-${i}`, row, meterLayout(codexMeters, w), C.codex))}
          {cx.note ? (
            <Text dimColor wrap="truncate">
              {plain(cx.note)}
            </Text>
          ) : null}
        </Box>
      ) : null

    // ---- branch: how many changed files no review has seen, and how many changed
    const gitPanel = (w: number, isNarrow = false) => {
      if (!gs) return null
      const { paths, hidden } = pathLines(gs, v.gitOpen ? GIT_PATH_ROWS : 0)
      const unreviewedColor = gs.unreviewed === undefined ? C.amber : gs.unreviewed === 0 ? C.gate : C.warn
      const title = <Text color={C.branch} bold wrap="truncate">{`🔀 ${gs.branch}`}</Text>
      const changedColor = gs.changed > 0 ? C.text : C.dim
      // Two to a row, the sync and each count have a row of their own; alone, the sync sits beside the title.
      const head = isNarrow ? (
        title
      ) : (
        <Box justifyContent="space-between" columnGap={1}>
          {title}
          <Box flexShrink={0}>
            <Text dimColor>{syncLabel(gs)}</Text>
          </Box>
        </Box>
      )
      const counts = isNarrow ? (
        [
          <Text key="sync" dimColor wrap="truncate">
            {syncLabel(gs)}
          </Text>,
          <Text key="unreviewed" color={unreviewedColor} bold wrap="truncate">
            {unreviewedLabel(gs)}
          </Text>,
          <Text key="changed" color={changedColor} wrap="truncate">
            {changedLabel(gs)}
          </Text>,
        ]
      ) : (
        <Text wrap="truncate">
          <Text color={unreviewedColor} bold>
            {unreviewedLabel(gs)}
          </Text>
          <Text color={C.dim}> · </Text>
          <Text color={changedColor}>{changedLabel(gs)}</Text>
        </Text>
      )
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.branch} paddingX={1} width={w}>
          {head}
          {counts}
          {canUnfold(gs) ? (
            <Button
              key="git-unreviewed"
              plain
              hotkey="u"
              label={`${v.gitOpen ? '▾' : '▸'} unreviewed files`}
              onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gitOpen: !normalize(DEFAULT_VIEW, x).gitOpen }))}
            />
          ) : null}
          {paths.map(path => (
            <Box paddingLeft={2}>
              <Text dimColor wrap="truncate-start">
                {path}
              </Text>
            </Box>
          ))}
          {hidden > 0 ? <Text dimColor>{`  … ${hidden} more`}</Text> : null}
        </Box>
      )
    }

    // ---- log: whatever rows the other panels leave, 4 to 8
    // The main box: its frame, title and effort line, then a row per usage window; the context is a line
    // under it (or under the Codex box) and a blank row below that. The Codex box: its frame and title,
    // a row per window, and its note. The gap above the log is a row. Two boxes to a row take the taller one's rows, not both: the branch box then has the
    // sync and each count on a row, and the gate box wraps its summary and its buttons.
    const mainRows = 4 + usageMeters.length
    const codexRows = cx ? 3 + codexMeters.length + (cx.note ? 1 : 0) : 0
    const gitRows = gs ? 4 + (canUnfold(gs) ? 1 : 0) + pathRows(gs, v.gitOpen) : 0
    const gateRows = 6 + (v.gateOpen ? 5 : 0)
    const inner = (pairing?.[1] ?? W) - PANEL_FRAME
    const gateWrapped =
      4 +
      wrapRows([`■ ${s.rule} allowed`, `■ ${s.cleared} ${decider}`, ...(s.ask > 0 ? [`■ ${s.ask} pending`] : []), `✗ ${s.deny} denied`].map(cells), inner, 2) +
      // A plain button with a hotkey is drawn `f: file 1`.
      wrapRows(GATE_BUCKETS.map(b => 3 + cells(gateButtonLabel(b))), inner, 2) +
      (v.gateOpen ? 5 : 0)
    const mainBlock = isPaired('main', 'codex') ? Math.max(mainRows, codexRows) : mainRows + codexRows
    const gitBlock = isPaired('git', 'gate') ? Math.max(gitRows + 2, gateWrapped) : gitRows + gateRows
    const used = 2 + (banner ? 1 : 0) + mainBlock + (ctxMeter ? 2 : 0) + 1 + gitBlock + (showArchitect ? 6 : 0) + (cards.length > cfg.maxCards ? 3 + Math.min(6, cards.length) : 8) + (expandedCard ? 8 : 0) + (lp.length ? 1 : 0) + 3
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const nLog = logRows(bodyRows, used)
    const shownLines = (viewed ? lines.filter(l => l.agentId === viewed) : lines).slice(-nLog)
    const colorOf = (l: LogLine) =>
      l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent
    const logPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} marginTop={1} width={w}>
        <Text dimColor>{viewed ? 'session log · this agent' : 'session log'}</Text>
        {shownLines.length === 0 ? <Text color={C.faint}>nothing yet</Text> : null}
        {shownLines.map(l => (
          <Box>
            <Box width={9} flexShrink={0}>
              <Text color={C.faint}>{fmtClock(l.at)}</Text>
            </Box>
            <Box width={13} flexShrink={0}>
              <Text color={colorOf(l)} bold wrap="truncate">
                {l.who}
              </Text>
            </Box>
            <Text color={l.kind === 'error' ? C.warn : C.text} wrap="truncate">
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const draw = (p: Panel, w: number, isNarrow = false) =>
      p === 'main'
        ? mainPanel(w, isNarrow)
        : p === 'codex'
          ? codexPanel(w, isNarrow)
          : p === 'git'
            ? gitPanel(w, isNarrow)
            : p === 'architect'
          ? architectPanel(w)
          : p === 'gate'
            ? gatePanel(w, isNarrow)
            : p === 'agents'
              ? agentsPanel(w)
              : p === 'loops'
                ? loopsPanel(w)
                : p === 'receipt'
                  ? receiptPanel(w)
                  : logPanel(w)

    // Panels with the flow between them; the agents panel draws its own rails. A pair has no rail above
    // it: two boxes side by side, stretched to the taller one's height.
    const column = (ps: readonly ColumnRow[], w: number) => (
      <Box flexDirection="column" width={w}>
        {ps.map((p, i) => {
          if (p === 'ctx') return ctxLine(w)
          if (typeof p !== 'string') {
            const [leftW, rightW] = pairWidths(w) ?? [w, w]
            return (
              <Box flexDirection="column">
                <Box flexDirection="row" alignItems="stretch" columnGap={1} width={w}>
                  {draw(p[0], leftW, true)}
                  {draw(p[1], rightW, true)}
                </Box>
              </Box>
            )
          }
          const prev = ps[i - 1]
          const link =
            i === 0 || p === 'codex' || p === 'git' || p === 'agents' || prev === 'agents' || p === 'log' || p === 'loops' || prev === 'loops'
              ? null
              : rail(`link-${p}`, p === 'architect' ? advising : m.isRunning, p === 'architect' ? C.arch : C.main, w)
          return (
            <Box flexDirection="column">
              {link}
              {draw(p, w)}
              {p === 'agents' ? expandedPanel(w) : null}
            </Box>
          )
        })}
      </Box>
    )

    // Desktop draws the agents' time axis as SVG under the panels.
    const svgLanes =
      e.surface !== 'terminal' && cards.length > 0
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            const rowH = 18
            const pxW = 520
            const geo = lanes(cards.slice(-10), now, 100)
            const rects = cards
              .slice(-10)
              .map((c, i) => {
                const gm = geo[i]
                const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
                const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
                const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
                const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
                return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
              })
              .join('')
            const svgH = Math.min(10, cards.length) * rowH + 4
            return (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
                alt={`${cards.length} agents on a time axis`}
                width={pxW}
                height={svgH}
              />
            )
          })()
        : null

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    if (isMini) {
      // Codex and the branch share one row; while it shows, one agent row fewer keeps the summary at 8.
      const windows = claudeWindows(u.limits, now)
      const vitals = [
        fableWindow ? windowShort(fb?.isStale ? 'Fable~' : 'Fable', fableWindow, now) : null,
        cx ? `Codex ${windowShort('5h', cx.fiveHour, now)} · ${windowShort('weekly', cx.weekly, now)}` : null,
        gs ? `🔀 ${gs.branch} ${unreviewedLabel(gs)} · ${changedLabel(gs)}` : null,
      ].filter(Boolean)
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, Math.max(1, 3 - (vitals.length > 0 ? 1 : 0) - (banner ? 1 : 0)))
      const counts = ` ${s.rule} allowed · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} pending` : ''} · ${s.deny} denied`
      const strip = g.recent.slice(-Math.max(4, W - cells(cfg.gateLabel) - 1 - cells(counts)))
      const mg = u.pct !== null ? gauge(u.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          <Text wrap="truncate">
            <Text color={C.main} bold>
              {modelName}
            </Text>
            <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? ' ● working' : ' ○ idle'}</Text>
            {mg ? <Text dimColor> · ctx </Text> : null}
            {mg ? <Text color={(u.pct ?? 0) >= 80 ? C.warn : C.main}>{mg.on}</Text> : null}
            {mg ? <Text color={C.faint}>{mg.off}</Text> : null}
            {mg ? <Text>{` ${Math.round(u.pct ?? 0)}%`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{` ⟲${u.compactions}`}</Text> : null}
            {windows ? <Text dimColor>{` · ${windows}`}</Text> : null}
            {showArchitect ? <Text color={C.arch}>{` · ${cfg.architectLabel.toLowerCase()} ${advising ? 'advising' : a.consults.length}`}</Text> : null}
          </Text>
          {banner ? (
            <Text color={C.warn} bold wrap="truncate">
              {banner}
            </Text>
          ) : null}
          {vitals.length > 0 ? (
            <Text color={C.dim} wrap="truncate">
              {vitals.join('   ')}
            </Text>
          ) : null}
          {strip.length > 0 ? (
            <Box>
              <Text dimColor>{`${cfg.gateLabel.toLowerCase()} `}</Text>
              {strip.map(c => (
                <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                  {c.verdict === 'deny' ? '✗' : '■'}
                </Text>
              ))}
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box>
              <Text color={statusColor(c)}>{`${glyph(c)} `}</Text>
              <Box width={Math.max(10, W - 30)}>
                <Text wrap="truncate">{cardTitle(c)}</Text>
              </Box>
              <Text dimColor>{c.steps > 0 ? ` ctx ${kTokens(c.ctx)} ` : ' '}</Text>
              {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.faint} wrap="truncate">{`+${cards.length - live.length} more agents · /dashboard layout compact for all`}</Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor>{`other loops ${lp.length} · ${lp.filter(l => isLoopActive(l, now)).length} active`}</Text> : null}
          {!m.isRunning && r ? (
            <Text dimColor wrap="truncate">
              {receiptText(r)}
            </Text>
          ) : null}
        </Box>
      )
    }

    const legend = fitLegend(
      [
        { label: 'main', color: C.main },
        { label: 'agents', color: C.agent },
        { label: cfg.gateLabel.toLowerCase(), color: C.gate },
        ...(showArchitect ? [{ label: cfg.architectLabel.toLowerCase(), color: C.arch }] : []),
        ...(panels.includes('codex') ? [{ label: 'Codex', color: C.codex }] : []),
        ...(panels.includes('git') ? [{ label: 'branch', color: C.branch }] : []),
      ],
      W,
    )

    const body = isWide ? (
      <Box flexDirection="column">
        <Box columnGap={2}>
          {column(withContext(panels.filter(p => p === 'main' || p === 'codex' || p === 'architect' || p === 'gate')), colW)}
          {column(panels.filter(p => p === 'git' || p === 'agents' || p === 'loops' || p === 'receipt'), colW)}
        </Box>
        {panels.includes('log') ? logPanel(W) : null}
      </Box>
    ) : (
      column(rows, W)
    )

    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center">
          <Text bold wrap="truncate">
            <Text>CC DASHBOARD</Text>
            <Text color={C.dim}> · </Text>
            <Text color={C.main}>{modelName.toUpperCase()}</Text>
            <Text>{m.isRunning ? ' WORKS' : ' IDLE'}</Text>
            {showArchitect ? <Text color={C.dim}> · </Text> : null}
            {showArchitect ? <Text color={C.arch}>{cfg.architectLabel}</Text> : null}
            {showArchitect ? <Text>{advising ? ' ADVISING' : ' ON CALL'}</Text> : null}
          </Text>
        </Box>
        <Box justifyContent="center" columnGap={2}>
          {legend.map(l => (
            <Text>
              <Text color={l.color}>■</Text>
              <Text dimColor>{` ${l.label}`}</Text>
            </Text>
          ))}
        </Box>
        {banner ? (
          <Text color={C.warn} bold wrap="truncate">
            {banner}
          </Text>
        ) : null}
        {body}
        {svgLanes}
      </Box>
    )
  })
}
