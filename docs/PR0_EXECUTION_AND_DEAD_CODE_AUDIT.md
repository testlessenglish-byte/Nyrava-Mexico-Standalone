# PR 0 — Full Execution & Dead Code Audit (Nyrava México)

Scope: Mexico platform only. No U.S. app files were read, ported, or referenced in this PR.
Nothing in the "must never change" list was touched: no change to Mexican statutes,
jurisprudence, court/procedural logic, terminology, jurisdiction detection, report
formatting, `src/lib/execution/mx-pipeline.ts`, or `src/lib/jurisdiction/mexico*.ts`.

Method: static reachability analysis over every `.ts`/`.tsx` file in `src`, `tests`,
`scripts`, `patches` (export-by-export, caller-by-caller), plus live inspection of the
production database (`pg_class`, `pg_stat_user_indexes`, `cron.job`).

---

## 1. Execution Path Audit

### 1.1 The single canonical path

```
UI upload (/new → createCaseAndUpload)
  └─ documents inserted + file bytes to storage  [no AI]
       │
       ├─(a) queueCaseForPipeline           → cases.pipeline_queued_at = now()
       │        └─ pg_cron 'nyrava-pipeline-worker' (every minute)
       │             └─ POST /api/public/hooks/pipeline-worker
       │                  ├─ x-worker-secret check (worker_secrets)
       │                  ├─ CAS claim on cases.worker_lease_until
       │                  ├─ checkUserPipelineCapacity → release + defer if over cap
       │                  └─ runPipelineForCase(admin, user_id, {caseId})
       │
       ├─(b) runFullPipelineStep            → assertUserPipelineCapacity → runPipelineForCase
       ├─(c) resumeFullPipelineStep         → active-lease check → requeue → worker
       ├─(d) driveCasePipelineTick          → inline CAS + capacity → runPipelineForCase (one tick)
       └─(e) runFullIntelligenceStep (legacy button) → delegates to runPipelineForCase
```

`runPipelineForCase` (`src/lib/pipeline-runner.server.ts`) is the **only** orchestrator.
It walks `PIPELINE_STAGES` (`src/lib/cases.functions.ts`, 24 entries, fixed order),
resuming cross-tick via `startFrom` (array index). Every stage body is wrapped in
`withHardCheckpointDeadline(min(budgetFor(stage), WORKER_INVOCATION_BUDGET_MS))`.
`jurisdiction_intel` and `legal_qa` additionally sit inside `withStageTimeout`
(`blocking-stage-guard.server.ts`).

Stage → engine implementation:

| # | stage | implementation | LLM? |
|---|---|---|---|
| 1 | extraction | `pipeline.server.runExtraction` | yes |
| 2 | analyzers | `pipeline.server.runAnalyzers` | yes |
| 3 | agents | `pipeline.server.runAgents` | yes |
| 4 | timeline | `canonical-timeline.server` | yes |
| 5 | evidence_map | `evidence-map.server` | **no** (derived) |
| 6 | contradictions | `derived-engines.server` | **no** (derived) |
| 7 | witness | `engines.server.runWitnessEngine` | yes |
| 8 | evidence_intel | `litigation.server.runEvidenceIntelEngine` | yes |
| 9 | jurisdiction_intel | `jurisdiction-intel.server` | yes |
| 10 | procedural_compliance | `procedural-compliance.server` | no |
| 11 | constitutional | `litigation.server` | yes |
| 12 | discovery | `engines.server.runDiscoveryGapEngine` | yes |
| 13 | perspectives | `litigation.server.runPerspectivesEngine` | yes |
| 14 | theories | `engines.server.runTheoryEngine` | yes |
| 15 | opportunities | `engines.server.runOpportunityEngine` | yes |
| 16 | trial_prep | `engines.server.runTrialPrepEngine` | yes |
| 17 | strategy | `litigation.server.runStrategyEngine` | yes |
| 18 | litigation_strategy_center | `litigation.server` | yes |
| 19 | work_product | `engines.server.runWorkProductEngine` | yes |
| 20 | hallucination | `hallucination.server` | yes |
| 21 | scoring | `pipeline.server.runScoring` | yes |
| 22 | legal_qa | `legal-qa.server` | yes (remediation only) |
| 23 | report | `pipeline.server.runReport` | yes |
| 24 | multi_agent | `agents/orchestrator.server` | yes |

### 1.2 Stage-level side doors

`runExtractionStep`, `runAnalyzersStep`, `runAgentsStep`, `runTimelineStep`,
`runScoringStep`, `runReportStep`, `runHallucinationReviewStep`, `runTheoryStep`,
`runOpportunityStep`, `runDiscoveryGapStep`, `runWitnessStep`, `runTrialPrepStep`,
`runWorkProductStep`, `runPerspectivesStep`, `runEvidenceIntelStep`, `runStrategyStep`,
`runContradictionStep` — all funnel through `runLabeledStep`, which now calls
`assertCaseNotLeased` + `assertUserPipelineCapacity` before executing. All are reachable
from the case detail UI (stage buttons). **KEEP.**

### 1.3 Every AI request

100% of model traffic goes through exactly two entry symbols:
`callGroq` (`src/lib/groq.server.ts`, a thin wrapper) and direct `routeAI`
(`legal-qa.server.ts` only). Both land in `routeAI` (`src/lib/ai/router.server.ts`),
which owns provider/key selection, cooldowns, budgets, compression, retries, telemetry
and cost. Call sites: `pipeline.server.ts` (×9), `engines.server.ts` (×6),
`litigation.server.ts` (×4), `chat.server.ts`, `shared-brief.server.ts`,
`motion-draft.server.ts`, `cases.functions.ts` (failover self-test), `legal-qa.server.ts`,
`voice/speak.ts`. **No bypass path exists** — see §4.

### 1.4 Reachable-but-not-linked paths (stated explicitly, not omitted)

| Symbol | Reachable from UI/worker? | Disposition |
|---|---|---|
| `canonical.functions.getCanonicalAnalysis` | no | KEEP — read-only, auth-gated; `canonical_analysis` holds 21 live rows written by the pipeline. |
| `canonical.functions.regenerateCanonical` | no | KEEP — deterministic gate, makes **zero** AI calls; per-case auth-gated. |
| `real-estate.functions.upsertPropertyRecord` | no | KEEP — it is the *only* writer for `property_records` (0 rows). The defect is missing UI wiring, not dead code. Flagged for a follow-up UI PR. |
| `ai-keys.functions.reorderUserAIKey` | no | KEEP — priority reorder for `user_ai_keys`; no execution/AI surface. |
| `casework.functions.setCaseLifecycleStatus` | no | KEEP — single-column update, validated against the materia's allowed lifecycle list. |

None of these can start AI execution, so none of them is an unguarded execution path.

---

## 2. Dead Code Audit

| Item | Evidence | Disposition | Actioned |
|---|---|---|---|
| `engines.server.runFullIntelligence` (116 lines) | zero callers in `src`, `tests`, `scripts`, `patches`; superseded by `runPipelineForCase` | **REMOVE** | ✅ deleted |
| `src/lib/ai/index.ts` — the `AI.generate()` facade (~150 lines) | zero importers anywhere; a second, undocumented route into `routeAI` — exactly the `provider.server.ts` pattern this audit exists to catch | **REMOVE** | ✅ file deleted |
| duplicate cron `nyrava-legal-ingest-daily` (11:00 UTC, pointed at the **preview** URL) | `cron.job` had two ingest jobs; `nyrava-legal-ingest-worker` (every 6h, production URL) is the live one | **REMOVE** | ✅ `cron.unschedule` migration applied |
| unused pipeline variant | none found — one runner only | KEEP (n/a) | — |
| unused background worker | none — `pipeline-worker` and `legal-ingest-worker` are both live and scheduled | KEEP | — |
| unused queue | none — the only queue is `cases.pipeline_queued_at`, drained by the worker | KEEP | — |
| unused server functions | 5, listed in §1.4 | KEEP w/ justification | — |
| file-local exports (~85 constants/helpers exported but only used in their own module, e.g. `STAGE_BUDGET_MS`, `MAX_CONCURRENT_PIPELINES_PER_USER`, `mexicanFederalHolidays`) | referenced internally; several are read by tests | KEEP — removing the `export` keyword is churn with zero runtime effect and would break tests | — |
| unused DB functions | `has_role`, `is_member_of_firm`, `can_contribute_org` and the audit triggers are all referenced by live RLS policies | KEEP | — |

---

## 3. Duplicate Logic Audit

| Suspected duplicate | Finding |
|---|---|
| Witness analyzers | **One.** `runWitnessEngine` (LLM) is the only engine; `algorithms.scoreWitnessCredibility` is a pure deterministic scorer used by the certification suite, not a second analyzer. Mexican role classification (`mx-witness-roles.ts`) is data, not a second engine. |
| Report generators | **One.** `runReport` in `pipeline.server.ts` is the only generator in the codebase (`export ... runReport` matches exactly once). `report-augment`, `report-normalize`, `report-canonical-context`, `report-quality-gate` are post-processors over its output, not alternatives. |
| Extraction / OCR | **One.** `runExtraction` (`pipeline.server.ts`) + `vision.server.ts` for image pages. `realestate/document-detection.ts` classifies *already-extracted* text and issues no AI call. |
| Embedding generation | **None — the feature was never built.** No embedding model call exists anywhere; `chat.server.ts` explicitly documents keyword (not semantic) retrieval. No duplication possible. |
| Token counting | **One.** Sizing lives solely in the router (`PROVIDER_INPUT_TOKEN_BUDGET`, `fitOptsToBudget`) and `packChunks`/`packingCharBudget`. No competing estimator found. |

---

## 4. AI Cost Audit

| Call site | Why it exists | Output used? | Reuse possible? | Cacheable? | Skippable? |
|---|---|---|---|---|---|
| `runExtraction` (per document, + vision retry) | turns PDFs/images into text | yes — every downstream stage reads it | no | yes, and it is: content-hash dedupe on `documents` prevents re-extraction | no |
| `runAnalyzers` (per chunk) | produces `case_findings` | yes — the spine of the report | no | in-process exact-match cache in router | no |
| `runAgents` (batched) | `agent_findings` | yes | no | batch-level checkpointing avoids re-running completed batches | no |
| `timeline` | `case_timeline_events` | yes (report + UI) | partially — derived from findings | yes | candidate |
| `evidence_map`, `contradictions`, `procedural_compliance` | derived | yes | n/a | **free — no AI call** | n/a |
| `witness` | `case_witnesses` | yes | no | yes | **YES — PR 3** (skip when corpus has no witness-relevant findings) |
| `evidence_intel` | evidence strength | yes | overlaps analyzers' evidence tags | yes | candidate |
| `jurisdiction_intel` | Mexican jurisdiction/competencia intel (blocking) | yes — report depends on it | no | yes, per (state, materia) | no |
| `constitutional` | amparo/CPEUM issues | yes | no | yes | **YES — PR 3** |
| `discovery` | missing-evidence gaps | yes | overlaps analyzers' missing-evidence findings | yes | **YES — PR 3** |
| `perspectives` | `case_perspectives` | yes | no | no | by materia only |
| `theories`, `opportunities`, `trial_prep`, `strategy`, `litigation_strategy_center`, `work_product` | Tier 2/3 enrichment | yes, in the case UI; **not** required by the report DAG | strategy reuses theories | no | by materia (already) |
| `hallucination` | verifies findings | yes — gates release | no | no | no |
| `scoring` | `case_scores` (blocking) | yes | no | no | no |
| `legal_qa` | language/QA gate + translation remediation | yes — blocks report | n/a | remediation only fires on violations | already conditional |
| `report` | the deliverable | yes | n/a | no | no |
| `multi_agent` | 13-agent review after report | yes (UI) | no | no | optional by plan |
| `chat.server` (Talk-to-Case) | interactive | yes | n/a | context cached | n/a |
| `motion-draft`, `shared-brief`, `voice/speak` | user-initiated, one call each | yes | n/a | no | n/a |
| `cases.functions` failover self-test | admin "test failover" button | diagnostic only, discarded by design | n/a | no | admin-triggered only |

No call site was found whose output is written nowhere and read by nobody.

---

## 5. Dependency Audit

`canonical.ts`'s `dependsOn` graph, cross-checked against runtime order in
`PIPELINE_STAGES`:

- **Blocking (report cannot exist without them):** `extraction → analyzers → agents →
  jurisdiction_intel`, `scoring`, `legal_qa`, `report`.
- **Enriching:** `timeline`, `evidence_map`, `contradictions`, `witness`,
  `evidence_intel`, `procedural_compliance`, `constitutional`, `discovery`,
  `perspectives`, `hallucination`.
- **Optional / Tier 3:** `theories`, `opportunities`, `trial_prep`, `strategy`,
  `litigation_strategy_center`, `work_product`, `multi_agent`.
- **Safely parallelizable in principle:** `timeline` ∥ `witness` (both depend only on
  extraction/analyzers and touch disjoint tables). `evidence_map` and `contradictions`
  are free, so parallelizing them buys nothing.

**Mismatch found (one, and it is the whole premise of PR 4):** the DAG says `report`
depends only on `[scoring, legal_qa, analyzers, agents, jurisdiction_intel]`, but the
runner executes a fixed array in which `report` is 23rd of 24 — so it waits on 7
non-blocking Tier 2/3 stages that the DAG explicitly does not require. Documented here,
**not fixed in PR 0** (PR 4 owns it, behind `PIPELINE_EARLY_REPORT`).

No other mismatch: every stage's array position is ≥ the position of all its declared
dependencies, so the sequential order never violates the DAG.

---

## 6. Background Process Audit

| Process | Guarded by | Verdict |
|---|---|---|
| `pg_cron nyrava-pipeline-worker` (1 min) | secret header → CAS lease → `checkUserPipelineCapacity` → release-on-error | OK |
| `pg_cron nyrava-legal-ingest-worker` (6 h) | secret header; touches `legal_*` corpus only, never a case | OK |
| ~~`pg_cron nyrava-legal-ingest-daily`~~ | duplicate of the above, preview URL | **REMOVED** |
| `/api/public/hooks/stripe-webhook` | Stripe signature verify; no AI, no case execution | OK |
| `driveCasePipelineTick` (browser-driven) | inline CAS + capacity | OK |
| `uploadVerificationDocument` background extraction | `getActiveCaseLease` + capacity, defers otherwise | OK |
| Realtime subscriptions | read-only UI subscriptions; cannot start work | OK |

No entry point can launch duplicate work on one case.

---

## 7. Database Audit

- **Orphaned tables (0 rows AND 0 code references) — 11:** `authority_relationships`,
  `billing_payments`, `citation_cache`, `legal_amendments`, `legal_citations`,
  `legal_keyword_links`, `matter_events`, `matter_notes`, `matter_tasks`,
  `org_role_permissions`, `plan_entitlements`.
  **Disposition: ARCHIVE-in-place (KEEP the DDL, do not drop).** Justification: every one
  of them is empty, RLS-enabled, and costs nothing at runtime; several (`matter_*`,
  `org_*`, `plan_entitlements`) belong to the multi-tenant/matter feature set that is
  built and shipped in the schema but not yet surfaced in the UI. Dropping them is a
  destructive, irreversible change with no performance or cost upside, which is a worse
  trade than leaving them declared. They are recorded here so they are no longer
  "forgotten".
- **Duplicate logging paths — found and dispositioned:** three audit tables exist —
  `admin_audit_log` (64 rows, live, written by `audit.server.ts`), `audit_log` (0 rows,
  1 stray reference), `audit_logs` (0 rows). `admin_audit_log` is the single live path.
  The other two are empty legacy leftovers → same ARCHIVE-in-place disposition as above.
  There is exactly **one** pipeline telemetry path (`pipeline_trace`, 17,261 rows) and one
  per-engine ledger (`pipeline_engine_runs`, 1,127 rows) — no duplication.
- **Unused indexes:** `idx_scan = 0` on ~60 indexes, but nearly all of them are on tables
  with 0 rows, and this database has never carried production read volume. **KEEP** — the
  statistic is not evidence on a pre-launch dataset. Re-check after 30 days of real
  traffic.
- **Triggers:** all `public` triggers resolve to live functions (`updated_at` stamps,
  audit writes, role checks). No orphans.

---

## 8. Production Readiness Certification

- [x] **No duplicate execution paths** — one orchestrator (`runPipelineForCase`); all five entry points delegate to it.
- [x] **No unused engines still executing in production** — `runFullIntelligence` removed; nothing else was unreferenced.
- [x] **No hidden or bypassed AI provider calls** — every call reaches `routeAI`; the unused `AI` facade was deleted; `rg "ai.gateway.lovable|LOVABLE_API_KEY" src` returns nothing but historical comments.
- [x] **No orphaned workers** — 2 cron jobs remain, both live and secret-gated; the duplicate ingest job was unscheduled.
- [x] **No duplicate report generators** — `runReport` is the only one.
- [x] **No unnecessary/unused AI calls** — §4 found no discarded output; three genuinely skippable calls are queued for PR 3.
- [x] **No infinite or unbounded retry loops** — `MAX_LOGICAL_PROVIDER_ATTEMPTS`, `MAX_STAGE_CHECKPOINTS = 5`, `MAX_REPORT_CHECKPOINTS = 4`, ≤3 cooldown waits (≤95 s) all bound the run.
- [x] **No pipeline stage can hang indefinitely** — every stage is inside `withHardCheckpointDeadline(min(budgetFor(stage), 42 s))`; the two blocking stages have an additional inner ceiling (whose real-world reachability is PR 1 step 4's question).
- [x] **Every stage is observable** — `pipeline_trace` + `pipeline_engine_runs` + `[lease]`/`[stage]` structured console lines.
- [x] **Every AI dollar produces used output** — the one exception is the admin-only failover self-test, which is diagnostic by design.

---

## Sign-off

**Diff, scoped to the files named in this PR:**
- `src/lib/intelligence/engines.server.ts` — deleted `runFullIntelligence` and its header comment (lines 1538–1657; 1657 → 1537 lines). No other symbol touched.
- `src/lib/ai/index.ts` — file deleted (unused `AI.generate` facade).
- Database migration — `select cron.unschedule('nyrava-legal-ingest-daily')`.
- `docs/PR0_EXECUTION_AND_DEAD_CODE_AUDIT.md` — this report (new file).

**Verification:** `tsgo --noEmit` passes clean after the removals; the deleted symbols had
zero importers, so no runtime path changed. No case execution behaviour was modified in
this PR, which is why no new `pipeline_trace` run is attached — PR 1 step 2 owns the
end-to-end trace, and it should be run against this post-removal build.

**"Must never change" confirmation:** no file under `src/lib/jurisdiction/`,
`src/lib/execution/mx-pipeline.ts`, `src/lib/intelligence/mx-*`, `case-type-standards.ts`,
`practice-areas.ts`, `report-i18n.ts`, or `mexico-lock.ts` was modified. No statute,
tesis, terminology, jurisdiction-detection or report-formatting logic was touched.

**Open items handed to later PRs (not silently dropped):**
1. `report` waits on 7 stages the DAG does not require → PR 4.
2. `witness` / `constitutional` / `discovery` are skippable on data presence → PR 3.
3. The `jurisdiction_intel` / `legal_qa` inner 120 s / 480 s ceilings sit under a 42 s
   outer clamp and may be unreachable → PR 1 step 4 must resolve this, not leave it.
4. `upsertPropertyRecord` has no UI caller, so `property_records` can never be populated
   → product/UI follow-up, outside this spec.
5. `PIPELINE_STAGES` still labels stage 16 "Trial Prep & Jury Simulation" — a U.S.-era
   label (the engine itself was already Mexicanised). Label-only, no logic; flagged for
   the i18n/terminology owner rather than changed here.
