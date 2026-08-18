# Nyrava México — Algorithm Integrity Audit (2026-08-18)

## Scope

This audit covers the deterministic/legal-intelligence boundaries that directly affect attorney-facing findings, scores, recommendations, procedural completeness, Talk to Case canonical retrieval, and release safety. The objective is not to tune one ADR fixture; it is to eliminate platform-wide algorithmic behaviors that can convert uncertainty into a false legal conclusion.

## Authoritative invariants

1. **Canonical findings** — `src/lib/intelligence/finding-selection.ts`
   - Authoritative report/scoring/chat surfaces admit finalized engine/agent findings only.
   - Provisional analyzer rows are excluded.
   - Hallucination/citation statuses `no_citation` and `unverified` are excluded.
   - `finding_status=suppressed` is now also excluded. A later audit decision can no longer be undone by a downstream reader.

2. **Finding identity and duplicate reconciliation** — `src/lib/intelligence/finding-dedupe.ts` + `canonical-id.ts`
   - Duplicate clustering remains evidence/title bounded.
   - Once two rows are established as the same issue, epistemic status outranks severity when choosing the survivor.
   - A `VERIFIED_COURT_HOLDING` therefore cannot be displaced by a high-severity `POTENTIAL_ISSUE` restatement of the same proposition.

3. **Primary scoring** — `src/lib/intelligence/scoring.server.ts` / `scoring-selection.ts`
   - Canonical scoring is based on eligible canonical findings, not raw model prose.
   - Verified court holdings are not automatically adverse.
   - Penal-only factors are filtered from Amparo/constitutional scoring.
   - The report's displayed case-strength value is reconciled to the deterministic score source rather than leaving a competing raw LLM number authoritative.

4. **Secondary deterministic algorithm bundle** — `src/lib/intelligence/algorithms.ts`
   - Constitutional-analysis count is context, not an adverse-risk multiplier.
   - Generic missing evidence may not manufacture a CNPP discovery motion.
   - Materia-neutral procedural defects may not manufacture a criminal-style nulidad motion without an independent penal signal.
   - This bundle remains explanatory/secondary; it must not supersede the canonical scoring authority above.

5. **Concluded SCJN Amparo review** — `src/lib/intelligence/procedural-compliance.server.ts`
   - A final SCJN judgment is not treated as a complete historical docket inventory.
   - Earlier pleadings not reproduced in the uploaded judgment are `not ascertainable from this corpus`, not proof of procedural omission.
   - When the concluded SCJN decision is detected, missing-document output does not label un-uploaded lower-record pleadings as absent from the official case.
   - The procedural percentage is described as document/corpus coverage, not as validity/compliance of the concluded proceeding.

6. **Materia execution routing** — `src/lib/execution/mx-pipeline.ts`
   - Amparo and constitutional execution profiles exclude the witness stage.
   - Amparo review may use the constitutional review execution profile internally without changing the attorney-facing materia.
   - This prevents generic witness/cross-examination assumptions from being a required Amparo execution stage.

7. **Witness/entity safety** — `src/lib/intelligence/report-augment.server.ts`
   - Generic capitalization is not enough to create a person.
   - Known non-person phrases such as `Procedimientos Penales`, `Estados Unidos`, court names, statutes and doctrinal phrases are rejected.
   - Generic names require testimonial context and repeated occurrence unless they come from an explicit titled-witness match or stored witness row.

## Defects found and corrected in this pass

- Suppressed findings could re-enter canonical scoring/report/chat surfaces because selection checked quarantine but ignored `finding_status=suppressed`.
- Duplicate winner selection treated severity/confidence as stronger than epistemic truth status, allowing a speculative issue to outrank a verified court holding.
- The secondary deterministic risk formula treated every constitutional issue as adverse risk (+10 each), which inverted Amparo/SCJN analysis.
- The deterministic remedy table could convert a generic `missing_evidence` signal into a CNPP discovery motion in a non-penal case.
- Concluded SCJN procedural coverage could be read as a 20% compliance failure even when the only uploaded source was the final judgment.

## Regression requirements

CI must prove at minimum:

- suppressed critical findings are excluded from canonical scoring unless an audit/debug caller explicitly opts in;
- a verified SCJN holding survives a duplicate cluster against a higher-severity/higher-confidence potential-issue restatement;
- constitutional issue count alone contributes zero adverse risk;
- generic missing-evidence and generic procedural-defect signals alone produce no CNPP remedy;
- a genuine penal anchor still permits penal-specific deterministic remedy detection;
- existing launch-hardening tests and the production build remain green.

## Remaining architectural rule

Missing evidence, investigative leads and possible errors remain valid Nyrava outputs. The invariant is epistemic: **a gap is not a fact, a possibility is not a holding, and a legal rule is not proof that the rule was violated in this case.** Talk to Case and reports must consume the same canonical states rather than independently re-promoting rejected or quarantined material.
