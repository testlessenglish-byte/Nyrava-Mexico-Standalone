# U.S. port bundle — AI execution engine reconciliation

These files are the México versions of shared infrastructure, staged for the
U.S. app. Nothing here contains Mexican legal logic — the four files are pure
provider routing, rate-limit handling, and stage-timeout plumbing.

Rationale and full drift table: `docs/AI_ENGINE_RECONCILIATION.md`.

## Apply order (U.S. repo)

1. `src/lib/ai/cooldown.server.ts` — **new file.** Per-provider/per-key cooldown
   ledger with `retry-after` support. No dependencies beyond the standard lib.
2. `src/lib/ai/providers/gemini.ts` — replaces the bare adapter. Adds the
   `GEMINI_MODEL_FALLBACKS` ladder (404/429), the process-local `UNUSABLE_MODELS`
   set, and checkpoint-budget assertions.
3. `src/lib/ai/router.server.ts` — replaces the U.S. router. Brings pre-flight
   request sizing, `fitOptsToBudget` compression, `PROVIDER_INPUT_TOKEN_BUDGET`
   (Groq 5 500 tokens for the 8 k TPM ceiling), the real-attempt cap, 413
   same-provider key skipping, and cooldown-wait re-entry. It **removes** the
   legacy in-place hinted-429 retry loop, which the cooldown ledger supersedes.
4. `src/lib/execution/blocking-stage-guard.server.ts` — **new file.** Wrap every
   blocking stage body with `withStageTimeout(stageKey, fn, { caseId, userId })`.
5. `src/lib/ai/provider.server.ts` — optional. Only needed if the U.S. app grows
   an OpenAI-style `messages[]` call site; it is a translation layer over
   `routeAI`, never a second routing path.

## Required adjustments before it compiles in the U.S. repo

- **Telemetry:** these files import `traceAsync` from `@/lib/pipeline-trace.server`,
  which does not exist in the U.S. app (no `pipeline_trace` table). Either add
  the table and port the module, or drop in this console-only shim:

  ```ts
  // src/lib/pipeline-trace.server.ts (U.S. shim)
  export type TraceEntry = Record<string, unknown> & { phase: string; step: string };
  export function traceAsync(entry: TraceEntry): void {
    const level = entry.status === "error" ? "error" : entry.status === "warn" ? "warn" : "info";
    console[level as "info"](`[trace] ${entry.phase}.${entry.step}`, entry);
  }
  export async function trace(entry: TraceEntry): Promise<void> { traceAsync(entry); }
  export function currentTraceScope(): undefined { return undefined; }
  ```

- **Checkpoint budget:** `assertCheckpointBudget` / `isCheckpointError` come from
  `src/lib/pipeline-checkpoint.server.ts`, which the U.S. app already has —
  verify the export names match.
- **Canonical stages:** do **not** copy México's `canonical.ts`. Instead apply the
  generic part only — add `readonly timeoutMs?: number` to `StageDef`, the
  `stageTimeoutMs()` / `STAGE_TIMEOUT_MS` helpers at the bottom of the file, and
  a ceiling on each U.S. blocking stage (`scoring`, `hallucination`, `report`).
  México's `jurisdiction_intel` / `procedural_compliance` / `legal_qa` stages are
  Mexican-law-specific and must not be added to the U.S. pipeline.
