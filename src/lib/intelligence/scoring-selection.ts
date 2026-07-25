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
//   3. Safety — an empty canonical set is a hard error, never silent.
//   4. Ordering — scoring must occur AFTER the upstream preconditions.
//
// FIX (2026-07-13): this filter previously accepted ONLY `engine:*`
// findings, silently dropping every `agent:*` finding from scoring and the
// report. That excluded the entire output of the 4 specialized
// investigator agents — chain_of_custody, constitutional_compliance,
// procedural_violations, witness_credibility — from ever reaching the
// Key Findings section or the case scorecard, even when those agents ran
// successfully and produced grounded findings. This is why reports showed
// e.g. "10 visible findings" out of hundreds generated, and why dimensions
// like "Chain of custody integrity" showed "No findings mapped" despite the
// narrative repeatedly discussing a chain-of-custody gap: the agent finding
// that would have mapped to that dimension was filtered out before scoring
// ever saw it. A corrected copy of this logic already existed, unused, in
// canonical-scoring.ts — this brings scoring-selection.ts (the file
// actually imported by pipeline.server.ts) in line with it.

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
 * Canonical scoring/reporting finding selector.
 * MUST be called by both the scoring engine and the report generator.
 */
export function getCanonicalScoringFindings(args: {
  caseRow: CaseTimestamps;
  findings: ReadonlyArray<Pick<Finding, "source_module"> & { metadata?: Record<string, unknown> | null }>;
}): Finding[] {
  const ps = derivePipelineState(args.caseRow);
  if (!ps.finalized) throw new PipelineNotFinalizedError();

  const canonical = args.findings.filter((f) => {
    const sm = String(f.source_module ?? "");
    const provisional = (f.metadata as Record<string, unknown> | undefined)?.provisional === true;
    // Both `engine:*` (deterministic pipeline stages) and `agent:*`
    // (multi-agent orchestrator findings — witness credibility, chain of
    // custody, constitutional compliance, procedural violations, etc.) are
    // finalized, non-provisional output and MUST both count toward
    // scoring/report eligibility. Only `analyzer:*` (raw, pre-dedup)
    // findings are provisional and excluded.
    return (sm.startsWith("engine:") || sm.startsWith("agent:")) && !provisional;
  });

  if (canonical.length === 0) throw new CanonicalFindingsEmptyError();
  return canonical as Finding[];
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
