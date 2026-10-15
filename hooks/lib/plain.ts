// Text from outside (a branch name, a path, a model slug) drawn as it is could
// carry control or format characters, and the engine refuses a Text holding
// them (the whole tree is then not drawn). Every such string is made plain first.

/** Control (Cc), format (Cf), line and paragraph separators and tag characters become spaces. */
export const plain = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{e0000}-\u{e007f}]/gu, ' ')

/** How long ago `thenMs` was: `just now`, `3m ago`, `2h ago`; `—` when it never happened. */
export const ago = (thenMs: number | undefined, nowMs: number): string => {
  if (thenMs === undefined) return '—'

  const minutes = Math.max(0, Math.floor((nowMs - thenMs) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  return `${Math.floor(minutes / 60)}h ago`
}
