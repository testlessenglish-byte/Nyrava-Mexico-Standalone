import type { QaIssue } from "./prerender-validate.server";

/** Objective rendered-content integrity failures that must prevent a normal
 * attorney-facing release. These checks are deterministic; heuristic quality
 * scores remain warnings and are deliberately not promoted here. */
export const RENDERED_REPORT_BLOCKING_CODES = new Set<string>([
  "TOKEN_MUSTACHE",
  "TOKEN_DOLLAR_BRACE",
  "TOKEN_PRINTF",
  "TOKEN_WELL_SUPPORTED",
  "TOKEN_CONDITIONAL_POWER",
  "TOKEN_NAN_PERCENT",
  "CASE_TYPE_LEAK",
  "SPANISH_CASE_TYPE_LEAK",
  "US_PROCEDURE_LEAK",
]);

export interface RenderedReportReleaseDecision {
  blocked: boolean;
  blockingIssues: QaIssue[];
  warningIssues: QaIssue[];
  reasons: string[];
}

export function decideRenderedReportRelease(issues: readonly QaIssue[]): RenderedReportReleaseDecision {
  const blockingIssues = issues.filter(
    (issue) => issue.severity === "critical" && RENDERED_REPORT_BLOCKING_CODES.has(issue.code),
  );
  const blockingSet = new Set(blockingIssues);
  return {
    blocked: blockingIssues.length > 0,
    blockingIssues,
    warningIssues: issues.filter((issue) => !blockingSet.has(issue)),
    reasons: blockingIssues.map((issue) => `rendered_report_qa:${issue.code}:${issue.section}`),
  };
}
