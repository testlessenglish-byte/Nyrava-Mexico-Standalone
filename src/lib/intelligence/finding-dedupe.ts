// Duplicate-finding consolidation — PURE MODULE (no I/O, no AI).
//
// WHY: engines and agents frequently emit several findings that describe the
// SAME underlying legal issue with different wording (e.g. "Cadena de custodia
// interrumpida", "Ruptura de la cadena de custodia del arma", "Falta de
// registro en la cadena de custodia"). Each one is real, but shown separately
// they make the report long and repetitive.
//
// CONTRACT (must never be violated):
//   1. Nothing is lost. Every evidence ref, citation, source doc id,
//      supporting engine and tag from a merged duplicate is unioned into the
//      surviving finding. The duplicates' full titles/descriptions are kept in
//      `_merged` / metadata so no legal analysis disappears.
//   2. Only true duplicates merge. Within one category two findings must be
//      lexically near-identical (token Jaccard over title, corroborated by the
//      description) — OR rest on the literal identical quoted evidence text,
//      which is strong enough corroboration on its own regardless of title
//      wording. ACROSS categories — the cross-engine case, where two engines
//      emit the same canonical issue under their own category label — the bar
//      is deliberately much higher AND requires independent corroboration
//      (shared evidence/source docs, or strongly agreeing descriptions).
//      Merged rows carry the UNION of the categories.
//   3. Materia-agnostic. No practice-area vocabulary is hard-coded here, so it
//      behaves identically for penal, laboral, amparo, civil, etc.
//   4. Order-stable: the surviving row keeps the input order of its cluster's
//      strongest member, so report layout is unchanged apart from the removal
//      of duplicated rows.

const SEV_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "del",
  "al",
  "y",
  "o",
  "en",
  "un",
  "una",
  "unos",
  "unas",
  "por",
  "para",
  "con",
  "sin",
  "que",
  "se",
  "su",
  "sus",
  "es",
  "son",
  "the",
  "of",
  "a",
  "an",
  "to",
  "and",
  "in",
  "on",
  "for",
  "is",
  "are",
]);

/** Accent-folded, punctuation-stripped lowercase text. */
export function normalizeText(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: unknown): Set<string> {
  return new Set(
    normalizeText(s)
      .split(" ")
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
      // Light stem: Spanish inflections ("contractual"/"contrato",
      // "vulneracion"/"vulnerar") differ only past the first few characters.
      .map((t) => t.slice(0, 6)),
  );
}

/** Token-level Jaccard similarity in [0,1]. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export type DedupableFinding = Record<string, unknown>;

export type DedupeOptions = {
  /** Title similarity required to consider two findings the same issue. */
  titleThreshold?: number;
  /** Lower title bar accepted when descriptions also agree strongly. */
  titleFallbackThreshold?: number;
  /** Description similarity required for the fallback path. */
  descriptionThreshold?: number;
  /** Title similarity required to merge ACROSS two different categories. */
  crossCategoryTitleThreshold?: number;
  /** Description agreement accepted as corroboration for a cross-category merge. */
  crossCategoryDescriptionThreshold?: number;
  /** Weaker description bar accepted when the two titles are byte-identical. */
  crossCategoryExactTitleDescriptionThreshold?: number;
};

const DEFAULTS: Required<DedupeOptions> = {
  titleThreshold: 0.55,
  titleFallbackThreshold: 0.4,
  descriptionThreshold: 0.6,
  crossCategoryTitleThreshold: 0.8,
  crossCategoryDescriptionThreshold: 0.5,
  crossCategoryExactTitleDescriptionThreshold: 0.3,
};

type Prepared = {
  row: DedupableFinding;
  index: number;
  category: string;
  titleTokens: Set<string>;
  descTokens: Set<string>;
  titleKey: string;
  fullTitle: string;
  evidence: Set<string>;
  evidenceQuotes: Set<string>;
};

function categoryOf(f: DedupableFinding): string {
  return normalizeText(f.category ?? f.finding_type ?? "misc") || "misc";
}

function textOf(f: DedupableFinding, key: string): string {
  const v = f[key];
  return typeof v === "string" ? v : "";
}

/** Union of the concrete evidence anchors a finding rests on. */
const EVIDENCE_KEYS = ["evidence_refs", "source_doc_ids", "document_ids", "citations"] as const;

/**
 * evidence_refs entries are `{ label?, quote?, doc_id? }` (see types.ts).
 * `label` is each engine's own free-text framing of why the quote matters —
 * two engines routinely cite the identical quote/document under differently
 * worded labels. Signing the whole object (the previous behavior) folded
 * that wording difference into the signature, so an identical quote cited
 * under two labels was never recognized as shared evidence. Key on
 * doc_id::quote only, matching the doc_id::quote key findings.server.ts's
 * evidenceKeys() already uses for its own (persist-time, narrower) overlap
 * check.
 */
function evidenceSignature(item: unknown): string {
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const quote = normalizeText(obj.quote);
    const docId = normalizeText(obj.doc_id ?? obj.document_id);
    if (quote || docId) return `${docId}::${quote}`;
    return normalizeText(JSON.stringify(item));
  }
  return normalizeText(String(item));
}

function evidenceOf(f: DedupableFinding): Set<string> {
  const out = new Set<string>();
  for (const key of EVIDENCE_KEYS) {
    const v = f[key];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      const sig = evidenceSignature(item);
      if (sig) out.add(sig);
    }
  }
  return out;
}

/** Minimum normalized-quote length considered for the strong same-category
 *  evidence signal below — long enough that a match can't be a coincidental
 *  short common phrase ("el juez ordeno"). */
const MIN_QUOTE_LEN = 20;

/** Verbatim `evidence_refs[].quote` text only (not doc_id-only or citation
 *  overlap, which are too weak a signal on their own — many distinct
 *  findings in the same case legitimately cite the same source document). */
function quoteEvidenceOf(f: DedupableFinding): Set<string> {
  const out = new Set<string>();
  const refs = f.evidence_refs;
  if (!Array.isArray(refs)) return out;
  for (const item of refs) {
    if (!item || typeof item !== "object") continue;
    const quote = normalizeText((item as Record<string, unknown>).quote);
    if (quote.length >= MIN_QUOTE_LEN) out.add(quote);
  }
  return out;
}

function prepare(row: DedupableFinding, index: number): Prepared {
  const title = textOf(row, "title");
  const desc = `${textOf(row, "description")} ${textOf(row, "legal_significance")}`;
  return {
    row,
    index,
    category: categoryOf(row),
    titleTokens: tokens(title),
    descTokens: tokens(desc),
    titleKey: normalizeText(title).split(" ").slice(0, 6).join(" "),
    fullTitle: normalizeText(title),
    evidence: evidenceOf(row),
    evidenceQuotes: quoteEvidenceOf(row),
  };
}

function sharesEvidence(a: Prepared, b: Prepared): boolean {
  if (a.evidence.size === 0 || b.evidence.size === 0) return false;
  for (const e of a.evidence) if (b.evidence.has(e)) return true;
  return false;
}

function sharesQuoteEvidence(a: Prepared, b: Prepared): boolean {
  if (a.evidenceQuotes.size === 0 || b.evidenceQuotes.size === 0) return false;
  for (const q of a.evidenceQuotes) if (b.evidenceQuotes.has(q)) return true;
  return false;
}

export function isSameIssue(a: Prepared, b: Prepared, opts: Required<DedupeOptions>): boolean {
  if (a.category !== b.category) {
    // CROSS-ENGINE DUPLICATION. Two engines/perspectives routinely emit the
    // same canonical issue under their own category label ("Deterioro
    // cognitivo del testador" from both the capacity and the undue-influence
    // perspective). Merging these requires a near-identical title AND
    // independent corroboration, so unrelated findings that merely share a
    // headline (e.g. "Notificación fuera de plazo" as a procedural issue vs.
    // an evidentiary one) still stay separate.
    const ts = jaccard(a.titleTokens, b.titleTokens);
    const sameHeadline =
      (a.titleKey !== "" && a.titleKey === b.titleKey) || ts >= opts.crossCategoryTitleThreshold;
    if (!sameHeadline) return false;
    if (sharesEvidence(a, b)) return true;
    if (a.descTokens.size === 0 || b.descTokens.size === 0) return false;
    // A byte-identical title is itself strong evidence of one canonical issue,
    // so the description only has to agree on the subject, not the wording.
    const descBar =
      a.fullTitle !== "" && a.fullTitle === b.fullTitle
        ? opts.crossCategoryExactTitleDescriptionThreshold
        : opts.crossCategoryDescriptionThreshold;
    return jaccard(a.descTokens, b.descTokens) >= descBar;
  }

  // Preserves the original behavior: identical leading-6-word titles cluster.
  if (a.titleKey && a.titleKey === b.titleKey) return true;
  const ts = jaccard(a.titleTokens, b.titleTokens);
  if (ts >= opts.titleThreshold) return true;
  if (ts >= opts.titleFallbackThreshold) {
    if (jaccard(a.descTokens, b.descTokens) >= opts.descriptionThreshold) return true;
  }
  // Two findings in the same category resting on the literal same quoted
  // evidentiary text are the same underlying claim no matter how
  // differently each pass titled it ("Competencia del Juzgado" vs.
  // "Competencia de la autoridad" citing one identical sentence) — unlike a
  // shared source document, a verbatim shared quote of meaningful length
  // cannot be coincidental.
  if (sharesQuoteEvidence(a, b)) return true;
  return false;
}

function strength(f: DedupableFinding): [number, number, number] {
  const sev = SEV_RANK[String(f.severity ?? "info").toLowerCase()] ?? 9;
  const rawConf = Number(f.confidence ?? 0);
  const conf = Number.isFinite(rawConf) ? (rawConf > 1 ? rawConf / 100 : rawConf) : 0;
  const detail = textOf(f, "description").length;
  return [sev, -conf, -detail];
}

/** Lower tuple wins. */
function isStronger(a: DedupableFinding, b: DedupableFinding): boolean {
  const [as_, ac, ad] = strength(a);
  const [bs, bc, bd] = strength(b);
  if (as_ !== bs) return as_ < bs;
  if (ac !== bc) return ac < bc;
  return ad < bd;
}

const ARRAY_UNION_KEYS = [
  "evidence_refs",
  "citations",
  "source_doc_ids",
  "supporting_engines",
  "tags",
  "document_ids",
  "evidence",
  "sources",
] as const;

function unionArrays(master: DedupableFinding, others: DedupableFinding[]): void {
  for (const key of ARRAY_UNION_KEYS) {
    const seen = new Set<string>();
    const merged: unknown[] = [];
    const push = (v: unknown) => {
      if (!Array.isArray(v)) return;
      for (const item of v) {
        const sig = typeof item === "object" && item !== null ? JSON.stringify(item) : String(item);
        if (seen.has(sig)) continue;
        seen.add(sig);
        merged.push(item);
      }
    };
    push(master[key]);
    const before = merged.length;
    for (const o of others) push(o[key]);
    // Only write the key when the master already had it or a duplicate
    // contributed something — never invent empty arrays on rows that had none.
    if (merged.length > 0 && (Array.isArray(master[key]) || merged.length > before || before > 0)) {
      master[key] = merged;
    }
  }
}

export type DedupedFinding = DedupableFinding & {
  _alias_ids?: string[];
  _alias_titles?: string[];
  _alias_categories?: string[];
  _merged?: Array<{ id?: string; title?: string; description?: string; category?: string }>;
  _merged_count?: number;
};

/** Internal: `prepare` every row (preserving original array position as
 *  `index`) then cluster by `isSameIssue`. Shared by the exported clustering
 *  and consolidation entry points below so both agree on exactly one
 *  definition of "same issue." */
function clusterPrepared(prepared: Prepared[], opts: Required<DedupeOptions>): Prepared[][] {
  const clusters: Prepared[][] = [];
  for (const p of prepared) {
    let placed = false;
    for (const cluster of clusters) {
      // Compare against every member so transitive drift can't chain unrelated
      // findings together: a new row must match ALL members already clustered.
      if (cluster.every((m) => isSameIssue(m, p, opts))) {
        cluster.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([p]);
  }
  return clusters;
}

/**
 * Group rows into same-issue clusters using the same-category-title-Jaccard /
 * cross-category-title-plus-corroboration rule (`isSameIssue`) — the pure
 * clustering step, with no winner-selection or merging. Shared by
 * `consolidateFindings` (report-time, read-only) and any caller that needs
 * its own merge semantics on top of the same canonical-issue grouping (e.g.
 * findings.server.ts's persist-time dedup, which additionally merges
 * judicial-hierarchy taxonomy fields and prefers an existing DB row as the
 * merge anchor). Clusters are returned in first-member original-order.
 */
export function clusterBySameIssue<T extends DedupableFinding>(
  rows: ReadonlyArray<T>,
  options: DedupeOptions = {},
): Array<T[]> {
  const opts = { ...DEFAULTS, ...options };
  const prepared = (rows ?? []).map(prepare);
  return clusterPrepared(prepared, opts)
    .sort((a, b) => a[0].index - b[0].index)
    .map((cluster) => cluster.map((p) => p.row as T));
}

/**
 * Collapse near-duplicate findings into one consolidated row per legal issue.
 * Non-duplicates pass through untouched and in their original order.
 */
export function consolidateFindings<T extends DedupableFinding>(
  rows: ReadonlyArray<T>,
  options: DedupeOptions = {},
): Array<T & DedupedFinding> {
  const opts = { ...DEFAULTS, ...options };
  const prepared = (rows ?? []).map(prepare);
  const clusters = clusterPrepared(prepared, opts);

  const out: Array<{ index: number; row: T & DedupedFinding }> = [];
  for (const cluster of clusters) {
    let winner = cluster[0];
    for (const c of cluster.slice(1)) if (isStronger(c.row, winner.row)) winner = c;

    // Shallow clone so the input rows are never mutated.
    const master = { ...(winner.row as T) } as T & DedupedFinding;
    const dupes = cluster.filter((c) => c !== winner).map((c) => c.row);

    if (dupes.length > 0) {
      unionArrays(master, dupes);
      master._alias_ids = dupes.map((d) => String(d.id ?? "")).filter(Boolean);
      master._alias_titles = dupes.map((d) => String(d.title ?? "")).filter(Boolean);
      // Category UNION: when the same canonical issue was emitted by engines
      // under different category labels, the survivor must carry every label
      // so no legal perspective is silently dropped from the report.
      const winnerCategory = String(winner.row.category ?? winner.row.finding_type ?? "");
      const aliasCategories: string[] = [];
      for (const d of dupes) {
        const c = String(d.category ?? d.finding_type ?? "");
        if (!c) continue;
        if (normalizeText(c) === normalizeText(winnerCategory)) continue;
        if (aliasCategories.some((x) => normalizeText(x) === normalizeText(c))) continue;
        aliasCategories.push(c);
      }
      if (aliasCategories.length > 0) master._alias_categories = aliasCategories;
      master._merged = dupes.map((d) => ({
        id: d.id ? String(d.id) : undefined,
        title: d.title ? String(d.title) : undefined,
        description: d.description ? String(d.description) : undefined,
        category: d.category ? String(d.category) : undefined,
      }));
      master._merged_count = dupes.length;
      const mutable = master as DedupableFinding;
      const existingMeta = mutable.metadata;
      const meta =
        existingMeta && typeof existingMeta === "object"
          ? { ...(existingMeta as Record<string, unknown>) }
          : ({} as Record<string, unknown>);
      meta.merged_duplicates = master._merged;
      if (aliasCategories.length > 0) {
        meta.merged_categories = [winnerCategory, ...aliasCategories].filter(Boolean);
      }
      mutable.metadata = meta;
    }
    out.push({ index: winner.index, row: master });
  }

  return out.sort((a, b) => a.index - b.index).map((o) => o.row);
}
