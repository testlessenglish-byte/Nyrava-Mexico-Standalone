// Central finding-classification validation — Phase 1 item #2 of the
// approved "Universal Completed Case Legal Audit Architecture Fix" plan.
// PURE MODULE (no I/O, no AI).
//
// WHY: findings.server.ts trusts whatever proposition_type/speaker_role/
// category an upstream engine attaches to a finding. The judicial-hierarchy
// prompt instructions (finding-taxonomy.ts) already teach the model the
// difference between a party's ARGUMENT and a court's HOLDING, but a prompt
// instruction is not an invariant — an LLM can still emit a structurally
// impossible pairing (e.g. proposition_type "holding" attributed to
// speaker_role "quejoso", which would misrepresent a party's request as a
// judicial ruling). This module makes the invariant a code-level gate: an
// impossible pairing is downgraded to a safe classification, never trusted
// blindly and never silently dropped.
//
// Only `validateFindingClassification` (the speaker_role/proposition_type
// consistency check) is currently wired into the live write path
// (findings.server.ts's addFindings). `validateFindingCategory` (materia
// compatibility) is exported and tested but deliberately NOT wired into the
// live path yet — see the doc comment on that function for why.

import type { NewFinding } from "./types";
import type { PropositionType, SpeakerRole } from "./finding-taxonomy";
import { getAllowedFindingModules, type AreaInput, type DomainSet } from "./practice-areas";

/** Only a court can issue a holding — a party's own submission is always an
 *  argument until/unless a court adopts it. */
const JUDICIAL_SPEAKER_ROLES: ReadonlySet<SpeakerRole> = new Set([
  "tribunal_colegiado",
  "tribunal_local",
  "scjn",
]);

export type ClassificationDowngrade = {
  field: "proposition_type" | "category";
  from: string;
  to: string;
  reason: string;
};

export type ClassificationGateResult<T extends NewFinding = NewFinding> = {
  finding: T;
  downgrades: ClassificationDowngrade[];
};

/**
 * Enforce the judicial-hierarchy invariant: `proposition_type` of "holding"
 * or "rejected_holding" requires a judicial `speaker_role` (a court is the
 * only actor that can hold or reject-hold something). When an upstream
 * engine pairs a holding-type proposition with a non-judicial speaker_role
 * (a party's own submission), the proposition_type is downgraded to
 * "argument" — the finding itself, its evidence, and its speaker_role are
 * never touched or dropped, only the unsafe classification. A finding with
 * no proposition_type/speaker_role set (the overwhelming majority today)
 * passes through with zero downgrades.
 */
export function validateFindingClassification<T extends NewFinding>(
  finding: T,
): ClassificationGateResult<T> {
  const propositionType = finding.proposition_type as PropositionType | null | undefined;
  const speakerRole = finding.speaker_role as SpeakerRole | null | undefined;

  if (
    (propositionType === "holding" || propositionType === "rejected_holding") &&
    speakerRole &&
    !JUDICIAL_SPEAKER_ROLES.has(speakerRole)
  ) {
    return {
      finding: { ...finding, proposition_type: "argument" },
      downgrades: [
        {
          field: "proposition_type",
          from: propositionType,
          to: "argument",
          reason: `speaker_role "${speakerRole}" is a party/authority position, not a court — a ${propositionType} cannot be attributed to it`,
        },
      ],
    };
  }

  return { finding, downgrades: [] };
}

/**
 * Validate a finding's `category` against the case's materia-allowed finding
 * vocabulary (the same registry `isFindingAllowed`/`getAllowedFindingModules`
 * already use to gate `source_module` at write time). When incompatible, the
 * category is downgraded to `fallbackCategory` — the finding still reaches
 * the case, only under a category that will not corrupt materia-specific
 * report groupings.
 *
 * NOT YET WIRED into the live write path. Every finding's `category` today
 * is a hardcoded value declared once per engine (see the AGENTS array /
 * analyzer bucket definitions in pipeline.server.ts) — no LLM currently
 * self-reports `category`, so this exact failure mode cannot fire yet in
 * production. Wiring this into addFindings would mean re-checking all ~50
 * engine categories against all ~15 materias' allow-lists on every write,
 * which needs its own materia-by-materia regression pass before it can run
 * against active cases (a compatibility-matching gap here would silently
 * rewrite a legitimate category on a real case). Exported and tested now so
 * that gap-closing work — and any future engine that lets the LLM self-
 * report category — has a validator ready to wire in.
 */
export function validateFindingCategory<T extends NewFinding>(
  finding: T,
  area: AreaInput,
  fallbackCategory: string,
  activeDomains?: DomainSet,
): ClassificationGateResult<T> {
  const category = String(finding.category ?? "").toLowerCase();
  if (!category) return { finding, downgrades: [] };

  const allowed = getAllowedFindingModules(area, activeDomains);
  const compatible =
    allowed.has(category) ||
    Array.from(allowed).some((a) => a.includes("_") && category.includes(a));
  if (compatible) return { finding, downgrades: [] };

  return {
    finding: { ...finding, category: fallbackCategory },
    downgrades: [
      {
        field: "category",
        from: category,
        to: fallbackCategory,
        reason: `category "${category}" is not part of the allowed finding vocabulary for this case's materia`,
      },
    ],
  };
}
