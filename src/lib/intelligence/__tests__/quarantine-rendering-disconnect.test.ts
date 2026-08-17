// Real-user bug report (2026-08-16, "Quarantined/unverified findings render
// as authoritative content in the final report"): citation_audit correctly
// quarantines zero-citation findings, but canonical_recommendations/
// next_actions/strategy_recommendations are built from the same raw LLM
// output ~2000 lines earlier and never consult that quarantine decision.
// Confirmed live, identically, on two consecutive real cases: "Preparar
// recurso de revisión ante la SCJN." was quarantined (reason: missing_all)
// yet still rendered as a High/Critical-priority action item.
import { describe, it, expect } from "vitest";
import { filterQuarantinedRecommendations, isDuplicateTitle } from "@/lib/intelligence/report-recommendations";

describe("filterQuarantinedRecommendations", () => {
  it("removes a canonical_recommendations entry whose title matches a quarantined finding — the exact real-case reproduction", () => {
    const canonicalRecommendations = [
      { id: "rec_1", title: "Preparar el recurso de revisión.", priority: "high" },
      { id: "rec_2", title: "Recopilar pruebas adicionales que demuestren el perjuicio concreto.", priority: "critical" },
    ];
    const quarantinedTitles = ["Preparar recurso de revisión ante la SCJN."];

    const { items, removed } = filterQuarantinedRecommendations(
      canonicalRecommendations,
      quarantinedTitles,
      (i) => i.title,
    );

    expect(items.map((i) => i.id)).toEqual(["rec_2"]);
    expect(removed.map((i) => i.id)).toEqual(["rec_1"]);
  });

  it("removes a next_actions entry keyed by 'action' rather than 'title'", () => {
    const nextActions = [
      { action: "Preparar recurso de revisión ante la SCJN.", deadline_hint: "Próximo mes" },
      { action: "Revisar documentación sobre la legitimación del promovente.", deadline_hint: "Inmediato" },
    ];
    const quarantinedTitles = ["Preparar recurso de revisión ante la SCJN."];

    const { items } = filterQuarantinedRecommendations(nextActions, quarantinedTitles, (i) => i.action);

    expect(items).toHaveLength(1);
    expect(items[0].action).toContain("legitimación del promovente");
  });

  it("does not remove a genuinely different recommendation that happens to share a few words", () => {
    const items = [{ title: "Presentar recurso de revisión ante la SCJN sobre el artículo 83." }];
    const quarantinedTitles = ["Presentar recurso de apelación ante el Tribunal Colegiado."];

    const { items: kept } = filterQuarantinedRecommendations(items, quarantinedTitles, (i) => i.title);

    expect(kept).toHaveLength(1);
  });

  it("isDuplicateTitle is exported and usable directly (single source of truth with mergeCanonicalRecommendations' own dedup)", () => {
    expect(
      isDuplicateTitle("Preparar el recurso de revisión.", "Preparar recurso de revisión ante la SCJN."),
    ).toBe(true);
  });
});
