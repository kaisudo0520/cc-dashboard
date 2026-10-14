import { expect, test } from 'claude-code/testing'

import {
  CHANGED,
  NARROW_PROPS,
  REVIEW_KEY,
  SEEN,
  SHOWN,
  WIDE_PROPS,
  beginTurn,
  endTurn,
  engine,
  mountPane,
  order,
  readyPane,
  repoWorld,
  start,
  text,
  topCalls,
} from './harness'
import type { PaneProps, World } from './harness'

// --- 分支 (git) ---------------------------------------------------------------

const MID_PROPS: PaneProps = { ...WIDE_PROPS, bodyColumns: 80 }

const SUBCOMMANDS = ['rev-parse', 'config', 'status', 'hash-object']

// Every git call, whatever it asks: read-only, no repository-configured program, no lazy fetch.
const expectOnlyReadOnlyGit = (world: World): void => {
  for (const { argv, env } of world.gitCalls) {
    expect(argv[0]).toBe('git')
    expect(argv).toContain('--no-optional-locks')
    expect(argv).toContain('core.fsmonitor=false')
    expect(argv).toContain('protocol.ext.allow=never')
    expect(env).toEqual({ GIT_NO_LAZY_FETCH: '1' })
    expect(argv).not.toContain('-w')
    if (argv.includes('hash-object')) expect(argv).toContain('--no-filters')
    if (argv.includes('status')) expect(argv).toContain('--ignore-submodules=all')
    expect(SUBCOMMANDS.some(sub => argv.includes(sub))).toBe(true)
  }
}

test('outside a git repository the 分支 panel is not drawn, wide or narrow', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN] })
  const pane = await readyPane($, clock)

  expect(topCalls(world)).toBe(1)
  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(await text(pane, /分支/)).toBeUndefined()
  await pane.unmount()
  const narrow = await mountPane($, NARROW_PROPS)
  expect(await narrow.find({ key: 'git-line' })).toBeUndefined()
  expect(await text(narrow, /變更/)).toBeUndefined()
})

test('a wide pane shows the 分支 panel in a column beside MAIN, the quota header still above', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'quota' })).toBeDefined()
  expect(await pane.find({ key: 'git' })).toBeDefined()
  expect(await pane.find({ key: 'git-line' })).toBeUndefined()
  expect((await pane.find({ key: 'git-toggle' }))?.props.label).toBe('▾ 分支')
  expect(await text(pane, '變更 2')).toBeDefined()
  expect(await text(pane, '↔ origin/main')).toBeDefined()
  expect(await text(pane, '↑2 ↓1')).toBeDefined()
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 2')
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.hotkey).toBe('u')
  // The column is inside the body row, next to MAIN.
  const body = await pane.find({ key: 'body' })
  expect(JSON.stringify(body?.children)).toContain('"git"')
  expect(JSON.stringify(body?.children)).toContain('"main"')
})

test('u unfolds the unreviewed paths and folds them again', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)
  expect(await text(pane, 'src/a.ts')).toBeUndefined()

  await pane.press({ key: 'git-unreviewed' })
  expect(await text(pane, 'src/a.ts')).toBeDefined()
  expect(await text(pane, 'new.ts')).toBeDefined()
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▾ 未審 2')

  await pane.press({ key: 'git-unreviewed' })
  expect(await text(pane, 'src/a.ts')).toBeUndefined()
})

test('the unfolded list shows at most 20 paths and counts the rest', async ($, on) => {
  const many = Array.from({ length: 25 }, (_, i) => `? f${i}.ts`)
  const hashes = `${Array.from({ length: 25 }, (_, i) => `h${i}`).join('\n')}\n`
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld(many, hashes) })
  // Tall enough for the column to hold all twenty listed paths and the closing row.
  const pane = await readyPane($, clock, { ...WIDE_PROPS, scroll: { offset: 0, bodyRows: 60 } })

  expect(await text(pane, '變更 25')).toBeDefined()
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 25')
  await pane.press({ key: 'git-unreviewed' })
  expect(await pane.findAll({ type: 'Text', text: /^f\d+\.ts$/ })).toHaveLength(20)
  expect(await text(pane, '… 另有 5 個')).toBeDefined()
})

test('when the hash check fails the panel says 未知 and never ✓ 未審 0', async ($, on) => {
  const base = repoWorld()
  const { clock } = engine(on, { panes: [SHOWN], git: { ...base.git, hash: { exitCode: 128, stdout: '' } } })
  const pane = await readyPane($, clock)

  expect(await text(pane, '未審 未知')).toBeDefined()
  expect(await text(pane, /未審 0/)).toBeUndefined()
  expect(await text(pane, '變更 2')).toBeDefined()
  // There is nothing to unfold.
  expect(await pane.find({ key: 'git-unreviewed' })).toBeUndefined()
  await pane.unmount()
  const narrow = await mountPane($, NARROW_PROPS)
  expect(await text(narrow, 'main · 變更 2 · 未審 未知')).toBeDefined()
})

test('when what the last review saw cannot be read the count is 未知 too', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld(), isStoreBroken: true })
  const pane = await readyPane($, clock)

  expect(await text(pane, '未審 未知')).toBeDefined()
  expect(await text(pane, /未審 0/)).toBeUndefined()
})

test('files a review saw are not unreviewed: with all seen the panel says ✓ 未審 0', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld(), store: { [REVIEW_KEY]: SEEN } })
  const pane = await readyPane($, clock)

  expect(await text(pane, '✓ 未審 0')).toBeDefined()
  expect(await pane.find({ key: 'git-unreviewed' })).toBeUndefined()
})

test('a file changed since the review counts as unreviewed again', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld(), store: { [REVIEW_KEY]: { ...SEEN, 'new.ts': 'older' } } })
  const pane = await readyPane($, clock)

  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 1')
})

test('records the other sidebar kept for the same repository are not read', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld(), store: { 'reviewed:N:/repo': SEEN } })
  const pane = await readyPane($, clock)

  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 2')
})

test('a narrow pane shows one summary line, and u unfolds the paths under it', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock, NARROW_PROPS)

  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(await pane.find({ key: 'git-line' })).toBeDefined()
  expect(await text(pane, 'main · 變更 2 · 未審 2')).toBeDefined()
  expect(await text(pane, 'src/a.ts')).toBeUndefined()

  await pane.press({ key: 'git-unreviewed' })
  expect(await text(pane, 'src/a.ts')).toBeDefined()
  expect(await text(pane, 'new.ts')).toBeDefined()
})

test('the summary line sits below the Context bar and above the SESSION LOG', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock, NARROW_PROPS)

  expect(await order(pane, ['context', 'git-line', 'log'])).toEqual(['context', 'git-line', 'log'])
})

test('a wide pane too narrow for the column uses the summary line', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock, MID_PROPS)

  expect(await pane.find({ key: 'dash-wide' })).toBeDefined()
  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(await text(pane, 'main · 變更 2 · 未審 2')).toBeDefined()
})

test('git is read every 30 seconds while the pane shows, and not at all while it does not', async ($, on) => {
  const { world, clock } = engine(on, { ...repoWorld() })
  await start($)
  await clock.advance(600_000)
  expect(world.gitCalls).toHaveLength(0)

  world.panes = [SHOWN]
  await clock.advance(3000)
  expect(topCalls(world)).toBe(1)
  await clock.advance(300_000)
  expect(topCalls(world)).toBeGreaterThanOrEqual(10)
  expect(topCalls(world)).toBeLessThanOrEqual(12)
  expectOnlyReadOnlyGit(world)
})

test('a read still running is not started again, however long it takes', async ($, on) => {
  let release: () => void = () => undefined
  const { world, clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  world.gitHold = new Promise<void>(resolve => {
    release = resolve
  })
  await start($)
  await clock.advance(3000)
  await clock.advance(120_000)
  expect(topCalls(world)).toBe(1)

  release()
  await clock.advance(100)
  expect(world.gitCalls).toHaveLength(4)
  await clock.advance(31_000)
  expect(topCalls(world)).toBe(2)
})

test('a second session.start (hot reload) does not start a second git poller', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  await start($)
  await start($)
  await clock.advance(3000)
  await clock.advance(300_000)

  expect(topCalls(world)).toBeLessThanOrEqual(12)
})

test('the end of a turn brings the next read forward', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  await start($)
  await clock.advance(3000)
  world.git = repoWorld([...CHANGED, '? third.ts'], 'h1\nh2\nh3\n').git
  await beginTurn($)
  await endTurn($)
  await clock.advance(2100)

  const pane = await mountPane($)
  expect(await text(pane, '變更 3')).toBeDefined()
})

test('a git that cannot be run empties the panel instead of leaving old figures', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)
  expect(await pane.find({ key: 'git' })).toBeDefined()

  world.isGitBroken = true
  await clock.advance(33_000)
  expect(await pane.find({ key: 'git' })).toBeUndefined()
  world.isGitBroken = false
  await clock.advance(33_000)
  expect(await pane.find({ key: 'git' })).toBeDefined()
})

test('leaving the repository hides the panel at the next read', async ($, on) => {
  const { world, clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  const pane = await readyPane($, clock)
  expect(await pane.find({ key: 'git' })).toBeDefined()

  world.git = { top: { exitCode: 128, stdout: '' }, status: { exitCode: 128, stdout: '' }, hash: { exitCode: 128, stdout: '' } }
  await clock.advance(33_000)
  expect(await pane.find({ key: 'git' })).toBeUndefined()
})

test('a /clear leaves the panel as it was', async ($, on) => {
  const { clock } = engine(on, { panes: [SHOWN], ...repoWorld() })
  await (await readyPane($, clock)).unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const pane = await mountPane($)
  expect(await text(pane, '變更 2')).toBeDefined()
})

// A review is noted from the tree read as it starts, kept only if it gets under way.

const SKILL_REVIEW = { tool: 'Skill', skill: 'code-review' } as const

test('a review skill records the contents it saw, and the panel then counts none unreviewed', async ($, on) => {
  const { world, clock } = engine(on, { ...repoWorld() })
  await start($)
  await $.tool.call(SKILL_REVIEW)
  await clock.advance(10)

  expect(world.storeWrites.map(write => write.key)).toEqual([REVIEW_KEY, 'git-reviewed-index'])
  expect(world.store[REVIEW_KEY]).toEqual(SEEN)
  expect(world.gitCalls).toHaveLength(4)
  expectOnlyReadOnlyGit(world)
  const pane = await mountPane($)
  expect(await text(pane, '✓ 未審 0')).toBeDefined()
})

test('a reviewer subagent records the contents it saw', async ($, on) => {
  const { world, clock } = engine(on, { ...repoWorld() })
  await start($)
  await $.tool.call({ tool: 'Agent', subagent_type: 'opus-reviewer', description: 'review', prompt: 'review the diff' })
  await clock.advance(10)

  expect(world.store[REVIEW_KEY]).toEqual(SEEN)
})

test('a call that is not a review records nothing and reads no tree', async ($, on) => {
  const { world, clock } = engine(on, { ...repoWorld() })
  await start($)
  await $.tool.call({ tool: 'Skill', skill: 'simplify' })
  await $.tool.call({ tool: 'Agent', subagent_type: 'sonnet-coder', description: 'code', prompt: 'review this' })
  await clock.advance(10)

  expect(world.storeWrites).toEqual([])
  expect(world.gitCalls).toEqual([])
})

test('a review that fails or is refused records nothing', async ($, on) => {
  const { world, clock } = engine(on, { ...repoWorld(), toolResult: { result: 'boom', isError: true } })
  await start($)
  await $.tool.call(SKILL_REVIEW)
  world.toolResult = { deny: 'not allowed' }
  await $.tool.call(SKILL_REVIEW)
  await clock.advance(10)

  expect(world.storeWrites).toEqual([])
})

test('a typed /code-review records the contents as it is sent; a notification or a sentence about one does not', async ($, on) => {
  const { world, clock } = engine(on, { ...repoWorld() })
  await start($)
  await $.prompt.submit({ text: '/code-review high', wait: false, origin: { kind: 'task-notification' } })
  await $.prompt.submit({ text: 'please run /code-review later', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(world.storeWrites).toEqual([])

  await $.prompt.submit({ text: '/code-review high', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(world.store[REVIEW_KEY]).toEqual(SEEN)
})

test('a review records nothing outside a repository', async ($, on) => {
  const outside = engine(on)
  await start($)
  await $.tool.call(SKILL_REVIEW)
  await outside.clock.advance(10)
  expect(outside.world.storeWrites).toEqual([])
})

test('a review whose hashes could not be had leaves the stored record alone', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, {
    git: { ...base.git, hash: { exitCode: 128, stdout: '' } },
    store: { [REVIEW_KEY]: SEEN },
  })
  await start($)
  await $.tool.call(SKILL_REVIEW)
  await clock.advance(10)

  expect(world.storeWrites).toEqual([])
})

// --- Hardening: the repository's own configuration is not trusted --------------------------

const LFS_FILTERS = { exitCode: 0, stdout: 'filter.lfs.clean\0filter.lfs.smudge\0filter.lfs.process\0filter.lfs.required\0' }

test('a filter driver the configuration names is switched off in every status and hash-object, and nowhere else', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, { panes: [SHOWN], git: { ...base.git, config: LFS_FILTERS } })
  await readyPane($, clock)

  expectOnlyReadOnlyGit(world)
  const off = ['-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false']
  for (const { argv } of world.gitCalls) {
    const subcommand = SUBCOMMANDS.find(sub => argv.includes(sub))
    const isOff = argv.join(' ').includes(off.join(' '))

    expect(isOff).toBe(subcommand === 'status' || subcommand === 'hash-object')
  }
})

test('when the filters cannot be listed the panel is hidden and status is never run', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, { panes: [SHOWN], git: { ...base.git, config: { exitCode: 128, stdout: '' } } })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(await pane.find({ key: 'git-line' })).toBeUndefined()
  expect(world.gitCalls.some(call => call.argv.includes('status') || call.argv.includes('hash-object'))).toBe(false)
})

test('output the engine truncated (a filter listing, a status) hides the panel: no partial counts, no driver left switched on', async ($, on) => {
  const base = repoWorld()
  const cut = engine(on, { panes: [SHOWN], git: { ...base.git, config: { ...LFS_FILTERS, isStdoutTruncated: true } } })
  const listing = await readyPane($, cut.clock)
  expect(await listing.find({ key: 'git' })).toBeUndefined()
  expect(cut.world.gitCalls.some(call => call.argv.includes('status'))).toBe(false)
})

test('a truncated status hides the panel too', async ($, on) => {
  const base = repoWorld()
  const { clock } = engine(on, { panes: [SHOWN], git: { ...base.git, status: { ...base.git.status, isStdoutTruncated: true } } })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(await text(pane, /變更/)).toBeUndefined()
})

test('an untracked path that lands outside the repository (a junction) is not hashed, and stays unreviewed', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, {
    panes: [SHOWN],
    git: { ...base.git, hash: { exitCode: 0, stdout: 'h1\n' } },
    lands: { 'N:/repo/new.ts': 'D:\\outside\\new.ts' },
    store: { [REVIEW_KEY]: SEEN },
  })
  const pane = await readyPane($, clock)

  expect(world.gitCalls.find(call => call.argv.includes('hash-object'))?.stdin).toBe('src/a.ts\n')
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 1')
})

test('a filter name that cannot be passed safely hides the panel too', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, { panes: [SHOWN], git: { ...base.git, config: { exitCode: 0, stdout: 'filter.a=b.clean\0' } } })
  const pane = await readyPane($, clock)

  expect(await pane.find({ key: 'git' })).toBeUndefined()
  expect(world.gitCalls.some(call => call.argv.includes('status'))).toBe(false)
})

test('an untracked symlink is not hashed, and keeps the panel from claiming nothing is unreviewed', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, {
    panes: [SHOWN],
    git: { ...base.git, hash: { exitCode: 0, stdout: 'h1\n' } },
    links: ['N:/repo/new.ts'],
    store: { [REVIEW_KEY]: SEEN },
  })
  const pane = await readyPane($, clock)

  expect(world.gitCalls.find(call => call.argv.includes('hash-object'))?.stdin).toBe('src/a.ts\n')
  expect(await text(pane, /✓ 未審 0/)).toBeUndefined()
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 1')
})

test('a review leaves a symlink out of what it stores, so it stays unreviewed afterwards', async ($, on) => {
  const base = repoWorld()
  const { world, clock } = engine(on, {
    git: { ...base.git, hash: { exitCode: 0, stdout: 'h1\n' } },
    links: ['N:/repo/new.ts'],
  })
  await start($)
  await $.tool.call(SKILL_REVIEW)
  await clock.advance(10)

  expect(world.store[REVIEW_KEY]).toEqual({ 'src/a.ts': 'h1' })
  const pane = await mountPane($)
  expect((await pane.find({ key: 'git-unreviewed' }))?.props.label).toBe('▸ 未審 1')
})

test('a review of more than 2000 changed paths stores nothing of them, and the panel then says 未知', async ($, on) => {
  const paths = Array.from({ length: 2001 }, (_, i) => `1 .M N... 100644 100644 100644 a a f${i}.ts`)
  const hashes = `${Array.from({ length: 2001 }, (_, i) => `h${i}`).join('\n')}\n`
  const { world, clock } = engine(on, { panes: [SHOWN], ...repoWorld(paths, hashes) })
  await start($)
  await $.tool.call(SKILL_REVIEW)
  await clock.advance(10)

  expect(world.store[REVIEW_KEY]).toBe('too-many-paths')
  const pane = await mountPane($)
  expect(await text(pane, '未審 未知')).toBeDefined()
  expect(await text(pane, /✓ 未審 0/)).toBeUndefined()
})

test('only the 8 repositories reviewed last keep a record', async ($, on) => {
  const roots = Array.from({ length: 9 }, (_, i) => `N:/repo${i}`)
  const { world, clock } = engine(on, {})
  await start($)
  for (const root of roots) {
    world.git = { ...repoWorld().git, top: { exitCode: 0, stdout: `${root}\n` } }
    await $.tool.call(SKILL_REVIEW)
    await clock.advance(10)
  }

  expect(Object.keys(world.store).filter(key => key.startsWith('git-reviewed:')).sort()).toEqual(
    roots.slice(1).map(root => `git-reviewed:${root}`).sort(),
  )
  expect(world.storeDeletes).toEqual(['git-reviewed:N:/repo0'])
})

test('a failing store write never reaches the tool', async ($, on) => {
  const { clock } = engine(on, { ...repoWorld(), isStoreBroken: true })
  await start($)
  const result = await $.tool.call(SKILL_REVIEW)
  await clock.advance(10)

  expect(result).toMatchObject({ result: 'ok' })
})
