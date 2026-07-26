import { describe, expect, it } from "vitest";
import { resolveProceduralStage } from "../mx-procedural-stages";
import { resolveMissingDocuments } from "../mx-missing-documents";
import { computeMxDeadlines, extractMxEventsFromCorpus } from "../mx-deadlines";
import type { MxPipelineProfile } from "../../execution/mx-pipeline";

const MATERIAS: MxPipelineProfile[] = [
  "amparo",
  "penal",
  "fiscal",
  "civil",
  "laboral",
  "familiar",
  "mercantil",
  "administrativo",
];

describe("resolveProceduralStage", () => {
  it.each(MATERIAS)("resolves a stage sequence for %s materia with an empty corpus", (materia) => {
    const res = resolveProceduralStage(materia, "");
    expect(res.materia).toBe(materia);
    expect(res.stages.length).toBeGreaterThan(0);
    expect(res.current).toBeNull();
    expect(res.completed).toEqual([]);
    expect(res.next).toEqual({ id: res.stages[0].id, label_es: res.stages[0].label_es, label_en: res.stages[0].label_en, authority: res.stages[0].authority, patterns: res.stages[0].patterns });
    expect(res.missing_requirements).toEqual([]);
    expect(res.procedural_risks).toEqual([]);
  });

  it("detects the current stage as the furthest evidenced stage in penal", () => {
    const corpus = "Se presento denuncia ante el ministerio publico. Posteriormente se dicto auto de vinculacion a proceso.";
    const res = resolveProceduralStage("penal", corpus);
    expect(res.current?.id).toBe("vinculacion_proceso");
    expect(res.completed.map((s) => s.id)).toContain("denuncia_querella");
  });

  it("flags earlier undocumented stages as procedural risks in amparo", () => {
    const corpus = "Se dicto la audiencia constitucional en el juicio.";
    const res = resolveProceduralStage("amparo", corpus);
    expect(res.current?.id).toBe("audiencia_constitucional");
    expect(res.missing_requirements.length).toBeGreaterThan(0);
    expect(res.procedural_risks.length).toBe(res.missing_requirements.length);
  });

  it("resolves fiscal, civil, laboral, familiar, mercantil, administrativo stage maps", () => {
    for (const materia of ["fiscal", "civil", "laboral", "familiar", "mercantil", "administrativo"] as MxPipelineProfile[]) {
      const res = resolveProceduralStage(materia, "");
      expect(res.materia).toBe(materia);
      expect(res.stages.every((s) => !s.detected)).toBe(true);
    }
  });
});

describe("resolveMissingDocuments", () => {
  it.each(MATERIAS)("produces a checklist for %s materia with an empty corpus", (materia) => {
    const res = resolveMissingDocuments(materia, "");
    expect(res.materia).toBe(materia);
    expect(res.required.length).toBeGreaterThan(0);
    expect(res.present).toEqual([]);
    expect(res.missing.length).toBe(res.required.length);
  });

  it("marks documents present when evidenced in the corpus (penal)", () => {
    const corpus = "Consta la carpeta de investigacion con numero unico de caso y el dictamen pericial en criminalistica.";
    const res = resolveMissingDocuments("penal", corpus);
    expect(res.present.some((d) => d.id === "carpeta_investigacion")).toBe(true);
    expect(res.present.some((d) => d.id === "dictamenes_periciales")).toBe(true);
    expect(res.missing.some((d) => d.id === "cadena_custodia")).toBe(true);
  });

  it("marks documents present when evidenced in the corpus (civil)", () => {
    const corpus = "El contrato de arrendamiento se acompaña como documento base de la accion. Consta el emplazamiento.";
    const res = resolveMissingDocuments("civil", corpus);
    expect(res.present.some((d) => d.id === "contrato")).toBe(true);
    expect(res.present.some((d) => d.id === "notificaciones_civil")).toBe(true);
    expect(res.missing.some((d) => d.id === "poderes")).toBe(true);
  });
});

describe("computeMxDeadlines", () => {
  it("computes a vigente amparo demand deadline with days remaining", () => {
    const asOf = "2024-01-10";
    const deadlines = computeMxDeadlines({
      materia: "amparo",
      events: [{ id: "e1", type: "notificacion_acto_reclamado", date: "2024-01-08" }],
      asOf,
    });
    const d = deadlines.find((x) => x.id === "plazo_demanda_amparo:e1");
    expect(d).toBeDefined();
    expect(d!.day_type).toBe("habiles");
    expect(d!.days).toBe(15);
    expect(d!.status).toBe("vigente");
    expect(d!.days_remaining).toBeGreaterThan(0);
    expect(d!.risk_level).toBe("medium");
    expect(d!.basis).toContain("Ley de Amparo Art. 17");
  });

  it("marks an overdue deadline vencido/critical with negative days remaining", () => {
    const deadlines = computeMxDeadlines({
      materia: "civil",
      events: [{ id: "e1", type: "emplazamiento", date: "2023-01-02" }],
      asOf: "2024-01-01",
    });
    const d = deadlines.find((x) => x.id === "plazo_contestacion_demanda:e1");
    expect(d).toBeDefined();
    expect(d!.status).toBe("vencido");
    expect(d!.risk_level).toBe("critical");
    expect(d!.days_remaining).toBeLessThan(0);
  });

  it("computes variable-length prescripción penal from event metadata", () => {
    const deadlines = computeMxDeadlines({
      materia: "penal",
      events: [{ id: "e1", type: "hecho_delictivo", date: "2020-01-01", metadata: { pena_maxima_anios: 5 } }],
      asOf: "2021-01-01",
    });
    const d = deadlines.find((x) => x.id === "prescripcion_penal:e1");
    expect(d).toBeDefined();
    expect(d!.days).toBe(5 * 365);
    expect(d!.day_type).toBe("naturales");
  });

  it("returns no deadlines when no matching events are supplied", () => {
    const deadlines = computeMxDeadlines({ materia: "laboral", events: [] });
    expect(deadlines).toEqual([]);
  });

  it("sorts deadlines by due date ascending", () => {
    const deadlines = computeMxDeadlines({
      materia: "amparo",
      events: [
        { id: "e1", type: "notificacion_acto_reclamado", date: "2024-03-01" },
        { id: "e2", type: "sentencia_amparo", date: "2024-01-01" },
      ],
      asOf: "2023-12-01",
    });
    const dueDates = deadlines.map((d) => d.due_date);
    const sorted = [...dueDates].sort();
    expect(dueDates).toEqual(sorted);
  });
});

describe("extractMxEventsFromCorpus", () => {
  it("returns no events for an empty corpus", () => {
    expect(extractMxEventsFromCorpus("amparo", "")).toEqual([]);
  });

  it("extracts a numeric-date event for a matching trigger keyword", () => {
    const corpus = "Consta la notificacion del acto reclamado practicada el 05/03/2024 conforme a derecho.";
    const events = extractMxEventsFromCorpus("amparo", corpus);
    const ev = events.find((e) => e.type === "notificacion_acto_reclamado");
    expect(ev).toBeDefined();
    expect(ev!.date).toBe("2024-03-05");
  });

  it("extracts a Spanish long-form date event for a matching trigger keyword", () => {
    const corpus = "El emplazamiento se practico el 12 de febrero de 2023 en el domicilio del demandado.";
    const events = extractMxEventsFromCorpus("civil", corpus);
    const ev = events.find((e) => e.type === "emplazamiento");
    expect(ev).toBeDefined();
    expect(ev!.date).toBe("2023-02-12");
  });

  it("does not fabricate an event when the keyword has no nearby date", () => {
    const corpus = "Se menciona el emplazamiento sin mayor detalle en el expediente.";
    const events = extractMxEventsFromCorpus("civil", corpus);
    expect(events.find((e) => e.type === "emplazamiento")).toBeUndefined();
  });
});
