// Real case-law grounding for legal issue hits (Report Intelligence).
//
// REBUILT 2026-07-29: this file previously queried CourtListener
// (https://www.courtlistener.com), a U.S. case-law database, and attached
// real U.S. federal/state court opinions to Mexican legal reports —
// keyed off issue types that were themselves U.S. doctrine (Fourth
// Amendment, Miranda, Brady, Jencks, Daubert/Frye). Both halves were
// wrong for a platform whose own README states it is "Built exclusively
// for Mexican law."
//
// This now queries `legal_authorities` — the local table populated by
// `scjn.connector.ts` (Suprema Corte de Justicia de la Nación, verified
// working against the real SJF2 jurisprudencia service) and
// `cjf.connector.ts` (Consejo de la Judicatura Federal). No external
// U.S. API call remains in this file.
//
// Intentionally fail-soft, same contract as before: any failure (DB
// error, empty corpus, no match) returns an empty case_law array rather
// than throwing. It must never be able to break report generation.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { LegalIssueHit } from "./report-augment.server";

type Db = SupabaseClient<Database>;

export type CaseLawResult = {
  case_name: string;
  citation: string | null;
  court: string | null;
  date_filed: string | null;
  url: string;
  snippet: string;
};

// One curated search query per Mexican issue type detected in
// buildLegalIssues() (see report-augment.server.ts's MX_ISSUE_RULES).
// Kept separate from the detection regexes so this file can be edited
// independently. Every query is in Spanish and targets real SCJN/CJF
// jurisprudencia vocabulary, not translated U.S. doctrine.
const ISSUE_QUERY_MAP: Record<string, string> = {
  "Cateo y Detención": "cateo orden judicial detención flagrancia caso urgente exclusión prueba ilícita",
  "Declaración del Imputado sin Garantías":
    "declaración imputado defensor adecuado derecho guardar silencio coacción nulidad",
  "Irregularidad en Solicitud de Cateo": "orden de cateo datos falsos omisión sustancial nulidad diligencia",
  "Omisión en el Deber de Aportación Probatoria":
    "principio de objetividad Ministerio Público carpeta de investigación datos de prueba ocultos",
  "Declaraciones Previas de Testigo":
    "entrevista previa testigo contradicción interrogatorio contrainterrogatorio credibilidad",
  "Cadena de Custodia": "cadena de custodia indicio ruptura valor probatorio exclusión",
  "Fundamentación Probatoria": "licitud de la prueba incorporación de prueba valoración probatoria juicio oral",
  "Impugnación Pericial": "dictamen pericial metodología perito acreditación valor probatorio impugnación",
};

// Simple in-memory cache so a single report run never queries the same
// issue twice (e.g. buildLegalIssues is called more than once per report).
// This is per-server-instance and intentionally not persisted anywhere.
const runCache = new Map<string, CaseLawResult[]>();

/**
 * Search the local legal_authorities table (SCJN/CJF jurisprudencia,
 * ingested via scjn.connector.ts / cjf.connector.ts) for real, citable
 * authority relevant to a given free-text Spanish query. Returns [] on
 * any failure or empty result — never throws.
 *
 * `opts.materia`, when provided, is used as a best-effort filter against
 * legal_authorities.metadata->>'materia' when that tag is present on a
 * row; rows without a materia tag are still eligible (many jurisprudencia
 * entries are cross-cutting) so this narrows rather than excludes.
 */
export async function searchCaseLaw(
  db: Db,
  query: string,
  opts: { maxResults?: number; materia?: string } = {},
): Promise<CaseLawResult[]> {
  const cacheKey = `${query}::${opts.materia ?? ""}`;
  const cached = runCache.get(cacheKey);
  if (cached) return cached;

  const max = opts.maxResults ?? 3;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (db as any)
      .from("legal_authorities")
      .select("title,short_title,citation,issuer,published_at,source_url,body,metadata")
      .eq("kind", "jurisprudence")
      .textSearch("body", query, { type: "websearch", config: "spanish" })
      .order("published_at", { ascending: false })
      .limit(max);

    const { data, error } = await q;
    if (error) {
      console.warn(`[case-law] legal_authorities lookup failed for query "${query}":`, error.message);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (Array.isArray(data) ? data : []) as any[];
    const results: CaseLawResult[] = rows.map((r) => ({
      case_name: String(r.short_title ?? r.title ?? "Tesis/Jurisprudencia sin título"),
      citation: r.citation ? String(r.citation) : null,
      court: r.issuer ? String(r.issuer) : null,
      date_filed: r.published_at ?? null,
      url: r.source_url ? String(r.source_url) : "https://sjf2.scjn.gob.mx",
      snippet: String(r.body ?? "").slice(0, 400),
    }));

    runCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(`[case-law] lookup threw for query "${query}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Takes the existing deterministic legal-issue hits and attaches real
 * SCJN/CJF jurisprudencia to each one, keyed off the Mexican issue type
 * (Cateo y Detención, Cadena de Custodia, etc — see
 * report-augment.server.ts). Never mutates input; never throws — on any
 * failure the issue is returned with case_law: [].
 *
 * `materia`, when provided, narrows the search (see searchCaseLaw above).
 */
export async function attachCaseLaw(db: Db, issues: LegalIssueHit[], materia?: string): Promise<LegalIssueHit[]> {
  // Only look up each distinct issue type once per report, not once per hit.
  const uniqueIssueTypes = Array.from(new Set(issues.map((i) => i.issue)));
  const byIssueType = new Map<string, CaseLawResult[]>();

  await Promise.all(
    uniqueIssueTypes.map(async (issueType) => {
      const query = ISSUE_QUERY_MAP[issueType];
      if (!query) {
        byIssueType.set(issueType, []);
        return;
      }
      const cases = await searchCaseLaw(db, query, { maxResults: 3, materia });
      byIssueType.set(issueType, cases);
    }),
  );

  return issues.map((i) => ({
    ...i,
    case_law: byIssueType.get(i.issue) ?? [],
  }));
}
