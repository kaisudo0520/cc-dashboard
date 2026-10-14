import { expect, test } from 'claude-code/testing'

import { callEnd } from '../hooks/lib/codex-call'

const SESSION = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6071'

test('a result with a background task id moves the run to the background', () => {
  const event = callEnd('tu1', { result: { stdout: '', backgroundTaskId: 'b1' } })

  expect(event(5)).toEqual({ type: 'codex-background', toolUseId: 'tu1', backgroundId: 'b1' })
})

test('a plain result ends the run as done, with the session its stderr header names', () => {
  const event = callEnd('tu1', { result: { stderr: `session id: ${SESSION}\n`, stdout: '' } })

  expect(event(7)).toEqual({ type: 'codex-end', at: 7, id: 'tu1', ok: true, sessionId: SESSION })
})

test('the session is found in the stdout or the text the model reads when stderr has none', () => {
  expect(callEnd('tu1', { result: { stdout: `session id: ${SESSION}` } })(1)).toMatchObject({ sessionId: SESSION })
  expect(callEnd('tu1', { result: {}, text: `session id: ${SESSION}` })(1)).toMatchObject({ sessionId: SESSION })
})

test('an error result ends the run as failed, with no session when none is named', () => {
  expect(callEnd('tu1', { result: {}, isError: true })(2)).toEqual({ type: 'codex-end', at: 2, id: 'tu1', ok: false })
})

test('a refused call ends the run as failed', () => {
  expect(callEnd('tu1', { deny: 'nope' })(3)).toEqual({ type: 'codex-end', at: 3, id: 'tu1', ok: false })
})
