import type { QaIssue } from "./prerender-validate.server";

/** Objective rendered-content integrity failures that must prevent a normal
 * attorney-facing release. The aggregate quality score itself remains
 * informational because its weighting is not calibrated; deterministic
 * `quality_gate.critical_issues` are blocked separately by
 * REPORT_QUALITY_CRITICAL. */
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
  "REPORT_QUALITY_CRITICAL",
]);

export interface RenderedReportReleaseDecision {
  blocked: boolean;
  blockingIssues: QaIssue[];
  warningIssues: QaIssue[];
  reasons: string[];
}

function issueKey(issue: QaIssue): string {
  return [issue.code, issue.section, issue.sample ?? "", issue.message ?? ""].join("::");
}

export function decideRenderedReportRelease(issues: readonly QaIssue[]): RenderedReportReleaseDecision {
  // The rendered report object deliberately contains mirrored validation data
  // (top-level + full_report). The scanner can therefore discover the same
  // underlying problem more than once. Release must still block, but the
  // agent log/UI should show one actionable reason rather than an unreadable
  // repeated error string.
  const seen = new Set<string>();
  const uniqueIssues = issues.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const blockingIssues = uniqueIssues.filter(
    (issue) => issue.severity === "critical" && RENDERED_REPORT_BLOCKING_CODES.has(issue.code),
  );
  const blockingSet = new Set(blockingIssues);
  return {
    blocked: blockingIssues.length > 0,
    blockingIssues,
    warningIssues: uniqueIssues.filter((issue) => !blockingSet.has(issue)),
    reasons: Array.from(
      new Set(blockingIssues.map((issue) => `rendered_report_qa:${issue.code}:${issue.section}`)),
    ),
  };
}
