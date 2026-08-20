import { describe, expect, it } from "vitest";

import { providerCallsForRun, summarizeProviderUsage, type EngineRun } from "../LivePipelinePanel";

const baseRun: EngineRun = {
  id: "run-1",
  engine: "agents",
  status: "completed",
  runtime_ms: 10,
  generated: 0,
  accepted: 0,
  rejected: 0,
  suppressed_ess: 0,
  suppressed_validator: 0,
  provider: "openrouter",
  model: "legacy-model",
  tokens_in: 999,
  tokens_out: 1,
  retry_count: 0,
  cost_usd: 0,
  db_write_confirmed: true,
  rows_written: 0,
  blocking_engines: null,
  error: null,
  skipped_reason: null,
  meta: {
    telemetry: {
      provider_calls: [
        { provider: "groq", model: "g", ok: false, input_tokens: 10, output_tokens: 0, key_label: "key #1" },
        { provider: "gemini", model: "m", ok: true, input_tokens: 20, output_tokens: 5, key_label: "key #2" },
      ],
    },
  },
  started_at: null,
  ended_at: null,
  created_at: "2026-08-20T00:00:00Z",
};

describe("pipeline provider ledger", () => {
  it("uses actual routed calls instead of the engine's single top-level provider", () => {
    expect(providerCallsForRun(baseRun).map((call) => call.provider)).toEqual(["groq", "gemini"]);
    expect(summarizeProviderUsage([baseRun])).toEqual([
      { provider: "gemini", calls: 1, ok: 1, failed: 0, tokens: 25, keys: ["key #2"] },
      { provider: "groq", calls: 1, ok: 0, failed: 1, tokens: 10, keys: ["key #1"] },
    ]);
  });
});
