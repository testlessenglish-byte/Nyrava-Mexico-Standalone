// =============================================================================
// JURISDICTION RESOLVER (NYRAVA México) — deterministic, data-driven.
//
// Determines the applicable legal context (level of jurisdiction, entidad
// federativa and the set of authorities that frame the matter) from whatever
// signals the case actually carries: materia, court/entity, state,
// municipality, document metadata and case location.
//
// Guarantees:
//   · Pure and deterministic — same input, same output. No AI, no I/O.
//   · Unknown jurisdiction degrades gracefully to the universal (federal
//     constitutional) frame with a lowered confidence score.
//   · NEVER throws. Report generation must never fail because jurisdiction
//     could not be resolved.
// =============================================================================

import {
  FEDERAL_ONLY_MATERIAS,
  MATERIA_AUTHORITY_IDS,
  UNIVERSAL_AUTHORITY_IDS,
  type JurisdictionLevel,
} from "./authority-registry";

export type LegalContext = {
  materia: string;
  jurisdiction_level: JurisdictionLevel;
  state?: string;
  applicable_authorities: string[];
  confidence: number;
};

export type JurisdictionSignals = {
  materia?: string | null;
  /** Court, tribunal or authority that issued/received the documents. */
  court?: string | null;
  entity?: string | null;
  state?: string | null;
  municipality?: string | null;
  /** Free-form metadata harvested from documents (values are scanned). */
  documentMetadata?: Record<string, unknown> | null;
  /** Free-text case location / jurisdiction field. */
  caseLocation?: string | null;
};

// ---------------------------------------------------------------------------

const MX_STATE_NAMES: readonly string[] = [
  "Aguascalientes",
  "Baja California Sur",
  "Baja California",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
];

const STATE_ALIASES: Record<string, string> = {
  cdmx: "Ciudad de México",
  "distrito federal": "Ciudad de México",
  edomex: "Estado de México",
  "estado de mexico": "Estado de México",
  toluca: "Estado de México",
  monterrey: "Nuevo León",
  guadalajara: "Jalisco",
  merida: "Yucatán",
  cancun: "Quintana Roo",
  tijuana: "Baja California",
  puebla: "Puebla",
};

function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normMateria(v?: string | null): string {
  return norm(v)
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z_]/g, "");
}

const FEDERAL_COURT_RE =
  /juzgado de distrito|tribunal colegiado|tribunal unitario|suprema corte|scjn|consejo de la judicatura federal|fiscalia general de la republica|\bfgr\b|\btfja\b|\btepjf\b|tribunal agrario|junta federal|centro federal de conciliacion|profeco|impi|instituto nacional de migracion|\binm\b|\bsat\b|semarnat|profepa|autoridad federal|fuero federal/;

const STATE_COURT_RE =
  /tribunal superior de justicia|juzgado de primera instancia|juzgado (?:civil|familiar|penal|mercantil) del estado|fiscalia general del estado|fuero comun|poder judicial del estado|tribunal estatal|sala regional del estado|registro publico de la propiedad/;

const MUNICIPAL_RE =
  /ayuntamiento|presidencia municipal|municipio de|direccion de desarrollo urbano|juez civico|bando de policia|catastro municipal|licencia de construccion municipal/;

function haystack(sig: JurisdictionSignals): string {
  const parts: string[] = [
    sig.court ?? "",
    sig.entity ?? "",
    sig.state ?? "",
    sig.municipality ?? "",
    sig.caseLocation ?? "",
  ];
  const meta = sig.documentMetadata;
  if (meta && typeof meta === "object") {
    for (const v of Object.values(meta)) {
      if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    }
  }
  return norm(parts.join(" | "));
}

/** Resolves the entidad federativa from any textual signal, or null. */
export function resolveState(sig: JurisdictionSignals): string | null {
  const explicit = String(sig.state ?? "").trim();
  if (explicit) {
    const hit = MX_STATE_NAMES.find((s) => norm(s) === norm(explicit));
    if (hit) return hit;
    const alias = STATE_ALIASES[norm(explicit)];
    if (alias) return alias;
  }
  const hay = haystack(sig);
  if (!hay) return null;
  let best: { name: string; at: number } | null = null;
  for (const name of MX_STATE_NAMES) {
    const at = hay.indexOf(norm(name));
    if (at >= 0 && (!best || at < best.at)) best = { name, at };
  }
  for (const [alias, name] of Object.entries(STATE_ALIASES)) {
    const at = hay.indexOf(norm(alias));
    if (at >= 0 && (!best || at < best.at)) best = { name, at };
  }
  return best?.name ?? null;
}

/**
 * Resolves the applicable legal context. Never throws; unknown signals fall
 * back to the federal constitutional frame with low confidence.
 */
export function resolveLegalContext(sig: JurisdictionSignals = {}): LegalContext {
  try {
    const materia = normMateria(sig.materia) || "general";
    const hay = haystack(sig);
    const state = resolveState(sig);

    const federalOnly = FEDERAL_ONLY_MATERIAS.includes(materia);
    const federalSignal = FEDERAL_COURT_RE.test(hay);
    const stateSignal = STATE_COURT_RE.test(hay);
    const municipalSignal = MUNICIPAL_RE.test(hay) || Boolean(String(sig.municipality ?? "").trim());

    let level: JurisdictionLevel;
    let confidence: number;

    if (federalOnly) {
      level = "federal";
      confidence = federalSignal ? 0.95 : 0.8;
    } else if (municipalSignal && !federalSignal) {
      level = "municipal";
      confidence = 0.7;
    } else if (federalSignal && !stateSignal) {
      level = "federal";
      confidence = 0.9;
    } else if (stateSignal || state) {
      level = "state";
      confidence = stateSignal && state ? 0.9 : stateSignal ? 0.75 : 0.6;
    } else {
      // Graceful fallback: universal (federal constitutional) frame.
      level = "federal";
      confidence = 0.3;
    }

    const ids = new Set<string>(UNIVERSAL_AUTHORITY_IDS);
    for (const id of MATERIA_AUTHORITY_IDS[materia] ?? []) ids.add(id);

    const ctx: LegalContext = {
      materia,
      jurisdiction_level: level,
      applicable_authorities: [...ids],
      confidence: Math.round(confidence * 100) / 100,
    };
    if (state && level !== "federal") ctx.state = state;
    else if (state && !federalOnly) ctx.state = state;
    return ctx;
  } catch {
    return {
      materia: normMateria(sig?.materia) || "general",
      jurisdiction_level: "federal",
      applicable_authorities: [...UNIVERSAL_AUTHORITY_IDS],
      confidence: 0,
    };
  }
}
