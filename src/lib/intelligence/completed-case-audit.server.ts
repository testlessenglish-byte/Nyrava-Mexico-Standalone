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
// Persists to public.case_outcome_assessments (additive, brand-new table —
// never touches case_findings, cases, or reports). See the migration
// 20260809135402_completed_case_audit.sql for the schema this writes.
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

export type CompletedCaseAuditResult = {
  id: string;
  overall_position: "FAVORABLE" | "UNFAVORABLE" | "MIXED";
  favorable_pct: number;
  unfavorable_pct: number;
  confidence: "LOW" | "MODERATE" | "HIGH";
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

  const { data: findingsRaw } = await db
    .from("case_findings")
    .select(
      "id,title,description,category,severity,confidence,legal_significance,evidence_refs,audit_classification,source_module",
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
      temperature: 0.2,
      json: true,
      systemInstruction: `${mexicoLock(locale)}

${groundingContract(locale)}

You are a senior Mexican litigation attorney performing a FINAL QUALITY-CONTROL AUDIT of a completed case analysis — a "second pair of eyes" review, not a fresh investigation. You are given the EXISTING findings this case's analysis already produced (do not invent new ones), plus REAL, deterministically-verified statutory citation checks (CITATION VERIFICATION RESULTS below — these come from an actual database of Mexican legal sources, not from your own memory; treat them as ground truth, never override a citation's verification status based on what you believe the law says).

YOUR TASK — audit the existing analysis and produce a structured outcome assessment covering:
1. ERRORS in the existing analysis: incorrect statutes/articles, misquoted or outdated provisions, incorrect jurisdiction, incorrect legal classification, unsupported conclusions, misunderstood/omitted evidence, contradictions between facts/evidence/conclusions, missing procedural requirements, incorrect assumptions about Mexican law, or any common-law (U.S.) terminology that does not apply to a Mexican proceeding.
2. LEGAL AUTHORITY RE-CHECK: use ONLY the CITATION VERIFICATION RESULTS provided — never assert a citation is correct/incorrect from your own memory. Distinguish verified law from AI inference explicitly.
3. BOTH SIDES: the strongest arguments, evidence, and weaknesses for each side, and contradictions/gaps that could materially affect the outcome.
4. PROBABILITY-BASED OUTCOME (never a guarantee): favorable_pct + unfavorable_pct must sum to 100 and must be derived from the actual findings/evidence provided, never a generic/round default.
5. WHY: explain the percentage through the specific factors listed in the schema below.
6. WHAT COULD CHANGE THE OUTCOME: evidence that could help or hurt, unresolved legal issues, missing documents/testimony, facts needing verification.
7. Per-finding review status: for EACH finding id given, classify it VERIFIED (the record/law directly supports it) | CORRECTED (materially right but you are correcting an error in it — explain in the note) | UNVERIFIED (plausible but not independently confirmable here) | CONTRADICTED (conflicts with other evidence/findings or with a verified citation) | MISSING_EVIDENCE (the finding depends on evidence that is not actually in the record).
8. LANGUAGE DISCIPLINE: never write "you will win", "guaranteed", or "100% chance" anywhere in any field. Use "estimated favorable outcome", "current assessment based on the evidence currently available", and note this assessment may change if additional evidence or legal authority is discovered.

Output STRICT JSON only, in ${locale === "en" ? "English" : "Spanish (México)"}.`,
      userContent: `EXISTING FINDINGS (audit these — do not invent new ones):
${JSON.stringify(findingsForPrompt)}

CITATION VERIFICATION RESULTS (ground truth — deterministic, from the real legal-source corpus):
${citationsForPrompt.length > 0 ? JSON.stringify(citationsForPrompt) : "No statutory article citations with a resolvable statute name were found in the existing findings' text."}

CASE SCORE SUMMARY (already computed, for context only):
${JSON.stringify(scoreRow ?? {})}

EXECUTIVE SUMMARY (already generated, for context only):
${String((reportRow as { executive_summary?: string } | null)?.executive_summary ?? "").slice(0, 3000)}

Return STRICT JSON:
{
  "overall_position": "FAVORABLE"|"UNFAVORABLE"|"MIXED",
  "favorable_pct": number (0-100),
  "unfavorable_pct": number (0-100, must be 100 - favorable_pct),
  "confidence": "LOW"|"MODERATE"|"HIGH",
  "principal_strength": string,
  "principal_weakness": string,
  "biggest_risk": string,
  "most_important_missing_evidence": string,
  "both_sides": {
    "claimant_side": { "arguments": [string], "evidence": [string], "weaknesses": [string] },
    "defendant_side": { "arguments": [string], "evidence": [string], "weaknesses": [string] },
    "contradictions_or_gaps": [string]
  },
  "factors": {
    "legal_foundation": string,
    "evidence_strength": string,
    "procedural_position": string,
    "contradictions": string,
    "opposing_arguments": string,
    "missing_evidence": string,
    "witness_evidence_reliability": string,
    "applicable_mexican_law": string,
    "serious_vulnerabilities": string,
    "potential_dispositive_issues": string
  },
  "what_could_change": {
    "evidence_that_could_improve": [string],
    "evidence_that_could_damage": [string],
    "legal_issues_to_resolve": [string],
    "missing_documents_or_testimony": [string],
    "facts_requiring_verification": [string]
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

  // ---- Deterministic backstop — never trust the model's own arithmetic or
  // language discipline blindly, mirroring the established pattern (e.g.
  // procedural-defect-grounding.server.ts) of a code-level backstop behind
  // every prompt-level instruction. ----------------------------------------
  const clampPct = (v: unknown): number => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const favorable = clampPct(parsed.favorable_pct);
  let unfavorable = clampPct(parsed.unfavorable_pct);
  if (favorable + unfavorable !== 100) {
    // Trust favorable_pct as primary (schema asks for it first); derive the
    // complement rather than the model's (possibly inconsistent) figure.
    unfavorable = 100 - favorable;
  }
  const overallPosition: "FAVORABLE" | "UNFAVORABLE" | "MIXED" =
    parsed.overall_position === "FAVORABLE" ||
    parsed.overall_position === "UNFAVORABLE" ||
    parsed.overall_position === "MIXED"
      ? parsed.overall_position
      : favorable > 60
        ? "FAVORABLE"
        : favorable < 40
          ? "UNFAVORABLE"
          : "MIXED";
  const confidence: "LOW" | "MODERATE" | "HIGH" =
    parsed.confidence === "LOW" || parsed.confidence === "MODERATE" || parsed.confidence === "HIGH"
      ? parsed.confidence
      : "LOW";

  const FORBIDDEN_CERTAINTY =
    /\b(you will win|guaranteed victory|100% chance|ganará(s)? seguro|victoria garantizada)\b/i;
  const scrubCertainty = (s: unknown): string => {
    const str = String(s ?? "");
    return FORBIDDEN_CERTAINTY.test(str)
      ? "[redacted — the model's original wording overclaimed certainty; see biggest_risk/confidence instead]"
      : str;
  };

  const findingIds = new Set(findings.map((f) => f.id));
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
    .map((fr: { finding_id: string; status: string; note?: string }) => ({
      finding_id: fr.finding_id,
      status: fr.status as FindingReviewStatus,
      note: scrubCertainty(fr.note ?? ""),
    }));

  const insertRow = {
    case_id: caseId,
    user_id: userId,
    case_analysis_mode: mode,
    overall_position: overallPosition,
    favorable_pct: favorable,
    unfavorable_pct: unfavorable,
    confidence,
    principal_strength: scrubCertainty(parsed.principal_strength),
    principal_weakness: scrubCertainty(parsed.principal_weakness),
    biggest_risk: scrubCertainty(parsed.biggest_risk),
    most_important_missing_evidence: scrubCertainty(parsed.most_important_missing_evidence),
    both_sides: parsed.both_sides ?? {},
    factors: parsed.factors ?? {},
    what_could_change: parsed.what_could_change ?? {},
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
    favorable_pct: favorable,
    unfavorable_pct: unfavorable,
    confidence,
  };
}
