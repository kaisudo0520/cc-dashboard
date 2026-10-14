import { expect, test } from 'claude-code/testing'

import {
  GIT_COLUMN_MIN_COLUMNS,
  GIT_WIDTH,
  NARROW_QUOTA_ROWS,
  SIDE_WIDTH,
  WIDE_MIN_COLUMNS,
  WIDE_MIN_ROWS,
  WIDE_QUOTA_ROWS,
  paneRowsFor,
  planLayout,
} from '../hooks/lib/layout'
import type { GitNeed } from '../hooks/lib/layout'
import { quotaRows } from '../hooks/lib/quota-rows'
import { initialState } from '../hooks/lib/state'

const NO_GIT_PLAN = { placement: 'none', width: 0, pathSlots: 0 } as const
const FOLDED: GitNeed = { isPresent: true, listRows: 0 }
const unfolded = (listRows: number): GitNeed => ({ isPresent: true, listRows })

test('the quota header rows the layout reserves are the rows the header draws, with no CTX row among them', async () => {
  const claude = quotaRows(initialState, 0).claude.length
  // Wide: a border (2), the title, Claude's model line and its windows.
  expect(WIDE_QUOTA_ROWS).toBe(2 + 1 + 1 + claude)
  // Stacked: the title, Claude's model line, the 5小時 and 1週 pair on one line, Fable, and Codex's two lines.
  expect(NARROW_QUOTA_ROWS).toBe(claude + 3)
  expect(WIDE_QUOTA_ROWS).toBe(7)
  expect(NARROW_QUOTA_ROWS).toBe(6)
})

test('a wide, tall pane gets the multi-column layout with all four agent boxes', async () => {
  // 10 fixed rows (the Context bar among them) + 7 for the quota header + 16 for four agent boxes leaves 7 rows at 40: the Footer and 6 log lines.
  expect(planLayout(100, 40)).toEqual({
    mode: 'wide',
    agentSlots: 4,
    logLines: 6,
    sideWidth: SIDE_WIDTH,
    codexSlots: 0,
    git: NO_GIT_PLAN,
    hasFooter: true,
  })
  expect(planLayout(100, 60)).toMatchObject({ agentSlots: 4, logLines: 12 })
})

test('a wide but shorter pane gives up agent boxes before it gives up three log lines', async () => {
  expect(planLayout(100, 29)).toEqual({
    mode: 'wide',
    agentSlots: 2,
    logLines: 3,
    sideWidth: SIDE_WIDTH,
    codexSlots: 0,
    git: NO_GIT_PLAN,
    hasFooter: true,
  })
  expect(planLayout(100, 36)).toMatchObject({ agentSlots: 4, logLines: 3 })
  expect(planLayout(100, 35)).toMatchObject({ agentSlots: 3, logLines: 5 })
})

test('the smallest wide pane has one agent box and three log lines', async () => {
  expect(planLayout(WIDE_MIN_COLUMNS, WIDE_MIN_ROWS)).toEqual({
    mode: 'wide',
    agentSlots: 1,
    logLines: 3,
    sideWidth: SIDE_WIDTH,
    codexSlots: 0,
    git: NO_GIT_PLAN,
    hasFooter: false,
  })
})

test('too few columns, or too few rows, falls back to the stacked layout', async () => {
  expect(planLayout(WIDE_MIN_COLUMNS - 1, 60).mode).toBe('narrow')
  expect(planLayout(120, WIDE_MIN_ROWS - 1).mode).toBe('narrow')
})

test('the stacked layout shares its rows between agents and log', async () => {
  expect(planLayout(50, 30)).toMatchObject({ mode: 'narrow', agentSlots: 4, logLines: 12 })
  // 11 fixed rows (the quota header takes 7 of them) leave 9 rows at 20: three agent lines, the Footer and 5 log lines.
  expect(planLayout(50, 20)).toMatchObject({ mode: 'narrow', agentSlots: 3, logLines: 5 })
  expect(planLayout(50, 12)).toMatchObject({ mode: 'narrow', agentSlots: 0, logLines: 1 })
  expect(planLayout(50, 6)).toMatchObject({ mode: 'narrow', agentSlots: 0, logLines: 0 })
})

test('a wide pane reserves a full-width block of rows for the Codex runs, at most three', async () => {
  // Block = border (2) + title (1) + one row per run: 17 fixed + 5 + 16 for four agent boxes + 6 rows: the Footer and 5 log lines.
  expect(planLayout(100, 44, 2)).toEqual({
    mode: 'wide',
    agentSlots: 4,
    logLines: 5,
    sideWidth: SIDE_WIDTH,
    codexSlots: 2,
    git: NO_GIT_PLAN,
    hasFooter: true,
  })
  expect(planLayout(100, 70, 5)).toMatchObject({ codexSlots: 3 })
})

test('a wide pane short of rows shows fewer Codex runs before it drops below one agent box and three log lines', async () => {
  expect(planLayout(100, 29, 3)).toMatchObject({ mode: 'wide', codexSlots: 1, agentSlots: 1, logLines: 3 })
  expect(planLayout(100, 30, 3)).toMatchObject({ mode: 'wide', codexSlots: 2, agentSlots: 1, logLines: 3 })
  expect(planLayout(100, 31, 3)).toMatchObject({ mode: 'wide', codexSlots: 3, agentSlots: 1, logLines: 3 })
})

test('with a Codex run the wide layout needs four more rows, else the stacked layout takes over', async () => {
  expect(planLayout(120, WIDE_MIN_ROWS + 3, 1).mode).toBe('narrow')
  expect(planLayout(120, WIDE_MIN_ROWS + 4, 1).mode).toBe('wide')
})

test('the stacked layout gives each Codex run one line before agents and log share what is left', async () => {
  // 16 rows - 11 fixed = 5; two runs take 2, leaving 3: one agent slot (3 rows) and 2 log lines.
  expect(planLayout(50, 16, 2)).toMatchObject({ mode: 'narrow', codexSlots: 2, agentSlots: 1, logLines: 2 })
  expect(planLayout(50, 40, 9)).toMatchObject({ mode: 'narrow', codexSlots: 3 })
  expect(planLayout(50, 5, 2)).toMatchObject({ mode: 'narrow', codexSlots: 0 })
})

// --- The 分支 panel ---------------------------------------------------------------

test('a wide pane with room for it puts the folded panel in a right-hand column and takes no row from anything', async () => {
  expect(planLayout(100, 40, 0, FOLDED)).toEqual({
    mode: 'wide',
    agentSlots: 4,
    logLines: 6,
    sideWidth: SIDE_WIDTH,
    codexSlots: 0,
    git: { placement: 'column', width: GIT_WIDTH, pathSlots: 0 },
    hasFooter: true,
  })
})

test('a short unfolded list fits beside MAIN and the agents; a long one takes only the log lines above three', async () => {
  // MAIN, two connectors and four agent boxes are 22 rows; the panel is 6 rows (border, title, branch, upstream, 未審) and a row per path.
  expect(planLayout(100, 40, 0, unfolded(3))).toMatchObject({ logLines: 6, git: { placement: 'column', pathSlots: 3 } })
  // 21 paths make 27 rows: 5 more than the column has, and the log has 4 to give, so 20 rows show.
  expect(planLayout(100, 40, 0, unfolded(21))).toMatchObject({ agentSlots: 4, logLines: 3, git: { pathSlots: 20 } })
  expect(planLayout(100, 44, 0, unfolded(21))).toMatchObject({ agentSlots: 4, logLines: 5, hasFooter: true, git: { pathSlots: 21 } })
  // At 29 rows the column is 14 rows high and the log has one row to give: 9 paths show.
  expect(planLayout(100, 29, 0, unfolded(21))).toMatchObject({ agentSlots: 2, logLines: 3, git: { pathSlots: 9 } })
})

test('an unfolded list never costs MAIN, an agent box, a Codex run, or the third log line', async () => {
  for (let rows = WIDE_MIN_ROWS + 4; rows <= 70; rows++) {
    const without = planLayout(GIT_COLUMN_MIN_COLUMNS, rows, 2)
    const open = planLayout(GIT_COLUMN_MIN_COLUMNS, rows, 2, unfolded(21))

    expect(open.mode).toBe(without.mode)
    expect(open.agentSlots).toBe(without.agentSlots)
    expect(open.codexSlots).toBe(without.codexSlots)
    expect(open.logLines).toBeGreaterThanOrEqual(3)
  }
})

test('between the wide minimum and the column minimum the panel is one summary line above the log', async () => {
  expect(planLayout(GIT_COLUMN_MIN_COLUMNS - 1, 40, 0, FOLDED)).toEqual({
    mode: 'wide',
    agentSlots: 4,
    logLines: 5,
    sideWidth: SIDE_WIDTH,
    codexSlots: 0,
    git: { placement: 'line', width: 0, pathSlots: 0 },
    hasFooter: true,
  })
  expect(planLayout(GIT_COLUMN_MIN_COLUMNS, 40, 0, FOLDED).git.placement).toBe('column')
  expect(GIT_COLUMN_MIN_COLUMNS).toBe(WIDE_MIN_COLUMNS + GIT_WIDTH)
})

test('the summary line needs one more row before the wide layout is used; the column does not', async () => {
  expect(planLayout(80, WIDE_MIN_ROWS, 0, FOLDED).mode).toBe('narrow')
  expect(planLayout(80, WIDE_MIN_ROWS + 1, 0, FOLDED).mode).toBe('wide')
  expect(planLayout(100, WIDE_MIN_ROWS, 0, FOLDED).mode).toBe('wide')
})

test('beside the summary line an unfolded list takes only the log lines above three', async () => {
  expect(planLayout(80, 40, 0, unfolded(5))).toMatchObject({ logLines: 3, git: { placement: 'line', pathSlots: 3 } })
  expect(planLayout(80, WIDE_MIN_ROWS + 1, 0, unfolded(5))).toMatchObject({ logLines: 3, git: { pathSlots: 0 } })
})

test('the stacked layout adds one summary line after the Codex runs, and an unfolded list takes log lines first', async () => {
  expect(planLayout(50, 30, 0, FOLDED)).toEqual({
    mode: 'narrow',
    agentSlots: 4,
    logLines: 12,
    sideWidth: 0,
    codexSlots: 0,
    git: { placement: 'line', width: 0, pathSlots: 0 },
    hasFooter: true,
  })
  expect(planLayout(50, 30, 0, unfolded(5))).toMatchObject({ logLines: 8, git: { pathSlots: 5 } })
  expect(planLayout(50, 30, 0, unfolded(21))).toMatchObject({ agentSlots: 4, logLines: 0, git: { pathSlots: 14 } })
})

test('in the stacked layout the summary line never costs a Codex run', async () => {
  // 16 rows - 11 fixed = 5: two Codex runs, the summary line, and then the 2 rows left go to the log.
  expect(planLayout(50, 16, 2, FOLDED)).toMatchObject({ codexSlots: 2, agentSlots: 0, logLines: 2 })
  expect(planLayout(50, 13, 2, FOLDED)).toMatchObject({ codexSlots: 2, agentSlots: 0, logLines: 0 })
})

test('without the panel the layout is the one it always was', async () => {
  expect(planLayout(100, 40, 0, { isPresent: false, listRows: 0 })).toEqual(planLayout(100, 40))
  expect(planLayout(50, 20, 1, { isPresent: false, listRows: 0 })).toEqual(planLayout(50, 20, 1))
})

// --- The wait banner ----------------------------------------------------------------

const NO_GIT_NEED: GitNeed = { isPresent: false, listRows: 0 }

test('a wait banner takes its row from the log, wide or stacked', async () => {
  expect(planLayout(100, 40, 0, NO_GIT_NEED, 1)).toMatchObject({ mode: 'wide', agentSlots: 4, logLines: 5 })
  expect(planLayout(100, WIDE_MIN_ROWS, 0, NO_GIT_NEED, 1)).toMatchObject({ mode: 'wide', agentSlots: 1, logLines: 2 })
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 1)).toMatchObject({ mode: 'narrow', agentSlots: 3, logLines: 4 })
  expect(planLayout(50, 12, 0, NO_GIT_NEED, 1)).toMatchObject({ agentSlots: 0, logLines: 0 })
})

test('a wait banner never changes the mode, the agent boxes, the Codex runs or the git column', async () => {
  for (let rows = 5; rows <= 70; rows++) {
    for (const columns of [50, 80, 100]) {
      const without = planLayout(columns, rows, 2, FOLDED)
      const banner = planLayout(columns, rows, 2, FOLDED, 1)

      expect(banner.mode).toBe(without.mode)
      expect(banner.agentSlots).toBe(without.agentSlots)
      expect(banner.codexSlots).toBe(without.codexSlots)
      expect(banner.git.placement).toBe(without.git.placement)
      // One row less, unless the log was already at its 12-line cap and has rows to spare.
      expect(banner.logLines).toBeGreaterThanOrEqual(Math.max(0, without.logLines - 1))
      expect(banner.logLines).toBeLessThanOrEqual(without.logLines)
    }
  }
})

test('with a wait banner an unfolded list in the git column has one row less to borrow', async () => {
  // Without it: 22 rows of column + 7 free - 3 log - 6 panel = 20 path rows.
  expect(planLayout(100, 40, 0, unfolded(21), 1)).toMatchObject({ logLines: 3, git: { pathSlots: 19 } })
})

test('no banner is the layout it always was', async () => {
  expect(planLayout(100, 40, 0, FOLDED, 0)).toEqual(planLayout(100, 40, 0, FOLDED))
})

// --- The ADVISOR block, when it has nothing to say -------------------------------------

const NO_ADVISOR = { hasAdvisor: false }

test('with no advisor the wide plan has no side column; the agent boxes keep their rows', async () => {
  expect(planLayout(100, 40, 0, NO_GIT_NEED, 0, NO_ADVISOR)).toEqual({
    mode: 'wide',
    agentSlots: 4,
    logLines: 6,
    sideWidth: 0,
    codexSlots: 0,
    git: NO_GIT_PLAN,
    hasFooter: true,
  })
  expect(planLayout(100, 29, 0, NO_GIT_NEED, 0, NO_ADVISOR)).toMatchObject({ agentSlots: 2, logLines: 3, sideWidth: 0 })
  // The advisor's box is five rows high, an agent box four: a single box needs one row less without it.
  expect(planLayout(100, WIDE_MIN_ROWS - 1, 0, NO_GIT_NEED, 0, NO_ADVISOR)).toMatchObject({ mode: 'wide', agentSlots: 1, logLines: 3 })
  expect(planLayout(100, WIDE_MIN_ROWS - 1).mode).toBe('narrow')
})

test('with no advisor the stacked plan has its advisor line to give to the agents and the log', async () => {
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 0, NO_ADVISOR)).toMatchObject({ mode: 'narrow', agentSlots: 3, logLines: 6, sideWidth: 0 })
  expect(planLayout(50, 20)).toMatchObject({ agentSlots: 3, logLines: 5 })
})

test('with the advisor shown, or the argument left out, the plan is the one it always was', async () => {
  expect(planLayout(100, 40, 0, NO_GIT_NEED, 0, { hasAdvisor: true })).toEqual(planLayout(100, 40))
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 0, { hasAdvisor: true })).toEqual(planLayout(50, 20))
})

test('no advisor never costs an agent box, a Codex run or a log line, at any size', async () => {
  for (let rows = 5; rows <= 70; rows++) {
    for (const columns of [50, 80, 100]) {
      const withAdvisor = planLayout(columns, rows, 2, FOLDED)
      const without = planLayout(columns, rows, 2, FOLDED, 0, NO_ADVISOR)

      // A pane that was already wide stays wide; one that was stacked may become wide, which counts its boxes anew.
      if (withAdvisor.mode === 'wide') expect(without.mode).toBe('wide')
      if (without.mode !== withAdvisor.mode) continue

      expect(without.agentSlots).toBeGreaterThanOrEqual(withAdvisor.agentSlots)
      expect(without.codexSlots).toBeGreaterThanOrEqual(withAdvisor.codexSlots)
      expect(without.logLines).toBeGreaterThanOrEqual(withAdvisor.logLines)
      expect(without.git.placement).toBe(withAdvisor.git.placement)
    }
  }
})

// --- The Footer, and the panels folded away ------------------------------------------

test('the Footer is shown when the log can give it a row and keep three lines, and takes that row', async () => {
  expect(planLayout(100, 36)).toMatchObject({ hasFooter: false, logLines: 3 })
  expect(planLayout(100, 37)).toMatchObject({ hasFooter: true, logLines: 3 })
  expect(planLayout(100, 40)).toMatchObject({ hasFooter: true, logLines: 6 })
  expect(planLayout(100, 60)).toMatchObject({ hasFooter: true, logLines: 12 })
  expect(planLayout(50, 15)).toMatchObject({ mode: 'narrow', hasFooter: false, logLines: 3 })
  expect(planLayout(50, 16)).toMatchObject({ mode: 'narrow', hasFooter: true, logLines: 3 })
  expect(planLayout(50, 5)).toMatchObject({ hasFooter: false })
})

test('an unfolded list of paths takes its rows before the Footer does', async () => {
  expect(planLayout(80, 40, 0, FOLDED)).toMatchObject({ hasFooter: true, logLines: 5 })
  expect(planLayout(80, 40, 0, unfolded(5))).toMatchObject({ hasFooter: false, logLines: 3, git: { pathSlots: 3 } })
  expect(planLayout(50, 30, 0, unfolded(5))).toMatchObject({ hasFooter: true, logLines: 8, git: { pathSlots: 5 } })
  expect(planLayout(50, 30, 0, unfolded(21))).toMatchObject({ hasFooter: false, logLines: 0, git: { pathSlots: 14 } })
})

test('wherever the Footer is shown the log keeps at least three lines, at any size', async () => {
  for (let rows = 5; rows <= 70; rows++) {
    for (const columns of [50, 80, 100]) {
      for (const git of [NO_GIT_NEED, FOLDED, unfolded(8)]) {
        const plan = planLayout(columns, rows, 2, git, 1)

        if (plan.hasFooter) expect(plan.logLines).toBeGreaterThanOrEqual(3)
      }
    }
  }
})

const QUOTA_FOLDED = { isQuotaFolded: true }

test('a folded quota header is one row, not seven, so the wide layout fits six rows lower', async () => {
  expect(planLayout(100, 40, 0, NO_GIT_NEED, 0, QUOTA_FOLDED)).toMatchObject({ mode: 'wide', agentSlots: 4, logLines: 12, hasFooter: true })
  expect(planLayout(100, WIDE_MIN_ROWS - 6, 0, NO_GIT_NEED, 0, QUOTA_FOLDED).mode).toBe('wide')
  expect(planLayout(100, WIDE_MIN_ROWS - 7, 0, NO_GIT_NEED, 0, QUOTA_FOLDED).mode).toBe('narrow')
})

test('a folded quota header is one row, not six, in the stacked layout too', async () => {
  // 6 fixed rows instead of 11 leave 14 at 20 rows: four agent lines, then the Footer and nine log lines.
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 0, QUOTA_FOLDED)).toMatchObject({ mode: 'narrow', agentSlots: 4, logLines: 9, hasFooter: true })
})

test('a folded 分支 panel is a summary line even where the column would fit, with no list', async () => {
  const folded: GitNeed = { isPresent: true, listRows: 0, isFolded: true }

  expect(planLayout(100, 40, 0, folded)).toMatchObject({ mode: 'wide', git: { placement: 'line', width: 0, pathSlots: 0 } })
  // The line costs a row the column does not.
  expect(planLayout(100, WIDE_MIN_ROWS, 0, folded).mode).toBe('narrow')
  expect(planLayout(100, WIDE_MIN_ROWS + 1, 0, folded).mode).toBe('wide')
  expect(planLayout(50, 30, 0, folded).git).toEqual({ placement: 'line', width: 0, pathSlots: 0 })
})

// --- The dock: about 70 columns, tall ----------------------------------------------------

test('a 70-column pane 50 rows tall is the wide layout with every section: git is its summary line, there is room for the log and the Footer', async () => {
  // A Codex run and the wait banner, as in a busy session: 17 fixed rows + 16 for four agent boxes + 4 for CODEX + 1 for git + 1 banner.
  expect(planLayout(70, 50, 1, FOLDED, 1)).toEqual({
    mode: 'wide',
    agentSlots: 4,
    logLines: 10,
    sideWidth: SIDE_WIDTH,
    codexSlots: 1,
    git: { placement: 'line', width: 0, pathSlots: 0 },
    hasFooter: true,
  })
  expect(planLayout(70, 50)).toMatchObject({ mode: 'wide', agentSlots: 4, logLines: 12, hasFooter: true })
})

test('at 70 columns an unfolded list of paths takes log lines before the Footer is given up', async () => {
  expect(planLayout(70, 50, 1, unfolded(5), 1)).toMatchObject({ logLines: 5, hasFooter: true, git: { placement: 'line', pathSlots: 5 } })
  expect(planLayout(70, 50, 1, unfolded(8), 1)).toMatchObject({ logLines: 3, hasFooter: false, git: { pathSlots: 8 } })
})

test('the git column starts at 98 columns: the dock never has it, a wide pane does', async () => {
  expect(planLayout(97, 50, 0, FOLDED).git.placement).toBe('line')
  expect(planLayout(98, 50, 0, FOLDED).git.placement).toBe('column')
  expect(planLayout(70, 50, 0, FOLDED).git.placement).toBe('line')
})

test('shrinking a 70-column pane gives up the Footer, then agent boxes, and only then the wide layout', async () => {
  // Rows 29 and up fit the wide layout with a Codex run; below, the compact one.
  const at = (rows: number) => planLayout(70, rows, 1)

  expect(at(41)).toMatchObject({ mode: 'wide', agentSlots: 4, hasFooter: true, logLines: 3 })
  expect(at(40)).toMatchObject({ mode: 'wide', agentSlots: 4, hasFooter: false, logLines: 3 })
  expect(at(39)).toMatchObject({ mode: 'wide', agentSlots: 3, hasFooter: true })
  expect(at(29)).toMatchObject({ mode: 'wide', agentSlots: 1, hasFooter: false, logLines: 3 })
  expect(at(28).mode).toBe('narrow')
})

test('a Codex run is never given up while the pane has the rows of the compact layout\'s fixed part, at any width', async () => {
  // The compact layout's fixed rows (quota header, header, MAIN, advisor, Context bar and log title) are 11.
  for (let rows = 12; rows <= 60; rows++) {
    for (const columns of [40, 70, 98]) {
      expect(planLayout(columns, rows, 2, FOLDED, 1).codexSlots).toBeGreaterThanOrEqual(1)
    }
  }
})

// --- Agent slots follow the agent rows there are to draw ----------------------------------

const rowsOfAgents = (agentRows: number) => ({ agentRows })

test('the wide layout reserves boxes only for the agent rows there are; the rest goes to the log', async () => {
  // 17 fixed rows + the advisor's five (one box is four): 18 spare at 40 rows, the Footer and the log's 12.
  expect(planLayout(100, 40, 0, NO_GIT_NEED, 0, rowsOfAgents(1))).toEqual({
    mode: 'wide',
    agentSlots: 1,
    logLines: 12,
    sideWidth: SIDE_WIDTH,
    codexSlots: 0,
    git: NO_GIT_PLAN,
    hasFooter: true,
  })
  expect(planLayout(100, 30, 0, NO_GIT_NEED, 0, rowsOfAgents(1))).toMatchObject({ agentSlots: 1, logLines: 7 })
  expect(planLayout(100, 30, 0, NO_GIT_NEED, 0, rowsOfAgents(2))).toMatchObject({ agentSlots: 2, logLines: 4 })
  expect(planLayout(100, 30)).toMatchObject({ agentSlots: 2, logLines: 4 })
})

test('with no agent row the wide layout reserves nothing for agents beyond the advisor\'s box, and nothing at all without one', async () => {
  expect(planLayout(100, 30, 0, NO_GIT_NEED, 0, rowsOfAgents(0))).toMatchObject({ mode: 'wide', agentSlots: 0, logLines: 7 })
  const bare = { agentRows: 0, hasAdvisor: false }

  expect(planLayout(100, 30, 0, NO_GIT_NEED, 0, bare)).toMatchObject({ mode: 'wide', agentSlots: 0, logLines: 12, sideWidth: 0 })
  // Fixed 17 rows and the three log lines: the smallest wide pane is 20 rows.
  expect(planLayout(100, 20, 0, NO_GIT_NEED, 0, bare).mode).toBe('wide')
  expect(planLayout(100, 19, 0, NO_GIT_NEED, 0, bare).mode).toBe('narrow')
})

test('more agent rows than there are slots are capped at the four slots', async () => {
  expect(planLayout(100, 40, 0, NO_GIT_NEED, 0, rowsOfAgents(9))).toEqual(planLayout(100, 40))
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 0, rowsOfAgents(9))).toEqual(planLayout(50, 20))
})

test('the stacked layout reserves a line only for each agent row there is', async () => {
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 0, rowsOfAgents(1))).toMatchObject({ mode: 'narrow', agentSlots: 1, logLines: 7 })
  expect(planLayout(50, 20, 0, NO_GIT_NEED, 0, rowsOfAgents(0))).toMatchObject({ mode: 'narrow', agentSlots: 0, logLines: 8 })
})

test('fewer agent rows never take a slot they have no row for, nor cost a Codex run, at any size', async () => {
  for (let rows = 5; rows <= 70; rows++) {
    for (const columns of [50, 80, 100]) {
      for (const agentRows of [0, 1, 2, 3]) {
        const fewer = planLayout(columns, rows, 2, FOLDED, 1, rowsOfAgents(agentRows))
        const all = planLayout(columns, rows, 2, FOLDED, 1)

        expect(fewer.agentSlots).toBeLessThanOrEqual(agentRows)
        expect(fewer.codexSlots).toBeGreaterThanOrEqual(all.codexSlots)
      }
    }
  }
})

test('the pane asks for 60% of the terminal\'s height, at least one row', async () => {
  expect(paneRowsFor(40)).toBe(24)
  expect(paneRowsFor(47)).toBe(28)
  expect(paneRowsFor(1)).toBe(1)
})
