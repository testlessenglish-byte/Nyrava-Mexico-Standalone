## Goal

Make each report lead with the answer the user actually needs, adapt to the materia, explain consequences and next steps, and behave like a living document that can be revised through Talk to Case — all without redesigning the 17-section report contract.

## Important constraint

Report Engine v1.0 freezes the 17 canonical sections (`docs/RELEASE-REPORT-ENGINE-v1.0.md`). Nothing below adds, removes, or reorders a section. Everything lands **inside** existing sections (ExecutiveSummary, Strategy, Recommendations, Discovery, Appendices) as new optional fields — the section lock and its tests stay green.

## 1. Goal-first answer (Objetivo Rector)

New registry module `src/lib/reporting/objective.ts`, keyed by materia through the existing `mexico-modules.ts` registry (no materia literals in components or engines):

| Materia | Primary question answered first |
| --- | --- |
| penal / amparo / constitucional | Strongest constitutional and procedural issues |
| civil / mercantil | Strongest litigation strategy and exposure |
| inmobiliario | Is the transaction ready to close, and what blocks it |
| familiar / sucesiones | What is preventing resolution or distribution |
| laboral | Employer's greatest legal exposure |
| fiscal / administrativo / others | Registry-declared equivalent |

`ExecutiveSummary` gains optional `primary_question` and `direct_answer`, rendered as the first block of the report, PDF and DOCX, above the current narrative. The direct answer is composed from already-verified findings and scores — no new LLM pass and no speculation.

## 2. Adaptive strategy

The objective registry also declares, per materia, the recommendation vocabulary and ordering (e.g. procedural instruments for penal, closing conditions for inmobiliario, exposure quantification for laboral). `Strategy` and `Recommendations` projection is reordered and re-labelled through this registry so a due-diligence matter no longer reads like a criminal case.

## 3. Decision support on every issue

`Recommendation` gains optional `why_it_matters`, `impact`, `next_action` (one short line each), populated deterministically from the finding's existing `legal_significance` / `potential_impact` plus the materia's action vocabulary. Rendered as a compact three-line block under each recommendation — concise, not an essay.

## 4. Talk to Case → targeted regeneration

- Talk to Case gains report-aware intents: ask about a section, accept new evidence, request a change, explore a scenario.
- When the user accepts a change or uploads evidence, only the affected sections are recomputed (`ExecutiveSummary`, `Findings`, `Strategy`, `Recommendations`, `Scores` as impacted) and merged into the stored canonical analysis, instead of rerunning the whole pipeline.
- Guardrails: unaffected sections keep their prior citations and hashes; the section lock and QA gate run on the merged result.

## 5. Show what changed

The existing immutable `report_versions.change_log` becomes populated and visible: a "Cambios en esta versión / What changed" panel listing each changed section, why it changed, and the triggering evidence or instruction, with a link back to the previous version.

## 6. Keep it grounded

Unchanged evidence-first behaviour, plus: when the direct answer cannot be supported, the report states the primary question, says explicitly that evidence is insufficient, and lists the specific documents that would unlock the answer (sourced from the existing missing-documents module).

## Technical notes

- Files: new `src/lib/reporting/objective.ts`; edits to `src/lib/canonical/case-analysis.ts` (optional fields only), `writer.server.ts`, `gate.server.ts`, `report-recommendations.ts`, `src/lib/export.ts`, report UI components, `src/lib/intelligence/chat.server.ts`, `report-version.server.ts`.
- All new strings go through the es/en locale files; Spanish stays default.
- No changes to scoring formulas, prompt contracts, or the legal-content files.

## Suggested sequencing

Batch A: items 1–3 and 6 (report intelligence layer, self-contained, immediately visible).
Batch B: items 4–5 (Talk-to-Case revision loop and change log), after you spot-check Batch A.
