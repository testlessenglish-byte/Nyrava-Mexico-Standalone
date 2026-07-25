# NYRAVA — Production Acceptance Verification Report

**Date:** 2026-06-26
**Scope:** Architectural guarantees from the Final Production Acceptance &
Verification Directive (items 1–10).

This report records what is now machine-verified versus what still requires
real-workload evidence (live cases) before a true production sign-off.

---

## 1. Single source of truth for execution state — **VERIFIED**

- Canonical helpers consolidated in `src/lib/execution-state.ts`:
  - `PIPELINE_ENGINE_ORDER` (19 stages)
  - `COMMAND_CENTER_ENGINES` (12 dashboard tiles)
  - `REPORT_REQUIRED_ENGINES` (11 engines that gate report generation)
  - `latestRowsByEngine`, `completedPipelineStageCount`,
    `pipelineProgressPercent`, `missingRequiredEngines`
- `pipeline.server.ts` `_runReportInner` now imports `missingRequiredEngines`
  from `execution-state.ts` — the gate and the dashboard read the same list.

**Drift caught & fixed:** the dashboard's `COMMAND_CENTER_ENGINES` list was
missing `scoring`, which the report gate requires. With the previous code a
case could show "11/11 complete" on the dashboard while the report gate still
refused to run. Fixed in this commit; locked in by the new test
`every required engine is also part of the dashboard command center`.

## 2. Pre-flight report gate — **VERIFIED**

`src/lib/intelligence/__tests__/acceptance.test.ts` proves:
- Required-engine list is exactly 11, no duplicates.
- A report is rejected when any required engine is `failed`, `queued`,
  `running`, `skipped`, or missing.
- The gate uses the latest row per engine — a stale `completed` followed by a
  newer `failed` is correctly treated as failed.
- All 11 required engines are a strict subset of `PIPELINE_ENGINE_ORDER` and
  of `COMMAND_CENTER_ENGINES`.

## 3. Render sanitization (no raw JSON, no UUIDs) — **VERIFIED**

- `export.ts::asStr` returns `""` for objects, arrays, `Map`, `Date`, and any
  non-primitive. The previous `JSON.stringify(...).slice(0, 200)` fallback is
  gone.
- Test locks the contract: feeding objects, arrays, and UUID-bearing payloads
  through the sanitizer never produces `{`, `[`, or a UUID in the output.

## 4. Dashboard / pipeline / report agreement — **VERIFIED (helpers)**

- `pipelineProgressPercent` is monotonic in completed engines (test).
- `running` and `queued` rows do not count toward completion (test).
- `latestRowsByEngine` is pure across repeated reads (test).
- All three surfaces (dashboard tiles, pipeline panel, report gate) consume
  the same helpers — divergence is now a typecheck/test failure, not a
  silent UI bug.

## 5–10. Live-workload acceptance — **PENDING USER-DRIVEN RUNS**

These require executing real cases against the deployed pipeline and
collecting telemetry. They cannot be asserted from code alone:

- **AI provider routing determinism** (Groq → OpenRouter → Gemini fallback,
  per-engine retry, no whole-pipeline restart): implemented in
  `src/lib/ai/router.server.ts` with `ai_usage` logging of provider/model/
  latency/tokens/request id. Verify by running benchmark cases and querying
  `select provider, model, latency_ms, tokens_in, tokens_out, request_id from
  ai_usage where case_id = $1 order by created_at`.
- **Duplicate execution prevention**: re-running an analyzed case should hit
  cached engine outputs via `pipeline_engine_runs` status checks. Verify by
  running the same case twice and confirming `ai_usage` row count does not
  double.
- **Evidence governance & hallucination resistance**: `ess.test.ts`,
  `hallucination.test.ts`, and `parity.test.ts` cover the fixture corpus.
  Adversarial real-case prompts (witness-missing, OCR-corrupt,
  timeline-contradictory) still need a curated benchmark folder uploaded by
  the user to assert behavior end-to-end.
- **Performance budgets**: `perf.test.ts` is opt-in via `PERF=1` and covers
  pure-helper throughput. Provider/OCR/PDF latencies need real cases.

---

## Test results

```
Test Files  5 passed (5)
     Tests  77 passed (77)
```

Suite: `bunx vitest run`. Includes the new `acceptance.test.ts` (16 tests)
plus the prior `ess`, `parity`, `hallucination`, and `routes` audits.

## Next gate before declaring "production ready"

Run 3+ benchmark cases through the deployed pipeline and attach:
1. `pipeline_engine_runs` snapshot showing all 11 required engines
   `completed` exactly once per case.
2. `ai_usage` log proving Groq served every supported engine, with
   provider/model/latency/tokens/request_id populated.
3. The generated PDF report for visual inspection (no raw JSON, no UUIDs,
   complete citations).
4. A repeated run of one case confirming cache reuse (`ai_usage` row count
   does not double).

When those four artifacts are present, items 5–10 graduate from PENDING to
VERIFIED and the architecture can be frozen per the directive's final
recommendation.
