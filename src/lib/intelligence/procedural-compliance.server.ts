// Server side of the `procedural_compliance` stage ("Análisis de Cumplimiento
// Procesal"). Evaluates the materia-specific checklist against the extracted
// corpus, resolves the procedural stage map and missing-document checklist,
// computes statutory deadlines (plazos, prescripción, caducidad), persists
// the combined report on cases.procedural_compliance, and records any
// missing MANDATORY procedural act as a real case finding so it surfaces in
// the report and the findings UI like any other risk.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveMxProfile } from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance, type ComplianceReport } from "./procedural-compliance";
import { resolveProceduralStage, type ProceduralStageResolution } from "./mx-procedural-stages";
import { resolveMissingDocuments, type MissingDocumentsReport } from "./mx-missing-documents";
import { computeMxDeadlines, extractMxEventsFromCorpus, type MxDeadline } from "./mx-deadlines";
import { loadCaseCorpusText } from "./jurisdiction-intel.server";

type Db = SupabaseClient<Database>;

const SOURCE_MODULE = "engine:procedural_compliance";

export type ProceduralComplianceReport = ComplianceReport & {
  stage_map: ProceduralStageResolution;
  missing_documents: MissingDocumentsReport;
  deadlines: MxDeadline[];
};

export async function runProceduralCompliance(args: {
  db: Db;
  caseId: string;
  userId: string;
}): Promise<ProceduralComplianceReport & { findings_written: number }> {
  const { db, caseId, userId } = args;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any)
    .from("cases")
    .select("case_type")
    .eq("id", caseId)
    .maybeSingle();
  const materia = resolveMxProfile((caseRow as { case_type?: string | null } | null)?.case_type ?? null);

  const corpusText = await loadCaseCorpusText(db, caseId);
  const report = evaluateProceduralCompliance(materia, corpusText);
  const stage_map = resolveProceduralStage(materia, corpusText);
  const missing_documents = resolveMissingDocuments(materia, corpusText);
  const events = extractMxEventsFromCorpus(materia, corpusText);
  const deadlines = computeMxDeadlines({ materia, events });

  const fullReport: ProceduralComplianceReport = { ...report, stage_map, missing_documents, deadlines };

  // Replace the previous run's findings so re-runs are idempotent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from("case_findings").delete().eq("case_id", caseId).eq("source_module", SOURCE_MODULE);

  const missing = report.items.filter((i) => i.requirement === "required" && i.status === "faltante");
  let findings_written = 0;
  if (missing.length > 0) {
    const rows = missing.map((i) => ({
      case_id: caseId,
      user_id: userId,
      title: `Requisito procesal no documentado: ${i.label_es}`,
      description:
        `El expediente no acredita "${i.label_es}", exigido por ${i.authority} en materia ${materia}. ` +
        "Debe subsanarse o justificarse antes de la siguiente etapa procesal.",
      finding_type: "EVIDENCE_BASED_INFERENCE",
      category: "cumplimiento_procesal",
      severity: "high",
      legal_significance: i.authority,
      source_module: SOURCE_MODULE,
      verification_status: "verified",
      confidence: 0.9,
      metadata: { item_id: i.id, materia, authority: i.authority, requirement: i.requirement },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, data } = await (db as any).from("case_findings").insert(rows).select("id");
    if (error) throw new Error(`No se pudieron registrar los hallazgos procesales: ${error.message}`);
    findings_written = (data as unknown[] | null)?.length ?? rows.length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (db as any)
    .from("cases")
    .update({ procedural_compliance: fullReport as unknown as Record<string, unknown> })
    .eq("id", caseId);
  if (upErr) throw new Error(`No se pudo guardar el cumplimiento procesal: ${upErr.message}`);

  return { ...fullReport, findings_written };
}
