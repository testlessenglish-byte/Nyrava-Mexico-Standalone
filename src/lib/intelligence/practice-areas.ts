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
  "chain_of_custody",
  "procedural_violations",
  "trial_prep",
  "cross_examination",
  // Real estate (inmobiliario) only:
  "property_verification",
  "closing_readiness_scoring",
]);

const UNIVERSAL_FINDING_MODULES = [
  "extraction",
  "fact",
  "timeline",
  "witness",
  "evidence",
  "contradiction",
  "dispute",
  "discovery_gap",
  "coverage",
  "scoring",
  "ess",
  "validator",
  "misc",
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

type AreaInput = PracticeArea | string | null | undefined;
type DomainSet = ReadonlySet<string> | ReadonlyArray<string> | null | undefined;

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

export const CASE_TYPE_SELECT_GROUPS: CaseTypeSelectGroup[] = [
  {
    group: "Penal",
    options: [{ value: "penal", label: "Derecho Penal (sistema acusatorio, CNPP)" }],
  },
  {
    group: "Civil y Familiar",
    options: [
      { value: "civil", label: "Derecho Civil (contratos, daño moral, responsabilidad civil, arrendamiento)" },
      { value: "familiar", label: "Derecho Familiar (divorcio, custodia, alimentos, sucesiones)" },
    ],
  },
  {
    group: "Mercantil",
    options: [
      { value: "mercantil", label: "Derecho Mercantil (títulos de crédito, societario, concursos, propiedad intelectual)" },
    ],
  },
  {
    group: "Laboral",
    options: [{ value: "laboral", label: "Derecho Laboral (LFT, tribunales laborales)" }],
  },
  {
    group: "Administrativo y Fiscal",
    options: [
      { value: "administrativo", label: "Derecho Administrativo (juicio de nulidad, responsabilidades)" },
      { value: "fiscal", label: "Derecho Fiscal (CFF, facultades de comprobación, TFJA)" },
    ],
  },
  {
    group: "Constitucional",
    options: [
      { value: "amparo", label: "Juicio de Amparo (directo e indirecto)" },
      { value: "constitucional", label: "Constitucional / Derechos Humanos (controversias, acciones, control de convencionalidad)" },
    ],
  },
  {
    group: "Materias especializadas",
    options: [
      { value: "electoral", label: "Derecho Electoral (medios de impugnación, TEPJF)" },
      { value: "agrario", label: "Derecho Agrario (tribunales unitarios agrarios)" },
      { value: "ambiental", label: "Derecho Ambiental (LGEEPA, PROFEPA, impacto ambiental)" },
    ],
  },
  {
    group: "Bienes Raíces",
    options: [
      {
        value: "inmobiliario",
        label: "Bienes Raíces (compraventa, cierre, due diligence de título — transaccional, no litigio)",
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
    generated_at: new Date().toISOString(),
  };
}
