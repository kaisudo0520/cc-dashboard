import { expect, test } from 'claude-code/testing'

import { advisorModelOf, advisorTimes, listedAgents, spawnEvent } from '../hooks/lib/signals'

test('advisorTimes picks the advisor calls of a step, stamped when they ended', async () => {
  const uses = [
    { id: 'u1', name: 'advisor', input: {}, startedAt: 100, endedAt: 180 },
    { id: 'u2', name: 'web_search', input: {}, startedAt: 120, endedAt: 130 },
    { id: 'u3', name: 'advisor', input: {}, startedAt: 200 },
  ]
  expect(advisorTimes(uses)).toEqual([180, 200])
})

test('advisorTimes is empty when the step ran no server tool', async () => {
  expect(advisorTimes(undefined)).toEqual([])
  expect(advisorTimes([])).toEqual([])
})

test('advisorModelOf reads a non-empty string setting and nothing else', async () => {
  expect(advisorModelOf({ advisorModel: 'claude-fable-5-1' })).toBe('claude-fable-5-1')
  expect(advisorModelOf({ advisorModel: '' })).toBeUndefined()
  expect(advisorModelOf({ advisorModel: 5 })).toBeUndefined()
  expect(advisorModelOf({})).toBeUndefined()
})

test('spawnEvent names the agent by its description, or by its type when it has none', async () => {
  const call = { subagentType: 'Explore', description: 'scan the repo' }

  expect(spawnEvent(call, 'a1', 'haiku', 9)).toEqual({
    type: 'agent-spawn',
    at: 9,
    id: 'a1',
    agentType: 'Explore',
    description: 'scan the repo',
    model: 'haiku',
    isTeammate: false,
  })
  expect(spawnEvent({ ...call, description: '' }, 'a1', undefined, 9)).toMatchObject({ description: 'Explore' })
  expect(spawnEvent({ ...call, isTeammate: true }, 'a1', undefined, 9)).toMatchObject({ isTeammate: true })
})

test('listedAgents keeps what the dashboard shows and tells teammates by their address', async () => {
  const listed = listedAgents([
    { id: 'a1', description: 'scan', type: 'Explore', status: 'running' },
    { id: 'a2', description: 'mate', type: 'teammate', status: 'idle', teammateId: 'scout@team' },
  ])
  expect(listed).toEqual([
    { id: 'a1', agentType: 'Explore', description: 'scan', status: 'running', isTeammate: false },
    { id: 'a2', agentType: 'teammate', description: 'mate', status: 'idle', isTeammate: true },
  ])
})
