// Text from outside (a branch name, a path, a model slug) drawn as it is could
// carry control or format characters, and the engine refuses a Text holding
// them (the whole tree is then not drawn). Every such string is made plain first.

/** Control (Cc), format (Cf), line and paragraph separators and tag characters become spaces. */
export const plain = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{e0000}-\u{e007f}]/gu, ' ')
