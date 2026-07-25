# Nyrava Production Baseline (Frozen)

This document is the single source of truth for the analysis pipeline contract.
Any deviation requires an explicit baseline-update commit.

## 1. Canonical Pipeline Order (19 stages)

Defined in `src/lib/cases.functions.ts` → `PIPELINE_STAGES`. Stages execute
sequentially; each must complete before the next begins.

1. `extraction` — Document text + entity extraction
2. `analyzers` — Domain analyzers (legal issues, anomalies, contradictions surface)
3. `agents` — Practice-area agents (per `practice_area`)
4. `timeline` — Build Timeline
5. `evidence_map` — Evidence Mapping (derived)
6. `contradictions` — Contradiction Analysis
7. `witness` → engine `witness_intelligence`
8. `evidence_intel` → engine `evidence_intelligence`
9. `constitutional` → engine `constitutional_compliance` (derived)
10. `discovery` → engine `discovery_gaps`
11. `perspectives`
12. `theories` → engine `theory`
13. `opportunities` → engine `opportunity`
14. `trial_prep`
15. `strategy`
16. `work_product`
17. `hallucination`
18. `scoring`
19. `report` → engine `report_generator`

Stage-to-engine mapping is the matching table in
`src/lib/execution-state.ts` → `PIPELINE_STAGE_TO_ENGINE`. The two must stay
in lockstep.

## 2. Fatal vs Non-Fatal Stages

`FATAL_STAGES` (orchestrator aborts on failure):

- `extraction`
- `analyzers`
- `agents`

Every other stage is non-fatal: a failure is recorded in `pipeline_engine_runs`
and the run continues so the report can still be generated.

`REPORT_BLOCKING_ENGINES` in `src/lib/execution-state.ts` controls which engines
the report generator refuses to skip (currently extraction, analyzers, agents,
scoring). Adjust that constant — not ad-hoc gates in callers — when changing the
report contract.

## 3. Determinism

Every multi-row `documents` read used as LLM grounding orders by
`created_at ASC`. This is enforced in:

- `src/lib/pipeline.server.ts` (all extraction + analyzer reads)
- `src/lib/intelligence/engines.server.ts`
- `src/lib/intelligence/litigation.server.ts`
- `src/lib/intelligence/contradictions.server.ts`
- `src/lib/intelligence/extract.server.ts`
- `src/lib/intelligence/chat.server.ts`

Result: identical input documents produce identical engine prompts and therefore
identical engine outputs (modulo provider non-determinism, which is mitigated by
temperature settings in `src/lib/groq.server.ts`).

## 4. Large-Case Optimization

- **Sequential execution** — orchestrator runs stages one at a time (no parallel
  engine fan-out at the orchestrator layer). Per-document loops inside
  extraction are sequential to respect provider rate limits.
- **Checkpointing** — every stage write goes through
  `runEngine()` in `src/lib/intelligence/engine-audit.server.ts`, which inserts
  a `pipeline_engine_runs` row keyed by `(case_id, engine)`.
- **Resume** — `resumeFullPipelineStep` server fn (in
  `src/lib/cases.functions.ts`) walks `PIPELINE_STAGES` in order, finds the
  first stage whose engine is not `completed`, and calls
  `runFullPipelineStep({ startFrom })`. No completed engine is re-run.
- **Per-document retry** — `extraction_retry_count` + `last_extraction_attempt_at`
  on `documents` support `runExtractionRetry`, capped at 3 attempts per doc.

## 5. Environment

Supabase env is read from `.env` at dev-server boot. Required keys:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- Server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

If the app reports "Missing Supabase env", restart the dev server — Vite caches
env values per process.

## 6. Freeze Policy

The contracts above are frozen. To change them:

1. Update this document in the same commit as the code change.
2. Update `PIPELINE_STAGES` and `PIPELINE_STAGE_TO_ENGINE` together.
3. Re-run the certification test
   (`src/lib/intelligence/__tests__/certification/execution-framework.test.ts`)
   and update expected values.
