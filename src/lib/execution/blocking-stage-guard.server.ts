// =============================================================================
// STAGE TIMEOUT GUARD
//
// Originally scoped to `jurisdiction_intel` and `legal_qa` (BLOCKING stages:
// `report` cannot run until they finish) — before this guard existed they had
// no wall-clock ceiling, so a stuck corpus read or a stalled translation call
// could leave the whole case pinned in `running` forever, with nothing in the
// ledger explaining why. Every stage in canonical.ts now declares a
// `timeoutMs` (see pipeline-runner.server.ts's single wrap point), including
// optional-tier stages like `perspectives`/`strategy` that were confirmed in
// production to hang the same way and require a manual "Limpiar estado"
// click to unstick — the message below is worded generically so it doesn't
// overclaim "blocks the report" for a stage that doesn't.
//
// This module wraps any stage body so that:
//   1. entry and exit are logged (console + pipeline_trace),
//   2. the body is raced against the stage's `timeoutMs` from canonical.ts,
//   3. a timeout or failure throws LOUDLY with a human-readable reason, so the
//      engine-audit writer records the stage as `failed` (never `completed`),
//      and every dependent stage is marked `blocked`.
//
// It never swallows an error and never downgrades a failure to a skip.
// =============================================================================

import { traceAsync } from "@/lib/pipeline-trace.server";
import { stageTimeoutMs, STAGE_BY_KEY } from "./canonical";

export class StageTimeoutError extends Error {
  readonly stageKey: string;
  readonly timeoutMs: number;
  constructor(stageKey: string, timeoutMs: number) {
    const requirement = STAGE_BY_KEY.get(stageKey)?.requirement ?? "blocking";
    const impact =
      requirement === "blocking"
        ? "El caso no puede generar informe hasta que esta etapa complete correctamente."
        : "Esta etapa es opcional y no bloquea el informe, pero no produjo resultados en este intento.";
    super(
      `La etapa "${stageKey}" excedió su límite de ${Math.round(timeoutMs / 1000)}s y fue abortada. ${impact}`,
    );
    this.name = "StageTimeoutError";
    this.stageKey = stageKey;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Runs `fn` under the canonical timeout ceiling for `stageKey`.
 * Stages without a declared `timeoutMs` run unbounded (unchanged behaviour).
 */
export async function withStageTimeout<T>(
  stageKey: string,
  fn: () => Promise<T>,
  opts: { caseId?: string; userId?: string | null } = {},
): Promise<T> {
  const limit = stageTimeoutMs(stageKey);
  const t0 = Date.now();

  console.info(`[stage] enter ${stageKey}${limit ? ` (timeout ${limit}ms)` : ""}`);
  traceAsync({
    phase: "stage",
    step: `${stageKey}.enter`,
    status: "start",
    caseId: opts.caseId,
    userId: opts.userId ?? null,
    detail: { timeout_ms: limit ?? null },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result =
      limit == null
        ? await fn()
        : await Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new StageTimeoutError(stageKey, limit)), limit);
            }),
          ]);

    const durationMs = Date.now() - t0;
    console.info(`[stage] exit ${stageKey} ok in ${durationMs}ms`);
    traceAsync({
      phase: "stage",
      step: `${stageKey}.exit`,
      status: "ok",
      durationMs,
      caseId: opts.caseId,
      userId: opts.userId ?? null,
    });
    return result;
  } catch (e) {
    const durationMs = Date.now() - t0;
    const timedOut = e instanceof StageTimeoutError;
    const reason = e instanceof Error ? e.message : String(e);
    console.error(
      `[stage] FAILED ${stageKey} after ${durationMs}ms ${timedOut ? "(timeout)" : "(error)"}: ${reason}`,
    );
    traceAsync({
      phase: "stage",
      step: `${stageKey}.failed`,
      status: "error",
      durationMs,
      error: reason,
      caseId: opts.caseId,
      userId: opts.userId ?? null,
      detail: { timed_out: timedOut, timeout_ms: limit ?? null },
    });
    // Rethrow unchanged: the caller records the stage as failed and blocks
    // every dependent. Failing loudly is the point.
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
