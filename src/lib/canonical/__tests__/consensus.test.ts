import { describe, it, expect } from "vitest";
import { emptyCaseAnalysis, type CaseAnalysis, type Finding } from "../case-analysis";
import {
  applyConsensus,
  enginesOf,
  persistFindingStatuses,
  voiceWeight,
  DETERMINISTIC_VOICE_WEIGHT,
  LLM_VOICE_WEIGHT,
} from "../consensus.server";
import { rankFindings } from "../findings-rank.server";
import { enforceCitationQuality } from "../citation-quality.server";

const CITE = { documentId: "11111111-1111-4111-8111-111111111111", page: 3, quote: "texto citado" };

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: crypto.randomUUID(),
    title: "Cadena de custodia rota en el embalaje",
    description: "El embalaje del indicio fue abierto sin registro.",
    category: "evidencia",
    severity: "high",
    confidence: 0.8,
    citations: [CITE],
    ...over,
  };
}

function analysisWith(findings: Finding[]): CaseAnalysis {
  const a = emptyCaseAnalysis({ caseId: "case-1", generatedAt: new Date().toISOString() });
  a.Findings = findings;
  return a;
}

describe("consensus — engine attribution", () => {
  it("counts the producing module as one voice", () => {
    expect(enginesOf(finding({ source_module: "engine:evidence" }))).toEqual(["engine:evidence"]);
  });

  it("never counts a projection row as an independent voice", () => {
    const f = finding({
      source_module: "projection:case_witnesses",
      supporting_engines: ["engine:witness_intelligence"],
    });
    expect(enginesOf(f)).toEqual(["engine:witness_intelligence"]);
  });

  it("de-duplicates the same engine listed twice", () => {
    const f = finding({ source_module: "engine:evidence", supporting_engines: ["engine:evidence"] });
    expect(enginesOf(f)).toEqual(["engine:evidence"]);
  });
});

describe("consensus — earned status", () => {
  it("promotes a grounded claim two distinct engines reached", () => {
    const a = analysisWith([
      finding({ source_module: "engine:evidence" }),
      finding({ source_module: "agent:qa", title: "Cadena de custodia rota en embalaje del indicio" }),
    ]);
    const s = applyConsensus(a);
    expect(s.clusters).toBe(1);
    expect(a.Findings[0].agreement).toBe(2);
    expect(a.Findings.every((f) => f.finding_status === "promoted")).toBe(true);
    expect(s.promoted).toBe(2);
  });

  it("only verifies a grounded single-engine claim", () => {
    const a = analysisWith([finding({ source_module: "engine:evidence" })]);
    applyConsensus(a);
    expect(a.Findings[0].finding_status).toBe("verified");
    expect(a.Findings[0].agreement).toBe(1);
  });

  it("leaves an ungrounded claim as a candidate no matter the agreement", () => {
    const a = analysisWith([
      finding({ source_module: "engine:evidence", citations: [] }),
      finding({ source_module: "agent:qa", citations: [{ documentId: null, page: null, quote: null }] }),
    ]);
    const s = applyConsensus(a);
    expect(s.candidate).toBe(2);
    expect(a.Findings[0].finding_status).toBe("candidate");
  });

  it("marks a cluster disputed when engines disagree on severity band", () => {
    const a = analysisWith([
      finding({ source_module: "engine:evidence", severity: "critical" }),
      finding({ source_module: "agent:qa", severity: "info" }),
    ]);
    applyConsensus(a);
    expect(a.Findings.every((f) => f.finding_status === "disputed")).toBe(true);
  });

  it("keeps unrelated claims in separate clusters", () => {
    const a = analysisWith([
      finding({ source_module: "engine:evidence" }),
      finding({
        source_module: "engine:plazos",
        category: "procesal",
        title: "Plazo de impugnación vencido",
        description: "El recurso se presentó fuera del término legal.",
      }),
    ]);
    const s = applyConsensus(a);
    expect(s.clusters).toBe(2);
    expect(a.Findings.every((f) => f.agreement === 1)).toBe(true);
  });

  it("never promotes a suppressed or quarantined row", () => {
    const a = analysisWith([
      finding({ source_module: "engine:evidence", suppressed: true }),
      finding({ source_module: "agent:qa" }),
    ]);
    applyConsensus(a);
    expect(a.Findings[0].finding_status).toBe("candidate");
  });
});

describe("consensus — ranking effect", () => {
  it("ranks a two-engine claim above an equal single-engine claim", () => {
    const single = finding({
      source_module: "engine:a",
      title: "Dictamen pericial sin ratificación ante el juez",
      description: "El perito no compareció a ratificar su dictamen.",
    });
    const multiA = finding({ source_module: "engine:b" });
    const multiB = finding({
      source_module: "agent:qa",
      title: "Cadena de custodia rota en embalaje del indicio",
    });
    const a = analysisWith([single, multiA, multiB]);
    applyConsensus(a);
    rankFindings(a);
    expect(a.Findings[0].agreement).toBe(2);
    expect(a.Findings[a.Findings.length - 1].id).toBe(single.id);
  });

  it("weights a deterministic stage above another LLM voice", () => {
    expect(voiceWeight("engine:procedural_compliance")).toBe(DETERMINISTIC_VOICE_WEIGHT);
    expect(voiceWeight("jurisdiction_intel")).toBe(DETERMINISTIC_VOICE_WEIGHT);
    expect(voiceWeight("agent:qa")).toBe(LLM_VOICE_WEIGHT);
  });

  it("ranks deterministic+LLM above LLM+LLM at the same raw engine count", () => {
    // Cluster A: an LLM engine corroborated by a deterministic stage.
    const detA = finding({ source_module: "engine:evidence" });
    const detB = finding({
      source_module: "engine:procedural_compliance",
      title: "Cadena de custodia rota en embalaje del indicio",
    });
    // Cluster B: same category/severity/confidence, two LLM voices.
    const llmA = finding({
      source_module: "engine:a",
      title: "Dictamen pericial sin ratificación ante el juez",
      description: "El perito no compareció a ratificar su dictamen.",
    });
    const llmB = finding({
      source_module: "agent:qa",
      title: "Dictamen pericial sin ratificación ante el juez de control",
      description: "El perito no compareció a ratificar su dictamen.",
    });
    const a = analysisWith([llmA, llmB, detA, detB]);
    applyConsensus(a);
    // Same raw engine count on both clusters.
    expect(detA.agreement).toBe(2);
    expect(llmA.agreement).toBe(2);
    // Different weighted agreement.
    expect(detA.agreement_weight).toBeCloseTo(DETERMINISTIC_VOICE_WEIGHT + LLM_VOICE_WEIGHT);
    expect(llmA.agreement_weight).toBeCloseTo(LLM_VOICE_WEIGHT * 2);
    rankFindings(a);
    const ids = a.Findings.map((f) => f.id);
    expect(ids.slice(0, 2).sort()).toEqual([detA.id, detB.id].sort());
  });

  it("pushes a disputed cluster below an undisputed one of equal weight", () => {
    const a = analysisWith([
      finding({ source_module: "engine:a", severity: "critical" }),
      finding({ source_module: "agent:qa", severity: "info" }),
      finding({
        source_module: "engine:c",
        category: "evidencia",
        severity: "high",
        title: "Dictamen pericial sin ratificación ante el juez",
        description: "El perito no compareció a ratificar su dictamen.",
      }),
    ]);
    applyConsensus(a);
    rankFindings(a);
    expect(a.Findings[0].finding_status).not.toBe("disputed");
  });

  it("leaves findings with no consensus data ordered exactly as before", () => {
    const a = analysisWith([
      finding({ confidence: 0.4, title: "Hallazgo débil" }),
      finding({ confidence: 0.9, title: "Hallazgo fuerte" }),
    ]);
    rankFindings(a); // no applyConsensus
    expect(a.Findings[0].title).toBe("Hallazgo fuerte");
  });
});

describe("consensus — persistence", () => {
  it("groups the writeback into one update per status", async () => {
    const calls: Array<{ status: string; ids: string[] }> = [];
    const db = {
      from: () => ({
        update: (patch: { finding_status: string }) => ({
          eq: () => ({
            in: (_col: string, ids: string[]) => {
              calls.push({ status: patch.finding_status, ids });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      }),
    } as never;
    const a = analysisWith([
      finding({ source_module: "engine:a" }),
      finding({ source_module: "engine:b", title: "Otro hallazgo distinto de plazos", category: "procesal" }),
      finding({ source_module: "engine:c", citations: [], title: "Tercero sin cita alguna", category: "riesgo" }),
    ]);
    applyConsensus(a);
    const res = await persistFindingStatuses(db, "case-1", a);
    expect(res.ok).toBe(true);
    expect(res.updated).toBe(3);
    expect(calls.length).toBeLessThanOrEqual(4);
    expect(new Set(calls.map((c) => c.status))).toEqual(new Set(["verified", "candidate"]));
  });

  it("never throws when the writeback fails", async () => {
    const db = {
      from: () => ({
        update: () => ({ eq: () => ({ in: () => Promise.resolve({ error: { message: "rls" } }) }) }),
      }),
    } as never;
    const a = analysisWith([finding({ source_module: "engine:a" })]);
    applyConsensus(a);
    const res = await persistFindingStatuses(db, "case-1", a);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("rls");
  });
});

describe("citation quality — Spanish conclusion verbs", () => {
  function run(text: string, citations = [] as CaseAnalysis["Findings"][number]["citations"]) {
    const a = analysisWith([finding({ title: text, description: text, citations })]);
    enforceCitationQuality(a);
    return a.Findings[0];
  }

  it("demotes an unsupported Spanish legal conclusion", () => {
    const f = run("La omisión constituye una violación al debido proceso");
    expect(f.title).toContain("podría constituir");
    expect(f.verification_status).toBe("demoted_unsupported");
  });

  it("demotes 'acredita', 'vulnera' and 'es responsable'", () => {
    expect(run("El acta acredita el hecho").title).toContain("tiende a acreditar");
    expect(run("La detención vulnera el artículo 16").title).toContain("podría vulnerar");
    expect(run("El imputado es responsable del daño").title).toContain("podría ser responsable");
  });

  it("leaves a fully cited Spanish conclusion untouched", () => {
    const f = run("La detención constituye una violación al artículo 16", [CITE]);
    expect(f.title).toContain("constituye una violación");
    expect(f.verification_status).not.toBe("demoted_unsupported");
  });

  it("does not fire on neutral Spanish prose", () => {
    const f = run("El documento fue recibido el 3 de marzo");
    expect(f.title).toBe("El documento fue recibido el 3 de marzo");
  });
});
