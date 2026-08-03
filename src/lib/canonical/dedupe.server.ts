// De-duplication pass — collapses near-duplicate items across sections and
// removes executive-summary bullets that merely restate top findings.
//
// Freeze-compliant: never adds, removes, or reorders sections. Only trims
// duplicate items *within* existing arrays.

import type { CaseAnalysis } from "./case-analysis";

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fold accents so Spanish-language finding text dedupes correctly
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  const STOP = new Set(["the", "and", "for", "with", "that", "this", "los", "las", "del", "que", "por", "con", "para", "una"]);
  return new Set(norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function dedupeBy<T>(items: T[], keyOf: (t: T) => string, threshold = 0.85): T[] {
  const kept: T[] = [];
  const keptTokens: Set<string>[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      kept.push(item);
      keptTokens.push(new Set());
      continue;
    }
    const tks = tokens(key);
    let dup = false;
    for (const prev of keptTokens) {
      if (jaccard(tks, prev) >= threshold) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      kept.push(item);
      keptTokens.push(tks);
    }
  }
  return kept;
}

/**
 * Collapse near-duplicate items and demote executive-summary bullets that
 * restate top findings. Mutates and returns the analysis.
 */
export function dedupeAnalysis(analysis: CaseAnalysis): CaseAnalysis {
  if (!analysis || typeof analysis !== "object") return analysis;

  if (Array.isArray(analysis.Findings)) {
    analysis.Findings = dedupeBy(analysis.Findings, (f) => `${f.title} ${f.description}`);
  }
  if (Array.isArray(analysis.Recommendations)) {
    analysis.Recommendations = dedupeBy(analysis.Recommendations, (r) => r.action);
  }
  if (Array.isArray(analysis.Discovery)) {
    analysis.Discovery = dedupeBy(analysis.Discovery, (d) => `${d.topic} ${d.what_is_missing}`);
  }
  if (Array.isArray(analysis.Risks)) {
    analysis.Risks = dedupeBy(analysis.Risks, (r) => r.label);
  }
  if (analysis.Strategy?.key_moves && Array.isArray(analysis.Strategy.key_moves)) {
    analysis.Strategy.key_moves = dedupeBy(analysis.Strategy.key_moves, (s) => String(s), 0.9);
  }

  // Cross-section: drop executive-summary top_findings entries whose
  // referenced finding title is already substantively present in the
  // narrative (containment ≥ 0.85 of title tokens).
  const es = analysis.ExecutiveSummary;
  if (es && typeof es.narrative === "string" && Array.isArray(es.top_findings)) {
    const narrativeTokens = tokens(es.narrative);
    const byId = new Map(analysis.Findings.map((f) => [f.id, f]));
    es.top_findings = es.top_findings.filter((id) => {
      const f = byId.get(id);
      if (!f) return false;
      const titleTokens = tokens(f.title);
      if (titleTokens.size === 0) return true;
      let contained = 0;
      for (const t of titleTokens) if (narrativeTokens.has(t)) contained++;
      const containment = contained / titleTokens.size;
      return containment < 0.85;
    });
  }

  return analysis;
}
