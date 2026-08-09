// Case Analysis Mode — orchestration layer, not a new pipeline.
//
// Every case carries an ORTHOGONAL axis on top of materia (case_type) and
// evidence-strictness (analysis_mode): what OBJECTIVE the existing engines
// are pursuing. "ongoing" (the default, byte-for-byte the prior behavior of
// every existing case) asks the standard case-preparation questions. The
// three "completed case" variants re-point the SAME engines, the SAME
// evidence gate, and the SAME citation floor at a retrospective forensic
// audit instead — see getCaseAnalysisObjective() below, injected into
// analyzerPreamble/areaPreamble in pipeline.server.ts. No engine is
// duplicated, no new pipeline is built; this module only changes what the
// existing prompts are told to look for and how aggressively vs.
// conservatively to report it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export const CASE_ANALYSIS_MODES = ["ongoing", "concluded_audit", "judgment_audit", "appeal_routes"] as const;
export type CaseAnalysisMode = (typeof CASE_ANALYSIS_MODES)[number];

export interface CaseAnalysisModeOption {
  value: CaseAnalysisMode;
  label_es: string;
  label_en: string;
  description_es: string;
  description_en: string;
}

export const CASE_ANALYSIS_MODE_OPTIONS: CaseAnalysisModeOption[] = [
  {
    value: "ongoing",
    label_es: "Caso en Curso",
    label_en: "Ongoing Case",
    description_es: "Preparación del caso, estrategia actual, fortalezas, debilidades y próximos pasos procesales.",
    description_en: "Case preparation, current strategy, strengths, weaknesses, and upcoming procedural steps.",
  },
  {
    value: "concluded_audit",
    label_es: "Caso Concluido — Auditoría Jurídica",
    label_en: "Concluded Case — Legal Audit",
    description_es:
      "Auditoría forense retrospectiva del caso concluido: errores, omisiones, contradicciones y posibles vías de salida.",
    description_en:
      "Retrospective forensic audit of the concluded case: errors, omissions, contradictions, and possible ways out.",
  },
  {
    value: "judgment_audit",
    label_es: "Auditoría de Sentencia / Resolución",
    label_en: "Judgment / Resolution Audit",
    description_es:
      "Enfoque específico en el razonamiento, la valoración de pruebas, la congruencia y la exhaustividad de la resolución final.",
    description_en:
      "Focused specifically on the final decision's reasoning, evidence evaluation, congruence, and exhaustiveness.",
  },
  {
    value: "appeal_routes",
    label_es: "Búsqueda de Vías de Impugnación",
    label_en: "Search for Routes to Challenge",
    description_es:
      "Enfoque específico en identificar bases legalmente sustentables para impugnar la resolución concluida.",
    description_en: "Focused specifically on identifying legally supportable grounds to challenge the concluded decision.",
  },
];

export function isCompletedCaseMode(mode: CaseAnalysisMode): boolean {
  return mode !== "ongoing";
}

/** Strict normalization — an unrecognized value is treated as "ongoing", the
 *  same default every existing case already has (this column is additive,
 *  NOT NULL DEFAULT 'ongoing' — see the migration). Never invents a
 *  completed-case posture from a bad/legacy value. */
export function normalizeCaseAnalysisMode(v: unknown): CaseAnalysisMode {
  return (CASE_ANALYSIS_MODES as readonly string[]).includes(String(v)) ? (v as CaseAnalysisMode) : "ongoing";
}

export async function getCaseAnalysisMode(db: Db, caseId: string): Promise<CaseAnalysisMode> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("cases")
    .select("case_analysis_mode")
    .eq("id", caseId)
    .maybeSingle();
  return normalizeCaseAnalysisMode((data as { case_analysis_mode?: unknown } | null)?.case_analysis_mode);
}

const NEVER_CONFUSE_ES = `NUNCA CONFUNDIR (regla obligatoria):
- Regla jurídica ≠ violación. Que la ley mexicana proteja un derecho no significa que ese derecho haya sido violado en este caso.
- Que un tribunal DISCUTA un concepto jurídico ≠ que ese concepto haya ocurrido como hecho en el caso.
- Ausencia de evidencia en el corpus ≠ evidencia de ausencia. Si el expediente no lo establece: "NO DETERMINABLE CON EL CORPUS DISPONIBLE", nunca "no ocurrió".
- Posible error ≠ error confirmado. Usa "POTENTIAL_ISSUE" hasta que el expediente lo establezca.
- Argumento de una parte ≠ hecho establecido. Identifica los argumentos como argumentos.
- Alegación ≠ hecho. Hallazgo ≠ conclusión. Posibilidad legal ≠ remedio disponible.
- "No se identificó en el corpus" (p. ej. interés jurídico, legitimación) NUNCA prueba que el elemento falte o que el asunto sea improcedente — solo que la búsqueda en los documentos disponibles no lo localizó. Clasifícalo como INSUFFICIENT_DATA / NOT_FOUND, nunca como un defecto procesal confirmado, salvo que el expediente mismo declare expresamente el defecto (p. ej. una resolución que sobresee por falta de interés jurídico).
- Regla jurídica verificada ≠ hecho del caso verificado. Que un artículo/regla esté correctamente citado no dice nada sobre si ese artículo aplica a los hechos de ESTE caso — nunca combines ambas conclusiones bajo una sola etiqueta.`;

const NEVER_CONFUSE_EN = `NEVER CONFUSE (mandatory rule):
- Legal rule ≠ violation. Mexican law protecting a right does not mean that right was violated in this case.
- A court DISCUSSING a legal concept ≠ that concept occurring as a fact in the case.
- Absence of evidence in the corpus ≠ evidence of absence. If the record does not establish it: "NOT DETERMINABLE WITH THE AVAILABLE CORPUS", never "did not occur".
- Potential error ≠ confirmed error. Use "POTENTIAL_ISSUE" until the record establishes it.
- A party's argument ≠ an established fact. Identify arguments as arguments.
- Allegation ≠ fact. Finding ≠ conclusion. Legal possibility ≠ available remedy.
- "Not identified in the corpus" (e.g. standing/interés jurídico) NEVER proves the element is missing or that the case is inadmissible — only that the search over the available documents did not locate it. Classify as INSUFFICIENT_DATA / NOT_FOUND, never a confirmed procedural defect, unless the record itself expressly states the defect (e.g. a ruling dismissing for lack of standing).
- A verified legal rule ≠ a verified case fact. A correctly-cited article says nothing about whether it applies to THIS case's facts — never combine both conclusions under a single label.`;

const CLASSIFICATION_TAXONOMY_ES = `CLASIFICACIÓN OBLIGATORIA de cada hallazgo — usa "audit_classification" con EXACTAMENTE uno de estos valores, nunca los mezcles:
- VERIFIED_FACT: el expediente lo establece directamente.
- VERIFIED_COURT_HOLDING: la resolución lo declara expresamente.
- VERIFIED_LEGAL_RULE: la autoridad legal aplicable lo establece.
- SUPPORTED_INFERENCE: la evidencia lo respalda fuertemente pero no está declarado explícitamente.
- POTENTIAL_ISSUE: existe una cuestión jurídicamente plausible que requiere verificación por el abogado.
- EVIDENCE_GAP: falta la información necesaria para establecer la cuestión.
- NOT_FOUND: se buscó específicamente el problema y no se encontró base que lo sustente.`;

const CLASSIFICATION_TAXONOMY_EN = `MANDATORY CLASSIFICATION of every finding — use "audit_classification" with EXACTLY one of these values, never mix them:
- VERIFIED_FACT: the record directly establishes it.
- VERIFIED_COURT_HOLDING: the decision expressly states it.
- VERIFIED_LEGAL_RULE: the applicable legal authority establishes it.
- SUPPORTED_INFERENCE: the evidence strongly supports the inference, but it is not explicitly stated.
- POTENTIAL_ISSUE: a legally plausible issue exists but requires attorney verification.
- EVIDENCE_GAP: the information necessary to establish the issue is missing.
- NOT_FOUND: Nyrava searched for the issue and found no supporting evidence.`;

/**
 * The objective block injected into analyzerPreamble/areaPreamble.
 * `null` for "ongoing" so every existing case's prompt is byte-for-byte
 * unchanged — this is additive only for the three completed-case modes.
 */
export function getCaseAnalysisObjective(mode: CaseAnalysisMode, locale: "es" | "en"): string | null {
  if (mode === "ongoing") return null;
  const es = locale !== "en";

  const modeFocus: Record<Exclude<CaseAnalysisMode, "ongoing">, { es: string; en: string }> = {
    concluded_audit: {
      es: "Este es un CASO CONCLUIDO. Tu objetivo cambia por completo: ya no es preparar el caso hacia adelante, sino determinar si el expediente concluido contiene errores, omisiones, contradicciones o cuestiones jurídicamente sustentables que puedan constituir una vía legítima para impugnar o mejorar el resultado. Examina el audit procesal, el audit de evidencia, el audit de la resolución, contradicciones entre etapas, y argumentos que parecen no haberse planteado.",
      en: "This is a CONCLUDED CASE. Your objective changes entirely: no longer preparing the case going forward, but determining whether the concluded record contains legally supportable errors, omissions, contradictions, or issues that could form a legitimate basis to challenge or improve the outcome. Examine the procedural audit, the evidence audit, the judgment audit, contradictions between stages, and arguments that appear not to have been raised.",
    },
    judgment_audit: {
      es: "Este es un AUDIT ESPECÍFICO DE LA SENTENCIA/RESOLUCIÓN FINAL. Enfócate exclusivamente en: el razonamiento de la resolución, sus determinaciones de hecho, su valoración de la evidencia, su interpretación legal, el precedente que invoca, su cumplimiento procesal, su congruencia (¿resolvió todo lo planteado?), su exhaustividad, cuestiones constitucionales, y contradicciones internas (la resolución afirma X en una sección y Y en otra).",
      en: "This is a FOCUSED AUDIT OF THE FINAL JUDGMENT/RESOLUTION. Focus exclusively on: the decision's reasoning, its findings of fact, its evidence evaluation, its legal interpretation, the precedent it invokes, its procedural compliance, its congruence (did it resolve everything raised?), its exhaustiveness, constitutional issues, and internal contradictions (the decision states X in one section and Y in another).",
    },
    appeal_routes: {
      es: "Este es un AUDIT ENFOCADO EN VÍAS DE IMPUGNACIÓN. Tu objetivo es identificar bases legalmente sustentables para impugnar la resolución concluida, según la materia real del caso y las reglas procesales aplicables. NO recomiendes automáticamente un amparo, recurso o apelación — primero determina si el expediente realmente sustenta esa vía potencial, usando ÚNICAMENTE los tipos de recurso/vía aplicables a esta materia (ver MARCO NORMATIVO/ALLOWED MOTION TYPES arriba).",
      en: "This is an AUDIT FOCUSED ON ROUTES TO CHALLENGE THE DECISION. Your objective is to identify legally supportable grounds for challenging the concluded decision, according to the case's actual matter type and applicable procedural rules. Do NOT automatically recommend an amparo, recurso, or appeal — first establish whether the record actually supports that potential route, using ONLY the motion/remedy types applicable to this materia (see GOVERNING FRAMEWORK/ALLOWED MOTION TYPES above).",
    },
  };

  const focus = modeFocus[mode];

  return [
    `=== CASE ANALYSIS MODE: ${mode.toUpperCase()} ===`,
    es ? focus.es : focus.en,
    es
      ? "PRINCIPIO RECTOR: investigación agresiva, conclusiones conservadoras. Busca profundamente, cruza referencias entre todas las etapas del expediente, cuestiona el razonamiento, busca contradicciones, argumentos omitidos, evidencia ignorada, errores procesales y jurisprudencia aplicable — pero sé extremadamente conservador sobre lo que AFIRMAS haber encontrado."
      : "GUIDING PRINCIPLE: aggressive investigation, conservative conclusions. Search deeply, cross-reference every stage of the record, challenge the reasoning, look for contradictions, missed arguments, ignored evidence, procedural errors, and applicable jurisprudence — but be extremely conservative about what you CLAIM to have found.",
    es ? CLASSIFICATION_TAXONOMY_ES : CLASSIFICATION_TAXONOMY_EN,
    es ? NEVER_CONFUSE_ES : NEVER_CONFUSE_EN,
    es
      ? 'Para cada posible error PROCESAL, establece la cadena: Regla → Acción requerida → Evento real del caso → Evidencia → Posible error. Si el evento real no puede establecerse con el corpus: "NO DETERMINABLE CON EL CORPUS DISPONIBLE" — nunca inventes el evento.'
      : "For every potential PROCEDURAL error, establish the chain: Rule → Required action → Actual case event → Evidence → Potential error. If the actual event cannot be established from the corpus: \"NOT DETERMINABLE WITH THE AVAILABLE CORPUS\" — never invent the event.",
    es
      ? 'Nunca digas "el juez ignoró la evidencia" salvo que el expediente demuestre que la evidencia fue presentada Y que la decisión no la abordó. En su lugar: "El expediente disponible contiene la evidencia X en la página Y. La decisión no parece abordar X."'
      : 'Never say "the judge ignored evidence" unless the record demonstrates the evidence was presented AND the decision failed to address it. Instead: "The available record contains evidence X on page Y. The decision does not appear to address X."',
    es
      ? "No prometas que el caso puede ganarse ni que un hallazgo revertirá la resolución. El abogado toma la determinación jurídica final."
      : "Do not promise the case can be won or that a finding will overturn the decision. The attorney makes the final legal determination.",
  ].join("\n");
}

/**
 * PROCEDURAL TYPE LOCK — the hard constraint requested after a real stress
 * test on Amparo Directo en Revisión 3684/2012: the source-confirmed
 * proceeding type/caption (resolveVerifiedProceedingType() in
 * case-classification.server.ts, e.g. "AMPARO DIRECTO EN REVISIÓN") must
 * control every downstream procedural question — applicable remedies,
 * deadlines, suspension analysis, pleadings, document requests, and "ways
 * out" — not the broader materia alone ("amparo"). Before this, engines and
 * Talk to Case reasoned as if any amparo-family proceeding were
 * interchangeable, recommending first-instance mechanisms (incidente de
 * suspensión, ampliación de demanda de amparo, auto de vinculación a
 * proceso) on a case that is actually a SCJN/Colegiado REVISIÓN of an
 * already-decided amparo directo — a different procedural posture with
 * different available instruments. Injected into analyzerPreamble/
 * areaPreamble (pipeline.server.ts) and Talk to Case's system prompt
 * (chat.server.ts) whenever a CONFIRMED proceeding type exists; a no-op
 * (returns null) otherwise, so cases without a source-confirmed caption are
 * completely unaffected.
 */
export function getProceduralTypeLock(
  proceedingType: string | null,
  locale: "es" | "en",
): string | null {
  if (!proceedingType) return null;
  const es = locale !== "en";
  return es
    ? `=== TIPO PROCESAL CONFIRMADO POR FUENTE (RESTRICCIÓN OBLIGATORIA) ===\n` +
        `Los documentos del expediente confirman que este asunto es exactamente: "${proceedingType}".\n` +
        `Esta es una restricción sobre TODO el razonamiento jurídico, no solo sobre el tipo de caso: los remedios disponibles, los plazos, el análisis de suspensión, los escritos/promociones aplicables y las posibles "vías de salida" deben corresponder específicamente a esta etapa procesal.\n` +
        `NO analices, recomiendes ni solicites documentos que correspondan a una etapa procesal, tipo de asunto o vía DISTINTA (p. ej.: un nuevo juicio de amparo, una carpeta de investigación, un auto de vinculación a proceso, un auto de apertura a juicio, un incidente de suspensión de primera instancia) A MENOS QUE el corpus establezca explícitamente que ese procedimiento distinto está contemplado en este expediente.\n` +
        `Antes de solicitar cualquier documento, pregúntate: ¿es este documento legalmente relevante para "${proceedingType}" específicamente y para la pregunta concreta planteada? Nunca solicites un documento solo porque aparecería en una lista genérica de expedientes de amparo o penales.\n` +
        `Cualquier remedio, recurso, plazo o mecanismo procesal propuesto debe ser aplicable a "${proceedingType}" específicamente. Si no puedes verificar que aplica a esta etapa procesal concreta, clasifícalo como POTENTIAL_ISSUE o EVIDENCE_GAP con una nota explícita — nunca lo presentes como una vía disponible o como un paso siguiente recomendado.`
    : `=== SOURCE-CONFIRMED PROCEDURAL TYPE (MANDATORY CONSTRAINT) ===\n` +
        `The case documents confirm this matter is exactly: "${proceedingType}".\n` +
        `This constrains ALL legal reasoning, not just the case-type label: available remedies, deadlines, suspension analysis, applicable pleadings, and possible "ways out" must correspond specifically to this procedural stage.\n` +
        `Do NOT analyze, recommend, or request documents belonging to a DIFFERENT procedural stage, matter type, or proceeding (e.g. a new amparo filing, a carpeta de investigación, an auto de vinculación a proceso, an auto de apertura a juicio, a first-instance incidente de suspensión) UNLESS the corpus explicitly establishes that a distinct proceeding is contemplated in this record.\n` +
        `Before requesting any document, ask: is this document legally relevant to "${proceedingType}" specifically and to the concrete question asked? Never request a document merely because it would appear on a generic amparo/criminal checklist.\n` +
        `Any proposed remedy, motion, deadline, or procedural mechanism must be applicable to "${proceedingType}" specifically. If you cannot verify it applies to this specific procedural stage, classify it as POTENTIAL_ISSUE or EVIDENCE_GAP with an explicit note — never present it as an available route or recommended next step.`;
}
