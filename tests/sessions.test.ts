import { expect, test } from 'claude-code/testing'

import { liveSessions, parseSessionFile, parseSessionFiles, parseTasklist, readLiveSessions } from '../hooks/lib/sessions'
import type { SessionFile, SessionIo } from '../hooks/lib/sessions'

const file = (over: Partial<SessionFile> = {}): SessionFile => ({ pid: 11, sessionId: 'sid-1', name: 'here-session', ...over })

test('a registry file gives its pid, session id and name', () => {
  expect(parseSessionFile('{"pid":31600,"sessionId":"abc","name":"jev-router-41","entrypoint":"cli","status":"busy"}')).toEqual({
    pid: 31600,
    sessionId: 'abc',
    name: 'jev-router-41',
  })
})

test('a registry file with no name is called by the start of its session id', () => {
  expect(parseSessionFile('{"pid":1,"sessionId":"0123456789abcdef"}')?.name).toBe('01234567')
})

test('a name is cut to 80 characters', () => {
  expect(parseSessionFile(JSON.stringify({ pid: 1, sessionId: 's', name: 'x'.repeat(200) }))?.name).toHaveLength(80)
})

test('a registry file that is broken, or lacks a usable pid or session id, is skipped', () => {
  expect(parseSessionFile('')).toBe(undefined)
  expect(parseSessionFile('not json')).toBe(undefined)
  expect(parseSessionFile('{"pid":"11","sessionId":"s"}')).toBe(undefined)
  expect(parseSessionFile('{"pid":11}')).toBe(undefined)
  expect(parseSessionFile('{"pid":-4,"sessionId":"s"}')).toBe(undefined)
  expect(parseSessionFile('{"pid":1.5,"sessionId":"s"}')).toBe(undefined)
  expect(parseSessionFile('null')).toBe(undefined)
})

test('parseSessionFiles keeps the files that parse and drops the rest', () => {
  const good = JSON.stringify({ pid: 5, sessionId: 'a', name: 'one' })

  expect(parseSessionFiles([good, 'nope', '', '{"pid":"x"}'])).toEqual([{ pid: 5, sessionId: 'a', name: 'one' }])
})

test('tasklist CSV gives pid to image name, and lines that are not rows are ignored', () => {
  const csv = '"claude.exe","31600","Console","1","200,000 K"\r\n"node.exe","22","Console","1","5 K"\r\nINFO: nothing\r\n\r\n'
  const map = parseTasklist(csv)

  expect(map.get(31600)).toBe('claude.exe')
  expect(map.get(22)).toBe('node.exe')
  expect(map.size).toBe(2)
  expect(parseTasklist('').size).toBe(0)
})

test('a session counts only while its pid still runs as Claude Code', () => {
  const files = [file({ pid: 11, sessionId: 'a' }), file({ pid: 22, sessionId: 'b' }), file({ pid: 33, sessionId: 'c' })]
  const processes = new Map([
    [11, 'claude.exe'],
    [22, 'chrome.exe'],
    [33, 'node.exe'],
  ])

  expect(liveSessions(files, processes, 'zzz').map(s => s.id)).toEqual(['a', 'c'])
})

test('the session of this process is marked, and a session id appears once', () => {
  const files = [file({ pid: 11, sessionId: 'here', name: 'one' }), file({ pid: 12, sessionId: 'here', name: 'two' }), file({ pid: 22, sessionId: 'b', name: 'other' })]
  const processes = new Map([
    [11, 'claude.exe'],
    [12, 'claude.exe'],
    [22, 'claude.exe'],
  ])
  const rows = liveSessions(files, processes, 'here')

  expect(rows).toHaveLength(2)
  expect(rows.filter(r => r.isHere).map(r => r.id)).toEqual(['here'])
  expect(rows.find(r => r.id === 'b')).toEqual({ id: 'b', pid: 22, name: 'other', isHere: false })
})

test('with no process list nobody is alive', () => {
  expect(liveSessions([file()], new Map(), 'sid-1')).toEqual([])
})

const entry = (name: string, mtimeMs = 0, size = 100, kind: 'file' | 'dir' | 'other' = 'file', isLink = false) => ({
  name,
  size,
  mtimeMs,
  kind,
  isLink,
})

const registry = (tasklist: { exitCode: number; stdout: string }, reads: string[] = []): SessionIo => ({
  list: async () => [entry('11.json'), entry('notes.txt'), entry('22.json')],
  read: async path => {
    reads.push(path)

    return path.endsWith('11.json')
      ? JSON.stringify({ pid: 11, sessionId: 'here', name: 'one' })
      : JSON.stringify({ pid: 22, sessionId: 'b', name: 'two' })
  },
  tasklist: async () => tasklist,
})

test('readLiveSessions reads only the registry\'s pid files and keeps the ones whose process runs', async () => {
  const reads: string[] = []
  const table = { exitCode: 0, stdout: '"claude.exe","11","Console","1","5 K"\r\n"chrome.exe","22","Console","1","5 K"\r\n' }

  expect(await readLiveSessions('/h', 'here', registry(table, reads))).toEqual([{ id: 'here', pid: 11, name: 'one', isHere: true }])
  expect(reads).toEqual(['/h/.claude/sessions/11.json', '/h/.claude/sessions/22.json'])
})

const TABLE = { exitCode: 0, stdout: '' }

test('readLiveSessions reads only the 32 newest registry files, by modification time', async () => {
  const reads: string[] = []
  const files = Array.from({ length: 40 }, (_, i) => entry(`${i + 1}.json`, 1000 + i))
  const io: SessionIo = { list: async () => files, read: async path => (reads.push(path), '{}'), tasklist: async () => TABLE }

  await readLiveSessions('/h', 'here', io)

  expect(reads).toHaveLength(32)
  expect(reads).toContain('/h/.claude/sessions/40.json')
  expect(reads).toContain('/h/.claude/sessions/9.json')
  expect(reads).not.toContain('/h/.claude/sessions/8.json')
  expect(reads).not.toContain('/h/.claude/sessions/1.json')
})

test('readLiveSessions skips a registry file over 64 KB without opening it', async () => {
  const reads: string[] = []
  const files = [entry('1.json', 5, 65_536), entry('2.json', 4, 65_537), entry('3.json', 3, 0)]
  const io: SessionIo = { list: async () => files, read: async path => (reads.push(path), '{}'), tasklist: async () => TABLE }

  await readLiveSessions('/h', 'here', io)

  expect(reads).toEqual(['/h/.claude/sessions/1.json', '/h/.claude/sessions/3.json'])
})

test('readLiveSessions reads only plain files: not a folder, a link or anything else named like a registry file', async () => {
  const reads: string[] = []
  const files = [
    entry('1.json', 9),
    entry('2.json', 8, 100, 'dir'),
    entry('3.json', 7, 0, 'other', true),
    entry('4.json', 6, 100, 'file', true),
    entry('5.json', 5, 100, 'other'),
  ]
  const io: SessionIo = { list: async () => files, read: async path => (reads.push(path), '{}'), tasklist: async () => TABLE }

  await readLiveSessions('/h', 'here', io)

  expect(reads).toEqual(['/h/.claude/sessions/1.json'])
})

test('readLiveSessions rejects when the process table fails', async () => {
  await expect(readLiveSessions('/h', 'here', registry({ exitCode: 1, stdout: '' }))).rejects.toThrow('tasklist exited 1')
})
