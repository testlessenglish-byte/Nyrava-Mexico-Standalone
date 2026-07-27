// Legislación Estatal — Orden Jurídico Nacional (SEGOB). Endpoint audit
// 2026-07, verified against the live site.
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// The 32 state gazettes have 32 incompatible sites (and several sit behind
// WAFs that reject server-side fetches). SEGOB's Orden Jurídico Nacional is
// the single official aggregator that republishes the consolidated text of
// every state's ordenamientos, so it is used as the state-law surface here.
//
// 1. State index (per state, per document type):
//      GET /despliegaedo2.php?edo=<1..32>&catTipo=<tipoId>&ordenar=
//    Rows are anchors of the form
//      fichaOrdenamiento.php?idArchivo=<id>&ambito=estatal">TITLE</a>
//    Type ids are a global catalog; the three that matter for legal work are
//      2 = Constitución Política del Estado, 5 = Código, 4 = Ley.
// 2. Technical sheet: GET /fichaOrdenamiento.php?idArchivo=<id>&ambito=estatal
//    carries "Fecha de Publicación", "Estatus", "Tipo" and one download link
//    under /Documentos/Estatal/<state>/<file>.
// 3. The download is served under a .doc/.docx/.pdf name but the real payload
//    is one of THREE formats (checked by magic bytes, not by extension):
//      D0CF11E0  legacy Word 97 (CFB)   → printable-run extraction
//      504B0304  ZIP = real .docx       → word/document.xml via DecompressionStream
//      "<"/PDF   HTML or PDF            → tag strip / unpdf
//    Paths contain spaces and legacy accents, so URLs must be encodeURI'd.
// 4. Pages are ISO-8859-1 with HTML entities, same as DOF/Congreso.
//
// Access method is html_scrape (last resort per the connector priority rule):
// the aggregator publishes no API, JSON or RSS.
//
// Runs are deliberately small and incremental: `alreadyIngested` drives a
// skip-list so repeated runs walk the corpus state by state instead of
// re-fetching the same documents.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const BASE = "https://www.ordenjuridico.gob.mx";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_DOCS_PER_RUN = 8;
const RUN_BUDGET_MS = 60_000;
const THROTTLE_MS = 250;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_TEXT_CHARS = 400_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** edo id in Orden Jurídico ↔ app jurisdiction code (JURISDICTION_OPTIONS). */
const STATES: { edo: number; code: string; name: string }[] = [
  { edo: 1, code: "AGU", name: "Aguascalientes" },
  { edo: 2, code: "BCN", name: "Baja California" },
  { edo: 3, code: "BCS", name: "Baja California Sur" },
  { edo: 4, code: "CAM", name: "Campeche" },
  { edo: 5, code: "COA", name: "Coahuila de Zaragoza" },
  { edo: 6, code: "COL", name: "Colima" },
  { edo: 7, code: "CHP", name: "Chiapas" },
  { edo: 8, code: "CHH", name: "Chihuahua" },
  { edo: 9, code: "CMX", name: "Ciudad de México" },
  { edo: 10, code: "DUR", name: "Durango" },
  { edo: 11, code: "GUA", name: "Guanajuato" },
  { edo: 12, code: "GRO", name: "Guerrero" },
  { edo: 13, code: "HID", name: "Hidalgo" },
  { edo: 14, code: "JAL", name: "Jalisco" },
  { edo: 15, code: "MEX", name: "Estado de México" },
  { edo: 16, code: "MIC", name: "Michoacán" },
  { edo: 17, code: "MOR", name: "Morelos" },
  { edo: 18, code: "NAY", name: "Nayarit" },
  { edo: 19, code: "NLE", name: "Nuevo León" },
  { edo: 20, code: "OAX", name: "Oaxaca" },
  { edo: 21, code: "PUE", name: "Puebla" },
  { edo: 22, code: "QUE", name: "Querétaro" },
  { edo: 23, code: "ROO", name: "Quintana Roo" },
  { edo: 24, code: "SLP", name: "San Luis Potosí" },
  { edo: 25, code: "SIN", name: "Sinaloa" },
  { edo: 26, code: "SON", name: "Sonora" },
  { edo: 27, code: "TAB", name: "Tabasco" },
  { edo: 28, code: "TAM", name: "Tamaulipas" },
  { edo: 29, code: "TLA", name: "Tlaxcala" },
  { edo: 30, code: "VER", name: "Veracruz" },
  { edo: 31, code: "YUC", name: "Yucatán" },
  { edo: 32, code: "ZAC", name: "Zacatecas" },
];

/** Only the ordenamientos an attorney actually litigates against. */
const TYPES: { id: number; label: string }[] = [
  { id: 2, label: "Constitución Política del Estado" },
  { id: 5, label: "Código" },
  { id: 4, label: "Ley" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Deadline = { at: number };
const newDeadline = (): Deadline => ({ at: Date.now() + RUN_BUDGET_MS });
const expired = (d: Deadline) => Date.now() >= d.at;

type StateDocRef = {
  idArchivo: string;
  title: string;
  typeLabel: string;
  state: { code: string; name: string; edo: number };
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
  if (!res.ok) throw new Error(`OJN ${res.status} at ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(buf);
}

function listingUrl(edo: number, tipo: number): string {
  return `${BASE}/despliegaedo2.php?edo=${edo}&catTipo=${tipo}&ordenar=`;
}

/** Rows are anchors carrying idArchivo + the printed title. */
function parseListing(html: string, state: StateDocRef["state"], typeLabel: string): StateDocRef[] {
  const out: StateDocRef[] = [];
  const seen = new Set<string>();
  const re = /idArchivo=(\d+)&(?:amp;)?ambito=estatal[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const idArchivo = m[1];
    if (seen.has(idArchivo)) continue;
    const title = htmlToText(m[2]).replace(/\s+/g, " ").trim();
    if (!title || title.length < 8) continue;
    seen.add(idArchivo);
    out.push({ idArchivo, title, typeLabel, state });
  }
  return out;
}

const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** "26 de Mayo de 1928" → "1928-05-26" */
function parseSpanishDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})/.exec(s);
  if (!m) return undefined;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${String(m[1]).padStart(2, "0")}` : undefined;
}

type Ficha = { fileUrl: string; publishedAt?: string; status?: string; typeLabel?: string };

function fieldAfter(text: string, label: string): string | undefined {
  const i = text.indexOf(label);
  if (i < 0) return undefined;
  return text.slice(i + label.length, i + label.length + 120).split("\n")[0]?.trim();
}

async function fetchFicha(idArchivo: string): Promise<Ficha | null> {
  const url = `${BASE}/fichaOrdenamiento.php?idArchivo=${idArchivo}&ambito=estatal`;
  const html = await fetchHtml(url);
  if (!html) return null;
  const links = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => decodeEntities(m[1]));
  const fileUrl = links.find((l) => /\/Documentos\/|\/Estatal\//i.test(l));
  if (!fileUrl) return null;
  const text = htmlToText(html);
  return {
    fileUrl: fileUrl.replace(/^http:/i, "https:").replace(/\/\.\//g, "/"),
    publishedAt: parseSpanishDate(fieldAfter(text, "Fecha de Publicación:")),
    status: fieldAfter(text, "Estatus:"),
    typeLabel: fieldAfter(text, "Tipo:"),
  };
}

// ── Payload decoding: format detected by magic bytes, never by extension ────

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | b[o + 3] * 16777216) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal ZIP reader — pulls word/document.xml out of a real .docx. */
async function docxToText(b: Uint8Array): Promise<string> {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 70_000; i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("docx: end-of-central-directory not found");
  let off = u32(b, eocd + 16);
  const entries = u16(b, eocd + 10);
  for (let k = 0; k < entries; k++) {
    if (u32(b, off) !== 0x02014b50) throw new Error("docx: bad central directory");
    const method = u16(b, off + 10);
    const csize = u32(b, off + 20);
    const nlen = u16(b, off + 28);
    const elen = u16(b, off + 30);
    const clen = u16(b, off + 32);
    const lho = u32(b, off + 42);
    const name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nlen));
    if (name === "word/document.xml") {
      const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
      const data = b.subarray(start, start + csize);
      const raw = method === 0 ? data : await inflateRaw(data);
      const xml = new TextDecoder().decode(raw);
      return htmlToText(xml.replace(/<\/w:p>/g, "</p>"));
    }
    off += 46 + nlen + elen + clen;
  }
  throw new Error("docx: word/document.xml missing");
}

/**
 * Legacy Word 97 (CFB). Full FIB/piece-table parsing is not worth it for a
 * scrape: the document body is stored as CP1252 runs, so printable-run
 * extraction recovers the articulado cleanly (spot-checked against the
 * Código Civil CDMX, 1 MB of text, articles intact).
 */
function legacyDocToText(b: Uint8Array): string {
  const decoded = new TextDecoder("windows-1252").decode(b);
  const runs = decoded.match(/[\x20-\x7e\u00a1-\u00ff\n\r\t]{40,}/g) ?? [];
  return runs
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pdfToText(b: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(b);
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchDocumentText(fileUrl: string): Promise<string | null> {
  const res = await fetch(encodeURI(fileUrl), {
    headers: { Accept: "*/*", "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OJN ${res.status} at ${fileUrl}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new Error(`OJN file too large (${buf.byteLength} bytes) at ${fileUrl}`);
  }
  const b = new Uint8Array(buf);
  let text: string;
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    text = legacyDocToText(b);
  } else if (b[0] === 0x50 && b[1] === 0x4b) {
    text = await docxToText(b);
  } else if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    text = await pdfToText(b);
  } else {
    text = htmlToText(new TextDecoder("iso-8859-1").decode(buf));
  }
  return text.length > 500 ? text.slice(0, MAX_TEXT_CHARS) : null;
}

// ── Run planning ────────────────────────────────────────────────────────────

const externalIdOf = (ref: StateDocRef) => `ojn:${ref.idArchivo}`;

/**
 * Priority: constituciones, then códigos, then leyes, walking states in order
 * and skipping everything already stored. That way early runs build the
 * highest-value state corpus (Constitución + Código Civil/Penal/Procedimientos)
 * before drifting into administrative leyes.
 */
async function planRun(known: Set<string> | undefined, deadline: Deadline): Promise<StateDocRef[]> {
  const picked: StateDocRef[] = [];
  const diagnostics: string[] = [];
  let listings = 0;

  for (const type of TYPES) {
    for (const state of STATES) {
      if (picked.length >= MAX_DOCS_PER_RUN || expired(deadline)) return picked;
      let html: string | null = null;
      try {
        html = await fetchHtml(listingUrl(state.edo, type.id));
      } catch (e) {
        diagnostics.push(`${state.code}/${type.label}: ${String(e)}`);
        continue;
      }
      if (!html) continue;
      listings++;
      const refs = parseListing(html, state, type.label);
      for (const ref of refs) {
        if (known?.has(externalIdOf(ref))) continue;
        picked.push(ref);
        if (picked.length >= MAX_DOCS_PER_RUN) return picked;
      }
      await sleep(THROTTLE_MS);
    }
  }

  if (!picked.length && !listings) {
    throw new Error(
      `Orden Jurídico state listings unreachable — ${diagnostics.slice(0, 3).join(" | ") || "no rows parsed"}`,
    );
  }
  return picked;
}

function buildIngested(ref: StateDocRef, ficha: Ficha, text: string): IngestedDocument {
  return {
    externalId: externalIdOf(ref),
    kind: "state_statute",
    jurisdiction: ref.state.code,
    title: ref.title,
    shortTitle: ref.title.slice(0, 120),
    issuer: `Estado: ${ref.state.name}`,
    citation: `${ref.title} (${ref.state.name})`,
    publishedAt: ficha.publishedAt,
    effectiveAt: ficha.publishedAt,
    sourceUrl: `${BASE}/fichaOrdenamiento.php?idArchivo=${ref.idArchivo}&ambito=estatal`,
    rawText: text,
    metadata: {
      idArchivo: ref.idArchivo,
      stateCode: ref.state.code,
      stateName: ref.state.name,
      documentType: ficha.typeLabel ?? ref.typeLabel,
      status: ficha.status,
      fileUrl: ficha.fileUrl,
      aggregator: "Orden Jurídico Nacional (SEGOB)",
    },
  };
}

async function collect(refs: StateDocRef[], deadline: Deadline): Promise<IngestedDocument[]> {
  const out: IngestedDocument[] = [];
  for (const ref of refs) {
    if (expired(deadline) || out.length >= MAX_DOCS_PER_RUN) break;
    try {
      await sleep(THROTTLE_MS);
      const ficha = await fetchFicha(ref.idArchivo);
      if (!ficha) continue;
      const text = await fetchDocumentText(ficha.fileUrl);
      if (!text) continue;
      out.push(buildIngested(ref, ficha, text));
    } catch (e) {
      console.warn(`[state_gazettes] skip ${ref.idArchivo}: ${String(e)}`);
    }
  }
  return out;
}

const ARTICLE_RE =
  /^\s*(?:ART[ÍI]CULO|Art[íi]culo|ARTICULO)\s+([0-9]+(?:\s*(?:o\.?|º|°|Bis|BIS|Ter|TER|Qu[áa]ter|QU[ÁA]TER|[A-D]))*)\s*[.\-–—:]?\s*(.*)$/;

export const stateGazettesConnector: LegalSourceConnector = {
  code: "state_gazettes",
  displayName: "Legislación Estatal (Orden Jurídico Nacional)",
  kind: "state_statute",
  accessMethod: "html_scrape",
  auth: { kind: "none" },

  async discover() {
    const deadline = newDeadline();
    const refs = await planRun(undefined, deadline);
    return refs.map((r) => ({
      externalId: externalIdOf(r),
      sourceUrl: `${BASE}/fichaOrdenamiento.php?idArchivo=${r.idArchivo}&ambito=estatal`,
    }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(_since) {
    const deadline = newDeadline();
    const refs = await planRun(this.alreadyIngested, deadline);
    return collect(refs, deadline);
  },

  async fetchDocument(externalId) {
    const idArchivo = externalId.replace(/^ojn:/, "");
    const ficha = await fetchFicha(idArchivo);
    if (!ficha) throw new Error(`Orden Jurídico ficha not found: ${externalId}`);
    const text = await fetchDocumentText(ficha.fileUrl);
    if (!text) throw new Error(`Orden Jurídico document has no extractable text: ${externalId}`);
    const ref: StateDocRef = {
      idArchivo,
      title: ficha.typeLabel ? `${ficha.typeLabel} (${idArchivo})` : `Ordenamiento estatal ${idArchivo}`,
      typeLabel: ficha.typeLabel ?? "Ordenamiento",
      state: { code: "federal", name: "Estatal", edo: 0 },
    };
    return buildIngested(ref, ficha, text);
  },

  async extractMetadata(doc) {
    return {
      issuer: doc.issuer,
      publishedAt: doc.publishedAt,
      effectiveAt: doc.effectiveAt,
      citation: doc.citation,
    };
  },

  /** State códigos/leyes carry real articulado — this feeds the Artículos tile. */
  async extractArticles(doc): Promise<ExtractedArticle[]> {
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
        current = { articleNumber: m[1].replace(/\s+/g, " ").trim(), heading, text: (m[2] ?? "").trim() };
        continue;
      }
      if (current) current.text += (current.text ? "\n" : "") + line;
    }
    if (current && current.text.trim()) articles.push(current);

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
      const res = await fetch(`${BASE}/ambest.php`, {
        headers: { Accept: "text/html", "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(20_000),
      });
      return {
        connectorCode: "state_gazettes",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        connectorCode: "state_gazettes",
        ok: false,
        checkedAt: new Date().toISOString(),
        detail: String(e),
      };
    }
  },
};
