import { AsyncLocalStorage } from "node:async_hooks";

// Signal that a stage has hit its wall-clock budget and needs to be resumed
// on the next worker tick. The runner catches this, re-queues the case, and
// exits cleanly instead of failing the run.
export class CheckpointRequired extends Error {
  public readonly stage: string;
  public readonly progress: string;
  constructor(stage: string, progress: string) {
    super(`Checkpoint: ${stage} exceeded wall-clock budget after ${progress}`);
    this.name = "CheckpointRequired";
    this.stage = stage;
    this.progress = progress;
  }
}

// Hard safety budget for a single worker invocation. The platform limit is
// intentionally treated as lower than advertised: we voluntarily yield before
// starting another slow stage or retry so a terminal/checkpoint state is always
// written while there is still time left in the invocation.
//
// 2026-07 audit: this was 32_000ms, which — combined with a 16_000ms hard
// per-call timeout — left the "report" stage unable to ever complete a
// single gpt-oss-120b chunk call (a reasoning model that burns real wall-clock
// time on hidden reasoning before it writes any of the 7-10k tokens of JSON
// the report prompt asks for). Raised to give report generation realistic
// headroom. If your hosting platform's actual function timeout is lower than
// this, lower it to match (with a safety margin) — this constant should
// always be a few seconds under the real platform ceiling, never above it.
export const WORKER_INVOCATION_BUDGET_MS = 42_000;
export const CHECKPOINT_SAFETY_BUFFER_MS = 7_000;
// 2026-07-27: was 4_000. With only ~4-5s left in the tick, the router still
// issued a full-size call that could never finish (observed: repeated
// "gemini timed out after 4888ms" on the report stage), burning the tail of
// every tick and producing zero progress. Yield instead: a call that cannot
// realistically complete is worse than checkpointing early.
export const MIN_AI_CALL_BUDGET_MS = 12_000;
// 2026-07 audit: was 16_000ms. A single report chunk call asks gpt-oss-120b
// for up to 10,000 output tokens, and the model spends additional (invisible)
// time on internal reasoning before emitting any of it. 16s was reliably
// insufficient — every attempt timed out, retries burned the rest of the
// tick's budget, and the stage could checkpoint forever with zero forward
// progress. Raised to 26s, still safely inside WORKER_INVOCATION_BUDGET_MS.
export const MAX_AI_CALL_TIMEOUT_MS = 33_000;

// Per-stage wall-clock budget. Deliberately conservative so a busy stage
// still yields well before the outer HTTP timeout, letting the worker pick
// up on the next tick with the intermediate rows already persisted.
export const STAGE_BUDGET_MS: Record<string, number> = {
  extraction: 45_000,
  analyzers: 45_000,
  agents: 45_000,
  // Any stage that loops over N items and calls an LLM per item needs the
  // same treatment as extraction/analyzers/agents, or a large-corpus case
  // will time out here instead. Added as each stage is confirmed audited —
  // see docs/BASELINE.md checkpoint-coverage note before removing any of
  // these or assuming an unlisted stage is safe by omission.
  perspectives: 45_000,
  witness: 45_000,
  evidence_intel: 45_000,
  discovery: 45_000,
  opportunities: 45_000,
  trial_prep: 45_000,
  strategy: 45_000,
  // 2026-07 audit: "report" previously had NO entry here and silently fell
  // through to `default` (60_000) — undocumented and easy to miss when
  // auditing checkpoint coverage. It now has its own explicit, generous
  // budget (still clamped to WORKER_INVOCATION_BUDGET_MS by the caller in
  // pipeline.server.ts, same as every other stage).
  report: 120_000,
  default: 60_000,
};

// Hard ceiling on how many times the "report" stage may voluntarily
// checkpoint (yield and requeue) before we stop retrying the raw LLM calls
// and force finalization with whatever chunks succeeded so far. Without
// this, a corpus/prompt combination that is simply too large to ever finish
// inside one worker tick's budget checkpoints forever — same prompt, same
// timeout, same restart, no forward progress, exactly the "reports never
// finish" symptom. This is a backstop, not the primary fix; it guarantees
// the case always terminates even if the timing fixes above aren't enough
// for a particular case.
// 2026-07-27: was 6, the exact same number as the pipeline runner's
// loop-breaker — so the runner aborted the whole run on the very tick the
// report was going to salvage-finalize with whatever chunks it had. Must
// stay strictly below the runner's limit for the salvage path to exist.
export const MAX_REPORT_CHECKPOINTS = 4;

export function budgetFor(stage: string): number {
  return STAGE_BUDGET_MS[stage] ?? STAGE_BUDGET_MS.default;
}

// Shared detector so every stage treats a Groq cooldown/429 the same way —
// yield via CheckpointRequired instead of recording it as a hard failure.
// Previously this lived as an unexported function inside pipeline.server.ts,
// which meant any new caller (e.g. litigation.server.ts) either had to
// duplicate the regex or reach into a private symbol. One copy, here.
function isPayloadTooLargeError(msg: string): boolean {
  return /HTTP 413|request too large|payload too large|context.*length|maximum context/i.test(msg);
}

// A `finish_reason=length` empty response means the model burned its entire
// max_tokens budget (often on internal reasoning, e.g. gpt-oss-120b) before
// emitting any content. This is deterministic given the same prompt/budget —
// retrying on the next tick reproduces the identical failure every time. It
// must NEVER be treated as a transient rate-limit/cooldown signal, or the
// stage checkpoints forever without any possibility of succeeding.
function isEmptyResponseLengthError(msg: string): boolean {
  return /finish_reason=length/i.test(msg);
}

export function isGroqCooldownOrRateLimit(msg: string): boolean {
  // NOTE: deliberately does NOT match the bare "All Groq keys failed" wrapper
  // text — that phrase just means every key errored, it says nothing about
  // *why*. Matching on it previously caused deterministic, non-retryable
  // failures (e.g. finish_reason=length) to be misrouted into the infinite
  // checkpoint/retry path. Match on the underlying reason instead.
  return (
    /Groq model cooldown active|HTTP 429|quota|rate.?limit|too many requests/i.test(msg) &&
    !isPayloadTooLargeError(msg) &&
    !isEmptyResponseLengthError(msg)
  );
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage-based invocation budget. The runner opens a scope for
// each stage with a deadline; anything running under that scope (the router,
// individual AI calls, retry backoffs) can consult the remaining budget and
// yield with CheckpointRequired instead of being killed mid-flight by the
// platform.
// ---------------------------------------------------------------------------
type CheckpointScope = {
  stage: string;
  deadlineAt: number;
  progress: string;
  correlationId?: string;
};

const checkpointScope = new AsyncLocalStorage<CheckpointScope>();

export function withCheckpointScope<T>(
  scope: Omit<CheckpointScope, "progress"> & { progress?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return checkpointScope.run({ ...scope, progress: scope.progress ?? scope.stage }, fn);
}

/**
 * Runs `fn` inside a checkpoint scope AND races it against the scope's own
 * deadline, so the stage-running loop always gets control back by
 * `deadlineAt` — even if some code path inside `fn` never calls
 * `assertCheckpointBudget` / `aiCallTimeoutForCheckpoint` itself.
 *
 * `withCheckpointScope` alone is purely cooperative: it hands a deadline to
 * anything that voluntarily asks, but does nothing if a nested call forgets
 * to ask (a raw fetch, an unaudited sub-engine, a Promise.all branch that
 * doesn't check the budget between attempts). That gap is exactly what lets
 * a stage die mid-flight without ever writing a terminal or checkpoint
 * state — the "worker timed out before writing terminal state" symptom.
 *
 * This does not (and cannot, in Node) force-abort a truly stuck underlying
 * call — but it guarantees the OUTER stage loop stops waiting at the
 * deadline and writes a clean checkpoint/requeue, instead of relying on the
 * whole invocation being killed by the host with nothing persisted. The
 * orphaned inner promise still runs to completion (or error) in the
 * background and any DB writes it eventually makes (e.g. engine-run
 * terminal state) still land.
 */
export async function withHardCheckpointDeadline<T>(
  scope: Omit<CheckpointScope, "progress"> & { progress?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const deadlineAt = scope.deadlineAt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    timer = setTimeout(() => {
      reject(new CheckpointRequired(scope.stage, scope.progress ?? `${scope.stage}: hard deadline reached`));
    }, ms);
  });
  try {
    return await Promise.race([withCheckpointScope(scope, fn), guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isCheckpointError(error: unknown): error is CheckpointRequired {
  return error instanceof Error && error.name === "CheckpointRequired";
}

/**
 * Re-throw guard for every catch block that wraps an AI call or a sub-engine.
 * A `CheckpointRequired` signal is a control-flow yield — it must propagate to
 * the runner so the case is re-queued, not silently converted into a failed
 * batch or logged as a warning. This is the systemic hardening applied to
 * every long-running stage (extraction, analyzers, agents, report, engine
 * stages) after two separate stages (trial_prep, work_product) leaked past a
 * catch and left the case in `intelligence_running`.
 *
 * Idiomatic use, at the TOP of every relevant catch:
 *   } catch (e) {
 *     rethrowIfCheckpoint(e);
 *     // ...existing recovery/logging...
 *   }
 */
export function rethrowIfCheckpoint(error: unknown): void {
  if (isCheckpointError(error)) throw error;
}

export function remainingCheckpointMs(): number | null {
  const scope = checkpointScope.getStore();
  if (!scope) return null;
  return scope.deadlineAt - Date.now();
}

export function assertCheckpointBudget(progress?: string, reserveMs = CHECKPOINT_SAFETY_BUFFER_MS): void {
  const scope = checkpointScope.getStore();
  if (!scope) return;
  const remaining = scope.deadlineAt - Date.now();
  if (remaining <= reserveMs) {
    throw new CheckpointRequired(scope.stage, progress ?? scope.progress);
  }
}

export function aiCallTimeoutForCheckpoint(progress: string): number | undefined {
  const scope = checkpointScope.getStore();
  if (!scope) return undefined;
  const remaining = scope.deadlineAt - Date.now() - CHECKPOINT_SAFETY_BUFFER_MS;
  if (remaining < MIN_AI_CALL_BUDGET_MS) {
    throw new CheckpointRequired(scope.stage, progress);
  }
  return Math.max(1_000, Math.min(MAX_AI_CALL_TIMEOUT_MS, remaining));
}

/**
 * Reconstruct which stages must be treated as `failed`/`blocked` when a
 * pipeline run resumes partway through on a later worker tick.
 *
 * `runPipelineForCase`'s in-memory `failed`/`blocked` Sets only cover what
 * THIS invocation observes. A case resumed via `startFrom` never re-runs
 * the stages before the resume point, so without this reconstruction a
 * downstream dependent could run unblocked even though its real upstream
 * dependency failed or was blocked on an earlier tick — which is exactly
 * how `work_product` ran after `strategy` never completed.
 *
 * Pure function so it can be unit tested without mocking the full runner.
 */
export function seedResumeState(args: {
  /** Stage keys that occur before the resume point (won't be re-run this tick). */
  priorStageKeys: string[];
  /** engine name for a given stage key, e.g. via CANONICAL_STAGES. */
  engineForStage: (stageKey: string) => string;
  /** Latest known ledger row per engine, e.g. from pipeline_engine_runs. */
  latestStatusByEngine: Map<string, string>;
}): { failed: Set<string>; blocked: Set<string> } {
  const failed = new Set<string>();
  const blocked = new Set<string>();
  for (const stageKey of args.priorStageKeys) {
    const status = args.latestStatusByEngine.get(args.engineForStage(stageKey));
    if (status === "failed") failed.add(stageKey);
    if (status === "blocked") blocked.add(stageKey);
  }
  return { failed, blocked };
}
