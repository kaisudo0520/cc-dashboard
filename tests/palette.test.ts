import { expect, test } from 'claude-code/testing'

import { PALETTES } from '../hooks/core'

// Codex is blue: the theme's IDE blue, not plan mode's green; the agents keep the suggestion colour.

test('Codex is blue in both palettes, apart from the agents', () => {
  expect(PALETTES.theme.codex).toBe('ide')
  expect(PALETTES.pastel.codex).toBe('#60a5fa')
  expect([PALETTES.theme.codex === PALETTES.theme.agent, PALETTES.pastel.codex === PALETTES.pastel.agent]).toEqual([false, false])
})
