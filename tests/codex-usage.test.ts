import { expect, test } from 'claude-code/testing'

import { readCodexQuota } from '../hooks/lib/codex-quota'
import type { CodexIo } from '../hooks/lib/codex-quota'
import { CODEX_USAGE_URL, parseCodexAuth, parseCodexUsage, usageHeaders } from '../hooks/lib/codex-usage'

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl'
const AUTH = JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: 'x', access_token: TOKEN, refresh_token: 'r', account_id: 'acct-123' } })
const USAGE = JSON.stringify({
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 8, limit_window_seconds: 18000, reset_after_seconds: 600, reset_at: 1791132451 },
    secondary_window: { used_percent: 41, limit_window_seconds: 604800, reset_after_seconds: 9000, reset_at: 1791600000 },
  },
})

test('parseCodexAuth reads the ChatGPT login Codex keeps, and only a header-safe token', () => {
  expect(parseCodexAuth(AUTH)).toEqual({ accessToken: TOKEN, accountId: 'acct-123' })
  expect(parseCodexAuth(JSON.stringify({ tokens: { access_token: TOKEN } }))).toEqual({ accessToken: TOKEN })
  // An API-key login, no login, a broken file, or a token that could break a header: no login.
  expect(parseCodexAuth(JSON.stringify({ OPENAI_API_KEY: 'sk-abc', tokens: null }))).toBeUndefined()
  expect(parseCodexAuth('')).toBeUndefined()
  expect(parseCodexAuth('{')).toBeUndefined()
  expect(parseCodexAuth(JSON.stringify({ tokens: { access_token: `${TOKEN}\r\nX-Evil: 1` } }))).toBeUndefined()
  // An account id that is not header-safe is left out; the token still signs the call.
  expect(parseCodexAuth(JSON.stringify({ tokens: { access_token: TOKEN, account_id: 'a\nb' } }))).toEqual({ accessToken: TOKEN })
})

test('the call is signed as Codex signs it', () => {
  expect(CODEX_USAGE_URL).toBe('https://chatgpt.com/backend-api/wham/usage')
  expect(usageHeaders({ accessToken: TOKEN, accountId: 'acct-123' })).toEqual({
    Authorization: `Bearer ${TOKEN}`,
    'User-Agent': 'codex-cli',
    'ChatGPT-Account-Id': 'acct-123',
  })
  expect(usageHeaders({ accessToken: TOKEN })).not.toHaveProperty('ChatGPT-Account-Id')
})

test('parseCodexUsage tells the windows apart by their length, whichever is primary', () => {
  expect(parseCodexUsage(USAGE)).toEqual({
    fiveHour: { usedPercent: 8, resetsAtMs: 1791132451000 },
    weekly: { usedPercent: 41, resetsAtMs: 1791600000000 },
  })
  const swapped = JSON.parse(USAGE)
  ;[swapped.rate_limit.primary_window, swapped.rate_limit.secondary_window] = [swapped.rate_limit.secondary_window, swapped.rate_limit.primary_window]
  expect(parseCodexUsage(JSON.stringify(swapped))?.fiveHour?.usedPercent).toBe(8)
  const single = JSON.parse(USAGE)
  single.rate_limit.secondary_window = null
  expect(parseCodexUsage(JSON.stringify(single))).toEqual({ fiveHour: { usedPercent: 8, resetsAtMs: 1791132451000 }, weekly: undefined })
})

test('parseCodexUsage answers nothing for another shape, and never makes a figure up', () => {
  expect(parseCodexUsage('<html>login</html>')).toBeUndefined()
  expect(parseCodexUsage(JSON.stringify({ plan_type: 'free', rate_limit: null }))).toBeUndefined()
  expect(parseCodexUsage(JSON.stringify({ rate_limit: { primary_window: { used_percent: '8', limit_window_seconds: 18000 } } }))).toBeUndefined()
  expect(parseCodexUsage(JSON.stringify({ rate_limit: { primary_window: { used_percent: 140, limit_window_seconds: 18000 } } }))).toEqual({
    fiveHour: { usedPercent: 100 },
    weekly: undefined,
  })
})

const ROLLOUT_LINE =
  '{"timestamp":"2026-10-14T10:00:00Z","payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":62.0,"window_minutes":300,"resets_at":1791132451},"secondary":{"used_percent":30.0,"window_minutes":10080,"resets_at":1791600000}}}}'
const DAY = '/h/.codex/sessions/2026/10/14'
const io = (over: Partial<CodexIo> & { files?: Record<string, string> } = {}): CodexIo & { asked: string[] } => {
  const asked: string[] = []
  const files: Record<string, string> = { '/h/.codex/auth.json': AUTH, ...over.files }
  return {
    asked,
    readText: async path => files[path] ?? '',
    list: async path =>
      path === '/h/.codex/sessions'
        ? [{ name: '2026', kind: 'dir', mtimeMs: 0 }]
        : path.endsWith('/2026')
          ? [{ name: '10', kind: 'dir', mtimeMs: 0 }]
          : path.endsWith('/10')
            ? [{ name: '14', kind: 'dir', mtimeMs: 0 }]
            : path === DAY
              ? [{ name: 'rollout-a.jsonl', kind: 'file', mtimeMs: 1 }]
              : [],
    stat: async () => 1,
    queryRollout: async path => {
      asked.push(path)
      return ROLLOUT_LINE
    },
    ...over,
  }
}

test('the server figures win when the login can ask for them, and no rollout is read', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const at = io({ fetch: async (url, headers) => (calls.push({ url, headers }), { ok: true, text: USAGE }) })
  const quota = await readCodexQuota('/h', at)
  expect(quota).toEqual({ model: 'gpt-6-sol', fiveHour: { usedPercent: 8, resetsAtMs: 1791132451000 }, weekly: { usedPercent: 41, resetsAtMs: 1791600000000 } })
  expect(calls.map(c => c.url)).toEqual([CODEX_USAGE_URL])
  expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  expect(at.asked).toEqual([])
  // The token is used for the request alone: nothing that is kept or drawn carries it.
  expect(JSON.stringify(quota)).not.toContain(TOKEN)
})

test('a refused, failed or unreadable answer falls back to the rollouts', async () => {
  for (const fetch of [
    async () => ({ ok: false, text: '{"detail":"token expired"}' }),
    async () => ({ ok: true, text: '<html></html>' }),
    async () => {
      throw new Error('offline')
    },
  ]) {
    const at = io({ fetch })
    expect((await readCodexQuota('/h', at)).fiveHour?.usedPercent).toBe(62)
    expect(at.asked.length).toBe(1)
  }
})

test('without a ChatGPT login, or with no way to fetch, the server is not asked', async () => {
  let asked = 0
  const fetch = async () => (asked++, { ok: true, text: USAGE })
  expect((await readCodexQuota('/h', io({ fetch, files: { '/h/.codex/auth.json': '{"OPENAI_API_KEY":"sk-x"}' } }))).fiveHour?.usedPercent).toBe(62)
  expect(asked).toBe(0)
  expect((await readCodexQuota('/h', io())).fiveHour?.usedPercent).toBe(62)
})
