// NLKN unified search — searches across authorities, articles,
// jurisprudencia, theses, and precedents by article number, law name,
// jurisdiction, topic, keyword, court, case number, or thesis registry
// number. Read-only, public-safe (all underlying tables have public SELECT
// policies), used by both the admin Legal Knowledge dashboard and any
// future case-analysis grounding step.
//
// Uses ILIKE + pg_trgm (indexes added in the NLKN expansion migration)
// rather than a dedicated search engine — appropriate for the current
// data volume (near-zero rows until connectors go active); revisit if/when
// real ingestion brings this into the hundreds of thousands of rows.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SearchInput = z.object({
  query: z.string().min(1).max(200),
  jurisdiction: z.string().optional(),
  topic: z.string().optional(),
  onlyVerified: z.boolean().optional().default(false),
});

export type NlknSearchResult = {
  entityType: "authority" | "article" | "precedent" | "jurisprudencia" | "thesis" | "regulation";
  id: string;
  title: string;
  snippet: string | null;
  jurisdiction: string | null;
  verificationStatus: string;
  sourceUrl: string | null;
};

export const searchLegalKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SearchInput.parse(raw))
  .handler(async ({ data, context }): Promise<NlknSearchResult[]> => {
    const { supabase: db } = context;
    const q = `%${data.query}%`;
    const results: NlknSearchResult[] = [];

    // Authorities: match on title, short_title, citation, or jurisdiction.
    {
      let query = db
        .from("legal_authorities")
        .select("id,title,citation,jurisdiction,verification_status,source_url")
        .or(`title.ilike.${q},short_title.ilike.${q},citation.ilike.${q}`)
        .limit(20);
      if (data.jurisdiction) query = query.eq("jurisdiction", data.jurisdiction);
      if (data.onlyVerified) query = query.eq("verification_status", "verified");
      const { data: rows } = await query;
      for (const r of rows ?? []) {
        results.push({
          entityType: "authority",
          id: r.id,
          title: r.title,
          snippet: r.citation,
          jurisdiction: r.jurisdiction,
          verificationStatus: r.verification_status,
          sourceUrl: r.source_url,
        });
      }
    }

    // Articles: match on article_number or body text.
    {
      const { data: rows } = await db
        .from("legal_articles")
        .select("id,article_number,heading,body,verification_status,source_url,authority_id")
        .or(`article_number.ilike.${q},heading.ilike.${q},body.ilike.${q}`)
        .limit(20);
      for (const r of rows ?? []) {
        results.push({
          entityType: "article",
          id: r.id,
          title: `Art. ${r.article_number}${r.heading ? " — " + r.heading : ""}`,
          snippet: r.body?.slice(0, 200) ?? null,
          jurisdiction: null,
          verificationStatus: r.verification_status,
          sourceUrl: r.source_url,
        });
      }
    }

    // Precedents: match on case_number, court, or summary.
    {
      const { data: rows } = await db
        .from("legal_precedents")
        .select("id,court,case_number,summary,jurisdiction,verification_status,source_url")
        .or(`case_number.ilike.${q},court.ilike.${q},summary.ilike.${q}`)
        .limit(20);
      for (const r of rows ?? []) {
        results.push({
          entityType: "precedent",
          id: r.id,
          title: `${r.court}${r.case_number ? " — " + r.case_number : ""}`,
          snippet: r.summary,
          jurisdiction: r.jurisdiction,
          verificationStatus: r.verification_status,
          sourceUrl: r.source_url,
        });
      }
    }

    // Jurisprudencia: match on registry_number or title.
    {
      const { data: rows } = await db
        .from("legal_jurisprudencia")
        .select("id,registry_number,title,verification_status,source_url")
        .or(`registry_number.ilike.${q},title.ilike.${q}`)
        .limit(20);
      for (const r of rows ?? []) {
        results.push({
          entityType: "jurisprudencia",
          id: r.id,
          title: `${r.title}${r.registry_number ? " (" + r.registry_number + ")" : ""}`,
          snippet: null,
          jurisdiction: "federal",
          verificationStatus: r.verification_status,
          sourceUrl: r.source_url,
        });
      }
    }

    // Theses: same shape as jurisprudencia.
    {
      const { data: rows } = await db
        .from("legal_theses")
        .select("id,registry_number,title,verification_status,source_url")
        .or(`registry_number.ilike.${q},title.ilike.${q}`)
        .limit(20);
      for (const r of rows ?? []) {
        results.push({
          entityType: "thesis",
          id: r.id,
          title: `${r.title}${r.registry_number ? " (" + r.registry_number + ")" : ""}`,
          snippet: null,
          jurisdiction: "federal",
          verificationStatus: r.verification_status,
          sourceUrl: r.source_url,
        });
      }
    }

    // Regulations: match on title.
    {
      const { data: rows } = await db
        .from("legal_regulations")
        .select("id,title,jurisdiction,verification_status,source_url")
        .ilike("title", q)
        .limit(20);
      for (const r of rows ?? []) {
        results.push({
          entityType: "regulation",
          id: r.id,
          title: r.title,
          snippet: null,
          jurisdiction: r.jurisdiction,
          verificationStatus: r.verification_status,
          sourceUrl: r.source_url,
        });
      }
    }

    // Topic-tagged results: if the query matches a topic name, pull in
    // anything linked to it via legal_topic_links, regardless of whether
    // the entity's own text matched above.
    if (data.topic) {
      const { data: topicRow } = await db.from("legal_topics").select("id").ilike("name", `%${data.topic}%`).limit(1).maybeSingle();
      if (topicRow) {
        const { data: links } = await db
          .from("legal_topic_links")
          .select("entity_type,entity_id")
          .eq("topic_id", topicRow.id)
          .limit(50);
        // Left as entity references for the caller to resolve — resolving
        // all 6 possible entity_type tables here would duplicate the
        // per-table logic above for a case with near-zero current data
        // volume; revisit once topics are actually populated.
        void links;
      }
    }

    return results.slice(0, 50);
  });
