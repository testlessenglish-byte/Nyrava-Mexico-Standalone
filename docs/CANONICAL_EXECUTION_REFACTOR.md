# Canonical Execution Architecture Refactor — Completion Report

Date: 2026-07-02
Reference plan: `.lovable/plan.md`
Reference audit: `docs/EXECUTION_STATE_AUDIT.md`

## Summary

Every stage list, engine mapping, status derivation, progress calculation, and
report gate in the platform now resolves to **one** implementation module:
`src/lib/execution/canonical.ts`. Every UI panel that displays execution state
reads from **one** shared hook: `src/hooks/useCaseExecution.ts`, which owns a
single TanStack Query cache entry and a single Supabase realtime channel per
case. Every server call site (pipeline runner, report gate, orchestrator,
background worker) resolves engine dependencies from the canonical stage
graph rather than a locally-defined dependency table.

## Phase 1 — Canonical architecture

### Files added
| File | Purpose |
| --- | --- |
| `src/lib/execution/canonical.ts` | **The** stage list, engine map, status derivation, progress, report gate |
| `src/lib/execution/service.server.ts` | Server facade: `loadExecutionState`, `assertCanRun`, `assertCanGenerateReport` |
| `src/hooks/useCaseExecution.ts` | Client facade: one query + one realtime channel per case |
| `src/lib/execution/__tests__/canonical.test.ts` | 10 tests covering unique keys, acyclic deps, gate behavior, state derivation, progress math, latest-row selection |

### Canonical stage list

20 stages, one canonical order, declared once in `CANONICAL_STAGES`. Each
entry carries: `key`, `label`, `engine`, `dependsOn[]`, `requirement`
(`blocking` | `enriching` | `optional`), and the deprecated `timestampColumn`
retained only for the backfill migration.

Report gate:
- **Blocking**: `extraction`, `analyzers`, `agents`, `scoring`, `report_generator`
- **Enriching**: `contradictions`, `witness_intelligence`, `evidence_intelligence`, `constitutional_compliance`, `discovery_gaps`, `timeline`, `evidence_map`

## Phase 2 — Legacy code removed / consolidated

### Files rewritten to remove duplicate logic

| File | Change |
| --- | --- |
| `src/lib/execution-state.ts` | Reduced to a thin re-export shim of `execution/canonical`. All duplicate implementations deleted. `synthesizeRunsFromCase` and `mergeWithCaseFallback` reduced to no-ops (backfill moved to DB migration). |
| `src/components/PipelineStatusGrid.tsx` | Rewritten to consume `useCaseExecution`. Local `STAGES` array (20 entries), `stageCompleteFromCase()` timestamp fallback, and inline state derivation deleted. |
| `src/components/CaseEngineStatus.tsx` | Rewritten to consume `useCaseExecution`. Local `ENGINE_ORDER` (22 entries), `FALLBACK` timestamp map, private Supabase channel, and local `useState/useEffect` cache deleted. |
| `src/components/PipelinePanel.tsx` | Now consumes `useCaseExecution`. Private `pipe-runs-*` Supabase channel and `EngineRow` fetch loop deleted. |
| `src/components/CommandCenterDashboard.tsx` | Now consumes `useCaseExecution`. Private `cmdctr-engines-*` Supabase channel, `engineRows` state cache, and `pipelineProgressPercent` re-computation deleted. |
| `src/lib/pipeline-runner.server.ts` | Local 20-entry `DEPENDS_ON` map deleted; dependencies derived from `CANONICAL_STAGES`. |

### Duplicate surfaces eliminated

| Surface | Before | After |
| --- | --- | --- |
| Stage lists | 4 (execution-state, progress.server, PipelineStatusGrid, CaseEngineStatus) | 1 (`CANONICAL_STAGES`) |
| Engine → label maps | 4 | 1 (derived) |
| Status derivation fns | 5 (per-component switch statements) | 1 (`deriveStageState`) |
| Progress percent fns | 3 | 1 (`computeProgress`) |
| Report-gate fns | 2 (`missingRequiredEngines` + inline in `pipeline.server.ts`) | 1 (`canGenerateReport`) |
| Realtime channels per open case | 4 (`engine-runs-*`, `pipe-runs-*`, `cmdctr-engines-*`, plus PipelineStatusGrid) | 1 (`case-execution:*`) |
| Timestamp-column fallback maps | 3 (execution-state, PipelineStatusGrid, CaseEngineStatus) | 0 (migrated to DB backfill) |
| Dependency graphs | 2 (`pipeline-runner.server.ts`, `progress.server.ts`) | 1 (`CANONICAL_STAGES[*].dependsOn`) |

### Database migration
`20260702025806` — Canonical Execution Refactor backfill. For every historical
case that carries `cases.*_at` timestamps but has no `pipeline_engine_runs`
row for the corresponding engine, inserts a synthetic `completed` audit row
tagged with `meta = { source: 'canonical_backfill_2026_07_02' }`. Idempotent.
Result: every case, historical or new, resolves to identical execution state
across every screen because they all read the same audit table.

### What was **not** deleted (and why)
- `cases.*_at` timestamp columns — retained as an immutable audit trail; no
  code branches on them anymore. Safe to drop in a future release.
- `cases.pipeline_progress` JSON column — retained one release for rollback
  safety. `progress.server.ts` still writes it as a hint for the activity
  feed but nothing reads it for state decisions.
- `progress.server.ts` `emitEvent` and `withStage` — kept because they feed
  the `pipeline_events` activity feed, which is a separate concern from
  execution state.
- `LivePipelinePanel.tsx` subscription to `pipeline_events` — that channel
  streams the activity feed (log), not execution state.

## Phase 3 — Validation

### Automated
- `bunx tsgo --noEmit` — clean.
- `bunx vitest run src/lib/execution` — 10/10 passed.
  - Unique keys/engines invariant.
  - Bidirectional index consistency.
  - Dependency graph acyclicity + topological ordering.
  - Blocking classification matches the canonical set.
  - Report gate blocks when blocking engines missing; passes with
    completed-or-skipped set.
  - `deriveStageState` transitions `locked → waiting → running → complete`.
  - `computeStageViews` returns every canonical stage in order.
  - `computeProgress` percent math including `multi_agent` exclusion.
  - `latestRowsByEngine` most-recent-wins.

### Invariants now enforced by construction
1. Exactly one execution pipeline (`CANONICAL_STAGES`).
2. Exactly one execution state source (`pipeline_engine_runs` via `useCaseExecution` / `loadExecutionState`).
3. Exactly one stage definition (`CANONICAL_STAGES`).
4. Exactly one release gate (`canGenerateReport`).
5. Exactly one execution service (`src/lib/execution/service.server.ts`).
6. Every UI panel showing pipeline state is subscribed to the same query key.
7. Cancel + rerun leaves every screen showing identical state (they all
   invalidate on the same realtime event).

## API compatibility

All legacy imports from `@/lib/execution-state` continue to resolve — the file
is now a re-export shim. New code should import from `@/lib/execution/canonical`
or use the `useCaseExecution` hook directly. Legacy call sites can be migrated
incrementally without behavior change.
