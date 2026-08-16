// Regression test for a real production bug: deleting every case on the
// Cases page made the two demo/starter amparo matters silently reappear on
// the next Dashboard visit. dashboard.tsx's onboarding effect re-derives
// "has starter seeding ever run for this account" from "does the user
// currently have zero cases" — which is indistinguishable from "the user
// deliberately deleted every case". ensureStarterCasesForUser
// (seed-corpus.server.ts) is meant to be a ONE-TIME backfill for accounts
// that signed up before seeding existed, not a "keep the account topped up
// with demo cases forever" feature. starterSeedAlreadyRan is the pure
// decision function that makes "already seeded" a persisted, one-time fact
// (profiles.starter_cases_seeded_at) instead of something re-derived from
// current case count.
import { describe, it, expect } from "vitest";
import { starterSeedAlreadyRan } from "@/lib/seed-corpus.server";

describe("starterSeedAlreadyRan", () => {
  it("is false for an account that has never been seeded (column null)", () => {
    expect(starterSeedAlreadyRan({ starter_cases_seeded_at: null })).toBe(false);
  });

  it("is false when the profile row itself is missing/undefined — fails open to allow the one legitimate first attempt", () => {
    expect(starterSeedAlreadyRan(null)).toBe(false);
    expect(starterSeedAlreadyRan(undefined)).toBe(false);
  });

  // This is the exact case that was broken: the account was seeded once,
  // the user deleted every case afterward, so `cases` is empty again — but
  // seeding must never be re-triggered by that.
  it("is true once seeding has ever run, regardless of the account's current case count", () => {
    expect(
      starterSeedAlreadyRan({ starter_cases_seeded_at: "2026-08-15T23:00:00.000Z" }),
    ).toBe(true);
  });
});
