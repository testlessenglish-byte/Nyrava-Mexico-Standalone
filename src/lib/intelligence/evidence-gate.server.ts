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
    if (verified.length > 0) {
      type = classifyFindingType({ hasVerifiedCitation: true, text });
      if (type === "EVIDENCE_BASED_INFERENCE") audit.downgraded_inference += 1;
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

    // Mode policy:
    //   strict       → only DIRECT_EVIDENCE
    //   balanced     → DIRECT_EVIDENCE + EVIDENCE_BASED_INFERENCE
    //   exploratory  → all, but AI_THEORY explicitly labeled
    if (opts.mode === "strict" && type !== "DIRECT_EVIDENCE") {
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
    if (opts.mode === "balanced" && type === "AI_THEORY") continue;
    if (type === "AI_THEORY") audit.tagged_ai_theory += 1;

    const primary = verified[0] ?? candidates[0] ?? null;
    audit.accepted += 1;
    accepted.push({
      index,
      item,
      gated: {
        ...item,
        finding_type: type,
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

export function applyEvidenceGate<T extends EvidenceItem>(
  items: T[],
  opts: GateOptions,
): { items: GatedItem<T>[]; audit: GateAudit } {
  const result = diagnoseEvidenceGate(items, opts);
  return { items: result.accepted.map((x) => x.gated), audit: result.audit };
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
    .order("created_at", { ascending: true });
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
// CASE-TYPE TERMINOLOGY GUARD
// Civil matters must not surface criminal-only concepts (and vice versa).
// =========================================================================
const CRIMINAL_TERMS =
  /\b(conviction|acquittal|miranda|brady( violation| material| disclosure)?|suppression motion|motion to suppress|search and seizure|reasonable doubt|prosecution(?: strategy| theory)?|prosecutor|grand jury|indictment|arraignment|plea (?:agreement|deal)|sentencing|probation|parole|felony|misdemeanor|fourth amendment|fifth amendment|sixth amendment|exclusionary rule|fruit of the poisonous tree)\b/i;
const CRIMINAL_OPP_TYPES = new Set(["suppression", "constitutional", "miranda", "brady"]);
const CRIMINAL_WORK_PRODUCT = new Set(["motion_to_suppress"]);

export function isCivilCaseType(caseType: string | null | undefined): boolean {
  if (!caseType) return true;
  return caseType !== "criminal" && caseType !== "civil_rights";
}

/** True if the text is compatible with the locked case type. */
export function textMatchesCaseType(text: string, caseType: string | null | undefined): boolean {
  if (!text) return true;
  if (isCivilCaseType(caseType)) return !CRIMINAL_TERMS.test(text);
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
  if (!isCivilCaseType(caseType)) return items;
  return items.filter((it) => {
    if (it.opportunity_type && CRIMINAL_OPP_TYPES.has(String(it.opportunity_type))) return false;
    if (it.document_type && CRIMINAL_WORK_PRODUCT.has(String(it.document_type))) return false;
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
export function stripBradyForCivil<
  T extends { title?: string | null; description?: string | null; legal_significance?: string | null; tags?: unknown },
>(item: T, caseType: string | null | undefined): T | null {
  if (!isCivilCaseType(caseType)) return item;
  const blob = `${item.title ?? ""} ${item.description ?? ""} ${item.legal_significance ?? ""}`;
  // If the entire finding is fundamentally a Brady claim, drop it.
  if (/\bbrady\b/i.test(item.title ?? "") || /\bbrady\b/i.test(item.legal_significance ?? "")) {
    return null;
  }
  // Otherwise scrub Brady mentions from text fields and tags.
  const scrub = (s: string | null | undefined) =>
    typeof s === "string"
      ? s
          .replace(/\bbrady\s*(violation|material|disclosure|risk)?\b/gi, "")
          .replace(/\s{2,}/g, " ")
          .trim()
      : s;
  const tags = Array.isArray(item.tags)
    ? (item.tags as unknown[]).filter((t) => typeof t !== "string" || !/brady/i.test(t))
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
