// Unified findings selector — Phase 1 of the Intelligence Aggregation
// Refactor.
//
// PURE MODULE. No I/O, no Supabase, no AI. Every surface that counts,
// filters, or classifies `case_findings` rows MUST go through the helpers
// here so scoring, dashboard badges, agent statistics, and the exporter can
// never drift apart again.

export type FindingSourceClass = "engine" | "agent" | "analyzer" | "projection" | "other";

export const PROJECTION_LIKE = "projection:%";

export type FindingStatus = "candidate" | "verified" | "disputed" | "suppressed" | "promoted";

export const FINDING_STATUSES: readonly FindingStatus[] = [
  "candidate",
  "verified",
  "disputed",
  "suppressed",
  "promoted",
] as const;

export type SelectableFinding = {
  source_module?: string | null;
  severity?: string | null;
  finding_status?: string | null;
  supporting_engines?: string[] | null;
  metadata?: Record<string, unknown> | null;
  /** Hallucination/citation verifier result. A row explicitly marked
   * no_citation/unverified has been quarantined and is not eligible for an
   * authoritative report surface. Undefined preserves pre-verifier behavior
   * while the pipeline is still running. */
  verification_status?: string | null;
};

export function classifyFindingSource(f: SelectableFinding): FindingSourceClass {
  const sm = String(f.source_module ?? "");
  if (sm.startsWith("engine:")) return "engine";
  if (sm.startsWith("agent:")) return "agent";
  if (sm.startsWith("analyzer:")) return "analyzer";
  if (sm.startsWith("projection:")) return "projection";
  return "other";
}

export function isProvisionalFinding(f: SelectableFinding): boolean {
  return (f.metadata as Record<string, unknown> | undefined)?.provisional === true;
}

/**
 * True for finalized, non-provisional pipeline output that may appear as an
 * authoritative finding. A completed hallucination/citation pass can mark a
 * row `no_citation` or `unverified`; those rows remain in the database/audit
 * appendix but must not re-enter the dashboard, PDF key-findings body, or
 * ordinary case UI through getCase() after the report explicitly quarantined
 * them.
 */
export function isCanonicalFinding(f: SelectableFinding): boolean {
  const cls = classifyFindingSource(f);
  const verification = String(f.verification_status ?? "").toLowerCase();
  const quarantined = verification === "no_citation" || verification === "unverified";
  return (cls === "engine" || cls === "agent") && !isProvisionalFinding(f) && !quarantined;
}

export type SelectFindingsOptions = {
  include?: ReadonlyArray<FindingSourceClass>;
  includeProvisional?: boolean;
  statuses?: ReadonlyArray<FindingStatus>;
  severities?: ReadonlyArray<string>;
  /** Include rows explicitly quarantined by citation verification. Defaults
   * false for the canonical report/UI selection. */
  includeQuarantined?: boolean;
};

const DEFAULT_INCLUDE: ReadonlyArray<FindingSourceClass> = ["engine", "agent"];

export function selectFindings<T extends SelectableFinding>(
  findings: ReadonlyArray<T>,
  opts: SelectFindingsOptions = {},
): T[] {
  const include = new Set(opts.include ?? DEFAULT_INCLUDE);
  const statuses = opts.statuses ? new Set<string>(opts.statuses) : null;
  const severities = opts.severities ? new Set<string>(opts.severities) : null;

  return (findings ?? []).filter((f) => {
    if (!include.has(classifyFindingSource(f))) return false;
    if (!opts.includeProvisional && isProvisionalFinding(f)) return false;
    if (!opts.includeQuarantined) {
      const verification = String(f.verification_status ?? "").toLowerCase();
      if (verification === "no_citation" || verification === "unverified") return false;
    }
    if (statuses && !statuses.has(String(f.finding_status ?? "candidate"))) return false;
    if (severities && !severities.has(String(f.severity ?? ""))) return false;
    return true;
  });
}

export type FindingMetrics = {
  total: number;
  canonical: number;
  provisional: number;
  highPriority: number;
  bySource: Record<FindingSourceClass, number>;
  bySeverity: Record<string, number>;
  byStatus: Record<FindingStatus, number>;
};

function emptyStatusTally(): Record<FindingStatus, number> {
  return { candidate: 0, verified: 0, disputed: 0, suppressed: 0, promoted: 0 };
}

export function getFindingMetrics(findings: ReadonlyArray<SelectableFinding>): FindingMetrics {
  const bySource: Record<FindingSourceClass, number> = {
    engine: 0,
    agent: 0,
    analyzer: 0,
    projection: 0,
    other: 0,
  };
  const bySeverity: Record<string, number> = {};
  const byStatus = emptyStatusTally();

  let canonical = 0;
  let provisional = 0;
  let highPriority = 0;

  for (const f of findings ?? []) {
    const cls = classifyFindingSource(f);
    bySource[cls] += 1;

    const sev = String(f.severity ?? "unknown");
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;

    const st = String(f.finding_status ?? "candidate");
    if ((FINDING_STATUSES as readonly string[]).includes(st)) {
      byStatus[st as FindingStatus] += 1;
    }

    if (isProvisionalFinding(f)) provisional += 1;
    if (isCanonicalFinding(f)) {
      canonical += 1;
      if (sev === "critical" || sev === "high") highPriority += 1;
    }
  }

  return {
    total: (findings ?? []).length,
    canonical,
    provisional,
    highPriority,
    bySource,
    bySeverity,
    byStatus,
  };
}

export type FindingConsensus = {
  agreementCount: number;
  engines: string[];
  label: (lang: "es" | "en") => string;
};

export function getFindingConsensus(f: SelectableFinding): FindingConsensus {
  const raw = Array.isArray(f.supporting_engines) ? f.supporting_engines : [];
  const engines = Array.from(new Set(raw.map((e) => String(e).trim()).filter(Boolean))).sort();
  const agreementCount = engines.length;
  return {
    agreementCount,
    engines,
    label: (lang) =>
      lang === "en"
        ? `identified by ${agreementCount} pipeline stages`
        : `identificado por ${agreementCount} etapas del pipeline`,
  };
}
