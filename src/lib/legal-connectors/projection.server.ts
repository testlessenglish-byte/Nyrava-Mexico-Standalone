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
import type { IngestedDocument, LegalSourceConnector } from "./types";

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
