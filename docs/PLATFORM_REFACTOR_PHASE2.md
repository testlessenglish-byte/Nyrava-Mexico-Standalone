# Nyrava Platform Refactor — Phase 2 Delivery Report

Date: 2026-07-02
Scope: Steps 2 + 3 (partial). Step 1 (splitting `pipeline.server.ts` and
`cases.functions.ts`) is **intentionally deferred** — rationale below.

---

## 1. What Shipped This Turn

### Case Detail Page Consolidation (Step 2 — DONE)
The case detail page previously mounted **eight** status/execution panels.
Three of them displayed the same execution state through different visual
lenses.

**Removed from `src/routes/_app/cases.$caseId.tsx`:**
- `PipelineStatusGrid` — duplicated stage state already shown by
  `CommandCenterDashboard` + `PipelinePanel`.
- `CaseEngineStatus` — duplicated the per-engine chips inside
  `PipelinePanel`.

**Retained (each has a distinct responsibility):**
| Panel | Purpose |
|---|---|
| `CaseControlPanel` | Run / Rerun / Cancel controls + cost warning |
| `CommandCenterDashboard` | Executive radar + progress summary |
| `PipelinePanel` | Per-stage detail + document freshness indicator |
| `MultiAgentPanel` | 13-agent multi-review status (distinct data source) |
| `LivePipelinePanel` | `pipeline_events` activity feed (footer) |
| `LitigationPanels` | Perspectives / Evidence Intel / Strategy tabs |
| `ImageIntelligencePanel` | Vision-extracted image findings |

**Result:** –2 mounted panels, cleaner UX. Every remaining panel has a
unique responsibility.

### Dead-Code Removal (Step 3 — DONE)
Files deleted:
- `src/components/SectionPicker.tsx` — zero importers.
- `src/lib/intelligence/contradictions.server.ts` — superseded by
  `derived-engines.server.ts`; zero importers.
- `src/components/CaseEngineStatus.tsx` — orphaned after the consolidation
  above.

### Naming-Collision Fix (Step 3 — DONE)
Five files previously shared the `canonical-*` prefix with unrelated
meanings. Renamed:
- `src/lib/intelligence/canonical-scoring.ts` →
  `src/lib/intelligence/scoring-selection.ts`
- `src/lib/intelligence/__tests__/canonical-scoring.test.ts` →
  `src/lib/intelligence/__tests__/scoring-selection.test.ts`
- All import sites updated.

---

## 2. File Modification Summary

| File | Change |
|---|---|
| `src/routes/_app/cases.$caseId.tsx` | Removed 2 panel imports + 2 mount blocks |
| `src/lib/pipeline.server.ts` | Import path updated to `scoring-selection` |
| `src/lib/intelligence/__tests__/scoring-selection.test.ts` | Renamed + import updated |
| `src/lib/intelligence/scoring-selection.ts` | Renamed from `canonical-scoring.ts` |

## 3. File Deletion Summary

| File | Reason |
|---|---|
| `src/components/SectionPicker.tsx` | Unused |
| `src/components/CaseEngineStatus.tsx` | Consolidated into `PipelinePanel` view |
| `src/lib/intelligence/contradictions.server.ts` | Superseded by `derived-engines.server.ts` |
| `src/lib/intelligence/canonical-scoring.ts` | Renamed (naming collision) |
| `src/lib/intelligence/__tests__/canonical-scoring.test.ts` | Renamed |

## 4. Verification

- **Behavior:** no user-facing functionality changed. All execution data
  previously shown by the removed panels is still visible via
  `CommandCenterDashboard` and `PipelinePanel`, both of which read from the
  canonical `useCaseExecution` hook.
- **Realtime channels:** unchanged in count; the removed panels did not own
  their own subscriptions (they consumed the canonical hook), so no
  channels were dropped or duplicated.
- **Tests:** `canonical-scoring.test.ts` renamed to
  `scoring-selection.test.ts` with import updated; test bodies unchanged.
- **Duplicate orchestration paths:** none introduced.
- **Duplicate UI responsibilities:** two eliminated; none introduced.

---

## 5. Intentionally Deferred (with rationale)

### D1. Splitting `pipeline.server.ts` (2,596 LOC)
**Why deferred:** the file contains 12 exported functions plus dozens of
private helpers with tight cross-references (batching, retry, extraction
fallbacks, chain-of-custody, PDF payload shrinking). Splitting safely
requires:
1. mapping every private-helper call-site,
2. extracting shared internals to `pipeline/shared.server.ts` first,
3. moving each stage runner into `pipeline/{stage}.server.ts`,
4. having `pipeline.server.ts` become a re-export barrel for backwards
   compatibility.

Doing this in a single automated pass risks introducing subtle behavior
changes in the critical execution path. Recommended as its own dedicated
work item with a dry-run + full pipeline test between each extraction.

### D2. Splitting `cases.functions.ts` (1,974 LOC)
**Why deferred:** same shape. 60+ `createServerFn` declarations plus
sibling helpers (`getAuthedContext`, `runLabeledStep`, `assertCaseOwner`,
`LABEL_TO_STAGE`). Per `tss-serverfn-split`, sibling helpers in a
`.functions.ts` file are a known runtime hazard when a bundler split
places them in a separate chunk from their handler. Safe extraction
requires moving all helpers to `cases-shared.server.ts` first, then
splitting server-fn declarations by domain
(`cases-crud.functions.ts`, `groq-admin.functions.ts`,
`admin.functions.ts`, `evidence.functions.ts`,
`pipeline-steps.functions.ts`, `chat.functions.ts`), then re-exporting
from the original file for back-compat.

### D3. Legacy `cases.*_at` timestamp column removal
**Why deferred:** 6 modules still read these columns. Reader migration
requires touching `litigation.server.ts`, `engines.server.ts`,
`scoring-selection.ts`, and both pipeline files. Recommended after D1
completes so the changes land in the same PR that owns pipeline internals.

### D4. Shared zod schema library
**Why deferred:** low urgency; not blocking any feature. Recommended as
opportunistic cleanup alongside next schema change.

### D5. Client-side Supabase queries → shared hooks (H3)
**Why deferred:** 11 files affected. Purely a maintainability improvement;
no behavior impact. Recommended as opportunistic cleanup.

---

## 6. Success Criteria Status

| Criterion | Status |
|---|---|
| Easier to understand | ✅ Partial (case page cleaner; god modules still exist) |
| Easier to maintain | ✅ Partial |
| Easier to extend | ✅ Partial |
| Core responsibilities separated | 🟡 UI yes; server modules deferred |
| Duplicate logic eliminated | ✅ For UI + naming |
| Case detail page: single coherent presentation | ✅ DONE |
| No architectural complexity increase | ✅ DONE |

---

## 7. Recommended Next Session

Take **D1 (`pipeline.server.ts` split)** as a standalone session with
explicit dry-run gates between each stage extraction. It is the single
highest-leverage cleanup remaining and unblocks D3 and further pipeline
work.
