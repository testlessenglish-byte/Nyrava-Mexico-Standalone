import { describe, expect, it } from "vitest";
import {
  classifyTimelineEvent,
  extractCorpusTimelineEvents,
} from "../canonical-timeline.server";

describe("Penal timeline legal-date classification", () => {
  it("classifies a cited precedent date as authority_date", () => {
    expect(
      classifyTimelineEvent(
        "La tesis publicada en el Semanario Judicial el 12 de marzo de 1956 sostuvo un criterio distinto.",
      ),
    ).toBe("authority_date");
  });

  it("excludes an authority date from the primary procedural chronology", () => {
    const events = extractCorpusTimelineEvents(
      [
        "El 14 de abril de 2018 el Tribunal de Enjuiciamiento dictó sentencia en esta causa penal.",
        "La sentencia citó la jurisprudencia publicada el 12 de marzo de 1956 en el Semanario Judicial.",
      ].join("\n"),
    );

    expect(events.map((event) => event.date)).toContain("2018-04-14");
    expect(events.map((event) => event.date)).not.toContain("1956-03-12");
    expect(events.every((event) => event.event_type === "case_event")).toBe(true);
    expect(events[0]?.source_quote).toContain("dictó sentencia");
  });

  it("does not trust an upstream case_event label over authority context", () => {
    expect(
      classifyTimelineEvent(
        "Precedente de 1956 publicado en el Semanario Judicial.",
        "case_event",
      ),
    ).toBe("authority_date");
  });

  it("classifies DOF history separately", () => {
    expect(
      classifyTimelineEvent("Reforma publicada en el Diario Oficial de la Federación el 2 de junio de 2011."),
    ).toBe("legislative_history");
  });
});
