/**
 * Evidence-presence rule, not a criminal-law determination. The applicable
 * rule and the qualifying antecedent must be expressly evidenced; neither
 * offense severity nor procedural history supplies them.
 */
export function validateReincidenciaEvidence<T extends Record<string, any>>(finding: T): T {
  const label = String(finding.category ?? "") + " " + String(finding.title ?? "");
  if (finding.category === "unsupported_reincidencia") return {...finding,report_suppressed:true,attorney_review_required:true};
  if (!/\b(reincidencia|recidivism)\b/i.test(label)) return finding;
  const basis = finding.reincidencia_evidence ?? finding.metadata?.reincidencia_evidence;
  const refs: Record<string, any>[] = Array.isArray(finding.evidence_refs) ? finding.evidence_refs : [];
  const prior = String(basis?.prior_conviction_quote ?? "").trim();
  const rule = String(basis?.applicable_rule ?? "").trim();
  const supported = basis?.legally_relevant_antecedent_verified === true &&
    !!rule && !!basis?.prior_conviction_id && prior.length > 0 &&
    /condena(?:do)?|sentencia|convict/i.test(prior) &&
    !/no\s+(?:existe|consta|hay|se acredita)|sin\s+antecedente|not convicted|no prior/i.test(prior) &&
    refs.some(r => !!(r.canonical_source_id || r.document_id) && !!(r.page || r.page_number) &&
      String(r.quote ?? "").includes(prior));
  if (supported) return finding;
  return { ...finding, category: "unsupported_reincidencia",
    title: "Antecedente de reincidencia no acreditado — revisión profesional requerida",
    attorney_review_required: true, report_suppressed: true,
    evidence_validation: "Missing explicit qualifying prior-conviction evidence and applicable rule" };
}
