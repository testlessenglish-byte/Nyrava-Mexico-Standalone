import { describe, expect, it } from "vitest";
import { normalizeReport } from "../report-normalize";

describe("final report canonical risk ownership", () => {
  it("overwrites a legacy confidence-shaped risk_score with deterministic litigation risk", () => {
    const report = normalizeReport({
      risk_score: 88,
      analysis_confidence: 88,
      litigation_risk: { score: 6, band: "low" },
    });

    expect(report.risk_score).toBe(6);
    expect(report.analysis_confidence).toBe(88);
    expect((report.litigation_risk as { score: number }).score).toBe(6);
  });

  it("does not invent a risk score when deterministic litigation risk is unavailable", () => {
    const report = normalizeReport({ risk_score: 42, analysis_confidence: 88 });
    expect(report.risk_score).toBe(42);
  });
});
