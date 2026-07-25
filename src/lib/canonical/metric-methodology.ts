// Central registry documenting how every computed metric emitted in a
// canonical report is calculated. Surfaced next to the value in the report
// and in the QA audit.

export interface MetricMethodology {
  id: string;
  label: string;
  formulaSummary: string;
  inputs: string[];
  range: string;
  interpretation: string;
}

export const METRIC_METHODOLOGY: Record<string, MetricMethodology> = {
  "scores.case_strength": {
    id: "scores.case_strength",
    label: "Case Strength",
    formulaSummary:
      "Weighted composite of evidence strength (40%), witness reliability (25%), timeline integrity (15%), and contradiction pressure (20%).",
    inputs: ["evidence_strength", "witness_reliability", "timeline_integrity", "contradictions"],
    range: "0–100",
    interpretation:
      "Higher values indicate a more defensible litigation posture given the current corpus; not a prediction of outcome.",
  },
  "scores.evidence_strength": {
    id: "scores.evidence_strength",
    label: "Evidence Strength",
    formulaSummary:
      "Average per-finding confidence weighted by citation density (unique documents cited).",
    inputs: ["findings.confidence", "findings.citations"],
    range: "0–100",
    interpretation:
      "Reflects how well conclusions are grounded in the produced corpus; independent of legal merit.",
  },
  "scores.witness_reliability": {
    id: "scores.witness_reliability",
    label: "Witness Reliability",
    formulaSummary:
      "Mean of per-witness reliability scores, penalized for identified bias and unresolved credibility risks.",
    inputs: ["witnesses.reliability", "witnesses.bias", "witnesses.credibility_risk"],
    range: "0–100",
    interpretation:
      "An estimate of how consistently the corpus's witnesses corroborate each other — not a personal credibility judgement.",
  },
  "scores.timeline_integrity": {
    id: "scores.timeline_integrity",
    label: "Timeline Integrity",
    formulaSummary:
      "Ratio of dated, cited timeline events to total events, minus contradiction density.",
    inputs: ["timeline.events", "contradictions"],
    range: "0–100",
    interpretation:
      "Measures how well the chronology in the corpus supports a coherent narrative.",
  },
  "scores.overall_confidence": {
    id: "scores.overall_confidence",
    label: "Overall Confidence",
    formulaSummary:
      "Harmonic mean of case_strength and evidence_strength, floored by the lowest-ranked required section.",
    inputs: ["scores.case_strength", "scores.evidence_strength"],
    range: "0–100",
    interpretation:
      "Aggregate signal — treat as a triage indicator, not a predictive probability.",
  },
  "witness.reliability": {
    id: "witness.reliability",
    label: "Witness Reliability",
    formulaSummary:
      "Per-witness score combining corroboration count with document-level citation weight.",
    inputs: ["citations", "corroborations", "contradictions"],
    range: "0–100",
    interpretation:
      "Higher scores indicate corroboration in the record; not a judgement of the person.",
  },
  "finding.confidence": {
    id: "finding.confidence",
    label: "Finding Confidence",
    formulaSummary:
      "Probability estimate based on citation count, source diversity, and contradiction score.",
    inputs: ["citations", "source diversity", "contradictions"],
    range: "0–1",
    interpretation:
      "How well the corpus supports this specific finding, independent of legal weight.",
  },
};

export function methodologyIdFor(path: string): string | null {
  return METRIC_METHODOLOGY[path]?.id ?? null;
}

export function methodologyList(): MetricMethodology[] {
  return Object.values(METRIC_METHODOLOGY);
}
