import type { CaseAnalysisMode } from "./case-analysis-mode";

export type PenalEnginePrerequisites = {
  hasIdentifiedWitnessStatement: boolean;
  hasCustodyEvidenceAndHandling: boolean;
  hasOpenSubsequentProceeding: boolean;
};

export type EngineApplicability = {
  run: boolean;
  status: "applicable" | "skipped_not_applicable";
  reason: string | null;
};

const PROSPECTIVE_STAGES = new Set([
  "discovery",
  "theories",
  "opportunities",
  "strategy",
  "litigation_strategy_center",
  "work_product",
]);

const PROSPECTIVE_AGENTS = new Set([
  "reasonable_doubt_defense_theory",
  "appeal_opportunity_detection",
  "suspension_analysis",
]);

export function detectPenalEnginePrerequisites(corpusText: string): PenalEnginePrerequisites {
  const text = String(corpusText ?? "");
  const hasWitnessRole = /\b(testigo|declarante|víctima|victima|ofendido|imputado|acusado)\b/i.test(text);
  const hasAttributableStatement =
    /\b(declar[oó]|manifest[oó]|refiri[oó]|señal[oó]|testific[oó]|entrevista|declaraci[oó]n|testimonio)\b/i.test(
      text,
    );

  const hasEvidence =
    /\b(indicio|objeto|arma|casquillo|muestra|dispositivo|teléfono|telefono|archivo\s+digital|evidencia\s+(?:física|fisica|digital)|dato\s+de\s+prueba)\b/i.test(
      text,
    );
  const hasHandling =
    /\b(asegur[oó]|embal[oó]|sell[oó]|etiquet[oó]|recolect[oó]|traslad[oó]|almacen[oó]|resguard[oó]|entreg[oó]|recibi[oó]|cadena\s+de\s+custodia|registro\s+de\s+custodia)\b/i.test(
      text,
    );

  return {
    hasIdentifiedWitnessStatement: hasWitnessRole && hasAttributableStatement,
    hasCustodyEvidenceAndHandling: hasEvidence && hasHandling,
    hasOpenSubsequentProceeding: false,
  };
}

export function classificationSupportsOpenProceeding(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const value = String((row as Record<string, unknown>).value ?? "").toLowerCase();
  const sourceQuote = String((row as Record<string, unknown>).source_quote ?? "").trim();
  if (value === "ongoing" && sourceQuote) return true;

  const conflicts = (row as Record<string, unknown>).conflicting_values;
  if (!Array.isArray(conflicts)) return false;
  return conflicts.some(
    (item) =>
      item &&
      typeof item === "object" &&
      String((item as Record<string, unknown>).value ?? "").toLowerCase() === "ongoing" &&
      Boolean(String((item as Record<string, unknown>).quote ?? "").trim()),
  );
}

export function penalEngineApplicability(
  engine: string,
  mode: CaseAnalysisMode,
  prerequisites: PenalEnginePrerequisites,
): EngineApplicability {
  if (
    mode === "concluded_audit" &&
    !prerequisites.hasOpenSubsequentProceeding &&
    (PROSPECTIVE_STAGES.has(engine) || PROSPECTIVE_AGENTS.has(engine))
  ) {
    return {
      run: false,
      status: "skipped_not_applicable",
      reason: "concluded_case_without_grounded_open_subsequent_proceeding",
    };
  }
  if (
    (engine === "witness" || engine === "witness_intelligence" || engine === "witness_credibility") &&
    !prerequisites.hasIdentifiedWitnessStatement
  ) {
    return {
      run: false,
      status: "skipped_not_applicable",
      reason: "no_identified_witness_with_attributable_statement",
    };
  }
  if (
    (engine === "chain_of_custody" || engine === "chain_of_custody_analysis") &&
    !prerequisites.hasCustodyEvidenceAndHandling
  ) {
    return {
      run: false,
      status: "skipped_not_applicable",
      reason: "no_physical_or_digital_evidence_with_custody_history",
    };
  }
  return { run: true, status: "applicable", reason: null };
}
