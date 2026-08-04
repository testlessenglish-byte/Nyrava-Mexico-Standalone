// First-pass authority_level assignment for newly-ingested legal
// authorities — Phase 2 (Institutional Knowledge Library) "trust levels."
//
// migration 20260726070000_legal_authority_level_and_hash.sql added the
// authority_level column and backfilled it for the 12 manually-seeded rows
// (constitution=10, federal code/law=9, non-federal code/law=8), but every
// row written by the live connectors since then got NULL — nothing ever
// assigned a level to a real ingested document, so authority_level was a
// column nobody wrote to and nobody read (confirmed: zero references to it
// anywhere outside the generated Supabase types). This extends the same
// backfill rule to every LegalSourceKind a real connector actually emits,
// so authority_level-aware ranking has something to rank connector-ingested
// rows on too.
//
// This is a documented, reviewable first-pass ranking grounded in Mexican
// normative hierarchy (jerarquía de normas: Constitución > jurisprudencia
// SCJN/leyes federales > leyes estatales > reglamentos/decretos/DOF >
// tribunales especializados/administrativos), not an authoritative legal
// determination — see upsertAuthorityWithVersioning in versioning.server.ts,
// which never overwrites a level that's already been set (by this function
// on a prior ingest, or by a human reviewer), so any row can be corrected
// once and it sticks.
import type { LegalSourceKind } from "./types";

export function deriveAuthorityLevel(kind: LegalSourceKind, jurisdiction: string): number {
  const isFederal = jurisdiction.trim().toLowerCase() === "federal";
  switch (kind) {
    // SCJN-binding jurisprudencia (Art. 217 Ley de Amparo) — binding on
    // every lower court, same tier as a federal statute.
    case "jurisprudencia":
      return 9;
    case "federal_statute":
      return 9;
    case "state_statute":
      return 8;
    // DOF publishes decrees/reglamentos/acuerdos spanning many normative
    // tiers; without per-document sub-classification this is a single
    // conservative rank for "published federal regulation," below a
    // primary statute.
    case "federal_gazette":
      return 6;
    // TEPJF — final and binding within electoral matters, a specialized
    // federal tribunal, below SCJN's general jurisprudencia tier.
    case "electoral_ruling":
      return 7;
    // Individual court rulings/sentencias (CJF federal circuit courts,
    // state supreme courts) — persuasive, not certified binding
    // jurisprudencia. Federal ranks above state, mirroring the
    // federal/state statute split above.
    case "court_decision":
      return isFederal ? 6 : 5;
    // TFJA — federal administrative tribunal, persuasive/binding within
    // its own scope, subordinate to statute and to SCJN jurisprudencia.
    case "administrative_ruling":
      return 5;
    // Declared in LegalSourceKind but no connector implements either yet
    // (see IMPLEMENTED_CONNECTORS in types.ts) — conservative default
    // until a real one exists to calibrate against.
    case "state_gazette":
    case "human_rights_report":
      return 4;
  }
}
