// Claim-Strength Guardrail
// ============================================================================
// Enforces: "No generated sentence may make a stronger claim than its strongest
// cited source." Goes beyond intensity to compare CLAIM CERTAINTY, plus:
//   - Evidence-type ceilings (witness testimony ≠ "fabricated")
//   - Legal Risk Lexicon (Tier 5 terms require corroboration in corpus)
//   - Intent-inference block (no "intentionally / knowingly" without source)
//   - Source-span validation (drop sentences with no support, don't just soften)
//   - Red-team rewrite (overstated sentences are downgraded automatically)
//
// All logic is deterministic, runs server-side, and is applied AFTER LLM output
// so the model can't bypass it.
//
// CHANGE (recall fix): enforceProse() previously appended a
// "_Note: N softened / M dropped_" line to the END OF EVERY PROSE BLOCK it
// was called on. When the pipeline calls it once per report section (up to
// ~18 times — executive_summary, facts, discovery_analysis, etc.), the
// reader sees that note repeated up to 18 times in one report. This is
// case-agnostic: it happens on every report, it just gets worse the more
// sections get softened. Fix: enforceProse() now takes an `appendNote`
// option (default true, preserving old behavior for any other caller) so
// the pipeline can turn inline notes OFF and instead surface ONE aggregate
// note at the end of the report, built from the totals it already computes
// per field. See formatGuardrailNote() below for the single-footer helper.

import type { GroundingCorpus } from "./grounding.server";
import { verifyQuote } from "./grounding.server";

// ── Claim strength tiers (0 = weakest, 5 = strongest) ─────────────────────────
export const CLAIM_TIERS = {
  0: ["possibly", "perhaps", "might", "may", "could", "conceivably"],
  1: ["suggests", "indicates", "appears to", "seems to", "hints", "tends to"],
  2: ["supports", "is consistent with", "reasonably implies", "points toward"],
  3: ["shows", "demonstrates", "establishes", "confirms", "evidences"],
  4: ["proves", "is", "was", "did", "occurred", "happened", "stated", "testified"],
  5: [
    "lied",
    "lying",
    "fabricated",
    "fabrication",
    "falsified",
    "falsification",
    "perjury",
    "perjured",
    "fraud",
    "fraudulent",
    "fraudulently",
    "cover-up",
    "coverup",
    "conspiracy",
    "conspired",
    "destroyed evidence",
    "spoliation",
    "intentional misconduct",
    "criminal",
    "corrupt",
    "corruption",
    "obstruction",
    "obstructed justice",
    "tampered",
    "bribed",
    "bribery",
  ],
} as const;

// Highest-risk terms — require ≥2 independent corroborating quotes in corpus
export const TIER5_TERMS: readonly string[] = CLAIM_TIERS[5];

// Intent words — require source-text support for the intent itself
export const INTENT_TERMS: readonly string[] = [
  "intentionally",
  "deliberately",
  "knowingly",
  "willfully",
  "purposely",
  "purposefully",
  "recklessly",
  "maliciously",
  "fraudulently",
  "wantonly",
  "with intent",
  "with the intent",
  "in bad faith",
];

// Evidence-type ceilings — what conclusions a given evidence type can DIRECTLY support
export const EVIDENCE_CEILINGS: Record<string, { allows: string[]; forbids: string[] }> = {
  witness_testimony: {
    allows: ["observed", "heard", "recalled", "reported", "stated", "testified", "described"],
    forbids: ["lied", "fabricated", "falsified", "perjury", "fraud", "conspired"],
  },
  audit_log: {
    allows: ["timestamp", "access", "login", "absence", "inconsistency", "mismatch"],
    forbids: ["intentional", "deception", "cover-up", "fraud", "falsified"],
  },
  document: {
    allows: ["records", "states", "shows", "reflects", "indicates"],
    forbids: ["intent", "motive", "knowingly"],
  },
};

// ── Sentence scoring ──────────────────────────────────────────────────────────
function lower(s: string): string {
  return s.toLowerCase();
}

/** Score the strongest claim tier present in a sentence. Returns 0..5. */
export function scoreClaimStrength(sentence: string): number {
  const t = lower(sentence);
  for (let tier = 5; tier >= 0; tier--) {
    const words = CLAIM_TIERS[tier as 0 | 1 | 2 | 3 | 4 | 5];
    for (const w of words) {
      // word-boundary-ish match for multiword phrases
      const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
      if (re.test(t)) return tier;
    }
  }
  return 1; // unmarked statements default to "suggestion" strength
}

/** Score the strongest claim tier present anywhere in a list of source spans. */
export function scoreSourceStrength(spans: string[]): number {
  let best = 0;
  for (const s of spans) {
    const x = scoreClaimStrength(s);
    if (x > best) best = x;
  }
  return best;
}

// ── Downgrade rewriter ────────────────────────────────────────────────────────
//
// Replacements are designed to be grammatically substitutable wherever the
// original word appeared (as the object of "alleges", after "of", as a bare
// noun, etc.). Each replacement is a SELF-CONTAINED NOUN PHRASE for noun
// forms and a SELF-CONTAINED VERB PHRASE for verb forms, so we don't produce
// fragments like "alleges appears inconsistent with the record".
const DOWNGRADE_MAP: Array<{ from: RegExp; to: string }> = [
  // Tier 5 — noun forms
  { from: /\b(falsification|fabrication)\b/gi, to: "documentation discrepancy" },
  { from: /\b(perjury)\b/gi, to: "testimony inconsistent with other evidence" },
  { from: /\b(fraud)\b/gi, to: "documentation discrepancy" },
  { from: /\b(fraudulent)\b/gi, to: "questionable" },
  { from: /\b(fraudulently)\b/gi, to: "" },
  { from: /\b(cover[- ]?up|coverup)\b/gi, to: "gap in the record warranting review" },
  { from: /\b(conspiracy)\b/gi, to: "potential coordination warranting further investigation" },
  { from: /\b(spoliation|destroyed evidence)\b/gi, to: "is associated with missing or unavailable evidence" },
  { from: /\b(obstruction(?: of justice)?)\b/gi, to: "potential impediment to the process" },
  { from: /\b(bribery)\b/gi, to: "financial transaction warranting scrutiny" },
  { from: /\b(corruption)\b/gi, to: "irregularity" },
  // Tier 5 — transitive verb forms. These are designed to remain readable
  // when a direct object follows ("falsified records", "fabricated entries").
  { from: /\b(lied)\b/gi, to: "made statements potentially inconsistent with other evidence regarding" },
  { from: /\b(lying)\b/gi, to: "potentially inconsistent" },
  { from: /\b(falsified)\b/gi, to: "made entries inconsistent with other evidence regarding" },
  { from: /\b(fabricated)\b/gi, to: "produced uncorroborated" },
  { from: /\b(perjured)\b/gi, to: "gave testimony inconsistent with other evidence" },
  { from: /\b(conspired)\b/gi, to: "may have coordinated, warranting further investigation" },
  { from: /\b(obstructed)\b/gi, to: "may have impeded" },
  { from: /\b(tampered)\b/gi, to: "showed signs of alteration warranting review" },
  { from: /\b(bribed)\b/gi, to: "received a financial transaction warranting scrutiny from" },
  { from: /\b(corrupt)\b/gi, to: "potentially improper" },
  // Tier 4 → Tier 2
  { from: /\b(proves|established|conclusively shows)\b/gi, to: "is consistent with" },
  { from: /\b(demonstrates)\b/gi, to: "suggests" },
  { from: /\b(confirms)\b/gi, to: "supports" },
];

const INTENT_DOWNGRADE: Array<{ from: RegExp; to: string }> = [
  {
    from: /\b(intentionally|deliberately|knowingly|willfully|purpos(?:e|ef)ully|maliciously|fraudulently|wantonly)\s+/gi,
    to: "",
  },
  { from: /\bwith (?:the )?intent (?:to|of)\b/gi, to: "in a manner that" },
  { from: /\bin bad faith\b/gi, to: "" },
];

/** Post-pass grammar cleanup for awkward residue after substitutions. */
function cleanupGrammar(s: string): string {
  return (
    s
      // "documentation discrepancy of records" → "documentation discrepancy in the records"
      .replace(
        /\b(discrepancy|inconsistency|alteration|gap|impediment)\s+of\s+(records?|the\s+records?)\b/gi,
        "$1 in the records",
      )
      // "record of records" / "records of records" → "records"
      .replace(/\b(records?)\s+of\s+\1\b/gi, "$1")
      // Duplicate adjacent nouns: "records records", "evidence evidence"
      .replace(/\b(records?|evidence|testimony|documentation)\s+\1\b/gi, "$1")
      // Dangling prepositions left after intent stripping: "alleges of X" → "alleges X"
      .replace(/\b(allege[sd]?|claim[sd]?|assert[sd]?)\s+(?:of|in|to|that)\s+(?=[a-z])/gi, "$1 ")
      // "regarding about/of/on/in X" → "regarding X"
      .replace(/\b(regarding)\s+(?:about|of|on|in)\s+/gi, "$1 ")
      // "uncorroborated/inconsistent/improper/questionable the X" → drop "the"
      .replace(/\b(uncorroborated|inconsistent|improper|questionable|potentially improper)\s+the\b/gi, "$1")
      // Double prepositions: "of of", "in in"
      .replace(/\b(of|in|to|that)\s+\1\b/gi, "$1")
      // "the the" / "a a"
      .replace(/\b(the|a|an)\s+\1\b/gi, "$1")
      // Whitespace and punctuation hygiene
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim()
  );
}

/** Apply downgrades to bring sentence to <= targetTier. */
export function softenSentence(sentence: string, targetTier: number): string {
  let out = sentence;
  if (targetTier < 5) for (const r of DOWNGRADE_MAP) out = out.replace(r.from, r.to);
  return cleanupGrammar(out);
}

/** Strip intent words. */
export function stripIntent(sentence: string): string {
  let out = sentence;
  for (const r of INTENT_DOWNGRADE) out = out.replace(r.from, r.to);
  return cleanupGrammar(out);
}

// ── Per-sentence enforcement ──────────────────────────────────────────────────
export type EnforcementResult = {
  text: string;
  softened: boolean;
  dropped: boolean;
  violations: string[];
};

export type EnforceOpts = {
  corpus: GroundingCorpus;
  /** Optional cited source spans for this specific sentence. */
  citedSpans?: string[];
  /** Evidence types backing this sentence (for ceiling enforcement). */
  evidenceTypes?: string[];
  /** Drop sentences with no corpus support at all (used for prose, not structured items by default). */
  requireSupport?: boolean;
};

function corroborationCount(terms: string[], corpus: GroundingCorpus): number {
  const seen = new Set<string>();
  for (const t of terms) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(corpus.text)) !== null) {
      // distinct "document region" approximated by 200-char window
      seen.add(String(Math.floor(m.index / 200)));
      if (seen.size >= 2) return seen.size;
    }
  }
  return seen.size;
}

/** Enforce all guardrails on a single sentence. */
export function enforceSentence(sentence: string, opts: EnforceOpts): EnforcementResult {
  const violations: string[] = [];
  let text = sentence;
  let softened = false;
  let dropped = false;

  const lc = lower(text);

  // 1. Tier 5 legal-risk terms — require ≥2 corroborating corpus mentions
  const tier5Hits = TIER5_TERMS.filter((t) => lc.includes(t));
  if (tier5Hits.length > 0) {
    const support = corroborationCount(tier5Hits, opts.corpus);
    if (support < 2) {
      violations.push(`tier5_uncorroborated:${tier5Hits.join(",")}`);
      text = softenSentence(text, 2);
      softened = true;
    }
  }

  // 2. Intent words — require the intent itself to appear in corpus
  const intentHits = INTENT_TERMS.filter((t) => lc.includes(t));
  if (intentHits.length > 0) {
    const intentInCorpus = intentHits.some((w) => opts.corpus.text.includes(w));
    if (!intentInCorpus) {
      violations.push(`intent_unsupported:${intentHits.join(",")}`);
      text = stripIntent(text);
      softened = true;
    }
  }

  // 3. Claim-strength ceiling vs cited source spans
  if (opts.citedSpans && opts.citedSpans.length > 0) {
    const genStrength = scoreClaimStrength(text);
    const srcStrength = scoreSourceStrength(opts.citedSpans);
    if (genStrength > srcStrength) {
      violations.push(`overstated:${genStrength}>${srcStrength}`);
      text = softenSentence(text, srcStrength);
      softened = true;
    }
  }

  // 4. Evidence-type ceiling
  if (opts.evidenceTypes && opts.evidenceTypes.length > 0) {
    for (const et of opts.evidenceTypes) {
      const ceil = EVIDENCE_CEILINGS[et];
      if (!ceil) continue;
      for (const f of ceil.forbids) {
        if (lc.includes(f)) {
          violations.push(`evidence_ceiling:${et}:${f}`);
          text = softenSentence(text, 2);
          softened = true;
          break;
        }
      }
    }
  }

  // 5. Source-span validation — if requireSupport, drop sentences with no corpus hits
  if (opts.requireSupport) {
    // Heuristic: at least one 12-char shingle of the sentence must appear in corpus
    const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (norm.length >= 24) {
      const shingles: string[] = [];
      for (let i = 0; i + 16 <= norm.length; i += 16) shingles.push(norm.slice(i, i + 16));
      const hits = shingles.filter((s) => opts.corpus.text.includes(s)).length;
      if (hits === 0) {
        violations.push("no_corpus_support");
        dropped = true;
      }
    }
  }

  // 6. Red-team final pass — sentences still asserting Tier 4+ language without
  //    citation get downgraded one tier as a defensive default.
  if (!dropped && !opts.citedSpans && scoreClaimStrength(text) >= 4) {
    const before = text;
    text = softenSentence(text, 3);
    if (text !== before) {
      softened = true;
      violations.push("red_team_uncited_assertion");
    }
  }

  return { text, softened, dropped, violations };
}

// ── Prose-level enforcement ───────────────────────────────────────────────────
function splitSentences(prose: string): string[] {
  // Conservative splitter: keep markdown bullets and newlines as their own units.
  const out: string[] = [];
  const blocks = prose.split(/\n+/);
  for (const block of blocks) {
    if (!block.trim()) {
      out.push("");
      continue;
    }
    const parts = block.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [block];
    for (const p of parts) out.push(p);
    out.push("\n");
  }
  return out;
}

export type ProseEnforcement = {
  text: string;
  totalSentences: number;
  softenedCount: number;
  droppedCount: number;
  violations: string[];
};

/**
 * Build a single footer note summarizing however many prose blocks were
 * softened/dropped across an ENTIRE report. Call this once, after all
 * enforceProse() calls for a report have finished, with the totals summed
 * across every section — not once per section. See usage note at top of file.
 */
export function formatGuardrailNote(totalSoftened: number, totalDropped: number): string {
  return `_Note: ${totalSoftened} statement(s) were automatically softened and ${totalDropped} dropped across this report by the claim-strength guardrail (no overstated or unsupported conclusions)._`;
}

/**
 * Enforce claim-strength on a block of prose. Sentences are softened or dropped.
 *
 * `appendNote` controls whether the "_Note: N softened..._" line is appended
 * directly to the returned text for THIS block. Defaults to true for
 * backward compatibility with any caller that still wants a self-contained
 * block. The main report pipeline should pass `appendNote: false` and
 * instead call formatGuardrailNote() ONCE with totals summed across every
 * section it processes — otherwise a report with many narrative sections
 * ends up with the same note repeated once per section.
 */
export function enforceProse(
  prose: string,
  opts: Omit<EnforceOpts, "citedSpans"> & { requireSupport?: boolean; appendNote?: boolean },
): ProseEnforcement {
  if (!prose || typeof prose !== "string") {
    return { text: prose ?? "", totalSentences: 0, softenedCount: 0, droppedCount: 0, violations: [] };
  }
  const appendNote = opts.appendNote ?? true;
  const sentences = splitSentences(prose);
  const kept: string[] = [];
  let softenedCount = 0;
  let droppedCount = 0;
  const violations: string[] = [];
  let total = 0;
  for (const s of sentences) {
    if (s === "\n" || !s.trim()) {
      kept.push(s);
      continue;
    }
    total++;
    const r = enforceSentence(s, opts);
    if (r.dropped) {
      droppedCount++;
      violations.push(...r.violations);
      continue;
    }
    if (r.softened) softenedCount++;
    violations.push(...r.violations);
    kept.push(r.text);
  }
  let text = kept
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (appendNote && (softenedCount > 0 || droppedCount > 0)) {
    text += `\n\n${formatGuardrailNote(softenedCount, droppedCount)}`;
  }
  return { text, totalSentences: total, softenedCount, droppedCount, violations };
}

/** Enforce on structured items: rewrites description-like fields in place. */
export function enforceStructuredItems<T extends Record<string, unknown>>(
  items: T[],
  opts: Omit<EnforceOpts, "citedSpans">,
  fields: string[] = ["description", "legal_significance", "potential_impact", "facts", "supporting_facts"],
): { items: T[]; totalSoftened: number; totalDropped: number; violations: string[] } {
  let totalSoftened = 0;
  let totalDropped = 0;
  const violations: string[] = [];
  const out: T[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") {
      out.push(it);
      continue;
    }
    const next: Record<string, unknown> = { ...it };
    // Collect cited spans from this item's evidence_refs/citations for per-item ceiling
    const rec = it as Record<string, unknown>;
    const ev = Array.isArray(rec.evidence_refs) ? (rec.evidence_refs as Array<{ quote?: unknown }>) : [];
    const ci = Array.isArray(rec.citations) ? (rec.citations as Array<{ quote?: unknown }>) : [];
    const cites = [...ev, ...ci];
    const citedSpans = cites
      .map((c) => (c && typeof c === "object" && typeof c.quote === "string" ? c.quote : ""))
      .filter(Boolean) as string[];
    let itemDropped = false;
    for (const f of fields) {
      const v = next[f];
      if (typeof v !== "string" || !v.trim()) continue;
      const r = enforceSentence(v, { ...opts, citedSpans });
      if (r.dropped) {
        itemDropped = true;
        totalDropped++;
        violations.push(...r.violations);
        break;
      }
      if (r.softened) {
        totalSoftened++;
        violations.push(...r.violations);
        next[f] = r.text;
      }
    }
    if (itemDropped) continue;
    out.push(next as T);
  }
  return { items: out, totalSoftened, totalDropped, violations };
}
