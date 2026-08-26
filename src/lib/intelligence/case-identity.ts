// The single authoritative shape for "what materia/proceeding/jurisdiction
// is this case" that every legal-reasoning consumer must use. Replaces
// direct reads of cases.case_type in every Tier 1 call site (see the fix
// instructions doc). NEVER silently defaults to a guessed case type — a
// consumer that cannot get a verified identity must see status !== "verified"
// and react explicitly (block the stage or mark output unverified).

import type { MxCaseType } from "@/lib/mx-case-classifier";

export type CaseIdentityStatus =
  | "verified" // source-confirmed by grounded evidence, no conflict
  | "attorney_locked" // attorney manually set it; treated as authoritative
  | "conflict" // attorney lock disagrees with source-confirmed evidence
  | "unverified" // no CONFIRMED evidence yet, using declared/legacy value
  | "failed"; // resolution itself errored (DB error, etc.)

export type CaseIdentityEvidence = {
  document_id: string;
  filename: string;
  page: number;
  quote: string;
};

export type VerifiedCaseIdentity = {
  caseId: string;
  caseType: MxCaseType | null;
  proceedingType: string | null;
  proceduralVehicle: string | null;
  underlyingMateria: MxCaseType | null;
  jurisdiction: string | null;
  status: CaseIdentityStatus;
  confidence: number | null;
  source: "attorney" | "source_confirmed" | "declared" | "default" | "error";
  evidence: CaseIdentityEvidence | null;
  /** Populated only when status === "conflict". */
  conflict: { attorneyValue: string; sourceValue: string; sourceEvidence: CaseIdentityEvidence } | null;
};

/** Legal-reasoning consumers use this to decide whether to proceed. Anything
 *  other than "verified" or "attorney_locked" means the consumer must NOT
 *  treat caseType as trustworthy for analyzer selection, citation banks,
 *  scoring, or report framing. */
export function isUsableForLegalReasoning(identity: VerifiedCaseIdentity): boolean {
  return identity.status === "verified" || identity.status === "attorney_locked";
}
