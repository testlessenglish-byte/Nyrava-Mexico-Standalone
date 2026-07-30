# Phase 3 — `case_findings` Reader Audit

Goal: make flipping `FINDINGS_PROJECTION_ENABLED=true` provably inert for
every pre-existing surface. Projection rows (`source_module = "projection:<table>"`)
are mirrored copies of specialized-table output, not new analysis.

Single definition: `PROJECTION_LIKE = "projection:%"` in
`src/lib/intelligence/finding-selection.ts`. Every non-projection-aware reader
now applies `.not("source_module", "like", PROJECTION_LIKE)`.

## Inventory — 38 `.from("case_findings")` sites

### Patched (23 reads + 3 gates) — excluded from projection rows

| File | Site | Surface at risk |
| --- | --- | --- |
| casework.functions.ts | priority feed | "acciones prioritarias" list |
| cases.functions.ts | severity tally, critical alerts, case detail list, report snapshot count, chat context | dashboard badges, alerts, chat prompt |
| agents/statistics.server.ts | source_module tally, visible-findings counter | agent stats panel |
| agents/orchestrator.server.ts | entities gate, judge gate, citation sweep | release gates / hallucination flags |
| pipeline.server.ts | total findings metric | run summary counter |
| intelligence/case-state.server.ts | full case state | scoring + chat context |
| intelligence/hallucination.server.ts | verification sweep | false hallucination flags |
| intelligence/document-graph.server.ts | doc↔finding edges | graph density |
| intelligence/canonical-timeline.server.ts | dated findings | timeline duplicates |
| intelligence/report-augment.server.ts | 3 report inputs | report body |
| intelligence/cross-domain.server.ts | module coverage | cross-domain checks |
| intelligence/evidence-map.server.ts | 2 reads | evidence map, citations |
| intelligence/citation-audit.server.ts | citation rows | citation audit score |
| intelligence/findings.server.ts | evidence-ref backfill, `listFindings` | exporter, chat, UI |
| intelligence/litigation.server.ts | 3 reads (incl. attack surface) | strategy panels |

### Intentionally unpatched

- `canonical/writer.server.ts:125` — the canonical gate **must** see projection
  rows; that is the entire point of Phase 2.
- `pipeline.server.ts:578`, `derived-engines.server.ts:47` — already scoped by
  a `source_module` prefix (`engine:discovery%`, `analyzer:%`).
- `procedural-compliance.server.ts`, `findings.server.ts` insert/delete,
  `engine-persistence.server.ts` — write paths scoped to their own module.
- `hallucination.server.ts:122` — update path keyed by ids already filtered.

## Verification

- `tsgo --noEmit`: clean.
- `bunx vitest run`: 376 passed, 3 skipped, 0 failed.
- Chat-cache fake Supabase client extended with `.not()` so the exclusion is
  exercised, not stubbed away.
- No Mexican legal content touched (`mexico-lock.ts`, `case-type-standards.ts`,
  `practice-areas.ts`, `mexico-modules.ts` unchanged).

Flag remains `FINDINGS_PROJECTION_ENABLED=false`. Enabling it is now a
one-line change whose blast radius is limited to `canonical_analysis`.
