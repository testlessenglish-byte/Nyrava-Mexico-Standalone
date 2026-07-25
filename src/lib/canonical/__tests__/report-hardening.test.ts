import { describe, it, expect } from "vitest";
import { rankFindings } from "../findings-rank.server";
import { enforceCitationQuality } from "../citation-quality.server";
import { attachMethodology } from "../methodology-attach.server";
import { runReportQa } from "../report-qa.server";
import type { CaseAnalysis, Finding } from "../case-analysis";

function base(): CaseAnalysis {
  return {
    _canonical: true,
    Metadata: { caseId: "c1", generatedAt: "", pipelineVersion: "1", reportMode: "FULL" },
    ExecutiveSummary: { headline: "H", narrative: "N", top_findings: [], case_type: "commercial" },
    Facts: { narrative: "", key_actors: [], disputed_facts: [] },
    Timeline: [], Evidence: [], Findings: [], Witnesses: [], Contradictions: [],
    Discovery: [], Risks: [], Scores: {}, Recommendations: [],
    Strategy: { theme: null, theories: [], key_moves: [] },
    CrossExam: [], Impeachment: [], WorkProduct: [],
    Appendices: { source_documents: [], citation_index: [], suppressed_notices: [] },
  };
}

const f = (over: Partial<Finding>): Finding => ({
  id: over.id ?? "x", title: "t", description: "d", category: "evidence",
  severity: "medium", confidence: 0.7, citations: [], ...over,
});

describe("rankFindings", () => {
  it("puts contradictions ahead of evidence and removes witness profiles", () => {
    const a = base();
    a.Findings = [
      f({ id: "a", category: "witness_profile", confidence: 0.9 }),
      f({ id: "b", category: "evidence", confidence: 0.7 }),
      f({ id: "c", category: "contradiction", confidence: 0.6 }),
    ];
    rankFindings(a);
    expect(a.Findings.map((x) => x.id)).toEqual(["c", "b"]);
    expect(a.ExecutiveSummary.top_findings).toEqual(["c", "b"]);
  });
});

describe("enforceCitationQuality", () => {
  it("demotes conclusion verbs when no fully-grounded citation exists", () => {
    const a = base();
    a.Findings = [
      f({ id: "1", title: "Defendant violates Section 10(b)", description: "This constitutes fraud." }),
    ];
    enforceCitationQuality(a);
    expect(a.Findings[0].title).not.toMatch(/violates/i);
    expect(a.Findings[0].description).not.toMatch(/constitutes/i);
    expect(a.Findings[0].verification_status).toBe("demoted_unsupported");
  });

  it("leaves conclusion intact when fully cited", () => {
    const a = base();
    a.Findings = [
      f({
        id: "1", title: "Defendant violates the MSA",
        citations: [{ documentId: "d1", page: 4, quote: "Section 4.2 prohibits assignment." }],
      }),
    ];
    enforceCitationQuality(a);
    expect(a.Findings[0].title).toMatch(/violates/);
  });
});

describe("attachMethodology + audit", () => {
  it("attaches methodology refs for emitted scores", () => {
    const a = base();
    a.Scores = { case_strength: 62, evidence_strength: 55 };
    attachMethodology(a);
    const refs = (a.Scores as { methodology_refs?: Record<string, string> }).methodology_refs;
    expect(refs).toMatchObject({ case_strength: "scores.case_strength" });
  });

  it("QA reports unsupported conclusions as critical", () => {
    const a = base();
    a.Findings = [
      f({ id: "1", title: "Defendant violates the MSA", description: "This constitutes breach." }),
    ];
    // Do NOT run enforceCitationQuality — audit should still catch it.
    const qa = runReportQa(a);
    expect(qa.critical.some((i) => i.code === "UNSUPPORTED_LEGAL_CONCLUSION")).toBe(true);
    expect(qa.blocking).toBe(true);
  });
});
