// Server side of the `procedural_compliance` stage ("Análisis de Cumplimiento
// Procesal"). Evaluates the materia-specific checklist against the extracted
// corpus, resolves the procedural stage map and missing-document checklist,
// computes statutory deadlines (plazos, prescripción, caducidad), persists
// the combined report on cases.procedural_compliance, and records any
// missing MANDATORY procedural act as a real case finding so it surfaces in
// the report and the findings UI like any other risk.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  effectiveMxProfile,
  resolveConstitucionalReviewSubtype,
} from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance, type ComplianceReport } from "./procedural-compliance";
import { resolveProceduralStage, type ProceduralStageResolution } from "./mx-procedural-stages";
import { resolveMissingDocuments, type MissingDocumentsReport } from "./mx-missing-documents";
import { computeMxDeadlines, extractMxEventsFromCorpus, type MxDeadline } from "./mx-deadlines";
import { loadCaseCorpusText } from "./jurisdiction-intel.server";
import { addGatedFindings } from "./findings.server";

type Db = SupabaseClient<Database>;

const SOURCE_MODULE = "engine:procedural_compliance";

/** Whole-corpus scan budget for deterministic checklist matching (no AI cost). */
const FULL_CORPUS_SCAN_LIMIT = 5_000_000;

export type ProceduralComplianceReport = ComplianceReport & {
  stage_map: ProceduralStageResolution;
  missing_documents: MissingDocumentsReport;
  deadlines: MxDeadline[];
};

function normalizeAmparoReviewStageMap(
  stageMap: ProceduralStageResolution,
): ProceduralStageResolution {
  const fixAuthority = <T extends { id: string; authority: string }>(item: T): T =>
    item.id === "sentencia_constitucional"
      ? { ...item, authority: "Ley de Amparo Art. 93" }
      : item;
  const stages = stageMap.stages.map(fixAuthority);
  const current = stageMap.current ? fixAuthority(stageMap.current) : null;
  const completed = stageMap.completed.map(fixAuthority);
  const next = stageMap.next ? fixAuthority(stageMap.next) : null;
  const missing_requirements = stageMap.missing_requirements.map(fixAuthority);
  return {
    ...stageMap,
    materia: "amparo",
    stages,
    current,
    completed,
    next,
    missing_requirements,
    procedural_risks: stageMap.procedural_risks.map((risk) =>
      risk.replace(
        /Ley Reglamentaria del Art\. 105 Arts\. 41-45 y 72-73/g,
        "Ley de Amparo Art. 93",
      ),
    ),
  };
}

export async function runProceduralCompliance(args: {
  db: Db;
  caseId: string;
  userId: string;
}): Promise<ProceduralComplianceReport & { findings_written: number }> {
  const { db, caseId, userId } = args;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any)
    .from("cases")
    .select("case_type,name,description")
    .eq("id", caseId)
    .maybeSingle();
  const caseRowTyped = caseRow as
    | { case_type?: string | null; name?: string | null; description?: string | null }
    | null;

  const corpusText = await loadCaseCorpusText(db, caseId, FULL_CORPUS_SCAN_LIMIT);
  const signalText = `${caseRowTyped?.name ?? ""} ${caseRowTyped?.description ?? ""} ${corpusText.slice(0, 3000)}`;

  // The SCJN-review checklist is an internal execution profile. It must not
  // relabel an Amparo Directo/Indirecto en Revisión as materia constitucional.
  const executionProfile = effectiveMxProfile(
    caseRowTyped?.case_type ?? null,
    caseRowTyped?.name ?? null,
    `${caseRowTyped?.description ?? ""} ${corpusText.slice(0, 3000)}`,
  );
  const reviewSubtype =
    executionProfile === "constitucional" ? resolveConstitucionalReviewSubtype(signalText) : null;
  const isAmparoReview =
    caseRowTyped?.case_type === "amparo" && reviewSubtype === "amparo_en_revision";
  const reportedMateria = isAmparoReview ? "amparo" : executionProfile;

  const reportBase = evaluateProceduralCompliance(executionProfile, corpusText);
  const stageMapBase = resolveProceduralStage(executionProfile, corpusText);
  const missingDocumentsBase = resolveMissingDocuments(executionProfile, corpusText);
  const events = extractMxEventsFromCorpus(executionProfile, corpusText);
  const deadlines = computeMxDeadlines({ materia: executionProfile, events });

  const report: ComplianceReport = isAmparoReview
    ? { ...reportBase, materia: "amparo" }
    : reportBase;
  const stage_map = isAmparoReview
    ? normalizeAmparoReviewStageMap(stageMapBase)
    : stageMapBase;
  const missing_documents: MissingDocumentsReport = isAmparoReview
    ? { ...missingDocumentsBase, materia: "amparo" }
    : missingDocumentsBase;

  const fullReport: ProceduralComplianceReport = {
    ...report,
    stage_map,
    missing_documents,
    deadlines,
  };

  // Replace the previous run's findings so re-runs are idempotent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .from("case_findings")
    .delete()
    .eq("case_id", caseId)
    .eq("source_module", SOURCE_MODULE);

  const missing = report.items.filter(
    (i) => i.requirement === "required" && i.status === "no_identificado_en_corpus",
  );
  let findings_written = 0;
  if (missing.length > 0) {
    const rows = missing.map((i) => ({
      case_id: caseId,
      user_id: userId,
      title: `Elemento no identificado en el corpus: ${i.label_es}`,
      description:
        `No se identificó una argumentación expresa y desarrollada sobre "${i.label_es}" (${i.authority}, materia ${reportedMateria}) en los documentos proporcionados. ` +
        "Esto refleja lo que consta en el corpus analizado, no necesariamente una omisión en un escrito ya presentado ante el órgano jurisdiccional — verifique contra el expediente oficial antes de asumir un defecto procesal.",
      category: "cumplimiento_procesal",
      severity: "medium" as const,
      legal_significance: i.authority,
      potential_impact: null,
      affected_party: null,
      source_module: SOURCE_MODULE,
      confidence: 0.7,
      metadata: {
        item_id: i.id,
        materia: reportedMateria,
        procedural_profile: executionProfile,
        constitutional_review_subtype: reviewSubtype,
        authority: i.authority,
        requirement: i.requirement,
      },
    }));
    const gate = await addGatedFindings(db, caseId, rows, { exemptCitation: true });
    findings_written = gate.inserted;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (db as any)
    .from("cases")
    .update({ procedural_compliance: fullReport as unknown as Record<string, unknown> })
    .eq("id", caseId);
  if (upErr) throw new Error(`No se pudo guardar el cumplimiento procesal: ${upErr.message}`);

  return { ...fullReport, findings_written };
}
