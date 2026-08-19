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
const FULL_CORPUS_SCAN_LIMIT = 5_000_000;

export type ProceduralComplianceReport = ComplianceReport & {
  stage_map: ProceduralStageResolution;
  missing_documents: MissingDocumentsReport;
  deadlines: MxDeadline[];
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasScjnAmparoReviewDecision(corpusText: string): boolean {
  const text = fold(corpusText);
  const hasCourt =
    /suprema corte de justicia de la nacion|primera sala|segunda sala|tribunal pleno/.test(text);
  const hasReview =
    /amparo directo en revision|recurso de revision en amparo|amparo en revision/.test(text);
  const hasDecisionLanguage =
    /resuelve|resolucion|sentencia|ejecutoria|considerando|puntos resolutivos|se confirma|se revoca|se desecha|se niega|se concede/.test(text);
  return hasCourt && hasReview && hasDecisionLanguage;
}

function directSignalExcerpt(corpusText: string, rx: RegExp): string | null {
  rx.lastIndex = 0;
  const match = rx.exec(corpusText);
  if (!match) return null;
  const start = Math.max(0, match.index - 90);
  const end = Math.min(corpusText.length, match.index + match[0].length + 130);
  return corpusText.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * The generic constitutional checklist is intentionally conservative, but a
 * final ADR often states procedural facts in ordinary judicial language that
 * the original keyword list did not include. Those direct statements must be
 * shared by the procedural layer instead of letting one engine say standing
 * is absent while another has a verbatim SCJN finding that standing exists.
 * This helper promotes ONLY literal corpus signals; it makes no inference.
 */
function supplementAmparoReviewDirectSignals(
  report: ComplianceReport,
  corpusText: string,
): ComplianceReport {
  const standingRx =
    /(?:parte\s+(?:quejosa|recurrente)|recurrente)[^.!?\n]{0,180}(?:tiene|cuenta\s+con)\s+legitimaci[oó]n|legitimaci[oó]n\s+para\s+interponer\s+el\s+recurso\s+de\s+revisi[oó]n/iu;
  const challengedRx =
    /(?:sentencia|resoluci[oó]n)\s+(?:reclamada|recurrida|combatida)|fallo\s+del\s+tribunal\s+colegiado|resoluci[oó]n\s+del\s+tribunal\s+colegiado/iu;

  const standingEvidence = directSignalExcerpt(corpusText, standingRx);
  const challengedEvidence = directSignalExcerpt(corpusText, challengedRx);

  const items = report.items.map((item) => {
    if (item.id === "legitimacion_constitucional" && item.status !== "cumplido" && standingEvidence) {
      return { ...item, status: "cumplido" as const, evidence: standingEvidence };
    }
    if (item.id === "norma_o_acto_impugnado" && item.status !== "cumplido" && challengedEvidence) {
      return { ...item, status: "cumplido" as const, evidence: challengedEvidence };
    }
    return item;
  });

  return { ...report, items };
}

function normalizeAmparoReviewCompliance(
  rawReport: ComplianceReport,
  corpusText: string,
): ComplianceReport {
  const supplemented = supplementAmparoReviewDirectSignals(rawReport, corpusText);
  const items = supplemented.items.filter((item) => item.id !== "suspension_constitucional");
  const required = items.filter((item) => item.requirement === "required");
  const satisfied = items.filter((item) => item.status === "cumplido").length;
  const missingRequired = required.filter((item) => item.status !== "cumplido");
  const score = items.length === 0 ? 0 : Math.round((satisfied / items.length) * 100);
  const summary =
    missingRequired.length === 0
      ? `Los elementos procesales evaluados para el recurso de revisión en amparo se encuentran documentados en el corpus (${satisfied}/${items.length}).`
      : `Cobertura documental del fallo cargado: ${satisfied}/${items.length} elemento(s) del checklist aparecen expresamente en el corpus. No se identificaron referencias suficientes para confirmar ${missingRequired.length} elemento(s): ${missingRequired
          .map((item) => `${item.label_es} (${item.authority})`)
          .join("; ")}. En una ejecutoria concluida de la SCJN este porcentaje mide únicamente qué tanto del trámite previo está reproducido en el documento cargado; NO es una calificación de validez procesal ni demuestra que esos actos hayan faltado en el expediente oficial.`;
  return {
    ...supplemented,
    materia: "amparo",
    items,
    evaluated: items.length,
    satisfied,
    missing_required: missingRequired.length,
    score,
    summary,
  };
}

function normalizeAmparoReviewStageMap(
  stageMap: ProceduralStageResolution,
  corpusText: string,
  concludedAudit: boolean,
): ProceduralStageResolution {
  const decisionDetected = hasScjnAmparoReviewDecision(corpusText);
  const normalizeStage = <T extends { id: string; authority: string; label_es?: string; label_en?: string; patterns?: readonly string[]; detected?: boolean; evidence?: string | null }>(item: T): T => {
    if (item.id === "sentencia_constitucional") {
      return {
        ...item,
        authority: "Ley de Amparo Art. 93",
        label_es: "Resolución de la SCJN sobre el recurso de revisión",
        label_en: "SCJN resolution of the amparo review",
        ...(decisionDetected
          ? {
              detected: true,
              evidence: "El corpus contiene una resolución de la SCJN identificada como revisión en amparo.",
            }
          : {}),
      };
    }
    if (item.id === "presentacion_demanda_constitucional") {
      return {
        ...item,
        id: "interposicion_recurso_revision",
        authority: "Ley de Amparo Arts. 86 y 88",
        label_es: "Interposición del recurso de revisión",
        label_en: "Filing of the review appeal",
        patterns: ["recurso de revision", "interpone recurso", "escrito de agravios"],
      };
    }
    if (item.id === "norma_o_acto_impugnado") {
      return {
        ...item,
        label_es: "Resolución recurrida o cuestión constitucional identificada",
        label_en: "Challenged judgment or constitutional question identified",
      };
    }
    return item;
  };

  const stages = stageMap.stages.map(normalizeStage);
  const decisionStage = stages.find((item) => item.id === "sentencia_constitucional") ?? null;
  const normalizedCompleted = stageMap.completed.map(normalizeStage);
  const completed =
    decisionDetected && decisionStage && !normalizedCompleted.some((item) => item.id === decisionStage.id)
      ? [...normalizedCompleted, decisionStage]
      : normalizedCompleted;
  const current = decisionDetected && decisionStage ? decisionStage : stageMap.current ? normalizeStage(stageMap.current) : null;
  const next = decisionDetected ? null : stageMap.next ? normalizeStage(stageMap.next) : null;

  const missing_requirements =
    decisionDetected && concludedAudit ? [] : stageMap.missing_requirements.map(normalizeStage);
  const procedural_risks =
    decisionDetected && concludedAudit
      ? []
      : stageMap.procedural_risks
          .map((risk) =>
            risk
              .replace(/Ley Reglamentaria del Art\. 105 Arts\. 41-45 y 72-73/g, "Ley de Amparo Art. 93")
              .replace(/Presentación de la demanda o recurso/g, "Interposición del recurso de revisión")
              .replace(/materia constitucional/gi, "recurso de revisión en amparo"),
          )
          .filter((risk) => !/controversia constitucional|accion de inconstitucionalidad/i.test(risk));

  return {
    ...stageMap,
    materia: "amparo",
    stages,
    current,
    completed,
    next,
    missing_requirements,
    procedural_risks,
  };
}

function normalizeAmparoReviewMissingDocuments(
  report: MissingDocumentsReport,
  corpusText: string,
  concludedAudit: boolean,
): MissingDocumentsReport {
  if (!concludedAudit || !hasScjnAmparoReviewDecision(corpusText)) {
    return { ...report, materia: "amparo" };
  }
  return {
    ...report,
    materia: "amparo",
    missing: [],
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
    .select("case_type,name,description,case_analysis_mode")
    .eq("id", caseId)
    .maybeSingle();
  const caseRowTyped = caseRow as
    | { case_type?: string | null; name?: string | null; description?: string | null; case_analysis_mode?: string | null }
    | null;

  const corpusText = await loadCaseCorpusText(db, caseId, FULL_CORPUS_SCAN_LIMIT);
  const signalText = `${caseRowTyped?.name ?? ""} ${caseRowTyped?.description ?? ""} ${corpusText.slice(0, 3000)}`;

  const executionProfile = effectiveMxProfile(
    caseRowTyped?.case_type ?? null,
    caseRowTyped?.name ?? null,
    `${caseRowTyped?.description ?? ""} ${corpusText.slice(0, 3000)}`,
  );
  const reviewSubtype =
    executionProfile === "constitucional" ? resolveConstitucionalReviewSubtype(signalText) : null;
  const isAmparoReview =
    caseRowTyped?.case_type === "amparo" && reviewSubtype === "amparo_en_revision";
  const concludedAudit = caseRowTyped?.case_analysis_mode === "concluded_audit";
  const reportedMateria = isAmparoReview ? "amparo" : executionProfile;

  const reportBase = evaluateProceduralCompliance(executionProfile, corpusText);
  const stageMapBase = resolveProceduralStage(executionProfile, corpusText);
  const missingDocumentsBase = resolveMissingDocuments(executionProfile, corpusText);
  const events = extractMxEventsFromCorpus(executionProfile, corpusText);
  const deadlines = computeMxDeadlines({ materia: executionProfile, events });

  const report: ComplianceReport = isAmparoReview
    ? normalizeAmparoReviewCompliance(reportBase, corpusText)
    : reportBase;
  const stage_map = isAmparoReview
    ? normalizeAmparoReviewStageMap(stageMapBase, corpusText, concludedAudit)
    : stageMapBase;
  const missing_documents: MissingDocumentsReport = isAmparoReview
    ? normalizeAmparoReviewMissingDocuments(missingDocumentsBase, corpusText, concludedAudit)
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
  const mayWriteMissingAsFinding = !concludedAudit;
  if (missing.length > 0 && mayWriteMissingAsFinding) {
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
