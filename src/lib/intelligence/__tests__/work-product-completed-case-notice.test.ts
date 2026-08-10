// Regression test for a real bug found via a live completed-case export
// (amparo indirecto, case_analysis_mode=concluded_audit, corpus = the FINAL
// sentencia resolving an already-concluded amparo): runWorkProductEngine
// (engines.server.ts) drafted a "Demanda de Amparo Indirecto" whose own
// "Estado del Juicio" section asserted "El juicio se encuentra en trámite,
// con la admisión de la demanda y la solicitud de informes justificados..."
// — flatly contradicting the source document, which recounts a
// fully-completed procedural history. The engine never received the
// case_analysis_mode objective the analyzers/agents stages already inject
// (getCaseAnalysisObjective), so the model had no signal the matter was
// concluded and defaulted to fresh-filing boilerplate.
//
// buildWorkProductCompletedCaseNotice is the pure prompt-text builder
// extracted for this fix — this locks in the exact "never describe a
// concluded matter as en trámite" instruction without needing a live DB/LLM
// call.
import { describe, it, expect } from "vitest";
import { buildWorkProductCompletedCaseNotice } from "@/lib/intelligence/engines.server";

describe("buildWorkProductCompletedCaseNotice", () => {
  it("includes the case-analysis objective when one is supplied", () => {
    const notice = buildWorkProductCompletedCaseNotice("Este es un CASO CONCLUIDO...");
    expect(notice).toContain("Este es un CASO CONCLUIDO...");
  });

  it("still emits the procedural-status warning when no objective text is available", () => {
    const notice = buildWorkProductCompletedCaseNotice(null);
    expect(notice).toContain("ADVERTENCIA CRÍTICA DE ESTADO PROCESAL");
  });

  it("explicitly forbids describing a concluded matter as en trámite / pendiente", () => {
    const notice = buildWorkProductCompletedCaseNotice(null);
    expect(notice).toContain('"en trámite"');
    expect(notice).toContain('"pendiente de resolución"');
    expect(notice).toContain('"a la espera de informe justificado"');
  });

  it("instructs the model to derive procedural posture from the corpus, not assume a fresh filing", () => {
    const notice = buildWorkProductCompletedCaseNotice(null);
    expect(notice).toMatch(/determina el estado procesal real leyendo la narrativa fáctica/);
    expect(notice).toMatch(/no una plantilla genérica de caso en curso/);
  });
});
