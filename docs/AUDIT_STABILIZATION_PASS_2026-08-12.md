# Stabilization Pass — Confirmed Audit Fixes (2026-08-12)

Scope: fix and verify every P0/P1 defect confirmed by the two-pass full-codebase
audit (chat record, 2026-08-12). No architecture separation work, no
mechanical merges of anything flagged "requires review," no deletions beyond
the five independently re-confirmed dead files. This document is the
single reference for what changed, what didn't, and what's still open.

Full test suite: **883 passing, 0 failing, 7 intentionally skipped**.
Full `tsc --noEmit`: **clean** (one file — see "Quarantined" below — carries a
documented, intentional exclusion).
Production build (`vite build`): **succeeds**.

---

## 1. P0 legal defects — fixed and verified

Each fix below was verified with a standalone repro script run directly
against the real function (not just "tests pass") before being committed,
per the audit's "prove it, don't assume it" standard.

### 1.1 Sinaloa `SIN` false-positive jurisdiction detection
`src/lib/intelligence/mx-jurisdiction.ts` — `detectState()` matched 3-letter
state codes case-insensitively against free-flowing prose. Several codes
collide with ordinary Spanish words: `SIN`→"sin" (without), `SON`→"son"
(they are), `VER`→"ver" (to see), `QUE`→"que" (that/what). Any document
containing one of these common words was misdetected as the corresponding
state. Fixed: codes now match only their official uppercase form; full state
names and city aliases remain case-insensitive (they aren't also common
words). New regression test: `mx-jurisdiction-detect-state.test.ts`.

### 1.2 Accented `encontró` regex failure (anti-overclaiming guardrail)
`src/lib/intelligence/findings.server.ts` —
`enforceCorpusBoundedAbsenceLanguage()` rewrites definitive "not found"
claims into corpus-bounded hedged language. Its regexes used a trailing
`\b` immediately after an accented vowel (`encontr[oó]\b`); JS's `\b` is
defined relative to `\w`, and accented letters aren't `\w`, so the boundary
never fired on the correctly-accented Spanish form — only on the
misspelled, unaccented one, which essentially never appears in real text.
The guardrail was silently inert on real input. Fixed with a
unicode-safe lookahead. Covered by the pre-existing
`procedural-type-gate.test.ts`.

### 1.3 `canonical-id.ts` over-merging distinct findings
Two bugs compounded:
- `resolveClaimType`'s fallback regex `/\bprocedural|miranda|.../ `had no
  trailing boundary, so it matched as a bare prefix inside category strings
  like `"procedural_violations"` (underscore is a `\w` character, so there's
  no boundary there) — collapsing unrelated findings' claim_type to the
  generic `procedural_defect` purely from their category string. Fixed by
  adding the trailing `\b`. The same unbounded-prefix bug existed on the
  `constitutional` rule and was fixed identically.
- Even after that fix, `computeCanonicalFindingId` still used
  `source_doc_ids` (not title) as the sole discriminator whenever the
  resolved claim_type was the generic catch-all `uncategorized_finding` —
  meaning two genuinely unrelated findings sharing nothing but a category
  and one cited document still collapsed into one, silently destroying the
  other. Fixed: `uncategorized_finding` now keys on title, the same
  treatment already given to entity-scoped categories (e.g. `witness`).

Verified against the exact real-world pair from
`dedup-canonical-issue.test.ts` ("Falta de notificación oportuna..." vs.
"Omisión de fundamentación y motivación...", same category, same doc).

### 1.4 U.S. motion taxonomy in the live report generator
`src/lib/pipeline.server.ts`'s `runReport` prompt listed U.S. motion
categories ("Motion to dismiss, Motion to suppress, Motion in limine,
Motion to compel, Discovery sanctions, Summary judgment...") — directly
contradicting the `mexicoLock()` instruction four lines above it, and
reaching the live `legal_memorandum.recommended_motions` section an
attorney downloads. Replaced with the existing, already-authoritative
Mexican procedural-vehicle catalogue in
`src/lib/jurisdiction/mx-work-product.ts` (materia-keyed, article-cited —
CNPP, Ley de Amparo, LFT, CFF, LGSMIME, LGEEPA), the same taxonomy
`runWorkProductEngine` already uses. **No new legal content was invented or
substituted** — the existing mapping was reused. See §4 for what still
needs attorney sign-off.

A second, more severe instance of the same defect class was found and
fixed in the same function: `memoSysSuffix` (a second, separate LLM call
for the `legal_memorandum` object) told the model *"Constitutional/
Brady/Miranda analyses ARE relevant"* for criminal cases — and because
`runChunk` concatenates it directly after `systemInstruction` (which
already says *"nunca en doctrina estadounidense (Miranda, Brady/Giglio...)"*
four hundred lines earlier), the combined prompt for that specific call
literally contradicted itself. Fixed to mirror the correct instruction's
Mexican framing (Art. 20/19 CPEUM, CNPP Arts. 227-230) instead of
reintroducing U.S. doctrine.

### 1.5 English litigation-strategy-center text in Mexican PDF exports
`src/lib/intelligence/litigation.server.ts`'s
`runLitigationStrategyCenterEngine` hand-wrote English template sentences
("What wins this case?", "priority discovery target", "Settlement leverage
is likely to increase after key discovery milestones...") directly into
`case_strategy_center`, reaching the "Centro de Estrategia Litigiosa" PDF
section as English text inside an otherwise-Spanish document. Fixed to
respect the case's actual `report_language` (the platform's real,
user-selectable bilingual setting — `getReportLocale()`) instead of being
hardcoded, and to use Spanish text in the "es" branch instead of English.
`export.ts`'s own hardcoded English h3 labels in the same section
("Primary Trial Theme", "Biggest Weakness", "Biggest Trial Risk", "Why:",
"Recommended approach:") were translated to match the section's
otherwise-consistent Spanish headers.

Also found and fixed in the same file: the civil-matter `caseFrame` LLM
instruction listed **"discovery"** as an *allowed* civil-procedure term —
Mexican civil procedure has no discovery phase; the equivalent is
*ofrecimiento y desahogo de pruebas*, which is what the instruction now
says.

### 1.6 QA gates expanded (root-cause coverage gap behind 1.4/1.5)
`src/lib/intelligence/legal-qa.server.ts`'s `TARGETS` — the deterministic
terminology-remediation/audit gate that runs on every other engine's output
table — never included `reports` or `case_strategy_center`, the two tables
1.4 and 1.5 actually reach. Added both, with their real narrative text/json
columns (see the file for the exact column list and the reasoning for what
was excluded — internal bookkeeping fields like `report_chunk_cache` are
not attorney-facing narrative and were left out).

`src/lib/canonical/prerender-validate.server.ts`'s `CRIMINAL_ONLY_TERMS`
gate — the one check that inspects final report *content* — didn't include
any of the terms 1.4 actually injected, and only runs on non-criminal
cases even though those terms are wrong for every Mexican case type. Added
a second, unconditionally-checked list (`US_PROCEDURE_TERMS_ALWAYS_WRONG`)
as defense-in-depth against a future regression reintroducing these terms.
New regression test added to `prerender-validate.test.ts`.

---

## 2. Schema/type drift — fixed and verified

**Correction to the audit's second-pass verification report**: that report
claimed 6 columns were missing from `src/integrations/supabase/types.ts`
(`speaker_role`, `proposition_type`, `adoption_status`, `audit_classification`
on `case_findings`; `case_analysis_mode`, `case_type_source`,
`case_type_verification_status` on `cases`). Re-verifying directly against
the file during implementation showed this was **wrong for 5 of those 7** —
`speaker_role`, `proposition_type`, `adoption_status`, `audit_classification`,
and `case_analysis_mode` were already present. Only `case_type_source` and
`case_type_verification_status` (on `cases`) were genuinely missing, in
addition to `superseded_at`/`superseded_reason` (on `case_findings`) and the
3 whole tables. Noting this plainly rather than letting the earlier,
incorrect claim stand uncorrected.

**Actually missing (confirmed, now added):**
- Tables: `case_outcome_assessments`, `case_classification_evidence`,
  `case_decision_reconstructions` (migrations `20260809135402`+`20260809140747`,
  `20260809143021`, `20260810130700`)
- `case_findings` columns: `superseded_at`, `superseded_reason`
  (migration `20260809150000`)
- `cases` columns: `case_type_source`, `case_type_verification_status`
  (migration `20260809143021`)

These were hand-authored to match the migrations' DDL and the file's own
established Supabase-codegen format exactly (Row/Insert/Update/Relationships
shape, alphabetical placement, FK naming convention), since this environment
has no live database credentials to run `supabase gen types` (see §5).
**Recommended follow-up**: run `supabase gen types typescript --project-id
bknqcokuypkqvtqdpsqq` (after `supabase login`) and diff against this
hand-authored version to catch anything a static migration read could have
gotten subtly wrong.

Fixing this resolved a real, previously-hidden type error in
`src/lib/intelligence/decision-reconstruction-extractor.server.ts`, which
queried `case_decision_reconstructions` — a table that didn't exist in the
generated types at all.

---

## 3. TypeScript coverage — narrowed, not removed wholesale

`tsconfig.json` used to exclude the entire business-logic engine
(`intelligence/`, `canonical/`, `ai/`, `agents/`, `execution/`, plus ~25
named files — ~226 of 540 src files) from typechecking. Measured directly:
running a full `tsc --noEmit` with every exclusion removed showed **zero**
real errors in `ai/`, `agents/`, `execution/`, or any of the 25 named files.
`canonical/`'s one error and `intelligence/`'s one real source error (the
`case_decision_reconstructions` issue above) are both now fixed. All of it
is back under typecheck.

**One narrow, intentional exception remains**:
`src/lib/intelligence/__tests__/acceptance.test.ts` is individually
excluded — see §4.

---

## 4. Quarantined, not fixed: the report-gate contract decision

`acceptance.test.ts` has 4 tests (`it.skip`, with a detailed comment at
their `describe` block) that describe a two-tier report-gate design
(`REPORT_BLOCKING_ENGINES` narrowed to 6 failure-gating stages, plus a
separate `REPORT_MUST_BE_TERMINAL_ENGINES`/`stillInFlight` mechanism gating
on "still running," covering all 22 stages). That design is well-reasoned
and documented in the test's own comments (dated 2026-08-03) — but it was
never actually implemented: `REPORT_MUST_BE_TERMINAL_ENGINES` doesn't exist
in `execution-state.ts`, `stillInFlight` doesn't exist on `ReportGate`, and
the real `REPORT_BLOCKING_ENGINES` was instead widened to all 22 non-report
stages (2026-07-31 — the change these tests' comments describe as having
been reverted). `docs/BASELINE.md` §2 independently describes a third, even
older version (4 named engines). Three sources — code, this test, and the
frozen doc — each describe different intended behavior.

**This was deliberately not resolved** per instruction: fixing it requires
a decision (is the current all-22 `REPORT_BLOCKING_ENGINES` the accepted
design, or does the two-tier split need to actually be built?), not a
guess. Whoever owns the pipeline-contract freeze policy
(`docs/BASELINE.md` §6) should decide; the `describe.skip` and the
`tsconfig.json` exclusion for this one file should both come off in the
same commit that resolves it, along with a `docs/BASELINE.md` update per
that document's own Freeze Policy.

---

## 5. Cannot verify from this environment — needs your action

This sandbox's `.env` has only the anon/publishable Supabase key — no
service-role key, no DB password, no `SUPABASE_ACCESS_TOKEN`. Confirmed by
attempting `supabase gen types typescript --project-id
bknqcokuypkqvtqdpsqq`, which failed with
`LegacyPlatformAuthRequiredError`. **A3/B3 (cron job state) could not be
verified and were not guessed at.** Run this yourself (SQL editor or
`psql`, needs service-role/owner access):

```sql
select jobname, schedule, command, active
from cron.job
where jobname in ('nyrava-pipeline-worker', 'nyrava-legal-ingest-worker', 'nyrava-reminders-worker')
order by jobname;
```

What this needs to confirm:
- **`nyrava-pipeline-worker`**: does `command` target `mexico.nyrava.com`
  (canonical — used everywhere else in `src/`: `DocsLayout.tsx`,
  `sitemap[.]xml.ts`, email `FROM_DOMAIN`, `og:url` tags) or
  `nyravamexico.lovable.app` (what migration `20260726020000_fix_pipeline_
  worker_cron_mexico_domain.sql` set)? That migration's own comment
  documents a prior real incident where this cron pointed at the wrong
  domain and the worker never advanced a single case.
- **`nyrava-legal-ingest-worker`**: does it appear in `cron.job` at all? No
  migration file contains a `cron.schedule('nyrava-legal-ingest-worker', ...)`
  call, despite code comments and a prior audit doc describing it as live
  and scheduled.

---

## 6. Explicitly NOT touched (per instruction — flagged for review, not merged)

- **`execution-state.ts`** — the second-pass audit corrected an earlier,
  wrong "safe to delete" call: it's live via two `await
  import("@/lib/execution-state")` calls inside `pipeline.server.ts`'s
  report-gating logic. Not deleted.
- **The 3 Mexican jurisdiction resolvers** (`jurisdiction/mexico.ts`,
  `intelligence/mx-jurisdiction.ts`, `legal/jurisdiction-resolver.ts`) —
  not merged. They serve different purposes; only their independent
  state/alias tables are a real (narrower) duplication concern.
- **The 5 Mexican-state list literals** — not consolidated. They carry
  different, load-bearing metadata (SEGOB numeric IDs, city aliases, an
  official "Coahuila de Zaragoza" name) that a naive merge would destroy.
- **The two citation-completeness predicates**
  (`citation-audit.server.ts` vs. `canonical/citation-quality.server.ts`) —
  not unified. Verified they produce genuinely different rendered legal
  certainty for the same finding shape today; unifying is a legal-QA policy
  decision, not a mechanical refactor.
- **`canonical_analysis` / `export.ts`** — not wired together.
  `CANONICAL_REPORT_ENABLED` is not set anywhere in this repo; making
  `export.ts` canonical-authoritative is a multi-site reshape (12+
  independent derivation sites), not a flag flip.
- **Mexican legal taxonomy content** — nothing was invented. §1.4's fix
  reuses the existing `mx-work-product.ts` catalogue verbatim. A licensed
  Mexican attorney should still confirm: (a) the article-level accuracy of
  the existing catalogue entries, (b) the amparo recurso distinctions
  (revisión vs. queja vs. reclamación) specifically, (c) that adopting this
  catalogue into `runReport`'s prompt (its first use outside
  `runWorkProductEngine`) is appropriate in that context.

---

## 7. Files changed

Legal-defect/QA fixes: `mx-jurisdiction.ts`, `findings.server.ts`,
`canonical-id.ts`, `pipeline.server.ts`, `litigation.server.ts`,
`legal-qa.server.ts`, `prerender-validate.server.ts`, `export.ts`.
Schema: `integrations/supabase/types.ts`. Config: `tsconfig.json`.
Tests fixed/added: `mx-jurisdiction-detect-state.test.ts` (new),
`router-failover.test.ts`, `chat-cache-invalidation.test.ts`,
`ai-theory-exclusion.test.ts`, `mx-legal-qa.test.ts`,
`findings-schema-drift-resilience.test.ts`, `consensus.test.ts`,
`prerender-validate.test.ts`, `dedup-canonical-issue.test.ts`,
`orchestration-contradiction.test.ts`,
`procedural-compliance-grounding.test.ts`,
`blocked-report-enforcement.test.ts`, `acceptance.test.ts` (quarantine
only). Deleted: `PipelineStatusGrid.tsx`, `use-mobile.tsx`,
`activity-i18n.ts`, `log-scrub.ts`, `certification/benchmarks.ts`.

---

## 8. Next: the larger architecture question (not started)

Per instruction, the operating-mode separation audit (Strict Exploratory /
Ongoing Case / Finished Case / Talk to Case AI / any other mode, and the
`mode → engines → agents → pipeline stages → settings → prompts →
database writes → report/export path` mapping) has **not** been started.
This stabilization pass was a prerequisite for it, not a substitute.
