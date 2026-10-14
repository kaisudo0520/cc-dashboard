import { expect, test } from 'claude-code/testing'

import { HOME, NARROW_PROPS, SHOWN, engine, mountPane, start, text } from './harness'
import type { Pane } from './harness'

// The engine refuses a whole tree when one Text holds a control character, so
// every string that comes from outside is made plain before it is drawn.

const ESC = '\u001b'
const CONTROL = /[\x00-\x1f\x7f-\x9f\u{200b}-\u{200f}\u{2028}-\u{202e}\u{2066}-\u{2069}\u{feff}]/u

/** Every string anywhere in the drawn tree, text and props alike. */
const strings = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(strings)
  if (typeof node === 'object' && node !== null) return Object.values(node).flatMap(strings)

  return []
}

const drawn = async (pane: Pane): Promise<string[]> => strings(await pane.drawn())

const hostile = (word: string): string => `${word}${ESC}[31m\n\t${word}`
/** What `hostile` reads like once its control characters are spaces. */
const cleaned = (word: string): RegExp => new RegExp(`${word} \\[31m {2}${word}`)

test('a control character in a subagent description is drawn as a space, and the tree is clean', async ($, on) => {
  const { world } = engine(on)
  await start($)
  world.agents = [{ id: 'f1', description: `scan${ESC}[31m the repo`, type: 'Explore', status: 'running' }]
  await $.turn.start({ text: 'go', turnId: 't7', agentId: 'f1' })

  const pane = await mountPane($)
  expect(await text(pane, 'scan [31m the repo')).toBeDefined()
  expect((await drawn(pane)).filter(s => CONTROL.test(s))).toEqual([])
})

test('nothing from outside reaches a Text node with a control character, wide or narrow', async ($, on) => {
  const { world, clock } = engine(on, {
    settings: { advisorModel: hostile('adv') },
    files: { [`${HOME}/.codex/config.toml`]: `model_reasoning_effort = "${hostile('eff')}"\n` },
    panes: [SHOWN],
  })
  await start($)
  await clock.advance(3000)
  world.agents = [{ id: 'f1', description: hostile('desc'), type: hostile('type'), status: 'running' }]
  await $.turn.start({ text: 'go', turnId: 't7', agentId: 'f1' })
  await $.turn.step({ turnId: 't7', index: 0, agentId: 'f1', model: hostile('sub'), messageCount: 1 }).next()
  await $.turn.step({ turnId: 't1', index: 0, model: hostile('main'), effort: hostile('max') as 'max', messageCount: 1 }).next()
  await $.tool.call({ tool: 'Bash', command: 'codex exec -s read-only - < a.md', description: hostile('note') })
  await $.tool.call({ tool: hostile('Tool') as 'Bash', command: 'ls' })

  const wide = await mountPane($)
  const all = (await drawn(wide)).join('\n')
  for (const word of ['adv', 'eff', 'desc', 'type', 'sub', 'main', 'max', 'note', 'Tool']) expect(all).toMatch(cleaned(word))
  expect((await drawn(wide)).filter(s => CONTROL.test(s))).toEqual([])
  await wide.unmount()

  const narrow = await mountPane($, NARROW_PROPS)
  expect((await drawn(narrow)).filter(s => CONTROL.test(s))).toEqual([])
  expect((await drawn(narrow)).join('\n')).toMatch(cleaned('desc'))
})
