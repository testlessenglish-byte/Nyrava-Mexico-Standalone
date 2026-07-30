// Immutable report version snapshots.
// Every analysis (initial run or Add-Evidence regeneration) writes one row to
// public.report_versions with deterministic metadata + a content hash that lets
// us prove no version was silently overwritten.
//
// The report_versions table has REVOKE UPDATE, DELETE from authenticated, so
// this helper is the only write path and snapshots are immutable from app code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeReport } from "./report-normalize";

type Db = SupabaseClient<Database>;


/** Stable SHA-256 over a JSON-canonicalized projection of the report. */
export async function computeReportHash(report: Record<string, unknown>): Promise<string> {
  // Strip volatile fields (timestamps, ids) so the same content yields the same
  // hash across runs. Include the substantive report payload only.
  const projection = {
    case_strength_score: report.case_strength_score ?? null,
    risk_score: report.risk_score ?? null,
    citations: report.citations ?? null,
    evidence_index: report.evidence_index ?? null,
    contradictions_struct: report.contradictions_struct ?? null,
    missing_evidence_struct: report.missing_evidence_struct ?? null,
    constitutional_issues_struct: report.constitutional_issues_struct ?? null,
    motion_opportunities: report.motion_opportunities ?? null,
    cross_examination: report.cross_examination ?? null,
    strategy_recommendations: report.strategy_recommendations ?? null,
    next_actions: report.next_actions ?? null,
    full_report: report.full_report ?? null,
    version: report.version ?? null,
    scores_suppressed: report.scores_suppressed ?? null,
    motions_suppressed: report.motions_suppressed ?? null,
    // Phase 4: bind the hash to the canonical version the content came from,
    // so an identical-looking report built from a different canonical
    // analysis cannot collide with an earlier snapshot's hash.
    canonical_version: report.canonical_version ?? null,
  };
  const json = canonicalStringify(projection);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalStringify((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

export type SnapshotMetadata = {
  documentCount: number;
  findingsCount: number;
  contradictionCount: number;
  ess: number | null;
  score: number | null;
  triggeringUploadId?: string | null;
};

/** Insert an immutable snapshot row. Never throws into the caller — best-effort. */
export async function snapshotReportVersion(
  db: Db,
  args: {
    caseId: string;
    userId: string;
    version: number;
    /** `canonical_analysis.version` this report was rendered from, if any. */
    canonicalVersion?: number | null;
    report: Record<string, unknown>;
    changeLog?: Record<string, unknown> | null;
    meta: SnapshotMetadata;
  },
): Promise<{ ok: true; report_hash: string } | { ok: false; error: string }> {
  try {
    // Normalize before hashing + persisting: strip empty sections, dedupe
    // blank/duplicate items and repeated prose lines. Presentation-only —
    // never invents or promotes evidence.
    const normalized = normalizeReport(args.report);
    const report_hash = await computeReportHash(normalized);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("report_versions").insert({
      case_id: args.caseId,
      user_id: args.userId,
      version: args.version,
      canonical_version: args.canonicalVersion ?? (normalized.canonical_version as number | null) ?? null,
      snapshot: normalized,
      change_log: args.changeLog ?? null,
      triggering_upload_id: args.meta.triggeringUploadId ?? null,
      document_count: args.meta.documentCount,
      findings_count: args.meta.findingsCount,
      contradiction_count: args.meta.contradictionCount,
      ess: args.meta.ess,
      score: args.meta.score,
      report_hash,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, report_hash };

  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
