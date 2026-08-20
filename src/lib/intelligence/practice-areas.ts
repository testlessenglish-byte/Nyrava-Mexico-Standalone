// Materia Isolation Framework — POLICY SURFACE over the canonical Mexican
// jurisdiction module (src/lib/jurisdiction/mexico.ts).
//
// The vocabulary here is Mexican and only Mexican: penal, civil, mercantil,
// familiar, laboral, administrativo, fiscal, amparo, electoral, agrario,
// constitucional. `PracticeArea` is an alias of `MexicanCaseType` kept for the
// existing call sites; there is no separate practice-area taxonomy and no
// mapping from any foreign classification system.
//
// This module governs, per materia:
//   - which analyzers/engines may run        (MX_ENGINES)
//   - which finding modules may persist      (MX_FINDING_MODULES)
//   - which motion families may be drafted   (MX_MOTION_TYPES)
//   - which terms are forbidden in prose     (MX_BLOCKED_TERMS)
//   - which report sections render           (MX_SECTIONS)
//   - which workspace tabs appear            (MX_TABS)
//
// Every helper accepts an optional `activeDomains` set so a controlled
// cross-domain activation (cross-domain.server.ts) widens — never narrows —
// the base policy.

import {
  MX_CASE_TYPES,
  MX_CASE_TYPE_LABELS,
  normalizeMexicanCaseType,
  requireMexicanCaseType,
  materiaBlockedTerms,
  materiaEngines,
  materiaFindingModules,
  materiaForbiddenReportFields,
  materiaMotionTypes,
  materiaSections,
  materiaTabs,
  materiaDashboardModules,
  materiaLifecycleStatuses,
  materiaPartyRoles,
  materiaTaskTemplates,
  materiaAiPersona,
  CORE_TABS,
  CORE_CAPABILITIES,
  type MxTaskTemplate,
  type MexicanCaseType,
} from "@/lib/jurisdiction/mexico";
import { executionProfileFor, type ExecutionProfile } from "@/lib/jurisdiction/execution-profile";

/** Canonical Mexican materia. Alias retained for existing call sites. */
export type PracticeArea = MexicanCaseType;

export const PRACTICE_AREAS = MX_CASE_TYPES;

// ---------------------------------------------------------------------------
// Universal policy (applies to every materia)
// ---------------------------------------------------------------------------

export const UNIVERSAL_SECTIONS = new Set<string>([
  "exec",
  "action_center",
  "impact_dashboard",
  "overview",
  "facts",
  "timeline",
  "findings",
  "evidence_map",
  "evidence_intel",
  "coverage",
  "agent_stats",
  "contradictions",
  "witnesses",
  "legal_issues",
  "work_product",
  "audit",
  "appendix",
]);

/**
 * Core Platform tabs — guaranteed on EVERY materia. Sourced from
 * mexico-modules.ts::CORE_TABS so there is exactly one declaration of what
 * "universal" means. A practice area may only ADD tabs on top of this set.
 */
export const UNIVERSAL_TABS = new Set<string>([
  ...CORE_TABS,
  // legacy keys kept for existing workspace surfaces
  "strategic",
  "attack",
  "evidence",
  "witnesses",
  "work",
  "chat",
  "report",
]);

export const UNIVERSAL_ENGINES = new Set<string>([
  "extraction",
  "ocr",
  "entity_extraction",
  "fact_extraction",
  "evidence_intelligence",
  "contradictions",
  "timeline",
  "evidence_map",
  "discovery_gaps",
  "witness_intelligence",
  // Nested verification agent (inside the "agents" wrapper). Namespaced so it
  // cannot collide with the independent `witness_intelligence` stage above.
  "agent:witness_credibility",
  // Completed-case audit only — actually gated by case_analysis_mode
  // (AUDIT_ONLY_AGENT_TYPES in pipeline.server.ts), not by materia, so it
  // must be runnable in every materia. See case-analysis-mode.ts.
  "agent:ways_out_analysis",
  "scoring",
  "ess_validator",
  "claim_validator",
  "report_generator",
  "report_validator",
  "analyzers",
  "agents",
  // México: jurisdiction resolution, procedural-compliance checklist and the
  // legal quality-control gate apply to every materia without exception.
  "jurisdiction_intel",
  "procedural_compliance",
  "legal_qa",
]);

/** Engines that run only for specific materias. */
export const PRACTICE_GATED_ENGINES = new Set<string>([
  "constitutional_compliance",
  // Nested verification agent (inside the "agents" wrapper). Namespaced so it
  // cannot overwrite the independent `constitutional_compliance` stage above.
  "agent:constitutional_compliance",
  "chain_of_custody",
  "procedural_violations",
  "cross_examination",
  // Amparo / Constitucional specialized investigator agents:
  "agent:standing_procedencia",
  "agent:suspension_analysis",
  "agent:conventionality_pro_persona",
  "agent:constitutional_rights_mapping",
  "agent:authority_notification_validation",
  "agent:international_human_rights_analysis",
  // Constitucional (controversia constitucional / acción de
  // inconstitucionalidad) only:
  "agent:constitutional_controversy_analysis",
  // Penal specialized investigator agents:
  "agent:search_warrant_arrest_legality",
  "agent:forensic_digital_evidence_analysis",
  "agent:reasonable_doubt_defense_theory",
  "agent:sentencing_analysis",
  "agent:appeal_opportunity_detection",
  // Agrario specialized investigator agents:
  "agent:ran_record_certificate_review",
  "agent:ejido_assembly_analysis",
  "agent:communal_land_indigenous_rights",
  "agent:boundary_possession_analysis",
  "agent:agrarian_jurisdiction_restitution",
  // Civil specialized investigator agents:
  "agent:contract_analysis_ambiguity",
  "agent:liability_damages_assessment",
  "agent:payment_insurance_analysis",
  "agent:statute_of_limitations_analysis",
  "agent:settlement_opportunity_analyzer",
  // Familiar specialized investigator agents:
  "agent:custody_best_interest_analysis",
  "agent:child_support_calculation",
  "agent:domestic_violence_assessment",
  // Mercantil specialized investigator agents:
  "agent:corporate_governance_shareholder_rights",
  "agent:commercial_contract_intelligence",
  "agent:financial_fraud_commercial_risk",
  "agent:bankruptcy_concurso_review",
  // Laboral specialized investigator agents:
  "agent:lft_compliance_review",
  "agent:payroll_overtime_imss_audit",
  "agent:wrongful_termination_analysis",
  "agent:union_discrimination_review",
  // Administrativo specialized investigator agents:
  "agent:administrative_due_process_review",
  "agent:authority_competence_notification_review",
  "agent:administrative_nullity_analysis",
  // Fiscal specialized investigator agents:
  "agent:sat_audit_review",
  "agent:cfdi_accounting_tax_validation",
  "agent:prodecon_opportunity_detection",
  // Electoral specialized investigator agents:
  "agent:ine_documentation_candidate_eligibility",
  "agent:campaign_finance_review",
  "agent:vote_counting_chain_of_custody",
  "agent:political_violence_gender_parity",
  "agent:electoral_nullity_analysis",
  // Ambiental specialized investigator agents:
  "agent:mia_impact_assessment_review",
  "agent:profepa_asea_compliance_review",
  "agent:conagua_water_rights_review",
  "agent:pollution_remediation_analysis",
  "agent:protected_species_areas_review",
  // Migratorio, refugio y nacionalidad:
  "agent:immigration_eligibility_analysis",
  "agent:immigration_deadline_continuity",
  "agent:refugee_non_refoulement_analysis",
  "agent:nationality_naturalization_analysis",
  "agent:immigration_due_process_remedies",
  "agent:child_vulnerability_protection",
  // Real estate (inmobiliario) only:
  "property_verification",
  "closing_readiness_scoring",
]);

// FIX (2026-07-29): missing_evidence, procedural, and strength were absent
// from this list entirely — they existed only inside individual materia
// doctrine lists (or not at all), so isFindingAllowed() silently rejected
// every finding from the analyzer's missing-evidence, procedural-issues,
// and key-findings sub-passes for any materia that didn't happen to list
// them (mercantil, familiar, civil, ...). Only "contradiction" survived,
// since it was the one category already on this universal list. These four
// categories are structural pipeline outputs, not materia-specific legal
// doctrine — every case type must be able to persist a missing-evidence,
// procedural, or key-strength finding regardless of subject matter, the
// same way every case type can already persist a contradiction or a
// discovery_gap. Confirmed via pipeline_engine_runs.meta.evidence_gate
// audit on case a467f960-869e-4d81-88dc-3025ae63176e: the evidence gate
// itself received only 4 of 12 analyzer items (audit.input: 4), meaning
// the other 8 were dropped by this allow-list before the gate ever saw
// them — not rejected by evidence verification.
// FIX (2026-08-08): the same class of bug as the 2026-07-29 fix above, found
// via a real-case export (amparo case, 8 specialized agents produced 16
// grounded findings with verbatim evidence_refs, 0 reached case_findings —
// score.rationale.flags: ["CANONICAL_FINDINGS_EMPTY"]). The chain_of_custody
// agent (src/lib/pipeline.server.ts's AGENTS array) declares
// `category: "chain_of_custody"` (English) and is enabled to RUN via
// MX_ENGINES for penal, amparo, constitucional, and electoral — but no
// materia's MX_FINDING_MODULES list ever contained the literal string
// "chain_of_custody"; penal's list only has the Spanish "cadena_de_custodia",
// which shares no substring with the agent's actual category token. Every
// chain_of_custody finding, in every materia that runs this engine
// (including penal, its primary use case), has been silently dropped since
// this agent was added — reproducible 100% of the time, not case-specific.
// Same fix as before: promote the structural pipeline-output token to
// UNIVERSAL rather than duplicate it into 4+ materia lists.
const UNIVERSAL_FINDING_MODULES = [
  "extraction",
  "fact",
  "timeline",
  "witness",
  "evidence",
  "contradiction",
  "dispute",
  "discovery_gap",
  "missing_evidence",
  "constitutional_issue",
  // P2 (2026-08-16): the report-writer's own motion/strategy/next-action/
  // cross-examination outputs — same structural-pipeline-output reasoning as
  // the entries above (generated by the same intelShape LLM call, gated
  // upstream by the same report-generation flow, not materia-specific
  // doctrine).
  "motion_opportunity",
  "strategy_recommendation",
  "next_action",
  "cross_examination",
  "procedural",
  "strength",
  "chain_of_custody",
  "coverage",
  "scoring",
  "ess",
  "validator",
  "misc",
  // Completed-case audit only (ways_out_analysis agent, category
  // "ways_out_analysis" — type === category, same convention as most other
  // specialized agents). Added here on day one specifically because the
  // chain_of_custody bug (above) was caused by adding an agent to the RUN
  // gate without adding it here too — do not repeat that mistake for this
  // one.
  "ways_out_analysis",
];

// Source_module wrapper tokens that carry no domain information.
const MODULE_NOISE_TOKENS = new Set<string>([
  "engine",
  "engines",
  "agent",
  "agents",
  "analyzer",
  "analyzers",
  "intelligence",
  "report",
  "reports",
  // "report_writer:contradiction" etc — the report-writer intelligence-chunk
  // bridge (normalizeReportWriterFindings, Canonical Reconciliation Design
  // P0). Underscore doesn't split tokens (see the regex below), so this
  // compound wrapper needs its own entry — without it, isFindingAllowed()
  // reads "report_writer" itself as the domain signal instead of the
  // category token that follows the colon, and every report-writer-routed
  // finding is silently dropped by this gate regardless of case type.
  "report_writer",
  "general",
  "module",
  "modules",
  "source",
  "src",
  "v1",
  "v2",
]);

const UNIVERSAL_MOTION_TYPES = ["procedural", "scheduling", "in_limine"];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Strict normalization for routing decisions: an unrecognized materia is a
 * configuration error, never a silent default. Use this anywhere the outcome
 * changes what executes.
 */
export function normalizePracticeArea(v: unknown): PracticeArea {
  return requireMexicanCaseType(v, "normalizePracticeArea");
}

/**
 * Tolerant normalization for read-only rendering paths (labels, section
 * visibility, export scrubbing). Returns null when the value carries no
 * materia — callers then apply universal policy only. It never invents one.
 */
export function resolvePracticeAreaOrNull(v: unknown): PracticeArea | null {
  return normalizeMexicanCaseType(v);
}

export type AreaInput = PracticeArea | string | null | undefined;
export type DomainSet = ReadonlySet<string> | ReadonlyArray<string> | null | undefined;

function effectiveAreas(area: AreaInput, activeDomains: DomainSet): PracticeArea[] {
  const set = new Set<PracticeArea>();
  const base = resolvePracticeAreaOrNull(area);
  if (base) set.add(base);
  if (activeDomains)
    for (const d of activeDomains) {
      const n = resolvePracticeAreaOrNull(d);
      if (n) set.add(n);
    }
  return Array.from(set);
}

// -------- Sections / tabs --------

export function getApplicableSections(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_SECTIONS);
  for (const a of effectiveAreas(area, activeDomains)) for (const s of materiaSections(a)) out.add(s);
  return out;
}
export function isSectionApplicable(area: AreaInput, sectionId: string, activeDomains?: DomainSet): boolean {
  return getApplicableSections(area, activeDomains).has(sectionId);
}

export function getApplicableTabs(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_TABS);
  for (const a of effectiveAreas(area, activeDomains)) for (const t of materiaTabs(a)) out.add(t);
  return out;
}
export function isTabApplicable(area: AreaInput, tabKey: string, activeDomains?: DomainSet): boolean {
  return getApplicableTabs(area, activeDomains).has(tabKey);
}

// -------- Practice-area modules (Universal Practice Area Architecture) --------
//
// Core Platform capabilities are ALWAYS available (see CORE_CAPABILITIES).
// Specialized modules are declared per materia in mexico-modules.ts and
// resolved here. Components must call isModuleApplicable() instead of testing
// a literal materia string.

export const CORE_PLATFORM_CAPABILITIES = new Set<string>(CORE_CAPABILITIES);

export function getApplicableDashboardModules(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>();
  for (const a of effectiveAreas(area, activeDomains)) for (const m of materiaDashboardModules(a)) out.add(m);
  return out;
}

export function isModuleApplicable(area: AreaInput, moduleId: string, activeDomains?: DomainSet): boolean {
  if (CORE_PLATFORM_CAPABILITIES.has(moduleId)) return true;
  return getApplicableDashboardModules(area, activeDomains).has(moduleId);
}

export function getApplicableLifecycleStatuses(area: AreaInput): string[] {
  const a = resolvePracticeAreaOrNull(area);
  if (!a) return ["intake", "working", "waiting_on_client", "closed", "archived"];
  return [...materiaLifecycleStatuses(a)];
}

export function getApplicablePartyRoles(area: AreaInput, activeDomains?: DomainSet): string[] {
  const out = new Set<string>();
  const areas = effectiveAreas(area, activeDomains);
  if (areas.length === 0) return ["cliente", "contraparte", "co_abogado", "testigo", "perito", "otro"];
  for (const a of areas) for (const r of materiaPartyRoles(a)) out.add(r);
  return [...out];
}

export function getTaskTemplates(area: AreaInput, activeDomains?: DomainSet): MxTaskTemplate[] {
  const seen = new Map<string, MxTaskTemplate>();
  const areas = effectiveAreas(area, activeDomains);
  for (const a of areas) for (const tpl of materiaTaskTemplates(a)) seen.set(tpl.key, tpl);
  if (areas.length === 0) return [];
  return [...seen.values()];
}

export function getAiPersona(area: AreaInput): string | null {
  const a = resolvePracticeAreaOrNull(area);
  return a ? materiaAiPersona(a) : null;
}

// -------- Analyzers --------

export function getAllowedAnalyzers(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_ENGINES);
  for (const a of effectiveAreas(area, activeDomains)) for (const e of materiaEngines(a)) out.add(e);
  return out;
}
export function isAnalyzerAllowed(area: AreaInput, engineId: string, activeDomains?: DomainSet): boolean {
  if (UNIVERSAL_ENGINES.has(engineId)) return true;
  return getAllowedAnalyzers(area, activeDomains).has(engineId);
}

// -------- Finding modules (prefix-match) --------

export function getAllowedFindingModules(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_FINDING_MODULES);
  for (const a of effectiveAreas(area, activeDomains)) for (const m of materiaFindingModules(a)) out.add(m);
  return out;
}
export function isFindingAllowed(
  area: AreaInput,
  sourceModule: string | null | undefined,
  activeDomains?: DomainSet,
): boolean {
  const m = String(sourceModule ?? "").toLowerCase();
  if (!m) return true; // nothing to gate on; let downstream validators decide
  const allowed = getAllowedFindingModules(area, activeDomains);
  // Source module convention: "<wrapper>:<domain>[:<sub>]" — wrapper/sub
  // tokens are noise; everything else is the domain signal.
  const tokens = m.split(/[^a-z0-9_]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !MODULE_NOISE_TOKENS.has(t));
  if (meaningful.length === 0) return true; // pure wrapper id — let validators decide
  const domainToken = meaningful[0];

  if (allowed.has(domainToken)) return true;

  const joined = meaningful.join("_");
  for (const a of allowed) if (a.includes("_") && joined.includes(a)) return true;

  const firstWord = domainToken.split("_")[0];
  if (firstWord && firstWord !== domainToken && allowed.has(firstWord)) return true;

  return false;
}

// -------- Motion types --------

export function getAllowedMotionTypes(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_MOTION_TYPES);
  for (const a of effectiveAreas(area, activeDomains)) for (const t of materiaMotionTypes(a)) out.add(t);
  return out;
}
export function isMotionAllowed(
  area: AreaInput,
  motionType: string | null | undefined,
  activeDomains?: DomainSet,
): boolean {
  const m = String(motionType ?? "")
    .toLowerCase()
    .trim();
  if (!m) return true;
  const allowed = getAllowedMotionTypes(area, activeDomains);
  for (const a of allowed) if (m === a || m.startsWith(a) || m.includes(a)) return true;
  return false;
}

// -------- Terminology --------

export function getBlockedTerms(area: AreaInput, activeDomains?: DomainSet): string[] {
  const base = resolvePracticeAreaOrNull(area);
  if (!base) return [];
  const out = new Set<string>(materiaBlockedTerms(base));
  // Anything unlocked by an active domain is REMOVED from the blocklist.
  for (const d of effectiveAreas(area, activeDomains).filter((a) => a !== base)) {
    for (const t of materiaFindingModules(d)) out.delete(t);
    for (const t of materiaBlockedTerms(d)) out.delete(t);
  }
  return Array.from(out);
}

/** Returns the list of blocked terms that appear in `text`. */
export function findBlockedTermsIn(text: string, area: AreaInput, activeDomains?: DomainSet): string[] {
  const terms = getBlockedTerms(area, activeDomains);
  if (terms.length === 0 || !text) return [];
  const hits: string[] = [];
  const lower = String(text).toLowerCase();
  for (const t of terms) if (lower.includes(t.toLowerCase())) hits.push(t);
  return hits;
}

// -------- Scrub helpers --------

export function getForbiddenReportFields(area: AreaInput): string[] {
  const a = resolvePracticeAreaOrNull(area);
  return a ? [...materiaForbiddenReportFields(a)] : [];
}

export function scrubReportForPracticeArea<T extends Record<string, unknown>>(report: T, area: AreaInput): T {
  const fields = getForbiddenReportFields(area);
  for (const k of fields) {
    if (k in report) {
      const v = report[k];
      if (Array.isArray(v)) (report as Record<string, unknown>)[k] = [];
      else if (typeof v === "string") (report as Record<string, unknown>)[k] = "";
      else if (v && typeof v === "object") (report as Record<string, unknown>)[k] = {};
      else (report as Record<string, unknown>)[k] = null;
    }
  }
  return report;
}

export const PRACTICE_AREA_LABELS: Record<PracticeArea, string> = Object.fromEntries(
  MX_CASE_TYPES.map((t) => [t, MX_CASE_TYPE_LABELS[t].es]),
) as Record<PracticeArea, string>;

// ---------------------------------------------------------------------------
// Selection UI registries (materias mexicanas)
// ---------------------------------------------------------------------------

export interface CaseTypeSelectOption {
  value: PracticeArea;
  label: string;
}

export interface CaseTypeSelectGroup {
  group: string;
  options: CaseTypeSelectOption[];
}

// Wording audit (2026-08-16): verified against current Mexican judicial
// terminology and INEGI's national judicial classification. Every value
// below stays as the existing MX_CASE_TYPES slug (mexico-types.ts) — this
// pass only corrects the DISPLAY label/example text; it does not add, split,
// or rename any of the 13 materias themselves. See that file's own header:
// this vocabulary routes UI, DB, pipeline stages, and agents identically —
// splitting a materia (e.g. a standalone "Sucesiones" or "Propiedad
// Intelectual" category) is a deep, cross-cutting change, not a label fix,
// and is intentionally out of scope here.
export const CASE_TYPE_SELECT_GROUPS: CaseTypeSelectGroup[] = [
  {
    group: "Penal",
    options: [{ value: "penal", label: "Derecho Penal (Sistema Acusatorio, CNPP)" }],
  },
  {
    group: "Civil y Familiar",
    options: [
      { value: "civil", label: "Derecho Civil (contratos, daño moral, responsabilidad civil, arrendamiento)" },
      // "sucesiones" (testamentaria/intestamentaria) is its own body of
      // procedure, not a Familiar example — dropped in favor of real
      // Familiar-only matters.
      {
        value: "familiar",
        label: "Derecho Familiar (divorcio, guarda y custodia, alimentos, patria potestad, violencia familiar)",
      },
    ],
  },
  {
    group: "Mercantil",
    options: [
      // "propiedad intelectual" removed — IMPI/copyright/patent matters are
      // not mercantil litigation and don't belong in this example list.
      {
        value: "mercantil",
        label:
          "Derecho Mercantil (títulos de crédito, sociedades mercantiles, contratos mercantiles, concursos mercantiles)",
      },
    ],
  },
  {
    group: "Laboral",
    options: [{ value: "laboral", label: "Derecho Laboral (LFT, tribunales laborales)" }],
  },
  {
    group: "Administrativo y Fiscal",
    options: [
      {
        value: "administrativo",
        label: "Derecho Administrativo (juicio contencioso administrativo, nulidad, responsabilidad administrativa)",
      },
      { value: "fiscal", label: "Derecho Fiscal (CFF, facultades de comprobación, TFJA)" },
    ],
  },
  {
    group: "Constitucional",
    options: [
      // Reworded: the SCJN treats recurso de revisión en amparo directo as
      // an extraordinary remedy, not a third TYPE of amparo alongside
      // directo/indirecto — the prior wording read as if it were.
      {
        value: "amparo",
        label:
          "Juicio de Amparo (directo e indirecto; el recurso de revisión en amparo directo ante la SCJN es un medio extraordinario, no un tercer tipo de amparo)",
      },
      {
        value: "constitucional",
        label:
          "Derecho Constitucional y Derechos Humanos (controversias constitucionales, acciones de inconstitucionalidad — NO amparo, aun cuando el amparo plantee cuestiones constitucionales)",
      },
    ],
  },
  {
    group: "Materias especializadas",
    options: [
      { value: "electoral", label: "Derecho Electoral (medios de impugnación, TEPJF)" },
      // Avoid hard-coding a specific tribunal name (agrarian judicial
      // structure has changed before) — describe the subject matter instead.
      { value: "agrario", label: "Derecho Agrario (núcleos agrarios, ejidos, comunidades, tierras ejidales)" },
      { value: "ambiental", label: "Derecho Ambiental (LGEEPA, PROFEPA, impacto ambiental)" },
    ],
  },
  {
    group: "Migratorio, Refugio y Nacionalidad",
    options: [
      {
        value: "migratorio",
        label:
          "Derecho Migratorio, Refugio y Nacionalidad (INM, SRE, COMAR, TFJA y amparo federal)",
      },
    ],
  },
  {
    // "Bienes Raíces" is a commercial term; "Derecho Inmobiliario" is the
    // correct legal classification — the internal slug already agreed.
    group: "Derecho Inmobiliario",
    options: [
      {
        value: "inmobiliario",
        label:
          "Derecho Inmobiliario (compraventa, arrendamiento, propiedad, condominios, registro público — transaccional, no litigio)",
      },
    ],
  },
];

/** Flat list — convenient for plain (non-grouped) <select> pickers. */
export const CASE_TYPE_SELECT_OPTIONS: CaseTypeSelectOption[] = CASE_TYPE_SELECT_GROUPS.flatMap((g) => g.options);

/** Canonical reason string written to `pipeline_engine_runs.skipped_reason`. */
export const SKIP_REASON_NOT_APPLICABLE = "not_applicable_to_case_type";

// ---------------------------------------------------------------------------
// Case-Type Manifest — routing snapshot recorded before a run starts.
// ---------------------------------------------------------------------------

export interface CaseTypeManifest {
  case_type: PracticeArea;
  case_type_label: string;
  enabled_engines: string[];
  skipped_engines: string[];
  cross_domain_engines: string[];
  active_domains: string[];
  enabled_sections: string[];
  enabled_tabs: string[];
  allowed_motion_types: string[];
  /** Governing-law framework for this materia — see execution-profile.ts.
   *  Deliberately excludes case-law citations; see that module's header. */
  execution_profile: ExecutionProfile;
  generated_at: string;
}

const ALL_PRACTICE_ENGINES = new Set<string>(MX_CASE_TYPES.flatMap((t) => [...materiaEngines(t)]));

export function buildCaseTypeManifest(area: AreaInput, activeDomains?: DomainSet): CaseTypeManifest {
  const base = normalizePracticeArea(area);
  const domains = new Set<string>();
  if (activeDomains)
    for (const d of activeDomains) {
      const n = resolvePracticeAreaOrNull(d);
      if (n && n !== base) domains.add(n);
    }
  const allowed = getAllowedAnalyzers(base, domains);
  const enabled: string[] = [];
  const skipped: string[] = [];
  const cross: string[] = [];
  const basePolicy = new Set<string>([...UNIVERSAL_ENGINES, ...materiaEngines(base)]);
  for (const e of UNIVERSAL_ENGINES) enabled.push(e);
  for (const e of ALL_PRACTICE_ENGINES) {
    if (basePolicy.has(e)) enabled.push(e);
    else if (allowed.has(e)) cross.push(e);
    else skipped.push(e);
  }
  return {
    case_type: base,
    case_type_label: PRACTICE_AREA_LABELS[base],
    enabled_engines: Array.from(new Set(enabled)).sort(),
    skipped_engines: skipped.sort(),
    cross_domain_engines: cross.sort(),
    active_domains: Array.from(domains).sort(),
    enabled_sections: Array.from(getApplicableSections(base, domains)).sort(),
    enabled_tabs: Array.from(getApplicableTabs(base, domains)).sort(),
    allowed_motion_types: Array.from(getAllowedMotionTypes(base, domains)).sort(),
    execution_profile: executionProfileFor(base),
    generated_at: new Date().toISOString(),
  };
}
