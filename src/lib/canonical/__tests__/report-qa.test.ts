import { describe, it, expect } from "vitest";
import { runReportQa } from "../report-qa.server";
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

describe("report-qa", () => {
  it("returns ok for a clean analysis", () => {
    const a = base();
    a.ExecutiveSummary.narrative = "The record establishes breach.";
    const qa = runReportQa(a);
    expect(qa.blocking).toBe(false);
    expect(qa.critical.length).toBe(0);
  });

  it("blocks on unresolved placeholders", () => {
    const a = base();
    a.ExecutiveSummary.narrative = "Damages: {{amount}}.";
    const qa = runReportQa(a);
    expect(qa.blocking).toBe(true);
  });

  it("flags orphaned citations against Appendices", () => {
    const a = base();
    a.Appendices.source_documents = [{ id: "doc-1", name: "Contract" }];
    a.Findings.push({
      id: "f1",
      title: "Breach",
      description: "Nonperformance.",
      category: "evidence",
      severity: "high",
      confidence: 0.8,
      citations: [{ documentId: "doc-999", page: 1, quote: null }],
      suppressed: false,
      quarantined: false,
    });
    const qa = runReportQa(a);
    expect(qa.critical.some((c) => c.code === "ORPHANED_CITATIONS")).toBe(true);
  });
});
