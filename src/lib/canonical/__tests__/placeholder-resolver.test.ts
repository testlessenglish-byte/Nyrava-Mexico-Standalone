import { describe, it, expect } from "vitest";
import { resolvePlaceholders } from "../placeholder-resolver.server";
import type { CaseAnalysis } from "../case-analysis";

function base(): CaseAnalysis {
  return {
    _canonical: true,
    Metadata: { caseId: "c1", generatedAt: "", pipelineVersion: "1", reportMode: "FULL" },
    ExecutiveSummary: { headline: "", narrative: "", top_findings: [], case_type: "commercial" },
    Facts: { narrative: "", key_actors: [], disputed_facts: [] },
    Timeline: [],
    Evidence: [],
    Findings: [],
    Witnesses: [],
    Contradictions: [],
    Discovery: [],
    Risks: [],
    Scores: {},
    Recommendations: [],
    Strategy: { theme: null, theories: [], key_moves: [] },
    CrossExam: [],
    Impeachment: [],
    WorkProduct: [],
    Appendices: { source_documents: [], citation_index: [], suppressed_notices: [] },
  };
}

describe("resolvePlaceholders", () => {
  it("strips mustache tokens and drops sentences that become empty", () => {
    const a = base();
    a.ExecutiveSummary.narrative =
      "The plaintiff produced {{count}} exhibits. The defendant responded on schedule.";
    resolvePlaceholders(a);
    expect(a.ExecutiveSummary.narrative).not.toMatch(/\{\{/);
    // Second sentence is intact
    expect(a.ExecutiveSummary.narrative).toMatch(/defendant responded/);
  });

  it("replaces NaN% with unavailable", () => {
    const a = base();
    a.Facts.narrative = "Coverage rose to NaN% of the corpus.";
    resolvePlaceholders(a);
    expect(a.Facts.narrative).not.toMatch(/NaN/);
    expect(a.Facts.narrative).toMatch(/unavailable/);
  });

  it("removes 'well-supported' filler", () => {
    const a = base();
    a.Facts.narrative = "The claim is well-supported by the record.";
    resolvePlaceholders(a);
    expect(a.Facts.narrative).not.toMatch(/well-supported/);
  });
});
