// Legal Authority Citation Verification — Phase 20 (Mexican Legal Knowledge
// Ingestion Pipeline), "Citation Verification" section.
//
// Separate concern from citation-audit.server.ts, which only checks a
// finding's citation to the CASE's own uploaded evidence (doc + page +
// quote). This module checks the other kind of citation: references to
// Mexican legal authorities themselves — statutes, articles, jurisprudencia,
// tesis — against public.legal_authorities / public.legal_citations.
//
// Core rule (non-negotiable): a legal-authority citation the AI produces is
// NEVER trusted just because the model asserted it. It is looked up in the
// indexed database; if it isn't there, it is marked unverified and MUST be
// excluded from anything presented as an established source of law.
//
// IMPORTANT — current state: public.legal_authorities has zero real content
// right now (no ingestion connector has been built yet — see
// public.legal_source_connectors, seeded with scjn/dof/tfja as "planned").
// That means every lookup here will currently return unverified, and that
// is the CORRECT and SAFE behavior — silently treating an unindexed
// citation as good would be exactly the hallucination-under-a-Mexican-label
// risk this file exists to prevent. Once a real ingestion connector lands
// (see src/lib/legal-connectors/), verified results will start appearing
// automatically — nothing here needs to change when that happens.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type LegalCitationCheck = {
  /** The citation text as produced by the model, e.g. "Art. 123 LFT" or "Tesis 1a./J. 15/2019 (10a.)". */
  citationText: string;
  verified: boolean;
  /** Set only when verified: the matched authority's id, for linking/display. */
  authorityId?: string;
  /** Set only when verified: canonical title of the matched authority. */
  matchedTitle?: string;
};

/**
 * Look up a single legal-authority citation against the indexed database.
 * Uses a normalized substring/ILIKE match against legal_authorities.title,
 * short_title, and citation — deliberately conservative (no fuzzy/semantic
 * matching) so a near-miss reads as "unverified" rather than a false
 * positive. Tighten or replace with a proper search index once real
 * content exists to test against.
 */
export async function verifyLegalCitation(db: Db, citationText: string): Promise<LegalCitationCheck> {
  const q = citationText.trim();
  if (!q) return { citationText, verified: false };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("legal_authorities")
    .select("id,title,short_title,citation")
    .or(`title.ilike.%${q}%,short_title.ilike.%${q}%,citation.ilike.%${q}%`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return { citationText, verified: false };

  return {
    citationText,
    verified: true,
    authorityId: data.id as string,
    matchedTitle: (data.short_title as string | null) ?? (data.title as string),
  };
}

/**
 * Batch version — verifies every citation in a report/finding payload in
 * one pass. Callers should strip or clearly flag any citation that comes
 * back unverified before it reaches a rendered report; never present an
 * unverified legal-authority citation as settled law.
 */
export async function verifyLegalCitations(db: Db, citations: string[]): Promise<LegalCitationCheck[]> {
  const unique = Array.from(new Set(citations.map((c) => c.trim()).filter(Boolean)));
  return Promise.all(unique.map((c) => verifyLegalCitation(db, c)));
}
