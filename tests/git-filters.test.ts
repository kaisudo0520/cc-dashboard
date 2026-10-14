import { expect, test } from 'claude-code/testing'

import { filterDrivers, filterOverrides } from '../hooks/lib/git-filters'

// `git config -z --name-only --get-regexp "^filter\."` prints `filter.<driver>.<variable>` names, NUL-terminated.
const z = (...names: string[]): string => `${names.join('\0')}\0`

test('the drivers are the names between filter. and the variable, each once', async () => {
  expect(filterDrivers(z('filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process', 'filter.lfs.required', 'filter.evil.clean'))).toEqual([
    'lfs',
    'evil',
  ])
  // The same driver set in more than one config file is listed twice by git.
  expect(filterDrivers(z('filter.lfs.clean', 'filter.lfs.clean'))).toEqual(['lfs'])
})

test('a driver name may hold dots and spaces: the variable is only the last part', async () => {
  expect(filterDrivers(z('filter.my.drv.clean', 'filter.dr iver.smudge'))).toEqual(['my.drv', 'dr iver'])
})

test('no output is no drivers', async () => {
  expect(filterDrivers('')).toEqual([])
})

test('a listing that does not end in a NUL was cut short, and is no answer', async () => {
  expect(filterDrivers('filter.lfs.clean\0filter.ev')).toBeUndefined()
  expect(filterDrivers('filter.lfs.clean')).toBeUndefined()
})

test('any sign of a partial clone is no answer: the repository may fetch on its own', async () => {
  expect(filterDrivers(z('extensions.partialclone'))).toBeUndefined()
  expect(filterDrivers(z('remote.origin.promisor'))).toBeUndefined()
  expect(filterDrivers(z('remote.my.remote.partialclonefilter'))).toBeUndefined()
  expect(filterDrivers(z('filter.lfs.clean', 'remote.origin.promisor'))).toBeUndefined()
})

test('a name with = in it cannot be put in a -c option: the answer is no answer', async () => {
  expect(filterDrivers(z('filter.lfs.clean', 'filter.a=b.clean'))).toBeUndefined()
})

test('a name with a line end, or one that is not a filter name at all, is no answer', async () => {
  expect(filterDrivers(z('filter.a\nb.clean'))).toBeUndefined()
  expect(filterDrivers(z('filter.a\rb.clean'))).toBeUndefined()
  expect(filterDrivers(z('core.editor'))).toBeUndefined()
  expect(filterDrivers(z('filter.clean'))).toBeUndefined()
  expect(filterDrivers(z('filter..clean'))).toBeUndefined()
})

test('every driver is switched off four ways: no clean, no smudge, no process, and not required', async () => {
  expect(filterOverrides(['lfs'])).toEqual([
    '-c',
    'filter.lfs.clean=',
    '-c',
    'filter.lfs.smudge=',
    '-c',
    'filter.lfs.process=',
    '-c',
    'filter.lfs.required=false',
  ])
  expect(filterOverrides(['a', 'b']).filter(arg => arg !== '-c')).toHaveLength(8)
  expect(filterOverrides([])).toEqual([])
})
