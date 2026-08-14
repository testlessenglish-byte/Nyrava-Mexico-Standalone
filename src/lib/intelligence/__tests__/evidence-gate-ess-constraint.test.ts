// Regression tests for applyEssConstraint (evidence-gate.server.ts) — the
// report-quality audit fix (2026-08-14, ADR-2239-2018-180906): "modo
// LIMITADO" must constrain individual finding confidence/severity/
// classification, not just suppress the case-level score/recommendations.
import { describe, it, expect } from "vitest";
import { applyEssConstraint, rewriteAbsenceWording } from "@/lib/intelligence/evidence-gate.server";

describe("applyEssConstraint", () => {
  it("is a no-op for 'medium'/'high' ESS bins — a sufficient corpus never gets downgraded", () => {
    const finding = { finding_type: "DIRECT_EVIDENCE" as const, confidence: 0.95, severity: "critical" };
    expect(applyEssConstraint(finding, "medium")).toEqual({ ...finding, downgraded: false });
    expect(applyEssConstraint(finding, "high")).toEqual({ ...finding, downgraded: false });
  });

  it("downgrades DIRECT_EVIDENCE to EVIDENCE_BASED_INFERENCE under a 'minimal' bin — the exact audited defect", () => {
    const r = applyEssConstraint(
      { finding_type: "DIRECT_EVIDENCE", confidence: 0.9, severity: "high" },
      "minimal",
    );
    expect(r.finding_type).toBe("EVIDENCE_BASED_INFERENCE");
    expect(r.downgraded).toBe(true);
  });

  it("caps confidence at 0.5 under 'minimal' and 0.6 under 'low' — a 90%/95% badge can no longer render", () => {
    const rMinimal = applyEssConstraint(
      { finding_type: "EVIDENCE_BASED_INFERENCE", confidence: 0.95, severity: null },
      "minimal",
    );
    expect(rMinimal.confidence).toBe(0.5);
    expect(rMinimal.downgraded).toBe(true);

    const rLow = applyEssConstraint(
      { finding_type: "EVIDENCE_BASED_INFERENCE", confidence: 0.9, severity: null },
      "low",
    );
    expect(rLow.confidence).toBe(0.6);
  });

  it("never RAISES confidence — a finding already below the ceiling is left untouched", () => {
    const r = applyEssConstraint(
      { finding_type: "EVIDENCE_BASED_INFERENCE", confidence: 0.3, severity: null },
      "minimal",
    );
    expect(r.confidence).toBe(0.3);
  });

  it("downgrades severity exactly one tier: critical->high->medium->low->info, info stays info", () => {
    const at = (severity: string) =>
      applyEssConstraint({ finding_type: "AI_THEORY", confidence: null, severity }, "minimal").severity;
    expect(at("critical")).toBe("high");
    expect(at("high")).toBe("medium");
    expect(at("medium")).toBe("low");
    expect(at("low")).toBe("info");
    expect(at("info")).toBe("info");
  });

  it("marks downgraded:false when nothing actually needed to change, even under a minimal bin", () => {
    const r = applyEssConstraint(
      { finding_type: "AI_THEORY", confidence: 0.3, severity: "info" },
      "minimal",
    );
    expect(r).toEqual({ finding_type: "AI_THEORY", confidence: 0.3, severity: "info", downgraded: false });
  });

  it("handles null confidence/severity without throwing", () => {
    const r = applyEssConstraint({ finding_type: "DIRECT_EVIDENCE", confidence: null, severity: null }, "minimal");
    expect(r.confidence).toBeNull();
    expect(r.severity).toBeNull();
    expect(r.finding_type).toBe("EVIDENCE_BASED_INFERENCE");
    expect(r.downgraded).toBe(true);
  });
});

describe("rewriteAbsenceWording", () => {
  it("rewrites 'no se observa en el expediente' to the corpus-scoped phrasing under a 'minimal' bin", () => {
    const out = rewriteAbsenceWording(
      "No se observa en el expediente una notificación formal al quejoso.",
      "minimal",
    );
    expect(out).toBe(
      "No se identificó en el/los documento(s) proporcionado(s) una notificación formal al quejoso.",
    );
  });

  it("is case-insensitive and rewrites every occurrence", () => {
    const out = rewriteAbsenceWording(
      "NO SE OBSERVA EN EL EXPEDIENTE el acuse. Tampoco no se observa en el expediente la firma.",
      "low",
    );
    expect(out).not.toMatch(/no se observa en el expediente/i);
    expect((out ?? "").match(/no se identificó en el\/los documento\(s\) proporcionado\(s\)/gi)?.length).toBe(2);
  });

  it("is a no-op for 'medium'/'high' bins — a sufficient corpus can support the stronger claim", () => {
    const text = "No se observa en el expediente una notificación formal.";
    expect(rewriteAbsenceWording(text, "medium")).toBe(text);
    expect(rewriteAbsenceWording(text, "high")).toBe(text);
  });

  it("leaves text without the overclaiming phrase untouched", () => {
    const text = "El demandante presentó su contestación el 15 de marzo.";
    expect(rewriteAbsenceWording(text, "minimal")).toBe(text);
  });

  it("handles null/undefined without throwing", () => {
    expect(rewriteAbsenceWording(null, "minimal")).toBeNull();
    expect(rewriteAbsenceWording(undefined, "minimal")).toBeNull();
  });
});
