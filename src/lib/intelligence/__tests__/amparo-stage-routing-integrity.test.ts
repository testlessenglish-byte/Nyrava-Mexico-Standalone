import { describe, expect, it } from "vitest";
import { effectiveMxProfile, mxPipelineStages } from "@/lib/execution/mx-pipeline";

describe("Amparo execution allowlisting", () => {
  it("excludes the witness stage for ordinary Amparo", () => {
    expect(mxPipelineStages("amparo").map((s) => s.key)).not.toContain("witness");
  });

  it("routes ADR/SCJN review to the constitutional review profile, which also excludes witness", () => {
    const profile = effectiveMxProfile(
      "amparo",
      "Amparo Directo en Revisión 4321/2017",
      "Suprema Corte de Justicia de la Nación recurso de revisión",
    );
    expect(profile).toBe("constitucional");
    expect(
      mxPipelineStages("amparo", "Amparo Directo en Revisión 4321/2017").map((s) => s.key),
    ).not.toContain("witness");
  });
});
