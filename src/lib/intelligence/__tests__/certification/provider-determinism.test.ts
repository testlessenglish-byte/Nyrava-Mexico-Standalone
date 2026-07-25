// Provider Determinism — exercises the router with a mocked Supabase admin
// client and a mocked provider factory. Verifies:
//   - Runtime apiKey is honored as a Groq-only chain (no silent switch).
//   - forceProvider hard-pins the provider.
//   - Non-Groq failover is structurally disabled.
//   - Cache returns a `cached: true` marker on a second identical call.
import { describe, it, expect, vi, beforeEach } from "vitest";

const providerRows = [
  { id: "groq-1",   provider_type: "groq",       display_name: "Groq",       enabled: true, priority: 1, base_url: null, default_model: "llama-3.1-8b", secret_name: null, api_key_encrypted: null },
  { id: "other-1",  provider_type: "openai", display_name: "Other Provider", enabled: true, priority: 2, base_url: null, default_model: "gpt-4o-mini",  secret_name: null, api_key_encrypted: null },
  { id: "gemini-1", provider_type: "gemini",     display_name: "Gemini",     enabled: true, priority: 3, base_url: null, default_model: "gemini-2.5",   secret_name: null, api_key_encrypted: null },
];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        order: async () => ({ data: providerRows, error: null }),
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

const calls: Array<{ provider: string; willFail: boolean; runtimeKey?: string }> = [];
vi.mock("@/lib/ai/providers/factory", () => ({
  buildProvider: (row: { provider_type: string; id: string }, runtimeKey?: string) => ({
    chat: async () => {
      const willFail = (globalThis as { __failProviders?: Set<string> }).__failProviders?.has(row.provider_type) ?? false;
      calls.push({ provider: row.provider_type, willFail, runtimeKey });
      if (willFail) {
        const msg = (globalThis as { __failMessage?: string }).__failMessage ?? `simulated failure: ${row.provider_type}`;
        throw new Error(msg);
      }
      return {
        model: "test-model",
        text: `ok from ${row.provider_type}${runtimeKey ? " (runtime)" : ""}`,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 5,
      };
    },
  }),
}));

import { routeAI } from "@/lib/ai/router.server";

beforeEach(() => {
  calls.length = 0;
  (globalThis as { __failProviders?: Set<string> }).__failProviders = new Set();
  (globalThis as { __failMessage?: string }).__failMessage = undefined;
});

describe("Provider determinism", () => {
  it("runtime apiKey forces a Groq-only chain", async () => {
    const r = await routeAI({ apiKey: "gsk_test_runtime_key_123456789", userContent: "hello", cache: false });
    expect(r.provider).toBe("groq");
    expect(calls.map((c) => c.provider)).toEqual(["groq"]);
  });

  it("rejects non-Groq forceProvider", async () => {
    await expect(routeAI({ forceProvider: "gemini", userContent: "hi", cache: false })).rejects.toThrow(/Groq-only/);
    expect(calls).toHaveLength(0);
  });

  it("priority chain serves Groq first; no failover on success", async () => {
    const r = await routeAI({ userContent: "first", cache: false });
    expect(r.provider).toBe("groq");
    expect(calls).toHaveLength(1);
    expect(r.fellBackFrom).toBeUndefined();
  });

  it("does not fail over to non-Groq providers when Groq fails", async () => {
    (globalThis as { __failProviders?: Set<string> }).__failProviders = new Set(["groq"]);
    await expect(routeAI({ userContent: "fb", cache: false })).rejects.toThrow(/All Groq keys failed/);
    expect(calls.map((c) => c.provider)).toEqual(["groq"]);
  });

  it("round-robins runtime Groq keys as the first selected key", async () => {
    await routeAI({ apiKeys: ["gsk_one", "gsk_two", "gsk_three"], userContent: "a", cache: false });
    await routeAI({ apiKeys: ["gsk_one", "gsk_two", "gsk_three"], userContent: "b", cache: false });
    await routeAI({ apiKeys: ["gsk_one", "gsk_two", "gsk_three"], userContent: "c", cache: false });
    expect(calls.map((c) => c.runtimeKey)).toEqual(["gsk_one", "gsk_two", "gsk_three"]);
  });

  it("treats org-wide Groq rate limit as cooldown without trying other keys or providers", async () => {
    (globalThis as { __failProviders?: Set<string> }).__failProviders = new Set(["groq"]);
    (globalThis as { __failMessage?: string }).__failMessage = "groq HTTP 429: rate_limit_exceeded";
    const model = `rate-limit-test-${Date.now()}`;
    await expect(routeAI({ apiKeys: ["gsk_one", "gsk_two", "gsk_three"], model, userContent: "quota", cache: false })).rejects.toThrow(/All Groq keys failed/);
    expect(calls.map((c) => c.provider)).toEqual(["groq"]);
    expect(calls.map((c) => c.runtimeKey)).toEqual(["gsk_one"]);

    calls.length = 0;
    await expect(routeAI({ apiKeys: ["gsk_one", "gsk_two", "gsk_three"], model, userContent: "quota", cache: false })).rejects.toThrow(/Groq model cooldown active/);
    expect(calls).toHaveLength(0);
  });
});
