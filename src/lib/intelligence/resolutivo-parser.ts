// Resolutivo Parser — pure module (no I/O, no AI).
//
// WHY: every "holding vs. risk" bug fixed this session was a downstream
// SYMPTOM of the pipeline never having a structured, authoritative record
// of what the court's dispositive section (RESUELVE / SE RESUELVE) actually
// says. Agents infer holdings from prose scattered through the ruling;
// this module instead extracts the one section of a Mexican judgment that
// is BY CONVENTION the court's own itemized, numbered statement of its
// decision — PRIMERO, SEGUNDO, TERCERO... (or ÚNICO for a single-item
// ruling) — and gives every downstream consumer a real, textual anchor to
// validate agent-generated holdings against.
//
// SCOPE, DELIBERATELY NARROW (per explicit user direction after review of
// an external architecture proposal): this module extracts STRUCTURE only.
//   - type: which of a small set of standard dispositive verbs the item
//     uses (revoca/confirma/concede/niega/modifica/sobresee/desecha),
//     detected by literal keyword match — a drafting-convention fact, not
//     a legal interpretation.
//   - raw text, ordinal label, character offset, extraction confidence.
// It NEVER infers:
//   - beneficiary (who the disposition favors) — deliberately always null.
//   - polarity / risk impact.
// Those are genuine legal-interpretation calls: "se niega la suspensión"
// is adverse to the quejoso, but "se niega la competencia de la autoridad"
// is favorable to the quejoso — the same verb, opposite outcome, resolved
// only by understanding what the sentence actually denies. A deterministic
// heuristic here would be wrong often enough to reintroduce the exact
// hallucination-shaped problem this whole session has been removing —
// worse, it would be WRONG WHILE LOOKING DETERMINISTIC AND AUTHORITATIVE,
// which is a harder failure mode to catch than an LLM guess flagged as a
// guess. Every disposition this module returns carries
// requires_legal_review: true for exactly that reason. Wiring this into
// scoring/polarity is an explicit LATER step, only after calibrating
// against a substantial set of real rulings — not this pass.

const ORDINAL_WORDS = [
  "PRIMERO",
  "SEGUNDO",
  "TERCERO",
  "CUARTO",
  "QUINTO",
  "SEXTO",
  "S[ÉE]PTIMO",
  "OCTAVO",
  "NOVENO",
  "D[ÉE]CIMO",
  "[ÚU]NICO",
] as const;

// JS regex's \b is ASCII-only even under the "u" flag — it does not
// recognize accented letters (Ú, É...) as word characters, so \bÚNICO\b
// silently fails to match "ÚNICO" at the very position it's needed most.
// Unicode property lookarounds are the correct boundary here (same fix
// already applied in finding-dedupe.ts/domain-vocabulary-gate.ts this
// session for the identical class of bug).
const UB_BEFORE = "(?<![\\p{L}\\p{N}])";
const UB_AFTER = "(?![\\p{L}\\p{N}])";

// Matches the ordinal marker as it appears at the start of a dispositive
// item, tolerating the common ".-", "°.-", or bare "." terminators and
// optional leading whitespace/newline (Mexican judgments format each
// resolutivo as its own paragraph).
const ORDINAL_MARKER_RE = new RegExp(
  `${UB_BEFORE}(?:${ORDINAL_WORDS.join("|")})${UB_AFTER}\\s*[°º]?\\.?-?`,
  "giu",
);

// The dispositive section header. Tolerates the letter-spaced formatting
// ("R E S U E L V E") common in scanned/OCR'd Mexican judgments, and both
// "RESUELVE" and "SE RESUELVE".
const RESUELVE_HEADER_RE = new RegExp(
  `${UB_BEFORE}(?:S\\s*E\\s*)?R\\s*E\\s*S\\s*U\\s*E\\s*L\\s*V\\s*E${UB_AFTER}\\s*:?`,
  "iu",
);

export const DISPOSITION_TYPES = [
  "revoca",
  "confirma",
  "concede",
  "niega",
  "modifica",
  "sobresee",
  "desecha",
  "otro",
] as const;
export type DispositionType = (typeof DISPOSITION_TYPES)[number];

// Order matters — more specific phrases first, so e.g. "ampara y protege"
// (a grant) is checked before a bare "niega" that might appear later in
// the same item's qualifying clauses.
const TYPE_RULES: Array<{ match: RegExp; type: DispositionType }> = [
  { match: /\bse\s+revoca\b/i, type: "revoca" },
  { match: /\bse\s+confirma\b/i, type: "confirma" },
  // Standard SCJN/Tribunal Colegiado amparo grant/deny formula: "La
  // Justicia de la Unión ampara y protege" (grant) vs. "...no ampara ni
  // protege" / "...no ampara" (deny). The negation must be checked BEFORE
  // the bare grant pattern, or "no ampara y protege" would match "concede"
  // on the "ampara y protege" substring alone.
  { match: /\bno\s+ampara(?:\s+ni\s+protege)?\b/i, type: "niega" },
  { match: /\bampara\s+y\s+protege\b/i, type: "concede" },
  { match: /\bse\s+concede\b/i, type: "concede" },
  { match: /\bse\s+declara\s+fundado/i, type: "concede" },
  { match: /\bse\s+declara\s+infundado/i, type: "niega" },
  { match: /\bse\s+niega\b/i, type: "niega" },
  { match: /\bse\s+modifica\b/i, type: "modifica" },
  { match: /\bse\s+sobresee\b/i, type: "sobresee" },
  { match: /\bse\s+desecha\b/i, type: "desecha" },
];

export type Disposition = {
  /** Which standard dispositive verb this item uses, by literal keyword
   *  match — "otro" when none of the known patterns matched. */
  type: DispositionType;
  /** Verbatim text of this dispositive item, trimmed. */
  text: string;
  /** The ordinal marker as it literally appeared ("PRIMERO", "ÚNICO", ...). */
  ordinal: string;
  /** Character offset of this item's start within the source text passed
   *  in — callers with a page-offset map (e.g. grounding.server.ts's
   *  pageForOffset) can resolve this to a page number themselves; this
   *  module has no document/page model of its own. */
  offset: number;
  /** "high" when a known dispositive-verb pattern matched; "low" when the
   *  item fell through to "otro" — an honest signal for callers deciding
   *  how much to trust this item without a human re-reading it. */
  extractionConfidence: "high" | "low";
  /** Always null. See module header — beneficiary is a legal-interpretation
   *  call this module deliberately does not make. */
  beneficiary: null;
  /** Always true. A structural extraction is not a substitute for an
   *  attorney reading the actual disposition. */
  requiresLegalReview: true;
};

export type ResolutivoParseResult = {
  /** True only when a RESUELVE/SE RESUELVE header was actually found. */
  found: boolean;
  dispositions: Disposition[];
};

const EMPTY_RESULT: ResolutivoParseResult = { found: false, dispositions: [] };

function classifyType(text: string): DispositionType {
  for (const rule of TYPE_RULES) {
    if (rule.match.test(text)) return rule.type;
  }
  return "otro";
}

/**
 * Extracts the dispositive (RESUELVE) section of a Mexican judgment and
 * splits it into its numbered/lettered items. Returns `found: false` with
 * no dispositions when no RESUELVE header is present in the text at all —
 * this is the expected, common case for a corpus that is a fragment or an
 * excerpt rather than the full resolución, and callers must treat it as
 * "we don't have this," never as "the court found nothing."
 */
export function parseResolutivos(text: string): ResolutivoParseResult {
  const src = String(text ?? "");
  if (!src.trim()) return EMPTY_RESULT;

  RESUELVE_HEADER_RE.lastIndex = 0;
  const headerMatch = RESUELVE_HEADER_RE.exec(src);
  if (!headerMatch) return EMPTY_RESULT;

  const blockStart = headerMatch.index + headerMatch[0].length;
  // The dispositive block runs to the next clear section break (a blank
  // line run, or a common closing formula) or, failing that, to the end
  // of the text. Real judgments vary here; falling back to "rest of the
  // text" is safer than truncating a real disposition on a formatting
  // guess that doesn't match this document.
  const closingRe =
    /\n\s*(?:N\s*O\s*T\s*I\s*F\s*[IÍ]\s*Q\s*U\s*E\s*S\s*E|AS[ÍI]\s+LO\s+RESOLVIERON)\b/iu;
  closingRe.lastIndex = blockStart;
  const closingMatch = closingRe.exec(src.slice(blockStart));
  const blockEnd = closingMatch ? blockStart + closingMatch.index : src.length;
  const block = src.slice(blockStart, blockEnd);

  ORDINAL_MARKER_RE.lastIndex = 0;
  const markers: Array<{ ordinal: string; start: number; contentStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = ORDINAL_MARKER_RE.exec(block)) !== null) {
    markers.push({
      ordinal: m[0].replace(/[°º.\-\s]+$/g, "").trim(),
      start: m.index,
      contentStart: m.index + m[0].length,
    });
  }

  if (markers.length === 0) {
    // No numbered items found (e.g. a single unlabeled disposition, or
    // formatting this parser doesn't recognize) — return the whole block
    // as one unclassified-ordinal item rather than silently returning
    // nothing. Confidence reflects that we could not confirm the
    // convention this document uses.
    const itemText = block.trim();
    if (!itemText) return { found: true, dispositions: [] };
    return {
      found: true,
      dispositions: [
        {
          type: classifyType(itemText),
          text: itemText,
          ordinal: "",
          offset: blockStart,
          extractionConfidence: "low",
          beneficiary: null,
          requiresLegalReview: true,
        },
      ],
    };
  }

  const dispositions: Disposition[] = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];
    const contentEnd = next ? next.start : block.length;
    const itemText = block.slice(cur.contentStart, contentEnd).trim();
    if (!itemText) continue;
    const type = classifyType(itemText);
    dispositions.push({
      type,
      text: itemText,
      ordinal: cur.ordinal,
      offset: blockStart + cur.contentStart,
      extractionConfidence: type === "otro" ? "low" : "high",
      beneficiary: null,
      requiresLegalReview: true,
    });
  }
  return { found: true, dispositions };
}
