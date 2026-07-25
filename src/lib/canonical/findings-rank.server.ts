// Findings ranking — orders Findings by litigation importance × confidence
// and moves witness-profile items out of Findings (they belong in Witnesses).
//
// Freeze-compliant: array is reordered/pruned in place; section stays.

import type { CaseAnalysis, Finding } from "./case-analysis";

const IMPORTANCE: Record<string, number> = {
  contradiction: 1.0,
  material_omission: 0.95,
  key_legal_issue: 0.9,
  legal_issue: 0.9,
  high_risk_fact: 0.85,
  risk: 0.85,
  missing_evidence: 0.8,
  discovery_gap: 0.8,
  strong_evidence: 0.75,
  evidence: 0.75,
  witness_profile: 0.2,
  witness: 0.2,
};

function importanceFor(f: Finding): number {
  const cat = String(f.category ?? "").toLowerCase();
  for (const [key, w] of Object.entries(IMPORTANCE)) {
    if (cat.includes(key)) return w;
  }
  // Severity fallback
  const sev = f.severity;
  if (sev === "critical") return 0.9;
  if (sev === "high") return 0.75;
  if (sev === "medium") return 0.55;
  if (sev === "low") return 0.35;
  return 0.5;
}

function isWitnessProfile(f: Finding): boolean {
  const cat = String(f.category ?? "").toLowerCase();
  return cat.includes("witness_profile") || cat === "witness";
}

export function rankFindings(analysis: CaseAnalysis): CaseAnalysis {
  if (!Array.isArray(analysis.Findings)) return analysis;
  // Filter witness-profile items out of Findings.
  analysis.Findings = analysis.Findings.filter((f) => !isWitnessProfile(f));
  analysis.Findings.sort((a, b) => {
    const wa = importanceFor(a) * (typeof a.confidence === "number" ? a.confidence : 0.5);
    const wb = importanceFor(b) * (typeof b.confidence === "number" ? b.confidence : 0.5);
    return wb - wa;
  });
  // Refresh Executive Summary top_findings to reflect the new order (first 5
  // non-suppressed).
  if (analysis.ExecutiveSummary) {
    analysis.ExecutiveSummary.top_findings = analysis.Findings
      .filter((f) => !f.suppressed && !f.quarantined)
      .slice(0, 5)
      .map((f) => f.id);
  }
  return analysis;
}
