// Which sections fit the pane. Pure: a width and a height in, a plan out; the
// views draw whatever the plan says and decide nothing about size themselves.

/** The share of the terminal's height the pane asks for while it sits inline above the prompt. */
const PANE_HEIGHT_SHARE = 0.6

/** The body rows the pane asks for, given the terminal's height. */
export const paneRowsFor = (terminalRows: number): number => Math.max(1, Math.floor(terminalRows * PANE_HEIGHT_SHARE))

/** Where the 分支 panel goes: `column` beside MAIN and the agents, `line` as one summary line above the log. */
export type GitPlan = { placement: 'none' | 'column' | 'line'; width: number; pathSlots: number }

export type Plan = {
  /** `wide`: boxes in columns. `narrow`: sections stacked, one line each. */
  mode: 'wide' | 'narrow'
  /** How many agent rows (wide: boxes of AGENT_ROWS lines) fit. */
  agentSlots: number
  /** How many session-log lines fit. */
  logLines: number
  /** The width of the advisor column in the wide layout. */
  sideWidth: number
  /** How many Codex runs fit: wide, a full-width block; narrow, one line each. */
  codexSlots: number
  /** The 分支 panel: its place, the column's width, and how many rows an unfolded list may take (its closing "N more" row included). */
  git: GitPlan
  /** The Footer line (hotkey hints and refresh) at the bottom; it is the first thing given up. */
  hasFooter: boolean
}

/**
 * What the 分支 panel asks of the layout: whether it exists, how many rows its
 * unfolded list wants, and whether the person folded it to its one line.
 */
export type GitNeed = { isPresent: boolean; listRows: number; isFolded?: boolean }

const MAX_AGENT_SLOTS = 4

/**
 * What the pane shows that changes how many rows it needs; what is left out
 * here is shown. `agentRows` is how many agent rows there are to draw (live
 * ones, and finished ones still within their minute): only that many are
 * reserved, up to the four slots, and the rest of the rows go to the log.
 */
export type Shown = { hasAdvisor: boolean; isQuotaFolded: boolean; agentRows: number }

const ALL_SHOWN: Shown = { hasAdvisor: true, isQuotaFolded: false, agentRows: MAX_AGENT_SLOTS }

/** The advisor column's width in the wide layout. */
export const SIDE_WIDTH = 24
export const WIDE_MIN_COLUMNS = 68
/** The width of the 分支 column; it appears when the left side keeps at least WIDE_MIN_COLUMNS. */
export const GIT_WIDTH = 30
export const GIT_COLUMN_MIN_COLUMNS = WIDE_MIN_COLUMNS + GIT_WIDTH

const wantedSlots = (shown: Shown): number => Math.max(0, Math.min(MAX_AGENT_SLOTS, shown.agentRows))

const MAX_LOG_LINES = 12
const MIN_LOG_LINES = 3
const MAX_CODEX_SLOTS = 3

// The quota header: a border (2), a title, and the four rows of the Claude column (model, 5小時, 1週, Fable).
export const WIDE_QUOTA_ROWS = 7
// Stacked: a title, Claude's model, five-hour and weekly, Fable, Codex's model, its two windows.
export const NARROW_QUOTA_ROWS = 6
// Folded away, the header is its title line.
const FOLDED_QUOTA_ROWS = 1
// The Context bar: one row, below the Codex block and above the log, wide and stacked alike.
const CONTEXT_ROWS = 1
const FOOTER_ROWS = 1

// Wide layout rows: quota header, header, legend, main box (4), connector, [middle], connector, Context bar, log title.
const wideFixedRows = (shown: Shown): number =>
  (shown.isQuotaFolded ? FOLDED_QUOTA_ROWS : WIDE_QUOTA_ROWS) + 9 + CONTEXT_ROWS
export const AGENT_ROWS = 4
export const ADVISOR_ROWS = 5

// The row between the two connectors: the agent boxes, beside the advisor's box while it is shown.
const middleRows = (agentSlots: number, shown: Shown): number =>
  Math.max(shown.hasAdvisor ? ADVISOR_ROWS : 0, agentSlots * AGENT_ROWS)

// The smallest wide pane has one agent box when there is one to draw, and the minimum log.
const minWideRows = (shown: Shown): number =>
  wideFixedRows(shown) + middleRows(Math.min(1, wantedSlots(shown)), shown) + MIN_LOG_LINES

/** The smallest height that fits the wide layout: one agent box and the minimum log. */
export const WIDE_MIN_ROWS = minWideRows(ALL_SHOWN)

// The column beside MAIN and the agents is as high as they are: the main box (4) and the two connectors, then the middle.
const COLUMN_FIXED_ROWS = 6
// The 分支 panel without its list: a border (2), the title, the branch, the upstream and 未審.
const GIT_BASE_ROWS = 6

export const NO_GIT: GitNeed = { isPresent: false, listRows: 0 }
const NO_GIT_PLAN: GitPlan = { placement: 'none', width: 0, pathSlots: 0 }

// The Codex block: a border (2), a title and one row per run; none at all without runs.
const codexRows = (slots: number): number => (slots === 0 ? 0 : slots + 3)

// Stacked layout rows: quota header, header, main, [advisor], Context bar, log title.
const narrowFixedRows = (shown: Shown): number =>
  (shown.isQuotaFolded ? FOLDED_QUOTA_ROWS : NARROW_QUOTA_ROWS) + (shown.hasAdvisor ? 4 : 3) + CONTEXT_ROWS
const NARROW_ROWS_PER_SLOT = 3

const wideRows = (agentSlots: number, codexSlots: number, extra: number, shown: Shown): number =>
  wideFixedRows(shown) + extra + codexRows(codexSlots) + middleRows(agentSlots, shown)

/** Where the 分支 panel goes and the rows the log has left, before the Footer asks for one. */
type Placed = { git: GitPlan; logRoom: number }

// The Footer is the first thing given up: it takes a log row only while the log keeps its minimum.
const withFooter = ({ git, logRoom }: Placed): { git: GitPlan; logLines: number; hasFooter: boolean } => {
  const hasFooter = logRoom - FOOTER_ROWS >= MIN_LOG_LINES

  return { git, hasFooter, logLines: Math.min(MAX_LOG_LINES, logRoom - (hasFooter ? FOOTER_ROWS : 0)) }
}

// A panel the person folded is its summary line, wherever the column would have fit.
const isColumnGit = (git: GitNeed, columns: number): boolean =>
  git.isPresent && git.isFolded !== true && columns >= GIT_COLUMN_MIN_COLUMNS

// Show as many Codex runs as leave room for one agent box and the minimum log,
// then as many agent boxes as then fit. planLayout only comes here when one
// run (if there is one) fits.
const fittingCodexSlots = (rows: number, wanted: number, extra: number, shown: Shown): number => {
  for (let slots = wanted; slots > 1; slots--) {
    if (wideRows(Math.min(1, wantedSlots(shown)), slots, extra, shown) + MIN_LOG_LINES <= rows) return slots
  }

  return Math.min(wanted, 1)
}

// The column is as high as MAIN and the agent boxes, so a short list costs nothing.
// A longer one may take the log lines above the minimum and no more; what does
// not fit is cut to a "N more" row.
const columnPlan = (git: GitNeed, high: number, free: number): Placed => {
  const room = Math.max(0, high + free - MIN_LOG_LINES - GIT_BASE_ROWS)
  const pathSlots = Math.min(git.listRows, room)
  const extra = Math.max(0, GIT_BASE_ROWS + pathSlots - high)

  return { git: { placement: 'column', width: GIT_WIDTH, pathSlots }, logRoom: free - extra }
}

// One summary line, fixed; a list takes the log lines above the minimum.
const linePlan = (git: GitNeed, free: number): Placed => {
  const pathSlots = Math.min(git.listRows, Math.max(0, free - MIN_LOG_LINES))

  return { git: { placement: 'line', width: 0, pathSlots }, logRoom: free - pathSlots }
}

// The wait banner takes its row from the log (whatever the log had above nothing), so it never
// changes the mode, the agent boxes or the Codex runs.
const planWide = (
  columns: number,
  rows: number,
  codexJobs: number,
  git: GitNeed,
  bannerRows: number,
  shown: Shown,
): Plan => {
  const isColumn = isColumnGit(git, columns)
  const lineRows = git.isPresent && !isColumn ? 1 : 0
  const codexSlots = fittingCodexSlots(rows, Math.min(codexJobs, MAX_CODEX_SLOTS), lineRows, shown)
  const fits = (slots: number): boolean => wideRows(slots, codexSlots, lineRows, shown) + MIN_LOG_LINES <= rows
  const wanted = wantedSlots(shown)
  const agentSlots = Array.from({ length: wanted }, (_, i) => wanted - i).find(fits) ?? Math.min(1, wanted)
  const free = rows - wideRows(agentSlots, codexSlots, lineRows, shown) - bannerRows
  const placed: Placed = !git.isPresent
    ? { git: NO_GIT_PLAN, logRoom: free }
    : isColumn
      ? columnPlan(git, COLUMN_FIXED_ROWS + middleRows(agentSlots, shown), free)
      : linePlan(git, free)

  return { mode: 'wide', agentSlots, sideWidth: shown.hasAdvisor ? SIDE_WIDTH : 0, codexSlots, ...withFooter(placed) }
}

// The summary line comes after the Codex runs, so it never costs one; the agents
// and the log share what is left, and an unfolded list takes log lines first.
const planNarrow = (rows: number, codexJobs: number, git: GitNeed, bannerRows: number, shown: Shown): Plan => {
  const free = Math.max(0, rows - narrowFixedRows(shown))
  const codexSlots = Math.min(codexJobs, MAX_CODEX_SLOTS, free)
  const remaining = Math.max(0, free - codexSlots - (git.isPresent ? 1 : 0))
  const agentSlots = Math.min(wantedSlots(shown), Math.floor(remaining / NARROW_ROWS_PER_SLOT))
  const spare = Math.max(0, remaining - agentSlots - bannerRows)
  const pathSlots = Math.min(git.listRows, spare)
  const placed: Placed = {
    git: git.isPresent ? { placement: 'line', width: 0, pathSlots } : NO_GIT_PLAN,
    logRoom: spare - pathSlots,
  }

  return { mode: 'narrow', agentSlots, sideWidth: 0, codexSlots, ...withFooter(placed) }
}

/**
 * The plan for a pane `columns` wide and `rows` tall, with `codexJobs` Codex
 * runs, the 分支 panel (when there is one), `bannerRows` (0 or 1) for the
 * wait banner to show, and what else is `shown` (all of it, left out).
 */
export const planLayout = (
  columns: number,
  rows: number,
  codexJobs = 0,
  git: GitNeed = NO_GIT,
  bannerRows = 0,
  shownIn: Partial<Shown> = {},
): Plan => {
  const shown = { ...ALL_SHOWN, ...shownIn }
  const lineRows = git.isPresent && !isColumnGit(git, columns) ? 1 : 0

  return columns >= WIDE_MIN_COLUMNS && rows >= minWideRows(shown) + codexRows(Math.min(codexJobs, 1)) + lineRows
    ? planWide(columns, rows, codexJobs, git, bannerRows, shown)
    : planNarrow(rows, codexJobs, git, bannerRows, shown)
}
