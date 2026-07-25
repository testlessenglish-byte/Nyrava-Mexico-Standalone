// Final report QA gate.
//
// Runs after normalize + prose-polish and before the canonical write.
// Aggregates:
//   • prerender-validate (placeholders, forbidden terms, score sanity)
//   • cross-section duplication scan (executive summary vs. findings/strategy)
//   • score-consistency scan (Scores subset matches Recommendations priorities)
//   • citation-existence scan (Findings.citations resolve to Appendices docs)
//
// Freeze-compliant — inspection only.

import type { CaseAnalysis, Finding } from "./case-analysis";
import { validateBeforeRender, partitionIssues, type QaIssue } from "./prerender-validate.server";
import { missingMethodology } from "./methodology-attach.server";


function titleKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

function crossSectionDupes(a: CaseAnalysis): QaIssue[] {
  const issues: QaIssue[] = [];
  const execNarr = String(a.ExecutiveSummary?.narrative ?? "");
  const execSents = new Set(
    execNarr
      .split(/(?<=[.!?])\s+/)
      .map((s) => titleKey(s))
      .filter((s) => s.length > 6),
  );
  let dupCount = 0;
  for (const f of a.Findings ?? []) {
    const key = titleKey(String(f.description ?? ""));
    if (key && execSents.has(key)) dupCount++;
  }
  if (dupCount >= 3) {
    issues.push({
      code: "CROSS_SECTION_DUPES",
      severity: "warning",
      section: "ExecutiveSummary",
      message: `${dupCount} finding descriptions duplicate sentences already in ExecutiveSummary.`,
    });
  }
  // Discovery vs Recommendations
  const recKeys = new Set((a.Recommendations ?? []).map((r) => titleKey(String(r.action ?? ""))));
  let discDup = 0;
  for (const d of a.Discovery ?? []) {
    if (recKeys.has(titleKey(String(d.topic ?? "")))) discDup++;
  }
  if (discDup >= 2) {
    issues.push({
      code: "DISCOVERY_STRATEGY_DUPES",
      severity: "warning",
      section: "Discovery",
      message: `${discDup} Discovery entries duplicate Recommendations.`,
    });
  }
  return issues;
}

function citationsExist(a: CaseAnalysis): QaIssue[] {
  const issues: QaIssue[] = [];
  const known = new Set((a.Appendices?.source_documents ?? []).map((d) => String(d.id)));
  if (known.size === 0) return issues;
  let orphaned = 0;
  for (const f of a.Findings ?? []) {
    for (const c of f.citations ?? []) {
      if (c.documentId && !known.has(String(c.documentId))) orphaned++;
    }
  }
  if (orphaned > 0) {
    issues.push({
      code: "ORPHANED_CITATIONS",
      severity: "critical",
      section: "Findings",
      message: `${orphaned} finding citation(s) reference a document not present in Appendices.source_documents.`,
    });
  }
  return issues;
}

function emptyStructural(a: CaseAnalysis): QaIssue[] {
  const issues: QaIssue[] = [];
  if (!a.Findings || a.Findings.length === 0) {
    issues.push({
      code: "NO_FINDINGS",
      severity: "warning",
      section: "Findings",
      message: "Report has no findings.",
    });
  }
  return issues;
}

const CONCLUSION_VERBS = [
  /\bconstitutes?\b/i,
  /\bestablishes?\b/i,
  /\bviolates?\b/i,
  /\bbreaches?\b/i,
  /\bproves?\b/i,
  /\bis liable\b/i,
];

function unsupportedConclusions(a: CaseAnalysis): QaIssue[] {
  const issues: QaIssue[] = [];
  let n = 0;
  for (const f of a.Findings ?? []) {
    if (f.suppressed || f.quarantined) continue;
    const text = `${f.title} ${f.description} ${f.legal_significance ?? ""}`;
    const isConclusion = CONCLUSION_VERBS.some((rx) => rx.test(text));
    if (!isConclusion) continue;
    const fullyCited = (f.citations ?? []).some(
      (c) => c && c.documentId && c.page != null && (c.quote?.trim()?.length ?? 0) > 0,
    );
    if (!fullyCited) n++;
  }
  if (n > 0) {
    issues.push({
      code: "UNSUPPORTED_LEGAL_CONCLUSION",
      severity: "critical",
      section: "Findings",
      message: `${n} finding(s) read as legal conclusions but lack a fully grounded citation (document + page + quote).`,
    });
  }
  return issues;
}

function withinSectionDupes(a: CaseAnalysis): QaIssue[] {
  const issues: QaIssue[] = [];
  const check = (label: string, keys: string[]) => {
    const seen = new Set<string>();
    let dup = 0;
    for (const k of keys) {
      const norm = k.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      if (!norm) continue;
      if (seen.has(norm)) dup++;
      seen.add(norm);
    }
    if (dup > 0) {
      issues.push({
        code: "WITHIN_SECTION_DUPES",
        severity: "warning",
        section: label,
        message: `${dup} duplicate item(s) detected in ${label}.`,
      });
    }
  };
  check("Recommendations", (a.Recommendations ?? []).map((r) => r.action ?? ""));
  check("Findings", (a.Findings as Finding[] ?? []).map((f) => f.title ?? ""));
  check("Discovery", (a.Discovery ?? []).map((d) => d.topic ?? ""));
  return issues;
}

function methodologyCoverage(a: CaseAnalysis): QaIssue[] {
  const missing = missingMethodology(a);
  if (missing.length === 0) return [];
  return [
    {
      code: "SCORE_METHODOLOGY_MISSING",
      severity: "warning",
      section: "Scores",
      message: `Score(s) emitted without documented methodology: ${missing.join(", ")}.`,
    },
  ];
}

export interface QaReport {
  ok: boolean;
  blocking: boolean;
  critical: QaIssue[];
  warnings: QaIssue[];
  ran_at: string;
}

/**
 * Run the full QA pass. Returns a QaReport; caller decides how to react.
 * `blocking` is true iff any critical issue was raised.
 */
export function runReportQa(analysis: CaseAnalysis): QaReport {
  const issues: QaIssue[] = [
    ...validateBeforeRender(analysis),
    ...crossSectionDupes(analysis),
    ...withinSectionDupes(analysis),
    ...citationsExist(analysis),
    ...unsupportedConclusions(analysis),
    ...methodologyCoverage(analysis),
    ...emptyStructural(analysis),
  ];
  const { critical, warnings } = partitionIssues(issues);
  return {
    ok: critical.length === 0,
    blocking: critical.length > 0,
    critical,
    warnings,
    ran_at: new Date().toISOString(),
  };
}

/**
 * Convert a QA report to a short human-readable summary suitable for surfacing
 * in the app's health dashboard.
 */
export function summarizeQa(qa: QaReport): string {
  if (qa.ok && qa.warnings.length === 0) return "Clean — no QA issues.";
  const parts: string[] = [];
  if (qa.critical.length) parts.push(`${qa.critical.length} critical`);
  if (qa.warnings.length) parts.push(`${qa.warnings.length} warning`);
  return parts.join(", ");
}
