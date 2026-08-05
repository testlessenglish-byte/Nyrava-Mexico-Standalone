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
//   2. Only true duplicates merge. Two findings must share a category AND be
//      lexically near-identical (token Jaccard over title, corroborated by the
//      description) before they collapse.
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
  "de","la","el","los","las","del","al","y","o","en","un","una","unos","unas",
  "por","para","con","sin","que","se","su","sus","es","son","the","of","a","an",
  "to","and","in","on","for","is","are",
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
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
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
};

const DEFAULTS: Required<DedupeOptions> = {
  titleThreshold: 0.62,
  titleFallbackThreshold: 0.4,
  descriptionThreshold: 0.6,
};

type Prepared = {
  row: DedupableFinding;
  index: number;
  category: string;
  titleTokens: Set<string>;
  descTokens: Set<string>;
  titleKey: string;
};

function categoryOf(f: DedupableFinding): string {
  return normalizeText(f.category ?? f.finding_type ?? "misc") || "misc";
}

function textOf(f: DedupableFinding, key: string): string {
  const v = f[key];
  return typeof v === "string" ? v : "";
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
  };
}

export function isSameIssue(a: Prepared, b: Prepared, opts: Required<DedupeOptions>): boolean {
  if (a.category !== b.category) return false;
  // Preserves the original behavior: identical leading-6-word titles cluster.
  if (a.titleKey && a.titleKey === b.titleKey) return true;
  const ts = jaccard(a.titleTokens, b.titleTokens);
  if (ts >= opts.titleThreshold) return true;
  if (ts >= opts.titleFallbackThreshold) {
    return jaccard(a.descTokens, b.descTokens) >= opts.descriptionThreshold;
  }
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
  _merged?: Array<{ id?: string; title?: string; description?: string }>;
  _merged_count?: number;
};

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
      master._merged = dupes.map((d) => ({
        id: d.id ? String(d.id) : undefined,
        title: d.title ? String(d.title) : undefined,
        description: d.description ? String(d.description) : undefined,
      }));
      master._merged_count = dupes.length;
      const meta = (master.metadata && typeof master.metadata === "object"
        ? { ...(master.metadata as Record<string, unknown>) }
        : {}) as Record<string, unknown>;
      meta.merged_duplicates = master._merged;
      master.metadata = meta;
    }
    out.push({ index: winner.index, row: master });
  }

  return out.sort((a, b) => a.index - b.index).map((o) => o.row);
}
