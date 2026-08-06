// =============================================================================
// TEMPORAL VALIDITY OF LEGAL AUTHORITY (NYRAVA México) — deterministic.
//
// Answers exactly two questions, with no reasoning about the merits:
//   1. Was this authority in force on the relevant date?
//   2. Which authorities apply to a given legal act, jurisdiction and date?
//
// Rules:
//   · Never apply expired (or not-yet-in-force) authority.
//   · Never reject evidence because authority metadata is missing — mark
//     uncertainty instead.
//   · Never throw. Report generation must not depend on this layer succeeding.
// =============================================================================

import {
  FEDERAL_ONLY_MATERIAS,
  getAuthorities,
  getAuthority,
  UNIVERSAL_AUTHORITY_IDS,
  type JurisdictionLevel,
  type LegalAuthority,
} from "./authority-registry";
import type { LegalContext } from "./jurisdiction-resolver";

export type AuthorityValidity = {
  authority_id: string;
  valid: boolean;
  reason: "in_force" | "expired" | "not_yet_in_force" | "unknown_date" | "unknown_authority";
};

export type ApplicableAuthorityResult = {
  /** Authorities in force for the act at the given date and jurisdiction. */
  authorities: LegalAuthority[];
  /** Authorities excluded because they were not in force on that date. */
  excluded: AuthorityValidity[];
  /** Non-fatal uncertainty notes (missing metadata, unresolved jurisdiction). */
  uncertainty: string[];
  validity_checked: boolean;
};

function toTime(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : t;
}

/**
 * True when the authority was in force on `caseDate`. A missing or
 * unparseable case date is treated as "cannot verify" → the authority is kept
 * (uncertainty, not exclusion).
 */
export function isAuthorityValid(
  authority: LegalAuthority | string | null | undefined,
  caseDate?: string | Date | null,
): boolean {
  return authorityValidity(authority, caseDate).valid;
}

export function authorityValidity(
  authority: LegalAuthority | string | null | undefined,
  caseDate?: string | Date | null,
): AuthorityValidity {
  const a = typeof authority === "string" ? getAuthority(authority) : (authority ?? undefined);
  if (!a) {
    return {
      authority_id: typeof authority === "string" ? authority : "desconocida",
      valid: false,
      reason: "unknown_authority",
    };
  }
  const at = caseDate instanceof Date ? caseDate.getTime() : toTime(caseDate);
  if (at == null) return { authority_id: a.id, valid: true, reason: "unknown_date" };

  const from = toTime(a.effective_from);
  const until = toTime(a.effective_until ?? null);
  if (from != null && at < from) {
    return { authority_id: a.id, valid: false, reason: "not_yet_in_force" };
  }
  if (until != null && at > until) {
    return { authority_id: a.id, valid: false, reason: "expired" };
  }
  return { authority_id: a.id, valid: true, reason: "in_force" };
}

type JurisdictionInput = LegalContext | JurisdictionLevel | null | undefined;

function contextOf(j: JurisdictionInput, materia: string): LegalContext {
  if (j && typeof j === "object") return j;
  return {
    materia,
    jurisdiction_level: (typeof j === "string" ? j : "federal") as JurisdictionLevel,
    applicable_authorities: [...UNIVERSAL_AUTHORITY_IDS],
    confidence: typeof j === "string" ? 0.5 : 0,
  };
}

/** Candidate authority ids declared for a legal act (or an id list). */
export type LegalActLike =
  | { act?: string; authorities?: ReadonlyArray<{ authority_id: string; relevance_weight?: number }> }
  | readonly string[]
  | string
  | null
  | undefined;

function actAuthorityIds(legalAct: LegalActLike): string[] {
  if (!legalAct) return [];
  if (typeof legalAct === "string") return [];
  if (Array.isArray(legalAct)) return [...(legalAct as readonly string[])];
  const refs = (legalAct as { authorities?: ReadonlyArray<{ authority_id: string }> }).authorities;
  return refs ? refs.map((r) => r.authority_id) : [];
}

/**
 * Resolves the authorities applicable to a legal act, under a jurisdiction, at
 * a point in time. Hierarchy rule: state instruments displace their federal
 * counterparts ONLY when the matter is not federal-exclusive and the resolved
 * jurisdiction is state/municipal. Federal matters always stay federal.
 */
export function getApplicableAuthority(
  legalAct: LegalActLike,
  jurisdiction: JurisdictionInput,
  date?: string | Date | null,
): ApplicableAuthorityResult {
  const uncertainty: string[] = [];
  const excluded: AuthorityValidity[] = [];
  try {
    const ctx = contextOf(jurisdiction, "general");
    const federalOnly = FEDERAL_ONLY_MATERIAS.includes(ctx.materia);

    const ids = new Set<string>([...ctx.applicable_authorities, ...actAuthorityIds(legalAct)]);
    for (const id of UNIVERSAL_AUTHORITY_IDS) ids.add(id);

    let candidates = getAuthorities([...ids]);
    if (candidates.length !== ids.size) {
      uncertainty.push(
        "Uno o más instrumentos referidos no están declarados en el registro de autoridad; se omiten sin afectar la valoración de la evidencia.",
      );
    }
    if (!candidates.length) {
      uncertainty.push(
        "No se identificó fundamento normativo declarado para este hecho jurídico; la evidencia conserva su valor probatorio.",
      );
    }

    // Jurisdictional filter — never fails, only narrows.
    if (federalOnly || ctx.jurisdiction_level === "federal") {
      const federal = candidates.filter((a) => a.jurisdiction === "federal");
      if (federal.length) candidates = federal;
    } else if (ctx.jurisdiction_level === "state") {
      if (!ctx.state) {
        uncertainty.push(
          "No fue posible determinar la entidad federativa; se aplica el marco federal supletorio y debe confirmarse la legislación local.",
        );
      }
      candidates = candidates.filter((a) => a.jurisdiction !== "municipal");
    }

    const hasDate = date != null && String(date).trim() !== "";
    const valid: LegalAuthority[] = [];
    for (const a of candidates) {
      const v = authorityValidity(a, date ?? null);
      if (v.valid) valid.push(a);
      else excluded.push(v);
    }
    if (!hasDate) {
      uncertainty.push(
        "No consta fecha de referencia verificable; la vigencia de los ordenamientos citados no pudo confirmarse.",
      );
    }

    valid.sort((a, b) => b.authority_weight - a.authority_weight || a.id.localeCompare(b.id));
    return { authorities: valid, excluded, uncertainty, validity_checked: hasDate };
  } catch {
    return {
      authorities: [],
      excluded,
      uncertainty: [
        "No fue posible verificar el marco normativo aplicable; el análisis probatorio se mantiene sin cambio.",
      ],
      validity_checked: false,
    };
  }
}
