// Judicial-hierarchy attribution gate.
//
// Bug this exists to fix: a case_findings row extracted from a multi-instance
// resolution (amparo directo en revisión reviewing a Tribunal Colegiado
// sentencia) had no record of WHO asserted a proposition or whether the
// highest instance in the case adopted it. Findings/types.ts's Finding
// carries no distinction between "the SCJN held X" and "the Tribunal
// Colegiado held X, and the SCJN's ejecutoria revoked that holding" — both
// looked like an identical [HECHO] finding with a severity/confidence
// score, so a superseded lower-court position could rank into the Executive
// Dashboard's Hallazgos Principales indistinguishably from an actual SCJN
// holding. See ADR 5829/2025 (SCJN, Pleno) for a concrete case: the report's
// "Interpretación de la Exención Fiscal" finding quoted the Tribunal
// Colegiado's ORIGINAL sentencia verbatim but attributed it to "La SCJN
// determinó", when the Pleno's actual ejecutoria revoked that sentencia.
//
// This module does not try to detect that contradiction after the fact —
// determining whether an SCJN passage and a Tribunal Colegiado passage
// address "the same issue" is a semantic judgment call the extraction LLM
// makes with the full document in front of it, not something a
// deterministic pass can reliably infer from two isolated finding rows.
// Instead: extraction tags each finding with speaker_role/proposition_type/
// adoption_status as it is produced (see the analyzer prompt in
// pipeline.server.ts), and everything here is the enforcement layer that
// consumes those tags — the actual "never show a rejected holding as a
// principal finding" guarantee.
//
// Additive by construction: a Finding with none of these three fields set
// (the vast majority of findings — most materias never touch a
// multi-instance judicial resolution) passes through every filter here
// unchanged. Nothing in this module can suppress a finding the extraction
// pass didn't explicitly attribute.

import type { AdoptionStatus, JudicialSpeakerRole, PropositionType } from "./types";

/** Lowest authority first, SCJN last — mirrors the priority ladder an
 * amparo directo en revisión actually enforces. */
export const JUDICIAL_HIERARCHY: readonly JudicialSpeakerRole[] = [
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
  "tribunal_local",
  "tribunal_alzada",
  "tribunal_colegiado",
  "scjn",
];

const RANK: Readonly<Record<string, number>> = Object.fromEntries(
  JUDICIAL_HIERARCHY.map((role, i) => [role, i]),
);

/** Structural subset any Finding-shaped object (DB row, canonical Finding,
 * or a bare test fixture) satisfies — keeps this module decoupled from any
 * one Finding type so it can gate both the DB shape and the report shape.
 * `unknown`, not the narrow literal unions, because several real call
 * sites (e.g. src/lib/export.ts's CaseExportData.findings) are untyped
 * `Record<string, unknown>` rows straight off Supabase — this module
 * validates each field's actual runtime value itself rather than trusting
 * a type annotation upstream code never actually enforced. */
export interface AttributedProposition {
  speaker_role?: unknown;
  proposition_type?: unknown;
  adoption_status?: unknown;
  /** Completed-case taxonomy. VERIFIED_COURT_HOLDING means "what the court
   * decided", not "a risk the attorney needs to fix". It may be displayed
   * in a dedicated holdings/context section, but never in a severity-ranked
   * Executive Dashboard risk list. */
  audit_classification?: unknown;
}

function rankOf(role: unknown): number {
  if (typeof role !== "string" || !role) return -1;
  return RANK[role] ?? -1;
}

/** True once extraction has tagged this proposition with ANY of the three
 * attribution fields. Everything else in this module is a no-op for a
 * finding that fails this check. */
export function hasAttribution(f: AttributedProposition): boolean {
  return Boolean(f.speaker_role || f.proposition_type || f.adoption_status);
}

/** A proposition a higher instance in the case expressly rejected or
 * superseded — the exact category that must never render as a principal
 * finding. */
export function isRejectedOrSuperseded(f: AttributedProposition): boolean {
  return f.adoption_status === "rejected" || f.proposition_type === "rejected_holding";
}

/** Court holdings are context/results, not risks. A historical severity
 * value may still exist on the row for backwards compatibility, but it must
 * never make the holding eligible for a severity-ranked dashboard widget. */
export function isVerifiedCourtHolding(f: AttributedProposition): boolean {
  return (
    String(f.audit_classification ?? "") === "VERIFIED_COURT_HOLDING" ||
    String(f.proposition_type ?? "") === "court_holding"
  );
}

const DASHBOARD_ELIGIBLE_TYPES = new Set<string>([
  "holding",
  "court_holding",
  "procedural_fact",
  "procedural_event",
]);

/**
 * Executive Dashboard rule: once a case carries attributed propositions,
 * only the HIGHEST instance actually present in that attribution (normally
 * the SCJN on an amparo directo en revisión, but a Tribunal Colegiado's own
 * sentencia definitiva when no higher instance reviewed it — see
 * "precedent mode" cases) may contribute principal findings, and only its
 * ADOPTED holdings/procedural facts — never a party argument, an
 * unresolved point, or a rejected/superseded lower-instance position.
 *
 * Independently of judicial attribution, VERIFIED_COURT_HOLDING rows are
 * excluded from this severity-ranked widget. They belong in the dedicated
 * "Determinaciones del Tribunal" section. This closes the residual ADR
 * 2239/2018 bug where the main findings section was fixed but the Executive
 * Dashboard could still paint a favorable SCJN holding as a high-severity
 * risk because it sorted the same row by its legacy severity field.
 *
 * Findings with no attribution at all otherwise pass straight through: this
 * filter only narrows them when the completed-case taxonomy explicitly says
 * they are court holdings.
 */
export function filterExecutiveDashboardEligible<T extends AttributedProposition>(findings: readonly T[]): T[] {
  const withoutCourtHoldings = findings.filter((f) => !isVerifiedCourtHolding(f));
  const attributed = withoutCourtHoldings.filter(hasAttribution);
  if (attributed.length === 0) return withoutCourtHoldings.slice();
  const highestRank = attributed.reduce((max, f) => Math.max(max, rankOf(f.speaker_role)), -1);
  return withoutCourtHoldings.filter((f) => {
    if (!hasAttribution(f)) return true;
    if (isRejectedOrSuperseded(f)) return false;
    if (f.adoption_status && f.adoption_status !== "adopted") return false;
    if (f.proposition_type && !DASHBOARD_ELIGIBLE_TYPES.has(String(f.proposition_type))) return false;
    return rankOf(f.speaker_role) === highestRank;
  });
}

/**
 * Scoring rule: narrower than the dashboard gate. A rejected/superseded
 * proposition must never contribute to a dimension score (it would
 * otherwise push a case-strength number in a direction the actual holding
 * contradicts), but unlike the dashboard, an adopted holding from ANY
 * instance still legitimately informs scoring even if a higher instance
 * exists elsewhere in the case and hasn't spoken to that specific point.
 */
export function excludeRejectedFromScoring<T extends AttributedProposition>(findings: readonly T[]): T[] {
  return findings.filter((f) => !isRejectedOrSuperseded(f));
}
