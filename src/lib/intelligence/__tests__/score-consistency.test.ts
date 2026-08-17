// Real-user bug report (2026-08-16/17): four different top-line "how good is
// this case" numbers disagreeing on the same report — dashboard
// overall_confidence vs. case_quality cards showing different values,
// narrative prose quoting yet another number, and case_strength_score
// disagreeing with all of them. Two separate defects, fixed together here:
//
// 1. witness_reliability was persisted from a case's applicability-gated
//    deterministic scorecard when applicable, but silently fell back to a
//    raw, ungated LLM number for materias (e.g. "amparo") that don't even
//    include witness_reliability in applicableDimensionsFor — confirmed
//    live: witness_reliability: 70 on a pure-law, zero-witness amparo
//    directo en revisión case. gateDimensionForCaseType is the fix.
// 2. case_quality (case_scores) had zero deterministic backing at all —
//    unlike every sibling field on the same upsert. reconcileCaseStrengthScore
//    is the equivalent fix for the report-writer stage's case_strength_score,
//    which had a MODEL_DISAGREEMENT flag but nothing ever consumed it.
import { describe, it, expect } from "vitest";
import { applicableDimensionsFor, gateDimensionForCaseType } from "@/lib/intelligence/scoring.server";
import { reconcileCaseStrengthScore } from "@/lib/intelligence/case-state.server";

describe("applicableDimensionsFor — materias that omit witness_reliability/timeline_integrity/investigation_completeness", () => {
  it("amparo omits witness_reliability — the exact real-case reproduction", () => {
    expect(applicableDimensionsFor("amparo")).not.toContain("witness_reliability");
  });

  it("constitucional omits timeline_integrity", () => {
    expect(applicableDimensionsFor("constitucional")).not.toContain("timeline_integrity");
  });

  it("civil/mercantil omit investigation_completeness", () => {
    expect(applicableDimensionsFor("civil")).not.toContain("investigation_completeness");
    expect(applicableDimensionsFor("mercantil")).not.toContain("investigation_completeness");
  });

  it("penal includes all three (the normal, applicable case)", () => {
    const dims = applicableDimensionsFor("penal");
    expect(dims).toContain("witness_reliability");
    expect(dims).toContain("timeline_integrity");
    expect(dims).toContain("investigation_completeness");
  });
});

describe("gateDimensionForCaseType", () => {
  it("suppresses a non-applicable dimension to null instead of the raw LLM fallback value — the real bug", () => {
    const applicable = new Set(applicableDimensionsFor("amparo"));
    expect(gateDimensionForCaseType("witness_reliability", applicable, 70)).toBeNull();
  });

  it("passes an applicable dimension's value through unchanged", () => {
    const applicable = new Set(applicableDimensionsFor("penal"));
    expect(gateDimensionForCaseType("witness_reliability", applicable, 70)).toBe(70);
  });

  it("passes null through unchanged whether or not the dimension is applicable", () => {
    const applicable = new Set(applicableDimensionsFor("penal"));
    expect(gateDimensionForCaseType("witness_reliability", applicable, null)).toBeNull();
  });
});

describe("reconcileCaseStrengthScore", () => {
  it("overrides the raw LLM score with the deterministic mean when both are present — the real bug", () => {
    // Real-case shape: case_strength_score (LLM) = 70, deterministic mean = 86.
    expect(reconcileCaseStrengthScore(70, 86)).toBe(86);
  });

  it("rounds a non-integer deterministic mean", () => {
    expect(reconcileCaseStrengthScore(70, 85.6)).toBe(86);
  });

  it("falls back to the raw LLM value when there is no deterministic counterpart at all", () => {
    expect(reconcileCaseStrengthScore(70, null)).toBe(70);
  });

  it("never invents a score under modo LIMITADO — null passes through null even with a deterministic value available", () => {
    expect(reconcileCaseStrengthScore(null, 86)).toBeNull();
  });
});
