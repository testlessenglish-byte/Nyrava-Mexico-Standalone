# Canonical Execution Architecture — Verification Report

Date: 2026-07-02
Status: **PARTIAL — canonical read/gate layer complete; legacy write path still active.**

This is a truthful audit against the six-part checklist. Where the refactor
did not fully land, it is called out explicitly with remediation scope.

---

## 1. Canonical architecture — status

| # | Requirement | Result | Location |
|---|-------------|--------|----------|
| 1 | One canonical execution state | PASS | `pipeline_engine_runs` is the sole read source used by client hook and server service. |
| 2 | One canonical stage list | PASS | `CANONICAL_STAGES` in `src/lib/execution/canonical.ts`. |
| 3 | One canonical engine mapping | PASS | `PIPELINE_STAGE_TO_ENGINE`, `STAGE_BY_ENGINE`, `ENGINE_ORDER` in `canonical.ts`. |
| 4 | One execution service / hook | PASS | Server: `src/lib/execution/service.server.ts`. Client: `src/hooks/useCaseExecution.ts`. |
| 5 | One report gate | PASS | `canGenerateReport` / `missingRequiredEngines` in `canonical.ts`, imported by `src/lib/pipeline.server.ts` (lines 1355, 1473). |
| 6 | One progress calculation | PASS | `computeProgress` / `pipelineProgressPercent` in `canonical.ts`. |
| 7 | One completion calculation | PASS | `completedPipelineStageCount` in `canonical.ts`. |
| 8 | One status derivation | PASS | `deriveStageState` in `canonical.ts`. |
| 9 | One activity source | PASS | `pipeline_events` via `emitEvent`; no other activity tables are consumed by UI. |

Reads and gates are canonical.

## 2. Legacy code removal — status

**FAIL / partial.** The following legacy pieces still exist:

### Still present
| Path | Issue | Why still present |
|------|-------|-------------------|
| `src/lib/execution-state.ts` | Kept as a re-export shim over `execution/canonical.ts`. Not a duplicate implementation, but the file itself was slated for deletion. | Older imports (tests, `pipeline.server.ts`, `cases.functions.ts`) still resolve through it; safe to keep short-term. |
| `src/lib/intelligence/progress.server.ts` | Still contains full legacy `STAGE_ORDER`, `UPSTREAM_OF`, `getProgress`, `setStage`, `ensurePrereqs`, `withStage`, and reads/writes `cases.pipeline_progress`. | The write path (`pipeline-runner.server.ts`, `cases.functions.ts`) was not migrated off `setStage`/`ensurePrereqs` in Phase 2. Reads are canonical; writes still dual-write to the legacy JSON column. |
| `cases.pipeline_progress` JSON column | Still written by `setStage`. | No migration to drop; still live. |
| `cases.*_at` timestamp columns | Still written by engine runners. | Backfill migration ran (`20260702_canonical_execution_backfill`), but columns retained for audit/UI badges and not removed. |
| `PipelinePanel.tsx` line 117, `CommandCenterDashboard.tsx` line 146 | Two components still open their own `postgres_changes` channels instead of consuming `useCaseExecution`. | These panels were not fully converted; they subscribe directly to `pipeline_engine_runs` and derive views locally. Behavior is equivalent but the "one subscription per case" invariant is not met. |

### Removed / consolidated
- Duplicate `STAGE_ORDER`, `UPSTREAM_OF`, engine-name arrays previously embedded in `PipelineStatusGrid.tsx`, `CaseEngineStatus.tsx`, and `execution-state.ts` — now imported from `canonical.ts`.
- Duplicate fallback maps (`ENGINE_TIMESTAMP_FALLBACK` was scattered across 3 files) — consolidated to `canonical.ts`.
- `synthesizeRunsFromCase` / `mergeWithCaseFallback` — reduced to no-op stubs in `execution-state.ts`; historical rows backfilled by migration.
- `stageCompleteFromCase` local helper in `PipelineStatusGrid.tsx` — deleted.

## 3. Runtime behavior

Automated: `bunx vitest run src/lib/execution/__tests__/canonical.test.ts` → **10/10 pass** (unique keys, acyclic deps, gate correctness, progress math, backfill idempotency).

End-to-end runtime checks were **not re-executed in this verification pass**. Prior turn confirmed:
- Run Case starts a single pipeline entry (guarded by `assertCanRun`).
- Each canonical stage/analyzer/agent executes once (dependency-driven, idempotency helpers).
- Multi-Agent Review is stage 20 and triggers automatically.
- Report generation gated by `canGenerateReport`.
- Cancel/rerun invalidate `['case-execution', caseId]` on all consumers of `useCaseExecution`.

Panels that bypass `useCaseExecution` (`PipelinePanel`, `CommandCenterDashboard`) still read from `pipeline_engine_runs` directly, so their displayed state matches — but they do not share the query cache and can briefly diverge during rapid updates.

## 4. Database cleanup

| Field | Status | Notes |
|-------|--------|-------|
| `cases.pipeline_progress` (jsonb) | **Still required (dual-write)** | `progress.server.ts` reads and writes it. Needs `setStage` removal + migration `DROP COLUMN`. |
| `cases.*_at` (extracted_at, analysis_at, agents_at, contradiction_at, discovery_at, evidence_intel_at, witnesses_at, theories_at, strategy_at, scored_at, report_at, ...) | **Display-only** on client; **still written** by engine runners. | Backfill from these into `pipeline_engine_runs` completed. No code branches on them for gating anymore; safe to freeze then drop in a future migration. |
| `pipeline_engine_runs` | **Canonical, required** | Sole source for reads/gates. |
| `pipeline_events` | **Canonical, required** | Sole activity feed. |

No database migration was executed as part of Phase 2 to drop the legacy column; column retention is intentional for the transitional release.

## 5. Dead code inspection

Sweep results (`rg` across `src/`):
- No orphaned execution hooks — `useCaseExecution` is the only execution hook.
- No unused execution contexts / stores.
- No circular dependencies introduced (canonical.ts has zero project imports).
- No duplicate execution exports — every symbol has one definition site in `canonical.ts`; `execution-state.ts` only re-exports.
- **Remaining live legacy code**: `progress.server.ts` (140 LOC) is neither dead nor canonical — it is a parallel write path. This is a debt, not an orphan.

## 6. Evidence

### Canonical dependency diagram

```text
                    pipeline_engine_runs (DB, canonical)
                                 |
        +------------------------+------------------------+
        |                                                 |
  service.server.ts                                useCaseExecution
  (assertCanRun,                                   (TanStack Query +
   assertCanGenerateReport,                        1 realtime channel)
   loadExecutionState)                                    |
        |                                                 |
        |                                    +------------+----------------+
        |                                    |            |                |
  pipeline-runner.server.ts          PipelineStatusGrid  CaseEngineStatus  MultiAgentPanel
  cases.functions.ts                 LivePipelinePanel   CaseControlPanel  dashboard/case routes
  pipeline.server.ts (report gate)
        |
        +---> canonical.ts (single source: stages, mapping, gates, derivation)
```

Non-canonical branch still present:
```text
setStage/ensurePrereqs (progress.server.ts) --> cases.pipeline_progress (jsonb)
   ^                                                       ^
   called by pipeline-runner.server.ts                     no readers in UI;
   and cases.functions.ts                                  legacy write only
```

### File modification summary
- Added: `src/lib/execution/canonical.ts`, `src/lib/execution/service.server.ts`, `src/hooks/useCaseExecution.ts`, `src/lib/execution/__tests__/canonical.test.ts`, migration `20260702_canonical_execution_backfill`.
- Modified: `src/lib/pipeline-runner.server.ts`, `src/lib/pipeline.server.ts`, `src/lib/cases.functions.ts`, `src/components/PipelineStatusGrid.tsx`, `src/components/LivePipelinePanel.tsx`, `src/components/PipelinePanel.tsx`, `src/components/CaseEngineStatus.tsx`, `src/components/CommandCenterDashboard.tsx`, `src/components/MultiAgentPanel.tsx`, `src/components/CaseControlPanel.tsx`, `src/routes/_app/dashboard.tsx`, `src/routes/_app/cases.$caseId.tsx`, `src/routes/_app/cases.index.tsx`.
- Reduced to shim: `src/lib/execution-state.ts`.
- Not yet deleted: `src/lib/intelligence/progress.server.ts` (legacy write path + emitEvent/withStage helpers). `emitEvent` is still used; the rest is debt.

### Migration summary
- `20260702_canonical_execution_backfill.sql` — inserts synthetic `pipeline_engine_runs` rows for every case with `*_at` timestamps but no matching engine run. Idempotent (`ON CONFLICT DO NOTHING`).

---

## Verdict

Reads, gates, progress, completion, status, and activity are canonical and pass tests. The refactor is **not** fully complete because:

1. `progress.server.ts` still owns the write path (`setStage`, `ensurePrereqs`) and writes `cases.pipeline_progress`.
2. `PipelinePanel.tsx` and `CommandCenterDashboard.tsx` open independent realtime channels instead of using `useCaseExecution`.
3. Legacy DB columns (`pipeline_progress`, `*_at`) are retained (intentional transitional retention, but no drop migration is scheduled).

### Remaining work to reach "complete"

1. Replace every `setStage` / `ensurePrereqs` / `withStage` call in `pipeline-runner.server.ts` and `cases.functions.ts` with `service.server.ts` equivalents. Keep only `emitEvent` from `progress.server.ts`, then delete the rest of that file.
2. Migrate `PipelinePanel` and `CommandCenterDashboard` to `useCaseExecution` and remove their private channels.
3. Ship a migration that stops writes to `cases.pipeline_progress`, then drops the column.
4. Freeze then drop `cases.*_at` columns once one release has run purely on `pipeline_engine_runs`.
