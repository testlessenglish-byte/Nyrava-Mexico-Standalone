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
import { CASE_DERIVED_TABLES, CASE_RESET_FIELDS, CASE_TYPE_CORRECTION_RESET_FIELDS } from "../pipeline-reset";

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

// Regression test for a real production bug on ADR-4640-2017-180212:
// case-classification.server.ts's automatic stale-artifact invalidation
// (fired whenever a reclassification pass CHANGES cases.case_type) reused
// the full CASE_RESET_FIELDS — the same reset a genuine "Rerun from
// scratch" or a manual case_type edit uses — which includes
// extracted_at/extraction_report. Extraction is materia-independent: it has
// no reason to be invalidated by a materia correction. Reusing the full
// reset here sent the case back to the "extraction" stage on every
// automatic reclassification that disagreed with an unlocked declared
// value; for a materia-ambiguous document this fired on every run,
// producing "keeps getting stuck then going back to extraction and never
// completes."
describe("CASE_TYPE_CORRECTION_RESET_FIELDS", () => {
  it("never invalidates extraction — extraction is materia-independent", () => {
    expect(CASE_TYPE_CORRECTION_RESET_FIELDS).not.toHaveProperty("extracted_at");
    expect(CASE_TYPE_CORRECTION_RESET_FIELDS).not.toHaveProperty("extraction_report");
  });

  it("still invalidates every legal-reasoning-derived stage timestamp/artifact, same as the full reset", () => {
    const mustInclude = [
      "analysis_at",
      "agents_at",
      "scored_at",
      "report_at",
      "hallucination_report",
      "legal_qa_report",
      "procedural_compliance",
      "error",
      "status_message",
    ] as const;
    for (const field of mustInclude) {
      expect(CASE_TYPE_CORRECTION_RESET_FIELDS, `missing "${field}"`).toHaveProperty(field);
      expect(CASE_RESET_FIELDS, `full reset also missing "${field}" — kept in sync`).toHaveProperty(field);
    }
  });

  it("is otherwise a strict subset of CASE_RESET_FIELDS's keys (no drift, no invented fields)", () => {
    for (const key of Object.keys(CASE_TYPE_CORRECTION_RESET_FIELDS)) {
      expect(CASE_RESET_FIELDS, `"${key}" not present in the full reset`).toHaveProperty(key);
    }
  });
});
