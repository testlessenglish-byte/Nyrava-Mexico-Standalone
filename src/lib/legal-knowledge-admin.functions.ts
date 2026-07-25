// Admin stats for the NLKN "Legal Knowledge" dashboard — connector status,
// ingestion history, entity counts, verification breakdown. Read-only.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NlknConnectorStatus = {
  code: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
};

export type NlknIngestRun = {
  connectorCode: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  documentsFetched: number;
  documentsStored: number;
};

export type NlknStats = {
  connectors: NlknConnectorStatus[];
  recentRuns: NlknIngestRun[];
  counts: {
    authorities: number;
    articles: number;
    precedents: number;
    jurisprudencia: number;
    theses: number;
    regulations: number;
  };
  verification: {
    verified: number;
    pending: number;
    deprecated: number;
    superseded: number;
    failed_verification: number;
  };
  failedJobsLast7Days: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("is_admin_tier", { _user_id: ctx.userId });
  if (error || !isAdmin) throw new Error("Forbidden — admin required.");
}

export const getNlknStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NlknStats> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const [connectorsRes, runsRes, authRes, artRes, precRes, jurisRes, thesesRes, regRes] = await Promise.all([
      db.from("legal_source_connectors").select("code,name,status,last_sync_at").order("code"),
      db.from("legal_ingest_runs").select("connector_code,started_at,ended_at,status,documents_fetched,documents_stored").order("started_at", { ascending: false }).limit(20),
      db.from("legal_authorities").select("verification_status"),
      db.from("legal_articles").select("id", { count: "exact", head: true }),
      db.from("legal_precedents").select("id", { count: "exact", head: true }),
      db.from("legal_jurisprudencia").select("id", { count: "exact", head: true }),
      db.from("legal_theses").select("id", { count: "exact", head: true }),
      db.from("legal_regulations").select("id", { count: "exact", head: true }),
    ]);

    const verification = { verified: 0, pending: 0, deprecated: 0, superseded: 0, failed_verification: 0 };
    for (const row of authRes.data ?? []) {
      const s = (row as { verification_status?: string }).verification_status;
      if (s && s in verification) verification[s as keyof typeof verification] += 1;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const failedJobsLast7Days = (runsRes.data ?? []).filter(
      (r) => r.status === "failed" && r.started_at >= sevenDaysAgo,
    ).length;

    return {
      connectors: (connectorsRes.data ?? []).map((c) => ({
        code: c.code, name: c.name, status: c.status, lastSyncAt: c.last_sync_at,
      })),
      recentRuns: (runsRes.data ?? []).map((r) => ({
        connectorCode: r.connector_code, startedAt: r.started_at, endedAt: r.ended_at,
        status: r.status, documentsFetched: r.documents_fetched, documentsStored: r.documents_stored,
      })),
      counts: {
        authorities: (authRes.data ?? []).length,
        articles: artRes.count ?? 0,
        precedents: precRes.count ?? 0,
        jurisprudencia: jurisRes.count ?? 0,
        theses: thesesRes.count ?? 0,
        regulations: regRes.count ?? 0,
      },
      verification,
      failedJobsLast7Days,
    };
  });
