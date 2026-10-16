import type { CodexQuota, UsageWindow } from '../../types'

// Codex's usage as the ChatGPT backend reports it, the call Codex's own /status makes:
//   GET https://chatgpt.com/backend-api/wham/usage
//   Authorization: Bearer <tokens.access_token>, ChatGPT-Account-Id: <tokens.account_id>
// answered with
//   {"plan_type":"pro","rate_limit":{"allowed":true,"limit_reached":false,
//    "primary_window":{"used_percent":8,"limit_window_seconds":18000,"reset_after_seconds":…,"reset_at":1791132451},
//    "secondary_window":{…}|null},…}
// It reads the account's figures without spending any of them, and counts what was used elsewhere
// (another computer, Codex on the web). It is a private API: anything it answers that is not this
// shape is no reading, and the rollouts are read instead. Plain text in, plain data out.

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** What the usage call is signed with; never kept in state, never drawn. */
export type CodexAuth = { accessToken: string; accountId?: string }

// A token or an account id goes into a header as it is: only the characters a JWT or an id holds.
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,8192}$/
const ACCOUNT = /^[A-Za-z0-9._:-]{1,128}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The ChatGPT login in `~/.codex/auth.json` (`tokens.access_token`, `tokens.account_id`); undefined
 * for an API-key login, no login, or anything that is not a header-safe token.
 */
export const parseCodexAuth = (json: string): CodexAuth | undefined => {
  try {
    const data: unknown = JSON.parse(json)
    const tokens = isRecord(data) && isRecord(data.tokens) ? data.tokens : undefined
    const token = tokens?.access_token
    if (typeof token !== 'string' || !TOKEN.test(token)) return undefined
    const account = tokens?.account_id

    return typeof account === 'string' && ACCOUNT.test(account) ? { accessToken: token, accountId: account } : { accessToken: token }
  } catch {
    return undefined
  }
}

/** The headers Codex itself sends with the call. */
export const usageHeaders = (auth: CodexAuth): Record<string, string> => ({
  Authorization: `Bearer ${auth.accessToken}`,
  'User-Agent': 'codex-cli',
  ...(auth.accountId === undefined ? {} : { 'ChatGPT-Account-Id': auth.accountId }),
})

const FIVE_HOUR_MAX_SECONDS = 6 * 3600

type Raw = { usedPercent: number; seconds: number; resetsAtMs?: number }

const windowOf = (value: unknown): Raw | undefined => {
  if (!isRecord(value)) return undefined
  const { used_percent: used, limit_window_seconds: seconds, reset_at: resetAt } = value
  if (typeof used !== 'number' || !Number.isFinite(used) || typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined
  const usedPercent = Math.min(100, Math.max(0, used))

  return typeof resetAt === 'number' && Number.isFinite(resetAt) && resetAt > 0
    ? { usedPercent, seconds, resetsAtMs: resetAt * 1000 }
    : { usedPercent, seconds }
}

const toWindow = ({ usedPercent, resetsAtMs }: Raw): UsageWindow => (resetsAtMs === undefined ? { usedPercent } : { usedPercent, resetsAtMs })

/**
 * The 5-hour and weekly windows of a usage answer, told apart by their length (not by which is
 * primary); undefined when it holds neither.
 */
export const parseCodexUsage = (text: string): Pick<CodexQuota, 'fiveHour' | 'weekly'> | undefined => {
  try {
    const data: unknown = JSON.parse(text)
    const limit = isRecord(data) && isRecord(data.rate_limit) ? data.rate_limit : undefined
    const windows = [windowOf(limit?.primary_window), windowOf(limit?.secondary_window)].filter((w): w is Raw => w !== undefined)
    const five = windows.find(w => w.seconds <= FIVE_HOUR_MAX_SECONDS)
    const week = windows.find(w => w.seconds > FIVE_HOUR_MAX_SECONDS)
    if (five === undefined && week === undefined) return undefined

    return { fiveHour: five === undefined ? undefined : toWindow(five), weekly: week === undefined ? undefined : toWindow(week) }
  } catch {
    return undefined
  }
}
