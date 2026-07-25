// =============================================================================
// JURISDICTION-AWARE PIPELINE PROFILES — México
//
// The canonical stage list (execution/canonical.ts) defines WHAT can run and in
// which dependency-safe order. This module defines, for the Mexican
// jurisdiction:
//
//   1. Which stages are legally relevant for a given case type (materia).
//      e.g. no jury simulation for an ordinary Mexican criminal case; no
//      constitutional/derechos-fundamentales engine on a mercantil contract.
//   2. How each stage is NAMED for a Mexican attorney — as i18n keys, so the
//      UI renders Spanish (default) or English from src/i18n/locales/*.json.
//      Names are materia-aware: `trial_prep` is "Preparación para Juicio Oral"
//      in penal, "Preparación para Audiencia" in laboral/civil.
//
// Pure module: no i18n, no React, no Supabase — safe to import from server
// functions, the worker, and the browser bundle alike.
// =============================================================================

import { CANONICAL_STAGES, type StageDef } from "./canonical";

/** Mexican pipeline profiles, keyed by materia. */
export type MxPipelineProfile =
  | "penal"
  | "amparo"
  | "derechos_humanos"
  | "laboral"
  | "civil"
  | "familiar"
  | "mercantil"
  | "fiscal"
  | "administrativo"
  | "apelacion";

export const MX_JURISDICTION = "MX" as const;

/**
 * Practice area (cases.case_type) → pipeline profile.
 * Unknown/empty values fall back to `civil`, the broadest ordinary-litigation
 * profile.
 */
const PROFILE_BY_CASE_TYPE: Record<string, MxPipelineProfile> = {
  criminal: "penal",
  amparo: "amparo",
  civil_rights: "derechos_humanos",
  employment: "laboral",
  family: "familiar",
  general_civil: "civil",
  personal_injury: "civil",
  medical_malpractice: "civil",
  real_estate: "civil",
  estate: "familiar",
  commercial: "mercantil",
  corporate: "mercantil",
  ip: "mercantil",
  securities: "mercantil",
  banking: "mercantil",
  fintech: "mercantil",
  tax_law: "fiscal",
  appellate: "apelacion",
};

export function resolveMxProfile(caseType: string | null | undefined): MxPipelineProfile {
  if (!caseType) return "civil";
  return PROFILE_BY_CASE_TYPE[caseType] ?? "civil";
}

/**
 * Stages that are NOT legally relevant per profile. Everything else in
 * CANONICAL_STAGES runs. Execution order always follows the canonical
 * dependency graph — a profile only removes stages, never reorders them, so
 * upstream dependencies can never be violated.
 */
const EXCLUDED_STAGES: Record<MxPipelineProfile, readonly string[]> = {
  // Proceso penal acusatorio (CNPP): everything is relevant, including
  // audiencia/juicio oral preparation and control constitucional.
  penal: [],
  // Juicio de amparo: se resuelve sobre el acto reclamado y el expediente —
  // no hay desahogo de testigos ni juicio oral.
  amparo: ["witness", "trial_prep"],
  // Violaciones a derechos humanos por autoridad: mismo alcance que penal.
  derechos_humanos: [],
  // Materia laboral (LFT / tribunales laborales): sí hay audiencia, no hay
  // control constitucional directo en el juicio ordinario.
  laboral: ["constitutional"],
  civil: ["constitutional"],
  familiar: ["constitutional"],
  mercantil: ["constitutional"],
  fiscal: ["constitutional"],
  administrativo: ["constitutional"],
  // Segunda instancia: se resuelve sobre agravios y el expediente.
  apelacion: ["constitutional", "trial_prep", "witness"],
};

/** Canonical reason recorded when a stage is skipped for legal irrelevance. */
export const SKIP_REASON_NOT_RELEVANT_MX = "not_relevant_to_mx_case_type";

export function isStageRelevantForCaseType(caseType: string | null | undefined, stageKey: string): boolean {
  return !EXCLUDED_STAGES[resolveMxProfile(caseType)].includes(stageKey);
}

/**
 * Specific, human-readable explanation for why a stage was skipped for this
 * profile — replaces the old bare "OMITIDO"/SKIP_REASON_NOT_RELEVANT_MX
 * generic code with actual legal reasoning a user can read. Returns the
 * i18n KEY (resolved via src/i18n, same pattern as stageLabelKey), not a
 * hardcoded string, so this respects the user's language setting too.
 */
const SKIP_REASON_KEYS: Record<string, Partial<Record<MxPipelineProfile, string>>> = {
  witness: {
    amparo: "pipeline.skip.witness.amparo",
    apelacion: "pipeline.skip.witness.apelacion",
  },
  trial_prep: {
    amparo: "pipeline.skip.trial_prep.amparo",
    apelacion: "pipeline.skip.trial_prep.apelacion",
  },
  constitutional: {
    laboral: "pipeline.skip.constitutional.ordinary",
    civil: "pipeline.skip.constitutional.ordinary",
    familiar: "pipeline.skip.constitutional.ordinary",
    mercantil: "pipeline.skip.constitutional.ordinary",
    fiscal: "pipeline.skip.constitutional.ordinary",
    administrativo: "pipeline.skip.constitutional.ordinary",
    apelacion: "pipeline.skip.constitutional.apelacion",
  },
};

/** i18n key for why a stage was skipped for this case type, or a generic
 *  fallback if this exact (stage, profile) pair isn't specifically documented. */
export function stageSkipReasonKey(stageKey: string, caseType: string | null | undefined): string {
  const profile = resolveMxProfile(caseType);
  return SKIP_REASON_KEYS[stageKey]?.[profile] ?? "pipeline.skip.generic";
}

/** Ordered, profile-filtered stage list for a case type. */
export function mxPipelineStages(caseType: string | null | undefined): StageDef[] {
  const excluded = EXCLUDED_STAGES[resolveMxProfile(caseType)];
  return CANONICAL_STAGES.filter((s) => !excluded.includes(s.key));
}

/** Stage keys only — convenient for server-side filtering. */
export function mxPipelineStageKeys(caseType: string | null | undefined): string[] {
  return mxPipelineStages(caseType).map((s) => s.key);
}

// -----------------------------------------------------------------------------
// Naming — i18n keys, not literals.
// -----------------------------------------------------------------------------

/**
 * Profiles that get their own wording for a stage. Any (stage, profile) pair
 * listed here resolves to `pipeline.stage.<key>.<profile>`; everything else
 * resolves to `pipeline.stage.<key>`.
 */
const STAGE_LABEL_VARIANTS: Record<string, readonly MxPipelineProfile[]> = {
  trial_prep: ["penal", "laboral", "civil", "familiar", "mercantil", "fiscal", "administrativo"],
  strategy: ["penal", "amparo", "laboral"],
  litigation_strategy_center: ["amparo"],
  constitutional: ["amparo", "derechos_humanos"],
  discovery: ["amparo", "laboral"],
};

/** i18n key for a stage's label, materia-aware. */
export function stageLabelKey(stageKey: string, caseType?: string | null): string {
  const profile = resolveMxProfile(caseType);
  const variants = STAGE_LABEL_VARIANTS[stageKey];
  if (variants && variants.includes(profile)) return `pipeline.stage.${stageKey}.${profile}`;
  return `pipeline.stage.${stageKey}`;
}

/** i18n key for a stage's one-line description. */
export function stageDescriptionKey(stageKey: string): string {
  return `pipeline.stage.${stageKey}.desc`;
}

/**
 * Engine name (pipeline_engine_runs.engine) or pipeline event stage → canonical
 * stage key. Ledger/event rows are written with engine names, aliases, and a
 * couple of legacy spellings, so normalize all of them here.
 */
const STAGE_KEY_ALIASES: Record<string, string> = {
  ...Object.fromEntries(CANONICAL_STAGES.map((s) => [s.engine, s.key])),
  ...Object.fromEntries(CANONICAL_STAGES.map((s) => [s.key, s.key])),
  ocr: "extraction",
  witness_intel: "witness",
  evidence_intelligence: "evidence_intel",
  evidence_intel: "evidence_intel",
  constitutional_compliance: "constitutional",
  discovery_gaps: "discovery",
  hallucination_review: "hallucination",
  report_generator: "report",
  theory: "theories",
  opportunity: "opportunities",
  jurisdiction: "jurisdiction_intel",
  legal_qa_gate: "legal_qa",
  procedural: "procedural_compliance",
};

export function stageKeyForEngine(engineOrStage: string): string | null {
  return STAGE_KEY_ALIASES[engineOrStage] ?? null;
}

/**
 * i18n key for any ledger/event row, falling back to `null` when the engine is
 * not part of the canonical pipeline (caller shows the raw name).
 */
export function engineLabelKey(engineOrStage: string, caseType?: string | null): string | null {
  const key = stageKeyForEngine(engineOrStage);
  return key ? stageLabelKey(key, caseType) : null;
}

/** i18n key for an execution status / stage state. */
export function statusLabelKey(status: string): string {
  return `pipeline.status.${status}`;
}
