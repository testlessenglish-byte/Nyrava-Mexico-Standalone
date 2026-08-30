import type { ImmutableReportGovernance } from "../intelligence/concluded-case-governance";

export interface ReportCapability {
  mode: "FULL" | "LIMITED";
  verification_steps_allowed: boolean;
  strategic_recommendations_allowed: boolean;
  scores_allowed: boolean;
  probabilities_allowed: boolean;
  motions_allowed: boolean;
}

/** Display permissions only. Does not recompute ESS or any score. */
export function resolveReportCapability(report: Record<string, any>, governance: ImmutableReportGovernance): ReportCapability {
  const canonical = report.full_report?.report_capability ?? report.report_capability ?? {};
  const full = canonical.mode === "LIMITED" ? false : report.report_mode === "FULL";
  const strategic = full && governance.strategy_output_allowed &&
    governance.recommendation_policy === "full_strategic" &&
    canonical.strategic_recommendations_allowed !== false;
  return {
    mode: full ? "FULL" : "LIMITED",
    verification_steps_allowed: canonical.verification_steps_allowed !== false,
    strategic_recommendations_allowed: strategic,
    scores_allowed: full && report.scores_suppressed === false && canonical.scores_allowed !== false,
    probabilities_allowed: strategic && canonical.probabilities_allowed !== false,
    motions_allowed: strategic && report.motions_suppressed === false && canonical.motions_allowed !== false,
  };
}

export const VERIFICATION_ACTIONS_TITLE = "PASOS DE VERIFICACIÓN DOCUMENTAL";
export const STRATEGIC_ACTIONS_TITLE = "PRÓXIMAS ACCIONES RECOMENDADAS";
const strategic = /\b(interponer|promover|demandar|denunciar|litigar|impugnar|nulidad|revocaci[oó]n|prepare for trial|file a motion|appeal|estrategia)\b/i;
const verification = /^(verificar|cotejar|confirmar|constatar|revisar|comparar|identificar|localizar|solicitar|obtener copia|someter|verify|check|review|compare)\b/i;

export function isDocumentaryVerification(text: string): boolean {
  return verification.test(text.trim()) && !strategic.test(text) &&
    /document|expediente|constancia|fuente|engrose|autos|copia|soporte|acuse|abogado|record|source/i.test(text);
}

/** All action lanes consume this helper; a heading never grants permission. */
export function renderPermittedFindingActions(
  finding: { verification_steps?: unknown; canonical_actions?: unknown },
  capability: ReportCapability,
  governance: ImmutableReportGovernance,
): { title: string; items: string[]; kind: "verification" | "strategic" } {
  if (!capability.verification_steps_allowed) return { title: VERIFICATION_ACTIONS_TITLE, items: [], kind: "verification" };
  const verified = Array.isArray(finding.verification_steps)
    ? finding.verification_steps.filter((x): x is string => typeof x === "string" && isDocumentaryVerification(x)) : [];
  if (capability.mode === "LIMITED" || !capability.strategic_recommendations_allowed ||
      !governance.strategy_output_allowed || governance.recommendation_policy !== "full_strategic") {
    return { title: VERIFICATION_ACTIONS_TITLE, items: [...new Set(verified)], kind: "verification" };
  }
  const actions = Array.isArray(finding.canonical_actions)
    ? finding.canonical_actions.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  return actions.length ? { title: STRATEGIC_ACTIONS_TITLE, items: [...new Set([...verified, ...actions])], kind: "strategic" }
    : { title: VERIFICATION_ACTIONS_TITLE, items: [...new Set(verified)], kind: "verification" };
}
