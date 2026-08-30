# Final render validation and release consistency

Base: upstream 872f9facd90ccfa36fbfc4ac697badb6d76ea45b.

## Root causes
- The old final validator recognized selected field names but not likely_outcome, remedy_sought, probability headings or future-strategy prose.
- Constitutional PDF rendering generated probability/remedy labels after validation. Evidence gaps and legacy prose also bypassed the main finding-action restrictions.
- Final review selected only case_id/full_report, excluding report columns and quality_blocked, and did not consult qa_statuses.
- The manifest audit and authoritative release decision shared release_gate; independent QA retained a stale FAIL while final review overwrote that object with PASS.
- Penal QA rejected the valid shared PropositionType "holding". ADR's neutral, adopted SCJN holdings were schema aliases, not evidence of corruption. Adopted party arguments and unmapped non-neutral effects still fail.
- Completed-case audit ran after release. It now runs before final validation without changing its analysis logic.

## Changes
- final-report-contract.ts: existing composer/validator now checks structured classes plus recursive text/field safety checks across all sections. It reports violation paths and inspected node counts, preserves source quotations, and freezes approved payloads.
- report-content-policy.ts: display-only suppression and corpus-safe wording; sourced historical remedies require explicit tags.
- export.ts / export-legal-memo.ts / rendered-output.ts: capture actual PDF output strings including tables, labels, appendices and footers; validate actual packed DOCX XML before saving. Backend preflight uses the same real renderers without publishing files.
- final-report-inputs.server.ts: load auxiliary report inputs; read errors block release.
- final-release-decision.ts: one release calculation. Explicit blocking FAILs and quality blocks cannot be overridden; documented informational audits become WARN_NON_BLOCKING.
- penal-qa-status.ts: accept the shared holding alias while preserving semantic corruption checks.
- orchestrator.server.ts: fetch the complete current report, preflight all sections, resolve release once, and use an atomic database write. Legacy direct release delegates here.
- pipeline.server.ts: persist the sanitized report projection, separate manifest_audit, and move the completed-case audit ahead of release.
- attorney-workproduct.ts / reports.tsx: corpus-safe pending-document wording; no raw report fallback after contract failure.
- 20260830070000_authoritative_report_release.sql: one transaction for report and case mirrors, execution/report freshness checks, blocking-QA invariant, and rollback on either write failure.

## Before / after
- ESTIMACIÓN DE PROBABILIDAD + likely_outcome: removed in LIMITED.
- Active REMEDIO SOLICITADO: suppressed; explicitly sourced HISTORICAL_REMEDY may appear under a historical label.
- Futuras acciones legales: neutral corpus/record verification.
- No obra en el expediente: No identificada en el corpus aportado, unless absence is verified.
- Source quotations saying no existe remain quotations; source-supported factual statements are explicitly attributed.
- release_readiness FAIL from manifest drift: WARN_NON_BLOCKING.
- True blocking QA FAIL: BLOCKED, never released.

## Verification
- 30 targeted hardening tests pass, covering A–G, all 19 section injection locations, template-created PDF labels, packed DOCX text, and a real saved ADR 3265/2023 JSON replay.
- Broader run: 156 tests pass, 1 replay skipped when its private input environment variable is absent. The replay was separately run successfully.
- 9 PostgreSQL/PGlite transaction checks pass, including rollback after simulated case-write failure.
- TypeScript check passes; git diff whitespace check passes.
- ADR replay retains concluded_decision_audit, LIMITED, one canonical source and verification-only action headings. PDF contains no prohibited probability heading, active remedy label or future-action phrase.
- Replay evidence records after_renderer_transforms, inspected paths/counts and the PDF SHA-256.

## Limits and deployment
No live OCR/AI pipeline rerun or production deployment was performed. The replay used the supplied saved JSON through current composition, PDF/DOCX preflight, release resolution and actual PDF rendering. Private case artifacts are kept local, not committed to this public repository.
Apply the included database migration before deploying the application code; missing RPC fails closed.
The application-wide full suite and production bundling were not run. Existing renderer layout was preserved.
Extraction/OCR, canonical dedupe/source identity algorithms, routing, naming, Judge/hallucination thresholds, ESS formulas, decision-core extraction and the concluded-governance resolver were not modified.
