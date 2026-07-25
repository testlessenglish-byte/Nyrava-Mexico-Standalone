# Evidence-Depth Fixture Corpora

Two tiers of test corpora live in this repo:

1. **Routing benchmarks** (`general civil` case in the seeded DB, `routing_benchmark_*`): tiny one-line files whose only job is to exercise case-type routing, cross-domain activation, and the Release Gate. The Acceptance Test uses these for manifest/routing/determinism checks. **Do not** judge extraction depth or report quality against these.
2. **Evidence-depth corpora** (this directory, `tests/fixtures/corpora/<practice_area>/`): multi-document substantive matters per practice area. Use these to exercise entity extraction, timeline assembly, witness intelligence, contradictions, scoring, and final report depth.

## Practice areas covered

One folder per `PracticeArea` from `src/lib/intelligence/practice-areas.ts`:

- `criminal/`
- `civil_rights/`
- `general_civil/`
- `personal_injury/`
- `medical_malpractice/`
- `employment/`
- `family/`
- `appellate/`
- `tax_law/`

Each corpus contains 6–10 documents (pleadings, contracts, deposition excerpts, email threads, exhibits, invoices, transcripts) authored as plausible synthetic matters — fictional parties, internally consistent facts and dates, real statute / rule citations where the practice area calls for them. Target size is 20–60 KB of extracted text per corpus, enough to give every analyzer something substantive to work on without making the Acceptance Test slow.

## Loading a corpus into a fresh case

Use the helper:

```ts
import { loadCorpus } from "@/lib/intelligence/__tests__/fixtures/load-corpus";

const caseId = await loadCorpus({ practiceArea: "personal_injury" });
// fresh case_id, all docs uploaded + extracted, ready for the pipeline
```

`loadCorpus` creates a case scoped to the test user, uploads every file in the corpus folder via the same code path the UI uses, and waits for extraction to settle before returning.

## Re-running the Acceptance Test

`scripts/certify.ts` accepts a `--corpus=evidence-depth` flag that swaps the routing-benchmark cases for the matching evidence-depth corpus per practice area. Pass/fail is reported per case type.

## Authoring rules

If you add or modify documents:

- Keep parties, dates, and dollar amounts internally consistent across documents in the same corpus — the contradictions engine reads across files.
- Include at least one verifiable contradiction (date mismatch, dollar mismatch, witness account divergence) per corpus, so the contradictions engine has signal to find.
- Cite real statutes / rules where the practice area expects them (e.g. 4th/5th/6th Amendment for criminal, Title VII for employment, FRCP for civil procedure).
- Keep PII synthetic. No real names, addresses, SSNs, or case numbers.
