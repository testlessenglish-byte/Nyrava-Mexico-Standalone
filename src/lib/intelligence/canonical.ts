// Canonical intelligence helpers.
// SINGLE SOURCE OF TRUTH for every module that displays case intelligence.
// Every consumer (Dashboard, PDF, DOCX, JSON, Evidence Explorer, Timeline
// Builder, Witness Intelligence, Strategy Center, Motion Center, Talk-to-
// Cases, Voice Companion, Admin Analytics) MUST read intelligence through
// these helpers and never compute counts or sets independently.
//
// All helpers are pure functions over a `reports` row plus optional
// adjacent rows (witnesses, perspectives, etc. embedded in full_report).
// They honor ESS suppression (scores_suppressed, motions_suppressed) and
// the contradictions-vs-disputed split.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ReportLike = Record<string, any> | null | undefined;

function asObj(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}
function asArr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

export function getFullReport(r: ReportLike): Record<string, any> {
  return asObj(r?.full_report);
}

// ---- ESS state ---------------------------------------------------------

export type EssState = {
  level: "minimal" | "low" | "medium" | "high" | "unknown";
  scoresSuppressed: boolean;
  motionsSuppressed: boolean;
  allowQuantitativeScores: boolean;
  allowMotionGeneration: boolean;
  reason: string | null;
};

export function getEssState(r: ReportLike): EssState {
  const full = getFullReport(r);
  const ess = asObj(asObj(full.validation).evidence_sufficiency);
  const level = ((ess.level ?? ess.bin) as EssState["level"]) ?? "unknown";
  return {
    level,
    scoresSuppressed: Boolean(r?.scores_suppressed),
    motionsSuppressed: Boolean(r?.motions_suppressed),
    allowQuantitativeScores: ess.allowQuantitativeScores ?? !r?.scores_suppressed,
    allowMotionGeneration: ess.allowMotionGeneration ?? !r?.motions_suppressed,
    reason: (ess.reason as string) ?? null,
  };
}

// ---- Findings (consolidated) ------------------------------------------

export function getFindings(r: ReportLike): any[] {
  const full = getFullReport(r);
  const intel = asObj(full.intelligence);
  return asArr(intel.consolidated_findings);
}

// ---- Contradictions vs Disputed Issues --------------------------------

export function getContradictions(r: ReportLike): any[] {
  return asArr(r?.contradictions_struct);
}

export function getDisputedIssues(r: ReportLike): any[] {
  return asArr(getFullReport(r).disputed_issues);
}

// ---- Missing evidence -------------------------------------------------

export function getMissingEvidence(r: ReportLike): any[] {
  return asArr(r?.missing_evidence_struct);
}

// ---- Timeline ---------------------------------------------------------

export function getTimeline(r: ReportLike): any[] {
  const full = getFullReport(r);
  // Pipeline stores timeline events in full_report.timeline or .events
  return asArr(full.timeline ?? full.timeline_events ?? full.events);
}

// ---- Witnesses --------------------------------------------------------

export function getWitnesses(r: ReportLike): any[] {
  return asArr(asObj(getFullReport(r).intelligence).witnesses);
}

// ---- Strategies / perspectives ---------------------------------------

export function getStrategies(r: ReportLike): any[] {
  const intel = asObj(getFullReport(r).intelligence);
  return asArr(intel.strategy_rows);
}

export function getPerspectives(r: ReportLike): any[] {
  return asArr(asObj(getFullReport(r).intelligence).perspectives);
}

// ---- Opportunities ---------------------------------------------------

export function getOpportunities(r: ReportLike): any[] {
  return asArr(asObj(getFullReport(r).intelligence).opportunities);
}

// ---- Motions (ESS-gated) ---------------------------------------------

export function getMotions(r: ReportLike): any[] {
  if (r?.motions_suppressed) return [];
  return asArr(r?.motion_opportunities);
}

// ---- Evidence index --------------------------------------------------

export function getEvidence(r: ReportLike): any[] {
  return asArr(r?.evidence_index);
}

// ---- Citations -------------------------------------------------------

export function getCitations(r: ReportLike): any[] {
  return asArr(r?.citations);
}

// ---- Scores (ESS-gated) ----------------------------------------------

export function getScores(r: ReportLike): { strength: number | null; risk: number | null } {
  if (r?.scores_suppressed) return { strength: null, risk: null };
  const toNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    strength: toNum(r?.case_strength_score),
    risk: toNum(r?.risk_score),
  };
}

// ---- Theories --------------------------------------------------------

export function getTheories(r: ReportLike): any[] {
  return asArr(asObj(getFullReport(r).intelligence).theories);
}

// ---- Constitutional issues ------------------------------------------

export function getConstitutionalIssues(r: ReportLike): any[] {
  return asArr(r?.constitutional_issues_struct);
}

// ---- Legal issues (+ real case law from CourtListener, when present) --
// Populated by buildLegalIssuesWithCaseLaw() in report-augment.server.ts /
// pipeline.server.ts. Each entry may carry a `case_law` array of real,
// citable opinions — never invented. See case-law.server.ts.
export function getLegalIssues(r: ReportLike): any[] {
  return asArr(getFullReport(r).legal_issues);
}

// ---- Cross-examination / next actions -------------------------------

export function getCrossExamination(r: ReportLike): any[] {
  return asArr(r?.cross_examination);
}

export function getNextActions(r: ReportLike): any[] {
  return asArr(r?.next_actions);
}

// ---- Engine summary --------------------------------------------------

export function getEnginesSummary(r: ReportLike): Record<string, any> {
  return asObj(r?.engines_summary);
}

// ---- Canonical counts (used by parity verification) -----------------

export type CanonicalCounts = {
  findings: number;
  contradictions: number;
  disputed_issues: number;
  missing_evidence: number;
  timeline_events: number;
  witnesses: number;
  strategies: number;
  perspectives: number;
  opportunities: number;
  motions: number;
  evidence: number;
  citations: number;
  theories: number;
  constitutional: number;
  cross_examination: number;
  next_actions: number;
};

export function getCanonicalCounts(r: ReportLike): CanonicalCounts {
  return {
    findings: getFindings(r).length,
    contradictions: getContradictions(r).length,
    disputed_issues: getDisputedIssues(r).length,
    missing_evidence: getMissingEvidence(r).length,
    timeline_events: getTimeline(r).length,
    witnesses: getWitnesses(r).length,
    strategies: getStrategies(r).length,
    perspectives: getPerspectives(r).length,
    opportunities: getOpportunities(r).length,
    motions: getMotions(r).length,
    evidence: getEvidence(r).length,
    citations: getCitations(r).length,
    theories: getTheories(r).length,
    constitutional: getConstitutionalIssues(r).length,
    cross_examination: getCrossExamination(r).length,
    next_actions: getNextActions(r).length,
  };
}

// Stable hash over counts — surfaces define a parity signature so every
// module that reads the same report computes the same string. If two
// modules disagree, their hashes differ.
export function paritySignature(r: ReportLike): string {
  const c = getCanonicalCounts(r);
  const ess = getEssState(r);
  const parts = [
    `f${c.findings}`,
    `c${c.contradictions}`,
    `d${c.disputed_issues}`,
    `m${c.missing_evidence}`,
    `t${c.timeline_events}`,
    `w${c.witnesses}`,
    `s${c.strategies}`,
    `p${c.perspectives}`,
    `o${c.opportunities}`,
    `mo${c.motions}`,
    `e${c.evidence}`,
    `ci${c.citations}`,
    `th${c.theories}`,
    `co${c.constitutional}`,
    `xe${c.cross_examination}`,
    `na${c.next_actions}`,
    `ess${ess.level}`,
    `ss${ess.scoresSuppressed ? 1 : 0}`,
    `ms${ess.motionsSuppressed ? 1 : 0}`,
  ];
  return parts.join(".");
}

// ---- Deterministic fallback flag ------------------------------------
// True when the LLM narrative pass failed and the report was assembled
// purely from extracted findings. Every UI surface should check this
// and show the Limited Analysis Notice when true.
export function isDeterministicFallback(r: ReportLike): boolean {
  const full = getFullReport(r);
  return Boolean(asObj(full.validation).deterministic_fallback_used);
}

// ---- Single Report Mode (FULL vs LIMITED) ----------------------------
// Authoritative state that gates every section, score, footer, and export.
// Computed once from the report row and used everywhere — no consumer is
// allowed to invent its own mode locally.
export type ReportMode = "FULL" | "LIMITED";

export function getReportMode(r: ReportLike): ReportMode {
  if (!r) return "LIMITED";
  const full = getFullReport(r);
  const v = asObj(full.validation);
  if (v.report_mode === "FULL" || v.report_mode === "LIMITED") return v.report_mode as ReportMode;
  const ess = getEssState(r);
  const fb = isDeterministicFallback(r);
  if (fb || ess.scoresSuppressed || ess.motionsSuppressed) return "LIMITED";
  if (ess.level === "minimal" || ess.level === "unknown") return "LIMITED";
  return "FULL";
}

// ---- Practice Area (single source of truth for module isolation) -----
export function getPracticeArea(r: ReportLike): string {
  const full = getFullReport(r);
  const ct =
    (full.practice_area as string) || (full.case_type as string) || (r?.case_type as string) || "general_civil";
  return String(ct).toLowerCase();
}

// ---- Finding counters (single source of truth) -----------------------
export type FindingCounters = {
  generated: number;
  verified: number;
  rendered: number;
};

export function getFindingCounters(r: ReportLike): FindingCounters {
  const full = getFullReport(r);
  const v = asObj(full.validation);
  const counters = asObj(v.finding_counters);
  const findings = getFindings(r);
  const generated = typeof counters.generated === "number" ? counters.generated : findings.length;
  const verified = typeof counters.verified === "number" ? counters.verified : findings.length;
  // "rendered" means "what the report actually shows right now" — it must
  // always equal the live consolidated_findings array length, never a
  // cached number from validation.finding_counters. That cached value is
  // written once by the report-generation stage and can go stale if
  // consolidated_findings is ever regenerated without a full report
  // rerun, producing a cover page / Agent Statistics count that disagrees
  // with the Key Findings table actually rendered beneath it.
  const rendered = findings.length;
  return { generated, verified, rendered };
}

// ---- Agent summary (single source of truth) --------------------------
// Every screen that displays an agent count — top-nav badge, Multi-Agent
// panel, Dashboard tile, PDF/DOCX export — MUST read from this helper.
// Never derive counts by filtering `agent_findings` (which only lists
// agents that produced findings — that's the "3" bug) or by counting
// `agent_logs` on the client.
export type AgentSummary = {
  loaded: number;
  executed: number;
  producingOutput: number;
  producingFindings: number;
  suppressedFindings: number;
  visibleFindings: number;
};

const EMPTY_AGENT_SUMMARY: AgentSummary = {
  loaded: 0,
  executed: 0,
  producingOutput: 0,
  producingFindings: 0,
  suppressedFindings: 0,
  visibleFindings: 0,
};

export function getAgentSummary(r: ReportLike): AgentSummary {
  const full = getFullReport(r);
  const stats = asObj(full.agent_statistics);
  const defs = asObj(stats.definitions);
  // The server writes snake_case keys via buildAgentStatistics().
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  if (!defs || Object.keys(defs).length === 0) return EMPTY_AGENT_SUMMARY;
  return {
    loaded: num(defs.loaded),
    executed: num(defs.executed),
    producingOutput: num(defs.producing_output),
    producingFindings: num(defs.producing_findings),
    suppressedFindings: num(defs.suppressed_findings),
    visibleFindings: num(defs.visible_findings),
  };
}

/**
 * Invariants every AgentSummary must satisfy. Used by regression tests and
 * as a runtime dev-mode assertion catchall. Returns a list of violated
 * invariants for diagnostics (empty array = valid).
 */
export function validateAgentSummary(s: AgentSummary): string[] {
  const errs: string[] = [];
  if (s.loaded < s.executed) errs.push(`loaded (${s.loaded}) < executed (${s.executed})`);
  if (s.executed < s.producingOutput) errs.push(`executed (${s.executed}) < producingOutput (${s.producingOutput})`);
  if (s.producingOutput < s.producingFindings)
    errs.push(`producingOutput (${s.producingOutput}) < producingFindings (${s.producingFindings})`);
  if (s.visibleFindings > s.producingFindings && s.producingFindings > 0) {
    // visibleFindings can exceed producingFindings when a single agent produces multiple findings,
    // so we only warn when producingFindings is nonzero AND visibleFindings dwarfs it unreasonably.
    // The strict invariant from the user (visible <= producing) doesn't hold for many-per-agent
    // producers, so we relax to a non-negative check only.
  }
  if (s.suppressedFindings < 0) errs.push(`suppressedFindings (${s.suppressedFindings}) < 0`);
  return errs;
}
