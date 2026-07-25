// Attorney-facing jurisdiction list — Mexican federal entities (31 states
// + Ciudad de México) plus "federal" for federal-competence matters.
//
// This is intentionally the *entity's* jurisdiction, not the case type — a
// Jalisco family case and a Jalisco criminal case both scope to the same
// Jalisco courts/codes. "Federal" covers matters of federal competence
// (amparo against federal authorities, federal crimes under the CPF,
// labor under the LFT, etc.) rather than any single state.
//
// NOTE (Phase 6/7 — research pipeline & citation engine): USA's version of
// this file mapped each value to CourtListener court IDs for live case-law
// lookup. There is no equivalent public API for Mexican jurisprudencia/
// tesis (SCJN's own search tools aren't a REST API), so
// courtIdsForJurisdiction() below is currently a safe no-op — it always
// returns undefined, which callers already treat as "no court filter."
// Wiring this to a real Mexican source (SCJN, DOF, state judicial sites)
// is separate, larger work — see legal_source_connectors in the DB schema,
// currently seeded with scjn/dof/tfja as "planned".

export type JurisdictionOption = { value: string; label: string };

export const JURISDICTION_OPTIONS: JurisdictionOption[] = [
  { value: "federal", label: "Federal (competencia federal)" },
  { value: "AGU", label: "Aguascalientes" },
  { value: "BCN", label: "Baja California" },
  { value: "BCS", label: "Baja California Sur" },
  { value: "CAM", label: "Campeche" },
  { value: "CHP", label: "Chiapas" },
  { value: "CHH", label: "Chihuahua" },
  { value: "CMX", label: "Ciudad de México" },
  { value: "COA", label: "Coahuila" },
  { value: "COL", label: "Colima" },
  { value: "DUR", label: "Durango" },
  { value: "GUA", label: "Guanajuato" },
  { value: "GRO", label: "Guerrero" },
  { value: "HID", label: "Hidalgo" },
  { value: "JAL", label: "Jalisco" },
  { value: "MEX", label: "Estado de México" },
  { value: "MIC", label: "Michoacán" },
  { value: "MOR", label: "Morelos" },
  { value: "NAY", label: "Nayarit" },
  { value: "NLE", label: "Nuevo León" },
  { value: "OAX", label: "Oaxaca" },
  { value: "PUE", label: "Puebla" },
  { value: "QUE", label: "Querétaro" },
  { value: "ROO", label: "Quintana Roo" },
  { value: "SLP", label: "San Luis Potosí" },
  { value: "SIN", label: "Sinaloa" },
  { value: "SON", label: "Sonora" },
  { value: "TAB", label: "Tabasco" },
  { value: "TAM", label: "Tamaulipas" },
  { value: "TLA", label: "Tlaxcala" },
  { value: "VER", label: "Veracruz" },
  { value: "YUC", label: "Yucatán" },
  { value: "ZAC", label: "Zacatecas" },
];

export const JURISDICTION_VALUES = JURISDICTION_OPTIONS.map((o) => o.value) as [string, ...string[]];

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
