// Pipeline-stage relevance for the "apelacion" profile — segunda instancia
// proceedings before a tribunal de alzada.
//
// This exists because a real bug was found by inspection, not by running the
// pipeline: EXCLUDED_STAGES, SKIP_REASON_KEYS, and MX_PARTY_ROLES all define
// a complete "apelacion" profile in mx-pipeline.ts, but PROFILE_BY_MATERIA
// maps every one of the 13 MexicanCaseType values to some OTHER profile —
// "apelacion" is a case-level PROCEEDING shape (segunda instancia), not a
// materia, so no case could ever be classified into it. The whole profile
// was dead code: correctly built, permanently unreachable.
//
// The fix (effectiveMxProfile in mx-pipeline.ts) narrows a case's base
// materia profile to "apelacion" when its NAME signals the proceeding IS the
// appeal itself (e.g. "Toca de Apelación 45/2026"), scoped to the four
// materias where a distinct segunda-instancia proceeding is real: civil,
// mercantil, familiar, penal. This mirrors the existing
// detectMatterSubtype() text-narrowing pattern in matter-subtype.ts
// (familiar → sucesorio), just at the stage-exclusion layer instead of the
// engine-selection layer.
//
// This proves the fix (effectiveMxProfile / isStageRelevantForCaseType /
// mxPipelineStages in mx-pipeline.ts) actually excludes `witness` and
// `constitutional` for a detected appeal, rather than asserting it.
import { describe, it, expect } from "vitest";
import {
  effectiveMxProfile,
  isStageRelevantForCaseType,
  mxPipelineStageKeys,
} from "@/lib/execution/mx-pipeline";

describe("apelacion (segunda instancia) pipeline stage relevance via case-name detection", () => {
  it("detects an appeal by case name for each eligible materia and resolves to the apelacion profile", () => {
    expect(effectiveMxProfile("civil", "Toca de Apelación 45/2026")).toBe("apelacion");
    expect(effectiveMxProfile("mercantil", "Recurso de Apelación 12/2026")).toBe("apelacion");
    expect(effectiveMxProfile("familiar", "Segunda Instancia 8/2026")).toBe("apelacion");
    expect(effectiveMxProfile("penal", "Toca Penal ante Tribunal de Alzada 3/2026")).toBe("apelacion");
  });

  it("excludes witness and constitutional once an appeal is detected — same rationale as amparo/administrativo", () => {
    const name = "Toca de Apelación 45/2026";
    for (const materia of ["civil", "mercantil", "familiar", "penal"] as const) {
      expect(isStageRelevantForCaseType(materia, "witness", name)).toBe(false);
      expect(isStageRelevantForCaseType(materia, "constitutional", name)).toBe(false);
    }
  });

  it("is case-insensitive and accent-insensitive, matching how the case-name convention is actually typed", () => {
    expect(effectiveMxProfile("civil", "TOCA DE APELACION 1/2026")).toBe("apelacion");
    expect(effectiveMxProfile("civil", "toca de apelación 1/2026")).toBe("apelacion");
  });

  it("does NOT narrow a materia that isn't in APELACION_ELIGIBLE_MATERIAS, even with a matching case name", () => {
    for (const materia of ["amparo", "laboral", "administrativo", "fiscal", "electoral", "agrario", "ambiental"] as const) {
      expect(effectiveMxProfile(materia, "Toca de Apelación 45/2026")).not.toBe("apelacion");
    }
  });

  it("does NOT narrow an eligible materia when the case name has no appeal signal — regression guard", () => {
    for (const materia of ["civil", "mercantil", "familiar", "penal"] as const) {
      expect(effectiveMxProfile(materia, "Juicio Ordinario Civil 10/2026")).not.toBe("apelacion");
      expect(isStageRelevantForCaseType(materia, "witness", "Juicio Ordinario Civil 10/2026")).toBe(true);
    }
  });

  it("still runs the stages that produce useful output for an appeal — only witness/constitutional drop", () => {
    const keys = mxPipelineStageKeys("civil", "Toca de Apelación 45/2026");
    for (const useful of [
      "extraction", "analyzers", "agents", "timeline", "evidence_map",
      "contradictions", "evidence_intel", "jurisdiction_intel",
      "procedural_compliance", "discovery", "theories", "strategy",
      "work_product", "scoring", "legal_qa", "report",
    ]) {
      expect(keys).toContain(useful);
    }
    expect(keys).not.toContain("witness");
    expect(keys).not.toContain("constitutional");
  });

  it("backward compatible: existing 2-argument callers (no case name) behave exactly as before", () => {
    expect(isStageRelevantForCaseType("civil", "witness")).toBe(true);
    expect(isStageRelevantForCaseType("civil", "constitutional")).toBe(false);
    expect(effectiveMxProfile("civil")).toBe("civil");
    expect(effectiveMxProfile("civil", null)).toBe("civil");
    expect(effectiveMxProfile("civil", undefined)).toBe("civil");
  });

  it("a boilerplate mention of apelación inside a first-instance case name does not false-positive without the exact signal phrase", () => {
    // The signal deliberately requires "toca de apelacion" / "recurso de
    // apelacion" / "segunda instancia" / "tribunal de alzada" as whole
    // phrases — a bare "apelación" substring must NOT match.
    expect(effectiveMxProfile("civil", "Juicio Ordinario Civil — apelación pendiente de resolver")).toBe("civil");
  });
});
