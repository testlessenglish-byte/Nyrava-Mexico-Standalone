// ESS suppression regression — Minimal corpus must never leak scores,
// motions, confidence percentages, or rankings to any canonical surface.
import { describe, it, expect } from "vitest";
import {
  getMotions,
  getScores,
  getEssState,
  getCanonicalCounts,
} from "@/lib/intelligence/canonical";
import { MINIMAL_ESS_FIXTURE } from "./fixtures";

describe("ESS minimal suppression", () => {
  const r = MINIMAL_ESS_FIXTURE.report;

  it("ESS state reports minimal + suppression flags", () => {
    const ess = getEssState(r);
    expect(ess.level).toBe("minimal");
    expect(ess.scoresSuppressed).toBe(true);
    expect(ess.motionsSuppressed).toBe(true);
    expect(ess.allowQuantitativeScores).toBe(false);
    expect(ess.allowMotionGeneration).toBe(false);
  });

  it("getScores returns null for both strength and risk", () => {
    const s = getScores(r);
    expect(s.strength).toBeNull();
    expect(s.risk).toBeNull();
  });

  it("getMotions returns empty even when motion_opportunities is populated", () => {
    // Fixture intentionally seeds 5 raw motions to prove suppression.
    expect((r as { motion_opportunities: unknown[] }).motion_opportunities.length).toBe(5);
    expect(getMotions(r)).toEqual([]);
  });

  it("canonical counts report 0 motions for minimal ESS", () => {
    expect(getCanonicalCounts(r).motions).toBe(0);
  });
});
