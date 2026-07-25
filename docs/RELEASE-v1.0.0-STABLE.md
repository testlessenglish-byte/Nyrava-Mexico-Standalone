# Nyrava Intelligence OS™ — v1.0.0-STABLE

**Tag**: `v1.0.0-STABLE`
**Date**: 2026-06-30
**Status**: Platform Freeze — production baseline.

## Scope of the freeze

All Phase 1 directives have shipped and are locked behind validation gates:

| Subsystem | Module(s) | Locked behavior |
| --- | --- | --- |
| Immutable version history | `report_versions` table + `report-version.server.ts` | UPDATE/DELETE revoked from `authenticated`; SHA-256 canonical hash recorded per snapshot. |
| Quality Gate | `pipeline.server.ts` | Report flagged `quality_blocked` when ≥3 findings exist and any lack full citation, or any OCR failure. |
| "What's Changed" engine | `cases.functions.ts` `finalizeReportChangeLog` | Diffs persisted `change_log` between adjacent versions. |
| Evidence Map 2.0 | `evidence-map.server.ts` | Deterministic per-document classification + OCR coverage + report-quality audit. |
| Canonical Timeline | `canonical-timeline.server.ts` | Single chronology merged from analyzers + dated findings, dedup + provenance. |
| Image Intelligence (Vision) | `vision.server.ts` + image branch of `runExtractionStep` | Structured `vision` descriptor (parties, dates, amounts, signatures, kind, confidence) attached to image documents. |
| Cross-Document Graph | `document-graph.server.ts` | Entity/date overlap graph across documents, written into `full_report.cross_document_graph`. |
| Practice-area isolation | `practice-areas.ts` + analyzer gates | Engines run only when applicable; skipped engines render "Not Applicable" in the UI. |
| Hallucination governance | `claim-class.ts`, `sufficiency.server.ts`, `work-product-verify.server.ts` | Minimal ESS suppresses scores + motions; work-product figures verified against corpus index. |

## Validation Suite

Runs under `bunx vitest run`:

- `src/lib/intelligence/__tests__/certification/*` — execution framework, benchmarks, governance, red-team, performance, concurrency, recovery, security, provider determinism.
- `src/lib/intelligence/__tests__/parity.test.ts` — canonical signature parity across 8 fixture archetypes.
- `src/lib/intelligence/__tests__/ess.test.ts` — minimal-ESS suppression.
- `src/lib/intelligence/__tests__/hallucination.test.ts`, `release-gate.test.ts`, `work-product-verify.test.ts`, `algorithms.test.ts`, `canonical-id.test.ts`, `canonical-scoring.test.ts`, `acceptance.test.ts`.
- `src/lib/intelligence/__tests__/vision-graph.test.ts` (new) — vision descriptor + report-hash determinism.

## Baseline invariants (do not regress without a new release)

1. `report_versions` rows are append-only from the app role.
2. Every report run produces exactly one new immutable snapshot with a SHA-256 `report_hash`.
3. Minimal ESS ⇒ scores `null` and motions `[]` on every canonical reader.
4. Document ordering for extraction is `created_at ASC` everywhere.
5. Canonical timeline is the only chronology surfaced in the report; analyzer-only timelines are no longer emitted.
6. Quality Gate must pass before a report is considered shippable; failure surfaces `quality_blocked = true` with reasons.

## Release notes

- Adds Vision Pipeline descriptor and Cross-Document Graph to `full_report`.
- Adds vitest coverage for vision classification and report-hash canonicalization.
- No schema changes since Batch 1; this freeze is a code + docs lock.
