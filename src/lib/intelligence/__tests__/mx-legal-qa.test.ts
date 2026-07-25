import { describe, expect, it } from "vitest";
import { auditText, remediateText, findEnglishSentences } from "@/lib/intelligence/mx-terminology";
import { evaluateProceduralCompliance } from "@/lib/intelligence/procedural-compliance";
import { buildJurisdictionProfile } from "@/lib/intelligence/mx-jurisdiction";

describe("mx terminology remediation", () => {
  it("rewrites discovery leakage per materia", () => {
    const { text } = remediateText("The discovery violation harmed the defendant.", "penal");
    expect(text).toContain("omisión en el deber de aportación probatoria");
    expect(text).toContain("imputado");
    expect(text).not.toMatch(/discovery|defendant/i);
  });

  it("maps party roles to the correct materia", () => {
    expect(remediateText("prosecution", "penal").text).toBe("Ministerio Público");
    expect(remediateText("plaintiff", "laboral").text).toBe("Parte actora");
    expect(remediateText("defendant", "civil").text).toBe("Parte demandada");
    expect(remediateText("plaintiff", "amparo").text).toBe("Parte quejosa");
  });

  it("leaves clean Mexican prose untouched", () => {
    const src = "El Ministerio Público omitió el descubrimiento probatorio conforme al CNPP.";
    expect(remediateText(src, "penal").text).toBe(src);
    expect(auditText(src, { profile: "penal", locale: "es" })).toHaveLength(0);
  });
});

describe("mx terminology audit", () => {
  it("blocks US constitutional references", () => {
    const v = auditText("Se violó el Fourth Amendment del expediente.", { profile: "penal", locale: "es" });
    expect(v.some((x) => x.kind === "us_jurisdiction_reference" && x.severity === "blocking")).toBe(true);
  });

  it("blocks residual US terminology", () => {
    const v = auditText("The jury will decide", { profile: "civil", locale: "es" });
    expect(v.some((x) => x.severity === "blocking")).toBe(true);
  });

  it("warns when a code from another materia is cited", () => {
    const v = auditText("Se aplica la LFT al contrato.", { profile: "mercantil", locale: "es" });
    expect(v.some((x) => x.kind === "wrong_procedural_code" && x.severity === "warning")).toBe(true);
  });

  it("detects untranslated English sentences only for Spanish reports", () => {
    const en = "The evidence in this case was not filed with the court and therefore should be excluded.";
    expect(findEnglishSentences(en).length).toBe(1);
    expect(auditText(en, { profile: "civil", locale: "en" }).some((v) => v.kind === "untranslated_english")).toBe(false);
  });

  it("does not flag Spanish legal prose as English", () => {
    const es =
      "La autoridad responsable no acreditó la legalidad del acto reclamado conforme al artículo 16 constitucional.";
    expect(findEnglishSentences(es)).toHaveLength(0);
  });
});

describe("procedural compliance", () => {
  it("flags missing mandatory acts in a penal matter", () => {
    const r = evaluateProceduralCompliance("penal", "Se integró la carpeta de investigación y el IPH correspondiente.");
    expect(r.items.find((i) => i.id === "carpeta_investigacion")?.status).toBe("cumplido");
    expect(r.missing_required).toBeGreaterThan(0);
    expect(r.summary).toContain("Faltan");
  });

  it("reports no evaluation without corpus", () => {
    const r = evaluateProceduralCompliance("laboral", "");
    expect(r.items.every((i) => i.status === "no_documentado")).toBe(true);
  });
});

describe("jurisdiction intelligence", () => {
  it("resolves state, fuero and governing codes", () => {
    const p = buildJurisdictionProfile({
      caseType: "criminal",
      jurisdictionField: "Guadalajara, Jalisco",
      corpusText: "Juez de control del Tribunal Superior de Justicia del Estado.",
    });
    expect(p.materia).toBe("penal");
    expect(p.state?.code).toBe("JAL");
    expect(p.procedural_codes.join(" ")).toContain("CNPP");
    expect(p.summary).toContain("Jalisco");
  });

  it("treats amparo as federal", () => {
    const p = buildJurisdictionProfile({ caseType: "amparo", corpusText: "Juzgado de Distrito en materia administrativa" });
    expect(p.fuero).toBe("federal");
    expect(p.procedural_codes.join(" ")).toContain("Ley de Amparo");
  });
});
