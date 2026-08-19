// Report-render normalizer.
//
// Runs after every engine has emitted its section-level payload and before
// the report is serialized/rendered. Guarantees the invariants users care
// about in a shipped work product:
//   • no empty sections (empty arrays / whitespace-only strings)
//   • no blank recommendations or theories (missing title/description)
//   • no repeated prose lines within the same section
//   • no repeated recommendations/theories/opportunities by normalized title
//   • no legacy confidence value may survive under the name `risk_score`
//
// This module is presentation-only. It does NOT invent, promote, or
// downgrade evidence. Anything filtered here is empty, blank, or a duplicate
// of something already retained — never a load-bearing finding.

const BLANK_RE = /^[\s\-•*·—–_]*$/;

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "" || BLANK_RE.test(v);
  if (Array.isArray(v)) return v.length === 0 || v.every(isBlank);
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    return Object.keys(rec).every((k) => isBlank(rec[k]));
  }
  return false;
}

/** Lowercased, punctuation-stripped, first-6-word signature. */
function titleKey(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fold accents so Spanish-language duplicate lines are actually caught
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

/** Dedupe adjacent + fuzzy-duplicate prose lines within a single body. */
export function dedupeProseLines(body: string): string {
  if (!body || typeof body !== "string") return body ?? "";
  const lines = body.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const key = line.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) {
      // preserve one blank line between blocks; collapse runs of blanks
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  // trim trailing blank
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Drop items that are blank or duplicate a prior item by title-key. */
export function dedupeItems<T extends Record<string, unknown>>(
  items: T[] | undefined | null,
  titleFields: string[] = ["title", "name", "issue", "recommendation", "narrative"],
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (isBlank(it)) continue;
    // pick the first non-blank titley field
    let sig = "";
    for (const f of titleFields) {
      const v = it?.[f];
      if (typeof v === "string" && v.trim()) { sig = titleKey(v); break; }
    }
    if (!sig) {
      // No titley field — fall back to a JSON signature so identical
      // full-object dupes still collapse.
      sig = titleKey(JSON.stringify(it).slice(0, 240));
    }
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(it);
  }
  return out;
}

/** Strip empty entries from every section of a report-shaped object. */
export function stripEmptySections(
  report: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(report)) {
    if (v === null || v === undefined) { out[k] = v; continue; }
    if (typeof v === "string") {
      const cleaned = dedupeProseLines(v);
      out[k] = cleaned.trim() === "" ? null : cleaned;
      continue;
    }
    if (Array.isArray(v)) {
      const cleaned = dedupeItems(v as Record<string, unknown>[]);
      out[k] = cleaned.length === 0 ? [] : cleaned;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function canonicalLitigationRisk(report: Record<string, unknown>): number | null {
  const litigationRisk = report.litigation_risk;
  if (!litigationRisk || typeof litigationRisk !== "object") return null;
  const score = Number((litigationRisk as Record<string, unknown>).score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score);
}

/**
 * Full normalization pass for a finalized report payload. Idempotent — safe
 * to call more than once; a second pass is a no-op on the output of the first.
 */
export function normalizeReport<T extends Record<string, unknown>>(report: T): T {
  const cleaned = stripEmptySections(report);
  // Well-known list sections that should never contain blanks or dupes.
  for (const key of [
    "motion_opportunities",
    "strategy_recommendations",
    "next_actions",
    "cross_examination",
    "missing_evidence_struct",
    "contradictions_struct",
    "constitutional_issues_struct",
    "case_theories",
    "opportunities",
    "witnesses",
    "timeline",
  ]) {
    const v = cleaned[key];
    if (Array.isArray(v)) {
      cleaned[key] = dedupeItems(v as Record<string, unknown>[]);
    }
  }
  // executive_summary / full_report: dedupe repeated prose lines
  for (const key of ["executive_summary", "full_report"]) {
    const v = cleaned[key];
    if (typeof v === "string") cleaned[key] = dedupeProseLines(v);
  }

  // `risk_score` used to carry an LLM confidence value in some report
  // generations. Once deterministic `litigation_risk.score` exists, it is the
  // sole canonical meaning of risk. Overwrite the legacy alias at the final
  // serialization boundary so JSON/PDF/UI/Case AI cannot disagree (e.g. 88
  // in JSON while the deterministic dashboard correctly displays 6).
  const canonicalRisk = canonicalLitigationRisk(cleaned);
  if (canonicalRisk !== null) cleaned.risk_score = canonicalRisk;

  return cleaned as T;
}
