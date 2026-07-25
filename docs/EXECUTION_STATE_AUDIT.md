# Execution State Audit — Nyrava

> Read-only audit. No code changes proposed here; only findings + a plan.

## 1. Every place execution/completion state is tracked

There are **five** parallel state surfaces. They are read and written by
different code paths and drift under normal operation.

### A. `public.pipeline_engine_runs` (DB — per-engine audit rows)

- **Schema role:** one row per engine invocation. Columns:
  `engine, status ('queued'|'running'|'completed'|'failed'|'skipped'), started_at, ended_at, runtime_ms, generated, accepted, rejected, suppressed_ess, suppressed_validator, skipped_reason, error, meta, created_at`.
- **Writers:**
  - `src/lib/intelligence/engine-audit.server.ts` → `runEngine()`, `recordSkipped()`, `clearEngineRuns()` — canonical inserts/updates.
  - `src/lib/pipeline.server.ts` — direct inserts/deletes at lines
    `544, 602, 643, 655, 762, 824, 1032, 1456, 2199, 2207, 2221`
    (batch analyzer/agent rollups, scoring reset, report finalize).
  - `src/lib/pipeline-runner.server.ts:29` — bulk delete on `reset`.
  - `src/lib/cases.functions.ts:257` — delete `timeline` engine row before rerun.
  - `src/lib/agents/orchestrator.server.ts:137` — writes for multi-agent.
- **Readers:**
  - `execution-state.ts` (helpers: `latestRowsByEngine`, `pipelineProgressPercent`, `missingRequiredEngines`, `synthesizeRunsFromCase`, `mergeWithCaseFallback`).
  - `components/PipelinePanel.tsx:104`
  - `components/CaseEngineStatus.tsx:102`
  - `components/CommandCenterDashboard.tsx:135`
  - `lib/agents/statistics.server.ts:149`
  - `lib/pipeline.server.ts` (pre-flight report gate lines `1357, 1475, 2527`).
  - `lib/cases.functions.ts` — resume gate (`580`), listing (`1445`).
  - `lib/account.functions.ts:184`.

### B. `public.cases.*_at` timestamp columns (DB — coarse per-stage flags)

Columns: `extracted_at, analysis_at, agents_at, contradiction_at, discovery_at, evidence_intel_at, witnesses_at, theories_at, opportunities_at, perspectives_at, trial_prep_at, strategy_at, work_product_at, hallucination_at, scored_at, report_at`, plus `status, status_message, progress, next_stage, completed_at, cancel_requested`.

- **Writers:**
  - `src/lib/pipeline.server.ts:396,771,1022,1084,1229,2593` — extraction / analyzers / agents / scoring / report finalize.
  - `src/lib/intelligence/engines.server.ts:444,535,543,599` — discovery/witness.
  - `src/lib/pipeline-runner.server.ts:36-45` — bulk NULLs on reset; `status/status_message/progress` on every stage tick.
  - `src/lib/cases.functions.ts:553-560, 1357, 1384` — queue, force-cancel, reset.
  - `src/routes/api/public/hooks/pipeline-worker.ts:34` — lease → `status:'running'`.
- **Readers:** `execution-state.synthesizeRunsFromCase`, `PipelineStatusGrid.stageCompleteFromCase`, `CaseEngineStatus` fallback map, `progress.server.stageSatisfiedFromCaseState`, `pipeline.server` scoring gates (`1045, 1526`), `cases.$caseId.tsx` UI.

### C. `public.cases.pipeline_progress` (DB — JSON stage state)

Shape: `Record<StageKey, 'locked'|'waiting'|'running'|'complete'|'failed'>`.
- **Writers:** `src/lib/intelligence/progress.server.ts` (`setStage`), invoked from `cases.functions.runLabeledStep`, `pipeline-runner.server.ts` (per stage tick + on block/fail/cancel).
- **Readers:** `progress.server.getProgress` and `ensurePrereqs`. **No UI component reads this** — it exists purely for the server-side prereq gate.

### D. `public.pipeline_events` (DB — append-only activity log)

- **Writer:** `progress.server.emitEvent` (also called from `engine-audit.server` and directly from `pipeline-runner.server`).
- **Readers:** `LivePipelinePanel.tsx:78`, `CommandCenterDashboard.tsx:156`.

### E. Component/local state (client caches)

- `PipelinePanel` — `useState rows` (`pipeline_engine_runs`) + `useState latestDocAt` (`documents`) → derives `visuals`.
- `CaseEngineStatus` — `useState rows` (same table) + separate FALLBACK map inline (not the shared helper).
- `CommandCenterDashboard` — `useState engineRows` + `useState events`; separately consumes `progress` and `status` **props** passed down from the route.
- `PipelineStatusGrid` — pure; recomputes from `caseRow` + `runs` prop.
- `LivePipelinePanel` — `useState events`.
- Route `cases.$caseId.tsx` — its own `useQuery(getCase)` supplies `caseRow.status/progress/*_at` to every child.

Additional derived surfaces that also carry "state":
- `documents.status` (per-file extraction FSM).
- `case_scores.*`, `reports.status`, `report_versions` — completion signals for scoring / report stages consumed by canonical helpers.
- `agent_logs` — the 13-agent equivalent of `pipeline_engine_runs`.

## 2. Where these surfaces are inconsistent

1. **Two independent stage vocabularies.**
   - `progress.server.STAGE_ORDER` has **11 keys** (extraction … report); no `timeline`, `evidence_map`, `constitutional`, `perspectives`, `opportunities`, `trial_prep`, `work_product`, `hallucination`, `multi_agent`.
   - `cases.functions.PIPELINE_STAGES` has **20 keys** (the ones above).
   - `LABEL_TO_STAGE` (`cases.functions.ts:112`) forcibly aliases `Opportunities → theories` and marks `Perspectives, TrialPrep, WorkProduct, FullIntelligence` as `null` (progress silently skipped).
   Result: `pipeline_progress` never reflects half the pipeline, yet the pre-req gate blocks on it.

2. **Three independent engine-name lists.**
   - `execution-state.PIPELINE_STAGE_TO_ENGINE` (18 stages → engine names).
   - `execution-state.COMMAND_CENTER_ENGINES` (12 engines — subset).
   - `CaseEngineStatus.ENGINE_ORDER` (22 engines — includes `ocr, entity_extraction, fact_extraction, chain_of_custody, procedural_violations, ess_validator, claim_validator, motion, report_validator`, none of which appear in the other two lists).
   `PIPELINE_STAGES` in `cases.functions.ts` is a **fourth** list with different labels. `PipelineStatusGrid.STAGES` is a **fifth** copy of the same 19 entries.

3. **Two fallback maps that don't agree.**
   - `execution-state.ENGINE_TIMESTAMP_FALLBACK` maps engine → case column and covers 18 engines (adds `timeline→agents_at`, `evidence_map→agents_at`, `constitutional_compliance→contradiction_at`).
   - `CaseEngineStatus.FALLBACK` (inline in the component) omits `timeline`, `evidence_map`, `trial_prep`, `work_product`, `hallucination`, uses different keys, and maps `constitutional_compliance→contradiction_at` by coincidence.
   - `PipelineStatusGrid.stageCompleteFromCase` hard-codes a third mapping and returns `false` for `timeline` and `evidence_map`.
   Same case, same instant → three different "% complete" answers.

4. **Case-row `status` vs engine-row `status` disagree.**
   `pipeline-runner.server.ts` writes `cases.status='intelligence_complete'` whenever any non-fatal stage failed (`196-206`), but the individual `pipeline_engine_runs.status` remain `'failed'`. `CommandCenterDashboard` derives `running` from BOTH sources (`206`), producing "running + failed + complete" simultaneously.

5. **`cases.progress` is a linear estimate, not derived.**
   Written as `Math.floor((i/total)*95)` inside the runner (`136`). It is not consistent with `pipelineProgressPercent(rows)` (derived from `pipeline_engine_runs`) which `CommandCenterDashboard.tsx:205` prefers when rows exist and falls back to the case-row estimate otherwise.

6. **Report gate uses two different criteria in the same file.**
   `pipeline.server.ts:1355` and `1473` both call `missingRequiredEngines`, but one uses `REPORT_REQUIRED_ENGINES` (11 engines) and the other splits on `REPORT_BLOCKING_ENGINES` (4 engines). Meanwhile `resumeFullPipelineStep` (`cases.functions.ts:580`) walks `PIPELINE_STAGES` (20 keys) → different resume point than the gate would predict.

7. **Reset wipes disagree.**
   `pipeline-runner.server.ts:24-45` nulls a set of `*_at` columns but omits `evidence_intel_at`… wait — it lists it. It **omits** `agents_at`? No, it lists it. It **omits** `scored_at`? Listed. But it does NOT null `pipeline_progress`, so the JSON stage map keeps stale `complete` states after a reset, and `ensurePrereqs` will pass gates that were just wiped from `pipeline_engine_runs`.

8. **Client component-local caches never invalidate together.**
   `PipelinePanel`, `CaseEngineStatus`, `CommandCenterDashboard`, `LivePipelinePanel`, and the route's `useQuery(getCase)` each subscribe independently. A single engine tick fires four realtime handlers plus a manual `router.invalidate()`; ordering skew (documents lands before engine_runs) is visible as `out_of_date` badges in `PipelinePanel` even mid-run.

9. **Multi-agent has its own audit table.**
   `agent_logs` is written by `orchestrator.server.ts` and read by `MultiAgentPanel`. It is neither joined into `pipeline_engine_runs` nor surfaced by `latestRowsByEngine`. `MultiAgentPanel` and `PipelinePanel` can show completely different "multi_agent" states.

10. **`ENGINE_TIMESTAMP_FALLBACK` maps `timeline→agents_at`.** Timeline can therefore appear "complete" purely because agents finished, even if `runTimelineAudit` failed or was never run.

## 3. Proposed canonical execution record

Adopt **`public.pipeline_engine_runs` as the sole source of truth** for stage/engine completion. Everything else becomes either (a) a display attribute derived at read time, or (b) deleted.

### Canonical model

- **Row identity:** `(case_id, engine, attempt_no)` — most-recent attempt wins.
- **Enum:** `queued | running | completed | failed | skipped | blocked`
  (add `blocked` so the dependency gate is representable instead of being smuggled through `failed`).
- **Derived reads** (all in `src/lib/execution-state.ts`, new module boundary — no component reaches into the DB shape directly):
  - `getCaseExecutionState(caseId)` → `{ stages: Record<StageKey, StageRecord>, progressPct, running, blocking: StageKey[], nonBlocking: StageKey[], lastEventAt }`.
  - Backed by a single query returning the latest run per engine (server RPC or client helper using `latestRowsByEngine`).
- **Single stage vocabulary:** one exported `CANONICAL_STAGES` array (id, label, engine, dependsOn, isBlockingForReport, isDerivedFrom). Every component and every server helper imports from this — no local `STAGES`, `ENGINE_ORDER`, `PIPELINE_STAGES`, or `COMMAND_CENTER_ENGINES` copies.

### What goes away

- `cases.pipeline_progress` JSON column — remove writers, drop the column in a follow-up migration. Prereqs derive from `pipeline_engine_runs`.
- `cases.*_at` per-stage timestamps — keep as **display-only** projections written by the same `runEngine` wrapper (so old data is still readable), but NEVER read as a source of truth. `synthesizeRunsFromCase` and every fallback map are deleted.
- `cases.progress` (int) — becomes a stored generated column (or removed) computed from engine rows. UI reads `pipelineProgressPercent`.
- `cases.status` — narrowed to a **case-lifecycle** enum (`uploaded | queued | running | complete | failed | cancelled`) computed by a single reducer in `execution-state.ts`; no per-stage strings.

### What stays

- `pipeline_events` (append-only log) — for the activity feed only, never for gating.
- `agent_logs` — kept, but the multi_agent stage's `pipeline_engine_runs` row remains the completion signal. `agent_logs` is a per-agent detail table analogous to `document_pages` for extraction.

## 4. Files & functions that must change

Group A — **new canonical layer (add):**
- `src/lib/execution-state.ts` — add `CANONICAL_STAGES`, `StageRecord`, `getCaseExecutionState(caseId)`, `reduceCaseStatus(rows)`. Remove `synthesizeRunsFromCase`, `mergeWithCaseFallback`, `ENGINE_TIMESTAMP_FALLBACK`, `COMMAND_CENTER_ENGINES`, `PIPELINE_STAGE_TO_ENGINE` (replaced by `CANONICAL_STAGES`).
- `src/lib/intelligence/engine-audit.server.ts` — extend `runEngine` to also update the (deprecated) `cases.*_at` column atomically until the column drop lands, so both readers stay consistent during migration.
- New: `src/hooks/useCaseExecution.ts` — one realtime subscription that fans out to all panels (via React Query cache key `["case-execution", caseId]`), replacing the four independent subscriptions.

Group B — **collapse duplicate vocabularies (edit):**
- `src/lib/cases.functions.ts`
  - `PIPELINE_STAGES` (501-522) → import from `execution-state`.
  - `LABEL_TO_STAGE` (112-129) → delete (progress no longer stored).
  - `runLabeledStep` (131-…) → drop `prog.setStage/ensurePrereqs`; call `execution-state.assertDependenciesMet(caseId, engine)` derived from `pipeline_engine_runs`.
  - `resumeFullPipelineStep` (572-599) → use `getCaseExecutionState` to compute resume point.
- `src/lib/pipeline-runner.server.ts`
  - `derivedTables` (24-30) — keep `pipeline_engine_runs`; **remove** the `cases.update({... *_at: null ...})` block once column drop is done (interim: also null `pipeline_progress`).
  - `runners` map + `DEPENDS_ON` (68-117) → replace with `CANONICAL_STAGES[i].dependsOn`.
  - Stage tick's `cases.update({status, status_message, progress})` (147-161, 200-206) → replace with `updateCaseLifecycle(caseId)` that reduces from engine rows.
- `src/lib/intelligence/progress.server.ts` — delete `getProgress`, `setStage`, `ensurePrereqs`, `stageSatisfiedFromCaseState`, `STAGE_ORDER`, `UPSTREAM_OF`, `withStage`. Keep only `emitEvent` (moved to `events.server.ts`).

Group C — **components (edit):**
- `src/components/PipelinePanel.tsx` — remove `pipeline_engine_runs` query + realtime; use `useCaseExecution(caseId)`; drop `mergeWithCaseFallback`; delete local `PIPELINE_STAGES` references (already imports from `cases.functions`, switch to `execution-state`).
- `src/components/CaseEngineStatus.tsx` — delete inline `ENGINE_ORDER`, `LABEL`, `FALLBACK`. Use `useCaseExecution(caseId)` + `CANONICAL_STAGES`.
- `src/components/CommandCenterDashboard.tsx` — remove `engineRows` state + realtime; use `useCaseExecution`. Drop the `progress` and `status` props (derive both from the hook). `progressPct` becomes `state.progressPct` unconditionally.
- `src/components/PipelineStatusGrid.tsx` — delete local `STAGES` array and `stageCompleteFromCase`. Take `state` from `useCaseExecution` (or receive it as a prop from the route).
- `src/components/LivePipelinePanel.tsx` — unchanged (only reads `pipeline_events`).
- `src/components/MultiAgentPanel.tsx` — keep `agent_logs` read; also render `state.stages.multi_agent` for the top-level status so the two panels never disagree.

Group D — **server gates (edit):**
- `src/lib/pipeline.server.ts`
  - Report pre-flight (1355-1362, 1473-1485) — call `getCaseExecutionState().blocking`; delete the second, duplicate gate.
  - Scoring pre-flight (1045-1049, 1526-1530) — read from execution state, not `cases.discovery_at/contradiction_at/evidence_intel_at/scored_at`.
  - All direct `pipeline_engine_runs` inserts/updates (544, 602, 643, 655, 762, 824, 1032, 1456, 2199, 2207, 2221) → funnel through `runEngine`/`recordSkipped` in `engine-audit.server.ts`; the direct writes are the source of most drift.
- `src/lib/agents/orchestrator.server.ts:137` — already uses the table directly; wrap in `runEngine("multi_agent", …)` so the stage row exists exactly once.
- `src/lib/account.functions.ts:184` — swap ad-hoc select for `getCaseExecutionState`.

Group E — **DB migrations (follow-up):**
- Add `pipeline_engine_runs.attempt_no` (int) + partial unique index `(case_id, engine, attempt_no)`.
- Add `blocked` to any status CHECK constraint (or drop the constraint if it's an unchecked text column — verify via `information_schema`).
- After Groups A-D ship and a burn-in period: drop `cases.pipeline_progress`, drop the 15 `cases.*_at` columns, replace `cases.status` with the narrowed enum, and either drop `cases.progress` or make it a generated column reading a small view.

## 5. Migration order (safe rollout, no code changes yet)

1. Ship Group A (new helpers coexisting with old ones).
2. Switch components (Group C) to `useCaseExecution` one at a time, verifying the numbers match `pipeline_engine_runs` directly in devtools.
3. Convert server gates (Group D) — pre-flight, resume, and scoring.
4. Collapse vocabularies (Group B) — this is where `progress.server.ts` and `LABEL_TO_STAGE` are removed.
5. Once nothing reads them, run the Group E migrations.

## Appendix — quick-reference file map

| Surface | Writers | Readers |
| --- | --- | --- |
| `pipeline_engine_runs` | `engine-audit.server`, `pipeline.server`, `pipeline-runner.server`, `cases.functions`, `orchestrator.server` | `execution-state`, `PipelinePanel`, `CaseEngineStatus`, `CommandCenterDashboard`, `PipelineStatusGrid`, `statistics.server`, `pipeline.server` (report gate), `cases.functions` (resume), `account.functions` |
| `cases.*_at` | `pipeline.server`, `engines.server`, `pipeline-runner.server` (reset) | `execution-state` (fallback), `PipelineStatusGrid`, `CaseEngineStatus` (inline FALLBACK), `progress.server`, `pipeline.server` (scoring gate) |
| `cases.pipeline_progress` | `progress.server.setStage` | `progress.server.getProgress/ensurePrereqs` only |
| `pipeline_events` | `progress.server.emitEvent` | `LivePipelinePanel`, `CommandCenterDashboard` |
| `cases.status / progress / status_message` | `pipeline-runner.server`, `cases.functions`, `pipeline-worker` | route `cases.$caseId.tsx`, `PipelinePanel` (`anyRunning`), `CommandCenterDashboard` (`running`) |
| `agent_logs` | `orchestrator.server` | `MultiAgentPanel`, `statistics.server` |
