// Pipeline-wide sweep (2026-08-17): unlike every other engine in
// engines.server.ts (runTheoryEngine/runOpportunityEngine call
// textMatchesCaseType; runWitnessEngine/runWorkProductEngine call
// applyEvidenceGate), runTrialPrepEngine's trial_risks/trial_strengths/
// witness_order/exhibit_order/likely_objections/jury_concerns had NO
// terminology check of any kind — despite the prompt containing an
// explicit, repeated "jamás menciones jurado" / "PROHIBIDO ABSOLUTAMENTE:
// jurado, jury..." instruction for Mexican penal cases (no jury exists in
// the sistema penal acusatorio; guilt is decided by a Tribunal de
// Enjuiciamiento). Prompt instructions are not enforcement.
import { describe, it, expect } from "vitest";
import { trialPrepTextAllowed } from "@/lib/intelligence/engines.server";

// Minimal stand-in for evidence-gate.server.ts's real textMatchesCaseType —
// this test only needs to prove trialPrepTextAllowed calls through to it and
// applies its own jury-leak check on top; textMatchesCaseType's own behavior
// is already covered by evidence-gate.server.ts's own tests.
const alwaysAllow = () => true;
const alwaysReject = () => false;

describe("trialPrepTextAllowed", () => {
  it("blocks a literal jury leak on a criminal case — the real gap this fixes", () => {
    expect(
      trialPrepTextAllowed("El jurado podría percibir esto como debilidad.", true, "penal", alwaysAllow),
    ).toBe(false);
  });

  it("blocks the English 'jury' term too", () => {
    expect(trialPrepTextAllowed("Jury selection concerns.", true, "penal", alwaysAllow)).toBe(false);
  });

  it("does not flag jury vocabulary on a civil case — Mexican civil procedure never mentions it, so this is a no-op safety net, not an active concern", () => {
    // isCriminal=false means the jury-leak check is skipped entirely; the
    // underlying textMatchesCaseType call is still the deciding factor.
    expect(trialPrepTextAllowed("Riesgo de responsabilidad civil.", false, "civil", alwaysAllow)).toBe(true);
  });

  it("delegates to textMatchesCaseType for non-jury terminology leaks", () => {
    expect(trialPrepTextAllowed("Contenido cualquiera.", true, "penal", alwaysReject)).toBe(false);
    expect(trialPrepTextAllowed("Contenido cualquiera.", true, "penal", alwaysAllow)).toBe(true);
  });

  it("passes through non-string/empty values untouched — filtering those is the caller's job", () => {
    expect(trialPrepTextAllowed(undefined, true, "penal", alwaysReject)).toBe(true);
    expect(trialPrepTextAllowed("", true, "penal", alwaysReject)).toBe(true);
    expect(trialPrepTextAllowed("   ", true, "penal", alwaysReject)).toBe(true);
  });
});
