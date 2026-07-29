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

// REBUILT 2026-07-29: every regex below was English/U.S. legal terminology
// ("fourth amendment", "miranda", "brady", "daubert", "frcp") written
// before this session's Mexican-terminology rebuild of classify.server.ts
// and the LLM prompts in pipeline.server.ts/report-augment.server.ts. Since
// every finding's title/description is now generated in Spanish using CNPP/
// CPEUM vocabulary, none of these regexes could match anything anymore —
// this file being the PRIMARY tagging path (per the header comment above)
// meant every Mexican case's deterministic scorecard was silently running
// on baseline values with zero real signal from actual findings. Rebuilt
// to match the same Spanish vocabulary already established in
// classify.server.ts's CATEGORY_RULES and report-augment.server.ts's
// ISSUE_RULES, so a finding tagged there and a finding scored here agree.
const DIMENSION_RULES: Array<{ match: RegExp; dimensions: DimensionKey[] }> = [
  // Cadena de custodia / manejo de indicios
  {
    match:
      /\b(cadena\s+de\s+custodia|ruptura\s+de\s+custodia|manejo\s+indebido\s+de\s+indicios|indicio\s+contaminado|rotura\s+de\s+sello|laguna\s+en\s+custodia|contaminaci[oó]n\s+de\s+indicio)\b/i,
    dimensions: ["chain_of_custody", "evidence_strength", "investigation_completeness"],
  },
  // Cuestiones constitucionales — cateo, detención, debido proceso
  {
    match:
      /\b(debido\s+proceso|control\s+de\s+detenci[oó]n|cateo\s+sin\s+orden|cateo\s+irregular|cateo\s+ilegal|detenci[oó]n\s+arbitraria|flagrancia\s+cuestionada|caso\s+urgente\s+injustificado|prueba\s+il[ií]cita|exclusi[oó]n\s+probatoria|presunci[oó]n\s+de\s+inocencia|derecho\s+de\s+defensa\s+adecuada)\b/i,
    dimensions: ["constitutional_compliance"],
  },
  // Omisión en el deber de aportación probatoria / violaciones procesales
  {
    match:
      /\b(omisi[oó]n\s+de\s+investigaci[oó]n|irregularidad\s+en\s+la\s+carpeta|violaci[oó]n\s+al\s+debido\s+proceso|violaci[oó]n\s+al\s+derecho\s+de\s+defensa|defecto\s+en\s+la\s+incorporaci[oó]n\s+de\s+la\s+prueba|dato\s+de\s+prueba\s+no\s+revelado|prueba\s+no\s+desahogada|ocultamiento\s+de\s+evidencia)\b/i,
    dimensions: ["discovery_completeness", "discovery_compliance", "constitutional_compliance"],
  },
  // Confiabilidad pericial/forense
  {
    match:
      /\b(dictamen\s+pericial\s+deficiente|metodolog[ií]a\s+pericial\s+cuestionada|perito\s+sin\s+acreditaci[oó]n|perito\s+no\s+oficial|contaminaci[oó]n\s+de\s+muestra|error\s+de\s+laboratorio)\b/i,
    dimensions: ["forensic_reliability", "evidence_strength"],
  },
  // Credibilidad de testigo
  {
    match:
      /\b(testigo|testimonial|informante|colaborador|credibilidad|impugnaci[oó]n|sesgo|declaraci[oó]n\s+previa\s+inconsistente|testigo\s+no\s+confiable|motivo\s+para\s+mentir)\b/i,
    dimensions: ["witness_reliability"],
  },
  // Cronología / coartada
  {
    match:
      /\b(cronolog[ií]a|coartada|inconsistencia\s+de\s+fechas|vac[ií]o\s+en\s+la\s+cronolog[ií]a|contradicci[oó]n\s+de\s+(vigilancia|registro|informe))\b/i,
    dimensions: ["timeline_integrity"],
  },
  // Investigación incompleta / prueba faltante
  {
    match:
      /\b(prueba\s+faltante|registro\s+faltante|entrevista\s+faltante|vac[ií]o\s+de\s+investigaci[oó]n|indicio\s+perdido|l[ií]nea\s+de\s+investigaci[oó]n\s+sin\s+agotar|no\s+se\s+investig[oó])\b/i,
    dimensions: ["investigation_completeness"],
  },
  // Violaciones procesales (plazos, notificación, emplazamiento)
  {
    match:
      /\b(violaci[oó]n\s+procesal|carpeta\s+de\s+investigaci[oó]n|plazo\s+vencido|defecto\s+de\s+notificaci[oó]n|emplazamiento\s+irregular|defecto\s+en\s+el\s+escrito)\b/i,
    dimensions: ["procedural_integrity"],
  },
  // Materia civil — responsabilidad
  {
    match: /\b(responsabilidad\s+civil|incumplimiento\s+contractual|negligencia|deber\s+de\s+cuidado)\b/i,
    dimensions: ["liability_strength"],
  },
  {
    match: /\b(nexo\s+causal|causa\s+pr[oó]xima|causa\s+eficiente|causa\s+interviniente|causa\s+superveniente)\b/i,
    dimensions: ["causation_strength"],
  },
  {
    match: /\b(da[nñ]o\s+moral|da[nñ]o\s+material|indemnizaci[oó]n|perjuicio|lucro\s+cesante)\b/i,
    dimensions: ["damages_exposure"],
  },
  {
    match:
      /\b(dictamen\s+pericial|metodolog[ií]a\s+pericial|perito\s+oficial|perito\s+particular|revisi[oó]n\s+por\s+pares|margen\s+de\s+error)\b/i,
    dimensions: ["expert_support", "forensic_reliability"],
  },
  {
    match:
      /\b(integridad\s+documental|alteraci[oó]n\s+de\s+registro|discrepancia\s+documental|documentaci[oó]n\s+faltante)\b/i,
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
