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
//      Names are materia-aware: `strategy` is "Estrategia de Defensa o
//      Acusación" in penal, "Estrategia de Amparo (suspensión e
//      improcedencia)" in amparo, "Estrategia Laboral" in laboral.
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
  | "apelacion"
  | "inmobiliario"
  | "agrario"
  | "electoral";

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
  // 2026-08-04: previously routed through "administrativo" — a medio de
  // impugnación electoral shares the written-record shape of a juicio de
  // nulidad, but has its own governing law (LGSMIME, not LFPCA), its own
  // authority (TEPJF, not TFJA), and doctrine (paridad de género, violencia
  // política, fiscalización de campaña) with no administrativo analog.
  electoral: "electoral",
  // 2026-08-04: previously routed through "civil" — a Tribunal Unitario
  // Agrario proceeding shares some litigation shape with a civil suit (actor/
  // demandado, ofrecimiento de pruebas) but has its own governing law (Ley
  // Agraria, not the Código Civil), its own registry of title (Registro
  // Agrario Nacional, not the Registro Público de la Propiedad), and
  // frequently an indigenous-community dimension (Convenio 169 OIT) that
  // civil procedure has no concept of. Confirmed on Expediente Agrario
  // 419/2026: the case got the exact same document checklist, procedural
  // checklist, and finding taxonomy as an ordinary civil contract dispute.
  agrario: "agrario",
  // Ambiental: contentious-administrative track (PROFEPA sanction ->
  // recurso de revisión -> juicio de nulidad ante el TFJA), same profile
  // rationale as electoral above.
  ambiental: "administrativo",
  // Transactional, not adversarial — does not share civil's litigation
  // profile (that would pull in trial_prep/discovery/witness stages meant
  // for a lawsuit, not a closing). See EXCLUDED_STAGES below.
  inmobiliario: "inmobiliario",
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
 *
 * 2026-08-02: trial_prep was removed from CANONICAL_STAGES entirely (not
 * materia-excluded — it no longer exists as a stage at all, for any
 * materia, including penal). Product decision: rather than keep patching
 * its "Trial Prep & Jury Simulation" framing materia-by-materia (it had
 * already caused one production stall via a stuck checkpoint, on top of
 * genuinely not fitting most Mexican proceedings), it is removed pending a
 * real, properly-scoped replacement rather than incremental fixes to the
 * existing engine. Every "trial_prep" entry previously listed below is
 * gone for that reason, not because it was re-included.
 */
const EXCLUDED_STAGES: Record<MxPipelineProfile, readonly string[]> = {
  // Proceso penal acusatorio (CNPP): everything is relevant, including
  // audiencia/juicio oral preparation and control constitucional.
  penal: [],
  // Juicio de amparo: se resuelve sobre el acto reclamado y el expediente —
  // no hay desahogo de testigos ni juicio oral.
  amparo: ["witness"],
  // Violaciones a derechos humanos por autoridad: mismo alcance que penal.
  derechos_humanos: [],
  // Materia laboral (LFT / tribunales laborales): sí hay audiencia, no hay
  // control constitucional directo en el juicio ordinario.
  laboral: ["constitutional"],
  civil: ["constitutional"],
  familiar: ["constitutional"],
  mercantil: ["constitutional"],
  fiscal: ["constitutional"],
  // Juicio contencioso administrativo (TFJA, LFPCA): resolved on the written
  // expediente — demanda, contestación, pruebas documentales, alegatos,
  // sentencia. No live witness examination in the adversarial-trial sense
  // (testimonial evidence is rare and, where offered, resolved by written
  // interrogatorio, not cross-examination) and no oral trial with opening/
  // closing statements to a fact-finder. Same rationale already applied to
  // amparo and apelacion below — this was a gap, not an intentional
  // difference: trial_prep's engine (engines.server.ts) literally produces
  // opening_themes/closing_themes/witness_order/exhibit_order, none of
  // which map onto a TFJA nullity action. Also fixes electoral and
  // ambiental, which route through this same profile
  // (PROFILE_BY_MATERIA above).
  administrativo: ["constitutional", "witness"],
  // Segunda instancia: se resuelve sobre agravios y el expediente.
  apelacion: ["constitutional", "witness"],
  // Cierre inmobiliario: transaccional, no contencioso. Sin partes
  // adversas, sin audiencia, sin juicio — se excluyen todas las etapas de
  // litigio. `strategy` and `work_product` are ALSO excluded here, not just
  // the obviously-litigation ones above: both engines (engines.server.ts)
  // hardcode a binary criminal/civil-litigation branch — theory_type
  // "plaintiff"|"defense"|"prosecution"|"alternative", document_type
  // "motion_for_summary_judgment"|"discovery_request"|"cross_exam_plan"|
  // "trial_outline"|"settlement_demand"|"mediation_brief" — with no
  // materia-aware branch and no fallback for a non-adversarial transaction.
  // Running them for inmobiliario would ask the AI to draft a motion for a
  // home closing rather than producing anything usable. This is pre-existing
  // staleness in those two engines (same category as the ~50 files flagged
  // in MIGRATION_NOTES.md as still containing U.S. litigation logic), not
  // something newly introduced — excluding the stage is the honest fix
  // until those engines get a real transactional-document branch (see the
  // integration plan's §3.8 "document drafting" — scoped, not yet built).
  // `report`/`scoring`/`legal_qa`/`contradictions`/`perspectives`/
  // `opportunities` were checked too and degrade gracefully (empty filters,
  // not hard failures) rather than producing wrong output, so they stay on.
  inmobiliario: [
    "constitutional",
    "witness",
    "discovery",
    "litigation_strategy_center",
    "theories",
    "strategy",
    "work_product",
  ],
  // Juicio agrario ante Tribunal Unitario Agrario: se resuelve sobre el
  // expediente y las pruebas documentales/periciales/testimoniales
  // ordinarias del proceso — no hay control constitucional directo dentro
  // del juicio (eso corresponde al amparo posterior contra la sentencia).
  agrario: ["constitutional"],
  // Medios de impugnación electoral (TEPJF/OPLE): se resuelven sobre el
  // expediente y las constancias documentales (actas, paquetes
  // electorales) — no hay desahogo de prueba testimonial en audiencia.
  electoral: ["witness"],
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
export const MX_PARTY_ROLES: Record<
  MxPipelineProfile,
  { a: string; b: string; c?: string; neutral: string }
> = {
  penal: { a: "ministerio_publico", b: "defensa", neutral: "ambas" },
  // Amparo routinely has a tercero interesado (e.g. the beneficiary of the
  // challenged act) distinct from both quejoso and autoridad responsable —
  // without a third slot the model has nowhere correct to put that party.
  amparo: { a: "quejoso", b: "autoridad_responsable", c: "tercero_interesado", neutral: "ambas" },
  derechos_humanos: { a: "quejoso", b: "autoridad_responsable", neutral: "ambas" },
  laboral: { a: "trabajador", b: "patron", neutral: "ambas" },
  civil: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  familiar: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  mercantil: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  fiscal: { a: "contribuyente", b: "autoridad_fiscal", neutral: "ambas" },
  // Juicio contencioso administrativo de nulidad (TFJA) commonly has a
  // tercero interesado — e.g. an IMPI nullity action brought by the
  // sanctioned/rejected party (particular) against the authority
  // (autoridad), where the original administrative complainant or the
  // holder of the challenged registration is a third party with its own
  // procedural standing, not the plaintiff and not the authority. Confirmed
  // via a real production case (San Baltazar Spirits vs. IMPI, tercero:
  // Palenque Xquenda) where the absence of this third slot caused the
  // tercero's position to be misclassified as the plaintiff's.
  administrativo: { a: "particular", b: "autoridad", c: "tercero_interesado", neutral: "ambas" },
  apelacion: { a: "apelante", b: "apelado", neutral: "ambas" },
  inmobiliario: { a: "comprador", b: "vendedor", neutral: "ambas" },
  // Ley Agraria art. 170 uses "actor"/"demandado"; a tercero interesado slot
  // is needed because a restitución/deslinde case routinely involves a
  // núcleo agrario (ejido/comunidad) as a party distinct from either the
  // individual actor or demandado — e.g. an ejidatario suing a co-ejidatario
  // over parcel boundaries, with the comisariado ejidal itself impleaded.
  agrario: { a: "parte_actora", b: "parte_demandada", c: "nucleo_agrario", neutral: "ambas" },
  // A medio de impugnación electoral routinely involves a tercero
  // interesado — e.g. the candidate/party that benefited from the
  // challenged act, distinct from the actor and the responsible authority.
  electoral: { a: "actor", b: "autoridad_responsable", c: "tercero_interesado", neutral: "ambas" },
};

/** JSON-schema-ready enum string, e.g. `"parte_actora"|"parte_demandada"|"ambas"`, for a given case type. */
export function mxPartyRoleEnum(caseType: string | null | undefined): string {
  const r = MX_PARTY_ROLES[requireMxProfile(caseType)];
  const c = r.c ? `|"${r.c}"` : "";
  return `"${r.a}"|"${r.b}"${c}|"${r.neutral}"`;
}

/** Human-readable label for a snake_case Mexican role slug, e.g.
 *  "tercero_interesado" -> "Tercero Interesado". These slugs are already
 *  valid Spanish terms (see MX_PARTY_ROLES), so a title-case formatter is
 *  sufficient — no separate translation table needed. */
export function mxRoleLabel(slug: string | null | undefined): string {
  return String(slug ?? "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "Theory";
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
    administrativo: "pipeline.skip.witness.administrativo",
    amparo: "pipeline.skip.witness.amparo",
    apelacion: "pipeline.skip.witness.apelacion",
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
  // Nested verification agents persist as `agent:<type>` so their run rows can
  // never be mistaken for (or collide with) a top-level canonical stage.
  if (engineOrStage.startsWith("agent:")) {
    return `pipeline.agent.${engineOrStage.slice("agent:".length).replace(/_batch$/, "")}`;
  }
  const key = stageKeyForEngine(engineOrStage);
  return key ? stageLabelKey(key, caseType) : null;
}

/** i18n key for an execution status / stage state. */
export function statusLabelKey(status: string): string {
  return `pipeline.status.${status}`;
}
