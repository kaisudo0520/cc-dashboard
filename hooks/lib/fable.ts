import type { UsageWindow } from '../../types'

// The Fable weekly window: not in the session's rate limits, so it is asked of
// /api/oauth/usage. Plain data in and out; the hooks do the calling.

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value))

const windowOf = (usedPercent: number, resetsAtMs: number): UsageWindow =>
  Number.isNaN(resetsAtMs) ? { usedPercent } : { usedPercent, resetsAtMs }

// Per-model weekly windows (Fable) are not in the session's rate limits. The
// server reports them in /api/oauth/usage as `limits[]` entries:
//   {"kind":"weekly_scoped","scope":{"model":{"display_name":"Fable"}},
//    "percent":12,"resets_at":"2026-10-11T08:00:00+00:00"}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFableLimit = (limit: Record<string, unknown>): boolean => {
  const model = isRecord(limit.scope) && isRecord(limit.scope.model) ? limit.scope.model : {}

  return (
    limit.kind === 'weekly_scoped' &&
    /fable/i.test(String(model.display_name)) &&
    typeof limit.percent === 'number' &&
    Number.isFinite(limit.percent)
  )
}

/** The Fable weekly window out of an /api/oauth/usage body, if the account has one. */
export const fableFromUsage = (json: string): UsageWindow | undefined => {
  try {
    const data: unknown = JSON.parse(json)
    const limits = isRecord(data) && Array.isArray(data.limits) ? data.limits : []
    const hit = limits.filter(isRecord).find(isFableLimit)
    if (hit === undefined || typeof hit.percent !== 'number') return undefined

    return windowOf(clampPercent(hit.percent), typeof hit.resets_at === 'string' ? Date.parse(hit.resets_at) : NaN)
  } catch {
    return undefined
  }
}

export const FABLE_POLL_MS = 90_000
const FABLE_BACKOFF_MAX_MS = 600_000

/**
 * How long to wait before asking again: the usual interval after an answer,
 * and after a failure double the last wait up to ten minutes, or as long as
 * the server asked for in `retry-after` (seconds) when that is longer.
 */
export const nextFableDelay = (previousMs: number, isOk: boolean, retryAfter: string | undefined): number => {
  if (isOk) return FABLE_POLL_MS

  const asked = Number(retryAfter) * 1000
  const backoff = Math.min(FABLE_BACKOFF_MAX_MS, Math.max(FABLE_POLL_MS, previousMs) * 2)

  return Number.isFinite(asked) && asked > 0 ? Math.min(FABLE_BACKOFF_MAX_MS, Math.max(asked, backoff)) : backoff
}
