/**
 * Concluded Case Report Governance Engine
 *
 * Platform-wide authority for concluded judicial matters (procedural_posture = "concluded"
 * or case_analysis_mode = "concluded_audit" / "judgment_audit").
 *
 * Core Rule: A concluded judicial matter produces a Decision-Audit Report,
 * NOT an active-litigation strategy report.
 *
 * Invariant: Disposition outranks severity.
 * Resolutivos, Holdings, and Legal Effects appear before underlying allegations.
 */

export type ReportGovernanceMode = "concluded_decision_audit" | "active_litigation_strategy";
export type RecommendationPolicy = "verification_only" | "suppressed" | "full_strategic";

export interface ConcludedCaseGovernance {
  is_concluded: boolean;
  governance_mode: ReportGovernanceMode;
  strategy_output_allowed: boolean;
  decision_core_priority: boolean;
  recommendation_policy: RecommendationPolicy;
  speaker_role_labels_required: boolean;
  report_section_order: string[];
}

export const CONCLUDED_REPORT_SECTION_ORDER: string[] = [
  "resultado_del_asunto",
  "puntos_resolutivos",
  "cuestion_controlante",
  "determinacion_adoptada",
  "efecto_de_la_resolucion",
  "argumentos_analizados",
  "hallazgos_secundarios",
  "contexto_probatorio_procesal",
];

export const ACTIVE_LITIGATION_SECTION_ORDER: string[] = [
  "executive_summary",
  "attorney_summary",
  "investigator_summary",
  "case_overview",
  "legal_theories",
  "recommended_motions",
  "strategy_recommendations",
  "next_actions",
];

export interface CaseGovernanceInput {
  procedural_posture?: string | null;
  case_analysis_mode?: string | null;
  analysis_mode?: string | null;
  post_judgment_options_analysis?: boolean | null;
  is_final_resolution?: boolean | null;
  resolutivos?: string | null;
  corpusText?: string | null;
}

/**
 * Centrally determines the report governance policy for any matter.
 */
export function detectConcludedCaseGovernance(input: CaseGovernanceInput): ConcludedCaseGovernance {
  const posture = String(input.procedural_posture ?? "").toLowerCase().trim();
  const caseAnalysisMode = String(input.case_analysis_mode ?? "").toLowerCase().trim();
  const analysisMode = String(input.analysis_mode ?? "").toLowerCase().trim();
  const isFinal = Boolean(input.is_final_resolution);
  const allowPostJudgmentStrategy = Boolean(input.post_judgment_options_analysis);

  const isConcluded =
    posture === "concluded" ||
    caseAnalysisMode === "concluded_audit" ||
    caseAnalysisMode === "judgment_audit" ||
    isFinal ||
    (posture === "" && (caseAnalysisMode === "concluded_audit" || caseAnalysisMode === "judgment_audit"));

  if (isConcluded) {
    const strategyAllowed = allowPostJudgmentStrategy;
    return {
      is_concluded: true,
      governance_mode: "concluded_decision_audit",
      strategy_output_allowed: strategyAllowed,
      decision_core_priority: true,
      recommendation_policy: strategyAllowed ? "full_strategic" : "verification_only",
      speaker_role_labels_required: true,
      report_section_order: CONCLUDED_REPORT_SECTION_ORDER,
    };
  }

  return {
    is_concluded: false,
    governance_mode: "active_litigation_strategy",
    strategy_output_allowed: true,
    decision_core_priority: false,
    recommendation_policy: analysisMode === "strict" ? "verification_only" : "full_strategic",
    speaker_role_labels_required: false,
    report_section_order: ACTIVE_LITIGATION_SECTION_ORDER,
  };
}

export type SpeakerRoleBadge =
  | "DETERMINACIÓN ADOPTADA POR EL TRIBUNAL REVISOR"
  | "DETERMINACIÓN ADOPTADA POR SCJN"
  | "DETERMINACIÓN DEL TRIBUNAL INFERIOR"
  | "ARGUMENTO DEL QUEJOSO"
  | "ARGUMENTO DE LA AUTORIDAD RESPONSABLE"
  | "ARGUMENTO DEL TERCERO INTERESADO"
  | "ARGUMENTO / ALEGACIÓN DE PARTE"
  | "AGRAVIO RECHAZADO / INOPERANTE"
  | "CUESTIÓN NO ESTUDIADA"
  | "HECHO PROCESAL"
  | "RESOLUTIVO";

/**
 * Resolves the mandatory visible speaker-role classification badge for a proposition.
 */
export function formatSpeakerRoleBadge(
  finding: Record<string, unknown>,
  courtLevel?: string | null,
): SpeakerRoleBadge {
  const kind = String(
    finding.mandatory_decision_kind ?? finding.kind ?? finding.category ?? "",
  ).toUpperCase();
  const auditClass = String(finding.audit_classification ?? "").toUpperCase();
  const propType = String(finding.proposition_type ?? "").toLowerCase();
  const adoptStatus = String(finding.adoption_status ?? "").toLowerCase();
  const speaker = String(finding.speaker_role ?? "").toLowerCase();
  const title = String(finding.title ?? "");

  // 1. Resolutivo
  if (kind === "DISPOSITION" || /puntos?\s+resolutivos?|se\s+resuelve|resolutivo/i.test(title)) {
    return "RESOLUTIVO";
  }

  // 2. Adopted by reviewing court / SCJN
  if (
    auditClass === "VERIFIED_COURT_HOLDING" ||
    (propType === "holding" && adoptStatus === "adopted") ||
    kind === "COURT_HOLDING"
  ) {
    if (courtLevel === "scjn" || /scjn|primera sala|segunda sala|pleno/i.test(speaker)) {
      return "DETERMINACIÓN ADOPTADA POR SCJN";
    }
    return "DETERMINACIÓN ADOPTADA POR EL TRIBUNAL REVISOR";
  }

  // 3. Rejected or inoperante
  if (adoptStatus === "rejected" || adoptStatus === "unstudied" || kind === "REJECTED_HOLDING" || /inoperante|infundado|desestimado|sin estudio/i.test(title)) {
    if (adoptStatus === "unstudied" || /sin estudio|no estudiada/i.test(title)) {
      return "CUESTIÓN NO ESTUDIADA";
    }
    return "AGRAVIO RECHAZADO / INOPERANTE";
  }

  // 4. Lower court holding
  if (speaker === "lower_court" || speaker === "tribunal_inferior" || speaker === "juez_distrito" || speaker === "tribunal_colegiado_a_quo") {
    return "DETERMINACIÓN DEL TRIBUNAL INFERIOR";
  }

  // 5. Party arguments
  if (speaker === "quejoso" || speaker === "recurrente" || speaker === "apelante") {
    return "ARGUMENTO DEL QUEJOSO";
  }
  if (speaker === "autoridad_responsable") {
    return "ARGUMENTO DE LA AUTORIDAD RESPONSABLE";
  }
  if (speaker === "tercero_interesado") {
    return "ARGUMENTO DEL TERCERO INTERESADO";
  }
  if (propType === "argument" || auditClass === "PARTY_ALLEGATION" || /alega|plantea|sostiene|aduce/i.test(title)) {
    return "ARGUMENTO / ALEGACIÓN DE PARTE";
  }

  // 6. Procedural fact
  if (propType === "fact" || auditClass === "PROCEDURAL_FACT" || kind === "PROCEDURAL_FACT") {
    return "HECHO PROCESAL";
  }

  return "ARGUMENTO / ALEGACIÓN DE PARTE";
}

/**
 * Calculates priority score for finding representation.
 * Invariant: Disposition > Remedy/Effect > Controlling Issue > Holding > Rejected > Allegations > Severity.
 */
export function getFindingConcludedPriority(f: Record<string, unknown>): number {
  const kind = String(f.mandatory_decision_kind ?? f.kind ?? "").toUpperCase();
  const auditClass = String(f.audit_classification ?? "").toUpperCase();
  const propType = String(f.proposition_type ?? "").toLowerCase();
  const adoptStatus = String(f.adoption_status ?? "").toLowerCase();
  const title = String(f.title ?? "");
  const sev = String(f.severity ?? "low").toLowerCase();
  const sevScore = sev === "critical" ? 40 : sev === "high" ? 30 : sev === "medium" ? 20 : 10;

  // Tier 1: Disposition / Resolutivo
  if (kind === "DISPOSITION" || /puntos?\s+resolutivos?|desechado|confirmada|revocada|ampara y protege|niega el amparo/i.test(title)) {
    return 10000 + sevScore;
  }

  // Tier 2: Remedy / Legal Effect
  if (kind === "REMEDY" || /queda firme|efectos del amparo|reposici[oó]n|devu[eé]lvase/i.test(title)) {
    return 9000 + sevScore;
  }

  // Tier 3: Controlling Issue
  if (kind === "CONTROLLING_ISSUE" || propType === "issue" || /cuesti[oó]n\s+(?:constitucional|controlante|jur[ií]dica)/i.test(title)) {
    return 8000 + sevScore;
  }

  // Tier 4: Court Holding
  if (kind === "COURT_HOLDING" || auditClass === "VERIFIED_COURT_HOLDING" || (propType === "holding" && adoptStatus === "adopted")) {
    return 7000 + sevScore;
  }

  // Tier 5: Rejected Arguments / Inoperantes
  if (kind === "REJECTED_HOLDING" || adoptStatus === "rejected" || /inoperante|infundado|desestimado/i.test(title)) {
    return 5000 + sevScore;
  }

  // Tier 6: Party Allegations
  if (propType === "argument" || auditClass === "PARTY_ALLEGATION") {
    return 3000 + sevScore;
  }

  // Tier 7: Procedural Facts
  if (propType === "fact" || auditClass === "PROCEDURAL_FACT") {
    return 2000 + sevScore;
  }

  return 1000 + sevScore;
}

/**
 * Sorts findings for concluded report.
 * Ensures disposition outranks severity.
 */
export function sortFindingsForConcludedReport<T extends Record<string, unknown>>(
  findings: ReadonlyArray<T>,
  governance: ConcludedCaseGovernance,
): T[] {
  if (!governance.is_concluded || !governance.decision_core_priority) {
    const sevRank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 } as Record<string, number>;
    return [...findings].sort((a, b) => (sevRank[String(b.severity)] ?? 0) - (sevRank[String(a.severity)] ?? 0));
  }

  return [...findings].sort((a, b) => {
    const prioA = getFindingConcludedPriority(a);
    const prioB = getFindingConcludedPriority(b);
    return prioB - prioA;
  });
}

const SPECULATIVE_LITIGATION_PHRASES = [
  /\bpodr[ií]a\s+llevar\s+a\s+la\s+revocaci[oó]n\b/gi,
  /\bpodr[ií]a\s+obtener\s+la\s+nulidad\b/gi,
  /\bpreparar\s+amparo\s+indirecto\b/gi,
  /\bfortalecer\s+la\s+posici[oó]n\s+del\s+quejoso\b/gi,
  /\bel\s+quejoso\s+se\s+queda\s+sin\s+v[ií]as\s+de\s+defensa\b/gi,
  /\bpromover\s+incidente\s+de\s+nulidad\b/gi,
];

/**
 * Sanitizes prose text in a concluded audit report, eliminating speculative litigation phrasing.
 */
export function sanitizeConcludedReportProse(
  text: string,
  governance: ConcludedCaseGovernance,
): string {
  if (!governance.is_concluded || governance.strategy_output_allowed) {
    return text;
  }

  let cleaned = text;
  // Specific substitution for overbroad conclusion
  cleaned = cleaned.replace(
    /el\s+quejoso\s+se\s+queda\s+sin\s+v[ií]as\s+de\s+defensa/gi,
    "el recurso de revisión analizado fue desechado y la sentencia recurrida quedó firme en este procedimiento",
  );

  for (const rx of SPECULATIVE_LITIGATION_PHRASES) {
    cleaned = cleaned.replace(rx, "");
  }

  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/**
 * Filters out active-litigation sections and enforces verification-only naming on concluded reports.
 */
export function filterConcludedReportSections(
  fullReport: Record<string, unknown>,
  governance: ConcludedCaseGovernance,
): Record<string, unknown> {
  if (!governance.is_concluded || governance.strategy_output_allowed) {
    return fullReport;
  }

  const report = { ...fullReport };

  // Suppress substantive litigation arrays
  delete report.ways_out_analysis;
  delete report.settlement_opportunities;
  delete report.litigation_strategy;
  delete report.trial_strategy;
  delete report.defense_strategy;
  delete report.prosecution_strategy;

  // Filter recommendations to verification-only
  const rawRecs = Array.isArray(report.canonical_recommendations)
    ? report.canonical_recommendations
    : [];

  const verificationOnlyRecs = rawRecs.filter((r: any) => {
    const text = `${r.title ?? ""} ${r.action ?? ""} ${r.reason ?? ""}`.toLowerCase();
    return (
      /verificar|cotejar|confirmar|constatar|revisar\s+engrose|expediente/i.test(text) &&
      !/presentar|interponer|promover|demandar|denunciar/i.test(text)
    );
  });

  report.canonical_recommendations = verificationOnlyRecs;
  report.recommended_actions_title = "PASOS DE VERIFICACIÓN DOCUMENTAL";

  return report;
}
