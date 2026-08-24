export class DeadlineExceededError extends Error {}

/**
 * Races `run` against a fresh AbortController that fires after `ms`. The
 * abort signal is handed to `run` so any downstream fetch/SDK call that
 * accepts an AbortSignal can bail out promptly; rejects with
 * DeadlineExceededError if `run` hasn't settled by then, so a slow or stuck
 * upstream call can never hang the response or drop the connection
 * abruptly — the caller is expected to catch this and fall back.
 */
export function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  return new Promise<T>((resolve, reject) => {
    run(controller.signal).then(resolve, reject);
    controller.signal.addEventListener(
      "abort",
      () => reject(new DeadlineExceededError(`Timed out after ${ms}ms`)),
      { once: true }
    );
  }).finally(() => clearTimeout(timer));
}
