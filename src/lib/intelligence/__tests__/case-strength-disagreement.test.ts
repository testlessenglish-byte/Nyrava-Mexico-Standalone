// Canonical Reconciliation Design (2026-08-16), P2 §10 — mirrors the
// existing per-dimension computeScoreDelta/MODEL_DISAGREEMENT mechanism
// (case_scores stage) for the report-writer's single top-level
// case_strength_score, which never had an equivalent check before this.
import { describe, it, expect } from "vitest";
import {
  computeCaseStrengthDisagreement,
  SCORE_DISAGREEMENT_THRESHOLD,
} from "../case-state.server";

describe("computeCaseStrengthDisagreement", () => {
  it("flags disagreement when the LLM's self-reported score diverges from the deterministic mean by >= the threshold", () => {
    const result = computeCaseStrengthDisagreement(85, [40, 45, 50]); // det mean = 45
    expect(result.deterministic).toBe(45);
    expect(result.delta).toBe(40);
    expect(result.disagreement).toBe(true);
  });

  it("does not flag disagreement when the two scores are close", () => {
    const result = computeCaseStrengthDisagreement(50, [45, 50, 55]); // det mean = 50
    expect(result.delta).toBe(0);
    expect(result.disagreement).toBe(false);
  });

  it("sits exactly at the threshold boundary — inclusive, matching computeScoreDelta's own >= convention", () => {
    const result = computeCaseStrengthDisagreement(
      50 + SCORE_DISAGREEMENT_THRESHOLD,
      [50],
    );
    expect(result.delta).toBe(SCORE_DISAGREEMENT_THRESHOLD);
    expect(result.disagreement).toBe(true);
  });

  it("returns no comparison (never fabricates one) when the LLM score is null — e.g. LIMITED-mode suppression", () => {
    const result = computeCaseStrengthDisagreement(null, [40, 60]);
    expect(result.deterministic).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.disagreement).toBe(false);
  });

  it("returns no comparison when there are no deterministic dimension scores at all", () => {
    const result = computeCaseStrengthDisagreement(70, []);
    expect(result.deterministic).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.disagreement).toBe(false);
  });
});
