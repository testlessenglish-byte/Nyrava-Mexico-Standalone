// Regression test for the compressed-retry cascade in routeAI
// (router.server.ts).
//
// Real production failure: a "constitucional" case (Amparo Directo en
// Revisión — Carlos Alan Espíndola García) stalled on the
// authority_notification_validation agent with "All configured provider
// keys failed (tried: gemini ... configured but never attempted: groq,
// openrouter)" after Gemini hit its daily quota (HTTP 429) — even though
// the user had just added fresh Groq keys specifically to unblock it.
//
// Root cause: the agents stage packs batches sized for the widest
// available provider (so Groq's narrow ~5.5k-token budget doesn't force
// 8+ tiny batches per agent — AGENT_SKIP_PROVIDERS in pipeline.server.ts),
// which means Groq and OpenRouter both get pre-flight size-skipped behind
// Gemini on every call. The OLD compressed-retry mechanism only ever
// compressed ONCE, to the single LARGEST skipped budget (OpenRouter's) —
// so once that also failed, the run gave up without ever trying Groq's
// own, much smaller, budget. nextCompressionBudget is the fix: it picks
// the largest skipped budget strictly BELOW the floor already tried, so
// repeated calls cascade Gemini -> OpenRouter-sized -> Groq-sized instead
// of stopping after one compression.
import { describe, it, expect } from "vitest";
import { nextCompressionBudget } from "@/lib/ai/router.server";

describe("nextCompressionBudget", () => {
  it("picks the largest skipped budget on the first pass (no floor yet)", () => {
    // Groq ~5.5k, OpenRouter ~60k both skipped behind Gemini's full size.
    expect(nextCompressionBudget([5_500, 60_000], Infinity)).toBe(60_000);
  });

  it("cascades to the next-largest tier once the previous one has been tried and failed", () => {
    // Real reported bug: after the OpenRouter-sized (60k) attempt also
    // fails, Groq's own budget (5.5k) must still be reachable — not
    // reported as "never attempted" while a working key sits idle.
    expect(nextCompressionBudget([5_500, 60_000], 60_000)).toBe(5_500);
  });

  it("returns undefined once every size-skipped tier has been exhausted", () => {
    expect(nextCompressionBudget([5_500, 60_000], 5_500)).toBeUndefined();
  });

  it("ignores a budget at or above the floor even if it's the largest remaining value", () => {
    // A provider re-skipped at the SAME tier already tried must not loop
    // forever retrying the identical compression target.
    expect(nextCompressionBudget([60_000, 60_000], 60_000)).toBeUndefined();
  });

  it("handles a single size-skipped provider (no cascade needed)", () => {
    expect(nextCompressionBudget([5_500], Infinity)).toBe(5_500);
  });

  it("returns undefined when nothing was size-skipped", () => {
    expect(nextCompressionBudget([], Infinity)).toBeUndefined();
  });

  it("cascades through three or more tiers in strictly descending order", () => {
    const budgets = [5_500, 60_000, 100_000, 150_000];
    let floor = Infinity;
    const order: number[] = [];
    for (let i = 0; i < budgets.length; i++) {
      const next = nextCompressionBudget(budgets, floor);
      expect(next).toBeDefined();
      order.push(next as number);
      floor = next as number;
    }
    expect(order).toEqual([150_000, 100_000, 60_000, 5_500]);
    expect(nextCompressionBudget(budgets, floor)).toBeUndefined();
  });
});
