import { describe, expect, it } from "vitest";
import { rt, setReportTemplateLocale, resolveProceduralRoles, skipReason } from "@/lib/report-i18n";

const FORBIDDEN_TERMS = [
  "discovery", "plaintiff", "defendant", "jury", "deposition", "voir dire",
  "summary judgment", "attorney work product",
];

describe("report-i18n Spanish locale — no US/English leakage", () => {
  setReportTemplateLocale("es");

  it("translates known template phrases into Spanish", () => {
    expect(rt("Executive Summary")).toBe("Resumen Ejecutivo");
    expect(rt("Discovery")).not.toMatch(/discovery/i);
    expect(rt("Plaintiff")).not.toMatch(/plaintiff/i);
    expect(rt("Defendant")).not.toMatch(/defendant/i);
    expect(rt("Deposition")).not.toMatch(/deposition/i);
  });

  it("never leaves forbidden US-legal terms in dictionary output", () => {
    const sample = [
      "Discovery", "Plaintiff", "Defendant", "Jury", "Deposition",
      "Voir Dire", "Motion for Summary Judgment", "ATTORNEY WORK PRODUCT  \u00b7  PRIVILEGED & CONFIDENTIAL",
    ];
    for (const s of sample) {
      const out = rt(s).toLowerCase();
      for (const term of FORBIDDEN_TERMS) {
        expect(out).not.toContain(term);
      }
    }
  });

  it("resolves procedural roles per materia instead of hardcoded plaintiff/defendant", () => {
    const amparo = resolveProceduralRoles("amparo");
    expect(amparo.initiating_es).toBe("Quejoso");
    expect(amparo.responding_es).toBe("Autoridad responsable");

    const civil = resolveProceduralRoles("civil");
    expect(civil.initiating_es.toLowerCase()).not.toContain("plaintiff");
    expect(civil.responding_es.toLowerCase()).not.toContain("defendant");
  });

  it("never renders a bare 'Omitido' without an explanation", () => {
    const reason = skipReason("no_witnesses", "es");
    expect(reason).not.toBe("Omitido");
    expect(reason.length).toBeGreaterThan(10);

    const fallback = skipReason(null, "es");
    expect(fallback).not.toBe("Omitido");
  });
});
