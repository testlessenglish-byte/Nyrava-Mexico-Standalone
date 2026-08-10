// Decision Reconstruction / Case Baseline — data model only.
//
// Phase 2 of the approved "Universal Completed Case Legal Audit Architecture
// Fix" plan. PURE MODULE (no I/O, no AI, no database access) — types plus a
// handful of small, deterministic helper functions. Building the actual
// reconstruction (an extraction pass over the case corpus) and consuming it
// from the Completed Case Audit pipeline are separate, NOT-YET-AUTHORIZED
// phases (3+); this module only defines the shape that work will produce
// and consume, so it can be reviewed and tested on its own before anything
// depends on it.
//
// WHY THIS EXISTS: the architecture diagnosis that preceded this plan found
// that "Completed Case" mode never independently reconstructs what a
// judicial decision actually said — it re-runs the SAME ordinary-case
// engines with a different prompt objective, then asks a late-pipeline
// audit pass to grade whatever those engines already produced. A
// reconstruction step lets every later stage (the audit engine, "routes to
// challenge," everything) work from one verified, source-attributed model
// of the case instead of re-deriving it ad hoc from raw findings each time.
//
// CORE DISCIPLINE — every fact in this model is wrapped in `Sourced<T>`:
//   PRESENT             — found in the corpus; `value` is populated and
//                          `source_refs` names where.
//   NOT_FOUND_IN_CORPUS  — actively looked for and not found. This is NOT
//                          the same as "the document doesn't have one" —
//                          absence-of-evidence is not evidence-of-absence,
//                          so callers must render this as "not found in the
//                          reviewed documents," never as a confirmed fact.
//   UNCERTAIN            — some signal exists but is not strong/unambiguous
//                          enough to assert as PRESENT (e.g. conflicting
//                          statements, an unclear procedural label).
//   NOT_APPLICABLE        — the field does not apply to this matter at all
//                          (e.g. `cited_precedent` for a single-instance
//                          matter with no jurisprudencia invoked).
// `value` MUST be null whenever status is not PRESENT — nothing here is
// ever invented to fill a gap.

/** The union of evidence-ref shapes already produced across the codebase
 *  (agent JSON schemas use doc_n+quote; some server-side shims use
 *  document_id/doc_id) — reconciled here rather than inventing a new shape,
 *  so callers can pass through whatever they already have. */
export type EvidenceRef = {
  doc_n?: number;
  document_id?: string;
  doc_id?: string;
  quote?: string;
  label?: string;
};

export type SourceStatus = "PRESENT" | "NOT_FOUND_IN_CORPUS" | "UNCERTAIN" | "NOT_APPLICABLE";

export type Sourced<T> = {
  status: SourceStatus;
  /** Non-null only when status is PRESENT. */
  value: T | null;
  source_refs: EvidenceRef[];
  /** Optional human-readable reason — required in practice whenever status
   *  is UNCERTAIN (why it couldn't be confirmed) or NOT_APPLICABLE (why it
   *  doesn't apply), but left optional in the type since PRESENT/
   *  NOT_FOUND_IN_CORPUS are usually self-explanatory from source_refs. */
  note?: string;
};

/** A Sourced value that is definitively absent or inapplicable, with no
 *  supporting evidence to cite — the common case for NOT_FOUND_IN_CORPUS/
 *  NOT_APPLICABLE. */
export function unsourced(
  status: "NOT_FOUND_IN_CORPUS" | "NOT_APPLICABLE" | "UNCERTAIN",
  note?: string,
): Sourced<never> {
  return { status, value: null, source_refs: [], note };
}

/** A Sourced value with a confirmed value and at least one supporting
 *  reference. Throws in development if called with zero refs — a PRESENT
 *  fact with no citation defeats the entire point of this model. */
export function sourced<T>(value: T, sourceRefs: EvidenceRef[], note?: string): Sourced<T> {
  if (sourceRefs.length === 0) {
    throw new Error(
      "sourced() requires at least one source_ref — use unsourced() for absent/uncertain values",
    );
  }
  return { status: "PRESENT", value, source_refs: sourceRefs, note };
}

export type PartyRoleEntry = Sourced<{
  /** Free-text role label — deliberately not a fixed enum here, since the
   *  vocabulary already varies by materia (quejoso/autoridad_responsable in
   *  amparo, parte_actora/parte_demandada elsewhere, ministerio_publico/
   *  defensa in penal — see MX_PARTY_ROLES in mexico-policy.ts, the existing
   *  single source of truth for those enums, which this model defers to
   *  rather than duplicating). */
  role: string;
  /** The party's actual name/identifier as it appears in the corpus, when
   *  known — never a placeholder. */
  identifier: string | null;
}>;

export type ProceduralEvent = Sourced<{
  date: string | null;
  event: string;
}>;

/** A single proposition drawn from the corpus — the same judicial-hierarchy
 *  taxonomy already used for findings (finding-taxonomy.ts), reused here
 *  rather than duplicated, so a party argument and a court holding are
 *  structurally distinct from the moment they enter this model, not just at
 *  finding-generation time. */
export type ReconstructedProposition = Sourced<{
  text: string;
  /** Who asserted it — see finding-taxonomy.ts's SpeakerRole. Left as
   *  `string | null` here (rather than importing the union type) so this
   *  model does not hard-fail on a speaker role the taxonomy hasn't seen
   *  yet; validate against SPEAKER_ROLES at the point of use if needed. */
  speaker_role: string | null;
  proposition_type: string | null;
  adoption_status: string | null;
}>;

export type LegalAuthorityCitation = Sourced<{
  /** e.g. "Ley de Amparo", "CPEUM" — the statute/instrument name as cited. */
  authority_hint: string;
  article_number: string | null;
  /** Populated only once independently checked against the legal-source
   *  corpus (legal-connectors/citation-verification.server.ts) — this model
   *  does not itself verify; it records whatever verification status the
   *  caller already computed, or leaves it null if no check has run yet. */
  verification_status: "VERIFIED" | "UNVERIFIED" | null;
}>;

export type PrecedentCitation = Sourced<{
  /** e.g. "1a./J. 15/2019 (10a.)" — see citation-extract.ts's TESIS_PATTERN. */
  registry_reference: string;
}>;

/**
 * A single case's reconstructed decision baseline. Every top-level field
 * is itself Sourced (or an array of Sourced entries) — there is no field on
 * this type that can be populated without naming where it came from.
 */
export type CaseDecisionReconstruction = {
  case_id: string;
  /** When this reconstruction was produced — reconstructions are a
   *  snapshot, not a live view; a later corpus change (new document
   *  uploaded, Talk-to-Case correction) requires a fresh reconstruction,
   *  not a patch to this one. */
  reconstructed_at: string;

  matter_identity: Sourced<{ case_type: string; subject_matter_summary: string }>;
  court: Sourced<{ name: string; level: string | null }>;
  jurisdiction: Sourced<{ level: string; territory: string | null }>;
  /** e.g. "amparo directo en revisión", "primera instancia", "apelación" —
   *  see case-analysis-mode.ts's getProceduralTypeLock() for the existing
   *  procedural-type vocabulary this should draw from rather than inventing
   *  a parallel one. */
  procedural_posture: Sourced<{ stage: string; instance_type: string | null }>;

  parties: PartyRoleEntry[];
  procedural_history: ProceduralEvent[];
  material_facts: Sourced<string>[];
  issues_presented: Sourced<string>[];
  party_arguments: ReconstructedProposition[];
  evidence_and_factual_findings: Sourced<string>[];
  applicable_legal_authorities: LegalAuthorityCitation[];
  court_reasoning: ReconstructedProposition[];
  court_holding: ReconstructedProposition[];
  disposition_remedy: Sourced<string>;
  unresolved_issues: Sourced<string>[];
  cited_precedent: PrecedentCitation[];
};

/** An empty reconstruction with every field defaulted to NOT_FOUND_IN_CORPUS
 *  — the correct starting point for a builder to progressively fill in as
 *  it processes the corpus, never a placeholder that could accidentally
 *  ship half-built (every field already carries an honest, renderable
 *  status even before extraction runs). */
export function emptyReconstruction(
  caseId: string,
  reconstructedAt: string,
): CaseDecisionReconstruction {
  const nf = () => unsourced("NOT_FOUND_IN_CORPUS");
  return {
    case_id: caseId,
    reconstructed_at: reconstructedAt,
    matter_identity: nf(),
    court: nf(),
    jurisdiction: nf(),
    procedural_posture: nf(),
    parties: [],
    procedural_history: [],
    material_facts: [],
    issues_presented: [],
    party_arguments: [],
    evidence_and_factual_findings: [],
    applicable_legal_authorities: [],
    court_reasoning: [],
    court_holding: [],
    disposition_remedy: nf(),
    unresolved_issues: [],
    cited_precedent: [],
  };
}
