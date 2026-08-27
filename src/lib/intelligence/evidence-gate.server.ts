// Evidence Gate — converts Nyrava from inference-first to evidence-first.
//
// Every finding/theory/witness/opportunity/perspective passes through this
// gate before persistence. Items without verifiable citations are dropped
// (Strict / Balanced modes) or tagged AI_THEORY (Exploratory mode).
//
// The gate exposes:
//   - classifyFindingType  : DIRECT_EVIDENCE | EVIDENCE_BASED_INFERENCE | AI_THEORY
//   - applyEvidenceGate    : filter+annotate items in one pass
//   - extractEntities      : build the entity set used by witness validation
//   - determineApplicablePerspectives : civil vs criminal perspective list
//   - relabelMissingEvidence : "Missing X" → "X Not Found In Uploaded Documents"
//   - computeEvidenceConfidence : citation-count + corroboration based score
//   - getAnalysisMode      : read cases.analysis_mode (default balanced)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildGroundingCorpus, verifyQuoteDetailed, type GroundingCorpus } from "./grounding.server";
import { assessProceduralDefectGrounding } from "./procedural-defect-grounding.server";

export type AnalysisMode = "strict" | "balanced" | "exploratory";
export type FindingType = "DIRECT_EVIDENCE" | "EVIDENCE_BASED_INFERENCE" | "AI_THEORY";

const INFERENCE_VERBS =
  /\b(suggest|suggests|may|might|could|implies|likely|appears to|seems to|possibly|potentially|probable|probably|indicates|indicate)\b/i;

export type EvidenceItem = {
  // Required citation fields (gate enforces presence + verification)
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
  sourceQuote?: string | null;

  // Alternative shapes the engines emit today
  evidence_refs?: Array<{
    quote?: string;
    doc_n?: number;
    page?: number;
    doc_id?: string | null;
    document_id?: string | null;
    document?: string | null;
    source_document?: string | null;
    text?: string;
    excerpt?: string;
    passage?: string;
  }>;
  citations?: Array<{
    quote?: string;
    doc_n?: number;
    page?: number;
    document_id?: string | null;
    doc_id?: string | null;
    document?: string | null;
    source_document?: string | null;
    text?: string;
    excerpt?: string;
    passage?: string;
  }>;
  citation?:
    | {
        quote?: string;
        doc_n?: number;
        page?: number;
        document_id?: string | null;
        doc_id?: string | null;
        document?: string | null;
        source_document?: string | null;
        text?: string;
        excerpt?: string;
        passage?: string;
      }
    | string;
  evidence?: unknown;
  support?: unknown;
  supporting_evidence?: unknown;

  description?: string;
  narrative?: string;
  title?: string;
  confidence?: number;
  audit_classification?: string | null;
  speaker_role?: string | null;
  proposition_type?: string | null;
  adoption_status?: string | null;
};

export type GateOptions = {
  mode: AnalysisMode;
  corpus: GroundingCorpus;
  /** When true (default), items with NO verifiable citation are dropped in strict/balanced. */
  requireCitation?: boolean;
  /** Optional caller-specific floor. Omit to avoid confidence-based rejection. */
  minConfidence?: number;
};

export type GatedItem<T> = T & {
  finding_type: FindingType;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  citations: Array<{ quote: string; document_id: string | null; page: number | null; doc_n: number | null }>;
  /** Set only for a procedural-defect-grounding downgrade (see
   * procedural-defect-grounding.server.ts). Callers apply this to the KEPT
   * row's title/description AFTER matching it back to the input row —
   * `gated.title`/`gated.description` themselves are never rewritten, so
   * the title+description lookup key callers use to reunite a gate result
   * with its input row stays stable. See the comment where this is set. */
  not_established_rewrite: { title: string; description: string } | null;
  /** See classifyEvidenceRelationship below (Rule 6, report-quality audit,
   * 2026-08-14) — what KIND of relationship this finding has to its
   * evidence, distinct from finding_type's evidentiary-strength axis. */
  evidence_relationship: EvidenceRelationship;
};

export type GateAudit = {
  input: number;
  accepted: number;
  rejected_no_citation: number;
  rejected_quote_unverified: number;
  rejected_schema_mismatch: number;
  rejected_confidence: number;
  rejected_unsupported_claim: number;
  downgraded_inference: number;
  tagged_ai_theory: number;
  /** A finding named a known procedural-defect topic (notification,
   * deadline, jurisdiction, standing/definitividad, suspension, due
   * process) but every verified quote attached to it was, on its face, the
   * text of the rule rather than a case-specific fact — downgraded to
   * AI_THEORY instead of DIRECT_EVIDENCE. See
   * procedural-defect-grounding.server.ts. */
  downgraded_bare_legal_rule: number;
  rejections: GateRejection[];
};

export type GateRejectionReason =
  | "missing_citation"
  | "schema_mismatch"
  | "citation_mismatch"
  | "confidence_threshold"
  | "unsupported_claim"
  | "no_supporting_citation";

export type GateRejection = {
  index: number;
  title: string;
  reason: GateRejectionReason;
  detail: string;
  confidence: number | null;
  citation_count: number;
  verified_count: number;
  best_match_score: number;
};

function citationQuote(c: Record<string, unknown>): string | null {
  for (const k of ["quote", "text", "excerpt", "passage", "cited_text", "source_quote"]) {
    const v = c[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function citationDocN(c: Record<string, unknown>): number | null {
  const v = c.doc_n ?? c.docN ?? c.document_number;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function citationPage(c: Record<string, unknown>): number | null {
  const v = c.page ?? c.page_number;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function citationDocId(c: Record<string, unknown>): string | null {
  for (const k of ["document_id", "doc_id"]) {
    const v = c[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function citationDocLabel(c: Record<string, unknown>): string | null {
  for (const k of ["document", "source_document", "filename", "doc", "label"]) {
    const v = c[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

type CitationCandidate = {
  quote: string | null;
  doc_n: number | null;
  page: number | null;
  document_id: string | null;
  document_label: string | null;
  malformed: boolean;
};

function normalizeCitationCandidate(raw: unknown): CitationCandidate | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    return {
      quote: raw.trim() || null,
      doc_n: null,
      page: null,
      document_id: null,
      document_label: null,
      malformed: false,
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  return {
    quote: citationQuote(c),
    doc_n: citationDocN(c),
    page: citationPage(c),
    document_id: citationDocId(c),
    document_label: citationDocLabel(c),
    malformed: !citationQuote(c) && !citationDocN(c) && !citationDocId(c) && !citationDocLabel(c),
  };
}

function pushUnknownCitationShape(target: CitationCandidate[], raw: unknown) {
  if (!raw) return;
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const n = normalizeCitationCandidate(x);
      if (n) target.push(n);
    }
    return;
  }
  const n = normalizeCitationCandidate(raw);
  if (n) target.push(n);
}

function pickPrimaryCitation(item: EvidenceItem, corpus: GroundingCorpus) {
  const candidates: Array<{ quote: string; doc_n: number | null; page: number | null; document_id: string | null }> =
    [];
  let malformed = false;
  const normalized: Array<{
    quote: string | null;
    doc_n: number | null;
    page: number | null;
    document_id: string | null;
    document_label: string | null;
    malformed: boolean;
  }> = [];
  if (item.sourceQuote && (item.sourceDocumentId || item.sourcePage != null)) {
    normalized.push({
      quote: item.sourceQuote,
      doc_n: null,
      page: item.sourcePage ?? null,
      document_id: item.sourceDocumentId ?? null,
      document_label: null,
      malformed: false,
    });
  }
  pushUnknownCitationShape(normalized, item.evidence_refs);
  pushUnknownCitationShape(normalized, item.citations);
  pushUnknownCitationShape(normalized, item.citation);
  pushUnknownCitationShape(normalized, item.evidence);
  pushUnknownCitationShape(normalized, item.support);
  pushUnknownCitationShape(normalized, item.supporting_evidence);

  for (const n of normalized) {
    malformed = malformed || n.malformed;
    let document_id = n.document_id;
    if (!document_id && n.document_label) {
      const label = n.document_label.toLowerCase();
      const d = corpus.docs.find(
        (x) => x.filename.toLowerCase().includes(label) || label.includes(x.filename.toLowerCase()),
      );
      if (d) document_id = d.document_id;
    }
    if (n.quote) candidates.push({ quote: n.quote, doc_n: n.doc_n, page: n.page, document_id });
  }
  // Resolve document_id from doc_n when possible.
  for (const c of candidates) {
    if (!c.document_id && c.doc_n) {
      const d = corpus.docs.find((x) => x.doc_n === c.doc_n);
      if (d) c.document_id = d.document_id;
    }
  }
  return { candidates, malformed };
}

export function diagnoseEvidenceGate<T extends EvidenceItem>(
  items: T[],
  opts: GateOptions,
): { accepted: Array<{ index: number; item: T; gated: GatedItem<T> }>; audit: GateAudit } {
  const audit: GateAudit = {
    input: items.length,
    accepted: 0,
    rejected_no_citation: 0,
    rejected_quote_unverified: 0,
    rejected_schema_mismatch: 0,
    rejected_confidence: 0,
    rejected_unsupported_claim: 0,
    downgraded_inference: 0,
    tagged_ai_theory: 0,
    downgraded_bare_legal_rule: 0,
    rejections: [],
  };
  const accepted: Array<{ index: number; item: T; gated: GatedItem<T> }> = [];

  const reject = (
    index: number,
    item: EvidenceItem,
    reason: GateRejectionReason,
    detail: string,
    citationCount: number,
    verifiedCount: number,
    bestScore: number,
  ) => {
    if (reason === "schema_mismatch") audit.rejected_schema_mismatch += 1;
    else if (reason === "confidence_threshold") audit.rejected_confidence += 1;
    else if (reason === "unsupported_claim") audit.rejected_unsupported_claim += 1;
    else if (reason === "citation_mismatch") audit.rejected_quote_unverified += 1;
    else audit.rejected_no_citation += 1;
    audit.rejections.push({
      index,
      title: item.title ?? `Item ${index + 1}`,
      reason,
      detail,
      confidence: typeof item.confidence === "number" ? item.confidence : null,
      citation_count: citationCount,
      verified_count: verifiedCount,
      best_match_score: Number(bestScore.toFixed(3)),
    });
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const { candidates, malformed } = pickPrimaryCitation(item, opts.corpus);
    const checks = candidates.map((c) => ({ c, check: verifyQuoteDetailed(c.quote, opts.corpus) }));
    const verified = checks.filter((x) => x.check.verified).map((x) => x.c);
    const bestScore = checks.reduce((m, x) => Math.max(m, x.check.score), 0);
    const text = `${item.title ?? ""} ${item.description ?? item.narrative ?? ""}`.trim();
    const confidence = typeof item.confidence === "number" ? item.confidence : null;

    if (opts.minConfidence != null && confidence != null && confidence < opts.minConfidence) {
      reject(
        index,
        item,
        "confidence_threshold",
        `Confidence ${confidence.toFixed(2)} is below required ${opts.minConfidence.toFixed(2)}.`,
        candidates.length,
        verified.length,
        bestScore,
      );
      continue;
    }

    let type: FindingType;
    // True only for the procedural-defect-grounding backstop below — NOT
    // for a generic AI_THEORY (unsupported speculation with no citation at
    // all). This category is different in kind: the model found a REAL,
    // verified quote, it's just the law's own text rather than a
    // case-specific fact — closer to "we checked and this cannot be
    // established from the corpus" than to "we made something up". Per the
    // over-suppression regression this exists to fix (a downgrade to
    // AI_THEORY was being silently DROPPED by the strict/balanced mode
    // gate below, not just excluded from the dashboard — turning a useful
    // "not established" signal into nothing at all), this category is
    // exempted from the mode-based drop: it always survives, in every
    // mode, framed explicitly as not-established rather than as a
    // confirmed defect or a speculative theory.
    let notEstablishedTopic = false;
    if (verified.length > 0) {
      type = classifyFindingType({ hasVerifiedCitation: true, text });
      // A source-verified, adopted court holding is reportable evidence even
      // when its prose contains cautious language such as "may" or "could".
      // Those words can make the holding score-neutral, but must not turn the
      // court's own verified holding into an unsupported inference. The quote
      // still has to pass the normal corpus-verification gate above.
      const verifiedCourtHolding =
        item.audit_classification === "VERIFIED_COURT_HOLDING" &&
        item.proposition_type === "holding" &&
        item.adoption_status === "adopted" &&
        ["scjn", "tribunal_colegiado", "juzgado_distrito", "court"].includes(
          String(item.speaker_role ?? ""),
        );
      if (verifiedCourtHolding) type = "DIRECT_EVIDENCE";
      if (type === "EVIDENCE_BASED_INFERENCE") audit.downgraded_inference += 1;
      // Backstop for "a legal rule got reported as a case finding": a
      // finding naming a known procedural-defect topic (notification,
      // deadline, jurisdiction, standing/definitividad, suspension, due
      // process) whose ONLY verified quotes are, on their face, statute/
      // doctrine text rather than a case-specific fact is downgraded to
      // AI_THEORY regardless of citation completeness — the citation floor
      // alone can't tell "a real quote exists" from "a real quote of the
      // LAW exists", which is exactly how a confirmed ADR 5829/2025-class
      // report fabricated a "notificación defectuosa" finding from a quote
      // of the notification statute itself. See
      // procedural-defect-grounding.server.ts for the (deliberately
      // conservative) heuristic.
      if (type === "DIRECT_EVIDENCE") {
        const assessment = assessProceduralDefectGrounding({
          titleAndDescription: text,
          quotes: verified.map((c) => c.quote),
        });
        if (assessment.isBareLegalRule) {
          type = "AI_THEORY";
          notEstablishedTopic = true;
          audit.downgraded_bare_legal_rule += 1;
        }
      }
    } else {
      type = "AI_THEORY";
      if (malformed && candidates.length === 0) {
        reject(
          index,
          item,
          "schema_mismatch",
          "Citation-like data used an unsupported shape or omitted quote/document fields.",
          candidates.length,
          verified.length,
          bestScore,
        );
      } else if (candidates.length === 0) {
        reject(index, item, "missing_citation", "No structured supporting citation was provided.", 0, 0, 0);
      } else if (candidates.every((c) => !c.quote || c.quote.trim().length === 0)) {
        reject(
          index,
          item,
          "no_supporting_citation",
          "Citation included document/page metadata but no quoted passage to verify.",
          candidates.length,
          0,
          bestScore,
        );
      } else {
        reject(
          index,
          item,
          "citation_mismatch",
          "Quoted support was not found in the extracted corpus.",
          candidates.length,
          0,
          bestScore,
        );
      }
    }

    // Rule 6 (report-quality audit, 2026-08-14): only SOURCE_HOLDING /
    // SOURCE_FACT may back a DIRECT_EVIDENCE finding. A quote that is on-
    // topic and verified but is a PARTY'S OWN allegation (SOURCE_ARGUMENT)
    // is evidence of what was claimed, not of what is true — presenting it
    // as DIRECT_EVIDENCE would let the audit's exact failure back in
    // (treating an allegation as an established determination). Computed
    // BEFORE the mode-policy filtering below so a downgraded item is
    // subject to the same strict/balanced rules as any other inference.
    const relationship = classifyEvidenceRelationship({
      findingType: type,
      notEstablishedTopic,
      text,
      verifiedQuotes: verified.map((c) => c.quote as string),
    });
    if (type === "DIRECT_EVIDENCE" && relationship === "SOURCE_ARGUMENT") {
      type = "EVIDENCE_BASED_INFERENCE";
      audit.downgraded_inference += 1;
    }

    // Mode policy:
    //   strict       → only DIRECT_EVIDENCE
    //   balanced     → DIRECT_EVIDENCE + EVIDENCE_BASED_INFERENCE
    //   exploratory  → all, but AI_THEORY explicitly labeled
    // notEstablishedTopic is exempt from both mode drops below — see the
    // comment where it's set. Deleting the signal entirely (the
    // pre-existing behavior) is worse than showing it clearly labeled: an
    // attorney in strict mode benefits from "this topic was raised but
    // cannot be established from the corpus" exactly as much as one in
    // exploratory mode does.
    if (opts.mode === "strict" && type !== "DIRECT_EVIDENCE" && !notEstablishedTopic) {
      if (verified.length > 0)
        reject(
          index,
          item,
          "unsupported_claim",
          "Strict mode rejected an inference even though citation text was present.",
          candidates.length,
          verified.length,
          bestScore,
        );
      continue;
    }
    if (opts.mode === "balanced" && type === "AI_THEORY" && !notEstablishedTopic) continue;
    if (type === "AI_THEORY") audit.tagged_ai_theory += 1;

    // notEstablishedRewrite carries the "NO ESTABLECIDO" framing SEPARATELY
    // from `gated.title`/`gated.description` — those two fields must stay
    // byte-identical to `item.title`/`item.description`, because
    // addGatedFindings() (findings.server.ts) matches each caller-supplied
    // row back to its gate result by looking up `${title}::${description}`
    // in a map keyed off `gated`. An earlier version of this fix rewrote
    // `gated.title`/`gated.description` directly, which changed that lookup
    // key and made every notEstablishedTopic finding invisible to its own
    // caller — silently dropped one layer up, even though this function
    // itself had just decided to keep it. addGatedFindings applies this
    // rewrite AFTER its lookup succeeds, once identity is no longer in
    // question.
    const notEstablishedRewrite = notEstablishedTopic
      ? {
          title: `NO ESTABLECIDO — se requiere evidencia adicional: ${item.title ?? "Untitled finding"}`,
          description:
            `${item.description ?? ""}\n\nEl corpus disponible plantea este tema, pero la única cita verificada que lo respalda es el texto de la norma/doctrina aplicable, no un hecho específico de este expediente. No puede determinarse con la evidencia disponible si este punto constituye una irregularidad en este caso — no se afirma que exista un defecto ni que no exista. Se requiere evidencia documental adicional (constancias, actas, resoluciones) que describa lo ocurrido en este expediente.`.trim(),
        }
      : null;

    const primary = verified[0] ?? candidates[0] ?? null;
    audit.accepted += 1;
    accepted.push({
      index,
      item,
      gated: {
        ...item,
        finding_type: type,
        evidence_relationship: relationship,
        not_established_rewrite: notEstablishedRewrite,
        source_document_id: primary?.document_id ?? null,
        source_page: primary?.page ?? null,
        source_quote: primary?.quote ?? null,
        citations: (verified.length ? verified : candidates).map((c) => ({
          quote: c.quote,
          document_id: c.document_id,
          page: c.page,
          doc_n: c.doc_n,
        })),
      },
    });
  }
  return { accepted, audit };
}

export function classifyFindingType(opts: { hasVerifiedCitation: boolean; text: string }): FindingType {
  if (!opts.hasVerifiedCitation) return "AI_THEORY";
  if (INFERENCE_VERBS.test(opts.text)) return "EVIDENCE_BASED_INFERENCE";
  return "DIRECT_EVIDENCE";
}

// =========================================================================
// EVIDENCE RELATIONSHIP TAXONOMY (Rule 6)
//
// Report-quality audit (2026-08-14, ADR-2239-2018-180906): a finding's
// finding_type (DIRECT_EVIDENCE / EVIDENCE_BASED_INFERENCE / AI_THEORY)
// answers "how strong is the citation floor" but not "what KIND of thing
// does the evidence actually establish" — a verbatim, verified quote of a
// party's own allegation passes the citation floor exactly like a verbatim
// quote of the tribunal's own ruling, yet the audit is explicit that NYRAVA
// must never present one as if it were the other ("Never label NYRAVA's own
// inference as a tribunal determination"). This taxonomy is the missing
// axis, computed as a byproduct of the same verified-quote data
// diagnoseEvidenceGate already has — not a new subsystem, not an LLM call.
// =========================================================================

export type EvidenceRelationship =
  | "SOURCE_HOLDING"
  | "SOURCE_FACT"
  | "SOURCE_ARGUMENT"
  | "DERIVED_INFERENCE"
  | "UNPROVEN_ABSENCE"
  | "MISSING_EVIDENCE";

/** Dispositive/resolutive language a Mexican judicial or administrative
 *  resolution uses for ITS OWN ruling — "se resuelve", "puntos
 *  resolutivos", "se declara fundado/infundado" — as opposed to reciting a
 *  party's position or a bare fact. A quote carrying one of these markers
 *  is the decision-maker's own determination on the point. Deliberately
 *  requires an explicit dispositive marker rather than inferring holding
 *  status from "no other marker fired" — false negatives (missing a real
 *  holding, leaving it at SOURCE_FACT) are far cheaper here than a false
 *  positive that lets an ordinary fact masquerade as a ruling. */
const HOLDING_MARKERS =
  /\b(se resuelve\b|puntos resolutivos|resolutivos?:|se declara (fundado|infundado|procedente|improcedente|inoperante|inatendible)|esta (autoridad|sala|tribunal|junta)\s+(resuelve|determina|declara)|se (confirma|revoca|modifica)\s+la\s+(resoluci[oó]n|sentencia|determinaci[oó]n)|por lo (anteriormente\s+)?expuesto[^.]{0,80}se resuelve)/i;

/** A party's own allegation/argument, quoted verbatim — real and on-topic,
 *  but a statement of what someone CLAIMED, not an established fact or a
 *  ruling on it. A finding grounded only in this kind of quote must never
 *  be presented as DIRECT_EVIDENCE of the underlying proposition — see the
 *  downgrade applied where this is consulted in diagnoseEvidenceGate. */
const ARGUMENT_MARKERS =
  /\b(manifiesta que|alega que|aduce que|argumenta que|sostiene que|se[ñn]ala que|expone que|refiere que|arguye que|el (quejoso|actor|demandado|recurrente|apelante)\s+(manifiesta|alega|aduce|argumenta|sostiene|expone|refiere)|la parte (actora|demandada)\s+(manifiesta|alega|aduce|argumenta|sostiene|expone|refiere))\b/i;

/** The finding's OWN text (not its quote) asserting that something is
 *  missing from the record — "no se identificó", "no consta", "no obra en
 *  autos". These findings, by nature, usually have no quote to verify
 *  against (there is nothing to quote for an absence). Companion to
 *  rewriteAbsenceWording above, which fixes the same failure family's
 *  overclaiming *phrasing* rather than its classification. */
// No trailing \b: JS regex treats accented vowels (e.g. the "ó" in
// "identificó"/"encontró") as non-word characters, so a boundary placed
// right after one never matches — a real bug caught by this module's own
// test suite. The leading \b is enough to anchor these phrases.
const ABSENCE_CLAIM_RE =
  /\b(no se (identific[oó]|encontr[oó]|advierte|observa)|no consta|no obra en (autos|el expediente)|ausencia de|no existe (constancia|evidencia)|sin evidencia de)/i;

/**
 * Classifies what KIND of relationship a finding has to its evidence — the
 * 6-value taxonomy from the module header above. Deterministic and lexical,
 * matching this module's existing style (see
 * procedural-defect-grounding.server.ts's bare-legal-rule heuristic) rather
 * than a semantic/LLM judgment call. Per Rule 6, only SOURCE_HOLDING and
 * SOURCE_FACT are ever eligible to back a DIRECT_EVIDENCE finding_type —
 * enforced where this is called in diagnoseEvidenceGate, not here (this
 * function only classifies; it never mutates finding_type itself).
 */
export function classifyEvidenceRelationship(args: {
  findingType: FindingType;
  notEstablishedTopic: boolean;
  text: string;
  verifiedQuotes: string[];
}): EvidenceRelationship {
  const { findingType, notEstablishedTopic, text, verifiedQuotes } = args;

  // The bare-legal-rule downgrade (assessProceduralDefectGrounding) already
  // determined the only verified quote is the LAW's own text, not a
  // case-specific fact — there is no case-specific evidence to classify.
  if (notEstablishedTopic) return "MISSING_EVIDENCE";

  if (findingType === "AI_THEORY") {
    if (verifiedQuotes.length === 0 && ABSENCE_CLAIM_RE.test(text)) return "UNPROVEN_ABSENCE";
    return "DERIVED_INFERENCE";
  }

  if (findingType === "EVIDENCE_BASED_INFERENCE") return "DERIVED_INFERENCE";

  // DIRECT_EVIDENCE: a verified, on-topic quote with no inference verbs.
  if (verifiedQuotes.some((q) => HOLDING_MARKERS.test(q))) return "SOURCE_HOLDING";
  if (verifiedQuotes.some((q) => ARGUMENT_MARKERS.test(q))) return "SOURCE_ARGUMENT";
  return "SOURCE_FACT";
}

export function applyEvidenceGate<T extends EvidenceItem>(
  items: T[],
  opts: GateOptions,
): { items: GatedItem<T>[]; audit: GateAudit } {
  const result = diagnoseEvidenceGate(items, opts);
  return { items: result.accepted.map((x) => x.gated), audit: result.audit };
}

// =========================================================================
// ESS (Evidence Sufficiency Score) FINDING CONSTRAINT
//
// Report-quality audit (2026-08-14, ADR-2239-2018-180906): "modo LIMITADO"
// / a thin corpus correctly suppresses the CASE-LEVEL score, recommendations,
// and motion generation (see pipeline.server.ts's reportMode/isLimited), but
// that suppression never reached individual findings — a finding could still
// carry DIRECT_EVIDENCE status and a 90%+ confidence badge from a corpus too
// thin to actually support that certainty. This is the fix: a pure,
// deterministic downgrade applied per-finding whenever the case-wide ESS
// bin is 'minimal'/'low', generalizing the single-finding-type precedent
// already in procedural-compliance.server.ts ("a zero-citation absence
// finding is 'medium' not 'high'") to every finding via the case-wide
// signal, exactly as that fix's own comment predicted this would eventually
// need to happen.
//
// ess.bin's fuller inputs (verified-finding count, contradiction count) are
// only known once findings already exist for the case, so this can't run
// inside the per-item generation gate above (diagnoseEvidenceGate) — it's
// applied afterward, once per report-generation pass, to the real
// case_findings rows that pass (see pipeline.server.ts where `ess` is
// computed) — and PERSISTED (not just displayed-capped), so every consumer
// (report export, the live case UI, Talk-to-Case) reads the same
// constrained values without needing its own separate ESS-awareness.
// =========================================================================

/** Mirrors sufficiency.server.ts's ESSResult.bin — duplicated here (not
 *  imported) because evidence-gate.server.ts must stay a pure, dependency-
 *  light module; the type is trivial enough that re-declaring it costs
 *  nothing and avoids a new cross-module dependency for one string union. */
export type EssBin = "minimal" | "low" | "medium" | "high";

const SEVERITY_DOWNGRADE: Record<string, string> = {
  critical: "high",
  high: "medium",
  medium: "low",
  low: "info",
  info: "info",
};

export type EssConstraintInput = {
  finding_type: FindingType | null;
  confidence: number | null;
  severity: string | null;
};

export type EssConstraintResult = EssConstraintInput & { downgraded: boolean };

/**
 * A thin corpus (ess.bin 'minimal'/'low') means a DIRECT_EVIDENCE
 * classification, a high-90s confidence, and an unmoderated severity are
 * all claims the underlying evidence base is too sparse to actually
 * support — this caps them. 'medium'/'high' bins are untouched (no-op).
 *
 * Deliberately does NOT downgrade EVIDENCE_BASED_INFERENCE/AI_THEORY
 * further, and does NOT touch findings already exempted from severity
 * inflation elsewhere (a finding already at 'info' stays 'info') — this is
 * a ceiling, never a blanket punitive downgrade of every finding in a
 * LIMITED case.
 */
export function applyEssConstraint(
  finding: EssConstraintInput,
  essBin: EssBin,
): EssConstraintResult {
  if (essBin !== "minimal" && essBin !== "low") {
    return { ...finding, downgraded: false };
  }
  const confidenceCeiling = essBin === "minimal" ? 0.5 : 0.6;
  let downgraded = false;

  let finding_type = finding.finding_type;
  if (finding_type === "DIRECT_EVIDENCE") {
    finding_type = "EVIDENCE_BASED_INFERENCE";
    downgraded = true;
  }

  let confidence = finding.confidence;
  if (confidence != null && confidence > confidenceCeiling) {
    confidence = confidenceCeiling;
    downgraded = true;
  }

  let severity = finding.severity;
  if (severity && SEVERITY_DOWNGRADE[severity] && SEVERITY_DOWNGRADE[severity] !== severity) {
    severity = SEVERITY_DOWNGRADE[severity];
    downgraded = true;
  }

  return { finding_type, confidence, severity, downgraded };
}

/** Matches the "the complete expediente was reviewed and doesn't contain
 *  X" phrasing this codebase's generation prompts are now instructed to
 *  avoid under a thin corpus (see the matching prompt instruction added
 *  alongside this function in pipeline.server.ts) — a defense-in-depth
 *  rewrite for whatever the model emits anyway, LLM prompt compliance
 *  never being guaranteed. Deliberately narrow (the exact audited phrase
 *  pattern, not a general absence-language rewriter) so it can't
 *  accidentally rewrite unrelated prose. */
const ABSENCE_OVERCLAIM_RE = /no se observa en el expediente/gi;
const ABSENCE_SAFE_PHRASING = "no se identificó en el/los documento(s) proporcionado(s)";

/**
 * Rewrites an "absence of evidence" overclaim to the corpus-scoped
 * phrasing when the case-wide ESS bin is 'minimal'/'low' — a partial
 * corpus (1-2 documents) cannot support the stronger claim that the
 * complete official expediente was reviewed and found silent on a topic.
 * A no-op (returns the input unchanged) for 'medium'/'high' bins or text
 * that doesn't contain the overclaiming phrase.
 */
export function rewriteAbsenceWording(text: string | null | undefined, essBin: EssBin): string | null {
  if (!text) return text ?? null;
  if (essBin !== "minimal" && essBin !== "low") return text;
  return text.replace(ABSENCE_OVERCLAIM_RE, (match) => {
    // Preserve sentence-initial capitalization ("No se observa..." at the
    // start of a sentence must stay capitalized after rewriting).
    if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
      return ABSENCE_SAFE_PHRASING[0].toUpperCase() + ABSENCE_SAFE_PHRASING.slice(1);
    }
    return ABSENCE_SAFE_PHRASING;
  });
}

export type MxPerspective =
  | "ministerio_publico"
  | "defensa"
  | "parte_actora"
  | "parte_demandada"
  | "quejoso"
  | "autoridad_responsable"
  | "juzgador"
  | "independiente";

/**
 * Perspectivas procesales aplicables según la materia mexicana. Sin roles
 * extranjeros (no hay "jury": en México no existe jurado en el proceso
 * ordinario) y sin default silencioso a otra materia.
 */
export function determineApplicablePerspectives(caseType: string): MxPerspective[] {
  switch (caseType) {
    case "penal":
      return ["ministerio_publico", "defensa", "juzgador", "independiente"];
    case "amparo":
    case "constitucional":
      return ["quejoso", "autoridad_responsable", "juzgador", "independiente"];
    case "fiscal":
    case "administrativo":
    case "electoral":
      return ["parte_actora", "autoridad_responsable", "juzgador", "independiente"];
    case "civil":
    case "familiar":
    case "mercantil":
    case "laboral":
    case "agrario":
      return ["parte_actora", "parte_demandada", "juzgador", "independiente"];
    default:
      // Materia no resuelta: sólo perspectivas neutrales, nunca se asume una
      // materia concreta.
      return ["juzgador", "independiente"];
  }
}

/**
 * Build a fast lookup set of entity names extracted during the document
 * extraction pass. Witnesses whose names don't appear here are rejected.
 */
export async function buildEntityIndex(
  db: SupabaseClient<Database>,
  caseId: string,
): Promise<{ names: Set<string>; corpus: GroundingCorpus }> {
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,extracted_text,entities,status")
    .eq("case_id", caseId)
    // Secondary sort on `id` for deterministic doc_n numbering — see the
    // identical note in shared-brief.server.ts's loadCorpus().
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const extracted = (docs ?? []).filter((d) => d.status === "extracted");
  const corpus = buildGroundingCorpus(
    extracted.map((d) => ({ id: d.id as string, filename: d.filename, extracted_text: d.extracted_text })),
  );
  const names = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const d of extracted) {
    const ents = d.entities;
    if (Array.isArray(ents)) {
      for (const e of ents) {
        if (e && typeof e === "object") {
          const obj = e as { type?: string; value?: string; name?: string };
          const v = obj.value ?? obj.name;
          if (typeof v === "string" && v.trim().length >= 2) names.add(norm(v));
        }
      }
    }
    // Fallback: detect capitalized name-like spans from the extracted text.
    const text = d.extracted_text ?? "";
    const nameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(text)) !== null) names.add(norm(m[1]));
  }
  return { names, corpus };
}

export function witnessNameFound(name: string, index: Set<string>): boolean {
  if (!name) return false;
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (index.has(n)) return true;
  // Match on last name too — single-token entries (e.g. "Martinez")
  const parts = n.split(" ");
  for (const indexed of index) {
    if (indexed.includes(n) || n.includes(indexed)) return true;
    const ip = indexed.split(" ");
    if (parts.length && ip.length && parts[parts.length - 1] === ip[ip.length - 1]) return true;
  }
  return false;
}

export async function getAnalysisMode(db: SupabaseClient<Database>, caseId: string): Promise<AnalysisMode> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await db
    .from("cases")
    .select("analysis_mode" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (data as any)?.analysis_mode;
  // Default is "balanced": still requires a verified citation (AI_THEORY
  // items with no matching quote are dropped), but keeps evidence-backed
  // inferences ("suggests", "may indicate") that "strict" would reject.
  // Strict was rejecting ~100% of well-cited findings on real corpora
  // because LLM output naturally hedges. Callers that need maximum rigor
  // can still set cases.analysis_mode = 'strict' explicitly.
  if (v === "strict" || v === "balanced" || v === "exploratory") return v;
  return "balanced";
}

export function relabelMissingEvidence(title: string): string {
  // "Missing Police Report" → "Police Report Not Found In Uploaded Documents"
  const t = title.replace(/^missing[:\s-]+/i, "").trim();
  if (/not found in uploaded documents/i.test(title)) return title;
  if (/^missing/i.test(title) || title !== t) {
    return `${t || title} Not Found In Uploaded Documents`;
  }
  return title;
}

export function computeEvidenceConfidence(opts: {
  citationCount: number;
  corroboratingDocuments: number;
  supportingQuotes: number;
  contradictions: number;
}): number {
  const raw = opts.citationCount + opts.corroboratingDocuments + opts.supportingQuotes - opts.contradictions;
  // Saturating normalization — 6+ pieces of support ≈ 1.0
  return Math.max(0, Math.min(1, raw / 6));
}

// =========================================================================
// MATERIA TERMINOLOGY GUARD
//
// Two independent rules:
//  1. U.S. common-law terminology is forbidden in EVERY materia — there is no
//     Mexican matter in which "grand jury" or "fourth amendment" is correct.
//     (The previous revision only applied this to "civil" case types, and it
//     keyed on the retired U.S. values "criminal"/"civil_rights", so it never
//     fired at all once case types became Mexican materias.)
//  2. Penal-only concepts must not leak into a non-penal materia.
// =========================================================================
const US_TERMS =
  /\b(conviction|acquittal|miranda|brady( violation| material| disclosure)?|suppression motion|motion to suppress|motion for summary judgment|summary judgment|search and seizure|reasonable doubt|prosecutor|district attorney|grand jury|indictment|arraignment|plea (?:bargain|agreement|deal)|felony|misdemeanor|first amendment|fourth amendment|fifth amendment|sixth amendment|exclusionary rule|fruit of the poisonous tree|hearsay|deposition|subpoena|discovery request)\b/i;
/** Penal-only concepts, in Mexican terms, that must not appear in other materias. */
const PENAL_ONLY_TERMS =
  /\b(carpeta de investigaci[oó]n|vinculaci[oó]n a proceso|prisi[oó]n preventiva|ministerio p[uú]blico|imputad[oa]|juicio oral penal|auto de apertura a juicio)\b/i;
const PENAL_OPP_TYPES = new Set(["suppression", "constitutional", "miranda", "brady", "exclusion_prueba_ilicita"]);
const PENAL_WORK_PRODUCT = new Set([
  "motion_to_suppress",
  "solicitud_exclusion_prueba_ilicita",
  "solicitud_de_no_vinculacion_a_proceso",
  "impugnacion_de_medidas_cautelares",
  "guion_de_audiencia_de_juicio_oral",
  "teoria_del_caso",
]);

/** Penal-family materias (penal proper and the constitutional/human-rights track). */
function isPenalCaseType(caseType: string | null | undefined): boolean {
  const t = String(caseType ?? "").toLowerCase();
  return t === "penal" || t === "constitucional" || t === "amparo";
}

/**
 * Retained for existing call sites. In the Mexican taxonomy "civil" means
 * "not the penal track" — used only to decide whether penal-only vocabulary
 * is admissible.
 */
export function isCivilCaseType(caseType: string | null | undefined): boolean {
  if (!caseType) return true;
  return !isPenalCaseType(caseType);
}

/** True if the text is compatible with the locked materia. */
export function textMatchesCaseType(text: string, caseType: string | null | undefined): boolean {
  if (!text) return true;
  if (US_TERMS.test(text)) return false;
  if (isCivilCaseType(caseType)) return !PENAL_ONLY_TERMS.test(text);
  return true;
}

export function filterByCaseType<
  T extends {
    title?: string | null;
    description?: string | null;
    opportunity_type?: string | null;
    document_type?: string | null;
  },
>(items: T[], caseType: string | null | undefined): T[] {
  const civil = isCivilCaseType(caseType);
  return items.filter((it) => {
    if (civil && it.opportunity_type && PENAL_OPP_TYPES.has(String(it.opportunity_type))) return false;
    if (civil && it.document_type && PENAL_WORK_PRODUCT.has(String(it.document_type))) return false;
    const blob = `${it.title ?? ""} ${it.description ?? ""}`;
    return textMatchesCaseType(blob, caseType);
  });
}

/** Reads cases.case_type — the user-locked authoritative source. Null when unset. */
export async function getLockedCaseType(db: SupabaseClient<Database>, caseId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await db
    .from("cases")
    .select("case_type" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (data as any)?.case_type;
  return typeof v === "string" && v.length > 0 ? v : null;
}

// =========================================================================
// EVIDENCE-EXISTENCE GUARD
//
// A finding may *reference* an evidence type ("GPS conflict", "expert report
// inconsistency") without that evidence actually being present in the uploaded
// documents. The agent must distinguish:
//   - Evidence Exists      → the underlying document is in the corpus
//   - Evidence Referenced  → the corpus only mentions it
//   - Evidence Missing     → neither present nor referenced
//
// Findings that depend on a category of evidence (GPS records, ECM data,
// surveillance footage, expert reports, police reports, witness statements,
// maintenance records, medical exhibits, etc.) must be REJECTED unless that
// kind of evidence actually exists in the uploaded corpus.
// =========================================================================

export type EvidenceCategory =
  | "gps"
  | "ecm"
  | "surveillance"
  | "expert_report"
  | "police_report"
  | "witness_statement"
  | "maintenance_record"
  | "medical_exhibit"
  | "phone_record"
  | "lab_report";

// Patterns that indicate the FINDING depends on a given evidence category.
const FINDING_DEPENDS: Record<EvidenceCategory, RegExp> = {
  gps: /\bgps\b|geolocat|gps (data|record|log|conflict)/i,
  ecm: /\becm\b|engine control module|black box|event data recorder|\bedr\b/i,
  surveillance: /surveillance|cctv|security (camera|footage)|video footage/i,
  expert_report: /expert (report|opinion|conflict|inconsistenc|disclosure)/i,
  police_report: /police report|incident report|crash report|accident report/i,
  witness_statement: /witness statement|witness (contradiction|conflict|inconsisten)/i,
  maintenance_record: /maintenance (record|log|history)|vehicle maintenance|service record/i,
  medical_exhibit: /medical (exhibit|record|chart|imaging|x-?ray|mri|ct scan)/i,
  phone_record: /phone record|call log|text message log|cell tower/i,
  lab_report: /lab (report|result|analysis)|toxicology|blood test/i,
};

// Patterns that indicate the corpus actually CONTAINS that evidence (vs only
// referencing it). We look for column headers, units, telemetry markers, or
// document-type signals — not just the topic word.
const CORPUS_HAS: Record<EvidenceCategory, RegExp> = {
  gps: /\b\d{1,3}\.\d{3,}[°\s,]+-?\d{1,3}\.\d{3,}|latitude\s*[:=]|longitude\s*[:=]|\bgpx\b|nmea/i,
  ecm: /(rpm|throttle|brake pressure|vehicle speed)\s*[:=]|ecm download|edr report|crash data retrieval/i,
  surveillance: /camera id|frame \d+|timecode|video file|\.mp4|\.mov|surveillance log/i,
  expert_report: /expert (witness )?report|rule 26|expert disclosure|cv of (dr\.|expert)|methodology section/i,
  police_report: /(officer|deputy) (narrative|report)|case (#|number)\s*[:#]|incident (#|number)|cad #/i,
  witness_statement:
    /(deposition of|sworn statement|affidavit of|under penalty of perjury|i,? .{2,40},? (declare|state|swear))/i,
  maintenance_record: /(work order|repair order|service ticket|odometer|parts replaced|labor hours)/i,
  medical_exhibit: /(chief complaint|history of present illness|assessment and plan|icd-?10|cpt code|impression:)/i,
  phone_record: /(call detail record|cdr|imei|cell site|tower id|sms log)/i,
  lab_report: /(specimen|chain of custody|reference range|result:\s*\d|reported by lab|certificate of analysis)/i,
};

export function detectFindingDependencies(text: string): EvidenceCategory[] {
  const out: EvidenceCategory[] = [];
  for (const [k, re] of Object.entries(FINDING_DEPENDS) as [EvidenceCategory, RegExp][]) {
    if (re.test(text)) out.push(k);
  }
  return out;
}

export function corpusContainsEvidence(corpusText: string, cat: EvidenceCategory): boolean {
  return CORPUS_HAS[cat].test(corpusText);
}

/**
 * Returns true when every evidence category the finding depends on actually
 * exists in the uploaded corpus. When false, the caller MUST reject the
 * finding — "mention of evidence ≠ existence of evidence".
 */
export function evidenceDependenciesSatisfied(
  text: string,
  corpusText: string,
): { ok: boolean; missing: EvidenceCategory[] } {
  const deps = detectFindingDependencies(text);
  if (deps.length === 0) return { ok: true, missing: [] };
  const missing = deps.filter((d) => !corpusContainsEvidence(corpusText, d));
  return { ok: missing.length === 0, missing };
}

/**
 * Strip Brady references from civil-case findings/strings. Brady v. Maryland
 * is a criminal-prosecution disclosure rule and has no place in civil matters.
 */
// REBUILT 2026-07-29: renamed from stripBradyForCivil. "Brady" (U.S.
// disclosure doctrine) has no standing in Mexican procedure; the actual
// concept this function guards — omisión en el deber de aportación
// probatoria (CPEUM Art. 21, CNPP Art. 218-219) — is penal-specific the
// same way Brady was criminal-only, so the civil-strip behavior is
// correct and kept, just renamed and rematched to the real term.
export function stripOmisionProbatoriaForCivil<
  T extends { title?: string | null; description?: string | null; legal_significance?: string | null; tags?: unknown },
>(item: T, caseType: string | null | undefined): T | null {
  if (!isCivilCaseType(caseType)) return item;
  const blob = `${item.title ?? ""} ${item.description ?? ""} ${item.legal_significance ?? ""}`;
  // If the entire finding is fundamentally an omisión-probatoria claim, drop it.
  if (
    /\bomisi[oó]n\s+probatoria\b/i.test(item.title ?? "") ||
    /\bomisi[oó]n\s+probatoria\b/i.test(item.legal_significance ?? "")
  ) {
    return null;
  }
  // Otherwise scrub omisión-probatoria mentions from text fields and tags.
  const scrub = (s: string | null | undefined) =>
    typeof s === "string"
      ? s
          .replace(/\bomisi[oó]n\s+probatoria\s*(procesal|disclosure|risk)?\b/gi, "")
          .replace(/\s{2,}/g, " ")
          .trim()
      : s;
  const tags = Array.isArray(item.tags)
    ? (item.tags as unknown[]).filter((t) => typeof t !== "string" || !/omision_probatoria/i.test(t))
    : item.tags;
  return {
    ...item,
    title: scrub(item.title) as T["title"],
    description: scrub(item.description) as T["description"],
    legal_significance: scrub(item.legal_significance) as T["legal_significance"],
    tags: tags as T["tags"],
  };
}

/** Contradiction validator: rejects label-vs-label and empty/identical pairs. */
export function isMeaningfulContradiction(a: string | null | undefined, b: string | null | undefined): boolean {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (sa.length < 8 || sb.length < 8) return false;
  if (sa.toLowerCase() === sb.toLowerCase()) return false;
  // Reject label-only statements like "GPS data", "Witness statement", "Expert report"
  const LABEL_ONLY =
    /^(gps( data| record)?|witness statement|expert (report|opinion)|police report|maintenance (record|log)|surveillance footage|medical (record|exhibit))$/i;
  if (LABEL_ONLY.test(sa) || LABEL_ONLY.test(sb)) return false;
  return true;
}
