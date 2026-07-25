// Generic Mexican legal citation extraction — pure text parsing, no network
// access required, so this is safe to build and test now regardless of
// which connector eventually feeds it real documents.
//
// Recognizes the standard Mexican legal citation conventions: article
// references ("Artículo 123 de la Ley Federal del Trabajo", "Art. 4o.
// Constitucional"), tesis/jurisprudencia registry numbers ("Tesis:
// 1a./J. 15/2019 (10a.)", "2a./J. 45/2020"), and code/law short-name
// references (LFT, CCF, CNPP, CPF, CPEUM, etc.).
//
// Deliberately conservative: false negatives (missing a citation) are far
// safer than false positives (inventing a match) for something feeding a
// verification gate — see legal-authority-verify.server.ts.

import type { ExtractedCitation } from "./types";

const KNOWN_CODE_ABBREVIATIONS = [
  "CPEUM", "CCF", "CNPCF", "CPF", "CNPP", "LFT", "LA", "LGSM", "LGT",
  "LGS", "LFPC", "CFF", "CCom",
] as const;

const ARTICLE_PATTERN =
  /\bArt(?:ículo|\.)\s+(\d+(?:\s?(?:Bis|Ter|Quáter)?)(?:-[A-Z])?)\s*(?:de\s+la|del)?\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.\s]{2,60})?/gu;

const TESIS_PATTERN =
  /\b(?:Tesis:?\s*)?((?:1a\.|2a\.|P\.|PC\.|[IVXLC]+\.[0-9]+o?\.)\s*\/(?:J\.|A\.)\s*\d+\/\d{4}\s*\(\d+a?\.\))/gu;

export function extractCitationsFromText(text: string): ExtractedCitation[] {
  const found: ExtractedCitation[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(ARTICLE_PATTERN)) {
    const articleNum = m[1]?.trim();
    const lawName = m[2]?.trim();
    if (!articleNum) continue;
    const display = lawName ? `Art. ${articleNum} de ${lawName}` : `Art. ${articleNum}`;
    if (seen.has(display)) continue;
    seen.add(display);
    found.push({ citationText: display, citedAuthorityHint: lawName });
  }

  for (const m of text.matchAll(TESIS_PATTERN)) {
    const display = `Tesis: ${m[1].trim()}`;
    if (seen.has(display)) continue;
    seen.add(display);
    found.push({ citationText: display });
  }

  // Bare code-abbreviation mentions (e.g. "conforme al LFT") without an
  // article number attached — lower-confidence, still worth surfacing.
  for (const abbr of KNOWN_CODE_ABBREVIATIONS) {
    const re = new RegExp(`\\b${abbr}\\b`, "g");
    if (re.test(text) && !seen.has(abbr)) {
      seen.add(abbr);
      found.push({ citationText: abbr, citedAuthorityHint: abbr });
    }
  }

  return found;
}
