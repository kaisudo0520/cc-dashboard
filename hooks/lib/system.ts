// The Windows tools the dashboard runs, by full path under `SystemRoot`: a bare
// name would be looked up on PATH, where a folder the person does not control
// may come first. Without `SystemRoot` they are not run at all.

/** `tasklist.exe` under the Windows folder `root` names. */
export const tasklistExe = (root: string): string => `${root}\\System32\\tasklist.exe`

/** Windows PowerShell under the Windows folder `root` names. */
export const powershellExe = (root: string): string => `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
