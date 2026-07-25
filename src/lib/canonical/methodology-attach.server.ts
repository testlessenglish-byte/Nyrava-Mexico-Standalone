// Attaches methodology references to computed metrics so the renderer can
// display "how this number was calculated" alongside every score.
//
// The analysis type does not carry a first-class `methodology` slot; instead
// we stash the reference IDs on the Scores object under a `methodology_refs`
// sibling field. The type allows extra properties via `Record` in downstream
// consumers, and the writer/renderer treats it as optional.

import type { CaseAnalysis } from "./case-analysis";
import { METRIC_METHODOLOGY } from "./metric-methodology";

type ScoresWithMethodology = CaseAnalysis["Scores"] & {
  methodology_refs?: Record<string, string>;
};

export function attachMethodology(analysis: CaseAnalysis): CaseAnalysis {
  if (!analysis?.Scores) return analysis;
  const s = analysis.Scores as ScoresWithMethodology;
  const refs: Record<string, string> = {};
  const keys: Array<keyof CaseAnalysis["Scores"]> = [
    "case_strength",
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "overall_confidence",
  ];
  for (const k of keys) {
    if (s[k] == null) continue;
    const id = `scores.${String(k)}`;
    if (METRIC_METHODOLOGY[id]) refs[String(k)] = id;
  }
  if (Object.keys(refs).length > 0) s.methodology_refs = refs;
  return analysis;
}

export function missingMethodology(analysis: CaseAnalysis): string[] {
  const s = analysis?.Scores as ScoresWithMethodology | undefined;
  if (!s) return [];
  const missing: string[] = [];
  const keys: Array<keyof CaseAnalysis["Scores"]> = [
    "case_strength",
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "overall_confidence",
  ];
  for (const k of keys) {
    if (s[k] == null) continue;
    if (!s.methodology_refs?.[String(k)]) missing.push(String(k));
  }
  return missing;
}
