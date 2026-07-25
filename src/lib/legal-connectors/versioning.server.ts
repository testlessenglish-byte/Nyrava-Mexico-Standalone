// Version history for ingested legal authorities — Phase 20 "Version
// History" requirement: every statute keeps current text, previous text,
// effective date, and amendment history, so analysis can reference the law
// as it stood at the relevant date rather than only the current text.
//
// Storage approach: public.legal_authorities holds the CURRENT version of
// each authority (one row per externalId). Every prior version is archived
// into public.legal_authority_versions (created by the migration below)
// before the row is overwritten, keyed by (authority_id, version_number).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { IngestedDocument } from "./types";

type Db = SupabaseClient<Database>;

/**
 * Upsert an ingested document into legal_authorities. If a row with this
 * externalId already exists AND the text actually changed, the prior
 * version is archived first — this is what makes "the law as it stood on
 * date X" queries possible later.
 */
export async function upsertAuthorityWithVersioning(
  db: Db,
  connectorCode: string,
  doc: IngestedDocument,
): Promise<{ authorityId: string; versioned: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (db as any)
    .from("legal_authorities")
    .select("id,body,metadata")
    .eq("metadata->>external_id", doc.externalId)
    .eq("metadata->>connector_code", connectorCode)
    .maybeSingle();

  const metadata = { ...(doc.metadata ?? {}), external_id: doc.externalId, connector_code: connectorCode };

  if (!existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (db as any)
      .from("legal_authorities")
      .insert({
        kind: doc.kind,
        jurisdiction: doc.jurisdiction,
        title: doc.title,
        short_title: doc.shortTitle ?? null,
        issuer: doc.issuer ?? null,
        citation: doc.citation ?? null,
        published_at: doc.publishedAt ?? null,
        effective_at: doc.effectiveAt ?? null,
        source_url: doc.sourceUrl,
        body: doc.rawText,
        metadata,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Insert failed for ${doc.externalId}: ${error.message}`);
    return { authorityId: inserted.id as string, versioned: false };
  }

  const textChanged = existing.body !== doc.rawText;
  if (textChanged) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("legal_authority_versions").insert({
      authority_id: existing.id,
      body: existing.body,
      metadata: existing.metadata,
      archived_at: new Date().toISOString(),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (db as any)
    .from("legal_authorities")
    .update({
      title: doc.title,
      short_title: doc.shortTitle ?? null,
      issuer: doc.issuer ?? null,
      citation: doc.citation ?? null,
      published_at: doc.publishedAt ?? null,
      effective_at: doc.effectiveAt ?? null,
      body: doc.rawText,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (updateErr) throw new Error(`Update failed for ${doc.externalId}: ${updateErr.message}`);

  return { authorityId: existing.id as string, versioned: textChanged };
}
