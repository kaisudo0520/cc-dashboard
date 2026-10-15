import { expect, test } from 'claude-code/testing'

import { powershellExe } from '../hooks/lib/system'

test('PowerShell is named by full path under SystemRoot', async () => {
  expect(powershellExe('D:\\WinNT')).toBe('D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
})
