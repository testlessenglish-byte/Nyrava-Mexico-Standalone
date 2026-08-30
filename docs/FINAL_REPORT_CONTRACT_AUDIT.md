# Final report governance and rendering audit

Base: upstream `5f24bb628d7762cdf90f0f13125aed7e2af26853`.

This is a platform-wide report repair. No case IDs, docket numbers, filenames,
or offense-specific exceptions select production behavior.

## Root causes and repaired bypasses

1. **Governance context:** the database loader selected
   `cases.procedural_posture`, absent from the checked-in schema and migrations.
   Query errors were ignored, and a null row became an empty context that
   resolved to active litigation. The loader now queries existing columns,
   rejects missing/error context, and accepts authoritative execution context.
   The report pipeline supplies its already-resolved case mode and posture.
   Explicit post-judgment analysis retains precedence.
2. **Finding actions:** `export.ts::renderKeyFindings` called
   `buildFindingWorkProduct` while rendering and always printed a strategic
   heading. Actions now come from the shared capability/governance helper;
   renderers consume precomposed cards. LIMITED actions use
   `PASOS DE VERIFICACIÓN DOCUMENTAL`.
3. **Source aliases:** finding counts used document IDs, filenames, or even a
   random fallback. Work-product synthesis grouped display names and inferred
   duplicate identity from filename stems. Report lookup now consumes the
   existing canonical source registry; grouping/counting uses canonical IDs.
   Multiple citations remain citations. Unresolved identity blocks release.
4. **Order and attribution:** the PDF cover and detailed cards independently
   sorted by severity. A shared decision-kind order now controls concluded
   reports, with canonical decision-core sections preceding secondary findings.
   Verified matching decision-core attribution takes precedence over older
   finding speakers. Existing dedupe algorithms are unchanged.
5. **Penal reincidencia:** the shared Penal legal-normalization boundary and
   report composer require explicit qualifying antecedent evidence and an
   applicable rule. Unsupported classifications become
   `unsupported_reincidencia`, require attorney review, and are withheld
   from report findings. Aggravation, sentence length, and procedural history
   alone do not establish the classification.
6. **Release validation:** the old validator inspected intermediate report
   JSON and checked a priority flag rather than rendered order. It remains
   deprecated for compatibility tests, with no production release callers.
   Pipeline generation and final orchestration use the new contract. PDF/DOCX
   validate the exact composed data, including their selected section queue;
   HTML and memo exports validate the same payload. Released payloads are
   recursively frozen. Existing payloads are revalidated without silently
   rebuilding away late mutations.

## Files/functions

- `concluded-case-governance[.server].ts`: context loading, authoritative
  resolver, decision-kind order, role labels, deprecated intermediate validator.
- `reporting/final-report-contract.ts`: composition, canonical speaker
  precedence, source inventory, exact-payload validation, immutable release.
- `reporting/report-permissions.ts`: capability resolution from existing
  report state and the shared permitted-action helper.
- `reporting/report-sources.ts`: canonical registry lookup and distinct counts.
- `reporting/attorney-workproduct.ts`, `evidence-synthesis.ts`: canonical
  grouping and permission-controlled content; removed filename reconstruction.
- `reincidencia-evidence.ts`, `penal-legal-normalization.ts`: antecedent rule.
- `pipeline.server.ts`, `agents/orchestrator.server.ts`: contract release gates.
- `export.ts`, `export-legal-memo.ts`: PDF/DOCX/JSON and memo boundaries.
- `CanonicalReportFindings.tsx`, both report routes,
  `LegalMemorandumPanel.tsx`: HTML consumes the composed contract.

## Verification and before/after

The seven required regressions cover concluded context (including query
failure), LIMITED actions, alias counts, decision-first order, SCJN precedence,
unsupported reincidencia, and rejection of prohibited final payload content.
Additional tests execute the actual PDF renderer and exercise seven materias.

Synthetic fixture before: concluded case; LIMITED report; two labels for one
canonical source; an older Tribunal Colegiado role; an unsupported aggravated-
kidnapping reincidencia finding.

After: concluded-decision-audit governance; one canonical source and two
citations; SCJN attribution; unsupported finding withheld; disposition and
effect before secondary findings; no strategic recommendation heading.
The actual PDF was text-checked and its dashboard visually inspected.
This fixture is explicitly synthetic, not a rerun of ADR 3265/2023.

All 15 new tests passed. The final focused rerun also includes the existing
ADR 5829 regression (17 tests total). Existing source/authority universality
fixtures were migrated to explicit canonical IDs and permissions rather than
restoring the retired fallback behavior.

The unchanged upstream suite produced 13 failures, 1743 passes, and 7 skips.
The complete changed-suite run produced 15 failures, 1756 passes, and 7 skips:
the same 13 baseline failures plus a PDF-test buffer-transfer issue and an
existing test expecting the retired inline motion-permission expression.
Those two test issues were corrected and the focused tests rerun successfully.
The complete suite is not represented as green.

## Remaining limits / merge checklist

- **ADR 3265/2023 has NOT been rerun.** The original input, saved execution
  payload, and authenticated case location were not available in this task.
  Supply them and perform the real replay before production acceptance.
- The real PDF path was exercised. DOCX, HTML and memo paths share the
  contract and were type-checked, but do not yet have equivalent rendered
  artifact integration tests in this PR.
- Older reports without canonical identity need regeneration; the renderer
  does not guess identities or revive raw recommendations.
- Some active-FULL narrative/strategy formatters remain, gated by the shared
  capability. Their existing prose-generation behavior is not redesigned.
  The standalone social-care audit report is a separate product and unchanged.
- The baseline failures concern routing, classification, schema-drift,
  reconciliation, dates, premature-release source assertions, procedural
  posture and report augmentation; their protected algorithms were not changed.

No edits were made to extraction/OCR, case naming, routing, procedural-vehicle
selection, finding dedupe, canonical source normalization, QA/Judge/
hallucination thresholds, ESS formulas, or scoring algorithms.
