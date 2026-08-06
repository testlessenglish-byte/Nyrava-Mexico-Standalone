// =============================================================================
// DETERMINISTIC EVIDENCE FACT EXTRACTION (NYRAVA México)
//
// Extracts comparable facts from the VERBATIM quotes already stored in each
// finding's evidence_refs. No model calls, no interpretation: every fact is a
// literal span of a document quote, normalized so it can be compared against
// the same fact asserted by another document.
//
// Fact kinds:
//   · date          — fechas (dd/mm/aaaa, "3 de marzo de 2026", aaaa-mm-dd)
//   · amount        — cantidades monetarias, normalizadas a número
//   · party         — personas morales / personas físicas con título
//   · identifier    — expediente, folio, oficio, CFDI, RFC, CURP, UUID
//   · location      — entidades federativas (lista cerrada)
//   · act           — HECHOS JURÍDICOS: obligación creada / cumplida, pago
//                     reconocido, contrato celebrado, notificación, posesión
//                     entregada, dictamen pericial, plazo procesal, registro
//
// Everything here is pure and reproducible: the same quotes always produce the
// same facts, in the same order, with the same wording downstream.
// =============================================================================

export type FactKind = "date" | "amount" | "party" | "identifier" | "location" | "act";

export type ExtractedFact = {
  kind: FactKind;
  /** Canonical comparison key (ISO date, numeric amount, upper-cased id…). */
  key: string;
  /** Human display value in Spanish. */
  display: string;
  /** The literal span as it appears in the quote. */
  raw: string;
  /** Numeric value for amounts, epoch-day for dates; undefined otherwise. */
  numeric?: number;
  /** Act key for kind === "act". */
  act?: ActKey;
};

export function normalizeText(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ------------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 1900 || y > 2200) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTH_NAMES[m - 1]} de ${y}`;
}

function epochDay(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
}

function extractDates(raw: string): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const push = (iso: string | null, span: string) => {
    if (!iso) return;
    out.push({
      kind: "date",
      key: iso,
      display: displayDate(iso),
      raw: span.trim(),
      numeric: epochDay(iso),
    });
  };

  // aaaa-mm-dd
  for (const m of raw.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    push(isoDate(Number(m[1]), Number(m[2]), Number(m[3])), m[0]);
  }
  // dd/mm/aaaa · dd-mm-aa · dd.mm.aaaa  (Mexican order is day-first)
  for (const m of raw.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g)) {
    let y = Number(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    push(isoDate(y, Number(m[2]), Number(m[1])), m[0]);
  }
  // "3 de marzo de 2026"
  for (const m of raw.matchAll(/\b(\d{1,2})\s+de\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\s+de\s+(\d{4})\b/g)) {
    const month = MONTHS[normalizeText(m[2])];
    if (month) push(isoDate(Number(m[3]), month, Number(m[1])), m[0]);
  }
  return out;
}

// ----------------------------------------------------------------- amounts

function parseAmount(s: string): number | null {
  const cleaned = s.replace(/\s/g, "");
  // Mexican formatting: 1,234,567.89 — commas group thousands.
  if (!/^\d[\d,.]*$/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  const decimalsAfterComma = lastComma >= 0 ? cleaned.length - lastComma - 1 : -1;
  if (lastComma > lastDot && decimalsAfterComma === 2) {
    // European style 1.234,56 — a comma is only a decimal separator when it is
    // followed by exactly two digits; "10,000" is ten thousand, not ten.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatAmount(n: number, currency: string): string {
  const fixed = n.toLocaleString("es-MX", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currency} $${fixed}`;
}

function extractAmounts(raw: string): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  const push = (numStr: string, currency: string, span: string) => {
    const n = parseAmount(numStr);
    if (n === null || n <= 0) return;
    const key = `${currency}:${n.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      kind: "amount",
      key,
      display: formatAmount(n, currency),
      raw: span.trim(),
      numeric: n,
    });
  };

  for (const m of raw.matchAll(
    /(?:\$|MXN|M\.?N\.?|USD)\s*([\d][\d,. ]*\d|\d)(?:\s*(MXN|M\.?N\.?|USD|pesos))?/gi,
  )) {
    const tail = normalizeText(m[2] ?? "");
    const head = normalizeText(m[0]);
    const currency = /usd|dolar/.test(tail) || /usd/.test(head) ? "USD" : "MXN";
    push(m[1], currency, m[0]);
  }
  for (const m of raw.matchAll(/\b([\d][\d,. ]*\d)\s*(?:pesos|MXN|M\.?N\.?)\b/gi)) {
    push(m[1], "MXN", m[0]);
  }
  return out;
}

// ------------------------------------------------------------- identifiers

function extractIdentifiers(raw: string): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  const push = (kindLabel: string, value: string, span: string) => {
    const key = `${kindLabel}:${value.toUpperCase()}`;
    if (seen.has(key) || value.length < 3) return;
    seen.add(key);
    out.push({
      kind: "identifier",
      key,
      display: `${kindLabel} ${value.toUpperCase()}`,
      raw: span.trim(),
    });
  };

  for (const m of raw.matchAll(
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  )) {
    push("UUID fiscal", m[0], m[0]);
  }
  for (const m of raw.matchAll(/\b[A-ZÑ&]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}\b/g)) {
    push("CURP", m[0], m[0]);
  }
  for (const m of raw.matchAll(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g)) {
    push("RFC", m[0], m[0]);
  }
  const labeled =
    /\b(expediente|folio(?:\s+real)?|oficio|CFDI|factura|contrato|escritura|p[oó]liza|recibo|toca|amparo|juicio|cr[eé]dito|cuenta)\b\s*(?:n[uú]m(?:ero)?\.?|no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{2,24})/gi;
  for (const m of raw.matchAll(labeled)) {
    const label = m[1].toLowerCase();
    const value = m[2].replace(/[.,;:]$/, "");
    if (/^(de|del|la|el|los|las|que|con|por|se|su|en)$/i.test(value)) continue;
    if (!/\d/.test(value)) continue;
    push(label.charAt(0).toUpperCase() + label.slice(1), value, m[0]);
  }
  return out;
}

// ----------------------------------------------------------------- parties

const CORP_SUFFIX =
  /\b(S\.?\s?A\.?\s?(?:de\s?C\.?\s?V\.?|P\.?\s?I\.?\s?de\s?C\.?\s?V\.?)?|S\.?\s?de\s?R\.?\s?L\.?(?:\s?de\s?C\.?\s?V\.?)?|S\.?\s?C\.?|A\.?\s?C\.?|S\.?\s?A\.?\s?B\.?)\b/;

function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[,.;:]$/, "").trim();
}

function extractParties(raw: string): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  const push = (name: string, span: string) => {
    const value = cleanName(name);
    if (value.length < 4) return;
    const key = normalizeText(value).replace(/[^a-z0-9 ]/g, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ kind: "party", key, display: value, raw: span.trim() });
  };

  // Personas morales: capitalised run followed by a corporate suffix.
  const corp = new RegExp(
    `\\b([A-ZÁÉÍÓÚÑ][\\wÁÉÍÓÚÑáéíóúñ&'’-]*(?:\\s+[A-ZÁÉÍÓÚÑ0-9][\\wÁÉÍÓÚÑáéíóúñ&'’-]*){0,5})[,\\s]+(${CORP_SUFFIX.source.slice(2, -2)})`,
    "g",
  );
  for (const m of raw.matchAll(corp)) push(`${m[1]}, ${m[2]}`, m[0]);

  // Personas físicas: only when preceded by an explicit title or procedural role.
  const person =
    /\b(?:C\.|Lic\.|Ing\.|Dr\.|Arq\.|se[nñ]or(?:a)?|actor|actora|demandad[oa]|quejos[oa]|imputad[oa]|perito|testigo|apoderad[oa])\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/g;
  for (const m of raw.matchAll(person)) push(m[1], m[0]);

  return out;
}

// --------------------------------------------------------------- locations

const MX_PLACES = [
  "Ciudad de México",
  "Estado de México",
  "Nuevo León",
  "Jalisco",
  "Quintana Roo",
  "Baja California Sur",
  "Baja California",
  "San Luis Potosí",
  "Aguascalientes",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Coahuila",
  "Colima",
  "Durango",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
  "Guadalajara",
  "Monterrey",
  "Cancún",
  "Mérida",
  "Tijuana",
  "Puebla de Zaragoza",
];

function extractLocations(raw: string): ExtractedFact[] {
  const hay = normalizeText(raw);
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  for (const place of MX_PLACES) {
    const key = normalizeText(place);
    if (seen.has(key)) continue;
    if (hay.includes(key)) {
      seen.add(key);
      out.push({ kind: "location", key, display: place, raw: place });
    }
  }
  return out;
}

// ------------------------------------------------------------- legal acts

export type ActKey =
  | "obligacion_creada"
  | "obligacion_cumplida"
  | "pago_reconocido"
  | "contrato_celebrado"
  | "notificacion_realizada"
  | "autoridad_notificada"
  | "posesion_entregada"
  | "dictamen_rendido"
  | "plazo_procesal"
  | "registro_inscrito"
  | "incumplimiento_alegado";

export const ACT_LABELS: Record<ActKey, string> = {
  obligacion_creada: "creación de una obligación",
  obligacion_cumplida: "cumplimiento de la obligación",
  pago_reconocido: "reconocimiento de pago",
  contrato_celebrado: "celebración del contrato",
  notificacion_realizada: "notificación practicada",
  autoridad_notificada: "conocimiento de la autoridad",
  posesion_entregada: "entrega de la posesión",
  dictamen_rendido: "dictamen pericial rendido",
  plazo_procesal: "plazo o término procesal",
  registro_inscrito: "inscripción registral",
  incumplimiento_alegado: "incumplimiento señalado",
};

const ACT_RULES: Array<{ act: ActKey; re: RegExp }> = [
  {
    act: "obligacion_creada",
    re: /(se obliga|se obligan|obligacion de pago|se compromete a|se comprometen a|debera pagar|deberan pagar|contrae la obligacion|queda obligad)/,
  },
  {
    act: "obligacion_cumplida",
    re: /(dio cumplimiento|se dio cumplimiento|cumpli[oó] con|liquid[oó] el adeudo|saldo cubierto|finiquit|pago total|carta finiquito|no existe adeudo)/,
  },
  {
    act: "pago_reconocido",
    re: /(recib[ií] de conformidad|acuse de pago|pago recibido|comprobante de pago|transferencia (?:por|de)|dep[oó]sito por|abono por|se pag[oó])/,
  },
  {
    act: "contrato_celebrado",
    re: /(celebran el (?:presente )?contrato|contrato celebrado|suscriben el|firmado el|de com[uú]n acuerdo celebran|convenio celebrado)/,
  },
  {
    act: "notificacion_realizada",
    re: /(se notific|notificacion personal|cedula de notificacion|emplazamiento|acuse de recibo|se corri[oó] traslado)/,
  },
  {
    act: "autoridad_notificada",
    re: /(se dio vista a|oficio dirigido a|se hizo del conocimiento de la autoridad|se inform[oó] a la autoridad|presentado ante la autoridad)/,
  },
  {
    act: "posesion_entregada",
    re: /(entrega de la posesion|posesion material|acta de entrega|se entrega el inmueble|entrega recepcion)/,
  },
  {
    act: "dictamen_rendido",
    re: /(dictamen pericial|perito design|rindi[oó] dictamen|opinion tecnica|peritaje)/,
  },
  {
    act: "plazo_procesal",
    re: /(plazo de \d|termino de \d|dentro de los \d{1,3} dias|vence el|caducidad|prescripcion|preclusion)/,
  },
  {
    act: "registro_inscrito",
    re: /(inscripcion en el registro|folio real|inscrito bajo|registro publico de la propiedad|quedo inscrit)/,
  },
  {
    act: "incumplimiento_alegado",
    re: /(incumpli|no pag[oó]|adeudo pendiente|saldo insoluto|mora|falta de pago|omiti[oó] entregar)/,
  },
];

function extractActs(raw: string): ExtractedFact[] {
  const hay = normalizeText(raw);
  const out: ExtractedFact[] = [];
  for (const rule of ACT_RULES) {
    const m = rule.re.exec(hay);
    if (m) {
      out.push({
        kind: "act",
        key: `act:${rule.act}`,
        display: ACT_LABELS[rule.act],
        raw: m[0],
        act: rule.act,
      });
    }
  }
  return out;
}

// -------------------------------------------------------------- public API

/** Extract every comparable fact from a set of verbatim quotes. */
export function extractFacts(quotes: string[]): ExtractedFact[] {
  const raw = quotes.filter(Boolean).join("\n");
  if (!raw.trim()) return [];
  const facts = [
    ...extractDates(raw),
    ...extractAmounts(raw),
    ...extractIdentifiers(raw),
    ...extractParties(raw),
    ...extractLocations(raw),
    ...extractActs(raw),
  ];
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = `${f.kind}|${f.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const FACT_KIND_LABEL: Record<FactKind, string> = {
  date: "fecha",
  amount: "cantidad",
  party: "parte",
  identifier: "identificador",
  location: "lugar",
  act: "hecho jurídico",
};

/**
 * Complementarity pairs: when one document evidences the antecedent act and
 * another evidences the consequent act, the documents complement each other
 * rather than duplicate one another.
 */
export const ACT_SEQUENCE: Array<{ from: ActKey; to: ActKey; relation: string }> = [
  {
    from: "obligacion_creada",
    to: "obligacion_cumplida",
    relation: "la creación de la obligación y su cumplimiento",
  },
  {
    from: "obligacion_creada",
    to: "pago_reconocido",
    relation: "la creación de la obligación y el pago reconocido",
  },
  {
    from: "contrato_celebrado",
    to: "registro_inscrito",
    relation: "la celebración del contrato y su inscripción registral",
  },
  {
    from: "contrato_celebrado",
    to: "posesion_entregada",
    relation: "la celebración del contrato y la entrega de la posesión",
  },
  {
    from: "notificacion_realizada",
    to: "plazo_procesal",
    relation: "la notificación practicada y el cómputo del plazo procesal",
  },
  {
    from: "obligacion_creada",
    to: "incumplimiento_alegado",
    relation: "la obligación pactada y el incumplimiento señalado",
  },
];

/** Acts whose absence in the cited corpus is worth stating explicitly. */
export const ACT_EXPECTED_FOLLOWUP: Partial<Record<ActKey, { needs: ActKey[]; gap: string }>> = {
  obligacion_creada: {
    needs: ["obligacion_cumplida", "pago_reconocido"],
    gap: "Ninguno de los documentos citados acredita el cumplimiento de la obligación referida.",
  },
  notificacion_realizada: {
    needs: ["autoridad_notificada", "plazo_procesal"],
    gap: "Ninguno de los documentos citados acredita la constancia de plazo derivada de la notificación.",
  },
  contrato_celebrado: {
    needs: ["registro_inscrito", "posesion_entregada", "pago_reconocido"],
    gap: "Ninguno de los documentos citados acredita actos de ejecución posteriores a la celebración del contrato.",
  },
};
