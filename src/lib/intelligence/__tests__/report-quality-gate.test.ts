// Tests for report-quality-gate.ts's scoreReportQuality — a pure,
// deterministic 6-dimension scorer that had zero test coverage despite
// being production logic. Written now because this Phase 3 change is what
// first makes its output visible to anyone (pipelineWarnings + a UI badge
// in cases.$caseId.tsx) — previously the result was computed and persisted
// to full_report.quality_gate but never read back anywhere.
import { describe, it, expect } from "vitest";
import { scoreReportQuality } from "@/lib/intelligence/report-quality-gate";

const GOOD_MEMO_ISSUE = {
  issue: "Whether the arresting officer's search exceeded the scope of a valid stop-and-frisk.",
  rule: "Terry v. Ohio, 392 U.S. 1 (1968) sets the standard for a lawful protective search.",
  application: "The officer's search extended into the suspect's jacket lining [DOC 3 p. 4], beyond a pat-down.",
  conclusion: "The search exceeded Terry's scope and the resulting evidence should be suppressed.",
  cited_evidence: ["DOC 3 p. 4"],
};

const GOOD_MOTION = {
  factual_basis: ["Officer report contradicts dashcam timestamp", "No warrant on file"],
  draft_paragraph: "A".repeat(20) + " " + Array(150).fill("word").join(" "),
  legal_standard: "Fourth Amendment reasonableness standard under Terry v. Ohio and its progeny in this circuit.",
};

const BASE_SIGNALS = {
  chunk_success: { narrative: true, memo: true, intelligence: true },
  citation_count: 10,
  orphaned_citation_count: 0,
  uncovered_finding_count: 0,
  legal_memorandum_present: true,
  legal_memorandum_irac_complete: true,
  avg_prose_length: 1800,
};

function baseParsed(overrides: Record<string, unknown> = {}) {
  return {
    legal_memorandum: {
      legal_analysis: [GOOD_MEMO_ISSUE, GOOD_MEMO_ISSUE, GOOD_MEMO_ISSUE],
      recommended_motions: [GOOD_MOTION, GOOD_MOTION, GOOD_MOTION],
    },
    motion_opportunities: [],
    cross_examination: [
      { lines: [{ citation: "DOC 3 p. 4", questions: ["Did you search the jacket lining?"] }] },
    ],
    prose: { narrative: "A well-written, specific account of the facts. ".repeat(40) },
    ...overrides,
  };
}

describe("scoreReportQuality", () => {
  it("passes a well-formed report with strong signals across every dimension", () => {
    const result = scoreReportQuality(baseParsed(), BASE_SIGNALS, 5);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.critical_issues).toEqual([]);
  });

  it("fails when legal_memorandum is absent, regardless of score", () => {
    const result = scoreReportQuality(baseParsed(), { ...BASE_SIGNALS, legal_memorandum_present: false }, 5);
    expect(result.critical_issues).toContain("legal_memorandum absent");
    expect(result.passed).toBe(false);
  });

  it("fails when there are orphaned citations, regardless of score", () => {
    const result = scoreReportQuality(baseParsed(), { ...BASE_SIGNALS, orphaned_citation_count: 3 }, 5);
    expect(result.critical_issues.some((c) => c.includes("orphaned"))).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("fails when the memo chunk itself failed to generate", () => {
    const result = scoreReportQuality(
      baseParsed(),
      { ...BASE_SIGNALS, chunk_success: { narrative: true, memo: false, intelligence: true } },
      5,
    );
    expect(result.critical_issues).toContain("memo chunk failed");
    expect(result.passed).toBe(false);
  });

  it("scores memo_completeness 0 when legal_memorandum is missing entirely", () => {
    const result = scoreReportQuality({}, BASE_SIGNALS, 5);
    expect(result.dimensions.memo_completeness.score).toBe(0);
    expect(result.dimensions.memo_completeness.detail).toContain("missing");
  });

  it("scores citation_integrity at full marks with zero orphaned citations, and 0 when there are no citations at all", () => {
    const withCitations = scoreReportQuality(baseParsed(), BASE_SIGNALS, 5);
    expect(withCitations.dimensions.citation_integrity.score).toBe(20);

    const noCitations = scoreReportQuality(baseParsed(), { ...BASE_SIGNALS, citation_count: 0 }, 5);
    expect(noCitations.dimensions.citation_integrity.score).toBe(0);
  });

  it("scores findings_coverage proportionally to uncovered findings", () => {
    const halfCovered = scoreReportQuality(baseParsed(), { ...BASE_SIGNALS, uncovered_finding_count: 5 }, 10);
    expect(halfCovered.dimensions.findings_coverage.score).toBe(10); // 20 * (5/10)

    const fullyCovered = scoreReportQuality(baseParsed(), { ...BASE_SIGNALS, uncovered_finding_count: 0 }, 10);
    expect(fullyCovered.dimensions.findings_coverage.score).toBe(20);
  });

  it("is a pure, deterministic function — identical input always produces identical output", () => {
    const a = scoreReportQuality(baseParsed(), BASE_SIGNALS, 5);
    const b = scoreReportQuality(baseParsed(), BASE_SIGNALS, 5);
    expect(a).toEqual(b);
  });

  it("never mutates its inputs", () => {
    const parsed = baseParsed();
    const signals = { ...BASE_SIGNALS };
    const snapshotParsed = JSON.stringify(parsed);
    const snapshotSignals = JSON.stringify(signals);
    scoreReportQuality(parsed, signals, 5);
    expect(JSON.stringify(parsed)).toBe(snapshotParsed);
    expect(JSON.stringify(signals)).toBe(snapshotSignals);
  });
});
