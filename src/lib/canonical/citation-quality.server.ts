// Citation quality enforcement.
//
// Every finding that reads as a legal conclusion (uses verbs like
// "constitutes", "establishes", "violates", "breaches") must carry at least
// one citation with { documentId, page, quote }. When any of those three is
// missing, we demote the wording to observational prose so the report does
// not present an unsupported legal conclusion as fact.
//
// Freeze-compliant: mutates existing Finding fields in place.

import type { CaseAnalysis, Citation, Finding } from "./case-analysis";

const CONCLUSION_VERBS = [
  /\bconstitutes?\b/i,
  /\bestablishes?\b/i,
  /\bviolates?\b/i,
  /\bbreaches?\b/i,
  /\bproves?\b/i,
  /\bdemonstrates? (?:as a matter of law|liability)\b/i,
  /\bis liable\b/i,
];

function isLegalConclusion(text: string): boolean {
  if (!text) return false;
  return CONCLUSION_VERBS.some((rx) => rx.test(text));
}

function fullyGrounded(c: Citation | undefined | null): boolean {
  if (!c) return false;
  return !!(c.documentId && c.page != null && (c.quote?.trim()?.length ?? 0) > 0);
}

function demoteToObservation(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/\bconstitutes\b/gi, "may support a claim of");
  out = out.replace(/\bestablishes\b/gi, "tends to show");
  out = out.replace(/\bviolates\b/gi, "may violate");
  out = out.replace(/\bbreaches\b/gi, "may breach");
  out = out.replace(/\bproves\b/gi, "suggests");
  out = out.replace(/\bis liable\b/gi, "may bear responsibility");
  out = out.replace(/\bas a matter of law\b/gi, "on this record");
  return out;
}

export function enforceCitationQuality(analysis: CaseAnalysis): CaseAnalysis {
  if (!Array.isArray(analysis.Findings)) return analysis;
  for (const f of analysis.Findings as Finding[]) {
    if (f.suppressed || f.quarantined) continue;
    const hasFullCite = (f.citations ?? []).some(fullyGrounded);
    const conclusion =
      isLegalConclusion(f.title) ||
      isLegalConclusion(f.description) ||
      isLegalConclusion(f.legal_significance ?? "");
    if (conclusion && !hasFullCite) {
      f.title = demoteToObservation(f.title);
      f.description = demoteToObservation(f.description);
      if (f.legal_significance) f.legal_significance = demoteToObservation(f.legal_significance);
      f.verification_status = "demoted_unsupported";
    }
  }
  return analysis;
}
