import { describe, expect, it } from "vitest";
import {
  IMMIGRATION_AUTHORITIES,
  IMMIGRATION_OFFICIAL_SOURCES,
  IMMIGRATION_SUBTYPES,
  maskSensitiveIdentifier,
  parseImmigrationMatterMetadata,
} from "@/lib/jurisdiction/immigration";
import {
  getCourtHierarchy,
  getEvidenceRules,
  getProceduralRules,
  normalizeMexicanCaseType,
} from "@/lib/jurisdiction/mexico";
import { executionProfileFor } from "@/lib/jurisdiction/execution-profile";
import {
  getAllowedAnalyzers,
  getAllowedFindingModules,
  getBlockedTerms,
} from "@/lib/intelligence/practice-areas";
import { classifyMexicanCaseType } from "@/lib/mx-case-classifier";
import { detectMatterSubtype, isEngineAllowedForSubtype } from "@/lib/jurisdiction/matter-subtype";

describe("Mexican immigration, refugee and nationality routing", () => {
  it("registers the canonical materia and all requested subtypes without duplicates", () => {
    expect(normalizeMexicanCaseType("migratorio")).toBe("migratorio");
    expect(normalizeMexicanCaseType("immigration")).toBe("migratorio");
    expect(IMMIGRATION_SUBTYPES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(IMMIGRATION_SUBTYPES.map(([key]) => key)).size).toBe(IMMIGRATION_SUBTYPES.length);
  });

  it("routes only through Mexican federal authorities and official-source families", () => {
    expect(Object.keys(IMMIGRATION_AUTHORITIES)).toEqual(
      expect.arrayContaining(["inm", "sre", "comar", "dif", "tfja", "pjf", "cndh"]),
    );
    expect(IMMIGRATION_OFFICIAL_SOURCES.map(([id]) => id)).toEqual(
      expect.arrayContaining(["LM", "RLM", "LRPCAP", "LN", "LFPA", "LFPCA", "LA", "LGDNNA"]),
    );
    const profile = executionProfileFor("migratorio");
    expect(profile.jurisdictionLevels).toContain("federal");
    expect(profile.governingLaws.map((law) => law.code).join(" ")).toMatch(/LM|Migraci/);
    expect(getCourtHierarchy("migratorio").court_level).toBe("federal");
    expect(getProceduralRules("migratorio").procedural_code).toContain("Ley de Migración");
    expect(getEvidenceRules("migratorio").medios).toContain("pasaporte o documento de identidad");
  });

  it("classifies real Mexican immigration signals deterministically", () => {
    const result = classifyMexicanCaseType(
      "INSTITUTO NACIONAL DE MIGRACIÓN. Procedimiento conforme a la Ley de Migración. " +
        "Solicitud de residencia temporal y regularización migratoria.",
    );
    expect(result.caseType).toBe("migratorio");
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("activates immigration specialists and blocks foreign concepts", () => {
    const engines = getAllowedAnalyzers("migratorio");
    expect(engines).toContain("agent:immigration_eligibility_analysis");
    expect(engines).toContain("agent:refugee_non_refoulement_analysis");
    expect(engines).not.toContain("chain_of_custody");
    expect(getAllowedFindingModules("migratorio")).toContain("principio_de_no_devolucion");
    expect(getBlockedTerms("migratorio")).toEqual(
      expect.arrayContaining(["uscis", "green card", "i-130", "i-485"]),
    );
  });

  it("narrows specialist agents for refugee and nationality subtypes", () => {
    const refugee = detectMatterSubtype("migratorio", "Solicitud ante COMAR de reconocimiento de refugiado");
    expect(refugee?.key).toBe("refugio_proteccion");
    expect(isEngineAllowedForSubtype(refugee, "agent:nationality_naturalization_analysis")).toBe(false);

    const nationality = detectMatterSubtype("migratorio", "Naturalización por residencia ante la SRE");
    expect(nationality?.key).toBe("nacionalidad_naturalizacion");
    expect(isEngineAllowedForSubtype(nationality, "agent:refugee_non_refoulement_analysis")).toBe(false);
  });

  it("validates metadata and masks passports", () => {
    const metadata = parseImmigrationMatterMetadata({
      immigration_subtype: "residencia_temporal",
      client_name: "Persona de Prueba",
      nationality: "Colombiana",
      passport_number: "AB1234567",
      client_aliases: [],
      tags: [],
      important_dates: [],
    });
    expect(metadata.confidentiality_level).toBe("confidential");
    expect(maskSensitiveIdentifier(metadata.passport_number)).toBe("•••••4567");
    expect(maskSensitiveIdentifier("1234")).toBe("••••");
  });
});
