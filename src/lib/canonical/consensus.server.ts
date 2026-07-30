// Consensus & promotion — Phase 3 of the Intelligence Aggregation Refactor.
//
// A finding that three independent engines reached is worth more than one a
// single analyzer emitted. Before Phase 3 the platform had no notion of
// agreement at all: every row entered the report with the same weight, and
// `finding_status` was written but never earned.
//
// This module is the ONLY place that decides agreement and status.
//
// How agreement is computed
//   1. Every canonical Finding contributes its own producing module
//      (`source_module`) plus any `supporting_engines[]` recorded by the
//      projection layer.
//   2. Findings are clustered by (category, normalized title). Clustering is
//      token-based Jaccard, the same similarity dedupe already uses, so
//      "Cadena de custodia rota" and "Cadena de custodia rota en el embalaje"
//      count as one claim reached twice.
//   3. `agreement` = number of DISTINCT engines behind the cluster.
//      A mirrored `projection:*` row never counts as an extra voice on its
//      own — it carries the engine that produced the specialized row, so a
//      witness finding and its projection are one engine, not two.
//
// How status is earned
//   promoted  — agreement >= 2 AND at least one fully grounded citation
//   verified  — agreement 1 with a fully grounded citation
//   disputed  — the cluster carries directly conflicting severities
//                (critical/high vs low/info) from different engines
//   candidate — everything else (the default; never a downgrade of a status
//                already earned in the DB)
//
// PURE except for `persistFindingStatuses`, which writes the earned status
// back to `case_findings` so the dashboard and the next run can see it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CaseAnalysis, Citation, Finding } from "./case-analysis";

type Db = SupabaseClient<Database>;

export type ConsensusStatus = "promoted" | "verified" | "disputed" | "candidate";

const CLUSTER_THRESHOLD = 0.7;
const STOP = new Set(["los", "las", "del", "que", "por", "con", "para", "una", "the", "and", "for"]);

function tokens(s: string): Set<string> {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function fullyGrounded(c: Citation | undefined | null): boolean {
  if (!c) return false;
  return !!(c.documentId && c.page != null && (c.quote?.trim()?.length ?? 0) > 0);
}

/**
 * Every distinct engine voice behind a single finding row.
 * `projection:<table>` rows are provenance, not an independent opinion: the
 * engine that wrote the specialized row is already in `supporting_engines`.
 */
export function enginesOf(f: Finding): string[] {
  const out = new Set<string>();
  for (const e of f.supporting_engines ?? []) {
    const v = String(e ?? "").trim();
    if (v) out.add(v);
  }
  const sm = String(f.source_module ?? "").trim();
  if (sm && !sm.startsWith("projection:")) out.add(sm);
  return [...out];
}

function severityBand(f: Finding): "high" | "low" | "mid" {
  if (f.severity === "critical" || f.severity === "high") return "high";
  if (f.severity === "low" || f.severity === "info") return "low";
  return "mid";
}

type Cluster = {
  members: Finding[];
  tokens: Set<string>;
  category: string;
};

function clusterFindings(findings: Finding[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const f of findings) {
    const cat = String(f.category ?? "").toLowerCase();
    const tks = tokens(`${f.title} ${f.description ?? ""}`.slice(0, 400));
    const hit = clusters.find((c) => c.category === cat && jaccard(c.tokens, tks) >= CLUSTER_THRESHOLD);
    if (hit) {
      hit.members.push(f);
      for (const t of tks) hit.tokens.add(t);
    } else {
      clusters.push({ members: [f], tokens: new Set(tks), category: cat });
    }
  }
  return clusters;
}

export type ConsensusSummary = {
  clusters: number;
  promoted: number;
  verified: number;
  disputed: number;
  candidate: number;
  maxAgreement: number;
};

/**
 * Annotate every Finding with `agreement` and an earned `finding_status`.
 * Mutates in place (freeze-compliant: no section added, removed, reordered).
 */
export function applyConsensus(analysis: CaseAnalysis): ConsensusSummary {
  const summary: ConsensusSummary = {
    clusters: 0,
    promoted: 0,
    verified: 0,
    disputed: 0,
    candidate: 0,
    maxAgreement: 0,
  };
  if (!Array.isArray(analysis.Findings)) return summary;

  const clusters = clusterFindings(analysis.Findings as Finding[]);
  summary.clusters = clusters.length;

  for (const cluster of clusters) {
    const engines = new Set<string>();
    for (const m of cluster.members) for (const e of enginesOf(m)) engines.add(e);
    const agreement = engines.size;
    const grounded = cluster.members.some((m) => (m.citations ?? []).some(fullyGrounded));
    const bands = new Set(cluster.members.map(severityBand));
    const conflicting = engines.size > 1 && bands.has("high") && bands.has("low");

    let status: ConsensusStatus;
    if (conflicting) status = "disputed";
    else if (agreement >= 2 && grounded) status = "promoted";
    else if (agreement >= 1 && grounded) status = "verified";
    else status = "candidate";

    summary[status] += cluster.members.length;
    summary.maxAgreement = Math.max(summary.maxAgreement, agreement);

    for (const m of cluster.members) {
      m.agreement = agreement;
      m.supporting_engines = [...engines];
      // Never downgrade a suppressed/quarantined row into a promotion.
      m.finding_status = m.suppressed || m.quarantined ? "candidate" : status;
    }
  }
  return summary;
}

/**
 * Write earned statuses back to `case_findings`. Grouped into one update per
 * distinct status (max 4 round trips), never per finding. Non-fatal: a
 * failure here must not fail report generation.
 */
export async function persistFindingStatuses(
  db: Db,
  caseId: string,
  analysis: CaseAnalysis,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const byStatus = new Map<string, string[]>();
    for (const f of (analysis.Findings ?? []) as Finding[]) {
      const status = f.finding_status;
      const id = String(f.id ?? "");
      if (!status || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      const list = byStatus.get(status) ?? [];
      list.push(id);
      byStatus.set(status, list);
    }
    let updated = 0;
    for (const [status, ids] of byStatus) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any)
        .from("case_findings")
        .update({ finding_status: status })
        .eq("case_id", caseId)
        .in("id", ids);
      if (error) throw new Error(error.message);
      updated += ids.length;
    }
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, updated: 0, error: (e as Error)?.message ?? String(e) };
  }
}
