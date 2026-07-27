// DOF (Diario Oficial de la Federación) connector — Phase 20, endpoint audit 2026-07.
//
// ── Endpoint investigation (2026-07-27) ──────────────────────────────────────
// 1. datos.gob.mx (CKAN, https://www.datos.gob.mx/api/3/action/package_search)
//    is live and returns JSON, but a search for "diario oficial" yields only 5
//    unrelated CSV datasets (SENASICA's "Resumen del DOF", FIFONAFE decrees…).
//    The DOF corpus itself is NOT catalogued there → not usable as a source.
// 2. https://sidof.segob.gob.mx/notas/{yyyy}/{mm}/{dd} — the previously coded
//    "JSON" endpoint — now returns a server-rendered HTML page (Google
//    Analytics + jQuery/Bootstrap). There is no JSON service behind it.
// 3. Date-browsing on the canonical site DOES work and is stable:
//      GET https://www.dof.gob.mx/index.php?year=YYYY&month=MM&day=DD
//        → HTML index of the edition; each note is
//          <a href="/nota_detalle.php?codigo={codNota}&fecha=DD/MM/YYYY"
//             class="enlaces">Título</a>, grouped under issuer headings
//          (<td class="subtitle_azul">SECRETARIA DE …</td>).
//      GET https://www.dof.gob.mx/nota_detalle.php?codigo={cod}&fecha=DD/MM/YYYY
//        → HTML detail; the full official text lives inside
//          <div id="DivDetalleNota"> … </div>.
//    Pages are ISO-8859-1 with HTML entities, so we decode explicitly.
// 4. PDF fallback is unnecessary: nota_detalle.php exposes the same text as
//    the printed ejemplar, without OCR.
//
// Access method is therefore html_scrape (last resort per the connector
// priority rule) because no official machine-readable interface exists.
// Verified reachable from the sandbox and from the Worker runtime.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

type NoteRef = {
  codNota: string;
  title: string;
  issuer?: string;
  fecha: string; // DD/MM/YYYY as the site expects it
  date: Date;
};


const BASE = "https://www.dof.gob.mx";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DAY_LOOKBACK_ON_INITIAL = 1; // first-run backfill window when `since` is null
const MAX_DAYS_PER_RUN = 3;        // cap incremental runs so a long outage doesn't blow up one invocation
// A sync runs inside a single request, and dof.gob.mx throttles/blocks bursts
// of sequential page fetches. Keep every run small, slow-ish and bounded so it
// finishes well within a request budget and doesn't get us rate-limited.
const MAX_NOTES_PER_RUN = 12;
const RUN_BUDGET_MS = 45_000;
const THROTTLE_MS = 300;
const FETCH_TIMEOUT_MS = 12_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Deadline = { at: number };
const newDeadline = (): Deadline => ({ at: Date.now() + RUN_BUDGET_MS });
const expired = (d: Deadline) => Date.now() >= d.at;

/** DOF serves ISO-8859-1 while advertising UTF-8 in the header — decode by hand. */
async function fetchHtml(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-MX,es;q=0.9",
      "User-Agent": BROWSER_UA,
    },
    // Real page fetches over real government infrastructure — without a
    // timeout, one slow/hanging response stalls the entire sync run
    // indefinitely with no way to recover.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DOF ${res.status} at ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(buf);
}


const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", uuml: "ü", ntilde: "ñ",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Uuml: "Ü", Ntilde: "Ñ",
  iquest: "¿", iexcl: "¡", deg: "°", ordm: "º", ordf: "ª", laquo: "«", raquo: "»", middot: "·",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toDateOnly(d: Date) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function toDofFecha(d: Date) { return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; }
function dayUrl(d: Date) {
  return `${BASE}/index.php?year=${d.getUTCFullYear()}&month=${pad2(d.getUTCMonth() + 1)}&day=${pad2(d.getUTCDate())}`;
}
function noteUrl(codNota: string, fecha: string) {
  return `${BASE}/nota_detalle.php?codigo=${codNota}&fecha=${encodeURIComponent(fecha)}`;
}

function enumerateDays(since: Date | null): Date[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = since ? new Date(since) : new Date(today.getTime() - DAY_LOOKBACK_ON_INITIAL * 86400_000);
  start.setUTCHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let d = new Date(start); d <= today && days.length < MAX_DAYS_PER_RUN; d = new Date(d.getTime() + 86400_000)) {
    days.push(new Date(d));
  }
  return days;
}

/** Parse an edition index page into note references, carrying the issuer heading down. */
function parseDayIndex(html: string, d: Date): NoteRef[] {
  const out: NoteRef[] = [];
  // Interleave issuer headings and note links in document order.
  const token = /class=["']subtitle_azul["'][^>]*>([\s\S]*?)<\/td>|href=["']\/?nota_detalle\.php\?codigo=(\d+)&(?:amp;)?fecha=([^"'&]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let issuer: string | undefined;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = token.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const heading = htmlToText(m[1]).trim();
      if (heading) issuer = heading;
      continue;
    }
    const codNota = m[2];
    if (!codNota || seen.has(codNota)) continue;
    seen.add(codNota);
    const title = htmlToText(m[4] ?? "").trim();
    out.push({
      codNota,
      title: title || `DOF nota ${codNota}`,
      issuer,
      fecha: decodeURIComponent(m[3] ?? toDofFecha(d)),
      date: d,
    });
  }
  return out;
}

/** Pull the official text out of <div id="DivDetalleNota">. */
function parseNoteDetail(html: string): { text: string; title?: string } {
  const start = html.search(/<div[^>]*id=["']DivDetalleNota["'][^>]*>/i);
  let body = html;
  if (start >= 0) {
    const afterOpen = html.indexOf(">", start) + 1;
    // The note body is a full nested document; cut at the closing table cell.
    const endMarkers = ["</td>", "id='DivMenuDetalle'", 'id="DivMenuDetalle"'];
    let end = html.length;
    for (const marker of endMarkers) {
      const idx = html.indexOf(marker, afterOpen);
      if (idx > 0 && idx < end) end = idx;
    }
    body = html.slice(afterOpen, end);
  }
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(body);
  return {
    text: htmlToText(body),
    title: titleMatch ? htmlToText(titleMatch[1]).trim() : undefined,
  };
}

function buildIngested(ref: NoteRef, text: string, detailTitle?: string): IngestedDocument {
  const isoDate = toDateOnly(ref.date);
  return {
    externalId: `dof:${ref.codNota}`,
    kind: "federal_gazette",
    jurisdiction: "federal",
    title: ref.title || detailTitle || `DOF nota ${ref.codNota}`,
    shortTitle: (ref.title || detailTitle || "").slice(0, 200) || undefined,
    issuer: ref.issuer,
    citation: `DOF ${ref.fecha}`,
    publishedAt: isoDate,
    effectiveAt: isoDate,
    sourceUrl: noteUrl(ref.codNota, ref.fecha),
    rawText: text,
    metadata: { codNota: ref.codNota, fecha: ref.fecha, dependencia: ref.issuer },
  };
}

async function fetchNote(ref: NoteRef): Promise<IngestedDocument | null> {
  const html = await fetchHtml(noteUrl(ref.codNota, ref.fecha));
  if (!html) return null;
  const { text, title } = parseNoteDetail(html);
  return buildIngested(ref, text, title);
}

async function fetchOneDay(d: Date): Promise<IngestedDocument[]> {
  const html = await fetchHtml(dayUrl(d));
  if (!html) return [];
  const refs = parseDayIndex(html, d);
  const out: IngestedDocument[] = [];
  for (const ref of refs) {
    try {
      const doc = await fetchNote(ref);
      if (doc) out.push(doc);
    } catch (e) {
      // one bad note shouldn't tank the whole day
      console.warn(`[dof] skip nota ${ref.codNota} on ${toDateOnly(d)}: ${String(e)}`);
    }
  }
  return out;
}

export const dofConnector: LegalSourceConnector = {
  code: "dof",
  displayName: "Diario Oficial de la Federación",
  kind: "federal_gazette",
  accessMethod: "html_scrape",
  auth: { kind: "none" },

  async discover() {
    // Latest edition only — a lightweight ping used by the worker to see what's currently listed.
    const today = new Date();
    const html = await fetchHtml(dayUrl(today));
    if (!html) return [];
    return parseDayIndex(html, today).map((r) => ({
      externalId: `dof:${r.codNota}`,
      sourceUrl: noteUrl(r.codNota, r.fecha),
      publishedAt: toDateOnly(r.date),
    }));
  },

  async sync() {
    // Full sync = same as fetchUpdates with no floor; scheduler enforces bounds.
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    const days = enumerateDays(since);
    const out: IngestedDocument[] = [];
    for (const d of days) {
      const perDay = await fetchOneDay(d);
      out.push(...perDay);
    }
    return out;
  },

  async fetchDocument(externalId) {
    const codNota = externalId.replace(/^dof:/, "");
    // nota_detalle.php tolerates an empty `fecha`; the page still resolves by codigo.
    const html = await fetchHtml(`${BASE}/nota_detalle.php?codigo=${codNota}`);
    if (!html) throw new Error(`DOF nota not found: ${externalId}`);
    const { text, title } = parseNoteDetail(html);
    const fechaMatch = /DOF:\s*(\d{2}\/\d{2}\/\d{4})/.exec(htmlToText(html));
    const fecha = fechaMatch?.[1] ?? "";
    const [dd, mm, yyyy] = fecha ? fecha.split("/") : ["01", "01", "1970"];
    const ref: NoteRef = {
      codNota,
      title: title ?? `DOF nota ${codNota}`,
      fecha: fecha || toDofFecha(new Date()),
      date: new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))),
    };
    return buildIngested(ref, text, title);
  },

  async extractMetadata(doc) {
    return { issuer: doc.issuer, publishedAt: doc.publishedAt, citation: doc.citation };
  },

  async extractArticles(doc): Promise<ExtractedArticle[]> {
    // DOF notes are gazette entries (decrees, notices, resolutions), not
    // article-structured statutes. Article extraction is a no-op here; the
    // legislative-compilation connector (SCJN) is where articles come from.
    void doc;
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
      const today = new Date();
      const res = await fetch(dayUrl(today), {
        method: "GET",
        headers: { Accept: "text/html", "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(20_000),
      });
      return {
        connectorCode: "dof",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return { connectorCode: "dof", ok: false, checkedAt: new Date().toISOString(), detail: String(e) };
    }
  },
};
