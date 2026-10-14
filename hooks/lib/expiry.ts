// How long a finished subagent or Codex row stays in the boxes. Plain times in
// and out; the hooks keep the redraw that fires at the next expiry.

/** A finished row is drawn this long after it ended. */
export const FINISHED_SHOWN_MS = 60_000

/** True while a row that ended at `endedAt` is still drawn; a row whose end is unknown is not. */
export const isFresh = (endedAt: number | undefined, now: number): boolean =>
  endedAt !== undefined && now - endedAt < FINISHED_SHOWN_MS

/** When the earliest row still drawn expires, given the end times of the finished rows; none when nothing is left to expire. */
export const nextExpiry = (ends: readonly (number | undefined)[], now: number): number | undefined => {
  const fresh = ends.filter((end): end is number => isFresh(end, now))

  return fresh.length === 0 ? undefined : Math.min(...fresh) + FINISHED_SHOWN_MS
}
