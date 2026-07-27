// Congreso de la Unión connector — Cámara de Diputados "Leyes Federales
// Vigentes" compilation (LeyesBiblio). Endpoint audit 2026-07 (verified against
// the live markup).
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// 1. There is no API, JSON feed or RSS for the federal statute corpus. The
//    canonical machine-reachable surface is the compilation index:
//      GET https://www.diputados.gob.mx/LeyesBiblio/index.htm
//    Each <tr> is one law and carries exactly four cells:
//      [No.] | <a href="ref/<abbr>.htm">TITLE</a> + "DOF dd/mm/yyyy" (original)
//            | "DOF dd/mm/yyyy" (última reforma)
//            | <a href="pdf/<STEM>.pdf">, <a href="doc/<STEM>.doc">,
//              <a href="pdf_mov/<name>.pdf"> (mobile reprint — ignored)
// 2. There is NO htm/ full-text variant: `ref/<abbr>.htm` is only the reform
//    history table ("Años anteriores"), which is why the first implementation
//    stored history pages and extracted zero articles. The consolidated text
//    exists only as PDF (and an equivalent .doc), so the real articulado has to
//    come out of pdf/<STEM>.pdf.
// 3. PDF text is extracted with `unpdf` (pure-JS pdf.js build that runs in the
//    Worker runtime — no native binaries). Every page repeats a header/footer
//    banner, stripped in cleanPdfText().
// 4. Index pages are served as ISO-8859-1 with HTML entities, same as DOF.
//
// Access method is html_scrape (last resort per the connector priority rule)
// because no official machine-readable interface exists for this corpus.
//
// This is the only source that yields real articulado, so extractArticles()
// does the real work here and feeds the Artículos tile via the projection pass.


import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const BASE = "https://www.diputados.gob.mx/LeyesBiblio";
const INDEX_URL = `${BASE}/index.htm`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Federal statutes are large PDFs (CPEUM is ~1.5 MB / ~400 KB of text), so a
// run stays deliberately small and bounded — the corpus is ~320 laws and is
// meant to be backfilled across many runs, not in one request.
const MAX_LAWS_PER_RUN = 4;
const RUN_BUDGET_MS = 45_000;
const THROTTLE_MS = 300;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 400_000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Deadline = { at: number };
const newDeadline = (): Deadline => ({ at: Date.now() + RUN_BUDGET_MS });
const expired = (d: Deadline) => Date.now() >= d.at;

type LawRef = {
  /** compilation number as printed in the index, e.g. "001" */
  number: string;
  /** short abbreviation from ref/<abbr>.htm, e.g. "cpeum" */
  abbr?: string;
  title: string;
  /** consolidated text (PDF) — the only full-text format published */
  pdfUrl?: string;
  docUrl?: string;
  /** reform-history page (ref/<abbr>.htm) */
  refUrl?: string;
  publishedAt?: string; // ISO date of original publication
  lastReform?: string; // ISO date
};

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

/** diputados.gob.mx serves legacy ISO-8859-1 pages — decode explicitly. */
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
  if (!res.ok) throw new Error(`Congreso ${res.status} at ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(buf);
}

function absolute(href: string): string {
  if (/^https?:/i.test(href)) return href;
  return `${BASE}/${href.replace(/^\.?\//, "")}`;
}

/** "05/02/1917" → "1917-02-05" */
function parseDofDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/**
 * Parse the compilation index. Verified markup: one <tr> per law with cells
 * [No.] [title anchor to ref/<abbr>.htm + original DOF date] [última reforma]
 * [pdf / doc / pdf_mov links]. Parsing per row avoids the cross-row leakage
 * that previously mislabelled laws as "Años anteriores".
 */
export function parseIndex(html: string): LawRef[] {
  const rows = parseIndexRows(html);
  if (rows.length) return rows;
  return parseIndexLoose(html);
}

/** Strategy 1 — strict table rows (historical layout). */
function parseIndexRows(html: string): LawRef[] {
  const out: LawRef[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;

  while ((row = rowRe.exec(html)) !== null) {
    const cellsHtml = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]);
    if (cellsHtml.length < 2) continue;

    const numberText = htmlToText(cellsHtml[0]).trim();
    const number = /^\d{1,4}$/.test(numberText) ? numberText : "";

    const rowHtml = row[1];
    const pdf = /href=["']([^"']*pdf[^"']*\.pdf)["']/i.exec(rowHtml);
    if (!pdf) continue;
    const doc = /href=["']([^"']*\.docx?)["']/i.exec(rowHtml);
    const ref = /href=["']([^"']*ref\/([A-Za-z0-9_-]+)\.html?)["']/i.exec(rowHtml);

    const title = pickTitle(cellsHtml, rowHtml, pdf[1]);
    if (!title) continue;

    const dates = [...htmlToText(rowHtml).matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((d) => d[1]);

    out.push({
      number: number || String(out.length + 1),
      abbr: (ref?.[2] ?? stemOf(pdf[1])).toLowerCase(),
      title,
      refUrl: ref ? absolute(ref[1]) : undefined,
      pdfUrl: absolute(pdf[1]),
      docUrl: doc ? absolute(doc[1]) : undefined,
      publishedAt: parseDofDate(dates[0]),
      lastReform: parseDofDate(dates[dates.length - 1]),
    });
  }

  return out.filter((l) => l.pdfUrl);
}

/**
 * Strategy 2 — layout-agnostic fallback: scan every PDF link on the page and
 * take the nearest preceding anchor/plain text as the title. Survives the
 * table→div/list rewrites the Cámara periodically ships.
 */
function parseIndexLoose(html: string): LawRef[] {
  const out: LawRef[] = [];
  const seen = new Set<string>();
  const linkRe = /href=["']([^"']*\.pdf)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    if (/pdf_mov/i.test(href)) continue;
    const url = absolute(href);
    const stem = stemOf(href);
    if (!stem || seen.has(stem)) continue;

    // Look backwards for a human title: anchor text or table/list cell text.
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    const anchors = [...before.matchAll(/>([^<>]{12,220})</g)]
      .map((a) => htmlToText(a[1]).replace(/\s+/g, " ").trim())
      .filter((t) => /^(Ley|C[óo]digo|Constituci[óo]n|Estatuto|Reglamento|Decreto)\b/i.test(t));
    const title = anchors[anchors.length - 1];
    if (!title) continue;

    seen.add(stem);
    const dates = [...htmlToText(before.slice(-400)).matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((d) => d[1]);
    out.push({
      number: String(out.length + 1),
      abbr: stem.toLowerCase(),
      title,
      pdfUrl: url,
      publishedAt: parseDofDate(dates[0]),
      lastReform: parseDofDate(dates[dates.length - 1]),
    });
  }

  return out;
}

function stemOf(href: string): string {
  const base = href.split("/").pop() ?? "";
  return base.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9_-]/g, "");
}

function pickTitle(cellsHtml: string[], rowHtml: string, pdfHref: string): string | undefined {
  const anchorTitles = [...rowHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((a) => htmlToText(a[1]).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 8 && !/^\.?(pdf|doc|docx|word)$/i.test(t));
  if (anchorTitles.length) return anchorTitles[0];

  for (const cell of cellsHtml) {
    const t = htmlToText(cell).replace(/\s+/g, " ").trim();
    if (t.length > 12 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t) && !/^\d/.test(t)) return t;
  }
  return stemOf(pdfHref) || undefined;
}


/** Every PDF page repeats the Cámara de Diputados banner — strip it. */
function cleanPdfText(text: string): string {
  const banner =
    /^(C[ÁA]MARA DE DIPUTADOS.*|Secretar[íi]a General.*|Secretar[íi]a de Servicios Parlamentarios.*|[ÚU]ltima Reforma DOF.*|Nueva Ley (?:DOF|publicada).*|\d+\s+de\s+\d+)$/i;
  return text
    .split("\n")
    .map((l) => l.replace(/\u00a0/g, " ").trim())
    .filter((l) => l && !banner.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Consolidated text lives only as PDF. `unpdf` is a pure-JS pdf.js build, so it
 * runs inside the Worker runtime; imported lazily to keep it out of hot paths.
 */
async function fetchPdfText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/pdf", "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Congreso ${res.status} at ${url}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_PDF_BYTES) {
    throw new Error(`Congreso PDF too large (${buf.byteLength} bytes) at ${url}`);
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  const cleaned = cleanPdfText(Array.isArray(text) ? text.join("\n") : text);
  return cleaned.length > 500 ? cleaned.slice(0, MAX_TEXT_CHARS) : null;
}

async function fetchLawText(law: LawRef): Promise<{ text: string; sourceUrl: string } | null> {
  if (!law.pdfUrl) return null;
  try {
    const text = await fetchPdfText(law.pdfUrl);
    if (text) return { text, sourceUrl: law.pdfUrl };
  } catch (e) {
    console.warn(`[congreso] pdf text failed ${law.pdfUrl}: ${String(e)}`);
  }
  return null;
}


// NOTE: ref/<abbr>.htm is deliberately NOT used as a text fallback. It is the
// reform-history table, not the law, and storing it produced worthless
// "Años anteriores" documents with zero articulado.


function abbreviate(title: string): string | undefined {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(de|del|la|los|las|para|por|una|sobre)$/i.test(w));
  if (!words.length) return undefined;
  return words.map((w) => w[0].toUpperCase()).join("").slice(0, 12);
}

/** Stable key: the abbreviation, which survives index renumbering. */
const lawKey = (law: LawRef) => (law.abbr ?? law.number).toLowerCase();

function buildIngested(law: LawRef, text: string, sourceUrl: string): IngestedDocument {
  return {
    externalId: `congreso:${lawKey(law)}`,
    kind: "federal_statute",
    jurisdiction: "federal",
    title: law.title,
    shortTitle: law.abbr ? law.abbr.toUpperCase() : abbreviate(law.title),
    issuer: "Congreso de la Unión",
    citation: law.lastReform ? `${law.title} (última reforma DOF ${law.lastReform})` : law.title,
    publishedAt: law.publishedAt ?? law.lastReform,
    effectiveAt: law.lastReform ?? law.publishedAt,
    sourceUrl,
    rawText: text,
    metadata: {
      compilationNumber: law.number,
      abbr: law.abbr,
      lastReform: law.lastReform,
      pdfUrl: law.pdfUrl,
      docUrl: law.docUrl,
      reformHistoryUrl: law.refUrl,
      compilation: "LeyesBiblio",
    },
  };
}

async function loadIndex(): Promise<LawRef[]> {
  const html = await fetchHtml(INDEX_URL);
  if (!html) throw new Error("Congreso index not available (LeyesBiblio/index.htm returned 404)");
  const laws = parseIndex(html);
  if (!laws.length) throw new Error("Congreso index parsed but contained no law links — page layout changed");
  return laws;
}

/** Newest reforms first so incremental runs surface what actually changed. */
function orderForRun(laws: LawRef[], since: Date | null): LawRef[] {
  const filtered = since
    ? laws.filter((l) => !l.lastReform || new Date(l.lastReform) >= since)
    : laws;
  const pool = filtered.length ? filtered : laws;
  return [...pool].sort((a, b) => (b.lastReform ?? "").localeCompare(a.lastReform ?? ""));
}

async function collect(laws: LawRef[]): Promise<IngestedDocument[]> {
  const deadline = newDeadline();
  const out: IngestedDocument[] = [];
  for (const law of laws) {
    if (expired(deadline) || out.length >= MAX_LAWS_PER_RUN) break;
    try {
      await sleep(THROTTLE_MS);
      const found = await fetchLawText(law);
      if (found) out.push(buildIngested(law, found.text, found.sourceUrl));
    } catch (e) {
      console.warn(`[congreso] skip law ${law.number}: ${String(e)}`);
    }
  }
  return out;
}

const ARTICLE_RE =
  /^\s*(?:ART[ÍI]CULO|Art[íi]culo|ARTICULO)\s+([0-9]+(?:\s*(?:o\.?|º|°|Bis|BIS|Ter|TER|Qu[áa]ter|QU[ÁA]TER|[A-D]))*)\s*[.\-–—:]?\s*(.*)$/;

export const congresoConnector: LegalSourceConnector = {
  code: "congreso",
  displayName: "Congreso de la Unión",
  kind: "federal_statute",
  accessMethod: "html_scrape",
  auth: { kind: "none" },

  async discover() {
    const laws = await loadIndex();
    return laws.map((l) => ({
      externalId: `congreso:${lawKey(l)}`,
      sourceUrl: l.pdfUrl ?? l.refUrl ?? INDEX_URL,
      publishedAt: l.lastReform ?? l.publishedAt,
    }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    const laws = await loadIndex();
    return collect(orderForRun(laws, since));
  },

  async fetchDocument(externalId) {
    const key = externalId.replace(/^congreso:/, "").toLowerCase();
    const laws = await loadIndex();
    const law = laws.find((l) => lawKey(l) === key || l.number === key);
    if (!law) throw new Error(`Congreso law not found in compilation index: ${externalId}`);
    const found = await fetchLawText(law);
    if (!found) throw new Error(`Congreso law ${externalId} has no extractable consolidated text`);
    return buildIngested(law, found.text, found.sourceUrl);
  },


  async extractMetadata(doc) {
    return {
      issuer: doc.issuer,
      publishedAt: doc.publishedAt,
      effectiveAt: doc.effectiveAt,
      citation: doc.citation,
    };
  },

  /** Real articulado extraction — this is the corpus that fills the Artículos tile. */
  async extractArticles(doc): Promise<ExtractedArticle[]> {
    // PDF extraction often glues an article heading onto the previous
    // paragraph, so force a line break before every "Artículo N" marker.
    const lines = doc.rawText
      .replace(/([^\n])\s+(?=(?:ART[ÍI]CULO|Art[íi]culo|ARTICULO)\s+\d)/g, "$1\n")
      .replace(/([^\n])\s+(?=(?:T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N|LIBRO)\s+[IVXLCDM]+\b)/g, "$1\n")
      .split("\n");
    const articles: ExtractedArticle[] = [];
    let current: ExtractedArticle | null = null;
    let heading: string | undefined;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^(T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N|LIBRO)\b/i.test(line)) {
        heading = line;
        continue;
      }
      const m = ARTICLE_RE.exec(line);
      if (m) {
        if (current && current.text.trim()) articles.push(current);
        current = {
          articleNumber: m[1].replace(/\s+/g, " ").trim(),
          heading,
          text: (m[2] ?? "").trim(),
        };
        continue;
      }
      if (current) current.text += (current.text ? "\n" : "") + line;
    }
    if (current && current.text.trim()) articles.push(current);

    // Deduplicate transitorio renumbering: keep the first occurrence.
    const seen = new Set<string>();
    return articles.filter((a) => {
      if (seen.has(a.articleNumber)) return false;
      seen.add(a.articleNumber);
      return a.text.length > 10;
    });
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
    if (!doc.rawText || doc.rawText.length < 200) errors.push("rawText too short (<200 chars)");
    return { valid: errors.length === 0, errors };
  },

  async healthCheck(): Promise<ConnectorHealth> {
    try {
      const res = await fetch(INDEX_URL, {
        headers: { Accept: "text/html", "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(20_000),
      });
      return {
        connectorCode: "congreso",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return { connectorCode: "congreso", ok: false, checkedAt: new Date().toISOString(), detail: String(e) };
    }
  },
};
