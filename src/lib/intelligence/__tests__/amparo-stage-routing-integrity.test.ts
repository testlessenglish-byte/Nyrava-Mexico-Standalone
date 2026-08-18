import { describe, expect, it } from "vitest";
import { PIPELINE_PROFILES, effectiveMxProfile } from "@/lib/execution/mx-pipeline";

describe("Amparo execution allowlisting", () => {
  it("excludes the witness stage for ordinary Amparo", () => {
    expect(PIPELINE_PROFILES.amparo.stages).not.toContain("witness");
  });

  it("routes ADR/SCJN review to the constitutional review profile, which also excludes witness", () => {
    const profile = effectiveMxProfile(
      "amparo",
      "Amparo Directo en Revisión 4321/2017",
      "Suprema Corte de Justicia de la Nación recurso de revisión",
    );
    expect(profile).toBe("constitucional");
    expect(PIPELINE_PROFILES[profile].stages).not.toContain("witness");
  });
});
