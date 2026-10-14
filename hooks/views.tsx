import type { Elements, RenderSurface } from 'claude-code'

import type { AgentRow, AgentStatus, CodexJob, CodexStatus, DashState, LogKind } from '../types'
import { shownCodex, visibleCodex } from './lib/codex-state'
import {
  activityText,
  bar,
  clock,
  codexIcon,
  codexStatusText,
  duration,
  logText,
  modelLabel,
  plain,
  statusIcon,
  swarmLabel,
  tokens,
  track,
} from './lib/format'
import { footerHint } from './lib/footer'
import { canUnfold, gitNeed } from './lib/git-rows'
import { planLayout } from './lib/layout'
import type { Plan } from './lib/layout'
import { quotaRows } from './lib/quota-rows'
import { hasAdvisor, isActive, isLive, visibleAgents } from './lib/state'
import { bannerText } from './lib/waiting'
import { GitBox, GitLine } from './git-view'
import { QuotaBox, QuotaLines } from './quota-view'

/** The three elements the dashboard draws with; every surface's table has them. */
export type Els = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

export type View = {
  state: DashState
  columns: number
  rows: number
  now: number
  /** The 分支 panel's list of unreviewed paths is unfolded (it only shows when there are some). */
  isUnreviewedOpen: boolean
  onToggleUnreviewed: () => void
  /** The quota header and the 分支 panel, each folded to its title line by the person (hotkeys 1 and 2). */
  isQuotaFolded: boolean
  isGitFolded: boolean
  onToggleQuota: () => void
  onToggleGit: () => void
  /** The Footer's 重新整理 button. */
  onRefresh: () => void
}

const MAIN = '#ff9d4d'
const SWARM = '#5aa9ff'
const ADVISOR = '#b48cff'
const CODEX = '#3dd6a8'
const OK = 'success'
const BAD = 'error'

/** One animation step; the redraw timer runs at the same rate. */
export const FRAME_MS = 250
const SPIN = ['◐', '◓', '◑', '◒']
const OUT_LABEL = ' ▼ dispatch'
const BACK_LABEL = ' ▲ to main'
const BAR_MIN = 4
const BAR_MAX = 30

const STATUS_COLOR: Record<AgentStatus, string | undefined> = {
  pending: SWARM,
  running: SWARM,
  waiting: 'warning',
  idle: undefined,
  completed: OK,
  failed: BAD,
  killed: BAD,
}

const LOG_COLOR: Record<LogKind, string | undefined> = {
  'turn-start': undefined,
  'turn-end': OK,
  tool: MAIN,
  spawn: SWARM,
  'agent-end': SWARM,
  advisor: ADVISOR,
  'codex-start': CODEX,
  'codex-done': CODEX,
  'codex-fail': CODEX,
}

const CODEX_STATUS_COLOR: Record<CodexStatus, string> = { running: CODEX, done: OK, failed: BAD }

type Parts = { els: Els; view: View; plan: Plan; frame: number }

const effortSuffix = (effort: string | undefined): string => (effort === undefined ? '' : ` · ${plain(effort)}`)

const mainModel = (view: View): string => `${modelLabel(view.state.main.model)}${effortSuffix(view.state.main.effort)}`

const mainIcon = (state: DashState, frame: number): string =>
  state.main.activity.kind === 'idle' ? '○' : (SPIN[frame % SPIN.length] ?? '◐')

const mainLine = ({ view, frame }: Parts): string => {
  const { main } = view.state
  const elapsed = main.turnStartedAt === undefined ? '' : ` · ${duration(view.now - main.turnStartedAt)}`

  return `${mainIcon(view.state, frame)} ${activityText(main.activity)} · 回合 ${main.turns}${elapsed}`
}

// Only drawn while an advisor is in play (see hasAdvisor): a model is set, or it has been consulted.
const advisorModelLine = (state: DashState): string =>
  state.advisor.model === undefined ? 'on' : modelLabel(state.advisor.model)

const advisorDetail = (state: DashState): string => {
  const { consults, lastAt } = state.advisor
  if (consults === 0) return '尚未諮詢'

  return `${consults} 次 · ${lastAt === undefined ? '—' : clock(lastAt)}`
}

// An agent first seen in the list has no known start: its elapsed time is unknown.
const agentElapsed = (row: AgentRow, now: number): string =>
  row.startedAt === undefined ? '—' : duration((isLive(row.status) ? now : (row.endedAt ?? now)) - row.startedAt)

const codexElapsed = (job: CodexJob, now: number): string =>
  duration((job.status === 'running' ? now : (job.endedAt ?? now)) - job.startedAt)

// The session is shown only once a command, an output or a notification named it.
const codexSession = (job: CodexJob): string => `session ${job.sessionId ?? '—'}`

const Header = ({ els, view }: Parts) => {
  const { Box, Text } = els

  return (
    <Box key="header" flexDirection="row">
      <Text bold>CC DASHBOARD</Text>
      <Text dimColor wrap="truncate-end">{` · ${mainModel(view)}`}</Text>
    </Box>
  )
}

const Legend = ({ els, view }: Parts) => {
  const { Box, Text } = els
  const { state } = view
  const swarm = swarmLabel(state.agents.map(a => a.model))

  return (
    <Box key="legend" flexDirection="row" columnGap={2}>
      <Text color={MAIN} wrap="truncate-end">{`■ ${modelLabel(state.main.model)} · lead`}</Text>
      <Text color={SWARM} wrap="truncate-end">{`■ ${swarm} · swarm`}</Text>
      {hasAdvisor(state) ? <Text color={ADVISOR} wrap="truncate-end">{`■ ${advisorModelLine(state)} · advisor`}</Text> : null}
      {shownCodex(state.codex, view.now).length === 0 ? null : <Text color={CODEX} wrap="truncate-end">■ Codex</Text>}
    </Box>
  )
}

const MainBox = (parts: Parts) => {
  const { Box, Text } = parts.els

  return (
    <Box key="main" borderStyle="round" borderColor={MAIN} flexDirection="column" paddingX={1}>
      <Text bold color={MAIN} wrap="truncate-end">{`MAIN  ${mainModel(parts.view)}`}</Text>
      <Text wrap="truncate-end">{mainLine(parts)}</Text>
    </Box>
  )
}

const Connector = ({ els, view, frame }: Parts, direction: 'forward' | 'back') => {
  const { Box, Text } = els
  const label = direction === 'forward' ? OUT_LABEL : BACK_LABEL
  const isRunning = view.state.agents.some(a => a.status === 'running' || a.status === 'pending')
  const isMoving = direction === 'forward' ? isActive(view.state) : isRunning
  const line = `  ${track(Math.max(0, view.columns - 2 - label.length), frame, direction, isMoving)}${label}`

  return (
    <Box key={`flow-${direction}`}>
      <Text color={direction === 'forward' ? MAIN : SWARM} dimColor={!isMoving} wrap="truncate-end">
        {line}
      </Text>
    </Box>
  )
}

const AdvisorBox = ({ els, view, plan }: Parts) => {
  const { Box, Text } = els

  return (
    <Box key="advisor" width={plan.sideWidth} borderStyle="round" borderColor={ADVISOR} flexDirection="column" paddingX={1}>
      <Text bold color={ADVISOR}>ADVISOR</Text>
      <Text wrap="truncate-end">{advisorModelLine(view.state)}</Text>
      <Text dimColor wrap="truncate-end">{advisorDetail(view.state)}</Text>
    </Box>
  )
}

const AgentBox = ({ els, view }: Parts, row: AgentRow) => {
  const { Box, Text } = els
  const color = STATUS_COLOR[row.status]

  return (
    <Box key={`agent-${row.id}`} borderStyle="round" borderColor={SWARM} flexDirection="column" paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text color={color}>{statusIcon(row.status)}</Text>
        <Text bold wrap="truncate-end">{`${plain(row.type)} · ${modelLabel(row.model)}`}</Text>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text dimColor wrap="truncate-end">{plain(row.description)}</Text>
        <Box flexShrink={0}>
          <Text dimColor>{agentElapsed(row, view.now)}</Text>
        </Box>
      </Box>
    </Box>
  )
}

// Beside the ADVISOR column with a gap between; alone, it has the whole width.
const AgentColumn = (parts: Parts) => {
  const { Box } = parts.els
  const rows = visibleAgents(parts.view.state.agents, parts.plan.agentSlots, parts.view.now)

  if (rows.length === 0) return null

  return (
    <Box key="agents" flexDirection="column" flexGrow={1} {...(hasAdvisor(parts.view.state) ? { marginLeft: 1 } : {})}>
      {rows.map(row => AgentBox(parts, row))}
    </Box>
  )
}

const CodexRow = ({ els, view }: Parts, job: CodexJob) => {
  const { Box, Text } = els

  return (
    <Box key={`codex-${job.id}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexShrink={1} columnGap={1}>
        <Text color={CODEX_STATUS_COLOR[job.status]} wrap="truncate-end">
          {`${codexIcon(job.status)} ${codexStatusText(job.status)} · ${plain(job.purpose)}`}
        </Text>
        {job.note === undefined ? null : <Text dimColor wrap="truncate-end">{plain(job.note)}</Text>}
      </Box>
      <Box flexShrink={0} columnGap={1}>
        <Text dimColor>{codexSession(job)}</Text>
        <Text dimColor>{codexElapsed(job, view.now)}</Text>
      </Box>
    </Box>
  )
}

// Hidden entirely when there are no runs (or no room for one).
const CodexBox = (parts: Parts) => {
  const { Box, Text } = parts.els
  const rows = visibleCodex(parts.view.state.codex, parts.plan.codexSlots, parts.view.now)
  if (rows.length === 0) return null

  return (
    <Box key="codex" borderStyle="round" borderColor={CODEX} flexDirection="column" paddingX={1}>
      <Text bold color={CODEX}>CODEX</Text>
      {rows.map(job => CodexRow(parts, job))}
    </Box>
  )
}

// The context window as the engine last measured it: how much is used, as a bar, a percent and tokens/window.
const ContextRow = ({ els, view }: Parts) => {
  const { Box, Text } = els
  const ctx = view.state.context
  if (ctx === null) {
    return (
      <Box key="context">
        <Text dimColor>Context —</Text>
      </Box>
    )
  }
  const percent = ctx.percent
  const used = ctx.tokens === undefined ? '—' : tokens(ctx.tokens)
  const tail = ` ${percent === undefined ? '—' : `${percent}%`}  ${used}/${tokens(ctx.window)}`
  const width = Math.min(BAR_MAX, Math.max(BAR_MIN, view.columns - 'Context '.length - tail.length))
  const color = percent === undefined || percent < 70 ? OK : percent < 90 ? 'warning' : BAD

  return (
    <Box key="context">
      <Text color={color} wrap="truncate-end">{`Context ${bar(percent ?? 0, width)}${tail}`}</Text>
    </Box>
  )
}

// The quota header always shows: unknown figures are dashes, never invented.
const quotaHeader = ({ els, view }: Parts, mode: 'wide' | 'narrow') => {
  const rows = quotaRows(view.state, view.now)
  const fold = { isFolded: view.isQuotaFolded, onToggle: view.onToggleQuota }

  return mode === 'wide' ? QuotaBox(els, rows, view.columns, fold) : QuotaLines(els, rows, fold)
}

// One line, only while another live session is held on the person; no rows otherwise.
const WaitBanner = ({ els, view }: Parts) => {
  const { Box, Text } = els
  const line = bannerText(view.state.waitingOthers, view.now)
  if (line === undefined) return null

  return (
    <Box key="wait-banner">
      <Text bold color={BAD} wrap="truncate-end">{line}</Text>
    </Box>
  )
}

// The hotkey hints and the refresh button; the plan drops it first when rows are short.
const Footer = ({ els, view, plan }: Parts) => {
  const { Box, Text, Button } = els
  if (!plan.hasFooter) return null

  const git = view.state.git
  const hint = footerHint(git !== null, canUnfold(git) && !view.isGitFolded)

  return (
    <Box key="footer" flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Text dimColor wrap="truncate-end">{hint}</Text>
      <Box flexShrink={0}>
        <Button key="refresh" plain dimColor label="↻ 重新整理" onPress={view.onRefresh} />
      </Box>
    </Box>
  )
}

const LogSection = ({ els, view, plan }: Parts) => {
  const { Box, Text } = els
  const entries = plan.logLines === 0 ? [] : view.state.log.slice(-plan.logLines)

  return (
    <Box key="log" flexDirection="column">
      <Text bold>SESSION LOG</Text>
      {entries.length === 0 && plan.logLines > 0 ? <Text dimColor>尚無事件</Text> : null}
      {entries.map((entry, i) => (
        <Box key={`log-${entry.at}-${i}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Text dimColor>{clock(entry.at)}</Text>
          </Box>
          <Text color={LOG_COLOR[entry.kind]} wrap="truncate-end">{logText(entry)}</Text>
        </Box>
      ))}
    </Box>
  )
}

// The panel as the plan places it; none outside a repository.
const gitView = ({ view, plan }: Parts, placement: 'column' | 'line') =>
  view.state.git === null || plan.git.placement !== placement
    ? undefined
    : {
        snap: view.state.git,
        isOpen: view.isUnreviewedOpen && !view.isGitFolded && canUnfold(view.state.git),
        onToggle: view.onToggleUnreviewed,
        isFolded: view.isGitFolded,
        onToggleFold: view.onToggleGit,
        plan: plan.git,
      }

const GitSummary = (parts: Parts) => {
  const git = gitView(parts, 'line')

  return git === undefined ? null : GitLine(parts.els, git)
}

// MAIN, the flow lines and the agents; with the 分支 column beside them they have the width it leaves.
const WideBody = (parts: Parts) => {
  const { Box } = parts.els
  const git = gitView(parts, 'column')
  const inner: Parts =
    git === undefined ? parts : { ...parts, view: { ...parts.view, columns: parts.view.columns - parts.plan.git.width } }
  const core = (
    <Box key="body-main" flexDirection="column" flexGrow={1}>
      {MainBox(inner)}
      {Connector(inner, 'forward')}
      <Box key="middle" flexDirection="row">
        {hasAdvisor(inner.view.state) ? AdvisorBox(inner) : null}
        {AgentColumn(inner)}
      </Box>
      {Connector(inner, 'back')}
    </Box>
  )

  return (
    <Box key="body" flexDirection="row">
      {core}
      {git === undefined ? null : GitBox(parts.els, git)}
    </Box>
  )
}

const WideLayout = (parts: Parts) => {
  const { Box } = parts.els

  return (
    <Box key="dash-wide" flexDirection="column">
      {quotaHeader(parts, 'wide')}
      {WaitBanner(parts)}
      {Header(parts)}
      {Legend(parts)}
      {WideBody(parts)}
      {CodexBox(parts)}
      {ContextRow(parts)}
      {GitSummary(parts)}
      {LogSection(parts)}
      {Footer(parts)}
    </Box>
  )
}

const NarrowAgent = ({ els, view }: Parts, row: AgentRow) => {
  const { Box, Text } = els
  const line = plain(`${statusIcon(row.status)} ${row.type} ${modelLabel(row.model)} ${row.description} ${agentElapsed(row, view.now)}`)

  return (
    <Box key={`agent-${row.id}`}>
      <Text color={SWARM} dimColor={!isLive(row.status)} wrap="truncate-end">
        {line}
      </Text>
    </Box>
  )
}

const NarrowCodex = ({ els, view }: Parts, job: CodexJob) => {
  const { Box, Text } = els
  const line = plain(`${codexIcon(job.status)} ${codexStatusText(job.status)} ${job.purpose} ${codexSession(job)} ${codexElapsed(job, view.now)}`)

  return (
    <Box key={`codex-${job.id}`}>
      <Text color={CODEX} dimColor={job.status !== 'running'} wrap="truncate-end">
        {line}
      </Text>
    </Box>
  )
}

const NarrowLayout = (parts: Parts) => {
  const { Box, Text } = parts.els
  const { state } = parts.view
  const agents = visibleAgents(state.agents, parts.plan.agentSlots, parts.view.now)

  return (
    <Box key="dash-narrow" flexDirection="column">
      {quotaHeader(parts, 'narrow')}
      {WaitBanner(parts)}
      {Header(parts)}
      <Box key="main">
        <Text color={MAIN} wrap="truncate-end">{`■ ${mainLine(parts)}`}</Text>
      </Box>
      {hasAdvisor(state) ? (
        <Box key="advisor">
          <Text color={ADVISOR} wrap="truncate-end">{`■ 顧問 ${advisorModelLine(state)} · ${advisorDetail(state)}`}</Text>
        </Box>
      ) : null}
      {agents.map(row => NarrowAgent(parts, row))}
      {visibleCodex(state.codex, parts.plan.codexSlots, parts.view.now).map(job => NarrowCodex(parts, job))}
      {ContextRow(parts)}
      {GitSummary(parts)}
      {LogSection(parts)}
      {Footer(parts)}
    </Box>
  )
}

/** The whole dashboard for a pane `view.columns` wide and `view.rows` tall. */
export const dashboardTree = (els: Els, view: View) => {
  const need = gitNeed(view.state.git, view.isUnreviewedOpen, view.isGitFolded)
  const bannerRows = view.state.waitingOthers.length > 0 ? 1 : 0
  const codexJobs = shownCodex(view.state.codex, view.now).length
  const plan = planLayout(view.columns, view.rows, codexJobs, need, bannerRows, {
    hasAdvisor: hasAdvisor(view.state),
    isQuotaFolded: view.isQuotaFolded,
    agentRows: visibleAgents(view.state.agents, Number.MAX_SAFE_INTEGER, view.now).length,
  })
  const parts: Parts = { els, view, plan, frame: Math.floor(view.now / FRAME_MS) }

  return plan.mode === 'wide' ? WideLayout(parts) : NarrowLayout(parts)
}
