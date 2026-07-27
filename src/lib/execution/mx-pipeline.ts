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
import {
  normalizeMexicanCaseType,
  requireMexicanCaseType,
  type MexicanCaseType,
} from "@/lib/jurisdiction/mexico";

/**
 * Mexican PROCEDURAL profiles. These are execution profiles (which procedural
 * code and which audiencias govern the run), not a second case-type
 * taxonomy — the only case-type vocabulary in the platform is
 * `MexicanCaseType` (src/lib/jurisdiction/mexico-types.ts).
 */
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
 * THE single materia → procedural-profile mapping. Every stage-relevance,
 * label, party-role and skip-reason decision flows through it, so there is
 * exactly one place where a materia's procedural framing is decided.
 */
const PROFILE_BY_MATERIA: Record<MexicanCaseType, MxPipelineProfile> = {
  penal: "penal",
  amparo: "amparo",
  constitucional: "derechos_humanos",
  laboral: "laboral",
  civil: "civil",
  familiar: "familiar",
  mercantil: "mercantil",
  fiscal: "fiscal",
  administrativo: "administrativo",
  // Materias con procedimiento contencioso administrativo/especial: se
  // ejecutan con el perfil administrativo (juicio de nulidad, agravios).
  electoral: "administrativo",
  agrario: "civil",
};

/**
 * Strict resolution for execution paths: an unrecognized materia is a routing
 * error, never a silent fallback to `civil`.
 */
export function requireMxProfile(caseType: unknown): MxPipelineProfile {
  return PROFILE_BY_MATERIA[requireMexicanCaseType(caseType, "requireMxProfile")];
}

/**
 * Tolerant resolution for rendering/summarizing paths. Returns null when the
 * case has no materia stamped yet (auto-detection runs before execution), so
 * callers can degrade honestly instead of pretending the case is civil.
 */
export function mxProfileOrNull(caseType: unknown): MxPipelineProfile | null {
  const materia = normalizeMexicanCaseType(caseType);
  return materia ? PROFILE_BY_MATERIA[materia] : null;
}

/**
 * Back-compat resolver used by procedural modules that require a profile to
 * key their tables. Strict by design — call `mxProfileOrNull` when the input
 * may legitimately be unset.
 */
export function resolveMxProfile(caseType: string | null | undefined): MxPipelineProfile {
  return requireMxProfile(caseType);
}


/**
 * Stages that are NOT legally relevant per profile. Everything else in
 * CANONICAL_STAGES runs. Execution order always follows the canonical
 * dependency graph — a profile only removes stages, never reorders them, so
 * upstream dependencies can never be violated.
 *
 * NOTE: exclusions here must be LEGAL, never budgetary. A previous revision
 * excluded nine "quota-heavy" stages (perspectives, theories, opportunities,
 * trial_prep, strategy, litigation_strategy_center, work_product,
 * hallucination, multi_agent) from every materia, which is why every case
 * reported most engines — including the 13-agent run — as skipped. Quota is
 * handled where it belongs: payload budgeting and provider cooldowns.
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
  apelacion: ["constitutional", "witness", "trial_prep"],
};

/** Canonical reason recorded when a stage is skipped for legal irrelevance. */
export const SKIP_REASON_NOT_RELEVANT_MX = "not_relevant_to_mx_case_type";

/** Exclusions for a case whose materia is not resolved yet: only the
 *  quota-heavy optional stages are off, nothing materia-specific is assumed. */
function exclusionsFor(caseType: unknown): readonly string[] {
  const profile = mxProfileOrNull(caseType);
  return profile ? EXCLUDED_STAGES[profile] : [];
}

export function isStageRelevantForCaseType(caseType: string | null | undefined, stageKey: string): boolean {
  return !exclusionsFor(caseType).includes(stageKey);
}

/**
 * Real Mexican procedural party-role labels per profile, replacing the
 * hardcoded "defense"/"prosecution"/"both" enum that several engine prompts
 * used regardless of materia — that enum is meaningless (and wrong) for
 * every civil/family/labor/tax/amparo case, which is most of them. Used to
 * build the AI-facing JSON schema's affected_party enum dynamically instead
 * of a fixed English pair.
 */
export const MX_PARTY_ROLES: Record<MxPipelineProfile, { a: string; b: string; neutral: string }> = {
  penal: { a: "ministerio_publico", b: "defensa", neutral: "ambas" },
  amparo: { a: "quejoso", b: "autoridad_responsable", neutral: "ambas" },
  derechos_humanos: { a: "quejoso", b: "autoridad_responsable", neutral: "ambas" },
  laboral: { a: "trabajador", b: "patron", neutral: "ambas" },
  civil: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  familiar: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  mercantil: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  fiscal: { a: "contribuyente", b: "autoridad_fiscal", neutral: "ambas" },
  administrativo: { a: "particular", b: "autoridad", neutral: "ambas" },
  apelacion: { a: "apelante", b: "apelado", neutral: "ambas" },
};

/** JSON-schema-ready enum string, e.g. `"parte_actora"|"parte_demandada"|"ambas"`, for a given case type. */
export function mxPartyRoleEnum(caseType: string | null | undefined): string {
  const r = MX_PARTY_ROLES[requireMxProfile(caseType)];
  return `"${r.a}"|"${r.b}"|"${r.neutral}"`;
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
  const profile = mxProfileOrNull(caseType);
  if (!profile) return "pipeline.skip.generic";
  return SKIP_REASON_KEYS[stageKey]?.[profile] ?? "pipeline.skip.generic";
}

/** Ordered, profile-filtered stage list for a case type. */
export function mxPipelineStages(caseType: string | null | undefined): StageDef[] {
  const excluded = exclusionsFor(caseType);
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
  const profile = mxProfileOrNull(caseType);
  const variants = STAGE_LABEL_VARIANTS[stageKey];
  if (profile && variants && variants.includes(profile)) return `pipeline.stage.${stageKey}.${profile}`;
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
