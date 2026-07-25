// Deterministic professional-prose pass.
//
// Freeze-compliant: does not add, remove, reorder, or rename sections. Only
// rewrites individual sentences in place to remove mechanical AI cadence and
// repeated openers. Output is a function of (input, seed) so re-runs produce
// identical text.
//
// Applied by the canonical gate immediately before validation, after the
// report-normalize pass has removed blanks and dupes.

// Rotation table — attorney-style substitutes for banned openers.
const OPENERS: Array<{ rx: RegExp; alts: string[] }> = [
  {
    rx: /^(\s*)(?:the\s+)?evidence supports\b/i,
    alts: [
      "The record supports",
      "The corpus establishes",
      "The documentary record confirms",
      "Documentary evidence establishes",
    ],
  },
  {
    rx: /^(\s*)(?:the\s+)?evidence suggests\b/i,
    alts: [
      "The record indicates",
      "The corpus suggests",
      "The documentary record reflects",
    ],
  },
  {
    rx: /^(\s*)it is important to note that\s*/i,
    alts: ["", "", ""],
  },
  {
    rx: /^(\s*)it should be noted that\s*/i,
    alts: ["", "", ""],
  },
  {
    rx: /^(\s*)this indicates\b/i,
    alts: [
      "This shows",
      "This demonstrates",
      "This establishes",
    ],
  },
  {
    rx: /^(\s*)well-supported\b/i,
    alts: [
      "Substantiated on the record",
      "Corroborated by the corpus",
    ],
  },
  {
    rx: /^(\s*)based on the available evidence,?\s*/i,
    alts: ["On this record, ", "Given the corpus, ", ""],
  },
];

// Inline rewrites — applied everywhere in the sentence, not just at the start.
const INLINE: Array<{ rx: RegExp; replace: string }> = [
  { rx: /\bit is important to note that\s*/gi, replace: "" },
  { rx: /\bit should be noted that\s*/gi, replace: "" },
  { rx: /\bit is worth noting that\s*/gi, replace: "" },
  { rx: /\bin conclusion,?\s*/gi, replace: "" },
  { rx: /\bas such,?\s*/gi, replace: "Accordingly, " },
  { rx: /\bin the realm of\b/gi, replace: "in" },
  { rx: /\bdelve into\b/gi, replace: "examine" },
  { rx: /\bleverage\b/gi, replace: "use" },
  { rx: /\butilize\b/gi, replace: "use" },
  { rx: /\bin order to\b/gi, replace: "to" },
  { rx: /\bat this point in time\b/gi, replace: "now" },
  { rx: /\bdue to the fact that\b/gi, replace: "because" },
  { rx: /\bin the event that\b/gi, replace: "if" },
  { rx: /\bfor the purpose of\b/gi, replace: "to" },
  { rx: /\bwith regard to\b/gi, replace: "regarding" },
  { rx: /\bmay potentially\b/gi, replace: "may" },
  { rx: /\bcould potentially\b/gi, replace: "could" },
  { rx: /\bactually\b/gi, replace: "" },
  { rx: /\bvery unique\b/gi, replace: "unique" },
  { rx: /\bvery important\b/gi, replace: "material" },
  { rx: /\bnavigate the complexities of\b/gi, replace: "address" },
  { rx: /\bit goes without saying that\s*/gi, replace: "" },
  { rx: /\bat the end of the day,?\s*/gi, replace: "" },
  { rx: /\s{2,}/g, replace: " " },
  { rx: /\s+([,.;:!?])/g, replace: "$1" },
];

// Varied transitions to insert when a paragraph chains too many short
// declaratives with the same opener.
const TRANSITIONS = ["Moreover, ", "By contrast, ", "Notably, ", "Further, ", "In addition, "];

// FNV-1a — small, dependency-free deterministic hash.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function pick<T>(arr: T[], seed: string, salt: number): T {
  const idx = (fnv1a(seed) + salt) % arr.length;
  return arr[idx];
}

function polishSentence(sentence: string, seed: string, salt: number): string {
  let out = sentence;
  for (const { rx, alts } of OPENERS) {
    const m = out.match(rx);
    if (m) {
      const lead = m[1] ?? "";
      const alt = pick(alts, seed + rx.source, salt);
      out = lead + alt + out.slice(m[0].length);
      if (alt === "") out = out.replace(/^\s*[a-z]/, (c) => c.toUpperCase());
      break;
    }
  }
  for (const { rx, replace } of INLINE) out = out.replace(rx, replace);
  // Capitalize first non-space letter.
  out = out.replace(/^(\s*)([a-z])/, (_, s, c) => s + c.toUpperCase());
  return out.trim();
}

function splitSentences(text: string): string[] {
  // Simple splitter — good enough for prose polish; preserves trailing punctuation.
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z(])/g);
  return parts;
}

/**
 * Polish a single string. Deterministic in `(text, seed)`.
 */
export function polishText(text: string, seed = "case"): string {
  if (!text || typeof text !== "string") return text ?? "";
  const paragraphs = text.split(/\n{2,}/);
  const outParas: string[] = [];
  for (const para of paragraphs) {
    const sentences = splitSentences(para);
    const openerCounts = new Map<string, number>();
    const polished: string[] = [];
    let lastStem = "";
    let sameStemStreak = 0;
    for (let i = 0; i < sentences.length; i++) {
      let p = polishSentence(sentences[i], seed, i);
      const stem = p.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
      const n = (openerCounts.get(stem) ?? 0) + 1;
      openerCounts.set(stem, n);
      if (n >= 2 && p.length < 200) {
        // second sentence starting with same 3-word stem — drop it.
        continue;
      }
      // Structural variance: inject a varied transition if three consecutive
      // sentences share the same opener stem.
      if (stem === lastStem) {
        sameStemStreak++;
      } else {
        sameStemStreak = 0;
      }
      if (sameStemStreak >= 2 && p.length < 240) {
        const trans = pick(TRANSITIONS, seed + ":trans", i);
        p = trans + p.charAt(0).toLowerCase() + p.slice(1);
        sameStemStreak = 0;
      }
      lastStem = stem;
      polished.push(p);
    }
    outParas.push(polished.join(" ").replace(/\s{2,}/g, " ").trim());
  }
  return outParas.filter(Boolean).join("\n\n");
}

/**
 * Polish the free-prose fields of a canonical analysis in place. Returns the
 * same object for chainability. Never touches structural data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function polishAnalysisProse(analysis: any, seed = "case"): any {
  if (!analysis || typeof analysis !== "object") return analysis;
  const es = analysis.ExecutiveSummary;
  if (es) {
    if (typeof es.narrative === "string") es.narrative = polishText(es.narrative, seed + ":exec");
    if (typeof es.headline === "string") es.headline = polishText(es.headline, seed + ":headline");
  }
  if (analysis.Facts && typeof analysis.Facts.narrative === "string") {
    analysis.Facts.narrative = polishText(analysis.Facts.narrative, seed + ":facts");
  }
  if (Array.isArray(analysis.Findings)) {
    for (const f of analysis.Findings) {
      if (typeof f?.description === "string") f.description = polishText(f.description, seed + ":find");
      if (typeof f?.legal_significance === "string") f.legal_significance = polishText(f.legal_significance, seed + ":legal");
    }
  }
  if (Array.isArray(analysis.WorkProduct)) {
    for (const w of analysis.WorkProduct) {
      if (typeof w?.body === "string") w.body = polishText(w.body, seed + ":wp:" + (w.id ?? ""));
    }
  }
  if (Array.isArray(analysis.Recommendations)) {
    for (const r of analysis.Recommendations) {
      if (typeof r?.rationale === "string") r.rationale = polishText(r.rationale, seed + ":rec");
    }
  }
  return analysis;
}
