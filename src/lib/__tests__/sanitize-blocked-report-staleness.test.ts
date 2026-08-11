// Regression test for a real trust-breaking bug found on a completed-case
// export (ADR 4640/2017 rerun): the exported reports row had
// report_mode: "FULL" while case_strength_score/risk_score/findings_count/
// scores_suppressed were all null — the PDF narrative (generated from the
// same underlying report content) correctly said "LIMITADO... Puntajes:
// Suprimido", but the JSON export showed a bare, uncorroborated "FULL"
// sitting next to a wall of nulls for everything that would explain or
// confirm it. An attorney reading both had two irreconcilable statements
// about the same case.
//
// Root cause: sanitizeBlockedReport() (cases.functions.ts) nulls every
// report field NOT in BLOCKED_REPORT_METADATA_ALLOWLIST when a report is
// stale (a later pipeline stage completed after this report row was last
// written) — but report_mode WAS on that allowlist, so it alone survived
// from what is, by the sanitizer's own logic, a superseded computation.
import { describe, it, expect } from "vitest";
import { sanitizeBlockedReport } from "../cases.functions";

const realBugReport = {
  id: "x",
  case_id: "y",
  user_id: "z",
  created_at: "t",
  updated_at: "t",
  version: 1,
  quality_blocked: false,
  quality_block_reasons: [] as string[],
  report_mode: "FULL",
  generated_language: "es",
  intelligence_version: 1,
  canonical_version: 1,
  change_log: [] as unknown[],
  scores_suppressed: false,
  motions_suppressed: false,
  case_strength_score: 76,
  risk_score: 24,
  findings_count: 8,
  full_report: { some: "narrative content" },
};

describe("sanitizeBlockedReport: stale reports no longer leak a lone report_mode", () => {
  it("nulls report_mode when stale, alongside its already-nulled sibling fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sanitized = sanitizeBlockedReport(realBugReport, { stale: true }) as any;
    expect(sanitized.report_mode).toBeNull();
    expect(sanitized.scores_suppressed).toBeNull();
    expect(sanitized.case_strength_score).toBeNull();
    expect(sanitized.stale).toBe(true);
    // quality_blocked is a genuinely distinct, intentionally-allowlisted
    // signal (the report's own release-gate outcome, not this endpoint's
    // freshness judgment) — must still survive.
    expect(sanitized.quality_blocked).toBe(false);
  });

  it("still preserves report_mode for a quality-blocked (not stale) report — a different, intentional case", () => {
    const sanitized = sanitizeBlockedReport(
      { ...realBugReport, quality_blocked: true },
      { stale: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
    expect(sanitized.report_mode).toBe("FULL");
  });

  it("leaves a healthy, non-stale, non-blocked report completely untouched", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const healthy = sanitizeBlockedReport(realBugReport, { stale: false }) as any;
    expect(healthy.report_mode).toBe("FULL");
    expect(healthy.case_strength_score).toBe(76);
  });
});
