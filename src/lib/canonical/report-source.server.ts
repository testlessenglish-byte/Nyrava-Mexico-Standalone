// Phase 4 — the report stage reads the persisted canonical analysis.
//
// Until Phase 4 the report stage gathered findings straight out of the raw
// engine tables and re-derived ordering locally, so the report could disagree
// with `canonical_analysis` (the gate's output) about which findings matter
// and in what order. Phase 4 makes `canonical_analysis.analysis_payload` the
// source of truth for the report's finding selection and order, and records
// WHICH canonical version the report was built from.
//
// Rollout follows the existing env-var pattern (see `PIPELINE_MAX_CONCURRENT`
// in `pipeline-lease.server.ts`): `CANONICAL_REPORT_ENABLED`, default OFF.
// With the flag off, nothing in this module changes report content.
//
// The raw-table fallback is TEMPORARY migration support, not a second
// permanent reporting path. Every fallback writes a `pipeline_trace` row
// (`phase: "report"`, `step: "canonical_fallback"`) with the case id and the
// reason, so the follow-up that deletes the fallback is gated on that query
// returning zero rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CaseAnalysis, Finding as CanonicalFinding } from "./case-analysis";

type Db = SupabaseClient<Database>;

export type CanonicalFallbackReason =
  | "flag_disabled"
  | "no_canonical_row"
  | "canonical_not_completed"
  | "empty_payload"
  | "no_overlap_with_raw_findings"
  | "read_error";

export type CanonicalReportSource = {
  /** `canonical_analysis.version` the report is being rendered from. */
  version: number;
  /** Canonical finding ids, already ranked by the gate. */
  orderedIds: string[];
  payload: CaseAnalysis;
};

/**
 * Flag check. Default OFF — Phase 4 only takes effect when the environment
 * explicitly opts in. Read at call time (env is injected per request).
 */
export function isCanonicalReportEnabled(): boolean {
  return String(process.env.CANONICAL_REPORT_ENABLED ?? "").toLowerCase() === "true";
}

/** Record a fallback to the raw-table path. Never throws. */
export async function traceCanonicalFallback(
  db: Db,
  caseId: string,
  reason: CanonicalFallbackReason,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("pipeline_trace").insert({
      case_id: caseId,
      phase: "report",
      step: "canonical_fallback",
      status: "warn",
      detail: { reason, ...detail },
    });
  } catch {
    // Instrumentation must never break report generation.
  }
}

/**
 * Read the persisted canonical analysis for the report stage.
 * Returns `null` (and traces the reason) whenever the report must fall back
 * to the raw-table gather.
 */
export async function loadCanonicalReportSource(
  db: Db,
  caseId: string,
): Promise<CanonicalReportSource | null> {
  if (!isCanonicalReportEnabled()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from("canonical_analysis")
      .select("version,status,analysis_payload")
      .eq("case_id", caseId)
      .maybeSingle();
    if (error) {
      await traceCanonicalFallback(db, caseId, "read_error", { message: error.message });
      return null;
    }
    if (!data) {
      await traceCanonicalFallback(db, caseId, "no_canonical_row");
      return null;
    }
    const status = String((data as { status?: string }).status ?? "");
    if (status !== "completed" && status !== "validated") {
      await traceCanonicalFallback(db, caseId, "canonical_not_completed", { status });
      return null;
    }
    const payload = (data as { analysis_payload?: unknown }).analysis_payload as CaseAnalysis | null;
    const findings = Array.isArray(payload?.Findings) ? (payload!.Findings as CanonicalFinding[]) : [];
    if (!payload || findings.length === 0) {
      await traceCanonicalFallback(db, caseId, "empty_payload");
      return null;
    }
    // Capture version WITH the payload in the same read, so a concurrent
    // rerun bumping the version cannot make the recorded integer disagree
    // with the content actually rendered.
    const version = Number((data as { version?: number }).version ?? 1) || 1;
    return {
      version,
      orderedIds: findings.map((f) => String(f.id ?? "")).filter(Boolean),
      payload,
    };
  } catch (e) {
    await traceCanonicalFallback(db, caseId, "read_error", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Apply the canonical selection + order to the raw `case_findings` rows the
 * report stage already loaded.
 *
 * Deliberately a REORDER/FILTER, not a reshape: the report renderer consumes
 * `case_findings` row shape everywhere, and canonical Findings carry those
 * same row ids. This keeps the gate as the single authority on which findings
 * are reported and in what order, without a parallel rendering data model.
 *
 * Returns `null` when the canonical ids do not overlap the persisted rows
 * (stale canonical row after a reset) — the caller falls back and traces.
 */
export function applyCanonicalOrder<T extends { id?: string | null }>(
  rows: T[],
  orderedIds: string[],
): T[] | null {
  const byId = new Map<string, T>();
  for (const r of rows) {
    const id = String(r?.id ?? "");
    if (id) byId.set(id, r);
  }
  const out: T[] = [];
  for (const id of orderedIds) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
  }
  if (out.length === 0) return null;
  return out;
}

/** Current canonical version for a case, or null. Used for staleness notices. */
export async function getCurrentCanonicalVersion(db: Db, caseId: string): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any)
      .from("canonical_analysis")
      .select("version")
      .eq("case_id", caseId)
      .maybeSingle();
    const v = Number((data as { version?: number } | null)?.version ?? NaN);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Header notice shown when a displayed report was built from an older
 * canonical version than the one now stored. The report is NEVER silently
 * re-rendered — regeneration stays an explicit attorney action.
 */
export function canonicalStalenessNotice(
  reportVersion: number | null | undefined,
  currentVersion: number | null | undefined,
  lang: "es" | "en" = "es",
): string | null {
  const r = Number(reportVersion);
  const c = Number(currentVersion);
  if (!Number.isFinite(r) || !Number.isFinite(c) || c <= r) return null;
  return lang === "en"
    ? `Generated from canonical version ${r}; a more recent analysis exists (version ${c}).`
    : `Generado a partir de la versión canónica ${r}; existe un análisis más reciente (versión ${c}).`;
}
