import { AsyncLocalStorage } from "node:async_hooks";

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

export const WORKER_INVOCATION_BUDGET_MS = 42_000;
export const CHECKPOINT_SAFETY_BUFFER_MS = 7_000;
export const MIN_AI_CALL_BUDGET_MS = 12_000;
export const MAX_AI_CALL_TIMEOUT_MS = 33_000;

export const STAGE_BUDGET_MS: Record<string, number> = {
  extraction: 45_000,
  analyzers: 45_000,
  agents: 45_000,
  perspectives: 45_000,
  witness: 45_000,
  evidence_intel: 45_000,
  discovery: 45_000,
  opportunities: 45_000,
  trial_prep: 45_000,
  strategy: 45_000,
  report: 120_000,
  default: 60_000,
};

// Report generation is explicitly two-phase: narrative first, then memo +
// structured intelligence after the narrative cache exists. The checkpoint
// counter is STAGE-wide, not per chunk. A real production run proved that a
// narrative can consume the fourth continuation and successfully persist its
// cache, after which the old limit (4) immediately force-finalized the NEXT
// tick without ever giving phase two a chance to run. That produced a report
// with narrative=true, memo=false, intelligence=false and the misleading
// errors "skipped — report checkpoint backstop reached".
//
// Reserve one additional continuation for phase two. Five remains strictly
// below the pipeline runner's six-yield loop breaker, so the salvage/finalize
// backstop still exists and cases still terminate.
export const MAX_REPORT_CHECKPOINTS = 5;

export function budgetFor(stage: string): number {
  return STAGE_BUDGET_MS[stage] ?? STAGE_BUDGET_MS.default;
}

function isPayloadTooLargeError(msg: string): boolean {
  return /HTTP 413|request too large|payload too large|context.*length|maximum context/i.test(msg);
}

function isEmptyResponseLengthError(msg: string): boolean {
  return /finish_reason=length/i.test(msg);
}

export function isGroqCooldownOrRateLimit(msg: string): boolean {
  return (
    /Groq model cooldown active|HTTP 429|quota|rate.?limit|too many requests/i.test(msg) &&
    !isPayloadTooLargeError(msg) &&
    !isEmptyResponseLengthError(msg)
  );
}

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

export function seedResumeState(args: {
  priorStageKeys: string[];
  engineForStage: (stageKey: string) => string;
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
