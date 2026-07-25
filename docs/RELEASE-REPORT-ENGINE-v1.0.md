# Nyrava Legal Intelligence Report Engine v1.0

**Tag**: `report-engine-v1.0`  
**Date**: 2026-07-21  
**Status**: Structure frozen — production code.

## Summary

The Report Engine has crossed from prototype to product. This release locks the
17-section canonical model, the rendering order, the scoring formulas, and the
prompt contracts that determine report output. Future development is directed
at accuracy, validation, performance, and attorney-facing workflow — not at
expanding the report itself.

## Frozen items

| Item | Contract | Enforced by |
| --- | --- | --- |
| Canonical section list | 17 sections in fixed order: Metadata, ExecutiveSummary, Facts, Timeline, Evidence, Findings, Witnesses, Contradictions, Discovery, Risks, Scores, Recommendations, Strategy, CrossExam, Impeachment, WorkProduct, Appendices | `src/lib/canonical/sections.lock.ts` + `strictValidateCaseAnalysis` |
| Section order | Sections render in the locked order in PDF, DOCX, and UI | `LOCKED_CANONICAL_SECTIONS` + `CANONICAL_SECTIONS` equality test |
| Scoring formulas | Case/evidence/witness/timeline/overall confidence calculations | `src/lib/intelligence/scoring.server.ts` and related canonical scorers — changes only for verified bugs |
| Output prompts | Prompts that determine the prose of any report section | Engine prompt files — changes only for verified bug, factual accuracy, or hallucination reduction |
| PDF/DOCX layout | Established v1.0 layout (headings, score strip, scorecard, work-product cards) | `src/lib/export.ts` — changes only for formatting bugs |

## Allowed changes without a new release

- Factual error corrections.
- Legal analysis error corrections.
- Broken citation fixes.
- Formatting / pagination / typography bugs.
- Hallucination reduction and grounding improvements.
- Citation verification improvements.
- Performance and speed improvements.
- Stability and deterministic-output fixes.
- Real-case validation findings.
- UI/UX improvements outside the exported report.

## Change control

- Any proposed new report section requires a **documented business
  justification** and explicit approval before implementation.
- Any structural change (add/remove/rename/reorder section) requires a new
  Report Engine minor version and an update to this document.
- The programmatic lock (`assertSectionsLocked`) must be updated in the same
  PR as the section change; the test suite will fail otherwise.

## Related documents

- `docs/FREEZE.md` — platform-wide frozen contracts.
- `src/lib/canonical/case-analysis.ts` — canonical model and validators.
- `src/lib/canonical/gate.server.ts` — canonical pipeline gate.
- `src/lib/canonical/sections.lock.ts` — programmatic section lock.
