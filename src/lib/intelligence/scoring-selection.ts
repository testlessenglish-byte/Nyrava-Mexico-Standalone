// Single source of truth for scoring/report finding selection.
//
// Both the scoring engine and the report generator MUST call
// getCanonicalScoringFindings(). No consumer may apply its own inclusion
// rules. This guarantees score === report across every dimension.
//
// Invariants enforced here:
//   1. Temporal — the upstream pipeline (discovery, contradictions,
//      evidence intelligence) must be finalized before scoring/report can
//      consume findings.
//   2. Structural — `engine:*` AND `agent:*` findings enter the canonical
//      set (both represent finalized, non-provisional pipeline output).
//      `analyzer:*` are provisional and never affect scoring or the report.
//   3. Reconciliation — duplicate/stale children are collapsed before any
//      score or report consumer sees them. The strongest epistemic survivor
//      (for example a VERIFIED_COURT_HOLDING) is the only row allowed to move
//      downstream calculations.
//   4. Safety — an empty canonical set is a hard error, never silent.
//   5. Ordering — scoring must occur AFTER the upstream preconditions.
//
// FIX (2026-07-13): this filter previously accepted ONLY `engine:*`
// findings, silently dropping every `agent:*` finding from scoring and the
// report. That excluded the entire output of the 4 specialized
// investigator agents — chain_of_custody, constitutional_compliance,
// procedural_violations, witness_credibility — from ever reaching the
// Key Findings section or the case scorecard, even when those agents ran
// successfully and produced grounded findings.
//
// FIX (2026-08-18): merely filtering source/status was not enough. The DB can
// legitimately contain multiple finalized rows for the same canonical legal
// issue because different engines/agents produced them before the read-time
// reconciliation pass. Scoring could therefore consume a stale speculative
// child even when report dedupe correctly preferred the verified court
// holding. ADR5829/2025 exposed this: an old "Exención de impuestos" row
// weakened every score dimension while its surviving canonical sibling was a
// neutral VERIFIED_COURT_HOLDING. Selection now performs the SAME pure
// consolidation used by report-time reconciliation before returning rows.

import { consolidateFindings } from "./finding-dedupe";
import { isCanonicalFinding } from "./finding-selection";
import type { Finding } from "./types";

export type CaseTimestamps = {
  discovery_at: string | null | undefined;
  contradiction_at: string | null | undefined;
  evidence_intel_at: string | null | undefined;
  scored_at?: string | null | undefined;
};

export type PipelineState = {
  finalized: boolean;
  discovery_at: string | null;
  contradiction_at: string | null;
  evidence_intel_at: string | null;
  scored_at: string | null;
};

export function derivePipelineState(c: CaseTimestamps): PipelineState {
  const finalized = Boolean(c.discovery_at && c.contradiction_at && c.evidence_intel_at);
  return {
    finalized,
    discovery_at: c.discovery_at ?? null,
    contradiction_at: c.contradiction_at ?? null,
    evidence_intel_at: c.evidence_intel_at ?? null,
    scored_at: c.scored_at ?? null,
  };
}

export class PipelineNotFinalizedError extends Error {
  code = "PIPELINE_NOT_FINALIZED" as const;
  constructor(msg = "PIPELINE_NOT_FINALIZED") {
    super(msg);
  }
}
export class CanonicalFindingsEmptyError extends Error {
  code = "CANONICAL_FINDINGS_EMPTY" as const;
  constructor(msg = "CANONICAL_FINDINGS_EMPTY") {
    super(msg);
  }
}
export class InvalidPipelineOrderError extends Error {
  code = "INVALID_PIPELINE_ORDER" as const;
  constructor(msg = "INVALID_PIPELINE_ORDER") {
    super(msg);
  }
}

/**
 * Canonical reportable finding selector. Reportability is an epistemic and
 * release-integrity decision; it is deliberately independent of whether a
 * finding moves a score. For example, a verified neutral SCJN holding is
 * reportable and remains in this set while scoring.server.ts correctly gives
 * it no signed weight.
 */
export function getCanonicalReportFindings(args: {
  caseRow: CaseTimestamps;
  findings: ReadonlyArray<Pick<Finding, "source_module"> & { metadata?: Record<string, unknown> | null }>;
}): Finding[] {
  const ps = derivePipelineState(args.caseRow);
  if (!ps.finalized) throw new PipelineNotFinalizedError();

  // Phase 1: keep only authoritative finalized engine/agent rows. This
  // removes provisional analyzer output, explicit suppressions and
  // hallucination/citation quarantines through isCanonicalFinding().
  const eligible = args.findings.filter((f) => isCanonicalFinding(f)) as Finding[];

  if (eligible.length === 0) throw new CanonicalFindingsEmptyError();

  // Phase 2: collapse rows that describe the same legal issue BEFORE either
  // scoring or reporting sees them. consolidateFindings is pure and preserves
  // all evidence/citations in the selected survivor while choosing the best
  // epistemic row (verified holding/fact/rule before a speculative issue).
  // This is essential because persistence intentionally retains historical
  // producer rows for auditability; history must never become double weight.
  const canonical = consolidateFindings(eligible) as Finding[];

  if (canonical.length === 0) throw new CanonicalFindingsEmptyError();
  return canonical;
}

/**
 * Canonical input set for deterministic scoring. This intentionally starts
 * from the same reportable registry; score eligibility/direction is decided
 * by findingScoringDirection(), not by deleting neutral legal holdings from
 * the reportable set.
 */
export function getCanonicalScoringFindings(args: {
  caseRow: CaseTimestamps;
  findings: ReadonlyArray<Pick<Finding, "source_module"> & { metadata?: Record<string, unknown> | null }>;
}): Finding[] {
  return getCanonicalReportFindings(args);
}

/**
 * Execution-order guard. Call at scoring AND report entrypoints.
 * - At scoring entry: pass `mode: "scoring"` (scored_at not yet written; only
 *   precondition timestamps are checked).
 * - At report entry: pass `mode: "report"` (verifies scored_at >= the
 *   precondition timestamps).
 */
export function assertPipelineOrder(caseRow: CaseTimestamps, mode: "scoring" | "report" = "report"): void {
  const { scored_at, discovery_at, contradiction_at, evidence_intel_at } = caseRow;
  if (!discovery_at || !contradiction_at || !evidence_intel_at) {
    throw new PipelineNotFinalizedError();
  }
  if (mode === "report") {
    if (!scored_at) throw new InvalidPipelineOrderError();
    const s = Date.parse(scored_at);
    if (s < Date.parse(discovery_at) || s < Date.parse(contradiction_at) || s < Date.parse(evidence_intel_at)) {
      throw new InvalidPipelineOrderError();
    }
  }
}

