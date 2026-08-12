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
//
// audit B8: every routeAI() call below passes `cache: false`. routeAI's
// response cache (router.server.ts's module-level `_cache`) is keyed only
// by (model, systemInstruction, userContent, json, temperature) — not by
// userId or provider config — and every test here calls routeAI with the
// identical userContent ("test question"). Without cache:false, whichever
// test runs first populates that shared key and every later test in this
// file silently gets its cached response back instead of exercising the
// mocked provider factory at all — invalidateProviderCaches() in
// beforeEach does NOT clear this cache (it only clears the provider-row
// and user-provider-group caches), so it did not help.
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

import { createHash } from "node:crypto";
import { buildProvider } from "@/lib/ai/providers/factory";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeAI, invalidateProviderCaches } from "@/lib/ai/router.server";
import { clearProviderCooldowns, markProviderCooldown } from "@/lib/ai/cooldown.server";

/** Mirrors router.server.ts's private keyFingerprint() so a test can seed a
 *  cooldown entry that the router's own lookup will actually match. */
function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

const USER_ID = "user-router-test";

const GROQ_KEY_1 = "groq-key-1";
const GROQ_KEY_2 = "groq-key-2";
const GEMINI_KEY_1 = "gemini-key-1";
const GEMINI_KEY_2 = "gemini-key-2";

// audit B8 (stale mock → real bug this masked): the round-robin cursor is
// keyed by key fingerprint and persists across tests in this file (see
// mockSupabase()'s docstring below), so any two tests sharing a key string
// are order-dependent on each other. Before the select() mock fix above,
// every test crashed before reaching the cursor logic, so this never
// actually ran — fixing the crash exposed it. Each test now gets its own
// never-reused key set via freshKeys(), the same pattern the original
// author already used for the two lower tests (originally the only ones
// that actually needed to pass reliably, since the others never ran).
let freshKeyCounter = 0;
function freshKeys() {
  const n = ++freshKeyCounter;
  return {
    groq1: `groq-key-${n}-a`,
    groq2: `groq-key-${n}-b`,
    gemini1: `gemini-key-${n}-a`,
    gemini2: `gemini-key-${n}-b`,
  };
}

function chain(resolveValue: unknown) {
  const c: Record<string, unknown> = {
    // audit B8: router.server.ts's loadProviderRows() calls
    // .from("ai_providers").select(...).order(...) — select() was missing
    // from this fake chain, so every test in this file failed before
    // reaching the actual rotation logic under test.
    select: () => c,
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
    const k = freshKeys();
    mockSupabase(k);
    const calls: string[] = [];
    mockProviderFactory(
      {
        [k.groq1]: { fail: () => new Error("HTTP 401 invalid_api_key") },
        [k.groq2]: { fail: () => new Error("HTTP 403 forbidden") },
        [k.gemini1]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        // gemini2 has no configured failure — succeeds.
      },
      calls,
    );

    const result = await routeAI({ userContent: "test question", userId: USER_ID, cache: false });

    expect(result.text).toBe(`response from ${k.gemini2}`);
    // Every other key was actually attempted (a real chat() call was made)
    // before the router reached the one that worked — this is the "no
    // matter [the] provider, rotate through every key" guarantee.
    expect(new Set(calls)).toEqual(new Set([k.groq1, k.groq2, k.gemini1, k.gemini2]));
  });

  it("fails only after every configured key across every provider has been tried, and says so", async () => {
    const k = freshKeys();
    mockSupabase(k);
    const calls: string[] = [];
    mockProviderFactory(
      {
        [k.groq1]: { fail: () => new Error("HTTP 401 invalid_api_key") },
        [k.groq2]: { fail: () => new Error("HTTP 403 forbidden") },
        [k.gemini1]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        [k.gemini2]: { fail: () => new Error("HTTP 401 invalid_api_key") },
      },
      calls,
    );

    await expect(routeAI({ userContent: "test question", userId: USER_ID, cache: false })).rejects.toThrow(
      /All configured provider keys failed/,
    );
    expect(new Set(calls)).toEqual(new Set([k.groq1, k.groq2, k.gemini1, k.gemini2]));
  });

  it("does not touch keys after one that already succeeds", async () => {
    const k = freshKeys();
    mockSupabase(k);
    const calls: string[] = [];
    // Whichever key the round-robin cursor starts on this call succeeds —
    // no configured failures at all, so no key should be tried twice and no
    // OTHER key should be touched once one succeeds.
    mockProviderFactory({}, calls);

    const result = await routeAI({ userContent: "test question", userId: USER_ID, cache: false });

    expect(calls).toHaveLength(1);
    expect(result.text).toBe(`response from ${calls[0]}`);
  });

  it("finds the one healthy key even when it sits in the middle of the chain (Groq key #2), not just at the very end", async () => {
    // audit B8 (stale test, not just stale mock): the original assertion
    // here claimed "3 of the 4 configured keys fail, so ALL of them must
    // eventually be tried" — that's not actually a correct invariant. The
    // router stops as soon as it finds a working key; with a fresh cursor
    // (provider priority, then created_at within a provider — see
    // mockSupabase()) it reaches groq1 first, then groq2, so once groq2
    // (the middle key, this test's actual subject) succeeds the router
    // never touches the gemini keys at all — correct behavior, not a bug.
    // Only groq1 needs to fail for groq2 to be reached "in the middle,
    // not at the very end" (2nd of 4 configured keys, not last).
    const k = freshKeys();
    mockSupabase(k);
    const calls: string[] = [];
    mockProviderFactory(
      {
        [k.groq1]: { fail: () => new Error("HTTP 401 invalid_api_key") },
        // groq2, gemini1, gemini2 have no configured failure.
      },
      calls,
    );

    const result = await routeAI({ userContent: "test question", userId: USER_ID, cache: false });

    expect(result.text).toBe(`response from ${k.groq2}`);
    expect(calls).toEqual([k.groq1, k.groq2]);
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

    const result = await routeAI({ userContent: "test question", userId: USER_ID, cache: false });

    // The failing key was retried (backoff) rather than abandoned after one
    // failure, but the run still recovered on a different key afterward.
    expect(calls.filter((c) => c === freshGroq1).length).toBeGreaterThan(1);
    expect(result.text).toBe(`response from ${calls[calls.length - 1]}`);
    expect(calls[calls.length - 1]).not.toBe(freshGroq1);
  }, 10_000);

  it("still reaches a provider whose keys are on an unrelated cooldown once every OTHER provider has genuinely failed", async () => {
    // Real reported bug: Gemini gets attempted and fails for its OWN fresh
    // reason (a quota 429 on this very call), while Groq's keys are sitting
    // on an unrelated, already-active cooldown from an earlier failure — and
    // the router gave up reporting "tried: gemini ... configured but never
    // attempted: groq" because the ignore-cooldowns retry only fired when
    // NOTHING had been attempted at all (attemptedProviders.size === 0).
    // Confirmed live twice on a real case (Amparo Directo en Revisión —
    // Carlos Alan Espíndola García), on two different agents
    // (authority_notification_validation, then
    // constitutional_controversy_analysis), even after the compressed-retry
    // cascade fix — because that fix only covers SIZE-skipped providers,
    // not cooldown-skipped ones.
    const freshGroq1 = "groq-key-cooldown-1";
    const freshGroq2 = "groq-key-cooldown-2";
    mockSupabase({
      groq1: freshGroq1,
      groq2: freshGroq2,
      gemini1: GEMINI_KEY_1,
      gemini2: GEMINI_KEY_2,
    });

    // Both Groq keys already cooling down BEFORE this call even starts —
    // simulates a cooldown set by an earlier, unrelated agent's failure.
    markProviderCooldown({
      provider: "groq",
      model: null,
      key: keyFingerprint(freshGroq1),
      reason: "quota",
      message: "pre-existing cooldown from an earlier unrelated call",
    });
    markProviderCooldown({
      provider: "groq",
      model: null,
      key: keyFingerprint(freshGroq2),
      reason: "quota",
      message: "pre-existing cooldown from an earlier unrelated call",
    });

    const calls: string[] = [];
    mockProviderFactory(
      {
        [GEMINI_KEY_1]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        [GEMINI_KEY_2]: { fail: () => new Error("HTTP 429 rate limit exceeded") },
        // Neither Groq key has a configured failure — once actually reached,
        // whichever one the router tries first succeeds.
      },
      calls,
    );

    const result = await routeAI({ userContent: "test question", userId: USER_ID, cache: false });

    expect(calls).toContain(GEMINI_KEY_1);
    expect(calls).toContain(GEMINI_KEY_2);
    // The real assertion: a cooldown-skipped provider was NOT left
    // permanently unreached once the only non-cooling providers had all
    // genuinely failed.
    expect(calls.some((c) => c === freshGroq1 || c === freshGroq2)).toBe(true);
    expect([freshGroq1, freshGroq2]).toContain(result.text.replace("response from ", ""));
  });
});
