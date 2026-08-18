// Hallucination review: verifies that every finding's cited quote actually
// appears in the cited source document/page. Pure DB-driven, no LLM cost.
//
// Uses the SAME verifier (`verifyQuote` from grounding.server.ts) that the
// evidence gate applies at write time. Two independent implementations
// silently disagree on what counts as a match — a finding that passed the
// gate could still fail this review purely because the tolerances differed.
// One verifier, one source of truth.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildGroundingCorpus,
  verifyQuote,
  isLegalAuthorityCitation,
  type GroundingCorpus,
} from "./grounding.server";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";
import { isDuplicateTitle } from "./report-recommendations";
import { validateRenderedReport } from "@/lib/canonical/prerender-validate.server";
import { decideRenderedReportRelease } from "@/lib/canonical/rendered-report-release";

type Db = SupabaseClient<Database>;

type Finding = {
  id: string;
  title: string;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  source_doc_ids: string[] | null;
};

type Page = { document_id: string; page: number; text: string };

export type HallucinationReport = {
  ran_at: string;
  total: number;
  verified: number;
  unverified: number;
  no_citation: number;
  /** Citations to public legal authority, exempt from verbatim corpus matching. */
  authority_exempt: number;
  by_module: Record<
    string,
    {
      total: number;
      verified: number;
      unverified: number;
      no_citation: number;
      authority_exempt: number;
    }
  >;
  unverified_examples: Array<{ id: string; title: string; reason: string }>;
  /** Unsupported action recommendations removed from attorney-facing prose. */
  quarantined_actions_removed?: number;
  /** Score-prose fields reconciled to the persisted deterministic score. */
  score_prose_reconciled?: number;
};

const REPORT_PROSE_FIELDS = [
  "executive_summary",
  "attorney_summary",
  "evidence_summary",
  "timeline_summary",
  "contradiction_report",
  "missing_evidence_report",
  "recommendations",
  "investigator_summary",
  "case_overview",
  "facts",
  "witness_analysis",
  "constitutional_issues",
  "discovery_analysis",
  "procedural_issues_report",
  "prosecution_theory_report",
  "defense_theory_report",
  "alternative_theory_report",
  "risk_analysis",
] as const;

const ACTION_TITLE_RX =
  /\b(presentar|preparar|interponer|promover|solicitar|revisar|formular|impugnar|apelar|recurrir|demandar|tramitar|iniciar)\b/i;

const ACTION_STOPWORDS = new Set([
  "para",
  "por",
  "con",
  "que",
  "del",
  "las",
  "los",
  "una",
  "uno",
  "unos",
  "unas",
  "este",
  "esta",
  "estos",
  "estas",
  "debe",
  "deberia",
  "recomienda",
  "recomendar",
  "considerar",
  "considere",
  "adecuadamente",
  "nueva",
  "nuevo",
]);

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function actionTokens(value: string): Set<string> {
  return new Set(
    foldText(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !ACTION_STOPWORDS.has(token))
      .map((token) => (token.length > 6 && token.endsWith("s") ? token.slice(0, -1) : token)),
  );
}

function similarActionText(a: string, b: string): boolean {
  if (isDuplicateTitle(a, b)) return true;
  const aa = actionTokens(a);
  const bb = actionTokens(b);
  if (aa.size < 3 || bb.size < 3) return false;
  const [small, big] = aa.size <= bb.size ? [aa, bb] : [bb, aa];
  let overlap = 0;
  for (const token of small) if (big.has(token)) overlap += 1;
  return overlap >= 3 && overlap / small.size >= 0.55;
}

function scrubQuarantinedActionSentence(text: string, actionTitles: string[]): string {
  if (!text.trim() || actionTitles.length === 0) return text;
  const pieces = text.split(/(?<=[.!?])\s+|\n+/g);
  const kept = pieces.filter((piece) => {
    const foldedPiece = foldText(piece);
    return !actionTitles.some((title) => {
      const foldedTitle = foldText(title);
      if (!foldedTitle) return false;
      return foldedPiece.includes(foldedTitle) || similarActionText(piece, title);
    });
  });
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function reconcileStrengthScoreText(
  text: string,
  rawScore: number | null,
  finalScore: number | null,
): string {
  if (
    !text ||
    rawScore == null ||
    finalScore == null ||
    rawScore === finalScore ||
    !Number.isFinite(rawScore) ||
    !Number.isFinite(finalScore)
  ) {
    return text;
  }
  const raw = String(Math.round(rawScore));
  const final = String(Math.round(finalScore));
  const rx = new RegExp(
    `(fortaleza\\s+del\\s+caso(?:\\s+se\\s+califica\\s+en|\\s*[:=]?\\s*))${raw}\\b`,
    "i",
  );
  return text.replace(rx, `$1${final}`);
}

async function reconcileSavedReportProse(
  db: Db,
  caseId: string,
): Promise<{ quarantinedActionsRemoved: number; scoreProseReconciled: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved } = await (db as any)
    .from("reports")
    .select(
      `full_report,case_strength_score,score_breakdown,quality_blocked,quality_block_reasons,${REPORT_PROSE_FIELDS.join(",")}`,
    )
    .eq("case_id", caseId)
    .maybeSingle();
  if (!saved) return { quarantinedActionsRemoved: 0, scoreProseReconciled: 0 };

  const full =
    saved.full_report && typeof saved.full_report === "object" && !Array.isArray(saved.full_report)
      ? ({ ...(saved.full_report as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  const citationAudit = full?.citation_audit as
    | { quarantined_findings?: Array<{ title?: unknown }> }
    | undefined;
  const actionTitles = (citationAudit?.quarantined_findings ?? [])
    .map((f) => String(f?.title ?? "").trim())
    .filter((title) => title.length > 0 && ACTION_TITLE_RX.test(title));

  const patch: Record<string, unknown> = {};
  let removed = 0;
  for (const field of REPORT_PROSE_FIELDS) {
    const value = saved[field];
    if (typeof value !== "string" || !value.trim() || actionTitles.length === 0) continue;
    const scrubbed = scrubQuarantinedActionSentence(value, actionTitles);
    if (scrubbed !== value.trim()) {
      patch[field] = scrubbed;
      removed += 1;
    }
  }

  const validation =
    full?.validation && typeof full.validation === "object" && !Array.isArray(full.validation)
      ? (full.validation as Record<string, unknown>)
      : null;
  const consistency = validation?.score_consistency as
    | {
        case_strength_score_llm_raw?: unknown;
        case_strength_score?: unknown;
      }
    | undefined;
  const rawScore =
    typeof consistency?.case_strength_score_llm_raw === "number"
      ? consistency.case_strength_score_llm_raw
      : null;
  const finalScore =
    typeof saved.case_strength_score === "number"
      ? saved.case_strength_score
      : typeof consistency?.case_strength_score === "number"
        ? consistency.case_strength_score
        : null;
  let scoreReconciled = 0;
  if (typeof saved.score_breakdown === "string") {
    const fixed = reconcileStrengthScoreText(saved.score_breakdown, rawScore, finalScore);
    if (fixed !== saved.score_breakdown) {
      patch.score_breakdown = fixed;
      scoreReconciled += 1;
    }
  }
  const prose =
    full?.prose && typeof full.prose === "object" && !Array.isArray(full.prose)
      ? { ...(full.prose as Record<string, unknown>) }
      : null;
  if (prose && typeof prose.score_breakdown === "string") {
    const fixed = reconcileStrengthScoreText(prose.score_breakdown, rawScore, finalScore);
    if (fixed !== prose.score_breakdown) {
      prose.score_breakdown = fixed;
      full!.prose = prose;
      patch.full_report = full;
      scoreReconciled += 1;
    }
  }

  if (Object.keys(patch).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("reports").update(patch as any).eq("case_id", caseId);
    if (error) throw new Error(`Failed to reconcile saved report prose: ${error.message}`);
  }

  // Final release must be decided against the report AFTER deterministic
  // reconciliation above. This is intentionally limited to objective
  // integrity failures (wrong materia vocabulary, U.S.-procedure leakage,
  // unresolved template tokens, OCR/quality_blocked state). The uncalibrated
  // report-quality score is not used as a blocker.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any)
    .from("cases")
    .select("case_type")
    .eq("id", caseId)
    .maybeSingle();
  const reconciledReport = { ...saved, ...patch } as Record<string, unknown>;
  const renderedIssues = validateRenderedReport(
    reconciledReport,
    String(caseRow?.case_type ?? ""),
  );
  const renderedDecision = decideRenderedReportRelease(renderedIssues);
  if (saved.quality_blocked || renderedDecision.blocked) {
    const reasons = [
      ...(Array.isArray(saved.quality_block_reasons)
        ? saved.quality_block_reasons.map(String)
        : []),
      ...renderedDecision.reasons,
    ];
    throw new Error(
      `Rendered report integrity blocked release${reasons.length ? `: ${reasons.join("; ")}` : "."}`,
    );
  }

  return {
    quarantinedActionsRemoved: removed,
    scoreProseReconciled: scoreReconciled,
  };
}

export async function runHallucinationReview(args: {
  db: Db;
  caseId: string;
}): Promise<HallucinationReport> {
  const { db, caseId } = args;

  const { data: findingsRaw, error: fErr } = await db
    .from("case_findings")
    .select("id,title,source_module,source_document_id,source_page,source_quote,source_doc_ids")
    .eq("case_id", caseId)
    .not("source_module", "like", PROJECTION_LIKE);
  if (fErr) throw new Error(`Load findings failed: ${fErr.message}`);
  const findings = (findingsRaw ?? []) as Array<Finding & { source_module: string }>;

  const proseReconciliation = await reconcileSavedReportProse(db, caseId);

  const { data: pagesRaw } = await db
    .from("document_pages")
    .select("document_id,page,text")
    .eq("case_id", caseId);
  const pages = (pagesRaw ?? []) as Page[];

  const perDocPages = new Map<string, Page[]>();
  for (const p of pages) {
    const arr = perDocPages.get(p.document_id) ?? [];
    arr.push(p);
    perDocPages.set(p.document_id, arr);
  }
  const perDocCorpus = new Map<string, GroundingCorpus>();
  for (const [docId, pgs] of perDocPages) {
    pgs.sort((a, b) => a.page - b.page);
    const extracted = pgs.map((p) => p.text ?? "").join("\n");
    perDocCorpus.set(
      docId,
      buildGroundingCorpus([{ id: docId, filename: docId, extracted_text: extracted }]),
    );
  }

  const report: HallucinationReport = {
    ran_at: new Date().toISOString(),
    total: findings.length,
    verified: 0,
    unverified: 0,
    no_citation: 0,
    authority_exempt: 0,
    by_module: {},
    unverified_examples: [],
    quarantined_actions_removed: proseReconciliation.quarantinedActionsRemoved,
    score_prose_reconciled: proseReconciliation.scoreProseReconciled,
  };

  const nowIso = new Date().toISOString();
  const updates: Array<{
    id: string;
    status: "verified" | "unverified" | "no_citation" | "authority_exempt";
    notes: string;
  }> = [];
  for (const f of findings) {
    const mod = f.source_module || "unknown";
    if (!report.by_module[mod]) {
      report.by_module[mod] = {
        total: 0,
        verified: 0,
        unverified: 0,
        no_citation: 0,
        authority_exempt: 0,
      };
    }
    report.by_module[mod].total += 1;

    let status: "verified" | "unverified" | "no_citation" | "authority_exempt" =
      "no_citation";
    let notes = "";

    const quote = (f.source_quote ?? "").trim();
    const docId =
      f.source_document_id ??
      ((Array.isArray(f.source_doc_ids) && f.source_doc_ids[0]) || null);

    if (!quote || !docId) {
      status = "no_citation";
      notes =
        !quote && !docId
          ? "No source document or quote."
          : !quote
            ? "No source quote."
            : "No source document.";
    } else {
      const corpus = perDocCorpus.get(docId);
      if (corpus && verifyQuote(quote, corpus)) {
        status = "verified";
        notes =
          f.source_page != null
            ? `Quote verified against document (page ${f.source_page}).`
            : "Quote verified against document.";
      } else if (isLegalAuthorityCitation(quote)) {
        status = "authority_exempt";
        notes =
          "Legal authority reference (constitutional/statutory/tesis) — exempt from verbatim corpus matching.";
      } else if (!corpus) {
        status = "unverified";
        notes = "Cited document has no extracted pages in the corpus.";
      } else {
        status = "unverified";
        notes = "Quote not found in cited source (grounding.verifyQuote).";
      }
    }

    report[status] += 1;
    report.by_module[mod][status] += 1;
    if (status === "unverified" && report.unverified_examples.length < 25) {
      report.unverified_examples.push({ id: f.id, title: f.title, reason: notes });
    }

    updates.push({ id: f.id, status, notes });
  }

  for (let i = 0; i < updates.length; i += 25) {
    const batch = updates.slice(i, i + 25);
    const results = await Promise.all(
      batch.map((u) =>
        db
          .from("case_findings")
          .update({
            verification_status: u.status,
            verification_notes: u.notes,
            verified_at: nowIso,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .eq("id", u.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      throw new Error(`Finding verification update failed: ${failed.error.message}`);
    }
  }

  await db
    .from("cases")
    .update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hallucination_report: report as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hallucination_at: nowIso as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", caseId);

  return report;
}

export {
  scrubQuarantinedActionSentence as __test__scrubQuarantinedActionSentence,
  reconcileStrengthScoreText as __test__reconcileStrengthScoreText,
};
