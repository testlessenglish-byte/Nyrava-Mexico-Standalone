// Deterministic classification + priority ranking for findings.
//
// Runs after the LLM extracts findings to produce three canonical fields
// the renderer and perspective views rely on:
//   - evidence_type:   inculpatory | exculpatory | impeachment | neutral
//   - impact_direction: strengthens | weakens | neutral
//   - priority:         1 (case-dispositive) .. 4 (minor)
//
// These overrides are intentional. The LLM is good at finding facts but
// frequently mis-classifies who a defect helps (e.g. tagging "missing
// chain of custody" as "supports prosecution"). The lookup table below
// is the single source of truth for category → classification.

import type { NewFinding, Severity } from "./types";

export type EvidenceType = "inculpatory" | "exculpatory" | "impeachment" | "neutral";
export type ImpactDirection = "strengthens" | "weakens" | "neutral";
export type AffectedParty = "defense" | "prosecution" | "both" | "neutral";

export type Classification = {
  evidence_type: EvidenceType;
  impact_direction: ImpactDirection;
  affected_party: AffectedParty;
};

// Category prefix / token → canonical classification.
// Order matters: earlier rules win.
const RULES: Array<{ match: RegExp; cls: Classification }> = [
  // Chain of custody / tampering — almost always impeachment of the State
  { match: /(chain[_ ]of[_ ]custody|custody[_ ]break|custody[_ ]gap|evidence[_ ]tampering)/i,
    cls: { evidence_type: "impeachment", impact_direction: "weakens", affected_party: "prosecution" } },
  // Constitutional defects — defense suppression material
  { match: /(constitutional|miranda|fourth[_ ]amendment|fifth[_ ]amendment|sixth[_ ]amendment|warrant[_ ]defect|franks|illegal[_ ]search|suppression)/i,
    cls: { evidence_type: "exculpatory", impact_direction: "weakens", affected_party: "prosecution" } },
  // Brady / discovery violations
  { match: /(brady|giglio|discovery[_ ]violation|discovery[_ ]gap|production[_ ]failure|withheld|undisclosed)/i,
    cls: { evidence_type: "exculpatory", impact_direction: "weakens", affected_party: "prosecution" } },
  // Forensic problems (DNA mix, degradation, lab error)
  { match: /(dna[_ ]degradation|mixed[_ ]dna|lab[_ ]error|daubert|forensic[_ ]unreliable)/i,
    cls: { evidence_type: "impeachment", impact_direction: "weakens", affected_party: "prosecution" } },
  // Witness defects
  { match: /(witness[_ ]bias|witness[_ ]contradiction|witness[_ ]inconsistency|credibility|informant[_ ]unreliable|impeachment)/i,
    cls: { evidence_type: "impeachment", impact_direction: "weakens", affected_party: "prosecution" } },
  // Timeline conflicts / alibi
  { match: /(alibi|timeline[_ ]conflict|timeline[_ ]inconsistency|timeline[_ ]gap)/i,
    cls: { evidence_type: "exculpatory", impact_direction: "weakens", affected_party: "prosecution" } },
  // Missing investigation / records
  { match: /(missing[_ ]evidence|missing[_ ]record|missing[_ ]interview|investigation[_ ]gap|unresolved[_ ]lead|evidence[_ ]missing)/i,
    cls: { evidence_type: "exculpatory", impact_direction: "weakens", affected_party: "prosecution" } },
  // Affirmative inculpatory matchers
  { match: /(corroborating[_ ]evidence|evidence[_ ]corroborated|witness[_ ]corroborated|forensic[_ ]corroborated|physical[_ ]evidence[_ ]intact|inculpatory)/i,
    cls: { evidence_type: "inculpatory", impact_direction: "strengthens", affected_party: "prosecution" } },
  // Civil-side
  { match: /(liability|breach|negligence_established|standard_of_care|causation|proximate_cause)/i,
    cls: { evidence_type: "inculpatory", impact_direction: "strengthens", affected_party: "both" } },
  { match: /(liability_defense|comparative_fault|assumption_of_risk|intervening_cause|superseding_cause|mitigation)/i,
    cls: { evidence_type: "exculpatory", impact_direction: "weakens", affected_party: "both" } },
];

export function classifyFinding(f: Partial<NewFinding>): Classification {
  const blob = `${f.category ?? ""} ${f.title ?? ""} ${f.description ?? ""}`.toLowerCase();
  for (const r of RULES) {
    if (r.match.test(blob)) return r.cls;
  }
  return { evidence_type: "neutral", impact_direction: "neutral", affected_party: "neutral" };
}

// ---------------------------------------------------------------------------
// PRIORITY RANKING — case-dispositive findings surface above noise.
// ---------------------------------------------------------------------------
//   1 → case-dispositive (alibi, suppression-eligible warrant, Brady)
//   2 → admissibility (chain-of-custody, authentication, Daubert)
//   3 → witness credibility (impeachment, bias, contradictions)
//   4 → minor inconsistencies

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function priorityFor(f: Partial<NewFinding>): number {
  const blob = `${f.category ?? ""} ${f.title ?? ""}`.toLowerCase();
  // P1 — case dispositive
  if (/(alibi|brady|warrant[_ ]defect|franks|illegal[_ ]search|miranda)/.test(blob)) return 1;
  if (f.severity === "critical" && /(constitutional|chain[_ ]of[_ ]custody|exculpatory)/.test(blob)) return 1;
  // P2 — admissibility
  if (/(chain[_ ]of[_ ]custody|authentication|daubert|forensic[_ ]unreliable|dna[_ ]degradation|mixed[_ ]dna|lab[_ ]error|constitutional|fourth[_ ]amendment|fifth[_ ]amendment|sixth[_ ]amendment)/.test(blob)) return 2;
  // P3 — credibility / contradictions
  if (/(witness|credibility|impeachment|informant|contradict)/.test(blob)) return 3;
  // Otherwise rank by severity
  const sr = SEV_RANK[(f.severity ?? "info") as Severity] ?? 4;
  return sr <= 1 ? 3 : 4;
}

// ---------------------------------------------------------------------------
// CONTENT → CATEGORY TAXONOMY (Task 3)
// Explicit rule-based mapping. First matching rule wins; fallback is
// "General Finding". Deliberately overrides upstream LLM category labels
// so a chain-of-custody tag never lands on a financial fraud finding.
//
// Locale-aware from the source (not translated after the fact): every
// category has a real Spanish name — reusing US doctrine names like
// "Discovery Violation" for a Mexican report is wrong regardless of what
// later translation layer might catch it, since a case-workspace UI that
// never goes through report-i18n.ts would show the raw English value.
// ---------------------------------------------------------------------------
const CATEGORY_RULES: Array<{ match: RegExp; category: string; categoryEs: string }> = [
  { match: /\b(financial\s+misconduct|money\s+laund|diver(?:t|sion)\s+of\s+funds|ponzi|investment\s+fraud|embezzl|wire\s+fraud|mail\s+fraud|kickback|bribe|shell\s+comp|commingl)\b/i,
    category: "Financial Fraud", categoryEs: "Fraude Financiero" },
  { match: /\b(brady|jencks|giglio|exculpatory|disclosure\s+violation|withheld\s+evidence|undisclosed\s+deal|immunity\s+agreement)\b/i,
    category: "Discovery Violation", categoryEs: "Deficiencia Probatoria" },
  { match: /\b(miranda|voluntariness|custodial\s+interrogation|confession|waiver\s+of\s+rights|self[- ]incrimin)\b/i,
    category: "Confession Issue", categoryEs: "Declaración del Imputado" },
  { match: /\b(search\s+warrant|warrantless|seizure|fourth\s+amendment|probable\s+cause|expectation\s+of\s+privacy|franks)\b/i,
    category: "Constitutional Issue", categoryEs: "Cuestión Constitucional" },
  { match: /\b(expert\s+(?:report|opinion|witness|qualifications?)|methodology|daubert|frye|peer[- ]review|error\s+rate)\b/i,
    category: "Expert Challenge", categoryEs: "Impugnación Pericial" },
  { match: /\b(authenticat|foundation|hearsay|best\s+evidence|business\s+records?\s+exception|self[- ]authenticating)\b/i,
    category: "Evidentiary Foundation", categoryEs: "Fundamentación Probatoria" },
  { match: /\b(physical\s+evidence|dna|fingerprint|weapon|firearm|drugs?\s+seized|narcotics|contraband|blood\s+sample)\b/i,
    category: "Physical Evidence", categoryEs: "Evidencia Física" },
  { match: /\b(chain\s+of\s+custody|evidence\s+log|seal(?:ed|ing)|tamper|storage\s+gap)\b/i,
    category: "Chain of Custody", categoryEs: "Cadena de Custodia" },
  { match: /\b(witness\s+statement|testimony|interview|deposition|grand\s+jury|proffer|cooperating\s+witness)\b/i,
    category: "Witness Testimony", categoryEs: "Testimonio de Testigo" },
  { match: /\b(credibility|impeachment|bias|prior\s+inconsistent|motive\s+to\s+lie)\b/i,
    category: "Credibility", categoryEs: "Credibilidad" },
  { match: /\b(criminal\s+conduct|racketeer|conspir(?:e|acy)|obstruction|perjury)\b/i,
    category: "Criminal Conduct", categoryEs: "Conducta Delictiva" },
  { match: /\b(fraud\s+pattern|scheme\s+to\s+defraud|false\s+representation|misrepresentation|deceit)\b/i,
    category: "Fraud Pattern", categoryEs: "Patrón de Fraude" },
];

export function classifyCategory(f: Partial<NewFinding>, locale: "es" | "en" = "es"): string {
  const blob = `${f.title ?? ""} ${f.description ?? ""} ${f.category ?? ""}`;
  for (const r of CATEGORY_RULES) if (r.match.test(blob)) return locale === "en" ? r.category : r.categoryEs;
  return locale === "en" ? "General Finding" : "Hallazgo General";
}

const LEGACY_CATEGORY_ALIAS: Record<string, { en: string; es: string }> = {
  contradiction: { en: "Credibility", es: "Credibilidad" },
  witness: { en: "Witness Testimony", es: "Testimonio de Testigo" },
  fact: { en: "General Finding", es: "Hallazgo General" },
  evidence: { en: "Physical Evidence", es: "Evidencia Física" },
  chain_of_custody: { en: "Chain of Custody", es: "Cadena de Custodia" },
  missing_evidence: { en: "Discovery Violation", es: "Deficiencia Probatoria" },
  discovery_gap: { en: "Discovery Violation", es: "Deficiencia Probatoria" },
  weak_evidence: { en: "General Finding", es: "Hallazgo General" },
  risk: { en: "General Finding", es: "Hallazgo General" },
  entity: { en: "General Finding", es: "Hallazgo General" },
  timeline: { en: "General Finding", es: "Hallazgo General" },
};

export function rankAndClassify<T extends Partial<NewFinding>>(
  rows: T[],
  locale: "es" | "en" = "es",
): Array<T & {
  evidence_type: EvidenceType;
  impact_direction: ImpactDirection;
  priority: number;
  category: string;
}> {
  const generalFinding = locale === "en" ? "General Finding" : "Hallazgo General";
  const chainOfCustody = locale === "en" ? "Chain of Custody" : "Cadena de Custodia";
  const financialFraud = locale === "en" ? "Financial Fraud" : "Fraude Financiero";
  return rows.map((r) => {
    const cls = classifyFinding(r);
    const contentCat = classifyCategory(r, locale);
    let category = contentCat;
    if (category === generalFinding) {
      const raw = String(r.category ?? "").toLowerCase();
      if (raw && LEGACY_CATEGORY_ALIAS[raw]) category = LEGACY_CATEGORY_ALIAS[raw][locale];
      else if (raw) category = raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    // Guardrail: never label a financial/fraud finding as "Chain of Custody".
    if (
      category === chainOfCustody &&
      /\b(financial|fraud|money|funds|ponzi|embezzl|fraude|dinero|lavado|desfalco)\b/i.test(`${r.title ?? ""} ${r.description ?? ""}`)
    ) {
      category = financialFraud;
    }
    return {
      ...r,
      category,
      evidence_type: cls.evidence_type,
      impact_direction: cls.impact_direction,
      affected_party: cls.affected_party === "neutral" ? (r.affected_party ?? null) : cls.affected_party,
      priority: priorityFor(r),
    };
  });
}

