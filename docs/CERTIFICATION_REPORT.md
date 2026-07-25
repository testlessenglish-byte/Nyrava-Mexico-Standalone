# NYRAVA Production Certification Report

- Generated: `2026-06-26T02:11:54.312Z`
- Benchmark suite: `cert-v1.0.0` (10 fixtures)
- Total tests: 69 (passed 69, failed 0, pending 0)
- Verdict: **Approved for Production**
- Signature: `sha256:ba567c250ffc3dad`

## Section Results

| # | Section | Tests | Passed | Failed | Status |
|---|---------|-------|--------|--------|--------|
| benchmarks | 1. Real-Workload Certification | 11 | 11 | 0 | PASS |
| determinism | 2. Provider Determinism | 5 | 5 | 0 | PASS |
| governance | 4. Evidence Governance | 7 | 7 | 0 | PASS |
| redteam | 5. Hallucination Red-Team | 6 | 6 | 0 | PASS |
| performance | 6. Performance | 3 | 3 | 0 | PASS |
| concurrency | 7. Concurrency | 3 | 3 | 0 | PASS |
| recovery | 8. Recovery | 3 | 3 | 0 | PASS |
| security | 9. Security & Privacy | 8 | 8 | 0 | PASS |
| acceptance | 10a. Pre-flight Gate Acceptance | 15 | 15 | 0 | PASS |
| hallucination | 10b. Classifier Hallucination Defense | 8 | 8 | 0 | PASS |

## Benchmark Fixtures

| ID | Type | Docs | Pages | Chars | Facts | Expected Bin |
|----|------|------|-------|-------|-------|--------------|
| B01-criminal-suppression | criminal | 6 | 48 | 38,000 | 22 | medium |
| B02-civil-breach | civil | 9 | 120 | 72,000 | 31 | high |
| B03-appellate-brief | appellate | 3 | 42 | 24,000 | 14 | medium |
| B04-family-custody | family | 7 | 60 | 41,000 | 18 | medium |
| B05-contracts-msa | contracts | 4 | 88 | 60,000 | 12 | medium |
| B06-multi-doc-litigation | multi_doc | 42 | 1200 | 580,000 | 140 | high |
| B07-ocr-heavy | ocr_heavy | 18 | 520 | 210,000 | 60 | high |
| B08-poor-scan | poor_scan | 5 | 30 | 850 | 2 | minimal |
| B09-mixed-pdf-docx | mixed | 11 | 180 | 95,000 | 36 | high |
| B10-sparse-intake | civil | 1 | 2 | 600 | 1 | minimal |

## Items Requiring Live Workload Evidence

These sections cannot be fully certified by automated tests alone and
require live captures from a staging tenant to graduate to VERIFIED:

- 3. AI Cost Certification — needs `ai_usage` rollup across a full benchmark run.
- 6. Performance — wall-clock budgets per pipeline stage need live capture (pure-helper budgets are locked here).
- 7. Concurrency — needs N=10 simultaneous case analyses recorded in `pipeline_engine_runs`.

---
Signed: certification-runner ba567c250ffc3dad @ 2026-06-26T02:11:54.312Z

## Fixture Corpus Tiers

Two distinct test corpora exist; do not conflate them:

1. **Routing benchmarks** — the seeded "general civil" case and any DB row whose `name` is prefixed `routing_benchmark_*`. One-line `text/plain` files (~10–80 bytes each) whose only purpose is to drive case-type routing, cross-domain activation, and the Release Gate. Extraction-depth metrics against these are meaningless by design.
2. **Evidence-depth corpora** — `tests/fixtures/corpora/<practice_area>/`. Multi-document substantive matters (8–12 documents, 20–60 KB extracted per corpus) for the eight `PracticeArea` values. Use `loadCorpus` from `src/lib/intelligence/__tests__/fixtures/load-corpus.ts` to instantiate. These exercise extraction, entity capture, timeline, witness intelligence, contradictions, scoring, and report depth.

When re-running the Acceptance Test against real documents, target the evidence-depth corpora. The routing benchmarks remain in place for the routing/manifest/determinism checks they were authored for.
