// Work-product verification gate.
//
// Attorney Work Product drafts (settlement_demand, motion_for_summary_judgment,
// cross_exam_plan, discovery_request, trial_outline, case_summary, etc.) are
// free-text markdown rather than the structured {evidence_refs:[...]} payloads
// that other engines emit. The standard evidence gate (verifyEvidenceRefs) is
// therefore not applicable here — there is no citations array to filter.
//
// This module fills that gap by extracting concrete, verifiable claims from
// generated prose (dollar figures, percentages, dates, named documents) and
// checking each against the actual corpus before the draft is persisted. Any
// claim that does not trace to the corpus is reported as `unsupported` so the
// caller can either flag the draft, downgrade it, or replace it with an
// explicit "insufficient evidence" stub.

export type CorpusIndex = {
  /** Normalized full text of every extracted document, concatenated. */
  text: string;
  /** Digits-only projection of `text` (for fuzzy numeric matching). */
  digits: string;
  /** Lowercased set of known document filenames (basename and stem). */
  filenames: Set<string>;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim();
}

export function buildCorpusIndex(
  docs: Array<{ filename: string | null; extracted_text: string | null }>,
): CorpusIndex {
  const joined = docs.map((d) => d.extracted_text ?? "").join("\n\n");
  const text = norm(joined);
  const digits = text.replace(/[^0-9]/g, "");
  const filenames = new Set<string>();
  for (const d of docs) {
    if (!d.filename) continue;
    const fn = d.filename.toLowerCase();
    filenames.add(fn);
    const stem = fn.replace(/\.[a-z0-9]+$/, "");
    if (stem) filenames.add(stem);
  }
  return { text, digits, filenames };
}

const FILENAME_RE = /\b[\w\-]{2,}\.(?:txt|csv|pdf|docx?|md|xlsx?|json|html?)\b/gi;
const DOLLAR_RE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\$\s?\d+(?:\.\d+)?/g;
const PERCENT_RE = /\b\d{1,3}(?:\.\d+)?\s?%/g;
const NUMERIC_DATE_RE = /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:\d{2}|\d{4})\b/g;
const MONTH_DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi;

function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

export type Unsupported = {
  kind: "filename" | "dollar" | "percent" | "date";
  claim: string;
};

/** Verify a generated work-product body against the corpus. Returns the list
 *  of concrete claims that do not appear in the corpus. An empty array means
 *  every extracted claim was traceable. */
export function verifyWorkProductBody(body: string, corpus: CorpusIndex): Unsupported[] {
  if (!body || typeof body !== "string") return [];
  const out: Unsupported[] = [];
  const seen = new Set<string>();

  // Document references.
  for (const m of body.matchAll(FILENAME_RE)) {
    const raw = m[0].trim().toLowerCase();
    const key = `fn:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stem = raw.replace(/\.[a-z0-9]+$/, "");
    if (corpus.filenames.has(raw) || corpus.filenames.has(stem)) continue;
    out.push({ kind: "filename", claim: m[0] });
  }

  // Dollar figures: must appear as digits anywhere in the corpus digits stream
  // OR as a substring of the normalized text. Small bare-dollar values like
  // "$0" or single-digit figures are skipped to avoid false positives.
  for (const m of body.matchAll(DOLLAR_RE)) {
    const raw = m[0];
    const key = `d:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const digits = digitsOnly(raw);
    if (!digits || digits.length < 2) continue;
    if (corpus.digits.includes(digits)) continue;
    if (corpus.text.includes(norm(raw))) continue;
    out.push({ kind: "dollar", claim: raw.trim() });
  }

  for (const m of body.matchAll(PERCENT_RE)) {
    const raw = m[0];
    const key = `p:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (corpus.text.includes(norm(raw))) continue;
    const digits = digitsOnly(raw);
    if (digits && corpus.digits.includes(digits)) continue;
    out.push({ kind: "percent", claim: raw.trim() });
  }

  for (const m of body.matchAll(NUMERIC_DATE_RE)) {
    const raw = m[0];
    const key = `nd:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (corpus.text.includes(norm(raw))) continue;
    const digits = digitsOnly(raw);
    if (digits && corpus.digits.includes(digits)) continue;
    out.push({ kind: "date", claim: raw });
  }

  for (const m of body.matchAll(MONTH_DATE_RE)) {
    const raw = m[0];
    const key = `md:${raw.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (corpus.text.includes(norm(raw))) continue;
    out.push({ kind: "date", claim: raw });
  }

  return out;
}

/** Format a banner appended (and prepended) to drafts that contained
 *  unverifiable concrete claims. The banner is intentionally prominent so it
 *  cannot be missed by an attorney scanning the draft. */
export function formatUnsupportedBanner(unsupported: Unsupported[]): string {
  if (!unsupported.length) return "";
  const lines = unsupported.map((u) => `- (${u.kind}) ${u.claim}`).join("\n");
  return [
    "> ⚠️ **EVIDENCE VERIFICATION FAILED — DO NOT FILE AS-IS**",
    ">",
    "> The following concrete claims in this draft could not be traced to any extracted document in the case corpus. They may be model hallucinations and must be independently verified or removed before use:",
    ">",
    lines.split("\n").map((l) => `> ${l}`).join("\n"),
    "",
  ].join("\n");
}

/** Build a deterministic "insufficient evidence" stub used when a draft is
 *  rejected outright because nearly all of its concrete content was
 *  unverifiable. */
export function insufficientEvidenceStub(documentType: string, unsupported: Unsupported[]): string {
  const lines = unsupported.map((u) => `- (${u.kind}) ${u.claim}`).join("\n");
  return [
    `# ${documentType} — Insufficient Evidence`,
    "",
    "The current case corpus does not contain enough verifiable evidence to support a draft of this document. Generating prose here would require inventing figures, dates, or document references that do not appear in the extracted record.",
    "",
    "## Unverifiable claims the generator attempted to use",
    "",
    lines || "- (no specific claims extracted)",
    "",
    "## What would be needed",
    "",
    "Re-run after ingesting substantive evidence (contracts, invoices, correspondence, deposition transcripts, expert reports, etc.) so that every concrete figure, date, and document reference in this draft can be traced to a verbatim source in the corpus.",
  ].join("\n");
}
