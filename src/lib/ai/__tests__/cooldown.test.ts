// Regression test for a live stuck-report incident: a report stage looped
// every ~40s for 20+ cycles against an already-exhausted-for-the-day
// Gemini free-tier key, never leaving enough checkpoint budget for the
// working OpenRouter fallback to complete. Root cause: markProviderCooldown
// trusted a short Retry-After header (or a "try again in Ns" hint parsed
// from the message text) over the smarter daily-exhaustion detection,
// which was only ever consulted as a last resort *default* — never
// overriding an explicit or parsed hint. Fixed by making daily/free-tier
// request-count exhaustion win regardless of what hint accompanies it,
// for reason:"quota" specifically.
import { describe, it, expect, beforeEach } from "vitest";
import { markProviderCooldown, getProviderCooldown, clearProviderCooldowns } from "@/lib/ai/cooldown.server";

describe("markProviderCooldown: daily/free-tier exhaustion overrides short retry hints", () => {
  beforeEach(() => {
    clearProviderCooldowns();
  });

  it("uses the long daily cooldown for a free-tier request-count 429, even with a short explicit retryAfterMs (the exact live bug)", () => {
    const cd = markProviderCooldown({
      provider: "gemini",
      model: "gemini-3.6-flash",
      key: "key-1",
      reason: "quota",
      message: "HTTP 429 generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash",
      // This mirrors gemini.ts parsing a short HTTP Retry-After header —
      // previously this value alone decided the cooldown duration.
      retryAfterMs: 40_000,
    });
    // 15 minutes (DEFAULT_DAILY_QUOTA_MS), not the 40s hint.
    expect(cd.retryAfterMs).toBeGreaterThan(10 * 60_000);
    expect(cd.retryAfterMs).toBe(15 * 60_000);
  });

  it("uses the long daily cooldown even when the retry hint is embedded in the message text instead of passed explicitly", () => {
    const cd = markProviderCooldown({
      provider: "gemini",
      model: "gemini-3.6-flash",
      key: "key-2",
      reason: "quota",
      message: "HTTP 429 generate_content_free_tier_requests, limit: 20. Please retry in 38s.",
    });
    expect(cd.retryAfterMs).toBe(15 * 60_000);
  });

  it("still recognizes the original explicit daily-language pattern ('requests per day')", () => {
    const cd = markProviderCooldown({
      provider: "openrouter",
      reason: "quota",
      message: "429 Too Many Requests: exceeded 1000 requests per day",
      retryAfterMs: 5_000,
    });
    expect(cd.retryAfterMs).toBe(15 * 60_000);
  });

  it("does NOT escalate an ordinary per-minute 429 with no daily/free-tier signal — preserves the existing short-cooldown behavior", () => {
    const cd = markProviderCooldown({
      provider: "groq",
      reason: "quota",
      message: "HTTP 429 rate limit exceeded, try again in 12s",
    });
    // The parsed 12s hint should still be honored — no daily override.
    expect(cd.retryAfterMs).toBeLessThan(60_000);
    expect(cd.retryAfterMs).toBe(12_000);
  });

  it("does not apply the daily-exhaustion override to non-quota reasons (rate_limit/payment/transport)", () => {
    const rateLimit = markProviderCooldown({
      provider: "groq",
      reason: "rate_limit",
      message: "free_tier_requests limit exceeded", // daily-shaped text, wrong reason
      retryAfterMs: 5_000,
    });
    expect(rateLimit.retryAfterMs).toBe(5_000);

    const payment = markProviderCooldown({
      provider: "openai",
      reason: "payment",
      message: "free_tier_requests billing issue",
    });
    // Payment gets its own fixed default (30 min), unaffected by the quota-only override.
    expect(payment.retryAfterMs).toBe(30 * 60_000);
  });

  it("getProviderCooldown reflects the escalated daily cooldown for subsequent lookups on the same key", () => {
    markProviderCooldown({
      provider: "gemini",
      model: "gemini-3.6-flash",
      key: "key-3",
      reason: "quota",
      message: "generate_content_free_tier_requests, limit: 20",
      retryAfterMs: 40_000,
    });
    const looked_up = getProviderCooldown({ provider: "gemini", model: "gemini-3.6-flash", key: "key-3" });
    expect(looked_up).not.toBeNull();
    expect(looked_up!.retryAfterMs).toBeGreaterThan(14 * 60_000); // just under 15 min due to elapsed time
  });
});
