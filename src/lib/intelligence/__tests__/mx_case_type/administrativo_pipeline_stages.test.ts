// Pipeline-stage relevance for administrativo (juicio contencioso
// administrativo / TFJA nullity actions), and the two other materias that
// route through the same profile: electoral and ambiental
// (PROFILE_BY_MATERIA in mx-pipeline.ts).
//
// This exists because a real bug was found by inspection, not by running
// the pipeline: trial_prep's engine (engines.server.ts) produces
// opening_themes/closing_themes/witness_order/exhibit_order — output
// modeled on an adversarial trial with live witness examination. A TFJA
// nullity action is resolved on the written expediente (demanda,
// contestación, documentary evidence, alegatos, sentencia) with no oral
// trial and no witness examination in that sense — the exact same
// reasoning already correctly applied to amparo and apelacion
// ("no hay desahogo de testigos ni juicio oral"), just not previously
// extended to administrativo. Left unexcluded, trial_prep could get
// dispatched, checkpoint on a slow AI call, and never produce output that
// makes sense for this proceeding type — while also being a genuinely
// pointless engine call for a materia where the concept doesn't apply.
//
// This proves the fix (isStageRelevantForCaseType / mxPipelineStages in
// mx-pipeline.ts) actually excludes them, rather than asserting it.
import { describe, it, expect } from "vitest";
import { isStageRelevantForCaseType, mxPipelineStageKeys } from "@/lib/execution/mx-pipeline";

describe("administrativo (and electoral/ambiental, same profile) pipeline stage relevance", () => {
  const TRIAL_ONLY_STAGES = ["witness", "trial_prep"];

  it("excludes witness and trial_prep for administrativo — same rationale already used for amparo/apelacion", () => {
    for (const stage of TRIAL_ONLY_STAGES) {
      expect(isStageRelevantForCaseType("administrativo", stage)).toBe(false);
    }
    // constitutional was already correctly excluded before this fix.
    expect(isStageRelevantForCaseType("administrativo", "constitutional")).toBe(false);
  });

  it("applies identically to electoral and ambiental, which route through the same administrativo profile", () => {
    for (const stage of TRIAL_ONLY_STAGES) {
      expect(isStageRelevantForCaseType("electoral", stage)).toBe(false);
      expect(isStageRelevantForCaseType("ambiental", stage)).toBe(false);
    }
  });

  it("still runs the stages that produce useful output for a contentious-administrative case", () => {
    const keys = mxPipelineStageKeys("administrativo");
    for (const useful of [
      "extraction", "analyzers", "agents", "timeline", "evidence_map",
      "contradictions", "evidence_intel", "jurisdiction_intel",
      "procedural_compliance", "discovery", "theories", "strategy",
      "work_product", "scoring", "legal_qa", "report",
    ]) {
      expect(keys).toContain(useful);
    }
  });

  it("does NOT exclude witness/trial_prep for a real adversarial-trial materia (penal) — the fix is scoped, not global", () => {
    expect(isStageRelevantForCaseType("penal", "witness")).toBe(true);
    expect(isStageRelevantForCaseType("penal", "trial_prep")).toBe(true);
  });

  it("still excludes them for amparo — regression guard against accidentally narrowing the existing exclusion", () => {
    for (const stage of TRIAL_ONLY_STAGES) {
      expect(isStageRelevantForCaseType("amparo", stage)).toBe(false);
    }
  });
});
