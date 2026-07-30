// Unified findings selector — Phase 1 of the Intelligence Aggregation
// Refactor.
//
// PURE MODULE. No I/O, no Supabase, no AI. Every surface that counts,
// filters, or classifies `case_findings` rows MUST go through the helpers
// here so scoring, dashboard badges, agent statistics, and the exporter can
// never drift apart again.
//
// Phase 1 contract: NO BEHAVIOR CHANGE. Each helper reproduces exactly the
// rule that already lived at its call sites:
//   - classifyFindingSource() is the `engine:` / `agent:` / `analyzer:`
//     prefix rule from scoring-selection.ts, verbatim.
//   - selectFindings() is that same canonical filter, expressed once.
//   - getFindingMetrics() is the severity/status tally the dashboard and
//     agent statistics each computed inline.
//   - getFindingConsensus() reads the new `supporting_engines[]` column
//     added by the aggregation migration; it is additive and returns a
//     zero-agreement result for rows that predate it.
//
// `source_module` semantics stay frozen: 17 confirmed consumers depend on
// the prefix strings, so nothing here rewrites or reinterprets them.

// Phase 2 adds one class: `projection:*` rows are mirrored copies of
// specialized-table output (evidence classifications, witness credibility).
// They are provenance rows, NOT new analysis — they are excluded from every
// pre-existing surface by default so Phase 2 cannot move a single badge.
export type FindingSourceClass = "engine" | "agent" | "analyzer" | "projection" | "other";

export type FindingStatus = "candidate" | "verified" | "disputed" | "suppressed" | "promoted";

export const FINDING_STATUSES: readonly FindingStatus[] = [
  "candidate",
  "verified",
  "disputed",
  "suppressed",
  "promoted",
] as const;

/** Minimal row shape every helper here accepts. Deliberately structural so
 *  Supabase rows, engine output, and test fixtures all satisfy it. */
export type SelectableFinding = {
  source_module?: string | null;
  severity?: string | null;
  finding_status?: string | null;
  supporting_engines?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * The `engine:` / `agent:` / `analyzer:` classification. This is the single
 * definition — `scoring-selection.ts` delegates to it rather than repeating
 * the prefix test.
 */
export function classifyFindingSource(f: SelectableFinding): FindingSourceClass {
  const sm = String(f.source_module ?? "");
  if (sm.startsWith("engine:")) return "engine";
  if (sm.startsWith("agent:")) return "agent";
  if (sm.startsWith("analyzer:")) return "analyzer";
  return "other";
}

/** Provisional findings never enter scoring or the report. */
export function isProvisionalFinding(f: SelectableFinding): boolean {
  return (f.metadata as Record<string, unknown> | undefined)?.provisional === true;
}

/**
 * True for a finding that is finalized, non-provisional pipeline output —
 * i.e. eligible for scoring, the scorecard, and the report body.
 *
 * Identical to the rule in getCanonicalScoringFindings(): `engine:*` AND
 * `agent:*` count; `analyzer:*` (raw, pre-dedupe) never does.
 */
export function isCanonicalFinding(f: SelectableFinding): boolean {
  const cls = classifyFindingSource(f);
  return (cls === "engine" || cls === "agent") && !isProvisionalFinding(f);
}

export type SelectFindingsOptions = {
  /** Which source classes to keep. Defaults to the canonical set. */
  include?: ReadonlyArray<FindingSourceClass>;
  /** Keep provisional rows. Defaults to false. */
  includeProvisional?: boolean;
  /** Restrict to these `finding_status` values. Defaults to no restriction. */
  statuses?: ReadonlyArray<FindingStatus>;
  /** Restrict to these severities. Defaults to no restriction. */
  severities?: ReadonlyArray<string>;
};

const DEFAULT_INCLUDE: ReadonlyArray<FindingSourceClass> = ["engine", "agent"];

/**
 * Unified selector. With no options this is exactly the canonical
 * scoring/report set — no behavior change from the pre-Phase-1 filters.
 */
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
    if (statuses && !statuses.has(String(f.finding_status ?? "candidate"))) return false;
    if (severities && !severities.has(String(f.severity ?? ""))) return false;
    return true;
  });
}

export type FindingMetrics = {
  /** Every row handed in, no filtering. */
  total: number;
  /** Rows passing the canonical (engine|agent, non-provisional) filter. */
  canonical: number;
  /** Rows excluded as provisional or analyzer-only. */
  provisional: number;
  /** critical + high, over the canonical set. */
  highPriority: number;
  bySource: Record<FindingSourceClass, number>;
  bySeverity: Record<string, number>;
  byStatus: Record<FindingStatus, number>;
};

function emptyStatusTally(): Record<FindingStatus, number> {
  return { candidate: 0, verified: 0, disputed: 0, suppressed: 0, promoted: 0 };
}

/**
 * One tally used by every badge, counter, and statistics surface.
 * `highPriority` reproduces the dashboard's existing critical|high rule.
 */
export function getFindingMetrics(findings: ReadonlyArray<SelectableFinding>): FindingMetrics {
  const bySource: Record<FindingSourceClass, number> = { engine: 0, agent: 0, analyzer: 0, other: 0 };
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
  /** Distinct pipeline stages that produced this finding. */
  agreementCount: number;
  engines: string[];
  /**
   * Display-safe wording. Never "independently verified" — these are stages
   * of one pipeline, not independent corroboration.
   */
  label: (lang: "es" | "en") => string;
};

/**
 * Reads `supporting_engines[]` (added by the aggregation migration).
 * Additive: rows written before the migration report zero agreement and the
 * caller renders nothing, exactly as today.
 */
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
