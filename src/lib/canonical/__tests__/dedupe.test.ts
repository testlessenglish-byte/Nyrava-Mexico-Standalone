import { describe, it, expect } from "vitest";
import { dedupeAnalysis } from "../dedupe.server";
import type { CaseAnalysis } from "../case-analysis";

function base(): CaseAnalysis {
  return {
    _canonical: true,
    Metadata: { caseId: "c1", generatedAt: "", pipelineVersion: "1", reportMode: "FULL" },
    ExecutiveSummary: { headline: "", narrative: "", top_findings: [], case_type: null },
    Facts: { narrative: "", key_actors: [], disputed_facts: [] },
    Timeline: [], Evidence: [], Findings: [], Witnesses: [], Contradictions: [],
    Discovery: [], Risks: [], Scores: {}, Recommendations: [],
    Strategy: { theme: null, theories: [], key_moves: [] },
    CrossExam: [], Impeachment: [], WorkProduct: [],
    Appendices: { source_documents: [], citation_index: [], suppressed_notices: [] },
  };
}

describe("dedupeAnalysis", () => {
  it("collapses near-duplicate recommendations", () => {
    const a = base();
    a.Recommendations = [
      { id: "1", action: "Depose the plaintiff regarding the loan agreement.", priority: "high" },
      { id: "2", action: "Depose plaintiff regarding loan agreement.", priority: "medium" },
      { id: "3", action: "File motion to compel discovery of email records.", priority: "high" },
    ];
    dedupeAnalysis(a);
    expect(a.Recommendations).toHaveLength(2);
  });

  it("removes exec-summary top_finding when title is already in narrative", () => {
    const a = base();
    a.Findings = [
      { id: "f1", title: "Breach of contract regarding delivery deadline", description: "",
        category: "legal", severity: "high", confidence: 0.8, citations: [] },
    ];
    a.ExecutiveSummary.narrative = "This dispute centers on breach of contract regarding delivery deadline and related damages.";
    a.ExecutiveSummary.top_findings = ["f1"];
    dedupeAnalysis(a);
    expect(a.ExecutiveSummary.top_findings).toHaveLength(0);
  });
});
