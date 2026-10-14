/**
 * A queue that runs the jobs it is given one after another, each starting when
 * the one before has finished, whether that one succeeded or not. Every job
 * gets its own result (or its own rejection).
 */
export const serial = (): (<T>(job: () => Promise<T>) => Promise<T>) => {
  let tail: Promise<unknown> = Promise.resolve()

  return job => {
    const run = tail.then(job)
    tail = run.catch(() => undefined)

    return run
  }
}
