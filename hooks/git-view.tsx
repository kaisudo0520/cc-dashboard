import type { GitSnap } from '../types'
import { canUnfold, gitSummary, pathLines, syncText, unreviewedText, upstreamText } from './lib/git-rows'
import type { GitPlan } from './lib/layout'
import type { Els } from './views'

// The 分支 panel: a column box beside MAIN when there is width, otherwise one
// summary line. Draws what ./lib/git-rows decided; the layout decided its place.

const GIT = '#d0d7de'
const UNFOLD_KEY = 'git-unreviewed'

export type GitView = {
  snap: GitSnap
  /** The list of unreviewed paths is unfolded. */
  isOpen: boolean
  onToggle: () => void
  /** The person folded the panel to its one line (hotkey 2). */
  isFolded: boolean
  onToggleFold: () => void
  plan: GitPlan
}

// The title is the button: `2: ▾ 分支`.
const Title = (els: Els, view: GitView) => {
  const { Button } = els

  return (
    <Button
      key="git-toggle"
      plain
      hotkey="2"
      label={`${view.isFolded ? '▸' : '▾'} 分支`}
      onPress={view.onToggleFold}
    />
  )
}

// The paths the plan has room for, and a closing row counting the rest.
const PathRows = (els: Els, view: GitView, indent: number) => {
  const { Box, Text } = els
  const { paths, hidden } = pathLines(view.snap, view.isOpen ? view.plan.pathSlots : 0)

  return [
    ...paths.map(path => (
      <Box key={`git-path-${path}`} paddingLeft={indent}>
        <Text dimColor wrap="truncate-start">{path}</Text>
      </Box>
    )),
    hidden > 0 ? (
      <Box key="git-more" paddingLeft={indent}>
        <Text dimColor>{`… 另有 ${hidden} 個`}</Text>
      </Box>
    ) : null,
  ]
}

// Only files some review has not seen can be unfolded; none unreviewed is a tick, and unknown says so.
const UnreviewedRow = (els: Els, view: GitView) => {
  const { Text, Button } = els
  const { snap } = view

  if (snap.unreviewed === undefined) return <Text key="git-unreviewed-state" color="warning">{`未審 ${unreviewedText(snap)}`}</Text>
  if (!canUnfold(snap)) return <Text key="git-unreviewed-state" color="success">✓ 未審 0</Text>

  return (
    <Button
      key={UNFOLD_KEY}
      plain
      hotkey="u"
      label={`${view.isOpen ? '▾' : '▸'} 未審 ${snap.unreviewed}`}
      onPress={view.onToggle}
    />
  )
}

/** The panel as a box of its own, `plan.width` wide with one column of gap on its left. */
export const GitBox = (els: Els, view: GitView) => {
  const { Box, Text } = els
  const { snap, plan } = view
  const sync = syncText(snap)

  return (
    <Box key="git" width={plan.width - 1} marginLeft={1} borderStyle="round" borderColor={GIT} flexDirection="column" paddingX={1}>
      {Title(els, view)}
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text wrap="truncate-end">{snap.branch}</Text>
        <Box flexShrink={0}>
          <Text dimColor>{`變更 ${snap.changed}`}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text dimColor wrap="truncate-end">{upstreamText(snap)}</Text>
        {sync === undefined ? null : (
          <Box flexShrink={0}>
            <Text dimColor>{sync}</Text>
          </Box>
        )}
      </Box>
      {UnreviewedRow(els, view)}
      {PathRows(els, view, 1)}
    </Box>
  )
}

/**
 * The panel as its title and `<branch> · 變更 <n> · 未審 <n>`, with the unfolded
 * paths under it. Folded, it is just those two: no `u`, no paths.
 */
export const GitLine = (els: Els, view: GitView) => {
  const { Box, Text, Button } = els

  return (
    <Box key="git-line" flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{Title(els, view)}</Box>
        <Text color={GIT} wrap="truncate-end">{gitSummary(view.snap)}</Text>
        {canUnfold(view.snap) && !view.isFolded ? (
          <Box flexShrink={0}>
            <Button key={UNFOLD_KEY} plain hotkey="u" label={view.isOpen ? '▾' : '▸'} onPress={view.onToggle} />
          </Box>
        ) : null}
      </Box>
      {PathRows(els, view, 2)}
    </Box>
  )
}
