// Addendum §23 (auditable rationale) + §25 (multidimensional confidence).
//
// Every function here is pure and deterministic — no DB, no AI provider
// calls. It only reshapes/derives from data an engine's existing prompt
// already returns (or, when a model didn't happen to supply a given
// signal, falls back to a conservative heuristic default). This is the
// intentional design choice for this whole addendum: none of it requires
// enlarging or restructuring any existing prompt, so it cannot change the
// size, count, or chunking of any AI call.
import type {
  ConfidenceDimension,
  ConfidenceDimensions,
  ConfidenceLevel,
  FindingRationale,
} from "./types";

// ----------------------------------------------------------------------------
// Banned unsupported-conclusion language (addendum §23)
// ----------------------------------------------------------------------------
// Pattern-level, not a verbatim script — matches the small set of stock
// Spanish hedge phrases the addendum calls out by name. A hit doesn't block
// anything; it flags the finding as needing an accompanying evidence/
// authority reference (checked separately below), so a reviewer can see at
// a glance which conclusions still read as unsupported assertions.
const BANNED_UNSUPPORTED_PHRASES = [
  /\bse considera\b/i,
  /\bes probable\b/i,
  /\bpuede resultar favorable\b/i,
  /\bla evidencia es s[oó]lida\b/i,
  /\bexiste alta probabilidad de [ée]xito\b/i,
  /\bse recomienda promover\b/i,
] as const;

export function containsUnsupportedLanguage(text: string): boolean {
  if (!text) return false;
  return BANNED_UNSUPPORTED_PHRASES.some((re) => re.test(text));
}

// ----------------------------------------------------------------------------
// Confidence dimensions
// ----------------------------------------------------------------------------
function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "moderate";
  if (score > 0) return "low";
  return "indeterminate";
}

function dim(level: ConfidenceLevel, reason: string): ConfidenceDimension {
  return { level, reason };
}

/** Reads a raw model item for any dimension hints it happens to include
 * (some prompts already return richer per-finding detail than others), and
 * falls back to a deterministic heuristic derived from data already on hand
 * — document/extraction stats, evidence_refs, source_module — for anything
 * the model didn't supply. Never issues a new call to fill a gap. */
export function deriveConfidenceDimensions(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  overallConfidence: number;
  evidenceRefCount: number;
  sourceDocCount: number;
  /** True when this finding's source module already ran through
   * doc-extraction success checks (nearly always true — kept optional so
   * this never becomes a hard dependency on any one caller passing it). */
  hasExtractionSignal?: boolean;
}): ConfidenceDimensions {
  const { raw, overallConfidence, evidenceRefCount, sourceDocCount } = args;
  const r = raw ?? {};

  const readHint = (key: string): ConfidenceDimension | null => {
    const v = r[key];
    if (v && typeof v === "object" && typeof v.level === "string") {
      return dim(v.level as ConfidenceLevel, String(v.reason ?? ""));
    }
    if (typeof v === "number") return dim(levelFromScore(v), "Derived from model-reported score.");
    return null;
  };

  return {
    extraction:
      readHint("extraction_confidence") ??
      dim(
        args.hasExtractionSignal === false ? "low" : sourceDocCount > 0 ? "high" : "indeterminate",
        sourceDocCount > 0
          ? "Source document(s) extracted and attributed successfully."
          : "No source document attached to this finding — extraction quality can't be assessed.",
      ),
    factual:
      readHint("factual_confidence") ??
      dim(
        levelFromScore(overallConfidence),
        "Derived from the engine's overall confidence score for this finding.",
      ),
    evidence_quality:
      readHint("evidence_quality") ??
      dim(
        evidenceRefCount >= 2 ? "high" : evidenceRefCount === 1 ? "moderate" : "low",
        evidenceRefCount >= 2
          ? `${evidenceRefCount} independent evidence references cited.`
          : evidenceRefCount === 1
            ? "Only one evidence reference cited — no independent corroboration."
            : "No evidence reference cited.",
      ),
    legal:
      readHint("legal_confidence") ??
      dim(
        r.legal_significance ? "moderate" : "indeterminate",
        r.legal_significance
          ? "Legal significance was articulated by the engine; verify the cited rule is current and applicable."
          : "No legal significance was articulated for this finding.",
      ),
    procedural:
      readHint("procedural_confidence") ??
      dim(
        "indeterminate",
        "Procedural-stage certainty is not independently assessed by this engine — see the cross-agent audit for procedural-stage consistency across agents.",
      ),
    corpus_completeness:
      readHint("corpus_completeness") ??
      dim(
        sourceDocCount >= 2 ? "moderate" : "low",
        sourceDocCount >= 2
          ? "Multiple documents in the corpus touch this finding."
          : "Only a single document in the corpus touches this finding — the official expediente may contain more.",
      ),
    classification:
      readHint("classification_confidence") ??
      dim(
        "moderate",
        "Category/materia classification not independently re-verified for this finding — inherited from the source engine's own classification.",
      ),
  };
}

// ----------------------------------------------------------------------------
// Rationale
// ----------------------------------------------------------------------------
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** Extracts whatever rationale detail a raw model item already provides
 * (contrary evidence, assumptions, authority, etc. — several existing
 * prompts already ask for some of these under different key names) and
 * fills in the unsupported-language flag deterministically. Never invents
 * evidence or authority that wasn't present in the raw item. */

export function deriveRationale(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any,
  args: { title: string; description: string },
): FindingRationale {
  const r = raw ?? {};
  const supporting_evidence = toStringArray(r.supporting_evidence ?? r.support ?? r.evidence_refs);
  const contrary_evidence = toStringArray(
    r.contrary_evidence ?? r.contradicting_evidence ?? r.weakening_evidence,
  );
  const assumptions = toStringArray(r.assumptions ?? r.key_assumptions);
  const unresolved_questions = toStringArray(r.unresolved_questions ?? r.open_questions);
  const applicable_authority = toStringArray(r.applicable_authority ?? r.authority ?? r.citations);

  const flaggedText = `${args.title} ${args.description}`;
  const unsupported_language_flagged = containsUnsupportedLanguage(flaggedText);
  // A hedge phrase is fine IF it's backed by evidence or authority; it's
  // only flagged for attorney review when it appears with nothing behind it.
  const needsReview =
    unsupported_language_flagged &&
    supporting_evidence.length === 0 &&
    applicable_authority.length === 0;

  return {
    supporting_evidence,
    contrary_evidence,
    assumptions,
    unresolved_questions,
    applicable_authority,
    attorney_review_required: Boolean(r.attorney_review_required) || needsReview,
    unsupported_language_flagged,
  };
}
