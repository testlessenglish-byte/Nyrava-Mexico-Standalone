// Pipeline-stage relevance for inmobiliario (Real Estate closings).
//
// This exists because a real bug was found by inspection, not by running the
// pipeline: `strategy` and `work_product` (src/lib/intelligence/engines.server.ts)
// hardcode a binary criminal/civil-litigation branch — theory_type
// "plaintiff"|"defense"|"prosecution"|"alternative", document_type
// "motion_for_summary_judgment"|"discovery_request"|"cross_exam_plan"|
// "trial_outline"|"settlement_demand"|"mediation_brief" — with no branch for
// a non-adversarial transaction. Left enabled, a seeded/real inmobiliario
// case would have the pipeline ask the AI to draft a motion or pick a
// plaintiff/defense theory for a home closing instead of producing a usable
// Transaction Center. This proves the fix (isStageRelevantForCaseType /
// mxPipelineStages in mx-pipeline.ts) actually excludes them, rather than
// asserting it.
import { describe, it, expect } from "vitest";
import { isStageRelevantForCaseType, mxPipelineStageKeys } from "@/lib/execution/mx-pipeline";

describe("inmobiliario pipeline stage relevance", () => {
  const LITIGATION_ONLY_STAGES = [
    "constitutional",
    "witness",
    "discovery",
    "litigation_strategy_center",
    "theories",
    "strategy",
    "work_product",
  ];

  it("excludes every litigation-only stage for inmobiliario", () => {
    for (const stage of LITIGATION_ONLY_STAGES) {
      expect(isStageRelevantForCaseType("inmobiliario", stage)).toBe(false);
    }
  });

  it("still runs the stages that produce useful, materia-agnostic output for a closing", () => {
    const keys = mxPipelineStageKeys("inmobiliario");
    for (const useful of [
      "extraction", "analyzers", "agents", "timeline", "evidence_map",
      "contradictions", "evidence_intel", "jurisdiction_intel",
      "procedural_compliance", "scoring", "legal_qa", "report",
    ]) {
      expect(keys).toContain(useful);
    }
  });

  it("does NOT exclude these same stages for a real litigation materia (civil) — the fix is scoped, not global", () => {
    for (const stage of ["strategy", "work_product", "discovery"]) {
      expect(isStageRelevantForCaseType("civil", stage)).toBe(true);
    }
  });

  it("trial_prep no longer exists as a stage at all, for any materia including inmobiliario", () => {
    expect(mxPipelineStageKeys("inmobiliario")).not.toContain("trial_prep");
  });
});
