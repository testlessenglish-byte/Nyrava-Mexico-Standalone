// Canonical Timeline (Batch 2)
// Single source of truth for case chronology. Merges:
//   1) analyses.timeline   (analyzer-produced events)
//   2) case_findings       (rows that carry a date)
// Deduplicates by (normalized date, normalized event text) and sorts ASC.
// Every event carries provenance (source document id + finding id when known).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

type Db = SupabaseClient<Database>;

export type CanonicalTimelineEvent = {
  date: string;            // ISO 'YYYY-MM-DD' when parseable, else original string
  date_raw: string;
  event: string;
  sources: Array<{
    document_id: string | null;
    finding_id?: string | null;
    origin: "analyzer" | "finding";
    page?: number | null;
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
    sources: { analyzer: number; finding: number };
  };
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;
const MONTH = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const LONG_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i;

function normalizeDate(raw: string): string {
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
  return s; // keep raw for sort fallback
}

function normalizeText(t: string): string {
  return String(t ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function buildCanonicalTimeline(db: Db, caseId: string): Promise<CanonicalTimeline> {
  const [{ data: analysis }, { data: findings }] = await Promise.all([
    db.from("analyses").select("timeline").eq("case_id", caseId).maybeSingle(),
    db.from("case_findings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("id,title,description,source_document_id,source_page,event_date,occurred_on,date,created_at" as any)
      .eq("case_id", caseId)
      .not("source_module", "like", PROJECTION_LIKE),
  ]);

  type Bucket = { date: string; date_raw: string; event: string; sources: CanonicalTimelineEvent["sources"]; key: string };
  const byKey = new Map<string, Bucket>();
  let analyzerCount = 0;
  let findingCount = 0;
  let duplicates = 0;

  const push = (b: Omit<Bucket, "key">) => {
    const key = `${b.date}|${normalizeText(b.event)}`;
    const existing = byKey.get(key);
    if (existing) {
      duplicates += 1;
      // Merge sources, dedup by (document_id|finding_id|origin)
      const seen = new Set(existing.sources.map((s) => `${s.document_id ?? ""}|${s.finding_id ?? ""}|${s.origin}`));
      for (const s of b.sources) {
        const k = `${s.document_id ?? ""}|${s.finding_id ?? ""}|${s.origin}`;
        if (!seen.has(k)) { existing.sources.push(s); seen.add(k); }
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
      analyzerCount += 1;
      push({
        date: normalizeDate(raw),
        date_raw: raw,
        event: text,
        sources: [{
          document_id: typeof e.source_document_id === "string" ? e.source_document_id : null,
          origin: "analyzer",
          page: typeof e.page === "number" ? e.page : null,
        }],
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
    findingCount += 1;
    push({
      date: normalizeDate(raw),
      date_raw: raw,
      event: text,
      sources: [{
        document_id: typeof r.source_document_id === "string" ? r.source_document_id : null,
        finding_id: typeof r.id === "string" ? r.id : null,
        origin: "finding",
        page: typeof r.source_page === "number" ? r.source_page : null,
      }],
    });
  }

  const events: CanonicalTimelineEvent[] = [...byKey.values()]
    .map((b) => ({
      date: b.date,
      date_raw: b.date_raw,
      event: b.event,
      sources: b.sources,
      confidence: (b.sources.length >= 2 ? "high" : (ISO_RE.test(b.date) ? "medium" : "low")) as CanonicalTimelineEvent["confidence"],
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
      sources: { analyzer: analyzerCount, finding: findingCount },
    },
  };
}

/** Stable canonical id: sha256-style short hash over (normalized date | normalized event). */
function canonicalTimelineId(date: string, event: string): string {
  const seed = `${date}|${normalizeText(event)}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  const h2 = (h >>> 0).toString(16).padStart(8, "0");
  // Add length-mixed suffix for wider entropy without pulling in crypto.
  let g = 0;
  for (let i = 0; i < seed.length; i++) g = (g * 31 + seed.charCodeAt(i)) >>> 0;
  return `tl_${h2}_${g.toString(16).padStart(8, "0")}`;
}

/**
 * Persist a canonical timeline into `case_timeline_events` using
 * supersede-not-delete semantics:
 *   - New canonical_id → INSERT.
 *   - Existing active row (superseded_by IS NULL), unchanged content → no-op.
 *   - Existing active row, content differs → INSERT new row, then set the
 *     old row's superseded_by = new.id (old row stays for audit).
 * Rows are never deleted here.
 */
export async function persistCanonicalTimeline(
  db: Db,
  caseId: string,
  ct: CanonicalTimeline,
): Promise<{ inserted: number; superseded: number; unchanged: number }> {
  // Load current active rows for this case.
  const { data: activeRows } = await db
    .from("case_timeline_events" as never)
    .select("id, canonical_id, event_date, description, source_document_id, source_page")
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
      source_document_id: primarySource?.document_id ?? null,
      source_page: primarySource?.page ?? null,
    };
    const existing = activeByCanonical.get(canonical_id);
    if (!existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (db as any).from("case_timeline_events").insert(nextRow);
      if (!error) inserted += 1;
      continue;
    }
    const same =
      String(existing.event_date ?? "") === String(nextRow.event_date ?? "") &&
      String(existing.description ?? "") === String(nextRow.description ?? "") &&
      String(existing.source_document_id ?? "") === String(nextRow.source_document_id ?? "") &&
      (existing.source_page ?? null) === (nextRow.source_page ?? null);
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
    if (insErr || !insertedRow?.id) continue;
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
    .select("id, canonical_id, event_date, description, source_document_id, source_page, created_at")
    .eq("case_id", caseId)
    .is("superseded_by", null)
    .order("event_date", { ascending: true });
  return data ?? [];
}
