// Completed Case Audit / Outcome Assessment — a review LAYER, not a new
// pipeline. Runs ONLY for case_analysis_mode !== "ongoing", ONLY after the
// existing findings/scoring/report/release-review stages have already
// completed, and consumes their EXISTING output (case_findings, case_scores,
// reports) rather than reprocessing documents or re-running any analyzer or
// agent. This is the "final quality-control attorney review" simulation:
// audit what the pipeline already concluded, re-verify statutory citations
// against the real legal-source corpus (never trusting the model's own
// memory for that), identify both sides' strongest positions, and produce a
// probability-based outcome assessment with reasoning — never a guarantee.
//
// ZERO-HALLUCINATION ENFORCEMENT — this is the "system-level validation
// rule" requirement: the model's own self-assigned classification is NEVER
// trusted on its own. A statement can only survive as FACT_DOCUMENTED or
// COURT_FINDING if its claimed quote actually verifies against the case's
// own documents (verifyQuoteDetailed — the exact same primitive the rest of
// this codebase's citation floor already relies on), and can only survive
// as LAW_VERIFIED if it cross-references a citation that
// verifyStatutoryCitation() (added for Talk-to-Case) independently marked
// VERIFIED. Anything that fails is forcibly downgraded in code, regardless
// of what the model claimed — see enforceStatementSource()/enforceLawSource()
// below.
//
// Persists to public.case_outcome_assessments (additive, brand-new table —
// never touches case_findings, cases, or reports). See the migrations
// 20260809135402_completed_case_audit.sql and
// 20260809140747_completed_case_audit_outcome_status.sql for the schema
// this writes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { mexicoLock, groundingContract, getReportLocale } from "@/lib/mexico-lock";
import { callGroq, parseJsonLoose, GROQ_DEFAULT_MODEL } from "@/lib/groq.server";
import { resolveProviderKeys } from "@/lib/ai-key-router.server";
import { getCaseAnalysisMode, isCompletedCaseMode } from "./case-analysis-mode";
import { extractCitationsFromText } from "@/lib/legal-connectors/citation-extract";
import {
  verifyStatutoryCitation,
  type StatutoryCitationVerification,
} from "@/lib/legal/citation-verification.server";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";
import {
  buildGroundingCorpus,
  verifyQuoteDetailed,
  type GroundingCorpus,
} from "./grounding.server";
import { locateQuoteInText, pageForOffset } from "./evidence-provenance.server";

type Db = SupabaseClient<Database>;
const MODEL = GROQ_DEFAULT_MODEL;

const FINDING_REVIEW_STATUSES = [
  "VERIFIED",
  "CORRECTED",
  "UNVERIFIED",
  "CONTRADICTED",
  "MISSING_EVIDENCE",
] as const;
type FindingReviewStatus = (typeof FINDING_REVIEW_STATUSES)[number];

const SOURCE_CLASSIFICATIONS = [
  "FACT_DOCUMENTED",
  "LAW_VERIFIED",
  "COURT_FINDING",
  "INFERENCE",
  "POSSIBILITY",
  "UNKNOWN",
] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

const NOT_ESTABLISHED = "NOT ESTABLISHED FROM THE AVAILABLE RECORD";
const SOURCE_NOT_LOCATED = "SOURCE NOT LOCATED — DO NOT TREAT AS ESTABLISHED";
const AUTHORITY_NOT_VERIFIED = "LEGAL AUTHORITY NOT VERIFIED";

export type SourceReference = {
  document_id: string | null;
  filename: string | null;
  page: number | null;
  quote: string | null;
} | null;

export type ClassifiedStatement = {
  text: string;
  classification: SourceClassification;
  source: SourceReference;
  note?: string;
};

export type CompletedCaseAuditResult = {
  id: string;
  overall_position: "FAVORABLE" | "UNFAVORABLE" | "MIXED";
  outcome_status: "ESTIMATED" | "INSUFFICIENT_DATA";
  favorable_pct: number | null;
  unfavorable_pct: number | null;
  confidence: "LOW" | "MODERATE" | "HIGH" | null;
  no_material_error_identified: boolean;
} | null;

/** Article-number citations only ("Art. 123 de la Ley..." / "Art. 123") —
 *  extractCitationsFromText's own generation format, parsed back out. Bare
 *  code mentions and tesis/jurisprudencia registry numbers are excluded:
 *  neither has an article number verifyStatutoryCitation can check. */
function parseArticleCitation(
  citationText: string,
): { articleNumber: string; authorityHint: string } | null {
  const m = /^Art\.\s+(\S+)(?:\s+de\s+(.+))?$/u.exec(citationText);
  if (!m) return null;
  const articleNumber = m[1];
  const authorityHint = (m[2] ?? "").trim();
  if (!authorityHint) return null; // no statute name to resolve against — can't verify
  return { articleNumber, authorityHint };
}

async function getKeys(db: Db, userId: string, override?: string): Promise<string[]> {
  const resolved = await resolveProviderKeys(db, userId, "groq");
  if (override) return [override, ...resolved.keys.filter((k) => k !== override)];
  return resolved.keys;
}

async function logUsage(
  db: Db,
  args: {
    userId: string;
    caseId: string;
    model: string;
    latencyMs: number;
    success: boolean;
    error?: string;
  },
) {
  await db.from("ai_usage").insert({
    user_id: args.userId,
    case_id: args.caseId,
    model: args.model,
    operation: "completed_case_audit",
    success: args.success,
    latency_ms: args.latencyMs,
    error: args.error ?? null,
  });
}

const FORBIDDEN_CERTAINTY =
  /\b(you will win|guaranteed victory|100% chance|ganará(s)? seguro|victoria garantizada)\b/i;
function scrubCertainty(s: unknown): string {
  const str = String(s ?? "");
  return FORBIDDEN_CERTAINTY.test(str)
    ? "[redacted — the model's original wording overclaimed certainty; see biggest_risk/confidence instead]"
    : str;
}

/** Resolves a claimed quote against the case's real documents — the SAME
 *  primitive the rest of this codebase's citation floor already trusts.
 *  Returns null when the quote doesn't actually verify (missing, invented,
 *  or paraphrased beyond the soft-match threshold). */
export function resolveSource(
  quote: string | null | undefined,
  corpus: GroundingCorpus,
  docs: Array<{ id: string; filename: string; extracted_text: string | null }>,
): SourceReference {
  if (!quote) return null;
  if (!verifyQuoteDetailed(quote, corpus).verified) return null;
  for (const doc of docs) {
    const loc = locateQuoteInText(quote, doc.extracted_text ?? "");
    if (loc) {
      return {
        document_id: doc.id,
        filename: doc.filename,
        page: pageForOffset(loc.start, corpus.pageChars),
        quote,
      };
    }
  }
  // Verified against the corpus as a whole (a soft/shingle match spanning a
  // normalization boundary can do this) but couldn't be pinned to one
  // document's raw text — still real, just without a page number.
  return { document_id: null, filename: null, page: null, quote };
}

/**
 * THE technical barrier the spec asks for: a statement can only keep a
 * FACT_DOCUMENTED or COURT_FINDING classification if its claimed quote
 * actually resolves against the case's own documents. This NEVER trusts the
 * model's self-assigned classification — every FACT_DOCUMENTED/COURT_FINDING
 * claim is independently re-checked here, and forcibly downgraded to UNKNOWN
 * with an explicit SOURCE NOT LOCATED note if the quote doesn't verify (or
 * wasn't provided at all).
 */
export function enforceStatementSource(
  item: { text?: unknown; classification?: unknown; quote?: unknown },
  corpus: GroundingCorpus,
  docs: Array<{ id: string; filename: string; extracted_text: string | null }>,
): ClassifiedStatement | null {
  const text = scrubCertainty(item.text);
  if (!text) return null;
  const claimed = SOURCE_CLASSIFICATIONS.includes(item.classification as SourceClassification)
    ? (item.classification as SourceClassification)
    : "UNKNOWN";
  const quote = typeof item.quote === "string" ? item.quote : null;

  if (claimed === "FACT_DOCUMENTED" || claimed === "COURT_FINDING") {
    const source = resolveSource(quote, corpus, docs);
    if (!source) return { text, classification: "UNKNOWN", source: null, note: SOURCE_NOT_LOCATED };
    return { text, classification: claimed, source };
  }
  // LAW_VERIFIED is gated separately (enforceLawSource) since it verifies
  // against legal_authorities/legal_articles, not the case corpus.
  if (claimed === "LAW_VERIFIED")
    return { text, classification: "UNKNOWN", source: null, note: AUTHORITY_NOT_VERIFIED };
  // INFERENCE / POSSIBILITY / UNKNOWN never claim to be established, so no
  // source is required — but attach one opportunistically if the model gave
  // a quote that happens to verify, since that only strengthens the item.
  return {
    text,
    classification: claimed,
    source: quote ? resolveSource(quote, corpus, docs) : null,
  };
}

/** Same barrier, for legal-authority claims: only survives as LAW_VERIFIED
 *  if it names a citation this run's deterministic re-verification (see
 *  runCompletedCaseAudit's citationReviews) independently marked VERIFIED. */
export function enforceLawSource(
  item: { text?: unknown; citation_text?: unknown },
  citationReviews: Array<{ citation_text: string; verification: StatutoryCitationVerification }>,
): ClassifiedStatement | null {
  const text = scrubCertainty(item.text);
  if (!text) return null;
  const citationText = typeof item.citation_text === "string" ? item.citation_text : null;
  const match = citationText
    ? citationReviews.find((c) => c.citation_text === citationText)
    : undefined;
  if (match && match.verification.status === "VERIFIED") {
    return {
      text,
      classification: "LAW_VERIFIED",
      source: {
        document_id: null,
        filename: null,
        page: null,
        quote: match.verification.matched_article_body,
      },
    };
  }
  return { text, classification: "UNKNOWN", source: null, note: AUTHORITY_NOT_VERIFIED };
}

/**
 * Runs the completed-case audit for one case. No-op (returns null) when the
 * case is not under a completed-case analysis mode — safe to call
 * unconditionally from the pipeline's finalization step.
 */
export async function runCompletedCaseAudit(
  db: Db,
  caseId: string,
  userId: string,
  apiKey?: string,
): Promise<CompletedCaseAuditResult> {
  const mode = await getCaseAnalysisMode(db, caseId);
  if (!isCompletedCaseMode(mode)) return null;

  const { data: caseRow } = await db
    .from("cases")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("created_at" as any)
    .eq("id", caseId)
    .maybeSingle();
  // Best-effort "relevant date" for temporal-validity checks — no dedicated
  // acto-reclamado/filing-date field exists on cases yet. Conservative
  // fallback only; legal-validity.ts already treats a missing/uncertain
  // date as "cannot verify vigency" rather than asserting current law.
  const caseDate = (caseRow as { created_at?: string } | null)?.created_at ?? null;

  const { data: docsRaw } = await db
    .from("documents")
    .select("id,filename,extracted_text")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const docs = (docsRaw ?? []) as Array<{
    id: string;
    filename: string;
    extracted_text: string | null;
  }>;
  const corpus = buildGroundingCorpus(docs);

  const { data: findingsRaw } = await db
    .from("case_findings")
    .select(
      "id,title,description,category,severity,confidence,legal_significance,evidence_refs,audit_classification,finding_type,source_module",
    )
    .eq("case_id", caseId)
    .not("source_module", "like", PROJECTION_LIKE);
  const findings = (findingsRaw ?? []) as Array<{
    id: string;
    title: string;
    description: string;
    category: string;
    severity: string;
    confidence: number;
    legal_significance: string | null;
    evidence_refs: unknown;
    audit_classification: string | null;
    finding_type: string | null;
    source_module: string;
  }>;
  if (findings.length === 0) return null; // nothing to audit yet

  const { data: scoreRow } = await db
    .from("case_scores")
    .select(
      "evidence_strength,witness_reliability,timeline_integrity,constitutional_compliance,investigation_completeness,case_quality,overall_confidence",
    )
    .eq("case_id", caseId)
    .maybeSingle();

  const { data: reportRow } = await db
    .from("reports")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("executive_summary" as any)
    .eq("case_id", caseId)
    .maybeSingle();

  // ---- Deterministic statutory-citation re-verification ------------------
  // Never let the model decide what got checked or how — extract citations
  // from the EXISTING findings text with the same conservative extractor
  // the connector framework uses, then verify each deterministically
  // against public.legal_authorities/legal_articles.
  const citationTexts = new Set<string>();
  for (const f of findings) {
    for (const t of [f.title, f.description, f.legal_significance ?? ""]) {
      for (const c of extractCitationsFromText(t)) citationTexts.add(c.citationText);
    }
  }
  const citationReviews: Array<{
    citation_text: string;
    verification: StatutoryCitationVerification;
  }> = [];
  for (const citationText of citationTexts) {
    const parsed = parseArticleCitation(citationText);
    if (!parsed) continue;
    const verification = await verifyStatutoryCitation(db, {
      authorityHint: parsed.authorityHint,
      articleNumber: parsed.articleNumber,
      caseDate,
    });
    citationReviews.push({ citation_text: citationText, verification });
  }

  const locale = await getReportLocale(db, caseId);
  const apiKeys = await getKeys(db, userId, apiKey);

  const findingsForPrompt = findings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description.slice(0, 600),
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    audit_classification: f.audit_classification,
  }));

  const citationsForPrompt = citationReviews.map((c) => ({
    citation: c.citation_text,
    status: c.verification.status,
    reasons: c.verification.reasons,
  }));

  const t0 = Date.now();
  let r: Awaited<ReturnType<typeof callGroq>>;
  try {
    r = await callGroq({
      apiKeys,
      model: MODEL,
      temperature: 0.15,
      json: true,
      systemInstruction: `${mexicoLock(locale)}

${groundingContract(locale)}

You are a senior Mexican litigation attorney performing a FINAL QUALITY-CONTROL AUDIT of a completed case analysis — a "second pair of eyes" review, not a fresh investigation. Accuracy is more important than producing an answer. You may NEVER invent facts, evidence, citations, statutes, court holdings, defendants, procedural events, testimony, or documents.

ZERO-HALLUCINATION RULES (mandatory):
- If something is not established by the EXISTING FINDINGS, the case documents, or the CITATION VERIFICATION RESULTS below, write "${NOT_ESTABLISHED}" — never guess, never infer that something happened merely because it would normally happen in a case like this.
- Do not assume a document, testimony, search, seizure, arrest, interrogation, expert examination, or hearing occurred unless the record actually establishes it.
- EVERY statement you classify FACT_DOCUMENTED or COURT_FINDING MUST include a "quote" field with the EXACT verbatim text from the case's own documents that supports it — copied character-for-character, not paraphrased. A statement with no genuine supporting quote CANNOT be FACT_DOCUMENTED or COURT_FINDING; classify it INFERENCE, POSSIBILITY, or UNKNOWN instead. This is independently re-verified in code — a fabricated or paraphrased quote will be caught and the statement downgraded regardless of what you write here, so do not attempt to satisfy this requirement with an invented quote.
- EVERY statement you classify LAW_VERIFIED MUST include a "citation_text" field matching EXACTLY one of the strings in CITATION VERIFICATION RESULTS below, and that citation's status must be "VERIFIED" there — never mark something LAW_VERIFIED from memory. This is also independently re-checked in code.
- If the record does not establish the supporting location for a claim, do not present it as established.
- If two documents/findings conflict, do NOT silently pick one — report both and describe the conflict (record_conflicts).
- It is a valid and IMPORTANT result to find NO material error. Do not manufacture a weakness or an error to have something to report. If you find nothing wrong, say so plainly (leave confirmed_errors empty).
- If the anonymized identity of a party is not stated in the record, do NOT infer or invent a name, address, age, criminal history, organization, or personal history for them.
- If the available evidence is too thin to support a meaningful outcome probability, set "outcome_status" to "INSUFFICIENT_DATA" and explain why in "basis" — do NOT invent a plausible-sounding percentage. A real percentage must be traceable to specific factors below, never a generic/round default like 75/25.
- Distinguish the law as it applied at the time of the events (LAW AT TIME OF EVENTS) from current law where a reform changed it — the CITATION VERIFICATION RESULTS already carry vigency information; use it, do not override it from memory.
- Never write "you will win", "guaranteed", or "100% chance" anywhere.

Output STRICT JSON only, in ${locale === "en" ? "English" : "Spanish (México)"}.`,
      userContent: `EXISTING FINDINGS (audit these — do not invent new ones):
${JSON.stringify(findingsForPrompt)}

CITATION VERIFICATION RESULTS (ground truth — deterministic, from the real legal-source corpus; cite ONLY these by exact string in citation_text fields):
${citationsForPrompt.length > 0 ? JSON.stringify(citationsForPrompt) : "No statutory article citations with a resolvable statute name were found in the existing findings' text — do not classify anything LAW_VERIFIED."}

CASE SCORE SUMMARY (already computed, for context only):
${JSON.stringify(scoreRow ?? {})}

EXECUTIVE SUMMARY (already generated, for context only):
${String((reportRow as { executive_summary?: string } | null)?.executive_summary ?? "").slice(0, 3000)}

Return STRICT JSON. Every item in verified_facts/court_findings/confirmed_errors/potential_issues/unverified_claims/defense_opportunities/prosecution_counterarguments is { "text": string, "classification": "FACT_DOCUMENTED"|"COURT_FINDING"|"INFERENCE"|"POSSIBILITY"|"UNKNOWN", "quote": string|null }. Every item in verified_law is { "text": string, "citation_text": string }.
{
  "verified_facts": [ {...} ],
  "verified_law": [ {...} ],
  "court_findings": [ {...} ],
  "confirmed_errors": [ {...} ],
  "potential_issues": [ {...} ],
  "unverified_claims": [ {...} ],
  "record_conflicts": [ { "description": string, "quote_a": string|null, "quote_b": string|null } ],
  "missing_information": [ string ],
  "defense_opportunities": [ {...} ],
  "prosecution_counterarguments": [ {...} ],
  "outcome_status": "ESTIMATED"|"INSUFFICIENT_DATA",
  "favorable_pct": number (0-100, only meaningful if outcome_status is ESTIMATED),
  "unfavorable_pct": number (0-100, must be 100 - favorable_pct),
  "confidence": "LOW"|"MODERATE"|"HIGH",
  "basis": string (WHY this percentage — must reference specific evidence/factors, required if outcome_status is ESTIMATED),
  "overall_position": "FAVORABLE"|"UNFAVORABLE"|"MIXED",
  "principal_strength": string,
  "principal_weakness": string,
  "biggest_risk": string,
  "most_important_missing_evidence": string,
  "factors": {
    "legal_foundation": string, "evidence_strength": string, "procedural_position": string,
    "contradictions": string, "opposing_arguments": string, "missing_evidence": string,
    "witness_evidence_reliability": string, "applicable_mexican_law": string,
    "serious_vulnerabilities": string, "potential_dispositive_issues": string
  },
  "finding_reviews": [ { "finding_id": string, "status": "VERIFIED"|"CORRECTED"|"UNVERIFIED"|"CONTRADICTED"|"MISSING_EVIDENCE", "note": string } ]
}`,
    });
  } catch (e) {
    await logUsage(db, {
      userId,
      caseId,
      model: MODEL,
      latencyMs: Date.now() - t0,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return null; // non-fatal — the completed-case pipeline already finished successfully without this audit
  }
  await logUsage(db, {
    userId,
    caseId,
    model: r.model ?? MODEL,
    latencyMs: Date.now() - t0,
    success: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJsonLoose<Record<string, any>>(r.text);
  if (!parsed) return null;

  // ---- Deterministic source-verification gate — THE technical barrier ----

  const toStatements = (arr: unknown): ClassifiedStatement[] =>
    (Array.isArray(arr) ? arr : [])
      .map((item) => enforceStatementSource(item as Record<string, unknown>, corpus, docs))
      .filter((x): x is ClassifiedStatement => x !== null);

  const verifiedFacts = toStatements(parsed.verified_facts);
  const courtFindings = toStatements(parsed.court_findings);
  const potentialIssues = toStatements(parsed.potential_issues);
  const unverifiedClaims = toStatements(parsed.unverified_claims);
  const defenseOpportunities = toStatements(parsed.defense_opportunities);
  const prosecutionCounterarguments = toStatements(parsed.prosecution_counterarguments);

  const verifiedLaw = (Array.isArray(parsed.verified_law) ? parsed.verified_law : [])
    .map((item: Record<string, unknown>) => enforceLawSource(item, citationReviews))
    .filter((x: ClassifiedStatement | null): x is ClassifiedStatement => x !== null);

  // confirmed_errors is the highest-stakes bucket — the spec's explicit
  // "model must be unable to mark something CONFIRMED without a source"
  // requirement. An error claim needs EITHER a verified case-document quote
  // OR a verified legal citation behind it; anything that fails either check
  // is demoted into potential_issues rather than discarded, since "we think
  // there might be an issue here, but couldn't independently confirm it" is
  // still real information — it's the CONFIRMED label that's not earned.
  const confirmedErrorsRaw = Array.isArray(parsed.confirmed_errors) ? parsed.confirmed_errors : [];
  const confirmedErrors: ClassifiedStatement[] = [];
  for (const raw of confirmedErrorsRaw) {
    const item = raw as Record<string, unknown>;
    const withFactSource = enforceStatementSource(
      { text: item.text, classification: "FACT_DOCUMENTED", quote: item.quote },
      corpus,
      docs,
    );
    if (withFactSource && withFactSource.classification === "FACT_DOCUMENTED") {
      confirmedErrors.push(withFactSource);
      continue;
    }
    const withLawSource = item.citation_text ? enforceLawSource(item, citationReviews) : null;
    if (withLawSource && withLawSource.classification === "LAW_VERIFIED") {
      confirmedErrors.push({ ...withLawSource, classification: "FACT_DOCUMENTED" });
      continue;
    }
    // Neither a verified document quote nor a verified citation — cannot be
    // CONFIRMED. Demote to potential_issues, not silently dropped.
    const text = scrubCertainty(item.text);
    if (text)
      potentialIssues.push({
        text,
        classification: "POSSIBILITY",
        source: null,
        note: SOURCE_NOT_LOCATED,
      });
  }
  const noMaterialErrorIdentified = confirmedErrors.length === 0;

  const recordConflictsRaw = Array.isArray(parsed.record_conflicts) ? parsed.record_conflicts : [];
  const recordConflicts = recordConflictsRaw
    .map((c: Record<string, unknown>) => ({
      description: scrubCertainty(c.description),
      source_a: resolveSource(typeof c.quote_a === "string" ? c.quote_a : null, corpus, docs),
      source_b: resolveSource(typeof c.quote_b === "string" ? c.quote_b : null, corpus, docs),
    }))
    .filter((c: { description: string }) => c.description);

  const missingInformation = (
    Array.isArray(parsed.missing_information) ? parsed.missing_information : []
  )
    .map((s: unknown) => scrubCertainty(s))
    .filter(Boolean);

  // ---- Outcome probability — INSUFFICIENT_DATA is a first-class result ---
  const clampPct = (v: unknown): number => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const basis = scrubCertainty(parsed.basis);
  // Never invent a percentage: the model must both say ESTIMATED AND give a
  // non-empty basis. Missing either forces INSUFFICIENT_DATA regardless of
  // what favorable_pct/unfavorable_pct the model returned.
  const modelWantsEstimate = parsed.outcome_status === "ESTIMATED" && basis.length > 0;
  const outcomeStatus: "ESTIMATED" | "INSUFFICIENT_DATA" = modelWantsEstimate
    ? "ESTIMATED"
    : "INSUFFICIENT_DATA";

  let favorable: number | null = null;
  let unfavorable: number | null = null;
  let confidence: "LOW" | "MODERATE" | "HIGH" | null = null;
  if (outcomeStatus === "ESTIMATED") {
    favorable = clampPct(parsed.favorable_pct);
    unfavorable = clampPct(parsed.unfavorable_pct);
    if (favorable + unfavorable !== 100) unfavorable = 100 - favorable;
    confidence =
      parsed.confidence === "LOW" ||
      parsed.confidence === "MODERATE" ||
      parsed.confidence === "HIGH"
        ? parsed.confidence
        : "LOW";
  }

  const overallPosition: "FAVORABLE" | "UNFAVORABLE" | "MIXED" =
    parsed.overall_position === "FAVORABLE" ||
    parsed.overall_position === "UNFAVORABLE" ||
    parsed.overall_position === "MIXED"
      ? parsed.overall_position
      : favorable != null
        ? favorable > 60
          ? "FAVORABLE"
          : favorable < 40
            ? "UNFAVORABLE"
            : "MIXED"
        : "MIXED";

  const findingIds = new Set(findings.map((f) => f.id));
  const findingTypeById = new Map(findings.map((f) => [f.id, f.finding_type]));
  const findingReviewsRaw = Array.isArray(parsed.finding_reviews) ? parsed.finding_reviews : [];
  const findingReviews = findingReviewsRaw
    .filter((fr: unknown): fr is { finding_id: string; status: string; note?: string } => {
      const x = fr as { finding_id?: unknown; status?: unknown };
      return (
        typeof x.finding_id === "string" &&
        findingIds.has(x.finding_id) &&
        FINDING_REVIEW_STATUSES.includes(x.status as FindingReviewStatus)
      );
    })
    .map((fr: { finding_id: string; status: string; note?: string }) => {
      // A finding can only be confirmed VERIFIED here if the underlying
      // finding itself already carries DIRECT_EVIDENCE — a citation-floor
      // guarantee case_findings already enforces at write time. Anything
      // else claiming VERIFIED is downgraded rather than trusted twice-removed.
      const status: FindingReviewStatus =
        fr.status === "VERIFIED" && findingTypeById.get(fr.finding_id) !== "DIRECT_EVIDENCE"
          ? "UNVERIFIED"
          : (fr.status as FindingReviewStatus);
      return { finding_id: fr.finding_id, status, note: scrubCertainty(fr.note ?? "") };
    });

  // All the source-gated classified content lives under both_sides (a jsonb
  // column — see the migration's comment on why this is deliberately
  // variable-shape rather than one column per bucket).
  const bothSides = {
    verified_facts: verifiedFacts,
    verified_law: verifiedLaw,
    court_findings: courtFindings,
    confirmed_errors: confirmedErrors,
    potential_issues: potentialIssues,
    unverified_claims: unverifiedClaims,
    record_conflicts: recordConflicts,
    defense_opportunities: defenseOpportunities,
    prosecution_counterarguments: prosecutionCounterarguments,
    basis: outcomeStatus === "ESTIMATED" ? basis : "OUTCOME PROBABILITY: INSUFFICIENT DATA",
  };

  const insertRow = {
    case_id: caseId,
    user_id: userId,
    case_analysis_mode: mode,
    overall_position: overallPosition,
    outcome_status: outcomeStatus,
    favorable_pct: favorable ?? 0,
    unfavorable_pct: unfavorable ?? 0,
    confidence: confidence ?? "LOW",
    no_material_error_identified: noMaterialErrorIdentified,
    principal_strength: scrubCertainty(parsed.principal_strength) || NOT_ESTABLISHED,
    principal_weakness: scrubCertainty(parsed.principal_weakness) || NOT_ESTABLISHED,
    biggest_risk: scrubCertainty(parsed.biggest_risk) || NOT_ESTABLISHED,
    most_important_missing_evidence:
      scrubCertainty(parsed.most_important_missing_evidence) || NOT_ESTABLISHED,
    both_sides: bothSides,
    factors: parsed.factors ?? {},
    what_could_change: { missing_information: missingInformation },
    finding_reviews: findingReviews,
    citation_reviews: citationReviews.map((c) => ({
      citation_text: c.citation_text,
      ...c.verification,
    })),
    raw_model_output: parsed,
  };

  const { data: inserted, error } = await db
    .from("case_outcome_assessments")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(insertRow as any)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[completed-case-audit] insert failed", error);
    return null; // non-fatal — same principle as the release-review wrapper that calls this
  }

  return {
    id: (inserted as { id: string }).id,
    overall_position: overallPosition,
    outcome_status: outcomeStatus,
    favorable_pct: favorable,
    unfavorable_pct: unfavorable,
    confidence,
    no_material_error_identified: noMaterialErrorIdentified,
  };
}
