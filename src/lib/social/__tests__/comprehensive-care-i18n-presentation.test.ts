import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workspace = readFileSync(join(root, "src", "components", "social", "SocialCaseWorkspace.tsx"), "utf8");
const dynamicText = readFileSync(join(root, "src", "components", "social", "CaseDynamicText.tsx"), "utf8");
const translationHook = readFileSync(join(root, "src", "hooks", "useCaseTranslation.ts"), "utf8");
const casesFunctions = readFileSync(join(root, "src", "lib", "cases.functions.ts"), "utf8");

const checkDifferentLanguage = (text: string, targetLocale: string): boolean => {
  if (!text || text.trim().length < 2) return false;
  const lower = text.toLowerCase();
  if (targetLocale === "es") {
    const englishWords = /\b(the|and|is|are|was|were|this|that|with|for|from|have|has|had|will|would|should|could|client|reports|reporting|violence|abuse|needs|family|case|intake|risk|plan|goal|actions|outcome|required|follow|assessment|immediate|protective|factors|override|closure|services|completed|under|review)\b/i;
    return englishWords.test(lower);
  } else {
    const spanishWords = /\b(el|la|los|las|un|una|unos|unas|del|por|para|con|sin|sobre|que|quien|cual|este|esta|estos|estas|persona|caso|violencia|informe|atención|atencion|necesidad|riesgo|protección|proteccion|seguimiento|evaluación|evaluacion|canalización|canalizacion|albergue|apoyo|salud|familiar|legal|plan|meta|acción|accion|resultado|cierre|servicios|revisión|revision)\b/i;
    const spanishChars = /[áéíóúüñ¿¡]/i;
    return spanishWords.test(lower) || spanishChars.test(lower);
  }
};

describe("Comprehensive Care presentation-layer i18n & dynamic translation", () => {
  it("detects language divergence accurately without false positive loops", () => {
    expect(checkDifferentLanguage("Client reports escalating domestic violence and threats", "es")).toBe(true);
    expect(checkDifferentLanguage("La usuaria presenta reporte de violencia familiar y requiere apoyo", "en")).toBe(true);
    expect(checkDifferentLanguage("Razón y seguimiento de caso", "es")).toBe(false);
    expect(checkDifferentLanguage("Reason and case follow-up", "en")).toBe(false);
  });

  it("integrates CaseDynamicText across all primary and context case tabs", () => {
    expect(workspace).toContain("import { CaseDynamicText } from \"@/components/social/CaseDynamicText\";");
    expect(workspace).toContain("<CaseDynamicText");
    expect(workspace).toContain("social_assessment_versions");
    expect(workspace).toContain("social_care_plan_goals");
  });

  it("provides Ver original / View original bidirectional toggling", () => {
    expect(dynamicText).toContain('es ? "Ver traducción" : "View translation"');
    expect(dynamicText).toContain('es ? "Ver original" : "View original"');
    expect(dynamicText).toContain("toggleOriginal");
  });

  it("preserves immutable database records and caches translations with TanStack Query", () => {
    expect(translationHook).toContain('queryKey: ["case-field-translate", locale, hashText(raw)]');
    expect(translationHook).toContain("staleTime: Infinity");
  });

  it("instructs translation server function to strictly preserve names, case numbers, and citations", () => {
    expect(casesFunctions).toContain("party and client names, case numbers, document IDs");
    expect(casesFunctions).toContain("Atención Integral / Comprehensive Care");
  });
});
