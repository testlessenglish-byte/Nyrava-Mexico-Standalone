// Addendum §24 (Delta Intelligence) + §26 (score movement) — per-finding
// granularity on top of the EXISTING report_versions snapshot system
// (report-version.server.ts) and the existing finalizeReportChangeLog
// quantitative diff (cases.functions.ts). Neither of those is replaced or
// modified in its core behavior — this module only adds a finer-grained
// layer underneath them: which INDIVIDUAL findings are new, strengthened,
// weakened, or resolved between two report versions, keyed on the
// canonical_finding_id already produced by canonical-id.ts.
//
// No AI calls anywhere in this file — pure DB reads/writes and
// deterministic comparison.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

type SnapshotRow = {
  finding_id: string;
  canonical_finding_id: string | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  content_hash: string;
};

async function contentHash(
  title: string,
  description: string,
  severity: string,
  confidence: number,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${title}\u0000${description}\u0000${severity}\u0000${confidence.toFixed(3)}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Call once per report version, right before or after
 * finalizeReportChangeLog runs its existing quantitative diff — order
 * doesn't matter, they're independent. Writes the current findings into
 * finding_version_snapshots so the NEXT regeneration has something to
 * diff against. Best-effort: never throws into the caller. */
export async function snapshotFindingVersions(
  db: Db,
  args: { caseId: string; reportVersion: number },
): Promise<{ ok: boolean; count: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: findings } = await (db as any)
      .from("case_findings")
      .select("id,canonical_finding_id,category,severity,confidence,title,description")
      .eq("case_id", args.caseId)
      .not("source_module", "like", "projection:%");
    const rows = (findings ?? []) as Array<{
      id: string;
      canonical_finding_id: string | null;
      category: string;
      severity: string;
      confidence: number;
      title: string;
      description: string;
    }>;
    if (rows.length === 0) return { ok: true, count: 0 };

    const payload = await Promise.all(
      rows.map(async (f) => ({
        case_id: args.caseId,
        report_version: args.reportVersion,
        finding_id: f.id,
        canonical_finding_id: f.canonical_finding_id,
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        title: f.title.slice(0, 500),
        content_hash: await contentHash(f.title, f.description, f.severity, f.confidence),
      })),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("finding_version_snapshots").insert(payload);
    if (error) return { ok: false, count: 0 };
    return { ok: true, count: payload.length };
  } catch {
    return { ok: false, count: 0 };
  }
}

export type FindingDelta = {
  finding_id: string;
  canonical_finding_id: string | null;
  title: string;
  category: string;
  severity: string;
  classification: "new" | "strengthened" | "weakened" | "resolved";
  confidence_prev: number | null;
  confidence_now: number | null;
};

export type FindingDeltaSummary = {
  previous_version: number | null;
  current_version: number;
  new: FindingDelta[];
  strengthened: FindingDelta[];
  weakened: FindingDelta[];
  resolved: FindingDelta[];
};

/** Classifies every current finding against the most recent PRIOR snapshot
 * (the one taken before `currentVersion`), matched by canonical_finding_id
 * where available (falls back to a content-hash match for findings that
 * predate canonical IDs being populated). Call after
 * snapshotFindingVersions has written the current version's rows. Returns
 * an empty summary (not an error) when there's no prior version to compare
 * against — e.g. the very first report for a case. */
export async function classifyFindingDeltas(
  db: Db,
  args: { caseId: string; currentVersion: number },
): Promise<FindingDeltaSummary> {
  const empty: FindingDeltaSummary = {
    previous_version: null,
    current_version: args.currentVersion,
    new: [],
    strengthened: [],
    weakened: [],
    resolved: [],
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: versionRows } = await (db as any)
      .from("finding_version_snapshots")
      .select("report_version")
      .eq("case_id", args.caseId)
      .lt("report_version", args.currentVersion)
      .order("report_version", { ascending: false })
      .limit(1);
    const previousVersion =
      (versionRows?.[0] as { report_version: number } | undefined)?.report_version ?? null;
    if (previousVersion == null) return empty;

    const [prevRes, curRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .from("finding_version_snapshots")
        .select("finding_id,canonical_finding_id,category,severity,confidence,title,content_hash")
        .eq("case_id", args.caseId)
        .eq("report_version", previousVersion),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .from("finding_version_snapshots")
        .select("finding_id,canonical_finding_id,category,severity,confidence,title,content_hash")
        .eq("case_id", args.caseId)
        .eq("report_version", args.currentVersion),
    ]);
    const prev = (prevRes.data ?? []) as SnapshotRow[];
    const cur = (curRes.data ?? []) as SnapshotRow[];

    const keyOf = (r: SnapshotRow) => r.canonical_finding_id ?? `hash:${r.content_hash}`;
    const prevByKey = new Map(prev.map((r) => [keyOf(r), r]));
    const curByKey = new Map(cur.map((r) => [keyOf(r), r]));

    const result: FindingDeltaSummary = { ...empty, previous_version: previousVersion };

    for (const [key, c] of curByKey) {
      const p = prevByKey.get(key);
      const base: Omit<FindingDelta, "classification"> = {
        finding_id: c.finding_id,
        canonical_finding_id: c.canonical_finding_id,
        title: c.title,
        category: c.category,
        severity: c.severity,
        confidence_prev: p?.confidence ?? null,
        confidence_now: c.confidence,
      };
      if (!p) {
        result.new.push({ ...base, classification: "new" });
      } else if (c.content_hash === p.content_hash) {
        continue; // unchanged — nothing to explain, omitted from every list
      } else if (c.confidence >= p.confidence) {
        result.strengthened.push({ ...base, classification: "strengthened" });
      } else {
        result.weakened.push({ ...base, classification: "weakened" });
      }
    }
    for (const [key, p] of prevByKey) {
      if (!curByKey.has(key)) {
        result.resolved.push({
          finding_id: p.finding_id,
          canonical_finding_id: p.canonical_finding_id,
          title: p.title,
          category: p.category,
          severity: p.severity,
          confidence_prev: p.confidence,
          confidence_now: null,
          classification: "resolved",
        });
      }
    }
    return result;
  } catch {
    return empty;
  }
}
