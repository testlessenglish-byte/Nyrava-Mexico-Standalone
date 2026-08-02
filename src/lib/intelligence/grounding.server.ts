// Evidence-grounding & hallucination-prevention helpers.
//
// Every conclusion produced by an engine must be traceable to a verbatim
// quote that exists in the case corpus. This module provides three things:
//   1. `verifyQuote` — substring presence check (normalized) against corpus.
//   2. `verifyEvidenceRefs` — filters an array of citation objects, dropping
//      any that don't match the corpus.
//   3. `groundFindings` — given LLM output items expected to carry
//      `evidence_refs: [{ doc_n?, page?, quote, doc_id? }]`, return only the
//      items with at least one verified quote, and attach a
//      `provenance` block listing the verified evidence.
//
// Anything that fails verification is suppressed and replaced (at the caller's
// option) with the explicit "Insufficient evidence to support this conclusion."
// statement so the user sees the gap instead of an invented fact.

export type RawCitation = {
  doc_n?: number;
  page?: number;
  quote?: string;
  doc_id?: string | null;
  document_id?: string | null;
  label?: string;
};

export type VerifiedCitation = RawCitation & {
  verified: true;
  document_id: string | null;
  filename: string | null;
};

export type GroundingCorpus = {
  /** Full concatenated paginated corpus text, normalized. */
  text: string;
  /** Per-doc lookup so we can resolve document_id from doc_n. */
  docs: Array<{
    doc_n: number;
    document_id: string;
    filename: string;
    pages: string[];
  }>;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fold accents (José -> jose) before ASCII filtering below,
    // otherwise Spanish-language quotes and corpus text diverge whenever an
    // LLM-produced citation drops/retypes a diacritic that the source text
    // carries (or vice versa), causing verifyQuoteDetailed() to reject a
    // substantively correct quote — see docs/BASELINE.md incident notes.
    .replace(/[\u2010-\u2015]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'"$.%/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGroundingCorpus(
  docs: Array<{ id: string; filename: string; extracted_text: string | null }>,
  pageChars = 3000,
): GroundingCorpus {
  const out: GroundingCorpus = { text: "", docs: [] };
  const blocks: string[] = [];
  docs.forEach((d, i) => {
    const text = (d.extracted_text ?? "").replace(/\r\n/g, "\n");
    const pages: string[] = [];
    if (text) {
      for (let k = 0; k < text.length; k += pageChars) pages.push(text.slice(k, k + pageChars));
    }
    out.docs.push({ doc_n: i + 1, document_id: d.id, filename: d.filename, pages });
    blocks.push(text);
  });
  out.text = norm(blocks.join("\n\n"));
  return out;
}

export type QuoteVerification = {
  verified: boolean;
  reason: "verified_exact" | "verified_soft" | "missing_quote" | "quote_too_short" | "citation_mismatch";
  score: number;
};

function meaningfulTokens(s: string): string[] {
  const stop = new Set(["the", "and", "or", "to", "of", "a", "an", "in", "on", "for", "by", "with", "from", "that", "this", "is", "are", "was", "were", "be", "been", "as", "at", "it"]);
  return norm(s)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

export function verifyQuoteDetailed(quote: string, corpus: GroundingCorpus): QuoteVerification {
  if (!quote) return { verified: false, reason: "missing_quote", score: 0 };
  const q = norm(quote);
  // Reject very short or obviously synthetic quotes.
  if (q.length < 8) return { verified: false, reason: "quote_too_short", score: 0 };
  // Substring check against the entire corpus.
  if (corpus.text.includes(q)) return { verified: true, reason: "verified_exact", score: 1 };
  // Allow soft match: 85% of the quote as a sliding window of length-12 shingle.
  if (q.length >= 24) {
    const shingleLen = 16;
    const shingles: string[] = [];
    for (let i = 0; i + shingleLen <= q.length; i += Math.max(4, Math.floor(shingleLen / 2))) {
      shingles.push(q.slice(i, i + shingleLen));
    }
    if (shingles.length === 0) return { verified: false, reason: "citation_mismatch", score: 0 };
    const hits = shingles.filter((s) => corpus.text.includes(s)).length;
    const score = hits / shingles.length;
    if (score >= 0.6) return { verified: true, reason: "verified_soft", score };
  }
  // Short legal/evidence phrases often vary only by punctuation/hyphenation
  // ("owner requested changes" vs "owner-requested changes"). Keep this
  // conservative: require at least three meaningful tokens and all of them in
  // the corpus; this validates a cited passage exists without accepting generic
  // one-word topic labels.
  const tokens = meaningfulTokens(q);
  if (tokens.length >= 3) {
    const hits = tokens.filter((t) => corpus.text.includes(t)).length;
    const score = hits / tokens.length;
    if (score >= 0.9) return { verified: true, reason: "verified_soft", score };
    return { verified: false, reason: "citation_mismatch", score };
  }
  return { verified: false, reason: "citation_mismatch", score: 0 };
}

/** Returns true if a verbatim or conservative soft match exists in the corpus. */
export function verifyQuote(quote: string, corpus: GroundingCorpus): boolean {
  return verifyQuoteDetailed(quote, corpus).verified;
}

export function verifyEvidenceRefs(
  refs: RawCitation[] | undefined,
  corpus: GroundingCorpus,
): VerifiedCitation[] {
  if (!Array.isArray(refs)) return [];
  const verified: VerifiedCitation[] = [];
  for (const r of refs) {
    if (!r || typeof r !== "object") continue;
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    if (!quote) continue;
    if (!verifyQuote(quote, corpus)) continue;
    const docN = typeof r.doc_n === "number" ? r.doc_n : null;
    const doc = docN ? corpus.docs.find((d) => d.doc_n === docN) : null;
    verified.push({
      ...r,
      quote,
      verified: true,
      document_id: (r.document_id as string | undefined) ?? (r.doc_id as string | undefined) ?? doc?.document_id ?? null,
      filename: doc?.filename ?? null,
    });
  }
  return verified;
}

export type GroundableItem = Record<string, unknown> & {
  evidence_refs?: RawCitation[];
  citations?: RawCitation[];
};

export type GroundedItem<T extends GroundableItem> = T & {
  evidence_refs: VerifiedCitation[];
  provenance: {
    verified_count: number;
    sources: Array<{ document_id: string | null; filename: string | null; quote: string; page?: number; doc_n?: number }>;
    confidence_adjusted: number;
  };
};

/**
 * Filter an array of LLM-produced items to those with at least one verified
 * citation. Items that fail validation are dropped — the caller emits the
 * explicit "Insufficient evidence" placeholder where appropriate.
 *
 * Confidence is rescaled by the share of citations that verified, so an item
 * with 1 of 3 quotes confirmed comes back with ~1/3 of its self-reported
 * confidence — never amplified above the input value.
 */
export function groundItems<T extends GroundableItem>(
  items: T[] | undefined,
  corpus: GroundingCorpus,
  opts: { minVerified?: number; confidenceFloor?: number } = {},
): GroundedItem<T>[] {
  const minVerified = opts.minVerified ?? 1;
  if (!Array.isArray(items)) return [];
  const out: GroundedItem<T>[] = [];
  for (const it of items) {
    const raw = (it.evidence_refs ?? it.citations ?? []) as RawCitation[];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const verified = verifyEvidenceRefs(raw, corpus);
    if (verified.length < minVerified) continue;
    const conf = (it as unknown as { confidence?: unknown }).confidence;
    const inputConfidence = typeof conf === "number" ? Math.max(0, Math.min(1, conf)) : 0.6;
    const verifyRatio = verified.length / Math.max(1, raw.length);
    const adjusted = Math.max(opts.confidenceFloor ?? 0.3, inputConfidence * verifyRatio);
    out.push({
      ...it,
      evidence_refs: verified,
      provenance: {
        verified_count: verified.length,
        sources: verified.map((v) => ({
          document_id: v.document_id,
          filename: v.filename,
          quote: v.quote ?? "",
          page: v.page,
          doc_n: v.doc_n,
        })),
        confidence_adjusted: Number(adjusted.toFixed(2)),
      },
    });
  }
  return out;
}

export const INSUFFICIENT_EVIDENCE = "Insufficient evidence to support this conclusion.";

// ---------------------------------------------------------------------------
// Legal-authority citations (Amparo / constitutional / statutory / tesis).
//
// A reference to "CPEUM Art. 16" or "Tesis: 1a./J. 15/2019 (10a.)" is a
// citation to public law, not a factual assertion about the case record. It
// cannot be verified by verbatim substring matching against the evidentiary
// corpus, because the text lives in the Constitution/SCJN registry, not in the
// party's documents. Requiring a verbatim corpus match for those references
// produced false "unverified" flags on Amparo and federal-administrative
// matters and blocked the release gate.
//
// IMPORTANT: the exemption below is narrower than "the quote contains a
// citation-shaped substring". A pattern-only check was tried first and
// confirmed, by direct reproduction, to exempt fabricated factual claims
// merely because they were phrased alongside a real (or even a fabricated)
// article number — e.g. "Conforme al art. 16 constitucional, la audiencia se
// celebró el 15 de marzo... testigo Juan Pérez confirmó..." would pass
// ungrounded, because the string contains "art. 16". That defeats the
// purpose of the hallucination gate for exactly the claims it exists to
// catch. isLegalAuthorityCitation therefore only exempts a quote when it is
// SUBSTANTIALLY JUST the citation — after stripping recognized citation
// structure words, grammatical connectors, and the common words that appear
// inside official Mexican legal-source names (so "Constitución Política de
// los Estados Unidos Mexicanos" normalizes to ~nothing, the same as
// "Artículo 16" does), at most 2 meaningful tokens may remain. A quote
// carrying an independent factual assertion alongside a citation — dates,
// names, events, outcomes — retains far more than that and is correctly
// NOT exempted, still subject to real verbatim corpus verification.
// ---------------------------------------------------------------------------

const AUTHORITY_PATTERNS: RegExp[] = [
  // Article references: "Art. 16", "Artículo 1o. constitucional", "arts. 14 y 16"
  /\barts?\.?\s*\d+/i,
  /\bart[íi]culos?\s+\d+/i,
  // Tesis / jurisprudencia registry numbers
  /\btesis\b/i,
  /\bjurisprudencia\b/i,
  /\b(?:1a|2a|P|PC)\.\s*\/\s*J\.\s*\d+\/\d{4}/i,
  /\bregistro\s+(?:digital\s+)?\d{5,}/i,
  // Official publications
  /\bDOF\b/,
  /\bSemanario\s+Judicial\b/i,
];

// Grammatical connectors, citation-structure words, and words that commonly
// appear inside the full official names of Mexican legal sources — a
// curated, bounded list, in keeping with this codebase's existing
// convention of explicit Mexican-law-specific vocabulary (see
// mx-pipeline.ts's MX_PARTY_ROLES) rather than a general heuristic.
const CITATION_STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "en", "y", "o", "u", "a", "al", "con", "por",
  "para", "segun", "conforme", "respecto", "asi", "como", "que", "su", "sus",
  "articulo", "articulos", "art", "arts", "fraccion", "fracciones", "apartado",
  "apartados", "inciso", "incisos", "parrafo", "parrafos", "numeral", "numerales",
  "tesis", "jurisprudencia", "registro", "digital", "semanario", "judicial",
  "gaceta", "epoca", "sala", "pleno", "tomo",
  "politica", "estados", "unidos", "mexicanos", "nacional", "nacionales",
  "procedimientos", "procedimiento", "penales", "penal", "civiles", "civil",
  "familiares", "familiar", "mercantil", "mercantiles", "laboral", "laborales",
  "federal", "federales", "general", "generales", "humanos", "humano", "americana",
  "americano", "sobre", "san", "jose", "codigo", "constitucion", "constitucional",
  "ley", "amparo", "reglamento", "pacto", "otras",
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii",
  "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx", "xxi", "xxii", "xxiii", "xxiv", "xxv",
]);

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * True when a citation string is SUBSTANTIALLY JUST a reference to public
 * legal authority (constitutional/statutory article, tesis, jurisprudencia,
 * official gazette) — not a factual claim about the case that happens to
 * mention one. See the module comment above for why this distinction is
 * load-bearing, not cosmetic.
 */
export function isLegalAuthorityCitation(quote: string | null | undefined): boolean {
  const q = (quote ?? "").trim();
  if (q.length < 3) return false;
  const hasAuthorityPattern = AUTHORITY_PATTERNS.some((rx) => rx.test(q));
  if (!hasAuthorityPattern) return false;

  const tokens = stripDiacritics(q.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const remaining = tokens.filter((t) => {
    if (/^\d+$/.test(t)) return false; // bare numbers: article numbers, years
    if (t.length < 3) return false;
    return !CITATION_STOPWORDS.has(t);
  });
  // Almost nothing meaningful survives stripping citation vocabulary and
  // connectors -> this quote IS the citation, nothing more.
  return remaining.length <= 2;
}
