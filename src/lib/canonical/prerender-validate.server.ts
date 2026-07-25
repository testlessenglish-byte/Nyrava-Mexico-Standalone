// Prerender validation for the canonical report.
//
// Freeze-compliant: does not add, remove, reorder, or rename any of the 17
// locked sections. Only inspects section prose/values and flags:
//   • unresolved template tokens ({{...}}, ${...}, %s, %{name})
//   • literal placeholder tokens seen in the wild ("well-supported",
//     "TBD", "N/A" glued to numbers, "conditional power of well-supported")
//   • stray null/undefined/NaN literals leaked into prose
//   • percentage/score sanity (0–100, no NaN, no "NaN%")
//   • criminal-doctrine leakage in non-criminal case types
//
// The gate treats CRITICAL issues as blocking (report is written with
// status="validated" instead of "completed") and WARNINGS as informational.
//
// Pure module — no I/O.

import type { CaseAnalysis } from "./case-analysis";

export type QaSeverity = "critical" | "warning";

export interface QaIssue {
  code: string;
  severity: QaSeverity;
  section: string;
  message: string;
  sample?: string;
}

const PLACEHOLDER_PATTERNS: Array<{ code: string; rx: RegExp; severity: QaSeverity }> = [
  { code: "TOKEN_MUSTACHE", rx: /\{\{\s*[\w.$-]+\s*\}\}/g, severity: "critical" },
  { code: "TOKEN_DOLLAR_BRACE", rx: /\$\{\s*[\w.$-]+\s*\}/g, severity: "critical" },
  { code: "TOKEN_PRINTF", rx: /%\{[\w.$-]+\}|%s\b|%d\b/g, severity: "critical" },
  { code: "TOKEN_WELL_SUPPORTED", rx: /\bwell-supported\b/gi, severity: "critical" },
  { code: "TOKEN_CONDITIONAL_POWER", rx: /conditional power of\s+[a-z-]+/gi, severity: "critical" },
  { code: "TOKEN_NULL_LITERAL", rx: /\b(?:null|undefined|NaN)\b(?!\s*(?:pointer|reference|value|checks?))/g, severity: "warning" },
  { code: "TOKEN_TBD", rx: /\b(?:TBD|TODO|FIXME|XXX)\b/g, severity: "warning" },
  { code: "TOKEN_NAN_PERCENT", rx: /NaN\s*%|Infinity\s*%/gi, severity: "critical" },
  { code: "TOKEN_DOUBLE_SPACE_PERIOD", rx: /\.\s{3,}[A-Z]/g, severity: "warning" },
];

// Criminal-procedure doctrines that must not appear in civil / commercial /
// corporate / securities / etc. reports. Keyed by exact phrases the LLM has
// been observed to leak.
const CRIMINAL_ONLY_TERMS = [
  /\bFranks hearing\b/i,
  /\bFranks v\.?\s+Delaware\b/i,
  /\bsearch warrant\b/i,
  /\bwarrant affidavit\b/i,
  /\bMiranda (?:warning|rights|waiver)\b/i,
  /\bfruit of the poisonous tree\b/i,
  /\bMotion to Suppress\b/i,
  /\bBrady (?:material|violation|obligation)\b/i,
  /\bFourth Amendment (?:seizure|search)\b/i,
];

const CRIMINAL_AREAS = new Set(["criminal", "criminal_defense", "criminal-defense"]);

function isCriminal(caseType: string | null | undefined): boolean {
  const s = String(caseType ?? "").toLowerCase();
  return [...CRIMINAL_AREAS].some((k) => s.includes(k));
}

function* walkStrings(node: unknown, path: string): Generator<{ path: string; value: string }> {
  if (node == null) return;
  if (typeof node === "string") {
    if (node.trim()) yield { path, value: node };
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walkStrings(node[i], `${path}[${i}]`);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      yield* walkStrings(v, path ? `${path}.${k}` : k);
    }
  }
}

function firstMatch(value: string, rx: RegExp): string | undefined {
  const m = value.match(rx);
  return m?.[0];
}

function validateScores(analysis: CaseAnalysis, issues: QaIssue[]): void {
  const s = analysis.Scores ?? {};
  const numericKeys: (keyof typeof s)[] = [
    "case_strength",
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "overall_confidence",
  ];
  for (const k of numericKeys) {
    const v = s[k];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      issues.push({
        code: "SCORE_NOT_FINITE",
        severity: "critical",
        section: "Scores",
        message: `Scores.${String(k)} is not a finite number (${String(v)}).`,
      });
      continue;
    }
    if (v < 0 || v > 100) {
      issues.push({
        code: "SCORE_OUT_OF_RANGE",
        severity: "critical",
        section: "Scores",
        message: `Scores.${String(k)} = ${v} is outside 0–100.`,
      });
    }
  }
}

/**
 * Run the full prerender validation pass. Never throws; returns issues.
 * Callers decide whether to block (any critical) or persist warnings.
 */
export function validateBeforeRender(analysis: CaseAnalysis): QaIssue[] {
  const issues: QaIssue[] = [];
  const caseType = analysis.ExecutiveSummary?.case_type ?? null;
  const criminal = isCriminal(caseType);

  for (const { path, value } of walkStrings(analysis, "")) {
    // Placeholder scan
    for (const p of PLACEHOLDER_PATTERNS) {
      const sample = firstMatch(value, p.rx);
      if (sample) {
        issues.push({
          code: p.code,
          severity: p.severity,
          section: path.split(".")[0] || "Report",
          message: `Unresolved token in ${path}: "${sample}"`,
          sample,
        });
      }
    }
    // Case-type isolation — only for non-criminal reports
    if (!criminal) {
      for (const rx of CRIMINAL_ONLY_TERMS) {
        const sample = firstMatch(value, rx);
        if (sample) {
          issues.push({
            code: "CASE_TYPE_LEAK",
            severity: "critical",
            section: path.split(".")[0] || "Report",
            message: `Criminal-doctrine term "${sample}" appeared in a ${caseType ?? "non-criminal"} report at ${path}.`,
            sample,
          });
        }
      }
    }
  }

  validateScores(analysis, issues);

  // Score consistency — Scores.suppressed must come with a rationale.
  if (analysis.Scores?.suppressed && !analysis.Scores.rationale?.trim()) {
    issues.push({
      code: "SUPPRESSION_NO_REASON",
      severity: "warning",
      section: "Scores",
      message: "Scores are suppressed but no rationale is set. The report will display a suppression without explaining why.",
    });
  }

  return issues;
}

export function partitionIssues(issues: QaIssue[]): { critical: QaIssue[]; warnings: QaIssue[] } {
  return {
    critical: issues.filter((i) => i.severity === "critical"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}
