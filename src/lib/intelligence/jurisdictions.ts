// Attorney-facing JURISDICTION list (fuero / judicial classification) — NOT a
// geographic label.
//
// A jurisdiction here answers "which court system and which body of law frames
// this matter?", not "where in the country does it happen?". The three legal
// levels in Mexico are:
//
//   · federal   — Juzgados de Distrito, Tribunales Colegiados/Unitarios de
//                 Circuito, SCJN, TFJA, TEPJF, Tribunales Agrarios. Governed by
//                 the CPEUM, Ley de Amparo, LOPJF and federal codes. Applies
//                 nationwide by nature; it is NOT "no state filter".
//   · state     — fuero común: Tribunal Superior de Justicia of an entidad
//                 federativa and that state's codes. Ciudad de México is a
//                 state-level (local) jurisdiction, not a federal one.
//   · municipal — ayuntamiento / autoridades municipales (juez cívico,
//                 desarrollo urbano, catastro, bandos de policía y gobierno).
//
// Geographic scope (national / regional / local reach of the matter's effects)
// is a SEPARATE dimension — see GEOGRAPHIC_SCOPE_OPTIONS below. A federal
// matter can be local in reach, and a state matter can have national effects.
//
// NOTE (Phase 6/7 — research pipeline & citation engine): USA's version of
// this file mapped each value to CourtListener court IDs for live case-law
// lookup. There is no equivalent public API for Mexican jurisprudencia/
// tesis, so courtIdsForJurisdiction() below is currently a safe no-op.
// Federal routing is instead enforced through jurisdictionLevelOf() +
// buildJurisdictionProfile() + the federal precedent filter in
// intelligence/case-law.server.ts.

export type JurisdictionLevel = "federal" | "state" | "municipal";

export type JurisdictionOption = { value: string; label: string; level: JurisdictionLevel };

/** The one true federal jurisdiction value stored on cases.jurisdiction. */
export const FEDERAL_JURISDICTION = "federal";
/** Municipal (ayuntamiento) jurisdiction value. */
export const MUNICIPAL_JURISDICTION = "municipal";

export const FEDERAL_OPTION: JurisdictionOption = {
  value: FEDERAL_JURISDICTION,
  label: "Federal (México)",
  level: "federal",
};

export const MUNICIPAL_OPTION: JurisdictionOption = {
  value: MUNICIPAL_JURISDICTION,
  label: "Municipal (autoridad municipal)",
  level: "municipal",
};

/** Entidades federativas — fuero común (local). */
export const STATE_JURISDICTION_OPTIONS: JurisdictionOption[] = [
  { value: "AGU", label: "Aguascalientes", level: "state" },
  { value: "BCN", label: "Baja California", level: "state" },
  { value: "BCS", label: "Baja California Sur", level: "state" },
  { value: "CAM", label: "Campeche", level: "state" },
  { value: "CHP", label: "Chiapas", level: "state" },
  { value: "CHH", label: "Chihuahua", level: "state" },
  { value: "CMX", label: "Ciudad de México (Local)", level: "state" },
  { value: "COA", label: "Coahuila", level: "state" },
  { value: "COL", label: "Colima", level: "state" },
  { value: "DUR", label: "Durango", level: "state" },
  { value: "GUA", label: "Guanajuato", level: "state" },
  { value: "GRO", label: "Guerrero", level: "state" },
  { value: "HID", label: "Hidalgo", level: "state" },
  { value: "JAL", label: "Jalisco", level: "state" },
  { value: "MEX", label: "Estado de México", level: "state" },
  { value: "MIC", label: "Michoacán", level: "state" },
  { value: "MOR", label: "Morelos", level: "state" },
  { value: "NAY", label: "Nayarit", level: "state" },
  { value: "NLE", label: "Nuevo León", level: "state" },
  { value: "OAX", label: "Oaxaca", level: "state" },
  { value: "PUE", label: "Puebla", level: "state" },
  { value: "QUE", label: "Querétaro", level: "state" },
  { value: "ROO", label: "Quintana Roo", level: "state" },
  { value: "SLP", label: "San Luis Potosí", level: "state" },
  { value: "SIN", label: "Sinaloa", level: "state" },
  { value: "SON", label: "Sonora", level: "state" },
  { value: "TAB", label: "Tabasco", level: "state" },
  { value: "TAM", label: "Tamaulipas", level: "state" },
  { value: "TLA", label: "Tlaxcala", level: "state" },
  { value: "VER", label: "Veracruz", level: "state" },
  { value: "YUC", label: "Yucatán", level: "state" },
  { value: "ZAC", label: "Zacatecas", level: "state" },
];

export const JURISDICTION_OPTIONS: JurisdictionOption[] = [
  FEDERAL_OPTION,
  ...STATE_JURISDICTION_OPTIONS,
  MUNICIPAL_OPTION,
];

export const JURISDICTION_VALUES = JURISDICTION_OPTIONS.map((o) => o.value) as [string, ...string[]];

/** Grouped for <optgroup> rendering. Order matters: federal first. */
export const JURISDICTION_GROUPS: { level: JurisdictionLevel; label: string; options: JurisdictionOption[] }[] = [
  { level: "federal", label: "Jurisdicción federal", options: [FEDERAL_OPTION] },
  { level: "state", label: "Jurisdicción local (entidad federativa)", options: STATE_JURISDICTION_OPTIONS },
  { level: "municipal", label: "Jurisdicción municipal", options: [MUNICIPAL_OPTION] },
];

/**
 * Geographic scope — deliberately distinct from jurisdiction. Describes the
 * territorial reach of the matter's effects, never the competent court system.
 */
export const GEOGRAPHIC_SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "nacional", label: "Nacional (efectos en todo el país)" },
  { value: "regional", label: "Regional (varias entidades o un circuito)" },
  { value: "estatal", label: "Estatal (una entidad federativa)" },
  { value: "local", label: "Local / municipal" },
];

const LEVEL_BY_VALUE = new Map<string, JurisdictionLevel>(JURISDICTION_OPTIONS.map((o) => [o.value, o.level]));

function normalize(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Level for a stored cases.jurisdiction value. Accepts the canonical codes and
 * the free-text legacy values that older/seeded cases carry ("Federal",
 * "Ciudad de México", "Estado de Chiapas"…). Returns null when unresolved —
 * callers must treat null as "not declared", never as federal.
 */
export function jurisdictionLevelOf(value: string | null | undefined): JurisdictionLevel | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const exact = LEVEL_BY_VALUE.get(raw);
  if (exact) return exact;
  const n = normalize(raw);
  if (!n) return null;
  if (n === "federal" || n.startsWith("federal") || n.includes("fuero federal") || n.includes("competencia federal")) {
    return "federal";
  }
  if (n.startsWith("municipal") || n.includes("ayuntamiento")) return "municipal";
  const byLabel = STATE_JURISDICTION_OPTIONS.find(
    (o) => normalize(o.label) === n || normalize(o.value) === n || n.includes(normalize(o.label.replace(/\s*\(Local\)$/, ""))),
  );
  return byLabel ? "state" : null;
}

/** True when the matter must be routed through the federal legal channel. */
export function isFederalJurisdiction(value: string | null | undefined): boolean {
  return jurisdictionLevelOf(value) === "federal";
}

/** Human label for a stored jurisdiction value (falls back to the raw text). */
export function jurisdictionLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return JURISDICTION_OPTIONS.find((o) => o.value === raw)?.label ?? raw;
}

/**
 * Resolve an attorney-selected jurisdiction to court IDs for live case-law
 * filtering. Always undefined for now — see the Phase 6/7 note above.
 * Callers already treat undefined as "no court filter" (search unfiltered),
 * so this degrades safely rather than breaking anything.
 */
export function courtIdsForJurisdiction(jurisdiction: string | null | undefined): string[] | undefined {
  void jurisdiction;
  return undefined;
}
