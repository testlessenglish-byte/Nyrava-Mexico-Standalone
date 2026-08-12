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
    citations: number;
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

// Trust classification (isStructuredAccessMethod) lives in
// legal-connectors/types.ts — the SAME check the ingest pipeline now uses to
// auto-verify a new authority the moment it's stored (versioning.server.ts),
// so this admin backlog tool and live ingestion can never disagree about
// which sources are low-risk enough to skip human review.
async function getTrustedConnectorCodes(): Promise<Set<string>> {
  const { IMPLEMENTED_CONNECTORS, isStructuredAccessMethod } = await import("./legal-connectors/types");
  return new Set(IMPLEMENTED_CONNECTORS.filter((c) => isStructuredAccessMethod(c.accessMethod)).map((c) => c.code));
}

export const getNlknStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NlknStats> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const [connectorsRes, runsRes, authRes, artRes, precRes, jurisRes, thesesRes, regRes, citRes] = await Promise.all([
      db.from("legal_source_connectors").select("code,name,status,last_sync_at").order("code"),
      db.from("legal_ingest_runs").select("connector_code,started_at,ended_at,status,documents_fetched,documents_stored").order("started_at", { ascending: false }).limit(300),
      db.from("legal_authorities").select("verification_status"),
      db.from("legal_articles").select("id", { count: "exact", head: true }),
      db.from("legal_precedents").select("id", { count: "exact", head: true }),
      db.from("legal_jurisprudencia").select("id", { count: "exact", head: true }),
      db.from("legal_theses").select("id", { count: "exact", head: true }),
      db.from("legal_regulations").select("id", { count: "exact", head: true }),
      db.from("legal_citations").select("id", { count: "exact", head: true }),
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
        citations: citRes.count ?? 0,
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

export type PendingSourceBreakdown = {
  connectorCode: string;
  connectorName: string;
  count: number;
  /** true = structured/machine-readable source, eligible for bulk-verify. */
  trusted: boolean;
};

/**
 * Groups the pending-review backlog by ingesting connector so the admin can
 * see, at a glance, which sources make up the backlog and which of those are
 * safe to bulk-approve (see STRUCTURED_ACCESS_METHODS above) versus which
 * still need the item-by-item human review this whole gate exists for.
 */
export const getPendingAuthoritiesBySource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: PendingSourceBreakdown[] }> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const trusted = await getTrustedConnectorCodes();
    const [{ data: rows, error }, { data: connectors }] = await Promise.all([
      db
        .from("legal_authorities")
        .select("metadata")
        .eq("verification_status", "pending")
        .in("kind", ["jurisprudencia", "court_decision"])
        .limit(5000),
      db.from("legal_source_connectors").select("code,name"),
    ]);
    if (error) throw new Error(error.message);

    const nameByCode = new Map(((connectors ?? []) as { code: string; name: string }[]).map((c) => [c.code, c.name]));
    const counts = new Map<string, number>();
    for (const row of (rows ?? []) as { metadata: Record<string, unknown> | null }[]) {
      const code = typeof row.metadata?.connector_code === "string" ? (row.metadata.connector_code as string) : "unknown";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    return {
      rows: [...counts.entries()]
        .map(([connectorCode, count]) => ({
          connectorCode,
          connectorName: nameByCode.get(connectorCode) ?? connectorCode,
          count,
          trusted: trusted.has(connectorCode),
        }))
        .sort((a, b) => b.count - a.count),
    };
  });

export type BulkVerifyResult = { verified: number; skippedIncomplete: number };

/**
 * Bulk-approves every pending jurisprudencia/court_decision row from ONE
 * connector, but only when that connector is on the structured/trusted list
 * (official API/JSON/XML/RSS/CSV/ZIP feed — no OCR, no HTML scraping, no PDF
 * text extraction). Still refuses to blanket-verify a row that's missing
 * the fields an actual citation needs (title/citation/body) even from a
 * trusted source — a structured feed can still return an incomplete record,
 * and those stay pending for a human to look at rather than being silently
 * rubber-stamped. This does not touch untrusted-source rows at all; those
 * remain exactly as manual as markAuthorityVerified above.
 */
export const bulkVerifyTrustedSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = d as { connectorCode?: string };
    if (typeof o.connectorCode !== "string" || o.connectorCode.length === 0) {
      throw new Error("connectorCode required");
    }
    return { connectorCode: o.connectorCode };
  })
  .handler(async ({ data, context }): Promise<BulkVerifyResult> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const trusted = await getTrustedConnectorCodes();
    if (!trusted.has(data.connectorCode)) {
      throw new Error(
        `"${data.connectorCode}" is not a structured/trusted source (official API, JSON, XML, RSS, CSV, or ZIP feed) — bulk-verify only applies to sources that never need OCR or HTML scraping. Review its items manually below.`,
      );
    }

    const { data: rows, error } = await db
      .from("legal_authorities")
      .select("id,title,citation,body")
      .eq("verification_status", "pending")
      .in("kind", ["jurisprudencia", "court_decision"])
      .eq("metadata->>connector_code", data.connectorCode)
      .limit(2000);
    if (error) throw new Error(error.message);

    const candidates = (rows ?? []) as { id: string; title: string | null; citation: string | null; body: string | null }[];
    const complete = candidates.filter(
      (r) => (r.title ?? "").trim().length > 0 && (r.citation ?? "").trim().length > 0 && (r.body ?? "").trim().length > 50,
    );
    const skippedIncomplete = candidates.length - complete.length;
    if (complete.length === 0) return { verified: 0, skippedIncomplete };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateErr } = await supabaseAdmin
      .from("legal_authorities")
      .update({ verification_status: "verified" } as never)
      .in("id", complete.map((r) => r.id));
    if (updateErr) throw new Error(updateErr.message);

    console.info(
      `[legal-knowledge] bulk-verified ${complete.length} authorities from trusted source ${data.connectorCode} ` +
        `by admin ${userId} (${skippedIncomplete} incomplete rows left pending)`,
    );
    return { verified: complete.length, skippedIncomplete };
  });

/**
 * Phase 2 (Knowledge Library) "authority supersession" — deliberately a
 * human-reviewed action, not automated detection. legal_authorities has
 * carried a superseded_by_id column and verification_status has included
 * 'superseded' as a valid value since the original NLKN migration
 * (20260726000000), but nothing in the codebase ever set either: confirmed
 * zero references outside the generated Supabase types. Attempting to
 * detect supersession automatically (e.g. NLP over "esta tesis interrumpe
 * la jurisprudencia X" free text) would mean an algorithm making a legal
 * determination about which authority is currently binding — exactly the
 * kind of fabricated-precision risk this platform's evidence-provenance
 * work has spent this whole phase trying to eliminate elsewhere. A human
 * reviewer marking it explicitly, the same pattern already established and
 * shipped for markAuthorityVerified above, carries none of that risk.
 */
export type AuthoritySearchResult = {
  id: string;
  kind: string;
  title: string;
  shortTitle: string | null;
  citation: string | null;
  publishedAt: string | null;
  verificationStatus: string;
};

/** Lookup for the supersession picker UI — verified jurisprudencia/court_decision only, since those are the only kinds this platform currently cites as case law (see case-law.server.ts). */
export const searchVerifiedAuthorities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = (d ?? {}) as { query?: string };
    const query = typeof o.query === "string" ? o.query.trim() : "";
    if (query.length < 3) throw new Error("query must be at least 3 characters");
    return { query };
  })
  .handler(async ({ data, context }): Promise<{ rows: AuthoritySearchResult[] }> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const { data: rows, error } = await db
      .from("legal_authorities")
      .select("id,kind,title,short_title,citation,published_at,verification_status")
      .in("kind", ["jurisprudencia", "court_decision"])
      .eq("verification_status", "verified")
      // PostgREST `.or()` parses commas/parens/dots as filter syntax — strip
      // them (plus wildcards) from the caller value so search text can never
      // inject extra filter clauses.
      .or(
        (() => {
          const q = data.query.replace(/[,().*%\\"']/g, " ").trim();
          return `title.ilike.%${q}%,short_title.ilike.%${q}%,citation.ilike.%${q}%`;
        })(),
      )
      .order("published_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);

    type AuthoritySearchRow = {
      id: string;
      kind: string;
      title: string;
      short_title: string | null;
      citation: string | null;
      published_at: string | null;
      verification_status: string;
    };
    return {
      rows: ((rows ?? []) as AuthoritySearchRow[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        shortTitle: r.short_title,
        citation: r.citation,
        publishedAt: r.published_at,
        verificationStatus: r.verification_status,
      })),
    };
  });

/**
 * Write side. Requires both authorities to actually exist (a typo'd id
 * must fail loudly, not silently write a dangling reference — superseded_
 * by_id has ON DELETE SET NULL for real deletions, but that's not the same
 * guarantee as validating the id was ever real in the first place), and
 * refuses to point at a superseding authority that is itself already
 * marked superseded — a superseded row does not describe currently-binding
 * law, so it cannot be *the* answer for what currently supersedes
 * something else; the reviewer should point at that authority's own
 * eventual replacement instead. Chains longer than one hop (A superseded
 * by B, B later superseded by C) are not otherwise validated here — that
 * is a deliberate, narrow scope limit, not an oversight.
 */
export const markAuthoritySuperseded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const o = d as { authorityId?: string; supersededByAuthorityId?: string };
    if (typeof o.authorityId !== "string" || o.authorityId.length === 0) {
      throw new Error("authorityId required");
    }
    if (typeof o.supersededByAuthorityId !== "string" || o.supersededByAuthorityId.length === 0) {
      throw new Error("supersededByAuthorityId required");
    }
    if (o.authorityId === o.supersededByAuthorityId) {
      throw new Error("an authority cannot supersede itself");
    }
    return { authorityId: o.authorityId, supersededByAuthorityId: o.supersededByAuthorityId };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase: db, userId } = context;
    await requireAdmin({ supabase: db, userId });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error: lookupErr } = await supabaseAdmin
      .from("legal_authorities")
      .select("id,verification_status")
      .in("id", [data.authorityId, data.supersededByAuthorityId]);
    if (lookupErr) throw new Error(lookupErr.message);

    type LookupRow = { id: string; verification_status: string };
    const byId = new Map(((rows ?? []) as LookupRow[]).map((r) => [r.id, r.verification_status]));
    if (!byId.has(data.authorityId)) throw new Error(`authority ${data.authorityId} not found`);
    if (!byId.has(data.supersededByAuthorityId)) {
      throw new Error(`superseding authority ${data.supersededByAuthorityId} not found`);
    }
    if (byId.get(data.supersededByAuthorityId) === "superseded") {
      throw new Error(
        "the superseding authority is itself marked superseded — point to its own replacement instead",
      );
    }

    const { error } = await supabaseAdmin
      .from("legal_authorities")
      .update({
        verification_status: "superseded",
        superseded_by_id: data.supersededByAuthorityId,
      } as never)
      .eq("id", data.authorityId);
    if (error) throw new Error(error.message);

    console.info(
      `[legal-knowledge] authority ${data.authorityId} marked superseded by ${data.supersededByAuthorityId}, admin ${userId}`,
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
  citationsExtracted: number;
  citationsResolved: number;
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
      citationsExtracted: result.citationsExtracted,
      citationsResolved: result.citationsResolved,
      errors: result.errors,
      startedAt: result.startedAt,
      endedAt: result.endedAt ?? new Date().toISOString(),
    };
  });
