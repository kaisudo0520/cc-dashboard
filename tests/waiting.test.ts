import { expect, test } from 'claude-code/testing'

import { bannerText, isQuestionTool, markText, parseMark, sameWaits, waitingRows } from '../hooks/lib/waiting'
import type { LiveSession, WaitingRow } from '../types'

const row = (over: Partial<LiveSession>): LiveSession => ({ id: 'sid-1', pid: 11, name: 'akashic-deja-vu-86', isHere: false, ...over })

test('a mark written by one session reads back for that session only', () => {
  const text = markText('sid-1', 'permission', 5000)
  expect(parseMark(text, 'sid-1')).toEqual({ reason: 'permission', sinceMs: 5000 })
  // The pid was reused by another session: the file is not its own.
  expect(parseMark(text, 'sid-2')).toBe(undefined)
})

test('the mark file holds exactly sessionId, reason and sinceMs, the shape the other sidebar reads', () => {
  expect(JSON.parse(markText('sid-1', 'question', 7))).toEqual({ sessionId: 'sid-1', reason: 'question', sinceMs: 7 })
  expect(JSON.parse(markText('sid-1', null, 0))).toEqual({ sessionId: 'sid-1', reason: null, sinceMs: 0 })
})

test('a cleared, broken or foreign mark is no wait', () => {
  expect(parseMark(markText('sid-1', null, 5000), 'sid-1')).toBe(undefined)
  expect(parseMark('not json', 'sid-1')).toBe(undefined)
  expect(parseMark('{"sessionId":"sid-1","reason":"nap","sinceMs":1}', 'sid-1')).toBe(undefined)
  expect(parseMark('', 'sid-1')).toBe(undefined)
  expect(parseMark('null', 'sid-1')).toBe(undefined)
})

test('a mark with no usable sinceMs still counts as a wait, since the beginning of time', () => {
  expect(parseMark('{"sessionId":"sid-1","reason":"question"}', 'sid-1')).toEqual({ reason: 'question', sinceMs: 0 })
})

test('waitingRows lists the other sessions waiting on the person, longest wait first', () => {
  const rows = [
    row({ id: 'here', pid: 1, isHere: true }),
    row({ id: 'a', pid: 2, name: 'jev-router-41' }),
    row({ id: 'b', pid: 3, name: 'akashic-deja-vu-86' }),
    row({ id: 'c', pid: 4, name: 'quiet' }),
  ]
  const marks: Record<number, string> = {
    1: markText('here', 'question', 100),
    2: markText('a', 'permission', 3000),
    3: markText('b', 'question', 1000),
    4: markText('c', null, 0),
  }

  expect(waitingRows(rows, pid => marks[pid] ?? '')).toEqual([
    { id: 'b', name: 'akashic-deja-vu-86', reason: 'question', sinceMs: 1000 },
    { id: 'a', name: 'jev-router-41', reason: 'permission', sinceMs: 3000 },
  ])
})

test('two reads found the same waits when the rows are equal in content and order', () => {
  const row = { id: 'b', name: 'other', reason: 'permission', sinceMs: 5 } as const

  expect(sameWaits([], [])).toBe(true)
  expect(sameWaits([row], [{ ...row }])).toBe(true)
  expect(sameWaits([row], [])).toBe(false)
  expect(sameWaits([row], [{ ...row, sinceMs: 6 }])).toBe(false)
  expect(sameWaits([row, { ...row, id: 'c' }], [{ ...row, id: 'c' }, row])).toBe(false)
})

test('a question to the person is AskUserQuestion or a plan to approve', () => {
  expect(isQuestionTool('AskUserQuestion')).toBe(true)
  expect(isQuestionTool('ExitPlanMode')).toBe(true)
  expect(isQuestionTool('Bash')).toBe(false)
})

const NOW = 10 * 60_000
const waiting = (over: Partial<WaitingRow> = {}): WaitingRow => ({ id: 'a', name: 'jev-router-41', reason: 'permission', sinceMs: NOW - 120_000, ...over })

test('with nobody waiting there is no banner text', () => {
  expect(bannerText([], NOW)).toBe(undefined)
})

test('the banner names the longest-waiting session, its reason and how long ago the wait began', () => {
  expect(bannerText([waiting()], NOW)).toBe('! waiting on you: jev-router-41 permission 2m ago')
  expect(bannerText([waiting({ reason: 'question', sinceMs: NOW - 5000 })], NOW)).toBe('! waiting on you: jev-router-41 question just now')
  expect(bannerText([waiting({ sinceMs: NOW - 3 * 3_600_000 })], NOW)).toBe('! waiting on you: jev-router-41 permission 3h ago')
})

test('more sessions waiting add how many more there are', () => {
  const rows = [waiting(), waiting({ id: 'b', name: 'other' }), waiting({ id: 'c', name: 'third' })]

  expect(bannerText(rows, NOW)).toBe('! waiting on you: jev-router-41 permission 2m ago · +2 more')
})

test('a session name from the registry cannot carry control characters or bidirectional marks into the banner', () => {
  const text = bannerText([waiting({ name: 'evil\u001b[31m‮name' })], NOW)

  expect(text).toBe('! waiting on you: evil [31m name permission 2m ago')
})
