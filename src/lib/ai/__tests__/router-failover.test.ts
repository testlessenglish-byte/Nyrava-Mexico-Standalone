// Regression test for full key/provider rotation on failure: "make sure
// that when a key fails it falls to the next one no matter [the] provider —
// they rotate through every key in the system that is logged in."
//
// Exercises the REAL routeAI() against a simulated user with 2 Groq keys and
// 2 Gemini keys (matching a real reported configuration), mocking only the
// two genuine I/O seams — the provider factory (buildProvider/resolveApiKey,
// so no real HTTP call is made) and the Supabase admin client used to load
// ai_providers/user_ai_keys — so the actual chain-building, per-key
// rotation, and failover logic in router.server.ts runs unmodified.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/providers/factory", () => ({
  buildProvider: vi.fn(),
  resolveApiKey: vi.fn(() => null),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/canonical/encryption.server", () => ({
  // Test keys are already plaintext — identity passthrough.
  decryptKey: (k: string) => k,
}));

import { buildProvider } from "@/lib/ai/providers/factory";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeAI, invalidateProviderCaches } from "@/lib/ai/router.server";
import { clearProviderCooldowns } from "@/lib/ai/cooldown.server";

const USER_ID = "user-router-test";

const GROQ_KEY_1 = "groq-key-1";
const GROQ_KEY_2 = "groq-key-2";
const GEMINI_KEY_1 = "gemini-key-1";
const GEMINI_KEY_2 = "gemini-key-2";

function chain(resolveValue: unknown) {
  const c: Record<string, unknown> = {
    eq: () => c,
    order: () => c,
    then: (resolve: (v: unknown) => void) => resolve({ data: resolveValue, error: null }),
  };
  return c;
}

/** Simulates a user with 2 active Groq keys and 2 active Gemini keys. Accepts
 *  an override key set so a test can use brand-new key strings — the
 *  round-robin start position is keyed by key fingerprint (cursorKey()) and
 *  its cursor persists across tests within this file, so a test that cares
 *  which key goes first needs fingerprints no earlier test has touched. */
function mockSupabase(keys?: { groq1: string; groq2: string; gemini1: string; gemini2: string }) {
  const k = keys ?? {
    groq1: GROQ_KEY_1,
    groq2: GROQ_KEY_2,
    gemini1: GEMINI_KEY_1,
    gemini2: GEMINI_KEY_2,
  };
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ai_providers") return chain([]) as never;
    if (table === "user_ai_keys") {
      return chain([
        {
          provider: "groq",
          encrypted_key: k.groq1,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          provider: "groq",
          encrypted_key: k.groq2,
          is_active: true,
          created_at: "2026-01-02T00:00:00Z",
        },
        {
          provider: "gemini",
          encrypted_key: k.gemini1,
          is_active: true,
          created_at: "2026-01-03T00:00:00Z",
        },
        {
          provider: "gemini",
          encrypted_key: k.gemini2,
          is_active: true,
          created_at: "2026-01-04T00:00:00Z",
        },
      ]) as never;
    }
    throw new Error(`unexpected table in fake supabaseAdmin: ${table}`);
  });
}

type KeyBehavior = { fail?: () => Error };

/** Wires buildProvider so each distinct API key's chat() call behaves as
 *  configured in `behaviors`, and every actual call is recorded in `calls`. */
function mockProviderFactory(behaviors: Record<string, KeyBehavior>, calls: string[]) {
  vi.mocked(buildProvider).mockImplementation((row, apiKeyOverride) => {
    const key = apiKeyOverride ?? "(env)";
    return {
      type: row.provider_type,
      capabilities: {
        jsonMode: true,
        reasoning: false,
        streaming: false,
        toolCalling: false,
        vision: false,
        maxContextTokens: 100_000,
      },
      chat: async () => {
        calls.push(key);
        const behavior = behaviors[key];
        if (behavior?.fail) throw behavior.fail();
        return {
          text: `response from ${key}`,
          model: `${row.provider_type}-test-model`,
          latencyMs: 5,
        };
      },
      testConnection: async () => ({ ok: true, latencyMs: 1 }),
    } as never;
  });
}

beforeEach(() => {
  invalidateProviderCaches();
  clearProviderCooldowns();
  vi.mocked(buildProvider).mockReset();
  mockSupabase();
});

describe("routeAI: rotates through every key across every provider on failure", () => {
  // Auth (401/403) and quota (429) failures are classified as non-retryable
  // per-key faults and fail over to the next chain entry immediately (see
  // router.server.ts's isRateLimit/isTransport classification) — used here
  // so these tests run fast and deterministically. A separate test below
  // covers the transport/timeout path, which legitimately retries the SAME
  // key with backoff before failing over and so takes real wall-clock time.
  it("falls through 3 failing keys (two auth, one quota — spanning both providers) to the 4th, healthy key", async () => {
    const calls: string[] = [];
    mockProviderFactory(
      {
        [GROQ_KEY_1]: { fail: () => new Error("HTTP 401 invalid_api_key") },
        [GROQ_KEY_2]: { fail: () => new Error("HTTP 403 forbidden") },
        [GEMINI_KEY_1]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        // GEMINI_KEY_2 has no configured failure — succeeds.
      },
      calls,
    );

    const result = await routeAI({ userContent: "test question", userId: USER_ID });

    expect(result.text).toBe(`response from ${GEMINI_KEY_2}`);
    // Every other key was actually attempted (a real chat() call was made)
    // before the router reached the one that worked — this is the "no
    // matter [the] provider, rotate through every key" guarantee.
    expect(new Set(calls)).toEqual(new Set([GROQ_KEY_1, GROQ_KEY_2, GEMINI_KEY_1, GEMINI_KEY_2]));
  });

  it("fails only after every configured key across every provider has been tried, and says so", async () => {
    const calls: string[] = [];
    mockProviderFactory(
      {
        [GROQ_KEY_1]: { fail: () => new Error("HTTP 401 invalid_api_key") },
        [GROQ_KEY_2]: { fail: () => new Error("HTTP 403 forbidden") },
        [GEMINI_KEY_1]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        [GEMINI_KEY_2]: { fail: () => new Error("HTTP 401 invalid_api_key") },
      },
      calls,
    );

    await expect(routeAI({ userContent: "test question", userId: USER_ID })).rejects.toThrow(
      /All configured provider keys failed/,
    );
    expect(new Set(calls)).toEqual(new Set([GROQ_KEY_1, GROQ_KEY_2, GEMINI_KEY_1, GEMINI_KEY_2]));
  });

  it("does not touch keys after one that already succeeds", async () => {
    const calls: string[] = [];
    // Whichever key the round-robin cursor starts on this call succeeds —
    // no configured failures at all, so no key should be tried twice and no
    // OTHER key should be touched once one succeeds.
    mockProviderFactory({}, calls);

    const result = await routeAI({ userContent: "test question", userId: USER_ID });

    expect(calls).toHaveLength(1);
    expect(result.text).toBe(`response from ${calls[0]}`);
  });

  it("finds the one healthy key even when it sits in the middle of the chain (Groq key #2), not just at the very end", async () => {
    // Deterministic regardless of which key the round-robin cursor starts
    // on: 3 of the 4 configured keys fail, so ALL of them must eventually
    // be tried before the router can land on the single survivor.
    const calls: string[] = [];
    mockProviderFactory(
      {
        [GROQ_KEY_1]: { fail: () => new Error("HTTP 401 invalid_api_key") },
        [GEMINI_KEY_1]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        [GEMINI_KEY_2]: { fail: () => new Error("HTTP 403 forbidden") },
        // GROQ_KEY_2 has no configured failure — succeeds.
      },
      calls,
    );

    const result = await routeAI({ userContent: "test question", userId: USER_ID });

    expect(result.text).toBe(`response from ${GROQ_KEY_2}`);
    expect(new Set(calls)).toEqual(new Set([GROQ_KEY_1, GEMINI_KEY_1, GEMINI_KEY_2, GROQ_KEY_2]));
  });

  it("retries a transport/timeout failure on the SAME key with backoff, then still fails over to the next key", async () => {
    // Fresh key strings, never used by an earlier test in this file — the
    // round-robin start position is cursored by key fingerprint and that
    // cursor persists across tests, so reusing GROQ_KEY_1/2 here would make
    // which key goes first (and therefore this assertion) depend on
    // whatever earlier tests already advanced the cursor to.
    const freshGroq1 = "groq-key-transport-1";
    const freshGroq2 = "groq-key-transport-2";
    mockSupabase({
      groq1: freshGroq1,
      groq2: freshGroq2,
      gemini1: GEMINI_KEY_1,
      gemini2: GEMINI_KEY_2,
    });

    const calls: string[] = [];
    mockProviderFactory(
      {
        [freshGroq1]: { fail: () => new Error("ETIMEDOUT: connection timed out") },
        // Every other key has no configured failure — the first one tried
        // after this key exhausts its retries succeeds.
      },
      calls,
    );

    const result = await routeAI({ userContent: "test question", userId: USER_ID });

    // The failing key was retried (backoff) rather than abandoned after one
    // failure, but the run still recovered on a different key afterward.
    expect(calls.filter((c) => c === freshGroq1).length).toBeGreaterThan(1);
    expect(result.text).toBe(`response from ${calls[calls.length - 1]}`);
    expect(calls[calls.length - 1]).not.toBe(freshGroq1);
  }, 10_000);
});
