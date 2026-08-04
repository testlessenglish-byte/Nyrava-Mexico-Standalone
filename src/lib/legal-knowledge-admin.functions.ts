// Admin stats for the NLKN "Legal Knowledge" dashboard — connector status,
// ingestion history, entity counts, verification breakdown. Read-only.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NlknConnectorStatus = {
  code: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
  /** Outcome of the most recent ingestion run for this connector. */
  lastRunStatus: string | null;
  lastRunStored: number | null;
  /** Last time this connector actually stored at least one document. */
  lastProductiveAt: string | null;
  /** "ok" | "stale" | "failing" | "never_run" — drives the dashboard badge. */
  health: "ok" | "stale" | "failing" | "never_run";
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
  /** Human-readable description of the automatic daily schedule. */
  schedule: { enabled: boolean; description: string };
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
      db.from("legal_ingest_runs").select("connector_code,started_at,ended_at,status,documents_fetched,documents_stored").order("started_at", { ascending: false }).limit(300),
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

    const allRuns = (runsRes.data ?? []) as {
      connector_code: string; started_at: string; ended_at: string | null; status: string;
      documents_fetched: number; documents_stored: number;
    }[];

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const failedJobsLast7Days = allRuns.filter(
      (r) => r.status === "failed" && r.started_at >= sevenDaysAgo,
    ).length;

    return {
      connectors: (connectorsRes.data ?? []).map((c) => {
        const runs = allRuns.filter((r) => r.connector_code === c.code);
        const last = runs[0] ?? null;
        const productive = runs.find((r) => (r.documents_stored ?? 0) > 0) ?? null;
        const staleCutoff = Date.now() - 48 * 60 * 60 * 1000;
        let health: NlknConnectorStatus["health"] = "ok";
        if (!last) health = "never_run";
        else if (last.status === "failed") health = "failing";
        else if (!productive || new Date(productive.started_at).getTime() < staleCutoff) health = "stale";
        return {
          code: c.code, name: c.name, status: c.status, lastSyncAt: c.last_sync_at,
          lastRunStatus: last?.status ?? null,
          lastRunStored: last?.documents_stored ?? null,
          lastProductiveAt: productive?.started_at ?? null,
          health,
        };
      }),
      recentRuns: allRuns.slice(0, 20).map((r) => ({
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
      schedule: {
        enabled: true,
        description: "Sincronización automática diaria · 05:00 (CDMX) / 11:00 UTC",
      },
    };
  });

export type PendingAuthority = {
  id: string;
  kind: string;
  jurisdiction: string | null;
  title: string;
  shortTitle: string | null;
  issuer: string | null;
  citation: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  /** First 1200 chars only — the review UI links to sourceUrl for the full text. */
  bodyPreview: string;
  createdAt: string;
};

/**
 * FIX (2026-08-04): case-law grounding (case-law.server.ts) now refuses to
 * cite anything that isn't verification_status='verified', but nothing in
 * the codebase ever set that status — the column's own migration comment
 * promised a review workflow ("see legal-authority-verify.server.ts") that
 * was never built. Confirmed live: 1000/1000 legal_authorities rows sat at
 * the column's DEFAULT 'pending' forever. This is the missing read side —
 * paired with markAuthorityVerified below for the write side. Legal
 * citations get a human review gate, not an automated rubber stamp: only
 * jurisprudencia/court_decision rows are listed here, since those are the
 * only kinds case-law.server.ts actually cites.
 */
export const listPendingAuthorities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d ?? {}) as { limit?: number; offset?: number };
    return { limit: Math.min(Math.max(o.limit ?? 25, 1), 100), offset: Math.max(o.offset ?? 0, 0) };
  })
  .handler(async ({ data, context }): Promise<{ rows: PendingAuthority[]; total: number }> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const { data: rows, count, error } = await db
      .from("legal_authorities")
      .select("id,kind,jurisdiction,title,short_title,issuer,citation,published_at,source_url,body,created_at", {
        count: "exact",
      })
      .eq("verification_status", "pending")
      .in("kind", ["jurisprudencia", "court_decision"])
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);

    type PendingAuthorityRow = {
      id: string;
      kind: string;
      jurisdiction: string | null;
      title: string;
      short_title: string | null;
      issuer: string | null;
      citation: string | null;
      published_at: string | null;
      source_url: string | null;
      body: string | null;
      created_at: string;
    };
    return {
      total: count ?? 0,
      rows: ((rows ?? []) as PendingAuthorityRow[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        jurisdiction: r.jurisdiction,
        title: r.title,
        shortTitle: r.short_title,
        issuer: r.issuer,
        citation: r.citation,
        publishedAt: r.published_at,
        sourceUrl: r.source_url,
        bodyPreview: String(r.body ?? "").slice(0, 1200),
        createdAt: r.created_at,
      })),
    };
  });

/**
 * Write side of the review gate above. Service-role client required —
 * legal_authorities has no UPDATE policy for authenticated users (see
 * testConnectorSync's comment; same ingestion-owned-table reasoning).
 * "verified" is the only status that unlocks a citation in case-law
 * grounding; "failed_verification" records an explicit human rejection
 * (e.g. a bad OCR/parse from the connector) rather than leaving it
 * silently pending forever.
 */
export const markAuthorityVerified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = d as { authorityId?: string; decision?: string };
    if (typeof o.authorityId !== "string" || o.authorityId.length === 0) {
      throw new Error("authorityId required");
    }
    if (o.decision !== "verified" && o.decision !== "failed_verification") {
      throw new Error('decision must be "verified" or "failed_verification"');
    }
    return { authorityId: o.authorityId, decision: o.decision as "verified" | "failed_verification" };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("legal_authorities")
      .update({ verification_status: data.decision } as never)
      .eq("id", data.authorityId);
    if (error) throw new Error(error.message);

    console.info(
      `[legal-knowledge] authority ${data.authorityId} marked ${data.decision} by admin ${userId}`,
    );
    return { ok: true };
  });

export type TestConnectorSyncResult = {
  connectorCode: string;
  status: "completed" | "completed_with_errors" | "failed";
  documentsFetched: number;
  documentsStored: number;
  documentsVersioned: number;
  entitiesProjected: number;
  errors: string[];
  startedAt: string;
  endedAt: string;
};

/**
 * Manually trigger a real sync for one connector, on demand — not on a
 * schedule, not tied to case processing. This is the "Test" button gap
 * identified during Phase 1 verification: the admin dashboard could show
 * connector status but had no way to actually try a live sync and see a
 * real result. Deliberately available regardless of the connector's
 * current DB status ("planned" is fine to test) — testing is exactly how
 * a connector earns being flipped to "active".
 */
export const testConnectorSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((code: unknown) => {
    if (typeof code !== "string" || code.length === 0) throw new Error("connector code required");
    return code;
  })
  .handler(async ({ data: code, context }): Promise<TestConnectorSyncResult> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const { IMPLEMENTED_CONNECTORS } = await import("./legal-connectors/types");
    const connector = IMPLEMENTED_CONNECTORS.find((c) => c.code === code);
    if (!connector) {
      throw new Error(
        `No implementation found for connector "${code}" — it exists in the registry but has no working code yet (still a stub).`,
      );
    }

    const { runConnectorIngest, recordIngestRun } = await import("./legal-connectors/ingest-pipeline.server");
    // Writes (legal_authorities, legal_authority_versions, legal_ingest_runs)
    // have no INSERT/UPDATE RLS policies — they are ingestion-owned tables.
    // The caller is already verified as an admin above, so persist with the
    // service client; using the user client makes every store throw on RLS.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // since = null → the connector's own bounded initial-lookback window
    // (e.g. DOF looks back a fixed number of days, capped per run) — never
    // "fetch everything since the beginning of time".
    const result = await runConnectorIngest(supabaseAdmin as never, connector, null);
    await recordIngestRun(supabaseAdmin as never, result);

    return {
      connectorCode: result.connectorCode,
      status: result.status,
      documentsFetched: result.documentsFetched,
      documentsStored: result.documentsStored,
      documentsVersioned: result.documentsVersioned,
      entitiesProjected: result.entitiesProjected,
      errors: result.errors,
      startedAt: result.startedAt,
      endedAt: result.endedAt ?? new Date().toISOString(),
    };
  });
