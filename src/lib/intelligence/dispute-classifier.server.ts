// Distinguish FACTUAL contradictions (same observable fact, contradicted)
// from DISPUTED ISSUES (parties take opposing positions / requests).
// Operates as a heuristic post-classifier so the report can route them into
// separate sections instead of mislabeling every disagreement as a
// contradiction.

const POSITION_MARKERS = [
  /\b(request|requests|requested|requesting|seek|seeks|seeking|sought|claim|claims|claimed|claiming|allege|alleges|alleged|alleging|argue|argues|argued|contend|contends|contended|prays?|prayer for|demand|demands|demanded|prop(?:ose|oses|osed)|positions?|asserts?|asserted)\b/i,
];
const RELIEF_MARKERS = [
  /\b(custody|visitation|parenting time|child support|spousal support|alimony|valuation|fault|liability allocation|damages|attorneys?\s+fees|equitable distribution|injunction|restraining order)\b/i,
];
const OBSERVABLE_MARKERS = [
  // observable facts: dates, locations, measurements, identities
  /\b(at\s+\d{1,2}[:.]\d{2}|on\s+\w+ \d{1,2},?\s+\d{4}|address|odometer|miles|mph|grams|ml|blood alcohol|bac|witnessed|observed|recorded|video|photograph|measured|gps|coordinates)\b/i,
];

export type ContradictionKind = "factual" | "disputed_issue";

export function classifyContradiction(input: {
  document_a?: { quote?: string } | null;
  document_b?: { quote?: string } | null;
  title?: string;
  description?: string;
  nature?: string;
}): ContradictionKind {
  const a = String(input.document_a?.quote ?? "");
  const b = String(input.document_b?.quote ?? "");
  const meta = `${input.title ?? ""} ${input.description ?? ""} ${input.nature ?? ""}`;
  const both = `${a} ${b}`;

  const positionA = POSITION_MARKERS.some((r) => r.test(a));
  const positionB = POSITION_MARKERS.some((r) => r.test(b));
  const relief = RELIEF_MARKERS.some((r) => r.test(both) || r.test(meta));
  const observable = OBSERVABLE_MARKERS.some((r) => r.test(both));

  // Two parties stating opposing positions on a relief-type issue → dispute.
  if (relief && (positionA || positionB)) return "disputed_issue";
  // Pure observable conflict → factual.
  if (observable && !positionA && !positionB) return "factual";
  // Default conservative: if both quotes look like party positions, dispute.
  if (positionA && positionB) return "disputed_issue";
  return "factual";
}

// ---------------------------------------------------------------------------
// CONTRADICTION QUALITY (Task 4)
// A finding is only a real "Direct Contradiction" when two statements
// describe the SAME specific fact in MUTUALLY EXCLUSIVE ways. Everything
// else is a party position or a narrative conflict.
// ---------------------------------------------------------------------------
export type ContradictionQuality =
  | "Direct Contradiction"
  | "Adversarial Claim"
  | "Narrative Conflict";

const NARRATIVE_MARKERS = /\b(theory|narrative|version of events|overall account|defense theory|prosecution theory)\b/i;
const ADVERSARIAL_MARKERS = /\b(defendant\s+(?:denies|denied|maintains|contends)|prosecution\s+(?:alleges|claims|contends)|plaintiff\s+(?:alleges|claims)|respondent\s+(?:denies|claims))\b/i;

export function classifyContradictionQuality(input: {
  document_a?: { quote?: string } | null;
  document_b?: { quote?: string } | null;
  title?: string;
  description?: string;
  nature?: string;
}): ContradictionQuality {
  const a = String(input.document_a?.quote ?? "");
  const b = String(input.document_b?.quote ?? "");
  const meta = `${input.title ?? ""} ${input.description ?? ""} ${input.nature ?? ""}`;
  const all = `${a} ${b} ${meta}`;

  if (NARRATIVE_MARKERS.test(meta)) return "Narrative Conflict";
  if (ADVERSARIAL_MARKERS.test(all)) return "Adversarial Claim";

  const kind = classifyContradiction(input);
  if (kind === "disputed_issue") return "Adversarial Claim";

  // Two concrete quotes that both look observable → direct contradiction.
  if (a && b && OBSERVABLE_MARKERS.some((r) => r.test(a) || r.test(b))) {
    return "Direct Contradiction";
  }
  // Anything else with no observable anchor is a narrative-level clash.
  return a && b ? "Direct Contradiction" : "Narrative Conflict";
}

/**
 * Legal-precision rewriter: prevents prose from amplifying neutral source
 * language into stronger relief language (e.g. "requests custody" being
 * presented as "seeks SOLE custody") unless the amplified phrase actually
 * appears in the source corpus.
 */
const AMPLIFICATION_PATTERNS: Array<{ pattern: RegExp; safe: string }> = [
  { pattern: /\b(seeks|seeking|requests?|granted|awarded)\s+(sole|primary|full|exclusive)\s+(legal\s+)?custody\b/gi, safe: "$1 custody" },
  { pattern: /\b(sole|primary|full|exclusive)\s+(legal\s+|physical\s+)?custody\b/gi, safe: "custody" },
  { pattern: /\b(maximum|full)\s+(child\s+)?support\b/gi, safe: "$2support" },
  { pattern: /\bpermanent\s+(restraining|protective)\s+order\b/gi, safe: "$1 order" },
];

export function stripUnsupportedAmplification(text: string, corpus: string): string {
  if (!text) return text;
  const haystack = corpus.toLowerCase();
  let out = text;
  for (const { pattern, safe } of AMPLIFICATION_PATTERNS) {
    out = out.replace(pattern, (match) => {
      // Allowed only if the literal amplified phrase appears in the corpus.
      if (haystack.includes(match.toLowerCase())) return match;
      return match.replace(pattern, safe);
    });
  }
  return out;
}
