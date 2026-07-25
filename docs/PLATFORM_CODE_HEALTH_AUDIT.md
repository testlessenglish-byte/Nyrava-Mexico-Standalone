# Nyrava Platform Code Health Audit

Date: 2026-07-02
Scope: entire repository excluding the execution engine (audited separately in
`CANONICAL_EXECUTION_FINAL.md`).
Method: static inspection only — **no code changed**.

Repository size: **40,297 LOC** across `src/`; 64 migrations; 19 app routes; 37 tables.

---

## Executive Summary

| Area | Health | Notes |
|---|---|---|
| Execution engine | ✅ Canonical | Completed in prior refactor. |
| Case Detail UI | 🔴 Poor | 6 overlapping status/pipeline panels on one page. |
| Server orchestration | 🟠 Mixed | `pipeline.server.ts` is a 2,596-LOC god module. |
| AI router | 🟢 Good | Single router; provider abstraction is clean. |
| Realtime | 🟠 Mixed | 5 independent Supabase channels per case. |
| DB schema | 🟠 Mixed | 3–5 tables appear unused; legacy `cases.*_at` columns retained. |
| Security | 🟢 Good | Recent scan-driven fixes still in place; no new exposures found. |
| Dead code | 🟢 Low | Only 2 truly unreferenced source files. |

Overall grade: **B–**. The platform is stable and shippable, but the case
detail surface and `pipeline.server.ts` are the two concentrated debt hotspots
worth addressing before scaling features.

---

## 1. Critical Issues

### C1. Six overlapping panels render on the case detail page
`src/routes/_app/cases.$caseId.tsx` mounts all of:

- `PipelinePanel` (281 LOC) — stage list + document freshness
- `LivePipelinePanel` (227 LOC) — `pipeline_events` activity stream
- `PipelineStatusGrid` (66 LOC) — compact stage grid
- `CaseEngineStatus` (109 LOC) — per-engine chips
- `CommandCenterDashboard` (522 LOC) — SVG radar + activity
- `MultiAgentPanel` (182 LOC) — 13-agent status
- `LitigationPanels` (464 LOC) — findings tabs
- `CaseControlPanel` (310 LOC) — run/rerun controls

That is **8 panels, ~2,160 LOC, and 5 realtime channels**, most of them
displaying overlapping slices of the same execution state that
`useCaseExecution` already exposes.

**Impact:** high render cost per case open, five WebSocket channels per user
session, duplicated status vocabulary in UI code, and confusing UX (three
places show "stage progress" simultaneously).
**Effort:** M (2–3 days). Collapse into `CaseControlPanel` + one status
surface + `LitigationPanels` + `MultiAgentPanel`.

### C2. `pipeline.server.ts` is a 2,596-LOC god module
Contains: stage runners, batching, retries, extraction fallbacks, scoring
integration, report generation, PDF payload shrinking, chain-of-custody
grounding, and evidence gates.

**Impact:** every pipeline change touches this file; test surface is huge;
merge conflicts likely; cognitive load high for new contributors.
**Effort:** L (1 week). Split into `pipeline/stages/`, `pipeline/report.ts`,
`pipeline/batching.ts`, keep `pipeline.server.ts` as an orchestrator only.

### C3. `cases.functions.ts` still holds a 1,974-LOC orchestrator
After the canonical refactor it delegates to `pipeline-runner.server.ts` but
retains an alternate legacy code path plus every case CRUD function.

**Impact:** two code paths still exist for "Run Case" (UI-triggered vs worker).
Risk of divergence returns any time a new stage is added.
**Effort:** M. Extract CRUD into `cases-crud.functions.ts`; delete the
duplicate orchestration path now that `pipeline-runner` is canonical.

---

## 2. High-Priority Issues

### H1. Five parallel realtime subscriptions per open case
`useCaseExecution`, `CommandCenterDashboard`, `MultiAgentPanel`,
`LivePipelinePanel`, `PipelinePanel` each open their own
`postgres_changes` channel. Only two (`agent_logs`, `pipeline_events`) are
orthogonal to execution state; the others duplicate work the canonical hook
already does.
**Fix:** route `documents` freshness through the shared hook and drop the
private channels in `PipelinePanel` and `CommandCenterDashboard`.
**Effort:** S.

### H2. Two scoring modules coexist
- `src/lib/intelligence/scoring.server.ts` — deterministic scorecard math.
- `src/lib/intelligence/canonical-scoring.ts` — canonical finding selector.

They are complementary, not duplicates, but the naming (`canonical-*`)
overlaps with `src/lib/execution/canonical.ts` and
`src/lib/intelligence/canonical.ts` and
`src/lib/intelligence/canonical-id.ts` and
`src/lib/intelligence/canonical-timeline.server.ts`. Five modules share the
"canonical" prefix with distinct meanings.
**Fix:** rename `canonical-scoring.ts` → `scoring-selection.ts`; move all
scoring concerns under `intelligence/scoring/`.
**Effort:** S.

### H3. Direct Supabase queries from 11 client files
Many components query Supabase directly instead of going through
`useCaseExecution` or a server function. Any RLS/schema change requires
touching all 11.
**Fix:** wrap queries in a `useCase*` hook set (findings, documents,
agents, reports).
**Effort:** M.

### H4. Legacy `cases.*_at` timestamp columns still read in code
`pipeline.server.ts`, `pipeline-runner.server.ts`, `litigation.server.ts`,
`contradictions.server.ts`, `engines.server.ts`, and `canonical-scoring.ts`
still read the deprecated per-stage `*_at` columns even though canonical
state lives in `pipeline_engine_runs`.
**Fix:** replace with `loadCaseExecution()` reads; then drop the columns in
one migration.
**Effort:** M.

---

## 3. Medium-Priority Issues

### M1. Dead source files
Confirmed unreferenced (no importer anywhere in `src/`):
- `src/components/SectionPicker.tsx`
- `src/lib/intelligence/contradictions.server.ts` (superseded by
  `derived-engines.server.ts`)

**Fix:** delete. **Effort:** trivial.

### M2. Likely-unused database tables
Zero code references from `src/`:
- `agent_configs`
- `feature_flags`
- `audit_logs` (compare with `admin_audit_log`, which has 2 refs)

Low-reference tables that may be dead:
- `ai_task_routing` (2 refs, both in seed/admin UI only)
- `case_domain_activations` (2 refs)

**Fix:** verify with product; drop or document. **Effort:** S per table.

### M3. 43 ad-hoc `z.object({...})` schemas
No shared schema library. Common shapes (case row, finding, engine run) are
redefined per file, so contract drift is easy.
**Fix:** consolidate under `src/lib/schemas/`. **Effort:** M.

### M4. Multiple "canonical" modules cause naming collisions
See H2 — five files begin with `canonical`. Refactor with clearer names
(`stage-catalog`, `id-normalize`, `timeline-builder`, `scoring-selection`).

### M5. Report generation logic split across 3 files
`pipeline.server.ts` (payload shrink + render), `export.ts` (PDF/DOCX
builders), `evidence-map.server.ts` (evidence-appendix generator). No shared
"report composer" interface.
**Fix:** introduce `src/lib/report/` with clear pipeline: assemble →
verify → render → persist. **Effort:** M.

---

## 4. Low-Priority Issues

- **L1.** `execution-state.ts` is a 53-LOC compatibility shim. Keep for one
  release, then remove.
- **L2.** `IntelligenceCore.tsx` is used only on `routes/index.tsx`
  (marketing) — verify it isn't loading heavy deps.
- **L3.** `agent_findings` table is referenced but `agent_logs` is the
  primary agent surface — confirm both are still needed.
- **L4.** Voice routes (`api/voice/*`) don't go through `createServerFn`;
  fine (streaming), but ensure per-user rate limiting exists.
- **L5.** 64 migrations, many of them one-off tweaks; consider a squash
  baseline before v2.0.

---

## 5. Security Review

Scanned for: exposed secrets in source, service-role leaks to client, missing
`requireSupabaseAuth` middleware, unsafe `dangerouslySetInnerHTML`.

- ✅ No `supabaseAdmin` imports at top level of route/component modules.
- ✅ No hard-coded API keys or JWTs in `src/`.
- ✅ Public-route loaders do not call `requireSupabaseAuth` server fns.
- ✅ Prior scan-fix migration (`pipeline_worker_auth`, timeline RLS, etc.)
  still in place.
- 🟡 `worker_secrets`, `user_groq_keys` — recommend re-running
  `security--run_security_scan` after this audit before shipping any
  auth-adjacent change.
- 🟡 `has_role` is only invoked from 1 UI file (`admin.users.tsx`). Any
  admin-only server function should assert it explicitly; confirm each
  admin-tier server fn calls `has_role` inside the handler.

No **critical** security findings from static review.

---

## 6. Performance Review

- **P1 (High):** duplicate realtime channels — see H1.
- **P2 (Medium):** `LitigationPanels` (464 LOC) fetches all case tabs on
  mount. Lazy-load tabs.
- **P3 (Medium):** `CommandCenterDashboard` (522 LOC) renders an SVG radar on
  every event tick. Debounce or memoize by run signature.
- **P4 (Low):** `derived-engines.server.ts` already collapsed 4 redundant
  LLM calls — good; monitor for future regressions.
- **P5 (Low):** No obvious N+1s in the read paths sampled; TanStack Query
  keys look well-scoped.

---

## 7. Recommended Cleanup (rank-ordered)

1. **Case Detail UI consolidation** (C1) — biggest UX + perf win.
2. **Split `pipeline.server.ts`** (C2) — highest maintainability win.
3. **Route all realtime through `useCaseExecution`** (H1).
4. **Drop `cases.*_at` columns + collapse legacy readers** (H4).
5. **Rename `canonical-*` cluster** (H2/M4).
6. **Delete confirmed dead files** (M1).
7. **Drop unused tables after product confirmation** (M2).
8. **Shared zod schemas** (M3).
9. **Report composer refactor** (M5).
10. **Squash migrations at v2.0 baseline** (L5).

---

## 8. Estimated Impact / Effort Matrix

| ID | Impact | Effort | ROI |
|---|---|---|---|
| C1 | 🔴 High | M | ★★★★★ |
| C2 | 🔴 High | L | ★★★★ |
| C3 | 🔴 High | M | ★★★★ |
| H1 | 🟠 Med | S | ★★★★★ |
| H2 | 🟠 Med | S | ★★★★ |
| H3 | 🟠 Med | M | ★★★ |
| H4 | 🟠 Med | M | ★★★★ |
| M1 | 🟢 Low | XS | ★★★★★ |
| M2 | 🟢 Low | S | ★★★★ |
| M3 | 🟢 Low | M | ★★ |
| M4 | 🟢 Low | S | ★★★ |
| M5 | 🟠 Med | M | ★★★ |

Legend — Effort: XS <1h, S <½day, M 1–3d, L ≥1 week.

---

## 9. Verdict

Foundation is strong. The two highest-leverage cleanups are **UI
consolidation on the case detail page** and **splitting
`pipeline.server.ts`**. Everything else is incremental hygiene that can be
done opportunistically alongside feature work.

No code was modified during this audit.
