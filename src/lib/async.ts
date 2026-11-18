export type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/**
 * Maps `items` through `worker` with at most `concurrency` calls in flight.
 * Never rejects: each result says whether its item succeeded. Order is kept.
 */
export async function mapPool<I, O>(
  items: readonly I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const results = new Array<Settled<O>>(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = { ok: true, value: await worker(items[i] as I, i) };
        } catch (e) {
          results[i] = { ok: false, error: toError(e) };
        }
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  /** Return false for errors that will not go away (e.g. DNS failure). */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/** Runs `task` up to `retries + 1` times with exponential backoff and jitter. */
export async function retry<T>(
  task: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const base = opts.baseDelayMs ?? 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await task(attempt);
    } catch (e) {
      const error = toError(e);
      if (attempt > opts.retries || opts.shouldRetry?.(error, attempt) === false) throw error;
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      opts.onRetry?.(error, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export class TimeoutError extends Error {
  override name = 'TimeoutError';
}

/**
 * Runs `task` with an AbortSignal that fires after `ms`. Rejects with a
 * TimeoutError even if the task ignores the signal.
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(`${label} timed out after ${ms} ms`);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A promise-chain mutex: `lock(fn)` runs fn after every earlier fn settled. */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}
