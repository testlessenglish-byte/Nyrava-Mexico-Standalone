# Nyrava Architecture

This document is the single source of truth for how the system executes. If
code disagrees with this document, the code is wrong.

## 1. Execution State — Single Source of Truth

All execution state lives in **two tables**:

| Table | Purpose |
| --- | --- |
| `pipeline_engine_runs` | Authoritative per-engine status (queued → running → completed/failed/skipped). One row per engine execution. |
| `pipeline_events` | Append-only event stream for the activity feed (queued, started, progress, completed, failed). |

Every UI surface — Command Center, Dashboard, Pipeline Panel, Engine Cards,
Activity Feed, Progress Bars, Reports — reads from these two tables (live via
Supabase realtime). No component computes completion locally. The mapping from
pipeline stage to canonical engine id lives in
`src/lib/execution-state.ts::PIPELINE_STAGE_TO_ENGINE`.

## 2. Engine Registry

Canonical engine identifiers (used everywhere — backend, frontend, DB,
reports, audit trail):

```
extraction, analyzers, agents, timeline, evidence_map, contradictions,
witness_intelligence, evidence_intelligence, constitutional_compliance,
discovery_gaps, perspectives, theory, opportunity, trial_prep, strategy,
work_product, hallucination, scoring, report_generator
```

There are **no** alternate spellings (`analyzer_contradictions`,
`ContradictionEngine`, etc.).

## 3. Engine Lifecycle Wrapper

Every engine runs through `runEngine()` in
`src/lib/intelligence/engine-audit.server.ts`:

```
queued → running → (progress events) → completed | failed → persist → emit
```

No engine writes its own status. No engine bypasses the wrapper.

## 4. AI Provider Router

`src/lib/ai/router.server.ts` is the only path to any model. It reads
`ai_providers` (priority-ordered), honors per-task pins from
`ai_task_routing`, and accepts runtime per-user Groq keys. On failure it
records to `_state` + stamps `ai_providers.last_error_at` and falls through
to the next provider.

- Groq is pinned via `ai_providers` priority + `ai_task_routing`.
- Runtime user-supplied Groq keys form a Groq-only chain (no silent
  provider switch).
- Every call is logged to `ai_usage` (provider, model, tokens, latency,
  success).

## 5. Pre-Flight Report Validation Gate

`_runReportInner` checks `pipeline_engine_runs` for all required upstream
engines before generating a report. If any are missing or failed it throws:

> Pipeline incomplete — cannot generate report. Missing or failed engines: …

This prevents the "report complete / dashboard pending" desync class.

## 6. Evidence Gating & Sanitization

- Findings without `{document, page, quote, confidence}` are suppressed via
  `addGatedFindings` (`evidence-gate.server.ts`).
- Contradictions require both Statement A and Statement B with citations;
  otherwise classified as `needs_corroboration` /
  `possible_inconsistency` (`dispute-classifier.server.ts`).
- PDF/DOCX renderers never emit raw JSON — list rendering falls back to
  `text|title|summary|description|argument|action` and drops empty entries.
- UUIDs/internal ids are not surfaced; documents render as filename + page.

## 7. Canonical Counts

All UI counts go through `src/lib/intelligence/canonical.ts`. The
`paritySignature(report)` string lets any two surfaces verify they agree.

## 8. Caching & Idempotency

- Document content hashes (`src/lib/hash.server.ts`) gate re-extraction.
- The router has an in-process completion cache keyed by
  `(model, system, user, json, temp)`.
- `runReport` clears only the report-tier engine runs before re-running, so
  upstream engines are not re-executed.

## 9. Failure Semantics

- Engine failures persist to `pipeline_engine_runs.status = 'failed'` with
  `error_message`, and emit a `failed` event.
- Report generation aborts on the validation gate; the case status reflects
  the gate message.
- The router throws a single aggregated error listing every provider that
  failed in the chain.

## 10. Case-Type Execution Framework

`src/lib/intelligence/practice-areas.ts` is the single source of truth for
which analyzers, finding modules, motion families, terminology, report
sections, and workspace tabs each practice area may execute or render.

- The active case `case_type` is the base policy.
- `cross-domain.server.ts` may widen the policy through exactly three
  audited paths: explicit user opt-in (`cases.additional_domains`), a
  formally registered hybrid case type, or a deterministic evidence
  trigger (≥ N findings of a declared module). Every activation is
  written to `case_domain_activations` with `source`, `trigger_id`,
  `reason`, and `evidence_finding_ids`.
- Practice-restricted engines (`constitutional_compliance`, `trial_prep`,
  `cross_examination`) are short-circuited at the runner level when not
  allowed, recorded in `pipeline_engine_runs` as `status='skipped'` with
  `skipped_reason='not_applicable_to_case_type'`.
- `findings.server.ts::addFindings` runs a final policy filter so a
  forbidden module can never reach `case_findings` even if an engine
  produced it.
- `export.ts::computeRenderQueue` reads `full_report.active_domains` and
  filters PDF / DOCX sections through the same registry — output parity
  with the UI is guaranteed.

## 11. Acceptance Tests

Regression suite lives in `src/lib/intelligence/__tests__/`. It exercises
the engine registry, evidence gate, contradiction classifier, ESS
suppression, parity signature, and (in `__tests__/case_type/`) the
case-type execution policy + cross-domain activation rules. No
deployment without this suite green.

