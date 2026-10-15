// Text from outside (a branch name, a path, a model slug) drawn as it is could
// carry control or format characters, and the engine refuses a Text holding
// them (the whole tree is then not drawn). Every such string is made plain first.

/** Control (Cc), format (Cf), line and paragraph separators and tag characters become spaces. */
export const plain = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{e0000}-\u{e007f}]/gu, ' ')

/** How long ago `thenMs` was: `剛剛`, `3分前`, `2時前`; `—` when it never happened. */
export const ago = (thenMs: number | undefined, nowMs: number): string => {
  if (thenMs === undefined) return '—'

  const minutes = Math.max(0, Math.floor((nowMs - thenMs) / 60000))
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes}分前`

  return `${Math.floor(minutes / 60)}時前`
}
