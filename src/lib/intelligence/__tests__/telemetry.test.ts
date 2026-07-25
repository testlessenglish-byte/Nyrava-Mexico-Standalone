import { describe, it, expect } from "vitest";
import {
  withTelemetryScope,
  pushTelemetryCall,
  summarizeScope,
  currentTelemetryScope,
  addReplayHints,
} from "@/lib/ai/telemetry.server";


describe("telemetry scope", () => {
  it("aggregates multiple router calls into a single summary", async () => {
    const { scope, value } = await withTelemetryScope(
      { runId: "run-1", replay: { engine: "theory" } },
      async () => {
        pushTelemetryCall({
          ts: 1, provider: "groq", providerId: "p1", model: "llama-4",
          ok: true, latencyMs: 800, providerLatencyMs: 780,
          inputTokens: 100, outputTokens: 50, totalTokens: 150,
          retryCount: 1, retryReasons: ["HTTP 429"],
          providerRequestId: "req-a",
        });
        pushTelemetryCall({
          ts: 2, provider: "gemini", providerId: "p2", model: "gemini-2.0-flash",
          ok: true, latencyMs: 200, providerLatencyMs: 195,
          inputTokens: 80, outputTokens: 30, totalTokens: 110,
          providerRequestId: "req-b",
          fellBackFrom: ["groq"],
        });
        addReplayHints({ prompt_version: "theory_v3", temperature: 0.3 });
        return "ok";
      },
    );
    expect(value).toBe("ok");
    const s = summarizeScope(scope);
    expect(s.totalCalls).toBe(2);
    expect(s.successCalls).toBe(2);
    expect(s.tokensIn).toBe(180);
    expect(s.tokensOut).toBe(80);
    expect(s.tokensTotal).toBe(260);
    expect(s.retryCount).toBe(1);
    expect(s.retryReasons).toEqual(["HTTP 429"]);
    // Provider/model reflect the LAST successful call (the one that
    // produced the payload); telemetry never lies about which model ran.
    expect(s.provider).toBe("gemini");
    expect(s.model).toBe("gemini-2.0-flash");
    expect(s.providerRequestIds.sort()).toEqual(["req-a", "req-b"]);
    expect(s.fellBackFrom).toEqual(["groq"]);
    expect(s.costUsd).toBeGreaterThan(0);
    expect(scope.replay.prompt_version).toBe("theory_v3");
    expect(scope.replay.engine).toBe("theory");
  });

  it("records failures without inflating success counts", async () => {
    const { scope } = await withTelemetryScope({ runId: "run-2" }, async () => {
      pushTelemetryCall({
        ts: 1, provider: "openai", providerId: "p3", model: "gpt-4o-mini",
        ok: false, latencyMs: 50, error: "HTTP 429 rate_limit", errorKind: "quota",
      });
      pushTelemetryCall({
        ts: 2, provider: "gemini", providerId: "p2", model: "gemini-2.0-flash",
        ok: true, latencyMs: 300, inputTokens: 10, outputTokens: 5, totalTokens: 15,
        fellBackFrom: ["openai"],
      });
    });
    const s = summarizeScope(scope);
    expect(s.successCalls).toBe(1);
    expect(s.failedCalls).toBe(1);
    expect(s.errors[0].kind).toBe("quota");
    expect(s.fellBackFrom).toEqual(["openai"]);
    // Provider is the LAST successful call, not the first failed one.
    expect(s.provider).toBe("gemini");
  });

  it("pushTelemetryCall is a no-op outside a scope", () => {
    // Should not throw even though no scope is active
    pushTelemetryCall({
      ts: 1, provider: "groq", providerId: "x", model: "y",
      ok: true, latencyMs: 1,
    });
    expect(currentTelemetryScope()).toBeUndefined();
  });
});
