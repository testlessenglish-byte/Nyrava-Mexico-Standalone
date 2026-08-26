// Canonical Timeline
// Single source of truth for case chronology. Merges:
//   1) analyses.timeline   (analyzer-produced events)
//   2) case_findings      (rows that carry a date)
//   3) deterministic corpus extraction when the first two layers are sparse
//
// The corpus fallback is intentionally conservative: a date is promoted only
// when its local sentence/paragraph also contains a procedural event anchor.
// This keeps publication dates and bare statutory dates out of the case
// chronology while ensuring Mexican judgments with dates written in Spanish
// words still produce a usable timeline.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

type Db = SupabaseClient<Database>;

export type TimelineEventType =
  | "case_event"
  | "authority_date"
  | "legislative_history"
  | "background_reference"
  | "unknown";

export type CanonicalTimelineEvent = {
  date: string; // ISO 'YYYY-MM-DD' when parseable, else original string
  date_raw: string;
  event: string;
  event_type: "case_event";
  sources: Array<{
    document_id: string | null;
    finding_id?: string | null;
    origin: "analyzer" | "finding" | "corpus";
    page?: number | null;
    quote?: string | null;
  }>;
  confidence: "high" | "medium" | "low";
};

export type CanonicalTimeline = {
  generated_at: string;
  events: CanonicalTimelineEvent[];
  totals: {
    total: number;
    dated: number;
    undated: number;
    duplicates_merged: number;
    sources: { analyzer: number; finding: number; corpus: number };
  };
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;
const MONTH = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LONG_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i;

const ES_MONTHS: Record<string, number> = {
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

const ES_UNITS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const ES_TENS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const ES_HUNDREDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};

const ES_MONTH_PATTERN = Object.keys(ES_MONTHS).join("|");
const ES_NUMERIC_DATE_RE = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${ES_MONTH_PATTERN})\\s+de\\s+(\\d{4})\\b`, "i");
const ES_WORD_DATE_RE = new RegExp(
  `\\b([a-záéíóúüñ]+(?:\\s+y\\s+[a-záéíóúüñ]+)?)\\s+de\\s+(${ES_MONTH_PATTERN})\\s+de\\s+((?:dos\\s+mil|mil)(?:\\s+[a-záéíóúüñ]+(?:\\s+y\\s+[a-záéíóúüñ]+)?)*)\\b`,
  "i",
);

// Used only for deterministic corpus extraction. The event must contain one
// of these anchors near the date; a naked date is never promoted.
const PROCEDURAL_EVENT_RE = /\b(interpus[oe]|interpuso|present[oó]|promovi[oó]|notific[oó]|notificada?|resolvi[oó]|resuelve|determin[oó]|revoc[oó]|confirm[oó]|orden[oó]|admiti[oó]|admitida?|desech[oó]|declar[oó]|apel[oó]|impugn[oó]|recurri[oó]|remiti[oó]|turn[oó]|radic[oó]|emplaz[oó]|celebr[oó]|dict[oó]|sentencia|resoluci[oó]n|recurso\s+de\s+revisi[oó]n|demanda|audiencia|acuerdo|engrose|ejecutoria)\b/i;
const AUTHORITY_CONTEXT_RE = /\b(jurisprudencia|tesis(?:\s+aislada)?|precedente|criterio\s+(?:jurisprudencial|aislado)|registro\s+digital|semanario\s+judicial|novena\s+[ée]poca|d[ée]cima\s+[ée]poca|corte\s+interamericana|caso\s+[A-ZÁÉÍÓÚÑ][^.;]{0,80}\s+vs\.?|publicad[ao]\s+en|gaceta)\b/i;
const LEGISLATIVE_CONTEXT_RE = /\b(diario\s+oficial|\bDOF\b|decreto|reforma|legislativ[ao]|entr[oó]\s+en\s+vigor|publicaci[oó]n\s+oficial)\b/i;
const BACKGROUND_CONTEXT_RE = /\b(hist[oó]ric[oa]|antecedente\s+remoto|doctrina|referencia\s+comparada)\b/i;

export function classifyTimelineEvent(
  text: string,
  declaredType?: unknown,
): TimelineEventType {
  const context = String(text ?? "").trim();
  // Legislative publication context is more specific than the general
  // authority/publication pattern and must win for DOF history.
  if (LEGISLATIVE_CONTEXT_RE.test(context)) return "legislative_history";
  if (AUTHORITY_CONTEXT_RE.test(context)) return "authority_date";
  if (BACKGROUND_CONTEXT_RE.test(context)) return "background_reference";

  const declared = String(declaredType ?? "").trim().toLowerCase();
  if (
    declared === "authority_date" ||
    declared === "legislative_history" ||
    declared === "background_reference"
  ) {
    return declared;
  }
  if (declared === "case_event") return "case_event";
  return PROCEDURAL_EVENT_RE.test(context) ? "case_event" : "unknown";
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function spanishNumberWords(raw: string): number | null {
  const normalized = stripAccents(raw)
    .replace(/-/g, " ")
    .replace(/\by\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  let total = 0;
  let current = 0;
  for (const token of normalized.split(" ")) {
    if (token === "mil") {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    if (token in ES_HUNDREDS) {
      current += ES_HUNDREDS[token];
      continue;
    }
    if (token in ES_TENS) {
      current += ES_TENS[token];
      continue;
    }
    if (token in ES_UNITS) {
      current += ES_UNITS[token];
      continue;
    }
    return null;
  }
  return total + current;
}

function validYmd(year: number, month: number, day: number): boolean {
  if (year < 1800 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/** Exported for regression tests and all timeline producers. */
export function normalizeTimelineDate(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const iso = ISO_RE.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = US_RE.exec(s);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    let yyyy = us[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) >= 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  const lng = LONG_RE.exec(s);
  if (lng) {
    const mIdx = MONTH.findIndex((m) => lng[1].toLowerCase().startsWith(m));
    if (mIdx >= 0) {
      const mm = String(mIdx + 1).padStart(2, "0");
      const dd = lng[2].padStart(2, "0");
      return `${lng[3]}-${mm}-${dd}`;
    }
  }

  const normalized = stripAccents(s);
  const numericEs = ES_NUMERIC_DATE_RE.exec(normalized);
  if (numericEs) {
    const day = Number(numericEs[1]);
    const month = ES_MONTHS[numericEs[2]];
    const year = Number(numericEs[3]);
    if (validYmd(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const wordEs = ES_WORD_DATE_RE.exec(normalized);
  if (wordEs) {
    const day = spanishNumberWords(wordEs[1]);
    const month = ES_MONTHS[wordEs[2]];
    const year = spanishNumberWords(wordEs[3]);
    if (day != null && year != null && validYmd(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return s; // keep raw for sort fallback
}

function normalizeText(t: string): string {
  return stripAccents(String(t ?? ""))
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function cleanEventText(value: string): string {
  return String(value ?? "")
    .replace(/---\s*DOC\s+\d+\s+p\.\d+\s*---/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:\-–—.\s]+/, "")
    .replace(/[,;:\-–—\s]+$/, "")
    .slice(0, 520);
}

function localEventContext(text: string, matchStart: number, matchEnd: number): string {
  const hardStart = Math.max(0, matchStart - 360);
  const hardEnd = Math.min(text.length, matchEnd + 520);
  const before = text.slice(hardStart, matchStart);
  const after = text.slice(matchEnd, hardEnd);
  const prevBoundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("\n"), before.lastIndexOf(";"));
  const nextCandidates = [after.indexOf("."), after.indexOf("\n"), after.indexOf(";")].filter((x) => x >= 0);
  const nextBoundary = nextCandidates.length ? Math.min(...nextCandidates) : after.length;
  const start = matchStart - (before.length - (prevBoundary >= 0 ? prevBoundary + 1 : 0));
  const end = matchEnd + nextBoundary + (nextBoundary < after.length ? 1 : 0);
  return cleanEventText(text.slice(Math.max(0, start), Math.min(text.length, end)));
}

function pageAtOffset(text: string, offset: number): number | null {
  const prefix = text.slice(0, Math.max(0, offset));
  const synthetic = /---\s*DOC\s+\d+\s+p\.(\d+)\s*---/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = synthetic.exec(prefix)) !== null) last = m;
  return last ? Number(last[1]) : null;
}

export type CorpusTimelineCandidate = {
  date: string;
  date_raw: string;
  event: string;
  event_type: "case_event";
  page: number | null;
  source_quote: string;
};

/**
 * Deterministically extract procedural events from Mexican legal text.
 * The function is pure/exported so regression tests can exercise the exact
 * fallback used in production.
 */
export function extractCorpusTimelineEvents(text: string): CorpusTimelineCandidate[] {
  const src = String(text ?? "");
  if (!src.trim()) return [];

  const dateMatchers: RegExp[] = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    new RegExp(`\\b\\d{1,2}\\s+de\\s+(?:${ES_MONTH_PATTERN})\\s+de\\s+\\d{4}\\b`, "gi"),
    new RegExp(
      `\\b[a-záéíóúüñ]+(?:\\s+y\\s+[a-záéíóúüñ]+)?\\s+de\\s+(?:${ES_MONTH_PATTERN})\\s+de\\s+(?:dos\\s+mil|mil)(?:\\s+[a-záéíóúüñ]+(?:\\s+y\\s+[a-záéíóúüñ]+)?)*\\b`,
      "gi",
    ),
  ];

  const out: CorpusTimelineCandidate[] = [];
  const seenOffsets = new Set<string>();
  for (const re of dateMatchers) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const raw = match[0];
      const date = normalizeTimelineDate(raw);
      if (!ISO_RE.test(date)) continue;
      const offsetKey = `${match.index}|${date}`;
      if (seenOffsets.has(offsetKey)) continue;
      seenOffsets.add(offsetKey);

      const event = localEventContext(src, match.index, match.index + raw.length);
      if (!event || classifyTimelineEvent(event) !== "case_event") continue;
      out.push({
        date,
        date_raw: raw,
        event,
        event_type: "case_event",
        page: pageAtOffset(src, match.index),
        source_quote: event,
      });
    }
  }

  // A judgment frequently repeats the same procedural event in the index,
  // antecedentes and merits. Keep the earliest concise occurrence per
  // date+normalized event prefix instead of multiplying the chronology.
  const unique = new Map<string, CorpusTimelineCandidate>();
  for (const item of out) {
    const key = `${item.date}|${normalizeText(item.event).slice(0, 120)}`;
    const prior = unique.get(key);
    if (!prior || item.event.length < prior.event.length) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildCanonicalTimeline(db: Db, caseId: string): Promise<CanonicalTimeline> {
  const [{ data: analysis }, { data: findings }, { data: documents }] = await Promise.all([
    db.from("analyses").select("timeline").eq("case_id", caseId).maybeSingle(),
    db.from("case_findings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("id,title,description,source_document_id,source_page,source_quote,event_date,occurred_on,date,created_at,proposition_type" as any)
      .eq("case_id", caseId)
      .not("source_module", "like", PROJECTION_LIKE),
    db.from("documents").select("id,filename,extracted_text").eq("case_id", caseId),
  ]);

  type Bucket = {
    date: string;
    date_raw: string;
    event: string;
    event_type: "case_event";
    sources: CanonicalTimelineEvent["sources"];
    key: string;
  };
  const byKey = new Map<string, Bucket>();
  let analyzerCount = 0;
  let findingCount = 0;
  let corpusCount = 0;
  let duplicates = 0;

  const push = (b: Omit<Bucket, "key">) => {
    const key = `${b.date}|${normalizeText(b.event)}`;
    const existing = byKey.get(key);
    if (existing) {
      duplicates += 1;
      const seen = new Set(
        existing.sources.map((s) => `${s.document_id ?? ""}|${s.finding_id ?? ""}|${s.origin}`),
      );
      for (const s of b.sources) {
        const k = `${s.document_id ?? ""}|${s.finding_id ?? ""}|${s.origin}`;
        if (!seen.has(k)) {
          existing.sources.push(s);
          seen.add(k);
        }
      }
      return;
    }
    byKey.set(key, { ...b, key });
  };

  // 1) Analyzer timeline
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tl = (analysis as any)?.timeline;
  if (Array.isArray(tl)) {
    for (const ev of tl) {
      if (!ev || typeof ev !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = ev as any;
      const raw = String(e.date ?? e.when ?? "");
      const text = String(e.event ?? e.description ?? "").trim();
      if (!text) continue;
      const quote = String(e.source_quote ?? text);
      if (classifyTimelineEvent(`${text} ${quote}`, e.event_type) !== "case_event") continue;
      analyzerCount += 1;
      push({
        date: normalizeTimelineDate(raw),
        date_raw: raw,
        event: text,
        event_type: "case_event",
        sources: [
          {
            document_id: typeof e.source_document_id === "string" ? e.source_document_id : null,
            origin: "analyzer",
            page: typeof e.page === "number" ? e.page : null,
            quote,
          },
        ],
      });
    }
  }

  // 2) Findings carrying a date
  for (const f of findings ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = f as any;
    const raw = String(r.event_date ?? r.occurred_on ?? r.date ?? "");
    if (!raw) continue;
    const text = String(r.title ?? r.description ?? "").trim();
    if (!text) continue;
    const quote = String(r.source_quote ?? text);
    const declaredType = r.proposition_type === "procedural_event" ? "case_event" : undefined;
    if (classifyTimelineEvent(`${text} ${quote}`, declaredType) !== "case_event") continue;
    findingCount += 1;
    push({
      date: normalizeTimelineDate(raw),
      date_raw: raw,
      event: text,
      event_type: "case_event",
      sources: [
        {
          document_id: typeof r.source_document_id === "string" ? r.source_document_id : null,
          finding_id: typeof r.id === "string" ? r.id : null,
          origin: "finding",
          page: typeof r.source_page === "number" ? r.source_page : null,
          quote,
        },
      ],
    });
  }

  // 3) Corpus fallback. Run whenever the structured producers are sparse.
  // Two events are not enough to assess chronology or gaps in a litigation
  // matter, so the document itself becomes the deterministic recovery layer.
  if (byKey.size < 3) {
    for (const doc of documents ?? []) {
      const text = typeof doc.extracted_text === "string" ? doc.extracted_text : "";
      for (const ev of extractCorpusTimelineEvents(text)) {
        corpusCount += 1;
        push({
          date: ev.date,
          date_raw: ev.date_raw,
          event: ev.event,
          event_type: "case_event",
          sources: [
            {
              document_id: typeof doc.id === "string" ? doc.id : null,
              origin: "corpus",
              page: ev.page,
              quote: ev.source_quote,
            },
          ],
        });
      }
    }
  }

  const events: CanonicalTimelineEvent[] = [...byKey.values()]
    .map((b) => ({
      date: b.date,
      date_raw: b.date_raw,
      event: b.event,
      event_type: b.event_type,
      sources: b.sources,
      confidence: (b.sources.length >= 2
        ? "high"
        : ISO_RE.test(b.date)
          ? "medium"
          : "low") as CanonicalTimelineEvent["confidence"],
    }))
    .sort((a, b) => {
      const ai = ISO_RE.test(a.date) ? a.date : "9999-99-99";
      const bi = ISO_RE.test(b.date) ? b.date : "9999-99-99";
      if (ai !== bi) return ai < bi ? -1 : 1;
      return a.event.localeCompare(b.event);
    });

  const dated = events.filter((e) => ISO_RE.test(e.date)).length;
  return {
    generated_at: new Date().toISOString(),
    events,
    totals: {
      total: events.length,
      dated,
      undated: events.length - dated,
      duplicates_merged: duplicates,
      sources: { analyzer: analyzerCount, finding: findingCount, corpus: corpusCount },
    },
  };
}

/** Stable canonical id: short deterministic hash over (normalized date | normalized event). */
function canonicalTimelineId(date: string, event: string): string {
  const seed = `${date}|${normalizeText(event)}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  const h2 = (h >>> 0).toString(16).padStart(8, "0");
  let g = 0;
  for (let i = 0; i < seed.length; i++) g = (g * 31 + seed.charCodeAt(i)) >>> 0;
  return `tl_${h2}_${g.toString(16).padStart(8, "0")}`;
}

export async function persistCanonicalTimeline(
  db: Db,
  caseId: string,
  ct: CanonicalTimeline,
): Promise<{ inserted: number; superseded: number; unchanged: number }> {
  const { data: activeRows } = await db
    .from("case_timeline_events" as never)
    .select("id, canonical_id, event_date, description, event_type, source_document_id, source_page, source_quote")
    .eq("case_id", caseId)
    .is("superseded_by", null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeByCanonical = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (activeRows as any[]) ?? []) activeByCanonical.set(r.canonical_id, r);

  let inserted = 0;
  let superseded = 0;
  let unchanged = 0;

  for (const ev of ct.events) {
    const canonical_id = canonicalTimelineId(ev.date, ev.event);
    const primarySource = ev.sources[0] ?? null;
    const nextRow = {
      case_id: caseId,
      canonical_id,
      event_date: ev.date || ev.date_raw || null,
      description: ev.event,
      event_type: ev.event_type,
      source_document_id: primarySource?.document_id ?? null,
      source_page: primarySource?.page ?? null,
      source_quote: primarySource?.quote ?? null,
    };
    const existing = activeByCanonical.get(canonical_id);
    if (!existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from("case_timeline_events").insert(nextRow);
      if (!error) {
        inserted += 1;
      } else {
        console.error(
          `[canonical-timeline] insert failed case=${caseId} canonical_id=${canonical_id}`,
          error,
        );
      }
      continue;
    }
    const same =
      String(existing.event_date ?? "") === String(nextRow.event_date ?? "") &&
      String(existing.description ?? "") === String(nextRow.description ?? "") &&
      String(existing.event_type ?? "") === String(nextRow.event_type ?? "") &&
      String(existing.source_document_id ?? "") === String(nextRow.source_document_id ?? "") &&
      (existing.source_page ?? null) === (nextRow.source_page ?? null) &&
      String(existing.source_quote ?? "") === String(nextRow.source_quote ?? "");
    if (same) {
      unchanged += 1;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedRow, error: insErr } = await (db as any)
      .from("case_timeline_events")
      .insert(nextRow)
      .select("id")
      .maybeSingle();
    if (insErr || !insertedRow?.id) {
      if (insErr) {
        console.error(
          `[canonical-timeline] supersede insert failed case=${caseId} canonical_id=${canonical_id}`,
          insErr,
        );
      }
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from("case_timeline_events")
      .update({ superseded_by: insertedRow.id })
      .eq("id", existing.id);
    superseded += 1;
    inserted += 1;
  }

  return { inserted, superseded, unchanged };
}

/** Read active (non-superseded) timeline rows for a case in chronological order. */
export async function readActiveTimeline(db: Db, caseId: string) {
  const { data } = await db
    .from("case_timeline_events" as never)
    .select("id, canonical_id, event_date, description, event_type, source_document_id, source_page, source_quote, created_at")
    .eq("case_id", caseId)
    .is("superseded_by", null)
    .order("event_date", { ascending: true });
  return data ?? [];
}
