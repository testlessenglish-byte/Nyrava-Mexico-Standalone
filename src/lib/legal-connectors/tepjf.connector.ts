// Justicia electoral — real implementation. Endpoint audit 2026-07, verified
// live from the sandbox.
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// The federal TEPJF (te.gob.mx) sits behind a Radware Bot Manager WAF: every
// server-side request — apex, www, /IUSEapp/, /sentenciasHTML/, portal — is
// answered with a 303 to an InternalSecurityPage or a perfdrive validation
// redirect, including through text proxies. There is no reachable interface,
// and its tesis are NOT mirrored in the SJF2 microservice (an `instancia`
// filter for Sala Superior / Salas Regionales / TEPJF returns total = 0).
//
// The reachable, official electoral-jurisdiction source is the Tribunal
// Electoral de la Ciudad de México (TECDMX), which publishes its sentencias
// as dated public listings:
//
//   GET https://www.tecdmx.org.mx/index.php/sentencias_inicio/
//        → #datepicker[data-highlight] = comma-separated MM/DD/YYYY list of
//          every session date that has published sentencias (2018 → today)
//   GET https://www.tecdmx.org.mx/index.php/sentencias/{yyyy}/{m}/{d}/
//        → <article class="… sentencias …"> per resolución, with the
//          expediente (h2.entry-title), the versión pública PDF link, and
//          Actor / Autoridad Responsable / Tercero Interesado fields.
//
// The sentencia bodies are PDFs; this connector ingests the full structured
// record (expediente, tipo de medio de impugnación, actor, autoridad
// responsable, tercero interesado, fecha de resolución) and links to the
// official versión pública. No PDF text is fabricated.
//
// Runs are incremental: `alreadyIngested` drives a skip-list so repeated runs
// walk further back through the session calendar instead of re-reading the
// newest date.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const SITE = "https://www.tecdmx.org.mx";
const INDEX = `${SITE}/index.php/sentencias_inicio/`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_DATES_PER_RUN = 8;
const MAX_DOCS_PER_RUN = 25;
const RUN_BUDGET_MS = 45_000;
const FETCH_TIMEOUT_MS = 20_000;
const THROTTLE_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Medio de impugnación local, derived from the expediente key (TECDMX-XXX-n/yyyy). */
const MEDIOS: Record<string, string> = {
  JEL: "Juicio Electoral",
  JLDC: "Juicio para la Protección de los Derechos Político-Electorales de la Ciudadanía",
  PES: "Procedimiento Especial Sancionador",
  POS: "Procedimiento Ordinario Sancionador",
  AG: "Asunto General",
  JE: "Juicio Electoral",
  RA: "Recurso de Apelación",
  INC: "Incidente",
};

function stripHtml(s: string): string {
  return s
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-MX,es;q=0.9",
      "User-Agent": BROWSER_UA,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TECDMX ${res.status} at ${url}`);
  return await res.text();
}

type SessionDate = { y: number; m: number; d: number; iso: string };

/** Every session date that has published sentencias, newest first. */
async function listSessionDates(): Promise<SessionDate[]> {
  const html = await fetchHtml(INDEX);
  if (!html) return [];
  const m = html.match(/id="datepicker"[^>]*data-highlight="([^"]*)"/i);
  if (!m) return [];
  const dates: SessionDate[] = [];
  for (const raw of m[1].split(",")) {
    const p = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!p) continue;
    const [, mm, dd, yyyy] = p;
    dates.push({
      y: Number(yyyy),
      m: Number(mm),
      d: Number(dd),
      iso: `${yyyy}-${mm}-${dd}`,
    });
  }
  dates.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
  return dates;
}

const archiveUrl = (s: SessionDate) => `${SITE}/index.php/sentencias/${s.y}/${s.m}/${s.d}/`;

const externalIdOf = (expediente: string) =>
  `tecdmx:sentencia:${expediente.replace(/\s+/g, "_").toUpperCase()}`;

function fieldOf(block: string, label: string): string {
  const re = new RegExp(`<strong>\\s*${label}\\s*:?\\s*</strong>([\\s\\S]*?)</div>`, "i");
  const m = block.match(re);
  return m ? stripHtml(m[1]) : "";
}

function medioOf(expediente: string): string | undefined {
  const m = expediente.match(/^TECDMX-([A-ZÁÉÍÓÚ]+)-/i);
  if (!m) return undefined;
  return MEDIOS[m[1].toUpperCase()];
}

function parseArchive(html: string, session: SessionDate): IngestedDocument[] {
  const out: IngestedDocument[] = [];
  const blocks = html.match(/<article[^>]*class="[^"]*\bsentencias\b[^"]*"[\s\S]*?<\/article>/gi) ?? [];

  for (const block of blocks) {
    const titleM = block.match(/<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
    const expediente = titleM ? stripHtml(titleM[1]) : "";
    if (!expediente) continue;

    const pdfM = block.match(/href="([^"]+\.pdf)"/i);
    const pdfUrl = pdfM ? pdfM[1] : undefined;
    const actor = fieldOf(block, "Actor");
    const autoridad = fieldOf(block, "Autoridad Responsable");
    const tercero = fieldOf(block, "Tercero Interesado");
    const medio = medioOf(expediente);

    const rawText = [
      `Sentencia ${expediente} del Tribunal Electoral de la Ciudad de México (TECDMX).`,
      medio ? `Medio de impugnación: ${medio}.` : "",
      `Fecha de resolución: ${session.iso}.`,
      actor ? `Parte actora: ${actor}.` : "",
      autoridad ? `Autoridad responsable: ${autoridad}.` : "",
      tercero ? `Tercero interesado: ${tercero}.` : "",
      pdfUrl ? `Versión pública de la sentencia: ${pdfUrl}` : "",
      "Registro publicado en la consulta pública de sentencias del Tribunal Electoral de la Ciudad de México.",
    ]
      .filter(Boolean)
      .join("\n");

    out.push({
      externalId: externalIdOf(expediente),
      kind: "electoral_ruling",
      jurisdiction: "CMX",
      title: [expediente, medio].filter(Boolean).join(" — "),
      shortTitle: expediente.slice(0, 200),
      issuer: "Tribunal Electoral de la Ciudad de México",
      citation: `Expediente ${expediente}`,
      publishedAt: session.iso,
      effectiveAt: session.iso,
      sourceUrl: pdfUrl ?? archiveUrl(session),
      rawText,
      metadata: {
        tribunal: "Tribunal Electoral de la Ciudad de México (TECDMX)",
        entidad: "Ciudad de México",
        expediente,
        medioImpugnacion: medio,
        actor: actor || undefined,
        autoridadResponsable: autoridad || undefined,
        terceroInteresado: tercero || undefined,
        fechaSesion: session.iso,
        listadoUrl: archiveUrl(session),
        versionPublicaPdf: pdfUrl,
      },
    });
  }
  return out;
}

async function collect(since: Date | null, known: Set<string> | undefined): Promise<IngestedDocument[]> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const out: IngestedDocument[] = [];
  const seen = new Set<string>();
  const floor = since ? new Date(since).getTime() : null;

  const dates = await listSessionDates();
  let datesVisited = 0;

  for (const session of dates) {
    if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
    if (datesVisited >= MAX_DATES_PER_RUN) break;

    const ts = new Date(`${session.iso}T00:00:00Z`).getTime();
    // Honor the date floor only on plain incremental runs; while backfilling
    // (skip-list non-empty) keep walking older sessions.
    if (floor !== null && ts < floor && !known?.size) break;

    datesVisited += 1;
    let html: string | null = null;
    try {
      await sleep(THROTTLE_MS);
      html = await fetchHtml(archiveUrl(session));
    } catch (e) {
      console.warn(`[tepjf] skip session ${session.iso}: ${String(e)}`);
      continue;
    }
    if (!html) continue;

    for (const doc of parseArchive(html, session)) {
      if (out.length >= MAX_DOCS_PER_RUN) break;
      if (seen.has(doc.externalId)) continue;
      seen.add(doc.externalId);
      if (known?.has(doc.externalId)) continue;
      out.push(doc);
    }
  }
  return out;
}

export const tepjfConnector: LegalSourceConnector = {
  code: "tepjf",
  displayName: "Justicia Electoral (TECDMX · Ciudad de México)",
  kind: "electoral_ruling",
  accessMethod: "html_scrape",
  auth: { kind: "none" },

  async discover() {
    const dates = await listSessionDates();
    const first = dates[0];
    if (!first) return [];
    const html = await fetchHtml(archiveUrl(first));
    if (!html) return [];
    return parseArchive(html, first).map((d) => ({
      externalId: d.externalId,
      sourceUrl: d.sourceUrl,
      publishedAt: d.publishedAt,
    }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    return collect(since, this.alreadyIngested);
  },

  async fetchDocument(externalId) {
    const dates = await listSessionDates();
    for (const session of dates.slice(0, MAX_DATES_PER_RUN)) {
      const html = await fetchHtml(archiveUrl(session));
      if (!html) continue;
      const hit = parseArchive(html, session).find((d) => d.externalId === externalId);
      if (hit) return hit;
    }
    throw new Error(`Sentencia electoral no encontrada: ${externalId}`);
  },

  async extractMetadata(doc) {
    return { issuer: doc.issuer, publishedAt: doc.publishedAt, citation: doc.citation };
  },

  /** Electoral rulings carry no articulado of their own. */
  async extractArticles(_doc: IngestedDocument): Promise<ExtractedArticle[]> {
    return [];
  },

  async extractCitations(doc): Promise<ExtractedCitation[]> {
    return extractCitationsFromText(doc.rawText);
  },

  async normalize(doc) {
    const cleaned = doc.rawText
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { ...doc, rawText: cleaned };
  },

  async validate(doc): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!doc.externalId) errors.push("missing externalId");
    if (!doc.title) errors.push("missing title");
    if (!doc.sourceUrl) errors.push("missing sourceUrl");
    if (!doc.rawText || doc.rawText.length < 20) errors.push("rawText too short (<20 chars)");
    return { valid: errors.length === 0, errors };
  },

  async healthCheck(): Promise<ConnectorHealth> {
    try {
      const res = await fetch(INDEX, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return {
        connectorCode: "tepjf",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return { connectorCode: "tepjf", ok: false, checkedAt: new Date().toISOString(), detail: String(e) };
    }
  },
};
