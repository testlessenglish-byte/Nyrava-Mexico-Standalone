// Derives Mexican-procedure party-role labels from the case's materia
// (case_type), instead of hardcoding a single US-litigation pair like
// "Plaintiff" / "Defendant". Used everywhere the report needs to label
// "the side that brought the action" vs "the side answering it".
import type { PracticeArea } from "@/lib/intelligence/practice-areas";

export type PartyRoleLabels = {
  /** The side that initiates the action (actor / quejoso / Ministerio Público, per materia). */
  moving: string;
  /** The side that answers the action (demandado / autoridad responsable / imputado, per materia). */
  responding: string;
};

const AMPARO_GROUP = new Set<PracticeArea>(["amparo", "constitucional"]);
const CRIMINAL_GROUP = new Set<PracticeArea>(["penal"]);
const LABOR_GROUP = new Set<PracticeArea>(["laboral"]);
const FAMILY_GROUP = new Set<PracticeArea>(["familiar"]);
const FISCAL_GROUP = new Set<PracticeArea>(["fiscal", "administrativo"]);

/**
 * @param caseType the case's materia (`cases.case_type`), or null/undefined if unset.
 * @param t the i18n translator from useI18n().
 */
export function getPartyRoleLabels(
  caseType: PracticeArea | string | null | undefined,
  t: (key: string) => string,
): PartyRoleLabels {
  if (caseType && CRIMINAL_GROUP.has(caseType as PracticeArea)) {
    return { moving: t("reports.party.criminal.moving"), responding: t("reports.party.criminal.responding") };
  }
  if (caseType && AMPARO_GROUP.has(caseType as PracticeArea)) {
    return { moving: t("reports.party.amparo.moving"), responding: t("reports.party.amparo.responding") };
  }
  if (caseType && LABOR_GROUP.has(caseType as PracticeArea)) {
    return { moving: t("reports.party.labor.moving"), responding: t("reports.party.labor.responding") };
  }
  if (caseType && FAMILY_GROUP.has(caseType as PracticeArea)) {
    return { moving: t("reports.party.family.moving"), responding: t("reports.party.family.responding") };
  }
  if (caseType && FISCAL_GROUP.has(caseType as PracticeArea)) {
    return { moving: t("reports.party.fiscal.moving"), responding: t("reports.party.fiscal.responding") };
  }
  return { moving: t("reports.party.civil.moving"), responding: t("reports.party.civil.responding") };
}
