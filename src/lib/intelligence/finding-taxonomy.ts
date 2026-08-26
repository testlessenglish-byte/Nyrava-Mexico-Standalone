// Shared finding-classification taxonomy — single source of truth.
//
// Phase 1 of the Completed Case Legal Audit architecture fix. Root cause
// this addresses (see the session's architecture diagnosis): the
// proposition_type/speaker_role/adoption_status taxonomy already existed as
// real DB columns and normalizers (findings.server.ts), but was only ever
// requested by ONE prompt (the analyzers stage's "contradictions"/
// "key_findings" JSON schema, pipeline.server.ts) — every other
// finding-producing engine (the ~50-entry AGENTS array) never asked for it,
// so the field was silently null everywhere except that one stage. The
// enum VALUES were also duplicated by hand in two places (the prompt string
// and findings.server.ts's normalizers), which could drift independently.
//
// This module is the ONE place both the prompt-schema text and the
// normalizers read from, so a new engine wiring in this taxonomy can never
// disagree with what findings.server.ts will actually accept.
//
// Pure data + string-building — no IO, no AI, no React. Safe to import from
// server functions, the worker, and prompt-building code alike.

export const PROPOSITION_TYPES = [
  // Legacy values remain accepted for existing rows and non-Penal engines.
  "argument",
  "holding",
  "procedural_fact",
  "evidence",
  "issue",
  // Canonical legal proposition taxonomy.
  "case_fact",
  "allegation",
  "party_argument",
  "prosecution_position",
  "defense_position",
  "victim_position",
  "witness_statement",
  "expert_opinion",
  "physical_evidence",
  "documentary_evidence",
  "digital_evidence",
  "legal_rule",
  "court_holding",
  "rejected_holding",
  "procedural_event",
  "evidence_gap",
  "risk",
  "unresolved_question",
] as const;
export type PropositionType = (typeof PROPOSITION_TYPES)[number];

export const SPEAKER_ROLES = [
  "quejoso",
  "autoridad",
  "ministerio_publico",
  "fiscal",
  "defensa",
  "imputado",
  "acusado",
  "sentenciado",
  "victima",
  "ofendido",
  "testigo",
  "perito",
  "juez_control",
  "tribunal_enjuiciamiento",
  "tribunal_alzada",
  "tribunal_colegiado",
  "tribunal_local",
  "scjn",
] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

export const ADOPTION_STATUSES = [
  "adopted",
  "rejected",
  "not_reached",
  "party_position",
  "historical",
  "unknown",
  // Legacy read compatibility.
  "unresolved",
] as const;
export type AdoptionStatus = (typeof ADOPTION_STATUSES)[number];

/** Completed-case audit classification — case-analysis-mode.ts's own
 *  taxonomy, moved here so it shares one home with the rest of the
 *  classification vocabulary rather than being defined a third time. */
export const AUDIT_CLASSIFICATIONS = [
  "VERIFIED_FACT",
  "VERIFIED_COURT_HOLDING",
  "VERIFIED_LEGAL_RULE",
  "SUPPORTED_INFERENCE",
  "POTENTIAL_ISSUE",
  "EVIDENCE_GAP",
  "NOT_FOUND",
] as const;
export type AuditClassification = (typeof AUDIT_CLASSIFICATIONS)[number];

function enumLiteral(values: readonly string[]): string {
  return values.map((v) => `"${v}"`).join("|");
}

/**
 * The exact JSON-schema fields to splice into an engine's output schema —
 * byte-identical to what the analyzers stage's "contradictions"/
 * "key_findings" buckets already ask for (pipeline.server.ts), so every
 * engine that adopts this fragment is understood identically by
 * findings.server.ts's normalizers on the other end.
 */
export function judicialHierarchySchemaFragment(): string {
  return (
    `"speaker_role": ${enumLiteral(SPEAKER_ROLES)}|null, ` +
    `"proposition_type": ${enumLiteral(PROPOSITION_TYPES)}|null, ` +
    `"adoption_status": ${enumLiteral(ADOPTION_STATUSES)}|null`
  );
}

/**
 * The audit_classification field, same "always in the schema, prose decides
 * when it's actually populated" shape as judicialHierarchySchemaFragment()
 * above. Confirmed missing from every one of the 11 constitutional/amparo
 * agent prompts (and the analyzers-stage contradictions/key_findings
 * buckets) on a real completed-case audit: getCaseAnalysisObjective()
 * (case-analysis-mode.ts) already conditionally injects the taxonomy's
 * instructional prose into these same prompts' preamble (null outside
 * completed-case modes) — but without the field actually listed in the
 * engine's OWN JSON schema, the model has no declared slot to put the
 * value in, so it came back null on every finding except the one agent
 * (ways_out_analysis) whose schema already happened to ask for it
 * explicitly. Splice this alongside judicialHierarchySchemaFragment()
 * everywhere that fragment is used — same rationale, same "why isn't every
 * engine on the same schema" root cause this module was built to close for
 * speaker_role/proposition_type/adoption_status in the first place.
 */
export function auditClassificationSchemaFragment(): string {
  return `"audit_classification": ${enumLiteral(AUDIT_CLASSIFICATIONS)}|null`;
}

/**
 * The instructional paragraph explaining WHEN and HOW to populate the three
 * judicial-hierarchy fields — same content and same "omit entirely on a
 * single-instance matter" rule as the analyzers-stage prompt
 * (pipeline.server.ts), reused verbatim so every engine teaches the model
 * the identical distinction rather than a paraphrase that could drift.
 */
export function judicialHierarchyInstructions(): string {
  return `JUDICIAL-HIERARCHY ATTRIBUTION — applies ONLY when the corpus is (or includes) a resolution from one judicial instance reviewing another's ruling (e.g. amparo directo en revisión, recurso de revisión, apelación, revisión fiscal — any document where a higher instance affirms, revokes, or modifies a lower instance's sentencia/laudo/resolución). When that is the case, every finding whose content is a legal conclusion drawn FROM that resolution (as opposed to a plain fact about the underlying dispute) MUST also include:
  "speaker_role": which actor in the document ASSERTED this proposition — "quejoso" (the amparo petitioner's argument), "autoridad" (the responsible authority's position), "tribunal_local" (a local/administrative tribunal below the Tribunal Colegiado), "tribunal_colegiado" (the Tribunal Colegiado de Circuito's own ruling), or "scjn" (the Suprema Corte's own ruling in this document).
  "proposition_type": "argument" (a party merely argued this, it was not ruled on) | "holding" (the speaker_role actor's own ruling on the point) | "rejected_holding" (a LOWER instance's holding that a HIGHER instance in this SAME document expressly revoked, overturned, or declared incorrect/no trascendente) | "procedural_fact" (an undisputed procedural event, e.g. a filing date or notification method) | "evidence" | "issue" (a question the document frames but does not itself resolve).
  "adoption_status": "adopted" (the highest instance in the document affirmed this as part of its final ruling) | "rejected" (the highest instance expressly overturned, revoked, or discarded it — including when it said the point was "no trascendente para la conclusión alcanzada") | "unresolved" (raised but the document does not rule on it, e.g. remanded to a lower instance) | "historical" (a superseded intermediate position kept only for narrative context, e.g. what the trial-level Sala originally held before being reversed on appeal).
PENAL RULE: classify legal meaning independently from the engine that found it. A court holding remains court_holding even when a witness or chain-of-custody engine surfaced it; a Ministerio Público, defense, victim, witness, or expert statement is never a court holding. An adopted court holding is neutral for scoring unless a separate sourced mapping names the affected party, benefited party, score dimension, and reason.

CRITICAL RULE: if a Tribunal Colegiado's (or any lower instance's) reasoning is quoted or paraphrased ONLY because the higher instance (SCJN) is describing what that lower instance said — as antecedente, as the position under review, or as something the SCJN goes on to revoke/correct/deem not dispositive — the resulting finding's speaker_role MUST be the LOWER instance that actually said it (e.g. "tribunal_colegiado"), NEVER "scjn", even if the surrounding narrative sentence is written in the SCJN's voice ("el Tribunal Pleno determina que..."). Attribute every proposition to whoever is the true logical subject of the ruling being described, not to whichever court's document you are reading. When the case does not involve multi-instance review, omit all three fields entirely — do not force an attribution onto a single-instance matter.`;
}
