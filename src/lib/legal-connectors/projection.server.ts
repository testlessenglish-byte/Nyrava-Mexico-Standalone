// Entity projection — turns a stored legal_authorities row into the typed
// entity tables the Legal Knowledge dashboard counts (tesis,
// jurisprudencia, articles). Ingestion always stores the source document as
// an authority; this step is the "parse into structured entities" pass.
//
// Isolated from case execution: nothing here is imported by the case
// pipeline, and every failure is returned as a string rather than thrown,
// so a bad parse can never fail an ingest run (let alone a case run).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ExtractedCitation, IngestedDocument, LegalSourceConnector } from "./types";

type Db = SupabaseClient<Database>;

export type ProjectionResult = {
  theses: number;
  jurisprudencia: number;
  articles: number;
  errors: string[];
};

/** SCJN marks binding jurisprudencia vs isolated tesis in tipoTesis/tipoJurisprudencia. */
function isJurisprudencia(doc: IngestedDocument): boolean {
  const md = (doc.metadata ?? {}) as Record<string, unknown>;
  const hay = [md.tipoTesis, md.tipoJurisprudencia]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  return hay.includes("jurisprudencia");
}

function formationMethod(doc: IngestedDocument): string | null {
  const md = (doc.metadata ?? {}) as Record<string, unknown>;
  const hay = String(md.tipoJurisprudencia ?? "").toLowerCase();
  if (hay.includes("contradicc")) return "contradiccion_de_tesis";
  if (hay.includes("sustituc")) return "sustitucion";
  if (hay.includes("reiterac")) return "reiteracion";
  return null;
}

function epocaOf(doc: IngestedDocument): string | null {
  const md = (doc.metadata ?? {}) as Record<string, unknown>;
  const e = String(md.epoca ?? "").trim();
  return e || null;
}

/**
 * Project one ingested document into the typed tables. Idempotent:
 * tesis/jurisprudencia upsert on registry_number, articles on
 * (authority_id, article_number).
 */
export async function projectDocument(
  db: Db,
  connector: LegalSourceConnector,
  doc: IngestedDocument,
  authorityId: string,
): Promise<ProjectionResult> {
  const out: ProjectionResult = { theses: 0, jurisprudencia: 0, articles: 0, errors: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  if (doc.kind === "jurisprudencia") {
    const row = {
      registry_number: doc.externalId,
      title: doc.title,
      body: doc.rawText || doc.title,
      issuing_body: doc.issuer ?? null,
      epoca: epocaOf(doc),
      published_at: doc.publishedAt ?? null,
      source_url: doc.sourceUrl,
    };
    try {
      if (isJurisprudencia(doc)) {
        const { error } = await anyDb
          .from("legal_jurisprudencia")
          .upsert({ ...row, formation_method: formationMethod(doc), binding: true }, { onConflict: "registry_number" });
        if (error) throw new Error(error.message);
        out.jurisprudencia += 1;
      } else {
        const { error } = await anyDb
          .from("legal_theses")
          .upsert(row, { onConflict: "registry_number" });
        if (error) throw new Error(error.message);
        out.theses += 1;
      }
    } catch (e) {
      out.errors.push(`${doc.externalId}: tesis projection — ${String(e)}`);
    }
  }

  // Articles apply to any document whose text contains an articulado
  // (statutes, and DOF decrees that publish reformed articles).
  try {
    const articles = await connector.extractArticles(doc);
    if (articles.length > 0) {
      const rows = articles.slice(0, 500).map((a) => ({
        authority_id: authorityId,
        article_number: a.articleNumber,
        heading: a.heading ?? null,
        body: a.text,
        effective_at: doc.effectiveAt ?? null,
        source_url: doc.sourceUrl,
      }));
      const { error } = await anyDb
        .from("legal_articles")
        .upsert(rows, { onConflict: "authority_id,article_number" });
      if (error) throw new Error(error.message);
      out.articles += rows.length;
    }
  } catch (e) {
    out.errors.push(`${doc.externalId}: article projection — ${String(e)}`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Citation graph — Phase 2 (Knowledge Library) "relationship graph."
//
// public.legal_citations (authority_id, cited_authority_id, citation_text,
// context) has existed since the original NLKN migration, and every
// connector has implemented extractCitations() (citation-extract.ts's
// deterministic, conservative regex parser) from day one — but nothing in
// the ingestion pipeline ever called it. Confirmed: zero references to
// legal_citations anywhere outside the generated Supabase types, and
// extractCitations() was never invoked from projectDocument() or
// ingest-pipeline.server.ts. A fully-built extraction feature and its
// storage table sat completely disconnected from each other.
// ---------------------------------------------------------------------------

export type CitationProjectionResult = { extracted: number; resolved: number; errors: string[] };

/**
 * Best-effort resolution of an extracted citation to an existing
 * legal_authorities row. Deliberately conservative, same rule
 * citation-extract.ts already states for extraction itself: a false
 * negative (an unresolved citation, stored with cited_authority_id: null)
 * is far safer than a false positive (linking to the WRONG authority).
 *
 * Only tesis/jurisprudencia registry citations ("Tesis: 1a./J. 15/2019
 * (10a.)") are attempted — that registry number is a precise, unique
 * identifier stored verbatim in metadata->>claveTesis by scjn.connector.ts,
 * so an exact match is trustworthy. An article citation with a guessed law
 * name ("Art. 123 de la Ley Federal del Trabajo") or a bare code
 * abbreviation ("LFT") could plausibly match several different rows
 * (multiple reforms/versions, ambiguous short titles) — resolving those via
 * fuzzy title matching would risk exactly the false-positive linking this
 * function exists to avoid, so they are stored unresolved instead.
 */
/**
 * Pure extraction of the registry number from a tesis citation's display
 * text ("Tesis: 1a./J. 15/2019 (10a.)" -> "1a./J. 15/2019 (10a.)"). Split
 * out from resolveCitedAuthority below so the parsing rule — the only part
 * of resolution that doesn't need a DB round-trip — is directly testable.
 */
export function parseTesisRegistry(citationText: string): string | null {
  const tesisMatch = citationText.match(/^Tesis:\s*(.+)$/);
  if (!tesisMatch) return null;
  const registry = tesisMatch[1].trim();
  return registry || null;
}

async function resolveCitedAuthority(db: Db, citation: ExtractedCitation): Promise<string | null> {
  const registry = parseTesisRegistry(citation.citationText);
  if (!registry) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("legal_authorities")
    .select("id")
    .eq("kind", "jurisprudencia")
    .eq("metadata->>claveTesis", registry)
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Extract and persist this document's outbound citations. Idempotent by
 * replacement: extraction is deterministic pure-text parsing over
 * doc.rawText, so a re-ingest of unchanged text always reproduces the
 * identical row set, and a document whose text changed (a new version —
 * see versioning.server.ts) should not accumulate stale citations
 * alongside fresh ones from the new text. Never fatal to the ingest run.
 */
export async function projectCitations(
  db: Db,
  connector: LegalSourceConnector,
  doc: IngestedDocument,
  authorityId: string,
): Promise<CitationProjectionResult> {
  const out: CitationProjectionResult = { extracted: 0, resolved: 0, errors: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  try {
    const citations = await connector.extractCitations(doc);
    if (citations.length === 0) {
      await anyDb.from("legal_citations").delete().eq("authority_id", authorityId);
      return out;
    }

    const rows = await Promise.all(
      citations.slice(0, 200).map(async (c) => ({
        authority_id: authorityId,
        cited_authority_id: await resolveCitedAuthority(db, c),
        citation_text: c.citationText,
        // citedAuthorityHint is the best-effort guess at what the citation
        // refers to (a law name, a code abbreviation) — kept as free-text
        // context even when it wasn't precise enough to resolve to a row.
        context: c.citedAuthorityHint ?? null,
      })),
    );
    out.extracted = rows.length;
    out.resolved = rows.filter((r) => r.cited_authority_id).length;

    await anyDb.from("legal_citations").delete().eq("authority_id", authorityId);
    const { error } = await anyDb.from("legal_citations").insert(rows);
    if (error) throw new Error(error.message);
  } catch (e) {
    out.errors.push(`${doc.externalId}: citation projection — ${String(e)}`);
  }
  return out;
}
