import { describe, it, expect } from "vitest";
import { validateBeforeRender, partitionIssues } from "../prerender-validate.server";
import { emptyCaseAnalysis } from "../case-analysis";

function base() {
  return emptyCaseAnalysis({
    caseId: "c1",
    caseName: "Test",
    generatedAt: new Date().toISOString(),
    pipelineVersion: "test",
    reportMode: "FULL",
  });
}

describe("prerender-validate", () => {
  it("flags unresolved template tokens", () => {
    const a = base();
    a.ExecutiveSummary.narrative = "The stock dropped {{pct}} following the announcement.";
    const issues = validateBeforeRender(a);
    expect(issues.some((i) => i.code === "TOKEN_MUSTACHE")).toBe(true);
  });

  it("flags literal well-supported placeholder", () => {
    const a = base();
    a.ExecutiveSummary.narrative = "Damages are well-supported by the record.";
    const issues = validateBeforeRender(a);
    expect(issues.some((i) => i.code === "TOKEN_WELL_SUPPORTED")).toBe(true);
  });

  it("flags NaN% and out-of-range scores", () => {
    const a = base();
    a.Scores.case_strength = 150;
    a.ExecutiveSummary.narrative = "Confidence is NaN%.";
    const issues = validateBeforeRender(a);
    expect(issues.some((i) => i.code === "SCORE_OUT_OF_RANGE")).toBe(true);
    expect(issues.some((i) => i.code === "TOKEN_NAN_PERCENT")).toBe(true);
  });

  it("flags criminal doctrine leaking into commercial reports", () => {
    const a = base();
    a.ExecutiveSummary.case_type = "commercial";
    a.Findings.push({
      id: "f1",
      title: "Motion",
      description: "A Franks hearing may be warranted.",
      category: "legal",
      severity: "medium",
      confidence: 0.5,
      citations: [],
      suppressed: false,
      quarantined: false,
    });
    const issues = validateBeforeRender(a);
    expect(issues.some((i) => i.code === "CASE_TYPE_LEAK")).toBe(true);
  });

  it("does not flag Franks hearing in a criminal report", () => {
    const a = base();
    a.ExecutiveSummary.case_type = "criminal";
    a.ExecutiveSummary.narrative = "A Franks hearing is warranted.";
    const issues = validateBeforeRender(a);
    expect(issues.some((i) => i.code === "CASE_TYPE_LEAK")).toBe(false);
  });

  // Audit P0-4/P0-5 regression guard: these U.S. procedural terms have no
  // Mexican-law equivalent and are wrong for every case type, unlike
  // CRIMINAL_ONLY_TERMS above which is only wrong for the WRONG case type.
  it("flags U.S. procedural terms regardless of case type", () => {
    const civil = base();
    civil.ExecutiveSummary.case_type = "commercial";
    civil.ExecutiveSummary.narrative = "Counsel should file a Motion to Dismiss.";
    expect(validateBeforeRender(civil).some((i) => i.code === "US_PROCEDURE_LEAK")).toBe(true);

    const criminal = base();
    criminal.ExecutiveSummary.case_type = "criminal";
    criminal.ExecutiveSummary.narrative = "Summary Judgment is available here.";
    expect(validateBeforeRender(criminal).some((i) => i.code === "US_PROCEDURE_LEAK")).toBe(true);
  });

  it("partitionIssues splits by severity", () => {
    const { critical, warnings } = partitionIssues([
      { code: "X", severity: "critical", section: "S", message: "" },
      { code: "Y", severity: "warning", section: "S", message: "" },
    ]);
    expect(critical.length).toBe(1);
    expect(warnings.length).toBe(1);
  });
});
