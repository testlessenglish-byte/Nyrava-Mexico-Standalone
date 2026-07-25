// Single source of truth: finding content → scoring dimension(s).
//
// WHY THIS FILE EXISTS
// Previously two independent taxonomies existed and silently drifted apart:
//   - classify.server.ts CATEGORY_RULES  → produced "Chain of Custody" (display)
//   - scoring.server.ts  DIMENSIONS      → matched on "chain_of_custody" (slug)
// A finding could be correctly classified for display and still score zero,
// because the display string and the scoring slug were never the same
// string. Separately, four dedicated LLM agents (witness_credibility,
// chain_of_custody, constitutional_compliance, procedural_violations) never
// emit a per-finding category at all — every finding they produce is
// stamped with the agent's OWN identity as category, not the content's
// actual subject. A custody-gap fact discovered by the "constitutional"
// agent was scoring against Constitutional Compliance, not Chain of Custody.
//
// CONFIRMED CHAIN (2026-07-14 audit): the chain_of_custody agent is the
// only one of the four gated through groundItems(minVerified:1) before
// persistence — when it can't ground a quote, ALL its output silently
// vanishes pre-insert. Meanwhile constitutional_compliance's findings
// (ungated) get category:"constitutional" stamped on everything they
// produce, including facts that are substantively about custody handling.
// "constitutional" happens to exact-match the constitutional_compliance
// scoring taxonomy, so it wins the dimension the custody fact should never
// have reached, while chain_of_custody stays at baseline having received
// nothing at all. Two independent bugs compounding into one visible symptom.
//
// FIX: one function, computeDimensionTags(), is the only place content is
// ever mapped to a dimension. It runs on title+description (never on
// source_module or agent identity), is called once at the single
// persistence choke point (addFindings in findings.server.ts), and its
// output is stored verbatim in the existing `tags` column as
// "dimension:<key>" entries. The scoring engine then does an O(1) tag
// lookup — no substring guessing, no case-vs-slug drift possible.
//
// A finding may legitimately affect several dimensions at once (this is
// the "canonical finding → multiple dimensions" propagation the case
// architecture doc called for). Polarity is uniform per finding: whichever
// direction classify.server.ts's classifyFinding() already determined
// (strengthens/weakens) applies to every dimension the finding is tagged
// against. That mirrors how these facts actually work in a case file — the
// same custody gap fact weakens custody integrity, evidence reliability,
// constitutional compliance, and investigation completeness simultaneously.

export type DimensionKey =
  | "evidence_strength"
  | "witness_reliability"
  | "timeline_integrity"
  | "chain_of_custody"
  | "constitutional_compliance"
  | "investigation_completeness"
  | "discovery_completeness"
  | "forensic_reliability"
  | "procedural_integrity"
  | "liability_strength"
  | "causation_strength"
  | "damages_exposure"
  | "expert_support"
  | "documentation_reliability"
  | "discovery_compliance"
  | "litigation_risk"
  | "settlement_pressure";

export const DIMENSION_TAG_PREFIX = "dimension:";

export function dimensionTag(key: DimensionKey): string {
  return `${DIMENSION_TAG_PREFIX}${key}`;
}

export function isDimensionTag(tag: string): tag is `dimension:${DimensionKey}` {
  return tag.startsWith(DIMENSION_TAG_PREFIX);
}

export function dimensionKeyFromTag(tag: string): string {
  return tag.slice(DIMENSION_TAG_PREFIX.length);
}

// Content rules: ONE regex → ONE OR MORE dimensions. Order does not matter;
// unlike classify.server.ts's CATEGORY_RULES (first-match-wins, for display
// labels), every rule that matches contributes — a finding can and should
// hit multiple dimensions. This is deliberate: it's what "propagation"
// means in the architecture doc (step 9).
const DIMENSION_RULES: Array<{ match: RegExp; dimensions: DimensionKey[] }> = [
  // Chain of custody / evidence handling failures
  {
    match: /\b(chain[\s_-]of[\s_-]custody|custody[\s_-]gap|custody[\s_-]break|evidence[\s_-]log|seal(?:ed|ing)|storage[\s_-]gap|personal\s+vehicle|evidence[\s_-]tamper\w*)\b/i,
    dimensions: ["chain_of_custody", "evidence_strength", "investigation_completeness"],
  },
  // Constitutional issues — 4th/5th/6th amendment, Miranda, search/seizure
  {
    match: /\b(fourth\s+amendment|fifth\s+amendment|sixth\s+amendment|miranda|search\s+warrant|warrantless|probable\s+cause|knock[\s-]and[\s-]announce|franks|due\s+process|self[\s-]incrimin\w*)\b/i,
    dimensions: ["constitutional_compliance"],
  },
  // Brady / Giglio / discovery violations
  {
    match: /\b(brady|giglio|exculpatory|withheld|undisclosed|discovery\s+violation|discovery\s+gap|production\s+failure|failed\s+to\s+disclose)\b/i,
    dimensions: ["discovery_completeness", "discovery_compliance", "constitutional_compliance"],
  },
  // Forensic / lab reliability (DNA, fingerprints, ballistics)
  {
    match: /\b(dna\s+exclu\w*|fingerprint\w*|ballistic\w*|forensic\w*|lab\s+error|daubert|frye|gunshot\s+residue|degrad\w*)\b/i,
    dimensions: ["forensic_reliability", "evidence_strength"],
  },
  // Witness / informant credibility
  {
    match: /\b(witness|informant|confidential\s+informant|\bci[\s-]4?\d*\b|credibility|impeach\w*|bias|prior\s+inconsistent|motive\s+to\s+lie)\b/i,
    dimensions: ["witness_reliability"],
  },
  // Timeline / alibi contradictions
  {
    match: /\b(timeline|alibi|gps|inconsisten\w*\s+(time|clothing|location)|contradict\w*\s+(surveillance|log|report))\b/i,
    dimensions: ["timeline_integrity"],
  },
  // Missing investigative steps / unresolved leads
  {
    match: /\b(missing\s+(evidence|record|interview|log)|investigation\s+gap|unresolved\s+lead|never\s+produced|failed\s+to\s+investigate)\b/i,
    dimensions: ["investigation_completeness"],
  },
  // Procedural rule violations (FRCP/FRCrP/local rules, deadlines, service)
  {
    match: /\b(procedural|frcp|frcrp|local\s+rule|deadline|service\s+defect|filing\s+defect)\b/i,
    dimensions: ["procedural_integrity"],
  },
  // Civil-side dimensions
  {
    match: /\b(liability|breach|negligence|standard\s+of\s+care|duty\s+of\s+care)\b/i,
    dimensions: ["liability_strength"],
  },
  {
    match: /\b(causation|proximate\s+cause|but[\s-]for|intervening\s+cause|superseding\s+cause)\b/i,
    dimensions: ["causation_strength"],
  },
  {
    match: /\b(damages|injury|loss|economic\s+damages|noneconomic\s+damages|life\s+care\s+plan)\b/i,
    dimensions: ["damages_exposure"],
  },
  {
    match: /\b(expert\s+(report|opinion|witness|qualif)|methodology|peer[\s-]review|error\s+rate)\b/i,
    dimensions: ["expert_support", "forensic_reliability"],
  },
  {
    match: /\b(document\s+integrity|record\s+alteration|documentation\s+discrepancy|records?\s+missing)\b/i,
    dimensions: ["documentation_reliability"],
  },
];

/**
 * Deterministically compute which dimensions a finding's CONTENT affects.
 * Input is title+description only — never source_module, never the
 * agent/engine that produced it, never the (possibly-wrong) category field.
 * This is what makes the mapping immune to Bug B (agent self-tagging).
 */
export function computeDimensionTags(f: { title?: string | null; description?: string | null }): string[] {
  const blob = `${f.title ?? ""} ${f.description ?? ""}`;
  const hit = new Set<DimensionKey>();
  for (const rule of DIMENSION_RULES) {
    if (rule.match.test(blob)) {
      for (const d of rule.dimensions) hit.add(d);
    }
  }
  return [...hit].map(dimensionTag);
}

/** Extract just the dimension keys already stored on a finding's tags[]. */
export function dimensionTagsOf(tags: readonly string[] | null | undefined): DimensionKey[] {
  if (!tags) return [];
  return tags.filter(isDimensionTag).map((t) => dimensionKeyFromTag(t) as DimensionKey);
}
