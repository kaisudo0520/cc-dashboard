// The Windows tool the dashboard runs, by full path under `SystemRoot`: a bare
// name would be looked up on PATH, where a folder the person does not control
// may come first. Without `SystemRoot` it is not run at all.

/** Windows PowerShell under the Windows folder `root` names. */
export const powershellExe = (root: string): string => `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
