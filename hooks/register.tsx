import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, ToolCallResult } from 'claude-code'

import type { CodexQuota, GitSnap, LiveSession, WaitReason, WaitingRow } from '../types'
import { HEAD_CHARS, describeCodex, sessionIdFrom } from './lib/codex'
import { callEnd } from './lib/codex-call'
import { findCodex } from './lib/codex-state'
import { ROLLOUT_QUERY, readCodexQuota } from './lib/codex-quota'
import { effortLabel } from './lib/format'
import { isPersonPrompt, isReviewCall, isReviewPrompt, snapOf } from './lib/git'
import { GIT_TIMEOUT_MS, readTree } from './lib/git-tree'
import type { GitRun, Inspect, Tree } from './lib/git-tree'
import { paneRowsFor } from './lib/layout'
import { parseNotifications } from './lib/notify'
import type { Notification } from './lib/notify'
import {
  CLAUDE_MS,
  CODEX_MS,
  GIT_MS,
  OTHERS_MS,
  PUMP_MS,
  REFRESH_SOURCES,
  SESSIONS_MS,
  WAIT_MS,
  dueSources,
} from './lib/poll'
import type { Source } from './lib/poll'
import { FABLE_POLL_MS, claudeWindows, fableFromUsage, nextFableDelay } from './lib/quota'
import { readReviewed, recordReviewed } from './lib/review-store'
import type { ReviewStore } from './lib/review-store'
import { readLiveSessions } from './lib/sessions'
import { advisorModelOf, advisorTimes, listedAgents, spawnEvent } from './lib/signals'
import { powershellExe, tasklistExe } from './lib/system'
import { apply, initialState, isActive, nextRowExpiry } from './lib/state'
import type { DashEvent } from './lib/state'
import { serial } from './lib/serial'
import { isQuestionTool, markPath, markText, readWaits, sameWaits } from './lib/waiting'
import { FRAME_MS, dashboardTree } from './views'

// The I/O edge. `$` is followed only into functions declared in this file, so
// everything that reaches the engine is spelled out here; what the engine
// reports becomes a DashEvent, the reducer in ./lib/state folds it in, and
// ./views draws the state. Nothing is faked: every figure comes from an event
// or a `$` call below.

const PANE = 'dashboard'
/** Every Nth tick of the animation also looks at the agent list. */
const AGENT_SYNC_EVERY = 4
const AGENT_RESYNC_MS = 1000

const dash = atom({ plugin: 'cc-dashboard', key: 'dash' } as const, initialState)
// Set once the pane has been opened on its own, so a hot reload does not reopen one the person closed.
const autoOpened = atom({ plugin: 'cc-dashboard', key: 'autoOpened' } as const, false)
// The body rows the pane has asked for, once the terminal's height is known.
const paneRows = atom({ plugin: 'cc-dashboard', key: 'paneRows' } as const, undefined as number | undefined)
// The 分支 panel's list of unreviewed paths is unfolded: only the person's `u` changes it.
const unreviewedOpen = atom({ plugin: 'cc-dashboard', key: 'unreviewedOpen' } as const, false)
// The panels the person folded to their title line (hotkeys 1 and 2): session UI state, kept across /clear.
const folded = atom({ plugin: 'cc-dashboard', key: 'folded' } as const, { quota: false, git: false })
// This session's own wait on the person, null when there is none (see "Wait marks").
const waiting = atom({ plugin: 'cc-dashboard', key: 'waiting' } as const, null as { reason: WaitReason; sinceMs: number } | null)
// The live Claude Code sessions, from the registry and the process table.
const sessions = atom({ plugin: 'cc-dashboard', key: 'sessions' } as const, [] as LiveSession[])

const swallow = (): void => undefined

// The redraw timer runs only while something is: it starts with work and is
// cancelled when the last of it ends, so an idle session has no timer at all.
let timer: Timer | undefined
let ticks = 0

const syncAgents = async ($: EngineInterface): Promise<void> => {
  const agents = listedAgents(await $.agent.list())

  await dispatch($, { type: 'agents-sync', at: await $.clock.now(), agents })
}

// Only a pane that is showing is worth redrawing. When it is not, the timer
// stops; the next event, or opening the pane, starts it again.
const isPaneShown = async ($: EngineInterface): Promise<boolean> =>
  (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)

const onTick = async ($: EngineInterface): Promise<void> => {
  if (!(await isPaneShown($))) {
    timer?.cancel()
    timer = undefined

    return
  }
  ticks += 1
  $.ui.invalidate('ui.render')
  if (ticks % AGENT_SYNC_EVERY === 0) void syncAgents($).catch(swallow)
}

const refreshTimer = async ($: EngineInterface): Promise<void> => {
  const isBusy = isActive(await read($, dash))

  if (isBusy && timer === undefined) {
    ticks = 0
    timer = $.clock.every(FRAME_MS, () => void onTick($).catch(swallow))
  } else if (!isBusy && timer !== undefined) {
    timer.cancel()
    timer = undefined
  }
}

// A finished row leaves the boxes a minute after it ended, and the frame timer
// above is stopped by then. So one one-shot redraw waits for the next expiry:
// never more than one at a time, re-aimed when the next expiry changes, and
// gone when no row is left to expire.
let expiryTimer: Timer | undefined
let expiryAt: number | undefined
// The aims run one after another, each reading the state as it stands then: an older read
// that finishes late cannot cancel the timer a newer one set.
const inExpiryOrder = serial()

const aimExpiry = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  const next = nextRowExpiry(await read($, dash), now)
  if (next === expiryAt) return

  expiryTimer?.cancel()
  expiryAt = next
  expiryTimer =
    next === undefined
      ? undefined
      : $.clock.after(next - now, () => {
          expiryAt = undefined
          expiryTimer = undefined
          $.ui.invalidate('ui.render')
          void scheduleExpiry($).catch(swallow)
        })
}

const scheduleExpiry = ($: EngineInterface): Promise<void> => inExpiryOrder(() => aimExpiry($))

async function dispatch($: EngineInterface, event: DashEvent): Promise<void> {
  await update($, dash, state => apply(state, event))
  await refreshTimer($)
  await scheduleExpiry($)
}

// The dashboard is a display: an event it cannot record (the clock, the state)
// never reaches the engine's own event.
const record = async ($: EngineInterface, build: (at: number) => DashEvent): Promise<void> => {
  try {
    await dispatch($, build(await $.clock.now()))
  } catch {
    // Dropped on purpose: see above.
  }
}

// The settings are read afresh at each turn: /advisor can change the model mid-session.
const readAdvisorModel = async ($: EngineInterface): Promise<string | undefined> =>
  advisorModelOf(await $.settings.read().catch(() => ({})))

// The context fill and the five-hour and weekly windows, from the engine's own figures.
const refreshUsage = async ($: EngineInterface): Promise<void> => {
  const { context, rateLimits } = await $.session.usage()

  await dispatch($, { type: 'context', context })
  await dispatch($, { type: 'claude-quota', ...claudeWindows(rateLimits) })
}

// What a session starts from: its model, how many turns it has had, the advisor
// setting and the context fill. Each look-up that fails leaves its field blank.
const initSession = async ($: EngineInterface, turns: number): Promise<void> => {
  const model = await $.session.model().catch(() => undefined)
  const advisorModel = await readAdvisorModel($)

  if (model !== undefined) await dispatch($, { type: 'session', model, turns, advisorModel })
  else await dispatch($, { type: 'advisor-model', model: advisorModel })
  await refreshUsage($).catch(swallow)
}

// The pane's width is left to the dock; its height is asked for once the
// terminal's is known (see sizePane). Each open sets the request anew, so it
// is repeated on every open.
const openPane = async ($: EngineInterface, isAsked: boolean, asking?: number) => {
  const rows = asking ?? (await read($, paneRows))
  const pane = { id: PANE, title: 'Dashboard', ...(rows === undefined ? {} : { rows }) }

  return $.ui.open(isAsked ? { ...pane, focus: true } : pane)
}

const sizePane = async ($: EngineInterface, terminalRows: number): Promise<void> => {
  if ((await read($, paneRows)) !== undefined) return

  // Kept only once the engine took the request: a refused one is asked again at the next drawing.
  const rows = paneRowsFor(terminalRows)
  await openPane($, false, rows)
  await update($, paneRows, () => rows)
}

// The terminal's height is first told to a drawing (`viewport.rows`), not at
// start. The first time it is seen the pane asks for its share of it, once;
// later drawings and opens only repeat that number. Drawing is pure (no state
// writes, no opening), so the ask is made from a timer of its own.
let isSizing = false

const scheduleSizing = ($: EngineInterface, terminalRows: number | undefined): void => {
  if (terminalRows === undefined || isSizing) return
  isSizing = true
  $.clock.after(
    0,
    () =>
      void sizePane($, terminalRows).catch(() => {
        isSizing = false
      }),
  )
}

// Close the pane when it is showing; otherwise open it, which also brings up a
// pane behind another tab or waiting undrawn for a wider terminal.
const togglePane = async ($: EngineInterface): Promise<void> => {
  if (await isPaneShown($)) {
    await $.ui.close({ id: PANE })

    return
  }
  await openPane($, true)
  await refreshTimer($)
  void pumpPolls($).catch(swallow)
}

// A turn of the main conversation: the engine's own count wins when it is
// ahead, and a session met for the first time here is read in first.
const startTurn = async ($: EngineInterface): Promise<void> => {
  const turns = await $.session.turns().catch(() => 0)

  if ((await read($, dash)).main.model === undefined) await initSession($, 0)
  else await dispatch($, { type: 'advisor-model', model: await readAdvisorModel($) })
  await dispatch($, { type: 'turn-start', at: await $.clock.now(), turns })
}

// --- Git ----------------------------------------------------------------------
// The 分支 panel. The session's repository is read with read-only git (the
// commands are spelled in ./lib/git-tree, which is handed this runner); the
// panel counts as unreviewed the changed files whose contents the last review
// did not see. What a review saw is the one thing this plugin writes: under
// `git-reviewed:<root>` in its own `$.store` (see recordReview).

const gitRun = ($: EngineInterface): GitRun => (argv, init) =>
  $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS, ...init })

// The store's calls, handed to ./lib/review-store (which caps what is kept in it).
const reviewStore = ($: EngineInterface): ReviewStore => ({
  get: key => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
  delete: key => $.store.delete(key),
  keys: () => $.store.keys(),
})

// Whether a path is a link, and where it lands (a junction lands elsewhere without being a link); one that cannot be checked counts as a link.
const inspect = ($: EngineInterface): Inspect => path =>
  $.fs.stat(path, { resolve: true }).then(
    stat => ({ isLink: stat.isLink, ...(stat.realPath === undefined ? {} : { realPath: stat.realPath }) }),
    () => ({ isLink: true }),
  )

const readGitTree = ($: EngineInterface): Promise<Tree | undefined> => readTree(gitRun($), inspect($))

// The repository as the panel shows it; null outside one. A git that cannot be run rejects.
const lookAtGit = async ($: EngineInterface): Promise<GitSnap | null> => {
  const tree = await readGitTree($)
  if (tree === undefined) return null

  return snapOf(tree.status, tree.hashes, await readReviewed(reviewStore($), tree.root))
}

// A git that cannot be run empties the panel: figures that may be old are not kept.
const refreshGit = async ($: EngineInterface): Promise<void> => {
  await dispatch($, { type: 'git', git: await lookAtGit($).catch(() => null) })
}

const readTreeQuietly = ($: EngineInterface): Promise<Tree | undefined> => readGitTree($).catch(() => undefined)

// The tree read as a review started is what that review saw: once the review is
// under way (not refused, not failed) those contents count as reviewed. This
// runs on the review's own event, whether or not the pane is showing.
const recordReview = async ($: EngineInterface, tree: Tree | undefined): Promise<void> => {
  if (tree?.hashes === undefined) return

  const kept = await recordReviewed(reviewStore($), tree.root, tree.hashes)
  await dispatch($, { type: 'git', git: snapOf(tree.status, tree.hashes, kept) })
}

// --- Wait marks ---------------------------------------------------------------
// A session that waits on the person (a permission dialog, a question or a plan
// to approve) says so in a small mark file named by its pid, in the folder
// status-sidebar uses, in its format: sessions running either mod see each
// other. The marks are the only files written here. Writing this session's own
// is driven by events and happens whether or not the pane shows. Reading the
// others' (and the registry and process table that say which marks to trust)
// only serves the banner, so it waits for the pane to show.

// The pid names this session's mark; the registry gives it. Until it is known
// nothing waits for it, so a dialog is never held up on it.
let herePid: number | undefined
let pidLookup: Promise<void> | undefined
// Calls whose permission is put to the decider, so a dialog's wait ends with its own call.
const asked = new Set<string>()

// The live sessions: the registry Claude Code keeps in ~/.claude/sessions, kept
// to the pids still running as Claude Code (a crash leaves its file behind and
// pids get reused). A registry or process table that cannot be read leaves no
// sessions, and so no banner.
const refreshSessions = async ($: EngineInterface): Promise<void> => {
  try {
    const home = await $.env.get('USERPROFILE')
    if (home === undefined) throw new Error('USERPROFILE is not set')
    const root = await $.env.get('SystemRoot')
    if (root === undefined) throw new Error('SystemRoot is not set')

    const rows = await readLiveSessions(home, await $.session.id(), {
      list: dir => $.fs.list(dir),
      read: path => $.fs.read(path).catch(() => ''),
      tasklist: () => $.process.run([tasklistExe(root), '/FO', 'CSV', '/NH'], { timeoutMs: 15000 }),
    })
    herePid = rows.find(row => row.isHere)?.pid ?? herePid
    await update($, sessions, () => rows)
  } catch (error) {
    await update($, sessions, () => [])
    throw error
  }
}

const learnPid = ($: EngineInterface): Promise<void> => {
  pidLookup ??= refreshSessions($)
    .catch(swallow)
    .finally(() => {
      pidLookup = undefined
    })

  return pidLookup
}

// What the mark says is the wait as it stands when the write begins, not as it stood when it was asked.
const putMark = async ($: EngineInterface): Promise<void> => {
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
const writeMark = ($: EngineInterface): Promise<void> => inMarkOrder(() => putMark($))

const setWaiting = async ($: EngineInterface, reason: WaitReason | null): Promise<void> => {
  if (((await read($, waiting))?.reason ?? null) === reason) return

  const value = reason === null ? null : { reason, sinceMs: await $.clock.now() }
  await update($, waiting, () => value)
  await writeMark($)
}

// A new prompt, the turn ending, or the session ending means whatever was asked is over.
const endWaiting = async ($: EngineInterface): Promise<void> => {
  asked.clear()
  await setWaiting($, null)
}

// A call that returned has had its question answered or its dialog closed.
// A permission wait ends once no call put to the decider is still pending.
const settleWait = async ($: EngineInterface, tool: string, toolUseId: string | undefined): Promise<void> => {
  if (toolUseId !== undefined) asked.delete(toolUseId)
  const now = (await read($, waiting))?.reason
  if ((now === 'question' && isQuestionTool(tool)) || (now === 'permission' && asked.size === 0)) await setWaiting($, null)
}

// The other live sessions that wait on the person: each one's mark, if the
// session id inside it is the session the registry names.
const readOthersWaiting = async ($: EngineInterface) => {
  const home = await $.env.get('USERPROFILE')

  return home === undefined ? [] : readWaits(home, await read($, sessions), path => $.fs.read(path).catch(() => ''))
}

// --- Polling ------------------------------------------------------------------
// Five sources are read on their own schedules, and only while the pane is
// showing: a pane nobody sees costs no request and no process. One pump looks
// at them every few seconds and starts whichever is due and not already
// running, so the schedules cannot overlap or double up.

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** When each source is next due, epoch ms; 0 is due now. */
const dueAt: Record<Source, number> = { claude: 0, fable: 0, codex: 0, git: 0, others: 0 }
// When the registry and process table were last read; a failure waits out the same interval.
let sessionsAt = 0
const running = new Set<Source>()
let pump: Timer | undefined

// Fable's weekly figure comes from /api/oauth/usage. The request is authorised
// by the engine's own handle (the credential never reaches this plugin), and
// only a bearer login can use that endpoint. A failed answer keeps the last
// figure and marks it stale. Resolves to how long to wait before asking again.
let fableDelayMs = FABLE_POLL_MS

const refreshFable = async ($: EngineInterface): Promise<number> => {
  const auth = await $.session.authorize().catch(() => null)
  const response =
    auth === null || auth.kind !== 'bearer'
      ? undefined
      : await $.http
          .fetch(USAGE_URL, {
            auth: auth.handle,
            headers: { 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
          })
          .catch(() => undefined)
  const fable = response?.ok === true ? fableFromUsage(response.text) : undefined

  await dispatch($, { type: 'fable', fable })
  fableDelayMs = nextFableDelay(fableDelayMs, response?.ok === true, response?.headers['retry-after'])

  return fableDelayMs
}

// Codex's figures are only displayed (see ./lib/codex-quota). The rollout's
// path rides in the environment, never in the command text.
const readCodex = async ($: EngineInterface): Promise<CodexQuota> => {
  const home = await $.env.get('USERPROFILE')
  if (home === undefined) return { note: 'USERPROFILE is not set' }
  const root = await $.env.get('SystemRoot')
  if (root === undefined) return { note: 'SystemRoot is not set' }

  return readCodexQuota(home, {
    readText: path => $.fs.read(path).catch(() => ''),
    list: dir => $.fs.list(dir),
    queryRollout: path =>
      $.process
        .run([powershellExe(root), '-NoProfile', '-NonInteractive', '-Command', ROLLOUT_QUERY], {
          env: { ROLLOUT: path },
          timeoutMs: 20000,
        })
        .then(done => done.stdout, () => ''),
  })
}

// The same waits as the last read change nothing: no write, no redraw.
const noteOthersWaiting = async ($: EngineInterface, rows: WaitingRow[]): Promise<void> => {
  if (sameWaits((await read($, dash)).waitingOthers, rows)) return

  await dispatch($, { type: 'waiting-others', rows })
}

// Whatever cannot be read leaves no banner: nothing is guessed.
const readOthers = async ($: EngineInterface): Promise<number> => {
  try {
    const now = await $.clock.now()
    if (now - sessionsAt >= SESSIONS_MS) {
      sessionsAt = now
      await refreshSessions($)
    }
    await noteOthersWaiting($, await readOthersWaiting($))
  } catch {
    await noteOthersWaiting($, [])
  }

  return OTHERS_MS
}

// Each source reads, then answers how long to wait before it is read again.
const readSource = async ($: EngineInterface, source: Source): Promise<number> => {
  switch (source) {
    case 'claude':
      await refreshUsage($)

      return CLAUDE_MS
    case 'fable':
      return refreshFable($)
    case 'codex':
      await dispatch($, { type: 'codex-quota', quota: await readCodex($) })

      return CODEX_MS
    case 'git':
      await refreshGit($)

      return GIT_MS
    case 'others':
      return readOthers($)
  }
}

// A read that throws is tried again after the usual wait, or for Fable after its next backoff.
const failureWait = (source: Source): number => {
  if (source !== 'fable') return WAIT_MS[source]
  fableDelayMs = nextFableDelay(fableDelayMs, false, undefined)

  return fableDelayMs
}

const runSource = async ($: EngineInterface, source: Source): Promise<void> => {
  running.add(source)
  try {
    const wait = await readSource($, source).catch(() => failureWait(source))

    dueAt[source] = (await $.clock.now()) + wait
  } finally {
    running.delete(source)
  }
}

async function pumpPolls($: EngineInterface): Promise<void> {
  if (!(await isPaneShown($))) return

  for (const source of dueSources(dueAt, running, await $.clock.now())) void runSource($, source).catch(swallow)
}

// 重新整理: every source but Fable is due now, and the registry is read afresh.
// The pump starts the due ones that are not already running, so a read in
// flight is not doubled; Fable keeps its own schedule and backoff.
const refreshNow = async ($: EngineInterface): Promise<void> => {
  for (const source of REFRESH_SOURCES) dueAt[source] = 0
  sessionsAt = 0
  await pumpPolls($)
}

// One pump per plugin instance: a second start (a hot reload) replaces the first.
const startPolling = async ($: EngineInterface): Promise<void> => {
  pump?.cancel()
  pump = $.clock.every(PUMP_MS, () => void pumpPolls($).catch(swallow))
}

// The first start opens the pane on its own, once: a hot reload does not reopen one the person closed.
const openOnce = async ($: EngineInterface): Promise<void> => {
  if (await read($, autoOpened)) return

  await update($, autoOpened, () => true)
  void openPane($, false).catch(swallow)
}

// --- Codex runs -------------------------------------------------------------
// `codex exec` runs the main session starts through Bash or PowerShell. The
// run is noted when the call begins and ended by its result, by the
// notification of a background task, or (inferred) by the next stop.

type ShellCall = { tool: string; tool_use_id: string; command: string; description?: string }

// A run's own failure (a throw from the tool) ends it as failed and goes on up.
const trackCodex = async (
  $: EngineInterface,
  call: ShellCall,
  run: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> => {
  const codex = describeCodex(call.command, call.description, call.tool === 'PowerShell' ? 'powershell' : 'bash')
  if (codex === undefined) return run()

  const toolUseId = call.tool_use_id
  await record($, at => ({ type: 'codex-start', at, toolUseId, ...codex }))
  try {
    const res = await run()
    await record($, callEnd(toolUseId, res)).catch(swallow)

    return res
  } catch (error) {
    await record($, at => ({ type: 'codex-end', at, id: toolUseId, ok: false }))
    throw error
  }
}

// What the output file of a finished background run holds is read once, from its head.
const readOutputHead = async ($: EngineInterface, path: string | undefined): Promise<string | undefined> =>
  path === undefined ? undefined : $.fs.read(path).then(text => text.slice(0, HEAD_CHARS), () => undefined)

const endBackground = async ($: EngineInterface, n: Notification): Promise<void> => {
  const at = await $.clock.now()
  const job = findCodex((await read($, dash)).codex, n.id, n.toolUseId)
  if (job === undefined) return

  const sessionId = job.sessionId ?? sessionIdFrom(await readOutputHead($, n.outputFile))
  await dispatch($, {
    type: 'codex-end',
    at,
    id: job.id,
    ok: n.ok,
    ...(sessionId === undefined ? {} : { sessionId }),
  })
}

const onNotifications = async ($: EngineInterface, body: string): Promise<void> => {
  for (const n of parseNotifications(body)) await endBackground($, n).catch(swallow)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: PANE, description: 'Toggle the CC dashboard pane', immediate: true }).catch(swallow)
    // None of the steps below may stop the ones after it: a failure leaves that step undone and the session going.
    await openOnce($).catch(swallow)
    await initSession($, await $.session.turns().catch(() => 0)).catch(swallow)
    await refreshTimer($).catch(swallow)
    await startPolling($).catch(swallow)
    void pumpPolls($).catch(swallow)
    // A fresh load writes the wait as it stands: none on a start, the open one when a reload lands while a dialog is up.
    void writeMark($).catch(swallow)

    return next(e)
  })

  // /clear and /resume carry on in this process with no session.start: the
  // state starts over and the next turn reads the new session in.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await dispatch($, { type: 'reset' }).catch(swallow)
    await endWaiting($).catch(swallow)

    return next(e)
  })

  // A pane that cannot open (no surface attached) is told to the person, not thrown.
  on('command.run', { command: PANE }, async $ => {
    await togglePane($)

    return {}
  }).catch(async (_$, _e, next) => ({ text: `dashboard: ${next.error.message}` }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await startTurn($).catch(swallow)
    } else {
      // A subagent that finished and is given a new turn is running again.
      await dispatch($, { type: 'agent-resume', id: e.agentId }).catch(swallow)
      await syncAgents($).catch(swallow)
    }

    return next(e)
  })

  // The main request names its model and effort; a subagent's names that
  // agent's model. The advisor runs inside the request, on the API's side, so
  // no tool hook sees it: it shows only in the finished step's `serverToolUses`.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await dispatch($, { type: 'step', model: e.model, effort: effortLabel(e.effort) }).catch(swallow)
    } else {
      await dispatch($, { type: 'agent-model', id: e.agentId, model: e.model }).catch(swallow)
    }

    const result = yield* next(e)

    for (const at of advisorTimes(result.serverToolUses)) {
      await dispatch($, { type: 'advisor-consult', at }).catch(swallow)
    }

    return result
  })

  // Only the main conversation's own calls are shown, and the result goes back
  // unchanged. A review is noted whoever starts it: the tree is read as the call
  // begins, and kept only if the call is not refused and does not fail. A
  // question put to the person is a wait from the call's start to its return,
  // whoever asks.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const review = isReviewCall(tool, e) ? readTreeQuietly($) : undefined
    if (isQuestionTool(tool)) await setWaiting($, 'question').catch(swallow)
    const shown = async () => {
      await record($, at => ({ type: 'tool-start', at, name: String(e.tool) }))

      const run = () => next(e)
      const result = e.tool === 'Bash' || e.tool === 'PowerShell' ? trackCodex($, e, run) : run()

      return result.finally(() => void dispatch($, { type: 'tool-end' }).catch(swallow))
    }
    const call = e.agentId === undefined ? shown() : next(e)
    const result = await call.finally(() => void settleWait($, tool, e.tool_use_id).catch(swallow))

    if (review !== undefined && result.deny === undefined && result.isError === undefined) {
      void review.then(tree => recordReview($, tree)).catch(swallow)
    }

    return result
  }).catch(async (_$, e, next) => next(e))

  // A background task's notification arrives as a prompt of its own origin. A
  // typed /code-review has no result to wait for: it counts as it is sent.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') await onNotifications($, e.text).catch(swallow)

    const result = await next(e)
    if (result.drop === undefined && isPersonPrompt(e.origin.kind)) {
      if (isReviewPrompt(e.text)) void readTreeQuietly($).then(tree => recordReview($, tree)).catch(swallow)
      // What the person types answers whatever was asked.
      await endWaiting($).catch(swallow)
    }

    return result
  }).catch(async (_$, e, next) => next(e))

  // A call put to the person's decision: its permission dialog opens (the engine
  // reports that below) and ends with the call.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) asked.add(e.tool_use_id)

    return verdict
  }).catch(async (_$, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await setWaiting($, 'permission').catch(swallow)

    return next(e)
  }).catch(async (_$, e, next) => next(e))

  // At the end of a turn the engine's own list of background tasks says which runs are still alive.
  on('classic.Stop', async ($, e, next) => {
    const liveIds = e.background_tasks?.map(task => task.id)
    await record($, at => ({ type: 'codex-stop', at, ...(liveIds === undefined ? {} : { liveIds }) }))

    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    if (result.deny === undefined && result.agentId !== undefined) {
      const id = result.agentId

      await record($, at => spawnEvent(e, id, result.model, at))
      await syncAgents($).catch(swallow)
    }

    return result
  }).catch(async (_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId

    if (agentId === undefined) {
      await record($, at => ({ type: 'turn-end', at, durationMs: e.durationMs }))
      // The turn may have changed files: the next pump reads git without waiting out its 30 seconds.
      dueAt.git = 0
      await endWaiting($).catch(swallow)
    } else {
      await record($, at => ({ type: 'agent-done', at, id: agentId, reason: e.reason }))
      await syncAgents($).catch(swallow)
      // The agent's list entry may still read `running` at this instant.
      $.clock.after(AGENT_RESYNC_MS, () => void syncAgents($).catch(swallow))
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    await dispatch($, { type: 'context', context: e.context }).catch(swallow)
    await dispatch($, { type: 'claude-quota', ...claudeWindows(e.rateLimits) }).catch(swallow)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    scheduleSizing($, e.viewport?.rows)
    const state = await read($, dash)
    const fold = await read($, folded)
    const view = {
      state,
      columns: e.props.bodyColumns,
      rows: e.props.scroll.bodyRows,
      now: await $.clock.now(),
      isUnreviewedOpen: await read($, unreviewedOpen),
      onToggleUnreviewed: () => void update($, unreviewedOpen, isOpen => !isOpen).catch(swallow),
      isQuotaFolded: fold.quota,
      isGitFolded: fold.git,
      onToggleQuota: () => void update($, folded, now => ({ ...now, quota: !now.quota })).catch(swallow),
      onToggleGit: () => void update($, folded, now => ({ ...now, git: !now.git })).catch(swallow),
      onRefresh: () => void refreshNow($).catch(swallow),
    }

    return dashboardTree($.ui.resolve(e), view)
  })
}
