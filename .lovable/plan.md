> **Revision 3 — approved, re-issued unchanged for implementation.** Execution order is fixed: **Migration → Phase 1/2 → Parity validation → Phase 4 flag rollout.** No reordering, combining, or skipping. If a phase's verification fails, work stops on that phase until it passes.

## Standing requirements (every phase)

1. Report back with the **actual diff**, scoped only to the files named for that phase — not a summary.
2. Report the **specific test cases run and their results**. Phase 2 additionally reports measured checkpoint counts and wall-clock numbers on Proyecto Faro, before and after.
3. Confirm explicitly that the **must-never-change list** was not touched: Mexican statutes, jurisprudence, terminology, jurisdiction detection, report formatting, and everything under `execution/`, `mx-pipeline.ts`, `jurisdiction/mexico*.ts`, `case-type-standards.ts`, `practice-areas.ts`, `mexico-lock.ts`.
4. Phase 4 stays behind `CANONICAL_REPORT_ENABLED`, default off, until the parity harness on the Amparo case passes.

---

# Settled clarifications

## 1. `finding_status` lifecycle

Orthogonal to the existing `verification_status` column, which is not touched.

| State | Meaning |
|---|---|
| `candidate` | Persisted by an engine; never evaluated by the canonical gate. Default for new and historical rows. |
| `verified` | Gate evaluated it and grounding passed: ≥1 citation with `{documentId, page, quote}` all present, no deterministic-stage contradiction. A statement about the finding in isolation. |
| `disputed` | Gate found a conflict, or `verification_status='demoted_unsupported'`. |
| `suppressed` | Gate deliberately excluded it — dedupe loser, below rank cutoff, or evidence-gated. Excluded, not deleted. |
| `promoted` | Verified **and** selected into the canonical report for this run. A statement about the report. |

*Verified but not promoted (Amparo):* "el informe justificado se rindió el 14 de marzo" is fully cited and uncontradicted → `verified`; ranks 41st of 79 and falls below the cutoff → stays `verified`, visible in the repository and workspace, absent from the report body.
*Promoted:* "la autoridad responsable omitió notificar el acuerdo de suspensión al quejoso" — fully cited, corroborated by `procedural_compliance`, top-10 → `promoted` and rendered.

**Reversibility.** `finding_status` is a per-run derived state, always recomputed by the gate from persisted evidence; never a manual attorney field. No state is terminal — `disputed` can become `promoted` when later evidence resolves the conflict; `suppressed` is un-suppressed when a later run ranks it in. Only `candidate` is never re-entered, because "never evaluated" cannot become true again. A full case reset deletes rows outright, so that path is not a transition.

| From → | candidate | verified | disputed | suppressed | promoted |
|---|---|---|---|---|---|
| **candidate** | — | grounding passes | conflict / `demoted_unsupported` | dedupe loser, below cutoff, evidence gate | grounding passes **and** ranked in |
| **verified** | never | re-run, still passes | new conflicting evidence | dedupe loser or drops below cutoff | ranked into report |
| **disputed** | never | conflict resolved | re-run, still conflicting | excluded from report | resolved **and** ranked in |
| **suppressed** | never | no longer dedupe loser, grounding passes | conflict found | re-run, still excluded | re-ranked in |
| **promoted** | never | still grounded, dropped from report | new conflicting evidence | excluded on re-run | re-run, still in report |

Every transition has exactly one trigger: a canonical gate execution. A test asserts `finding_status` is written only from `src/lib/canonical/*`.

## 2. Projection idempotency — database-level, race-safe

Application-level check-then-upsert is rejected. Idempotency comes from a unique index over generated columns, so two concurrent workers cannot both insert.

```sql
ALTER TABLE public.case_findings
  ADD COLUMN projected_from_table text
    GENERATED ALWAYS AS (metadata #>> '{projected_from,table}') STORED,
  ADD COLUMN projected_from_row_id text
    GENERATED ALWAYS AS (metadata #>> '{projected_from,row_id}') STORED;

CREATE UNIQUE INDEX case_findings_projection_identity_uidx
  ON public.case_findings (case_id, projected_from_table, projected_from_row_id)
  WHERE projected_from_table IS NOT NULL;
```

The index is **partial**: native `addFindings` rows have no `projected_from` key, both generated columns are NULL, and the index ignores them — zero impact on existing inserts, and the migration cannot fail on existing data (verified: `case_findings` has only `case_findings_pkey`, no unique constraints to conflict with).

One batched statement per engine execution:

```sql
INSERT INTO public.case_findings (case_id, user_id, source_module, ..., metadata)
VALUES (...), (...), (...)
ON CONFLICT (case_id, projected_from_table, projected_from_row_id)
  WHERE projected_from_table IS NOT NULL
DO UPDATE SET
  title = EXCLUDED.title, description = EXCLUDED.description,
  severity = EXCLUDED.severity, confidence = EXCLUDED.confidence,
  supporting_engines = EXCLUDED.supporting_engines,
  metadata = EXCLUDED.metadata, updated_at = now();
```

Under racing worker ticks one insert takes the index tuple lock; the second blocks then resolves to `DO UPDATE` on the same row. At most one row per `(case_id, table, row_id)`; last-writer-wins on content is correct because both writers project the same source row. `finding_status` is deliberately **excluded** from the update set — re-projection must not reset a status the gate earned. `user_id` is written from the case-owner lookup, never the admin session (the `canonical_analysis` RLS bug class). Because PostgREST cannot express a partial-index conflict target, projection runs through a SECURITY DEFINER RPC issuing exactly this statement, called once per engine execution.

## 3. Report reproducibility via existing `canonical_analysis.version`

No new versioning mechanism. Verified: `canonical_analysis.version integer NOT NULL default 1`, auto-bumped by `bump_canonical_version`; `public.reports` has `version` and `intelligence_version` but **no** column recording the canonical version it was built from; `report_versions` snapshots are already immutable (REVOKE UPDATE/DELETE) with a `report_hash`.

```sql
ALTER TABLE public.reports ADD COLUMN canonical_version integer;
ALTER TABLE public.report_versions ADD COLUMN canonical_version integer;
```

Phase 4 reads `canonical_analysis` once, captures `row.version` with `row.analysis_payload`, renders from that in-memory payload, and writes the integer into `reports.canonical_version`. The immutable snapshot records the same integer, and `computeReportHash` gains `canonical_version` so the hash binds content to canonical version.

**No silent drift:** a rerun bumps `canonical_analysis.version` but cannot touch the written `reports.canonical_version`, the snapshot, or its hash — the prior report stays byte-identical and auditable. When current canonical version > a displayed report's, the header shows "generado a partir de la versión canónica N; existe un análisis más reciente (versión M)" rather than quietly re-rendering. Regeneration is an explicit attorney action producing a new report row and snapshot. Test: generate at v1 → rerun gate to v2 → assert original row still `canonical_version = 1`, `report_hash` unchanged, rendered output identical.

---

# Implementation

## Migration (first)

Single file: `ADD COLUMN` × 5 on `case_findings` (`finding_status` NOT NULL default `'candidate'`, `supporting_engines text[] default '{}'`, `evidence_strength numeric`, `citation_quality numeric`, `authority_level smallint default 1`), the 2 generated projection-identity columns, and `canonical_version` on `reports` / `report_versions`. CHECK constraints on `finding_status` and `authority_level`; partial index on `(case_id, finding_status)`; GIN on `supporting_engines`; the unique projection-identity index; the SECURITY DEFINER projection RPC. No drops, renames, policy or trigger changes — existing owner-scoped RLS covers new columns. `confidence_score` is not added (existing `confidence` reused); `verification_status` untouched.

**Backfill is provenance-honest.** Existing rows are **not** set to `promoted`. All take `candidate`, except `verification_status='demoted_unsupported'` → `disputed`. Promotion is only ever earned through gate evaluation. A separate opt-in, admin-triggered historical replay job (one case at a time, read-only over persisted engine output, zero AI calls) can push past cases through the gate later — not part of the migration. Phase 4 is flagged off at migration time, so historical cases render exactly as today.

## Phase 1 — Safety layer, no behavior change

New pure module `src/lib/intelligence/finding-selection.ts`: `selectFindings()` (wrapping the existing `getCanonicalScoringFindings` prefix rules so scoring and UI cannot diverge), `getFindingMetrics()`, `getFindingConsensus()`. Callers switched with no logic change: `agents/statistics.server.ts` (`promoted`/`suppressed`, ~228–290), `cases.$caseId.tsx` badges, `intelligence/canonical.ts` counters, `export.ts`. Snapshot test on the Amparo case asserts identical numbers before/after. `source_module` semantics stay frozen (17 confirmed consumers incl. `scoring-selection.ts`'s prefix filter); `supporting_engines[]` is additive.

## Phase 2 — Batched, checkpoint-safe projection

New `src/lib/intelligence/project-findings.server.ts`, one adapter per specialized table. `agent_findings`, `case_opportunities`, `case_witnesses`, `case_perspectives`, `case_theories`, `case_strategy`, `case_work_product` remain **permanently authoritative** for their engines; no existing reader migrates off them.

- Called once per engine execution **after persistence** — in `runVerifiedEngine` (`engine-persistence.server.ts`) after `verifyPersistence` succeeds, and once per agent batch in `orchestrator.server.ts`. No engine's `fn()` is modified; no projection write inside an engine loop.
- One batched RPC call per engine execution, never one write per finding.
- Projection failure is non-fatal and logged: never fails an engine whose raw rows persisted, never triggers a stage retry.
- **Measured before merge** on Proyecto Faro penal (20 documents): added wall-clock per stage under 500 ms, no change in `pipeline_engine_runs` retry counts, no change in checkpoint counts against `MAX_STAGE_CHECKPOINTS` (5, `pipeline-runner.server.ts:139`) or `MAX_REPORT_CHECKPOINTS` (4). Before/after numbers reported with the diff. Checkpoint deadline logic untouched.

## Parity validation (before Phase 4)

Harness comparing current visible findings vs new canonical findings on the Amparo case: per-badge counts, per-engine attribution, and a trace assertion that every displayed finding resolves finding → source engine → evidence → citation/authority status. Phase 4 does not roll out until this passes.

## Phase 3 — Canonical gate becomes mandatory

- `citation-quality.server.ts`: add Spanish conclusion verbs (`constituye`, `acredita`, `viola`, `vulnera`, `demuestra`, `es responsable`) and Spanish demotion phrasing selected by report language — currently English-only regexes that never fire on a Spanish report and would inject English if they did.
- New `canonical/consensus.server.ts`: agreement scoring where a deterministic stage (`jurisdiction_intel`, `procedural_compliance`) agreeing with an LLM finding outweighs two LLM stages agreeing with each other. Writes `supporting_engines[]`, `evidence_strength`, and the `finding_status` transitions above.
- `gate.server.ts`: consensus inserted between dedupe (step 3) and ranking (step 4); `findings-rank.server.ts` consumes agreement weight and performs the `promoted` transition.
- Wording is "identificado por N etapas del pipeline" / "identified by N pipeline stages" — never "independently verified"; enforced as a lint rule beside the QA agent's language-drift check.
- Test: zero `routeAI` invocations during `runCanonicalGate`.

## Phase 4 — Report reads canonical_analysis (flagged)

- Report stage's raw-table gather (`pipeline.server.ts` ~3814–3827) and `export.ts` read persisted `canonical_analysis.analysis_payload`, capturing `version` per clarification 3.
- Rollout uses the existing env-var pattern (`process.env.PIPELINE_MAX_CONCURRENT`, `pipeline-lease.server.ts:37`): new `CANONICAL_REPORT_ENABLED`, default off. No new rollout system.
- **Raw-table fallback is itself flagged and instrumented — temporary migration support, not a permanent second reporting path.** Each fallback emits a `pipeline_trace` row (`phase: "report"`, `step: "canonical_fallback"`) with case id and reason. Fallback removal is a tracked follow-up gated on that query returning zero.

## Rollback, recovery, tenant isolation

- **Rollback:** all columns additive; disabling `CANONICAL_REPORT_ENABLED` restores today's report path with no data change. A down-migration dropping the new columns and indexes ships with the PR.
- **Recovery:** single-transaction migration, no data rewrite beyond the two-value backfill; a failed apply leaves the table untouched. Projection is idempotent at the database level, so a partial run is re-runnable without duplicates.
- **Tenant isolation tests:** User A cannot select/update/delete User B's projected row through the user-scoped client; admin projection/backfill writes `user_id` = case owner and the owner reads every projected row; the replay job never reassigns `user_id`; no projected row's `case_id`/`user_id` disagrees with the `cases` row.
