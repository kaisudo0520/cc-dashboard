import { expect, test } from 'claude-code/testing'

import {
  activityText,
  ago,
  bar,
  clock,
  codexIcon,
  codexStatusText,
  countdown,
  duration,
  fillCells,
  effortLabel,
  logText,
  modelLabel,
  plain,
  statusIcon,
  swarmLabel,
  tokens,
  track,
} from '../hooks/lib/format'

test('ago says how long ago in minutes or hours, and never in the future', async () => {
  const now = 10 * 3_600_000
  expect(ago(now - 5_000, now)).toBe('剛剛')
  expect(ago(now + 5_000, now)).toBe('剛剛')
  expect(ago(now - 60_000, now)).toBe('1分前')
  expect(ago(now - 59 * 60_000, now)).toBe('59分前')
  expect(ago(now - 3_600_000, now)).toBe('1時前')
  expect(ago(now - 7 * 3_600_000, now)).toBe('7時前')
  expect(ago(undefined, now)).toBe('—')
})

test('plain turns control characters, escapes and bidirectional marks into spaces', async () => {
  expect(plain('feature/x')).toBe('feature/x')
  expect(plain('a\tb\nc')).toBe('a b c')
  expect(plain('x\u001b[31my')).toBe('x [31my')
  expect(plain('a‮b​c⁦d﻿e')).toBe('a b c d e')
  expect(plain('劇本稿/a.md')).toBe('劇本稿/a.md')
})

test('plain also clears the Arabic letter mark, the invisible operators and word joiner, the annotation marks and tag characters', async () => {
  for (const code of [0x061c, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfff9, 0xfffa, 0xfffb, 0xe0000, 0xe0041, 0xe007f]) {
    expect(plain(`a${String.fromCodePoint(code)}b`)).toBe('a b')
  }
  // The rest of the format characters: the soft hyphen, the Mongolian vowel separator, the deprecated shaping controls.
  for (const code of [0x00ad, 0x180e, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f]) {
    expect(plain(`a${String.fromCodePoint(code)}b`)).toBe('a b')
  }
  // The neighbours are ordinary text and stay.
  for (const code of [0x061b, 0x205f, 0xfff8, 0xfffc, 0xe0080, 0x1f600]) {
    expect(plain(`a${String.fromCodePoint(code)}b`)).toBe(`a${String.fromCodePoint(code)}b`)
  }
})

test('duration reads as seconds, minutes or hours and never goes negative', async () => {
  expect(duration(-5)).toBe('0s')
  expect(duration(0)).toBe('0s')
  expect(duration(12_400)).toBe('12s')
  expect(duration(59_999)).toBe('59s')
  expect(duration(65_000)).toBe('1m05s')
  expect(duration(3_599_000)).toBe('59m59s')
  expect(duration(3_720_000)).toBe('1h02m')
})

test('clock is the local HH:MM:SS of an epoch time', async () => {
  expect(clock(new Date(2026, 9, 14, 14, 2, 11).getTime())).toBe('14:02:11')
  expect(clock(new Date(2026, 9, 14, 0, 5, 9).getTime())).toBe('00:05:09')
})

test('tokens are compact', async () => {
  expect(tokens(0)).toBe('0')
  expect(tokens(842)).toBe('842')
  expect(tokens(1_234)).toBe('1.2k')
  expect(tokens(84_000)).toBe('84k')
  expect(tokens(200_000)).toBe('200k')
  expect(tokens(1_200_000)).toBe('1.2M')
})

test('modelLabel, logText and activityText draw what comes from outside as plain text', async () => {
  const dirty = 'a\u001b[31m\tb'

  expect(modelLabel(`claude-${dirty}`)).toBe('a [31m b')
  expect(logText({ at: 0, kind: 'spawn', detail: dirty })).toBe('子代理啟動 a [31m b')
  expect(activityText({ kind: 'tool', name: dirty })).toBe('執行工具 a [31m b')
})

test('modelLabel drops the vendor prefix and a trailing date', async () => {
  expect(modelLabel('claude-opus-5-5')).toBe('opus-5-5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  expect(modelLabel('haiku')).toBe('haiku')
  expect(modelLabel(undefined)).toBe('—')
})

test('swarmLabel names the one model the subagents run on, or says they differ', async () => {
  expect(swarmLabel([])).toBe('subagents')
  expect(swarmLabel([undefined, undefined])).toBe('subagents')
  expect(swarmLabel(['claude-haiku-5-5', 'claude-haiku-5-5', undefined])).toBe('haiku-5-5')
  expect(swarmLabel(['haiku', 'sonnet'])).toBe('mixed')
})

test('effortLabel names a level or a budget, and nothing when there is none', async () => {
  expect(effortLabel('xhigh')).toBe('xhigh')
  expect(effortLabel(8000)).toBe('8000')
  expect(effortLabel(undefined)).toBeUndefined()
})

test('every agent status has its own icon', async () => {
  const icons = (['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed'] as const).map(statusIcon)
  expect(new Set(icons).size).toBe(7)
  expect(statusIcon('completed')).toBe('✓')
  expect(statusIcon('failed')).toBe('✗')
})

test('bar fills in proportion and stays inside its width', async () => {
  expect(bar(0, 10)).toBe('░░░░░░░░░░')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(100, 10)).toBe('██████████')
  expect(bar(140, 4)).toBe('████')
  expect(bar(-3, 4)).toBe('░░░░')
  expect(bar(42, 0)).toBe('')
})

test('track is a line of the given width; a dot walks along it only while active', async () => {
  expect(track(6, 0, 'forward', false)).toBe('──────')
  expect(track(6, 0, 'forward', true)).toBe('●─────')
  expect(track(6, 3, 'forward', true)).toBe('───●──')
  expect(track(6, 6, 'forward', true)).toBe('●─────')
  expect(track(6, 0, 'back', true)).toBe('─────●')
  expect(track(6, 1, 'back', true)).toBe('────●─')
  expect(track(0, 3, 'forward', true)).toBe('')
})

test('activityText says what the main session is doing', async () => {
  expect(activityText({ kind: 'idle' })).toBe('閒置')
  expect(activityText({ kind: 'thinking' })).toBe('思考中')
  expect(activityText({ kind: 'tool', name: 'Bash' })).toBe('執行工具 Bash')
})

test('logText words each kind of entry', async () => {
  const at = 0
  expect(logText({ at, kind: 'turn-start', detail: '3' })).toBe('回合 3 開始')
  expect(logText({ at, kind: 'turn-end', detail: '3', durationMs: 65_000 })).toBe('回合 3 完成 · 1m05s')
  expect(logText({ at, kind: 'tool', detail: 'Read' })).toBe('工具 Read')
  expect(logText({ at, kind: 'spawn', detail: 'scan the repo' })).toBe('子代理啟動 scan the repo')
  expect(logText({ at, kind: 'agent-end', detail: 'scan: completed' })).toBe('子代理結束 scan: completed')
  expect(logText({ at, kind: 'advisor', detail: 'claude-fable-5-1' })).toBe('顧問諮詢 · fable-5-1')
  expect(logText({ at, kind: 'advisor', detail: '' })).toBe('顧問諮詢')
  expect(logText({ at, kind: 'codex-start', detail: 'Codex 審查' })).toBe('Codex 啟動 Codex 審查')
  expect(logText({ at, kind: 'codex-done', detail: 'Codex 審查' })).toBe('Codex 完成 Codex 審查')
  expect(logText({ at, kind: 'codex-fail', detail: 'Codex 審查' })).toBe('Codex 失敗 Codex 審查')
})

test('countdown names the time left in two units at most, and a dash when the reset is unknown', async () => {
  const now = 1_000_000
  expect(countdown(undefined, now)).toBe('—')
  expect(countdown(now + 30_000, now)).toBe('<1m')
  expect(countdown(now + 7 * 60_000, now)).toBe('7m')
  expect(countdown(now + 65 * 60_000, now)).toBe('1h05m')
  expect(countdown(now + (2 * 1440 + 3 * 60 + 9) * 60_000, now)).toBe('2d3h')
  expect(countdown(now - 5000, now)).toBe('<1m')
})

test('fillCells fills a bar in proportion and stays inside it', async () => {
  expect(fillCells(0, 10)).toBe(0)
  expect(fillCells(50, 10)).toBe(5)
  expect(fillCells(100, 10)).toBe(10)
  expect(fillCells(140, 10)).toBe(10)
  expect(fillCells(-5, 10)).toBe(0)
})

test('a Codex run has its own icon and word for each status', async () => {
  expect(codexIcon('running')).toBe(statusIcon('running'))
  expect(codexIcon('done')).toBe('✓')
  expect(codexIcon('failed')).toBe('✗')
  expect(codexStatusText('running')).toBe('執行中')
  expect(codexStatusText('done')).toBe('完成')
  expect(codexStatusText('failed')).toBe('失敗')
})
