// Phase 2 tests: projection adapters + the safety contract that projection
// cannot move any pre-existing counter.

import { describe, expect, it } from "vitest";
import {
  buildProjectionRows,
  isProjectionEnabled,
  projectCaseFindings,
  PROJECTABLE_TABLES,
} from "@/lib/intelligence/project-findings.server";
import {
  classifyFindingSource,
  getFindingMetrics,
  selectFindings,
} from "@/lib/intelligence/finding-selection";

const EVIDENCE_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    classification: "contradictoria",
    title: "Discrepancia entre el parte informativo y el dictamen pericial",
    description: "El parte sitúa el aseguramiento a las 22:10; el dictamen a las 23:40.",
    severity: "critical",
    confidence: 0.82,
    affected_party: "imputado",
    citations: [{ page: 4 }],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    classification: "cadena_de_custodia",
    title: "Registro de cadena de custodia incompleto",
    description: "Falta el eslabón de traslado al almacén de evidencia.",
    severity: "medium",
    confidence: 61, // 0-100 form
  },
  { id: "44444444-4444-4444-8444-444444444444", title: "   " }, // untitled => skipped
];

const WITNESS_ROWS = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Nava Cortés",
    role: "testigo_presencial",
    credibility_risk: 82,
    reliability: 40,
    consistency: 35,
    rationale: "Tres versiones incompatibles sobre la hora de los hechos.",
    source_doc_ids: ["66666666-6666-4666-8666-666666666666"],
  },
  { id: "77777777-7777-4777-8777-777777777777", name: "Perito Oficial", credibility_risk: 55 },
  { id: "88888888-8888-4888-8888-888888888888", name: "Testigo limpio", credibility_risk: 12 },
];

describe("projection registry", () => {
  it("mirrors only the tables that carry finding-grade signal", () => {
    expect(PROJECTABLE_TABLES.sort()).toEqual(["case_witnesses", "evidence_classifications"]);
  });

  it("never projects timeline events (chronology is not a finding)", () => {
    expect(PROJECTABLE_TABLES).not.toContain("case_timeline_events");
    expect(buildProjectionRows("case_timeline_events", [{ id: "x" }])).toEqual([]);
  });

  it("ignores unknown tables instead of throwing", () => {
    expect(buildProjectionRows("cases", [{ id: "x" }])).toEqual([]);
  });
});

describe("evidence_classifications adapter", () => {
  const rows = buildProjectionRows("evidence_classifications", EVIDENCE_ROWS);

  it("skips rows without a usable title", () => {
    expect(rows.length).toBe(2);
  });

  it("preserves severity and the Mexican classification vocabulary verbatim", () => {
    expect(rows[0].severity).toBe("critical");
    expect(rows[0].evidence_type).toBe("contradictoria");
    expect(rows[1].evidence_type).toBe("cadena_de_custodia");
    expect(rows[0].tags).toContain("clasificacion:contradictoria");
  });

  it("normalizes 0-100 confidence into 0-1 and leaves 0-1 alone", () => {
    expect(rows[0].confidence).toBe(0.82);
    expect(rows[1].confidence).toBe(0.61);
  });

  it("stamps the provenance the unique index depends on", () => {
    expect(rows[0].metadata.projected_from).toEqual({
      table: "evidence_classifications",
      row_id: EVIDENCE_ROWS[0].id,
    });
  });

  it("carries only valid uuids into source_doc_ids", () => {
    expect(rows[0].source_doc_ids).toEqual([EVIDENCE_ROWS[0].document_id]);
    expect(rows[1].source_doc_ids).toEqual([]);
  });
});

describe("case_witnesses adapter", () => {
  const rows = buildProjectionRows("case_witnesses", WITNESS_ROWS);

  it("projects only witnesses that carry an actual credibility risk", () => {
    expect(rows.map((r) => r.title)).toEqual([
      "Riesgo de credibilidad: Nava Cortés",
      "Riesgo de credibilidad: Perito Oficial",
    ]);
  });

  it("grades severity from the risk index", () => {
    expect(rows[0].severity).toBe("critical"); // 82
    expect(rows[1].severity).toBe("medium"); // 55
  });

  it("falls back to a factual description when the engine gave no rationale", () => {
    expect(rows[0].description).toBe(WITNESS_ROWS[0].rationale);
    expect(rows[1].description).toContain("55/100");
  });

  it("writes everything in Spanish", () => {
    for (const r of rows) {
      expect(r.title).toMatch(/^Riesgo de credibilidad: /);
      expect(r.category).toBe("credibilidad_testimonial");
      expect(r.tags).toContain("proyeccion");
    }
  });
});

describe("Phase 2 safety contract — projection moves no existing counter", () => {
  const projected = [
    ...buildProjectionRows("evidence_classifications", EVIDENCE_ROWS),
    ...buildProjectionRows("case_witnesses", WITNESS_ROWS),
  ];
  const existing = [
    { source_module: "engine:contradictions", severity: "critical", metadata: {} },
    { source_module: "agent:chain_of_custody", severity: "high", metadata: {} },
    { source_module: "analyzer:facts", severity: "critical", metadata: {} },
  ];

  it("classifies every projected row as the isolated `projection` class", () => {
    for (const r of projected) expect(classifyFindingSource(r)).toBe("projection");
  });

  it("leaves the canonical scoring/report set untouched", () => {
    const before = selectFindings(existing);
    const after = selectFindings([...existing, ...projected]);
    expect(after).toEqual(before);
    expect(after.length).toBe(2);
  });

  it("leaves the dashboard high-priority badge untouched", () => {
    const opts = {
      include: ["engine", "agent", "analyzer", "other"] as const,
      includeProvisional: true,
      severities: ["critical", "high"] as const,
    };
    expect(selectFindings([...existing, ...projected], opts).length).toBe(
      selectFindings(existing, opts).length,
    );
  });

  it("leaves canonical and highPriority metrics untouched while total grows", () => {
    const before = getFindingMetrics(existing);
    const after = getFindingMetrics([...existing, ...projected]);
    expect(after.canonical).toBe(before.canonical);
    expect(after.highPriority).toBe(before.highPriority);
    expect(after.bySource.projection).toBe(projected.length);
    expect(after.total).toBe(before.total + projected.length);
  });

  it("marks projected rows as candidate only — never promoted", () => {
    for (const r of projected) {
      expect(selectFindings([r], { include: ["projection"], statuses: ["promoted"] })).toEqual([]);
      expect(selectFindings([r], { include: ["projection"], statuses: ["candidate"] }).length).toBe(1);
    }
  });
});

describe("multi-tenant validation", () => {
  it("adapters never emit a case_id or user_id — the SQL function owns tenancy", () => {
    const rows = [
      ...buildProjectionRows("evidence_classifications", EVIDENCE_ROWS),
      ...buildProjectionRows("case_witnesses", WITNESS_ROWS),
    ];
    for (const r of rows) {
      expect(r).not.toHaveProperty("case_id");
      expect(r).not.toHaveProperty("user_id");
      expect(Object.keys(r.metadata)).not.toContain("user_id");
    }
  });

  it("provenance row_id is scoped per source table so two tenants cannot collide", () => {
    // Identity is (case_id, table, row_id); case_id is supplied server-side
    // by the RPC from public.cases, never by the caller.
    const a = buildProjectionRows("case_witnesses", WITNESS_ROWS)[0];
    const b = buildProjectionRows("evidence_classifications", EVIDENCE_ROWS)[0];
    expect((a.metadata.projected_from as { table: string }).table).toBe("case_witnesses");
    expect((b.metadata.projected_from as { table: string }).table).toBe("evidence_classifications");
  });
});

describe("rollout flag", () => {
  it("is off unless FINDINGS_PROJECTION_ENABLED is exactly true", () => {
    const prev = process.env.FINDINGS_PROJECTION_ENABLED;
    try {
      delete process.env.FINDINGS_PROJECTION_ENABLED;
      expect(isProjectionEnabled()).toBe(false);
      process.env.FINDINGS_PROJECTION_ENABLED = "1";
      expect(isProjectionEnabled()).toBe(false);
      process.env.FINDINGS_PROJECTION_ENABLED = "TRUE";
      expect(isProjectionEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FINDINGS_PROJECTION_ENABLED;
      else process.env.FINDINGS_PROJECTION_ENABLED = prev;
    }
  });

  it("writes nothing while the flag is off", async () => {
    const prev = process.env.FINDINGS_PROJECTION_ENABLED;
    delete process.env.FINDINGS_PROJECTION_ENABLED;
    const db = {
      from: () => {
        throw new Error("projection must not touch the database while disabled");
      },
    } as never;
    const res = await projectCaseFindings(db, {
      caseId: "99999999-9999-4999-8999-999999999999",
      tables: ["evidence_classifications", "case_witnesses"],
    });
    expect(res).toEqual({ ok: true, tables: [], candidates: 0, written: 0, disabled: true });
    if (prev !== undefined) process.env.FINDINGS_PROJECTION_ENABLED = prev;
  });
});
