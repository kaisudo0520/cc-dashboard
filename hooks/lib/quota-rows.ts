import type { DashState, UsageWindow } from '../../types'
import { countdown, modelLabel, plain } from './format'
import { readingOf } from './quota'

// The quota header as rows of plain data: what each line is called, how much
// is left, whether the figure is old, and what the last column says. The view
// draws these and decides nothing about them.

export type QuotaRow = {
  label: string
  /** Percent left; unknown when undefined. */
  left?: number
  /** True when the window's reset time has passed: the last reading is kept, not replaced by a guess. */
  isStale: boolean
  detail: string
}

export type QuotaRows = {
  claudeTitle: string
  claude: QuotaRow[]
  codexTitle: string
  codex: QuotaRow[]
  codexNote?: string
}

const UNKNOWN = '—'

const unknownRow = (label: string): QuotaRow => ({ label, isStale: false, detail: UNKNOWN })

const windowRow = (label: string, window: UsageWindow | undefined, nowMs: number, mark = ''): QuotaRow => {
  if (window === undefined) return unknownRow(label)

  const { left, isStale } = readingOf(window, nowMs)

  return { label: `${label}${mark}`, left, isStale, detail: isStale ? '過期' : countdown(window.resetsAtMs, nowMs) }
}

// The model and effort come from outside (a config file, the engine): drawn plain.
const withEffort = (name: string, model: string, effort: string | undefined): string =>
  plain(`${name} ${model}${effort === undefined ? '' : ` · ${effort}`}`)

export const quotaRows = (state: DashState, nowMs: number): QuotaRows => {
  const { claude, codex } = state.quota

  return {
    claudeTitle: withEffort('Claude', modelLabel(state.main.model), state.main.effort),
    claude: [
      windowRow('5小時', claude.fiveHour, nowMs),
      windowRow('1週', claude.sevenDay, nowMs),
      windowRow('Fable', claude.fable, nowMs, claude.isFableStale === true ? '~' : ''),
    ],
    codexTitle: withEffort('Codex', codex.model ?? UNKNOWN, codex.effort),
    codex: [windowRow('5小時', codex.fiveHour, nowMs), windowRow('每週', codex.weekly, nowMs)],
    ...(codex.note === undefined ? {} : { codexNote: plain(codex.note) }),
  }
}
