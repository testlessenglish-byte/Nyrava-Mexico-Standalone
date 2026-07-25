// Claim classification — every rendered statement is one of four classes.
// This is a deterministic, heuristic classifier used wherever generated
// text is surfaced (dashboard cards, PDF, DOCX, chat). It never converts
// analysis into fact and never converts speculation into a recommendation.
//
// Rules:
//  FACT                       — quoted evidence, verbatim citations, or
//                                 statements explicitly tagged as fact by
//                                 the upstream extractor.
//  EVIDENCE-BASED ANALYSIS    — assessment grounded in cited evidence
//                                 ("the discrepancy …", "suggests that …",
//                                 "based on the record …").
//  STRATEGIC CONSIDERATION    — actionable counsel-facing language
//                                 ("counsel should …", "consider filing …",
//                                 "investigate …").
//  HYPOTHESIS REQUIRES VERIFICATION
//                              — speculation requiring outside input
//                                 ("additional footage may …", "if … then",
//                                 "possible that …").

export type ClaimClass =
  | "fact"
  | "analysis"
  | "strategy"
  | "hypothesis";

const STRATEGY_HINTS = [
  /counsel (should|may|might) /i, /consider (filing|investigat|reviewing|requesting|preserving)/i,
  /\bmove to\b/i, /\bfile (a |an )?(motion|brief|request)/i, /recommend(ation)?/i,
  /\bnegotiat/i, /\bsubpoena/i, /\bdeposition/i, /tactic|strategic|leverage/i,
];

const HYPOTHESIS_HINTS = [
  /\bmay (clarify|reveal|indicate|show|suggest|affect)\b/i,
  /\bcould\b/i, /\bmight\b/i, /\bif\b.*\bthen\b/i, /\bpossible (that|cause)/i,
  /\bunclear\b/i, /\brequires (further |additional )?(verification|investigation|clarification)/i,
  /\bsubject to verification/i, /\bpending\b/i, /\bspeculat/i,
  /\badditional (footage|records|evidence|documents|testimony)/i,
];

const ANALYSIS_HINTS = [
  /\bsuggests?\b/i, /\bindicates?\b/i, /\bappears? to\b/i, /\bdiscrepan/i,
  /\binconsisten/i, /\bpattern\b/i, /\bcorrelat/i, /\bdiverg/i,
  /\bbased on (the )?(record|evidence|documents?)/i, /\bgiven (the )?(record|evidence)/i,
  /\bsuppress(ion|ed)?\b/i, /\bprobable cause\b/i, /\bcredibility\b/i,
  /\bweighs? (against|in favor of)/i,
];

const FACT_HINTS = [
  /^"[^"]+"$/, /\bstated\b/i, /\breported\b/i, /\btestified\b/i,
  /\bsigned\b/i, /\bfiled\b/i, /\brecorded\b/i, /\bobserved\b/i,
  /\b(on|at) \d{1,2}[:./-]\d/i, /\bdocument\b/i, /\bexhibit\b/i,
];

export function classifyClaim(text: string, hintedClass?: ClaimClass | null): ClaimClass {
  if (hintedClass) return hintedClass;
  const t = (text ?? "").trim();
  if (!t) return "analysis";

  // Strategy beats hypothesis beats analysis beats fact when terms overlap.
  if (STRATEGY_HINTS.some((re) => re.test(t))) return "strategy";
  if (HYPOTHESIS_HINTS.some((re) => re.test(t))) return "hypothesis";
  if (ANALYSIS_HINTS.some((re) => re.test(t))) return "analysis";

  // Quoted verbatim or filing/observation language → factual.
  if (FACT_HINTS.some((re) => re.test(t))) return "fact";

  // Default: evidence-based analysis (never default to "fact" — defaulting
  // to fact is the source of factual amplification).
  return "analysis";
}

export const CLAIM_LABEL: Record<ClaimClass, string> = {
  fact: "FACT",
  analysis: "EVIDENCE-BASED ANALYSIS",
  strategy: "STRATEGIC CONSIDERATION",
  hypothesis: "HYPOTHESIS REQUIRES VERIFICATION",
};

export const CLAIM_BADGE_CLASS: Record<ClaimClass, string> = {
  // Tailwind classes used directly in JSX badges.
  fact: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  analysis: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30",
  strategy: "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30",
  hypothesis: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
};
