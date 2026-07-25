// Server side of the `procedural_compliance` stage ("Análisis de Cumplimiento
// Procesal"). Evaluates the materia-specific checklist against the extracted
// corpus, persists the report on cases.procedural_compliance, and records any
// missing MANDATORY procedural act as a real case finding so it surfaces in
// the report and the findings UI like any other risk.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveMxProfile } from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance, type ComplianceReport } from "./procedural-compliance";
import { loadCaseCorpusText } from "./jurisdiction-intel.server";

type Db = SupabaseClient<Database>;

const SOURCE_MODULE = "engine:procedural_compliance";

export async function runProceduralCompliance(args: {
  db: Db;
  caseId: string;
  userId: string;
}): Promise<ComplianceReport & { findings_written: number }> {
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
      finding_type: "procedural_gap",
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
    .update({ procedural_compliance: report as unknown as Record<string, unknown> })
    .eq("id", caseId);
  if (upErr) throw new Error(`No se pudo guardar el cumplimiento procesal: ${upErr.message}`);

  return { ...report, findings_written };
}
