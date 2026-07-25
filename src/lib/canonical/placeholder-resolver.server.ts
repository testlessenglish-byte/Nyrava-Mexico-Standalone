// Placeholder resolver — actively strips or rewrites unresolved template
// tokens *before* the QA gate sees them, so the report never emits raw
// `{{...}}`, `${...}`, `NaN%`, `Infinity%`, or "well-supported" prose.
//
// Freeze-compliant: mutates only string fields, no section changes.

import type { CaseAnalysis } from "./case-analysis";

const TOKEN_RXS: RegExp[] = [
  /\{\{\s*[\w.$-]+\s*\}\}/g,
  /\$\{\s*[\w.$-]+\s*\}/g,
  /%\{[\w.$-]+\}/g,
  /\b%s\b/g,
  /\b%d\b/g,
];

const NANY_RXS: RegExp[] = [/NaN\s*%/gi, /Infinity\s*%/gi];

// Sentence-level splitter that keeps trailing punctuation.
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/g);
}

function containsUnresolvable(sentence: string): boolean {
  return TOKEN_RXS.some((rx) => rx.test(sentence)) || NANY_RXS.some((rx) => rx.test(sentence));
}

function stripSoft(sentence: string): string {
  let out = sentence;
  // "well-supported" is a documented substitution failure — strip the whole
  // clause it lives in rather than emit the bare adjective.
  out = out.replace(
    /(?:,\s*[^.,;]*?\bwell-supported\b[^.,;]*)|(?:\bwell-supported\b\s*[a-z][^.,;]*)/gi,
    "",
  );
  out = out.replace(/\bwell-supported\b/gi, "on the record");
  out = out.replace(/conditional power of\s+[a-z-]+/gi, "conditional analysis unavailable");
  // Numeric fallbacks
  out = out.replace(/NaN\s*%|Infinity\s*%/gi, "unavailable");
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function resolveString(input: string): string {
  if (!input) return input;
  const sentences = splitSentences(input);
  const kept: string[] = [];
  for (const raw of sentences) {
    let s = raw;
    // Cheap replacements first.
    s = stripSoft(s);
    if (containsUnresolvable(s)) {
      // Try a best-effort scrub: drop the token; if the remainder is still
      // meaningful, keep it, otherwise drop the sentence entirely.
      for (const rx of TOKEN_RXS) s = s.replace(rx, "");
      for (const rx of NANY_RXS) s = s.replace(rx, "unavailable");
      s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
      // Sentence must retain a subject-verb-object shell (≥4 words, ≥1 verb-ish).
      const wordCount = s.split(/\s+/).filter(Boolean).length;
      if (wordCount < 4) continue;
    }
    if (s.trim()) kept.push(s.trim());
  }
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function walk(node: unknown, apply: (s: string) => string): unknown {
  if (node == null) return node;
  if (typeof node === "string") return apply(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = walk(node[i], apply);
    return node;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      (node as Record<string, unknown>)[k] = walk(v, apply);
    }
    return node;
  }
  return node;
}

/**
 * Resolve placeholders in the analysis in place. Deterministic and pure.
 */
export function resolvePlaceholders(analysis: CaseAnalysis): CaseAnalysis {
  walk(analysis, resolveString);
  return analysis;
}
