// Real case-law grounding for legal issue hits (Report Intelligence).
// Mexican-only: queries the local legal_authorities corpus populated by the
// government-source connectors. No U.S. case-law source is used here.
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

// Curated expansions where a compact issue label benefits from Mexican legal
// vocabulary. IMPORTANT: this map is an optimization, not an allowlist. An
// issue not present here MUST still query the knowledge library using its own
// Spanish issue text; the previous allowlist behavior meant Amparo, fiscal,
// administrativo, familiar, laboral, civil, mercantil, agrario, electoral,
// ambiental and inmobiliario issues silently received zero legal-authority
// grounding while penal labels happened to work.
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
  "Procedencia del recurso de revisión": "amparo directo revisión procedencia cuestión constitucional importancia trascendencia",
  "Legitimación": "legitimación interés jurídico interés legítimo amparo recurso revisión",
  "Notificación": "notificación personal sentencia amparo plazo recurso revisión debido proceso",
  "Interpretación constitucional": "interpretación directa constitución amparo directo revisión Suprema Corte",
  "Definitividad": "principio definitividad amparo excepciones procedencia",
  "Suspensión": "suspensión acto reclamado apariencia buen derecho interés social amparo",
  "Competencia": "competencia jurisdicción órgano jurisdiccional amparo federal",
};

export function buildCaseLawSearchQuery(issueType: string, materia?: string): string {
  const issue = String(issueType ?? "").trim();
  if (!issue) return "";
  const curated = ISSUE_QUERY_MAP[issue];
  if (curated) return curated;
  // Generic fallback is what makes the knowledge network platform-wide.
  // Keep it close to the issue wording instead of inventing doctrine. Adding
  // the materia gives PostgreSQL websearch useful context for common labels
  // such as "competencia" or "notificación" without changing the proposition.
  const m = String(materia ?? "").trim();
  return m ? `${issue} ${m}` : issue;
}

const runCache = new Map<string, CaseLawResult[]>();

const FEDERAL_ISSUER_RE =
  /suprema corte|scjn|pleno (regional|de circuito)|primera sala|segunda sala|tribunal(es)? colegiado|tribunal(es)? unitario|colegiado de circuito|juzgado de distrito|consejo de la judicatura federal|\bcjf\b|tribunal federal de justicia administrativa|\btfja\b|tribunal electoral del poder judicial|\btepjf\b|tribunal (unitario|superior) agrario|poder judicial de la federaci/i;

export function isFederalIssuer(issuer: string | null | undefined): boolean {
  return FEDERAL_ISSUER_RE.test(String(issuer ?? ""));
}

export async function searchCaseLaw(
  db: Db,
  query: string,
  opts: { maxResults?: number; materia?: string; federalOnly?: boolean } = {},
): Promise<CaseLawResult[]> {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) return [];
  const cacheKey = `${normalizedQuery}::${opts.materia ?? ""}::${opts.federalOnly ? "fed" : "all"}`;
  const cached = runCache.get(cacheKey);
  if (cached) return cached;

  const max = opts.maxResults ?? 3;
  const fetchLimit = opts.federalOnly ? Math.max(max * 6, 18) : max;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (db as any)
      .from("legal_authorities")
      .select("title,short_title,citation,issuer,published_at,source_url,body,metadata,authority_level")
      .in("kind", ["jurisprudencia", "court_decision"])
      .eq("verification_status", "verified")
      .textSearch("body", normalizedQuery, { type: "websearch", config: "spanish" })
      .order("authority_level", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false })
      .limit(fetchLimit);

    const { data, error } = await q;
    if (error) {
      console.warn(`[case-law] legal_authorities lookup failed for query "${normalizedQuery}":`, error.message);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (Array.isArray(data) ? data : []) as any[];
    let mapped: CaseLawResult[] = rows.map((r) => ({
      case_name: String(r.short_title ?? r.title ?? "Tesis/Jurisprudencia sin título"),
      citation: r.citation ? String(r.citation) : null,
      court: r.issuer ? String(r.issuer) : null,
      date_filed: r.published_at ?? null,
      url: r.source_url ? String(r.source_url) : "https://sjf2.scjn.gob.mx",
      snippet: String(r.body ?? "").slice(0, 400),
    }));

    if (opts.federalOnly) {
      const federal = mapped.filter((r) => isFederalIssuer(r.court));
      mapped = federal.length ? federal : mapped;
    }

    const results = mapped.slice(0, max);
    runCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(
      `[case-law] lookup threw for query "${normalizedQuery}":`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Attach verified Mexican legal authorities to every detected legal issue.
 * Unknown issue labels are searched by their own text instead of being
 * silently discarded because they were absent from a hand-maintained map.
 */
export async function attachCaseLaw(
  db: Db,
  issues: LegalIssueHit[],
  materia?: string,
  opts: { federalOnly?: boolean } = {},
): Promise<LegalIssueHit[]> {
  const uniqueIssueTypes = Array.from(new Set(issues.map((i) => i.issue)));
  const byIssueType = new Map<string, CaseLawResult[]>();

  await Promise.all(
    uniqueIssueTypes.map(async (issueType) => {
      const query = buildCaseLawSearchQuery(issueType, materia);
      const cases = query
        ? await searchCaseLaw(db, query, {
            maxResults: 3,
            materia,
            federalOnly: opts.federalOnly === true,
          })
        : [];
      byIssueType.set(issueType, cases);
    }),
  );

  return issues.map((i) => ({
    ...i,
    case_law: byIssueType.get(i.issue) ?? [],
  }));
}
