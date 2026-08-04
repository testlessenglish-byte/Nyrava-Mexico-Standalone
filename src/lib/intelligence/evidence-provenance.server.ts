// Evidence provenance — real character-offset citation location and
// cryptographic hashing, layered on top of grounding.server.ts's existing
// substring/shingle verification.
//
// Phase 1 of the evidence-provenance roadmap. Scope, stated plainly:
//   DONE  — exact character-offset location of a verified quote within its
//           SPECIFIC source document (not just "somewhere in the corpus"),
//           page-number derivation, and SHA-256 hashing of documents and
//           individual citations.
//   NOT DONE — persisting these hashes onto findings so a later document
//           edit can be detected and trigger re-analysis ("if a document
//           changes, invalidate findings"). That requires a schema change
//           (a hash column on findings/citations, written at insert time)
//           and an invalidation job, and is a distinct, larger follow-up —
//           not silently skipped, just not part of this slice.
//
// Design principle carried over from grounding.server.ts: never fabricate
// precision. An offset is only ever recorded when a real, locatable,
// contiguous span was found. A citation that only passed grounding's
// soft/shingle fuzzy match (by construction, not a single contiguous span)
// gets no offset — "verified but location approximate" is reported
// honestly as no offset, never as a made-up one.

import { createHash } from "node:crypto";

/** SHA-256 of a UTF-8 string, hex-encoded. Used for document, chunk, and citation fingerprints. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Lowercase + diacritic-strip ONLY — deliberately NOT the heavier
 * normalization in grounding.server.ts's norm() (which also collapses
 * whitespace and filters punctuation, both of which change string length
 * and would break position mapping back to the raw source text).
 *
 * Length-preserving for Spanish-language text: NFD-decomposing an accented
 * Latin character (á, é, í, ó, ú, ñ, ü) yields exactly one base character
 * plus one combining mark; stripping the combining mark leaves exactly one
 * character where the original had exactly one — so index N in the
 * light-normalized string is always index N in the raw string.
 */
export function lightNormalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export type QuoteLocation = { start: number; end: number };

/**
 * Find the exact character range of `quote` inside `rawText`, case- and
 * accent-insensitively, preserving true offsets into `rawText` (not into
 * any normalized copy). Returns the FIRST occurrence — a quote that
 * legitimately appears more than once in a document has no single "correct"
 * offset without more context than a citation carries, so the first
 * occurrence is the honest, deterministic choice rather than guessing.
 *
 * Returns null when no exact (case/accent-insensitive) contiguous match
 * exists — e.g. the quote only matched via grounding's whitespace-collapsing
 * or token-shingle fuzzy paths, which by construction don't correspond to a
 * single span in the source.
 */
export function locateQuoteInText(quote: string, rawText: string): QuoteLocation | null {
  const q = quote.trim();
  if (q.length < 8 || !rawText) return null;
  const normText = lightNormalize(rawText);
  const normQuote = lightNormalize(q);
  const start = normText.indexOf(normQuote);
  if (start < 0) return null;
  return { start, end: start + normQuote.length };
}

/** 1-indexed page number for a character offset, given the fixed page size grounding.server.ts paginates with. */
export function pageForOffset(offset: number, pageChars: number): number {
  return Math.floor(offset / pageChars) + 1;
}

/**
 * Deterministic fingerprint for one citation: same document + same quote +
 * same location always hashes identically, so two independently-generated
 * reports citing the same evidence produce the same citation_hash — the
 * "reproducible" requirement from the provenance spec.
 */
export function citationHash(args: {
  documentId: string | null;
  quote: string;
  start: number | null;
  end: number | null;
}): string {
  return sha256Hex(`${args.documentId ?? "?"}::${args.start ?? "?"}::${args.end ?? "?"}::${args.quote.trim()}`);
}
