import type { ClaudeQuota, CodexQuota, QuotaState, UsageWindow } from '../../types'

// How the account's usage windows change as readings arrive. Pure; state.ts
// folds the result into the dashboard's state. A reading that lacks a window
// never blanks the one already known: the last figure stays, and the view
// marks it stale once its reset time has passed.

export type QuotaEvent =
  | { type: 'claude-quota'; fiveHour?: UsageWindow; sevenDay?: UsageWindow }
  /** An answer from /api/oauth/usage; none when the request failed or the account has no Fable window. */
  | { type: 'fable'; fable?: UsageWindow }
  | { type: 'codex-quota'; quota: CodexQuota }

export const initialQuota: QuotaState = { claude: {}, codex: {} }

const claude = (old: ClaudeQuota, e: Extract<QuotaEvent, { type: 'claude-quota' }>): ClaudeQuota => ({
  ...old,
  fiveHour: e.fiveHour ?? old.fiveHour,
  sevenDay: e.sevenDay ?? old.sevenDay,
})

// A failed refresh keeps the last figure and marks it stale; with no figure there is nothing to mark.
const fable = (old: ClaudeQuota, e: Extract<QuotaEvent, { type: 'fable' }>): ClaudeQuota =>
  e.fable === undefined ? { ...old, isFableStale: old.fable !== undefined } : { ...old, fable: e.fable, isFableStale: false }

const codex = (old: CodexQuota, reading: CodexQuota): CodexQuota => ({
  ...reading,
  fiveHour: reading.fiveHour ?? old.fiveHour,
  weekly: reading.weekly ?? old.weekly,
})

export const reduceQuota = (quota: QuotaState, event: QuotaEvent): QuotaState => {
  switch (event.type) {
    case 'claude-quota':
      return { ...quota, claude: claude(quota.claude, event) }
    case 'fable':
      return { ...quota, claude: fable(quota.claude, event) }
    case 'codex-quota':
      return { ...quota, codex: codex(quota.codex, event.quota) }
  }
}
