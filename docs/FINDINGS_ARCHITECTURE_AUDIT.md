# Findings Architecture & Report Intelligence — Audit

Status: audit only. No code changed by this document.

## 1. What a "Finding" is today

A row in `public.case_findings`. All finding-producing engines are required to write
through `addFindings` / `addGatedFindings` (`src/lib/intelligence/findings.server.ts:507,765`),
whose header comment (`findings.server.ts:15-28`) enumerates the authorized call sites:

- `src/lib/pipeline.server.ts:750` (analyzers), `:991` (work-product feed)
- `src/lib/intelligence/engines.server.ts:184,338,441,579,733` (theory, opportunity, discovery gaps, witness, trial prep)
- `src/lib/intelligence/litigation.server.ts:387,654` (promoted findings, evidence intelligence)
- `src/lib/intelligence/procedural-compliance.server.ts:69,75`
- `src/lib/intelligence/derived-engines.server.ts` (writes `source_module = "analyzer:*"`)

A second table, `public.agent_findings`, stores **one JSON blob per agent per case**
(`pipeline.server.ts:2974,3033`). It is read for chat context, alerts and legal-QA but is
explicitly excluded from every count (`src/lib/intelligence/canonical.ts:309`).

So: yes, there **is** a centralized findings repository — but only for finding-shaped data.
Non-finding engine output (perspectives, opportunities, trial prep, evidence classifications,
strategy center, jurisdiction intel) has **no central repository**; each engine owns a bespoke
table read directly by whichever consumer wants it.

## 2. Lifecycle trace

```
engine → addFindings/addGatedFindings → canonical-id merge → case_findings
                                                                  │
        ┌─────────────────────────────────────────────────────────┤
        │                                                         │
   report LLM prompt (pipeline.server.ts:3798-4072)         projectCanonical
        │                                                    (writer.server.ts:100)
   reports row (full_report JSON)                                 │
        │                                                    canonical gate
        ├── intelligence.consolidated_findings ──► every dashboard badge     (gate.server.ts:31)
        └── export.ts (PDF/DOCX)  ◄── reads RAW tables directly              │
                                                                    canonical_analysis
                                                                    (READ BY NOBODY)
```

### 2a. The three parallel report paths

1. **`reports.full_report`** — free-text/JSON produced by one large LLM call.
2. **`export.ts`** — the PDF/DOCX the attorney downloads. Builds `CaseExportData` in
   `src/routes/_authenticated/reports.tsx` and `cases.$caseId.tsx` from **raw tables**,
   including everything the canonical layer drops (`export.ts:376-383` perspectives,
   opportunities, trial_prep, strategy_center; `:1771` jurisdiction intel).
3. **`canonical_analysis`** — the deduped, ranked, citation-checked, QA-audited object.
   Written by `writeCanonical` at the end of `runCanonicalGate` (`gate.server.ts:31`).
   **Grep result: no route, component or exporter reads `canonical_analysis`.**

That is the single biggest structural defect: the only layer that applies intelligence
discipline (dedupe, ranking, citation demotion, methodology attachment, QA audit) writes to
a table nothing renders, while the artifact the attorney actually reads is assembled from
un-ranked, un-deduped raw rows plus one LLM pass.

## 3. Selection & suppression — why counts collapse

`getCanonicalScoringFindings()` (`src/lib/intelligence/scoring-selection.ts:82-101`) keeps only
findings whose `source_module` starts with `engine:` or `agent:` and that are not
`metadata.provisional`. Everything tagged `analyzer:*` is discarded. It is invoked at
`pipeline.server.ts:3859-3865`, and its output becomes
`full_report.intelligence.consolidated_findings` (`pipeline.server.ts:6001`) — the array read by
`getFindings()` (`canonical.ts:55-59`) and therefore by every findings badge in the app.

The defensive fallback at `pipeline.server.ts:3880-3883` only fires when the filtered set is
**exactly empty**. A case with dozens of `analyzer:*` rows and one `engine:` row renders
"Findings (1)". The `contradictions` agent writes **zero** `case_findings` rows at all
(`agents/statistics.server.ts:243-259`), so it is invisible to the count regardless of prefix.

Suppression math: `statistics.server.ts:290`
`suppressed = max(0, rejectedFromRuns, generated - promoted)` treats an agent as having
suppressed 100% of its output whenever its engine writes to a table other than `case_findings`
(evidence map, timeline). That is the source of the live `218 suppressed / 79 visible`,
`3 of 13 agents producing findings` reading on case `145cedc1`.

## 4. Badge audit (every counter)

| Surface | Badge | Source | Predicate |
|---|---|---|---|
| Case tabs | Findings | `getCase` `case_findings` pre-filtered to `engine:*` (`cases.functions.ts:2741-2753`) | prefix filter |
| Case tabs | Strategic | inline `findings.filter(priority <= 3)` (`cases.$caseId.tsx:402`) | `priority<=3` |
| Dashboard | High Priority Findings | `cases.functions.ts:2136-2139` | `severity in (critical,high)` |
| AttorneyHome | Alerts | `casework.functions.ts:319` | `priority<=2` |
| Case tabs | Agents | `getAgentSummary(report).executed \|\| agents.length` (`cases.$caseId.tsx:421`) | canonical + `agent_findings` fallback |
| MultiAgentPanel | Agents | canonical + **`agent_logs`** fallback (`MultiAgentPanel.tsx:124-133`) | different fallback → can disagree mid-run |
| Case tabs | Report | count of **non-empty categories**, max 16 (`canonical.ts:195-214`) | category count, not item count |
| Case tabs | Documents | `docs.length` (`cases.functions.ts:2674-2680`) | includes `archived_at` rows |
| Dashboard | Contradictions / Discovery gaps | inline `.length` on `reports.contradictions_struct` / `missing_evidence_struct` (`cases.functions.ts:2148-2153`) | bypasses the canonical helpers that exist for exactly this |

Four different definitions of "important finding" (`engine:*` prefix, `priority<=3`,
`severity in (critical,high)`, `priority<=2`), none sharing a helper.
`reports.findings_count` is selected in `listCases` (`:2128,2158`) and never rendered.

## 5. Consensus & ranking

- **Consensus exists, but upstream and weakly.** `computeCanonicalFindingId`
  (`canonical-id.ts:204-221`) collapses findings sharing `category + claim_type + source_doc_ids`;
  `mergeConfidence` (`:233-239`) applies `boost = (1 - base) * 0.25` only when the merge brings
  **new distinct evidence**. This is source corroboration, not "N engines agreed."
  Distinct-engine agreement is never counted or stored.
- **Ranking is static.** `findings-rank.server.ts:47-49`:
  `weight = categoryWeight × confidence`, with `categoryWeight` a hardcoded lookup
  (`:8-21`, contradiction 1.0 … witness 0.2). No citation count, no evidence count, no
  constitutional weight, no cross-engine agreement term. Witness-profile findings are dropped
  from `Findings` entirely (`:37-45`).
- **Dedupe is lexical.** Jaccard token similarity at 0.85 (0.9 for `Strategy.key_moves`),
  within-section only (`dedupe.server.ts:22-96`). No semantic or cross-section merge.
- And all three run inside the gate whose output (`canonical_analysis`) nothing renders.

## 6. Verdict — should the report engine be redesigned?

Yes. Not because the intelligence is missing — it is being generated and persisted — but
because there is no *selection* layer between generation and the attorney. Today the report is
a serialization of whatever survived four inconsistent filters, assembled by a single LLM
prompt, while the ranked/deduped/QA'd object is written to a dead table.

An Attorney Intelligence Report should be built on:

1. **One findings repository, one read path.** Every engine writes `case_findings`, including
   the ones that currently only write bespoke tables (contradictions, evidence map, timeline,
   perspectives, opportunities, trial prep, jurisdiction intel) — bespoke tables stay as the
   detail view, but every engine also emits at least one finding row.
2. **Provenance instead of prefix filtering.** Replace the `engine:`/`analyzer:` string test with
   an explicit `status` column (`provisional | promoted | suppressed`) and a reason. Nothing
   should be invisible because of how its `source_module` string was spelled.
3. **Real consensus.** Store `supporting_engines: text[]` on the canonical finding and rank on
   `agreementCount × evidenceCount × citationQuality × confidence` rather than a static
   category table. Two independent engines reaching the same conclusion is the strongest signal
   the platform can produce, and it is currently thrown away.
4. **Render the canonical object.** `export.ts` and the report route must consume
   `canonical_analysis`, so dedupe, ranking, citation demotion and the QA audit actually reach
   the attorney. Until they do, the entire `src/lib/canonical/` gate is decorative.
5. **One counting helper.** A single `selectFindings(scope)` used by every badge, tab, dashboard
   tile and export — removing the four competing predicates listed in §4.

The LLM's role narrows accordingly: it writes prose *about* a deterministically selected and
ranked finding set, rather than deciding what the report contains.

## Phase 4 — report reads canonical_analysis (implemented)

- New `src/lib/canonical/report-source.server.ts`. Flag `CANONICAL_REPORT_ENABLED`, **default off**.
- When on, `runReport` reorders/filters the already-loaded `case_findings` rows by the gate's
  persisted ranking (`canonical_analysis.analysis_payload.Findings`). It is a reorder, not a
  reshape: canonical Findings carry the same row ids, so there is no second rendering data model.
- Version and payload are read in one query, so a concurrent rerun cannot make the recorded
  `canonical_version` disagree with what was rendered.
- `reports.canonical_version` is persisted; `computeReportHash` includes it (identical-looking
  reports from different canonical analyses no longer collide) and `snapshotReportVersion`
  records it on `report_versions`.
- Staleness is surfaced, never auto-applied: `/reports` shows a notice when a newer canonical
  version exists. Regeneration remains an explicit attorney action.
- The raw-table gather is **temporary migration support**. Every fallback writes
  `pipeline_trace(phase='report', step='canonical_fallback')` with a typed reason
  (`no_canonical_row`, `canonical_not_completed`, `empty_payload`,
  `no_overlap_with_raw_findings`, `read_error`). Removing the fallback is gated on that
  query returning zero rows over a representative window.

Bug found and fixed while testing: `Number(null) === 0` made a report with no recorded canonical
version render as "stale, built from version 0". Null versions are now rejected before coercion.

### Fallback-reason coverage (pre-Amparo)

`flag_disabled` was removed: it was global env state, not a per-case exception, and had no
emit site — it would have written a trace row for every report in every flag-off environment
while telling you nothing the env var doesn't. Removed rather than left looking like coverage.

The remaining five now have stub-client tests asserting the reason is actually emitted, not
just reachable by inspection: `no_canonical_row`, `canonical_not_completed` (both
`orchestrating` and `failed`), `empty_payload`, `read_error`, and (from the pipeline side)
`no_overlap_with_raw_findings`. A happy-path test asserts **no** trace row is written when
canonical is used, so an empty `canonical_fallback` query during rollout means "no fallbacks"
rather than "the reporting path is broken".
