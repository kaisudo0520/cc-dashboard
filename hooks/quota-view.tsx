import type { QuotaRow, QuotaRows } from './lib/quota-rows'
import { fillCells } from './lib/format'
import type { Els } from './views'

// The quota header: the account's usage windows as bars, shown as what is left.
// Draws the rows it is given; every figure was decided in ./lib/quota-rows.

const FRAME = '#59c2d9'
const CLAUDE = '#ff9d4d'
const CODEX = '#3dd6a8'

// Label, percent and last-column widths of a bar row, and the gaps between the four.
const LABEL_W = 7
const PERCENT_W = 4
// Wide enough for a countdown such as `10d23h`.
const DETAIL_W = 6
const GAP = 1
const BAR_MIN = 4
const BORDER_AND_PADDING = 4
const COLUMN_GAP = 2

const leftColor = (left: number): string => (left <= 10 ? 'error' : left <= 30 ? 'warning' : 'success')

/** `58%`, `~58%` once its reset has passed, `—` when unknown. */
const percentText = (row: QuotaRow): string =>
  row.left === undefined ? '—' : `${row.isStale ? '~' : ''}${row.left}%`

const BarRow = (els: Els, side: string, row: QuotaRow, barWidth: number) => {
  const { Box, Text } = els
  const key = `quota-${side}-${row.label}`

  if (row.left === undefined) {
    return (
      <Box key={key} flexDirection="row" columnGap={GAP}>
        <Box width={LABEL_W}><Text dimColor>{row.label}</Text></Box>
        <Text dimColor>—</Text>
      </Box>
    )
  }

  const filled = fillCells(row.left, barWidth)
  const color = row.isStale ? undefined : leftColor(row.left)

  return (
    <Box key={key} flexDirection="row" columnGap={GAP}>
      <Box width={LABEL_W}><Text dimColor>{row.label}</Text></Box>
      <Box width={barWidth}>
        <Text color={color} dimColor={row.isStale}>{'━'.repeat(filled)}</Text>
        <Text dimColor>{'─'.repeat(barWidth - filled)}</Text>
      </Box>
      <Box width={PERCENT_W} justifyContent="flex-end">
        <Text color={color} dimColor={row.isStale}>{percentText(row)}</Text>
      </Box>
      <Box width={DETAIL_W} justifyContent="flex-end"><Text dimColor>{row.detail}</Text></Box>
    </Box>
  )
}

type Side = {
  els: Els
  name: string
  title: string
  color: string
  rows: QuotaRow[]
  note?: string | undefined
  width: number
}

const Column = ({ els, name, title, color, rows, note, width }: Side) => {
  const { Box, Text } = els
  const barWidth = Math.max(BAR_MIN, width - LABEL_W - PERCENT_W - DETAIL_W - GAP * 3)

  return (
    <Box key={`quota-${name}`} width={width} flexDirection="column">
      <Text bold color={color} wrap="truncate-end">{`◆ ${title}`}</Text>
      {rows.map(row => BarRow(els, name, row, barWidth))}
      {note === undefined ? null : <Text dimColor wrap="truncate-end">{note}</Text>}
    </Box>
  )
}

/** Whether the person folded the header away, and what folds or unfolds it (hotkey 1). */
export type QuotaFold = { isFolded: boolean; onToggle: () => void }

// The title is the button: `1: ▾ 額度 · 剩餘`. Folded, it is all there is of the header.
const Title = (els: Els, fold: QuotaFold) => {
  const { Button } = els

  return (
    <Button
      key="quota-toggle"
      plain
      hotkey="1"
      label={`${fold.isFolded ? '▸' : '▾'} 額度 · 剩餘`}
      onPress={fold.onToggle}
    />
  )
}

const FoldedBar = (els: Els, fold: QuotaFold) => {
  const { Box } = els

  return <Box key="quota">{Title(els, fold)}</Box>
}

/** The wide header: Claude on the left, Codex on the right, in one frame. */
export const QuotaBox = (els: Els, quota: QuotaRows, columns: number, fold: QuotaFold) => {
  const { Box } = els
  const width = Math.max(1, Math.floor((columns - BORDER_AND_PADDING - COLUMN_GAP) / 2))
  if (fold.isFolded) return FoldedBar(els, fold)

  return (
    <Box key="quota" borderStyle="round" borderColor={FRAME} flexDirection="column" paddingX={1}>
      {Title(els, fold)}
      <Box key="quota-columns" flexDirection="row" columnGap={COLUMN_GAP}>
        {Column({ els, name: 'claude', title: quota.claudeTitle, color: CLAUDE, rows: quota.claude, width })}
        {Column({
          els,
          name: 'codex',
          title: quota.codexTitle,
          color: CODEX,
          rows: quota.codex,
          note: quota.codexNote,
          width,
        })}
      </Box>
    </Box>
  )
}

const rowText = (row: QuotaRow): string =>
  row.left === undefined ? `${row.label} —` : `${row.label} ${percentText(row)} ${row.detail}`

const pairText = (a: QuotaRow | undefined, b: QuotaRow | undefined): string =>
  [a, b].filter((row): row is QuotaRow => row !== undefined).map(rowText).join('  ')

/** The narrow header: six short lines (title, Claude, its windows, Fable, Codex, its windows). */
export const QuotaLines = (els: Els, quota: QuotaRows, fold: QuotaFold) => {
  const { Box, Text } = els
  const [five, week, fable] = quota.claude
  if (fold.isFolded) return FoldedBar(els, fold)
  const codexTitle = quota.codexNote === undefined ? quota.codexTitle : `${quota.codexTitle} · ${quota.codexNote}`
  const line = (key: string, content: string, color?: string) => (
    <Box key={`quota-${key}`}>
      <Text color={color} wrap="truncate-end">{content}</Text>
    </Box>
  )

  return (
    <Box key="quota" flexDirection="column">
      <Box key="quota-title">{Title(els, fold)}</Box>
      {line('claude', quota.claudeTitle, CLAUDE)}
      {line('windows', pairText(five, week))}
      {fable === undefined ? null : line('fable', rowText(fable))}
      {line('codex', codexTitle, CODEX)}
      {line('codex-windows', pairText(quota.codex[0], quota.codex[1]))}
    </Box>
  )
}
