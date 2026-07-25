// Pipeline gate — projects engine output, resolves placeholders, dedupes,
// ranks findings, attaches methodology, polishes prose, runs the terminal QA
// audit, structurally validates, and writes canonical. Never throws for
// content issues; only for infrastructure failures.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { strictValidateCaseAnalysis, type ValidationResult } from "./case-analysis";
import { projectCanonical, writeCanonical } from "./writer.server";
import { normalizeReport } from "@/lib/intelligence/report-normalize";
import { polishAnalysisProse } from "@/lib/intelligence/prose-polish.server";
import { runReportQa, type QaReport } from "./report-qa.server";
import { resolvePlaceholders } from "./placeholder-resolver.server";
import { dedupeAnalysis } from "./dedupe.server";
import { rankFindings } from "./findings-rank.server";
import { attachMethodology } from "./methodology-attach.server";
import { enforceCitationQuality } from "./citation-quality.server";

type Db = SupabaseClient<Database>;

export type GateResult = {
  ok: boolean;
  caseId: string;
  validation: ValidationResult;
  qa: QaReport;
  status: "completed" | "validated" | "failed";
};

const SUPPRESSION_REASON =
  "Additional verified evidence is required before the platform can produce a legally defensible score.";

export async function runCanonicalGate(
  db: Db,
  caseId: string,
  reportMode: "FULL" | "LIMITED" = "FULL",
): Promise<GateResult> {
  const analysis = await projectCanonical(db, caseId, reportMode);

  // Suppression messaging — always attach an explanatory rationale so the
  // renderer never displays a bare "Suppressed" with no reason.
  if (analysis.Scores?.suppressed && !analysis.Scores.rationale?.trim()) {
    analysis.Scores.rationale = SUPPRESSION_REASON;
  }

  // 1. Resolve unresolved tokens before anything else looks at prose.
  resolvePlaceholders(analysis);
  // 2. Enforce citation quality — demote unsupported legal conclusions.
  enforceCitationQuality(analysis);
  // 3. Collapse near-duplicates across and within sections.
  dedupeAnalysis(analysis);
  // 4. Rank findings by litigation importance; move witness-profiles out.
  rankFindings(analysis);
  // 5. Attach methodology references to every computed metric.
  attachMethodology(analysis);
  // 6. Deterministic prose polish.
  polishAnalysisProse(analysis, caseId);
  // 7. Shallow normalize (dedupe blanks, trim strings).
  normalizeReport(analysis as unknown as Record<string, unknown>);

  // 8. Terminal QA self-audit.
  const qa = runReportQa(analysis);

  // 9. Structural validation (17-section lock).
  const validation = strictValidateCaseAnalysis(analysis);

  const status: GateResult["status"] = qa.blocking
    ? "validated"
    : validation.ok
      ? "completed"
      : "validated";

  const persistedIssues: unknown[] = [
    ...validation.issues,
    ...qa.critical.map((c) => ({ ...c, kind: "qa_critical" })),
    ...qa.warnings.map((w) => ({ ...w, kind: "qa_warning" })),
  ];

  await writeCanonical(db, caseId, analysis, persistedIssues, status);
  return { ok: validation.ok && qa.ok, caseId, validation, qa, status };
}

