import { describe, expect, it } from "vitest";
import { validateRenderedReport } from "../prerender-validate.server";
import { decideRenderedReportRelease } from "../rendered-report-release";

const NON_PENAL_MATERIAS = [
  "civil",
  "familiar",
  "mercantil",
  "laboral",
  "fiscal",
  "administrativo",
  "amparo",
  "constitucional",
  "electoral",
  "agrario",
  "ambiental",
  "inmobiliario",
];

describe("rendered report release policy", () => {
  it.each(NON_PENAL_MATERIAS)(
    "blocks penal-only institutional leakage in %s reports",
    (materia) => {
      const issues = validateRenderedReport(
        { procedural_issues_report: "El Ministerio Público integró la carpeta de investigación." },
        materia,
      );
      const decision = decideRenderedReportRelease(issues);
      expect(decision.blocked).toBe(true);
      expect(decision.blockingIssues.some((i) => i.code === "SPANISH_CASE_TYPE_LEAK")).toBe(true);
    },
  );

  it("recognizes penal as the canonical Mexican criminal materia", () => {
    const issues = validateRenderedReport(
      { procedural_issues_report: "El Ministerio Público integró la carpeta de investigación." },
      "penal",
    );
    expect(issues.some((i) => i.code === "SPANISH_CASE_TYPE_LEAK")).toBe(false);
  });

  it.each(["penal", ...NON_PENAL_MATERIAS])(
    "blocks U.S. procedural vehicles in every Mexican materia: %s",
    (materia) => {
      const issues = validateRenderedReport(
        { recommendations: "Counsel should file a Motion to Dismiss." },
        materia,
      );
      const decision = decideRenderedReportRelease(issues);
      expect(decision.blocked).toBe(true);
      expect(decision.blockingIssues.some((i) => i.code === "US_PROCEDURE_LEAK")).toBe(true);
    },
  );

  it.each(["penal", ...NON_PENAL_MATERIAS])(
    "blocks unresolved template output in every Mexican materia: %s",
    (materia) => {
      const issues = validateRenderedReport(
        { attorney_summary: "La cuantía reclamada es {{amount}}." },
        materia,
      );
      expect(decideRenderedReportRelease(issues).blocked).toBe(true);
    },
  );

  it("blocks deterministic report-quality critical issues even when the aggregate score itself is uncalibrated", () => {
    const issues = validateRenderedReport(
      {
        full_report: {
          validation: {
            quality_gate: {
              score: 20,
              passed: false,
              critical_issues: ["17 orphaned citation(s) — verify docIndex"],
            },
          },
        },
      },
      "amparo",
    );
    const decision = decideRenderedReportRelease(issues);
    expect(issues.some((i) => i.code === "REPORT_QUALITY_CRITICAL")).toBe(true);
    expect(decision.blocked).toBe(true);
  });

  it("does not block solely because a low aggregate quality score has no critical issue", () => {
    const issues = validateRenderedReport(
      {
        full_report: {
          validation: {
            quality_gate: { score: 20, passed: false, critical_issues: [] },
          },
        },
      },
      "amparo",
    );
    expect(decideRenderedReportRelease(issues).blocked).toBe(false);
  });

  it.each(["penal", ...NON_PENAL_MATERIAS])(
    "allows clean rendered content in %s",
    (materia) => {
      const issues = validateRenderedReport(
        { attorney_summary: "Análisis sustentado exclusivamente en los documentos proporcionados." },
        materia,
      );
      expect(decideRenderedReportRelease(issues).blocked).toBe(false);
    },
  );

  it("does not promote warning-only QA findings to blocking failures", () => {
    const issues = validateRenderedReport(
      { attorney_summary: "Revisión TODO pendiente de validación humana." },
      "civil",
    );
    const decision = decideRenderedReportRelease(issues);
    expect(issues.some((i) => i.code === "TOKEN_TBD")).toBe(true);
    expect(decision.blocked).toBe(false);
  });
});
