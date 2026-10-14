import { expect, test } from 'claude-code/testing'

import { powershellExe, tasklistExe } from '../hooks/lib/system'

test('the system tools are named by full path under SystemRoot', async () => {
  expect(tasklistExe('C:\\Windows')).toBe('C:\\Windows\\System32\\tasklist.exe')
  expect(powershellExe('D:\\WinNT')).toBe('D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
})
