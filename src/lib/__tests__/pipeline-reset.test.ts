// Regression test for a real staleness bug: case_outcome_assessments (the
// Completed Case Audit — see completed-case-audit.server.ts) inserts a new
// row per run rather than overwriting, and was missing from
// CASE_DERIVED_TABLES. A full "Rerun from scratch" cleared every other
// derived table but left old audit rows behind; since getCase() (the
// export path) picks the most recent row with no other freshness check,
// a run whose audit step never re-ran (or failed non-fatally) could
// silently keep serving a PREVIOUS run's audit output as if it were
// current — exactly the "stale cache after rerun" failure mode this test
// guards against.
import { describe, it, expect } from "vitest";
import { CASE_DERIVED_TABLES } from "../pipeline-reset";

describe("CASE_DERIVED_TABLES", () => {
  it("includes case_outcome_assessments so a full rerun can never leave a stale audit assessment behind", () => {
    expect(CASE_DERIVED_TABLES).toContain("case_outcome_assessments");
  });

  it("includes every table the main pipeline and the completed-case audit layer write derived output to", () => {
    const mustInclude = [
      "case_findings",
      "case_scores",
      "reports",
      "report_versions",
      "case_outcome_assessments",
      "case_witnesses",
      "case_theories",
      "case_opportunities",
      "case_strategy",
      "case_work_product",
      "case_perspectives",
      "case_trial_prep",
      "case_timeline_events",
    ];
    for (const table of mustInclude) {
      expect(CASE_DERIVED_TABLES, `missing "${table}"`).toContain(table);
    }
  });
});
