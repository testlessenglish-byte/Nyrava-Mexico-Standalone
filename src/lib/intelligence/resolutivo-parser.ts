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
// SCOPE, DELIBERATELY NARROW: this module extracts STRUCTURE only.
//   - type: which of a small set of standard dispositive verbs the item
//     uses (revoca/confirma/concede/niega/modifica/sobresee/desecha),
//     detected by literal keyword match — a drafting-convention fact, not
//     a legal interpretation.
//   - raw text, ordinal label, character offset, extraction confidence.
// It NEVER infers beneficiary or polarity/risk impact. Those remain legal-
// interpretation calls and every returned disposition therefore carries
// requiresLegalReview: true.

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

const UB_BEFORE = "(?<![\\p{L}\\p{N}])";
const UB_AFTER = "(?![\\p{L}\\p{N}])";

const ORDINAL_MARKER_RE = new RegExp(
  `${UB_BEFORE}(?:${ORDINAL_WORDS.join("|")})${UB_AFTER}\\s*[°º]?\\.?-?`,
  "giu",
);

// Global on purpose. Mexican judgments frequently contain an earlier prose
// sentence or quoted lower-court heading containing "resuelve". The actual
// dispositive is conventionally near the end of the judgment. Using the
// first occurrence caused ADR5829/2025 to anchor the shared brief to historic
// lower-court discussion and invert the SCJN holding. parseResolutivos() now
// evaluates every candidate and selects the last candidate that is followed
// by a dispositive ordinal; only if none has an ordinal does it fall back to
// the last RESUELVE occurrence.
const RESUELVE_HEADER_RE = new RegExp(
  `${UB_BEFORE}(?:S\\s*E\\s*)?R\\s*E\\s*S\\s*U\\s*E\\s*L\\s*V\\s*E${UB_AFTER}\\s*:?`,
  "giu",
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

const TYPE_RULES: Array<{ match: RegExp; type: DispositionType }> = [
  { match: /\bse\s+revoca\b/i, type: "revoca" },
  { match: /\bse\s+confirma\b/i, type: "confirma" },
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
  type: DispositionType;
  text: string;
  ordinal: string;
  offset: number;
  extractionConfidence: "high" | "low";
  beneficiary: null;
  requiresLegalReview: true;
};

export type ResolutivoParseResult = {
  found: boolean;
  dispositions: Disposition[];
};

const EMPTY_RESULT: ResolutivoParseResult = { found: false, dispositions: [] };

function classifyType(text: string): DispositionType {
  for (const rule of TYPE_RULES) {
    rule.match.lastIndex = 0;
    if (rule.match.test(text)) return rule.type;
  }
  return "otro";
}

function findDispositiveHeader(src: string): RegExpExecArray | null {
  RESUELVE_HEADER_RE.lastIndex = 0;
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = RESUELVE_HEADER_RE.exec(src)) !== null) {
    matches.push(match);
    if (match[0].length === 0) RESUELVE_HEADER_RE.lastIndex += 1;
  }
  if (matches.length === 0) return null;

  // Prefer the last header that actually introduces a numbered dispositive.
  // Limit the look-ahead so an unrelated RESUELVE far earlier in the opinion
  // cannot borrow ordinals from the real final section.
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i];
    const start = candidate.index + candidate[0].length;
    const lookAhead = src.slice(start, Math.min(src.length, start + 1800));
    ORDINAL_MARKER_RE.lastIndex = 0;
    if (ORDINAL_MARKER_RE.test(lookAhead)) return candidate;
  }

  return matches[matches.length - 1];
}

/**
 * Extracts the final dispositive (RESUELVE) section of a Mexican judgment and
 * splits it into its numbered/lettered items. Earlier occurrences of
 * "resuelve" in quoted history or lower-court discussion cannot override the
 * final section. Returns found:false when no RESUELVE header exists.
 */
export function parseResolutivos(text: string): ResolutivoParseResult {
  const src = String(text ?? "");
  if (!src.trim()) return EMPTY_RESULT;

  const headerMatch = findDispositiveHeader(src);
  if (!headerMatch) return EMPTY_RESULT;

  const blockStart = headerMatch.index + headerMatch[0].length;
  const closingRe =
    /\n\s*(?:N\s*O\s*T\s*I\s*F\s*[IÍ]\s*Q\s*U\s*E\s*S\s*E|AS[ÍI]\s+LO\s+RESOLVIERON)\b/iu;
  const tail = src.slice(blockStart);
  const closingMatch = closingRe.exec(tail);
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
