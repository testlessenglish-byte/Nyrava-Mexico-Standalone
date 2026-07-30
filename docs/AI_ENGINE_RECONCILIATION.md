# AI Execution Engine — México ⇄ U.S. Reconciliation

Scope: `src/lib/ai/router.server.ts`, `src/lib/ai/provider.server.ts`,
`src/lib/ai/providers/gemini.ts`, `src/lib/execution/canonical.ts`.
U.S. source compared: archive extracted to `/tmp/us` (Nyrava Intelligence app).

## Step 1 — Documented drift

### router.server.ts (MX 1317 lines / US 786)
México is ahead on every infrastructure axis; the U.S. version is the older base.

| Capability | MX | US | Direction |
|---|---|---|---|
| Per-provider/per-key cooldown ledger (`cooldown.server.ts`) | yes | absent | MX → US |
| `retry-after` parsing + `router.cooldown_wait` re-entry (max 3 waits, ≤95s) | yes | no | MX → US |
| Pre-flight request sizing + `fitOptsToBudget` compression | yes | no | MX → US |
| `PROVIDER_INPUT_TOKEN_BUDGET` (Groq 5.5k for the 8k TPM ceiling) | yes | no | MX → US |
| `MAX_LOGICAL_PROVIDER_ATTEMPTS` real-attempt cap | yes | partial | MX → US |
| Failure classification `payload_too_large` / `quota` / `auth` / `other` | yes | yes (coarser) | MX → US |
| Same-provider key-skip on 413 (payload errors are not per-key) | yes | no | MX → US |
| `pipeline_trace` telemetry (`router.served`, `router.attempt_failed`, `router.exhausted`) | yes | no | MX → US (needs trace table or shim) |
| Groq organization-level exhaustion parsing | yes | no | MX → US |
| Legacy in-place hinted-429 retry loop | removed | present | intentionally NOT ported back — superseded by the cooldown ledger |

Nothing in the U.S. router exists that México lacks; the only U.S.-only code is
the legacy retry loop that the cooldown ledger replaces.

### provider.server.ts
Does not exist in the U.S. app. In México it is now a pure translation layer
over `routeAI` (OpenAI-style `messages[]` in, router out). See Step 3.

### providers/gemini.ts (MX 237 / US 80)
MX-only: `GEMINI_MODEL_FALLBACKS` ladder for 404/429, process-local
`UNUSABLE_MODELS` set, `traceAsync` telemetry, checkpoint-budget assertions
before each call. US-only: nothing. Direction: MX → US.

### execution/canonical.ts (MX 504 / US 465)
MX-only stages: `jurisdiction_intel` (blocking), `procedural_compliance`
(enriching), `legal_qa` (blocking terminal gate); `report` depends on
`legal_qa` + `jurisdiction_intel`. These are Mexican legal requirements and are
**not** ported to the U.S. app. US-only stages retained there
(`discovery`, `constitutional` US variant) are jurisdiction-specific and stay.
The generic improvement in this file — a declared per-stage `timeoutMs` ceiling
plus the guard that enforces it — applies to both platforms.

## Step 2 — Merge outcome

- **MX side:** already ahead on all four files. The one real gap found and fixed:
  `pipeline-runner.server.ts` called `runLegalQaGate` **without** `userId`, so QA
  translation remediation ran off platform credits instead of the caller's own
  provider keys (the other runner, `pipeline.server.ts`, passed it). Fixed.
- **US side:** a ready-to-apply port bundle lives in `docs/us-port/`. It contains
  the MX router, cooldown ledger, Gemini adapter with the fallback ladder, a
  no-DB `pipeline-trace.server.ts` shim (the U.S. app has no `pipeline_trace`
  table), and the canonical timeout guard. See `docs/us-port/README.md`.

## Step 3 — Gateway bypass confirmation

`rg "ai.gateway.lovable|LOVABLE_API_KEY" src` returns **only comment lines** in
`src/lib/ai/provider.server.ts` describing the removed behaviour. There is no
gateway URL, no `LOVABLE_API_KEY` read, and no provider selection outside
`routeAI`. Every AI call in the platform resolves providers from `ai_providers`
plus the caller's `user_ai_keys`, and is billed/accounted through the router.

## Step 4 — Blocking-stage risk in canonical.ts

`jurisdiction_intel` and `legal_qa` block `report` and previously had no
wall-clock ceiling: a stalled corpus read or translation call left the case
pinned in `running` with nothing in the ledger.

- `StageDef.timeoutMs` added in `canonical.ts`;
  `jurisdiction_intel` = 120 s, `legal_qa` = 480 s. Helpers: `stageTimeoutMs()`,
  `STAGE_TIMEOUT_MS`.
- `src/lib/execution/blocking-stage-guard.server.ts` wraps both stage bodies
  (`withStageTimeout`): logs `stage.enter` / `stage.exit` / `stage.failed` to
  console **and** `pipeline_trace`, races the body against the ceiling, and
  throws `StageTimeoutError` on overrun.
- Failure is loud: the error propagates to `runCatalogedEngine`, the stage is
  recorded `failed` (never `completed`, never silently skipped), and every
  dependent stage — including `report` — is marked `blocked` with the timeout
  reason visible in the ledger and the case UI.
- Both runners (`pipeline.server.ts`, `pipeline-runner.server.ts`) are wired.

## Concurrency & lease audit (2026-07-30)

Every execution path that can start AI work was enumerated and checked.

| Path | Case lease | Per-user cap | Release on failure |
|---|---|---|---|
| `runFullPipelineStep` | `claimPipelineLease` (CAS) | `assertUserPipelineCapacity` | runner wrapper + terminal status |
| `runFullIntelligenceStep` (legacy) | `claimPipelineLease` | yes | same |
| `runLabeledStep` (all individual stage buttons) | `assertCaseNotLeased` | yes | n/a (no lease taken) |
| `driveCaseTick` (browser-driven tick) | inline CAS | yes | runner wrapper |
| `pipeline-worker` cron | CAS lease | `checkUserPipelineCapacity` → defer | error path nulls lease |
| `resumePipeline` / `retryStage` endpoints | active-lease check → requeue | worker enforces cap | worker |
| `uploadVerificationDocument` background extraction | `getActiveCaseLease` guard | yes | fire-and-forget, no lease held |
| Talk-to-Case chat, voice speak/transcribe, motion preview | exempt (interactive, single short call, no case state writes) | n/a | n/a |
| `engines.functions.runEngine`, `processDocumentJob`, `regenerateCanonical` | matter/job-scoped, no case pipeline; no engine loop | n/a | n/a |

Provider layer: `routeAI` → `provider.server.ts` → `providers/*` is strictly
sequential (try key/provider, on failure advance). No `Promise.all/any` over
providers anywhere, so fallback cannot create a second concurrent execution.
`blocking-stage-guard.server.ts` uses `Promise.race` only against a timer.

Residual risk: a stage that exceeds its `timeoutMs` cannot be hard-killed
(JS has no cancellation); the guard fails the case loudly and the lease is
released, so the slot is freed even though the orphaned call may finish.

Logging: all lease decisions emit a single-line JSON `[lease] {...}` record
with `event`, `path`, `case_id`, `user_id`, `lease_until`,
`active_pipelines`, `limit`, `reason`. Worker defers also write
`worker.capacity_deferred` to `pipeline_trace`.
