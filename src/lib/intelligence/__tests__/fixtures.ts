// Deterministic CaseIntelligenceObject fixtures, one per supported case type.
// These are the canonical inputs for parity / ESS / hallucination tests.
// Counts here are frozen — any future shape change must also update the
// snapshot in parity.test.ts, which is the intended forcing function.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ReportFixture = {
  id: string;
  case_type:
    | "family"
    | "criminal"
    | "civil"
    | "juvenile"
    | "probate"
    | "employment"
    | "administrative"
    | "corporate"
    | "commercial"
    | "mixed";
  // ReportLike row
  report: Record<string, any>;
};

function mkFinding(i: number, text: string, evidenceRefs: string[] = []) {
  return { id: `F-${i}`, text, evidence_refs: evidenceRefs };
}

function mkEvidence(i: number, label: string) {
  return { id: `E-${i}`, label, source_doc: `doc-${i}.pdf` };
}

function baseReport(
  type: ReportFixture["case_type"],
  opts: {
    ess: "minimal" | "low" | "medium" | "high";
    findings: number;
    evidence: number;
    witnesses: number;
    contradictions: number;
    disputed: number;
    timeline: number;
    motions: number;
    opportunities: number;
  },
): Record<string, any> {
  const minimal = opts.ess === "minimal";
  const findings = Array.from({ length: opts.findings }, (_, i) =>
    mkFinding(i + 1, `Finding ${i + 1} for ${type}`, i % 2 === 0 ? [`E-${i + 1}`] : []),
  );
  const evidence = Array.from({ length: opts.evidence }, (_, i) =>
    mkEvidence(i + 1, `Evidence ${i + 1}`),
  );
  const witnesses = Array.from({ length: opts.witnesses }, (_, i) => ({
    id: `W-${i + 1}`,
    name: `Witness ${i + 1}`,
  }));
  const contradictions = Array.from({ length: opts.contradictions }, (_, i) => ({
    id: `C-${i + 1}`,
    summary: `Contradiction ${i + 1}`,
    evidence_refs: [`E-${i + 1}`],
  }));
  const disputed = Array.from({ length: opts.disputed }, (_, i) => ({
    id: `D-${i + 1}`,
    summary: `Disputed issue ${i + 1}`,
  }));
  const timeline = Array.from({ length: opts.timeline }, (_, i) => ({
    id: `T-${i + 1}`,
    when: `2025-01-${String(i + 1).padStart(2, "0")}`,
    event: `Event ${i + 1}`,
  }));
  const motions = Array.from({ length: opts.motions }, (_, i) => ({
    id: `M-${i + 1}`,
    title: `Motion ${i + 1}`,
  }));
  const opportunities = Array.from({ length: opts.opportunities }, (_, i) => ({
    id: `O-${i + 1}`,
    title: `Opportunity ${i + 1}`,
  }));

  return {
    case_type: type,
    scores_suppressed: minimal,
    motions_suppressed: minimal,
    case_strength_score: minimal ? null : 72,
    risk_score: minimal ? null : 41,
    contradictions_struct: contradictions,
    missing_evidence_struct: [],
    motion_opportunities: motions,
    evidence_index: evidence,
    citations: evidence.map((e) => ({ id: e.id, ref: e.source_doc })),
    constitutional_issues_struct: [],
    cross_examination: [],
    next_actions: [],
    engines_summary: {
      findings: { status: "ok", count: findings.length },
      contradictions: { status: "ok", count: contradictions.length },
      timeline: { status: "ok", count: timeline.length },
    },
    full_report: {
      case_type: type,
      disputed_issues: disputed,
      timeline,
      validation: {
        evidence_sufficiency: {
          level: opts.ess,
          allowQuantitativeScores: !minimal,
          allowMotionGeneration: !minimal,
          reason: minimal ? "Insufficient corroborating evidence" : null,
        },
      },
      intelligence: {
        consolidated_findings: findings,
        witnesses,
        strategy_rows: minimal ? [] : [{ id: "S-1", title: "Strategy 1" }],
        perspectives: [{ id: "P-1", angle: "defense" }],
        opportunities,
        theories: [{ id: "TH-1", text: "Theory 1" }],
      },
    },
  };
}

export const FIXTURES: ReportFixture[] = [
  {
    id: "fam-01",
    case_type: "family",
    report: baseReport("family", {
      ess: "high",
      findings: 6,
      evidence: 10,
      witnesses: 3,
      contradictions: 2,
      disputed: 2,
      timeline: 8,
      motions: 2,
      opportunities: 3,
    }),
  },
  {
    id: "crim-01",
    case_type: "criminal",
    report: baseReport("criminal", {
      ess: "medium",
      findings: 5,
      evidence: 12,
      witnesses: 4,
      contradictions: 3,
      disputed: 1,
      timeline: 6,
      motions: 3,
      opportunities: 2,
    }),
  },
  {
    id: "civ-01",
    case_type: "civil",
    report: baseReport("civil", {
      ess: "medium",
      findings: 4,
      evidence: 9,
      witnesses: 2,
      contradictions: 1,
      disputed: 2,
      timeline: 5,
      motions: 1,
      opportunities: 2,
    }),
  },
  {
    id: "juv-01",
    case_type: "juvenile",
    report: baseReport("juvenile", {
      ess: "low",
      findings: 3,
      evidence: 5,
      witnesses: 2,
      contradictions: 1,
      disputed: 1,
      timeline: 4,
      motions: 1,
      opportunities: 1,
    }),
  },
  {
    id: "prob-01",
    case_type: "probate",
    report: baseReport("probate", {
      ess: "medium",
      findings: 4,
      evidence: 7,
      witnesses: 1,
      contradictions: 1,
      disputed: 2,
      timeline: 3,
      motions: 0,
      opportunities: 2,
    }),
  },
  {
    id: "emp-01",
    case_type: "employment",
    report: baseReport("employment", {
      ess: "high",
      findings: 5,
      evidence: 11,
      witnesses: 3,
      contradictions: 2,
      disputed: 1,
      timeline: 7,
      motions: 2,
      opportunities: 4,
    }),
  },
  {
    id: "adm-01",
    case_type: "administrative",
    report: baseReport("administrative", {
      ess: "low",
      findings: 2,
      evidence: 4,
      witnesses: 1,
      contradictions: 0,
      disputed: 1,
      timeline: 2,
      motions: 0,
      opportunities: 1,
    }),
  },
  {
    id: "corp-01",
    case_type: "corporate",
    report: baseReport("corporate", {
      ess: "medium",
      findings: 4,
      evidence: 6,
      witnesses: 2,
      contradictions: 1,
      disputed: 1,
      timeline: 3,
      motions: 2,
      opportunities: 2,
    }),
  },
  {
    id: "comm-01",
    case_type: "commercial",
    report: baseReport("commercial", {
      ess: "medium",
      findings: 5,
      evidence: 7,
      witnesses: 3,
      contradictions: 2,
      disputed: 1,
      timeline: 4,
      motions: 3,
      opportunities: 2,
    }),
  },
  {
    id: "mixed-01",
    case_type: "mixed",
    report: baseReport("mixed", {
      ess: "minimal", // ESS suppression case
      findings: 3,
      evidence: 3,
      witnesses: 1,
      contradictions: 0,
      disputed: 2,
      timeline: 2,
      motions: 5, // present in raw row but MUST be suppressed by canonical helper
      opportunities: 1,
    }),
  },
];

export const MINIMAL_ESS_FIXTURE = FIXTURES.find((f) => f.id === "mixed-01")!;
