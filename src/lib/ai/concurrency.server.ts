// Global in-flight AI-call gate.
//
// Several stages now fan out (perspectives, analyzer batches, agent batches,
// agents themselves). Each stage having its own local concurrency number is
// not enough: 2 agents x 2 batches each = 4 simultaneous provider calls, which
// is exactly the burst pattern that trips the shared Groq/Gemini key pool's
// rate limiter. This module caps TOTAL simultaneous provider calls across the
// whole worker process, so a stage can be parallelized for wall-clock without
// changing the peak token rate the providers see.
//
// ROLLBACK: set AI_MAX_INFLIGHT to 1 — every call site serializes again.

const AI_MAX_INFLIGHT = 4;

let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < AI_MAX_INFLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function release(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

/** Run `fn` while holding one of the global AI slots. */
export async function withAiSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Map `items` with at most `limit` concurrent workers (further bounded by the
 * global AI slot count). Results keep input order. Rejections propagate as
 * settled results so callers can decide per item.
 */
export async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const out: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
