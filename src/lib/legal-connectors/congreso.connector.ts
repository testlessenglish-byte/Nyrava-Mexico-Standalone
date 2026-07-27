// Congreso de la Unión connector — Cámara de Diputados "Leyes Federales
// Vigentes" compilation (LeyesBiblio). Endpoint audit 2026-07.
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// 1. There is no API, JSON feed or RSS for the federal statute corpus. The
//    canonical machine-reachable surface is the compilation index:
//      GET https://www.diputados.gob.mx/LeyesBiblio/index.htm
//        → HTML table of every vigente federal law. Each row links to the
//          same law in several formats:
//            ref/<abbr>.htm   → reform history (fecha de última reforma)
//            pdf/<stem>.pdf   → official consolidated text (PDF)
//            doc/<stem>.doc   → same text as DOC
//            htm/<stem>.htm   → same text as HTML (when published)
//          where <stem> is the law's compilation number, optionally suffixed
//          with the last-reform date (e.g. "1_240124").
// 2. Only the .htm variant is parseable inside the Worker runtime (no PDF
//    binaries there), so we prefer htm/, and derive htm/<number>.htm from the
//    pdf stem when the index doesn't link the HTML form directly.
// 3. Pages are served as ISO-8859-1 with HTML entities, same as DOF.
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

// Federal statutes are large documents (CPEUM alone is ~400 KB of text), so a
// run stays deliberately small and bounded — the corpus is ~320 laws and is
// meant to be backfilled across many runs, not in one request.
const MAX_LAWS_PER_RUN = 8;
const RUN_BUDGET_MS = 45_000;
const THROTTLE_MS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 400_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Deadline = { at: number };
const newDeadline = (): Deadline => ({ at: Date.now() + RUN_BUDGET_MS });
const expired = (d: Deadline) => Date.now() >= d.at;

type LawRef = {
  /** compilation stem, e.g. "1" or "125" */
  number: string;
  /** short abbreviation from ref/<abbr>.htm when present, e.g. "cpeum" */
  abbr?: string;
  title: string;
  /** best available text URL (htm preferred) */
  htmUrl?: string;
  pdfUrl?: string;
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

/** "1_240124" → { number: "1", reform: "2024-01-24" } */
function parseStem(stem: string): { number: string; lastReform?: string } {
  const m = /^(\d+)(?:_(\d{6}))?/.exec(stem);
  if (!m) return { number: stem };
  let lastReform: string | undefined;
  if (m[2]) {
    const yy = Number(m[2].slice(0, 2));
    const mm = m[2].slice(2, 4);
    const dd = m[2].slice(4, 6);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    lastReform = `${year}-${mm}-${dd}`;
  }
  return { number: m[1], lastReform };
}

/**
 * Parse the compilation index into one LawRef per statute. The index groups
 * each law's format links together, so we key by compilation number and merge
 * whichever links appear, then recover the title from the surrounding row text.
 */
function parseIndex(html: string): LawRef[] {
  const byNumber = new Map<string, LawRef>();
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let pendingTitle = "";

  while ((m = anchor.exec(html)) !== null) {
    const href = m[1];
    const label = htmlToText(m[2]).trim();
    const ref = /(?:^|\/)ref\/([a-z0-9_]+)\.html?/i.exec(href);
    const pdf = /(?:^|\/)pdf\/([\w.]+?)\.pdf/i.exec(href);
    const htm = /(?:^|\/)htm\/([\w.]+?)\.html?/i.exec(href);
    const doc = /(?:^|\/)doc\/([\w.]+?)\.docx?/i.exec(href);

    if (!ref && !pdf && !htm && !doc) {
      if (label.length > 8) pendingTitle = label;
      continue;
    }

    const stem = (pdf?.[1] ?? htm?.[1] ?? doc?.[1] ?? "").trim();
    const { number, lastReform } = stem ? parseStem(stem) : { number: "", lastReform: undefined };

    // ref/ links carry the abbreviation but not the number; attach them to the
    // most recently seen numbered entry from the same row.
    if (ref && !number) {
      const last = [...byNumber.values()].pop();
      if (last && !last.abbr) last.abbr = ref[1].toLowerCase();
      continue;
    }
    if (!number) continue;

    const existing = byNumber.get(number) ?? { number, title: "" };
    if (pdf) existing.pdfUrl = absolute(href);
    if (htm) existing.htmUrl = absolute(href);
    if (lastReform) existing.lastReform = lastReform;
    if (!existing.title) {
      existing.title = /ley|c[óo]digo|constituci[óo]n|estatuto|reglamento/i.test(label)
        ? label
        : pendingTitle;
    }
    byNumber.set(number, existing);
  }

  return [...byNumber.values()]
    .filter((l) => l.htmUrl || l.pdfUrl)
    .map((l) => ({ ...l, title: l.title || `Ley federal ${l.number}` }));
}

/** htm/<number>.htm is published for most laws even when the index links only the PDF. */
function candidateTextUrls(law: LawRef): string[] {
  const urls: string[] = [];
  if (law.htmUrl) urls.push(law.htmUrl);
  urls.push(`${BASE}/htm/${law.number}.htm`);
  if (law.pdfUrl) {
    const stem = law.pdfUrl.split("/").pop()?.replace(/\.pdf$/i, "");
    if (stem) urls.push(`${BASE}/htm/${stem}.htm`);
  }
  return [...new Set(urls)];
}

async function fetchLawText(law: LawRef): Promise<{ text: string; sourceUrl: string } | null> {
  for (const url of candidateTextUrls(law)) {
    try {
      const html = await fetchHtml(url);
      if (!html) continue;
      const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
      if (text.length > 500) return { text, sourceUrl: url };
    } catch (e) {
      console.warn(`[congreso] text fetch failed ${url}: ${String(e)}`);
    }
  }
  return null;
}

/** Reform history page — used as fallback content when only a PDF exists. */
async function fetchReformHistory(law: LawRef): Promise<string | null> {
  if (!law.abbr) return null;
  try {
    const html = await fetchHtml(`${BASE}/ref/${law.abbr}.htm`);
    return html ? htmlToText(html).slice(0, MAX_TEXT_CHARS) : null;
  } catch {
    return null;
  }
}

function abbreviate(title: string): string | undefined {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(de|del|la|los|las|para|por|una|sobre)$/i.test(w));
  if (!words.length) return undefined;
  return words.map((w) => w[0].toUpperCase()).join("").slice(0, 12);
}

function buildIngested(law: LawRef, text: string, sourceUrl: string): IngestedDocument {
  return {
    externalId: `congreso:${law.number}`,
    kind: "federal_statute",
    jurisdiction: "federal",
    title: law.title,
    shortTitle: law.abbr ? law.abbr.toUpperCase() : abbreviate(law.title),
    issuer: "Congreso de la Unión",
    citation: law.lastReform ? `${law.title} (última reforma DOF ${law.lastReform})` : law.title,
    publishedAt: law.lastReform,
    effectiveAt: law.lastReform,
    sourceUrl,
    rawText: text,
    metadata: {
      compilationNumber: law.number,
      abbr: law.abbr,
      lastReform: law.lastReform,
      pdfUrl: law.pdfUrl,
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
      if (found) {
        out.push(buildIngested(law, found.text, found.sourceUrl));
        continue;
      }
      const history = await fetchReformHistory(law);
      if (history) {
        out.push(buildIngested(law, history, `${BASE}/ref/${law.abbr}.htm`));
      }
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
      externalId: `congreso:${l.number}`,
      sourceUrl: l.htmUrl ?? l.pdfUrl ?? `${BASE}/htm/${l.number}.htm`,
      publishedAt: l.lastReform,
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
    const number = externalId.replace(/^congreso:/, "");
    const laws = await loadIndex();
    const law = laws.find((l) => l.number === number);
    if (!law) throw new Error(`Congreso law not found in compilation index: ${externalId}`);
    const found = (await fetchLawText(law)) ??
      (await fetchReformHistory(law).then((t) =>
        t ? { text: t, sourceUrl: `${BASE}/ref/${law.abbr}.htm` } : null,
      ));
    if (!found) throw new Error(`Congreso law ${externalId} has no HTML text published`);
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
    const lines = doc.rawText.split("\n");
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
