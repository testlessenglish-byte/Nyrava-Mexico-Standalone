import { describe, it, expect } from "vitest";
import {
  GLOBAL_CLAIM_TAXONOMY,
  resolveClaimType,
  computeExactMatchId,
  computeCanonicalFindingId,
  finalizeFindings,
  buildRegistrySnapshot,
  assertFinalized,
  isValidClaimType,
  detectAssertionPolarity,
  detectProducerConflict,
} from "../canonical-id";
import type { NewFinding } from "../types";

function f(over: Partial<NewFinding>): NewFinding {
  return {
    case_id: "c1",
    user_id: "u1",
    source_module: "engine:test",
    category: "contradiction",
    title: "Witness height conflict",
    description: "Witness A says 5'10, Witness B says 6'2",
    severity: "high",
    confidence: 0.8,
    legal_significance: null,
    potential_impact: null,
    affected_party: null,
    source_doc_ids: ["d1", "d2"],
    evidence_refs: [],
    ...over,
  } as NewFinding;
}

describe("canonical taxonomy", () => {
  it("rejects non-taxonomy claim types via resolveClaimType fallback", () => {
    expect(isValidClaimType("suspect_height_discrepancy")).toBe(true);
    expect(isValidClaimType("totally_made_up_type")).toBe(false);
    expect(resolveClaimType({ category: "totally_made_up_type", title: "height issue", description: "" })).toBe(
      "suspect_height_discrepancy",
    );
  });

  it("maps every taxonomy entry to itself", () => {
    for (const t of GLOBAL_CLAIM_TAXONOMY) {
      expect(resolveClaimType({ raw: t })).toBe(t);
    }
  });
});

describe("ID ordering invariants", () => {
  it("computes deterministic exact_match_id and canonical_finding_id", () => {
    const id1 = computeExactMatchId({
      claim_type: "suspect_height_discrepancy",
      source_doc_ids: ["d2", "d1"],
      title: "A",
      description: "B",
    });
    const id2 = computeExactMatchId({
      claim_type: "suspect_height_discrepancy",
      source_doc_ids: ["d1", "d2"],
      title: "A",
      description: "B",
    });
    expect(id1).toBe(id2);
    const c1 = computeCanonicalFindingId({
      category: "contradiction",
      claim_type: "suspect_height_discrepancy",
      source_doc_ids: ["d1"],
    });
    const c2 = computeCanonicalFindingId({
      category: "Contradiction",
      claim_type: "suspect_height_discrepancy",
      source_doc_ids: ["d1"],
    });
    expect(c1).toBe(c2);
  });

  it("collapses byte-identical findings via exact dedup BEFORE canonical id", () => {
    const r1 = f({});
    const r2 = f({});
    const { finalized, stats } = finalizeFindings([r1, r2]);
    expect(stats.exact_collapsed).toBe(1);
    expect(finalized).toHaveLength(1);
  });

  it("merges different wording into same canonical id with merged_from metadata", () => {
    const r1 = f({ title: "Height conflict A", description: "5 ten vs 6 two" });
    const r2 = f({
      title: "Height conflict B",
      description: "wholly different wording but same height issue",
      confidence: 0.9,
      source_module: "engine:agent",
    });
    const { finalized, stats } = finalizeFindings([r1, r2]);
    expect(stats.canonical_merged).toBe(1);
    expect(finalized).toHaveLength(1);
    const meta = finalized[0].metadata as Record<string, unknown>;
    expect(Array.isArray(meta.merged_from)).toBe(true);
    expect((meta.merged_from as unknown[]).length).toBe(1);
  });

  it("does NOT merge distinct findings that share category+claim_type but have no source_doc_ids (regression: witness collision)", () => {
    // Mirrors the real-world bug: engines.server.ts's witness engine never
    // populated source_doc_ids, so every witness in a case shared an
    // identical category ("witness") and claim_type
    // ("witness_credibility_issue"). Before the title fallback, this
    // collapsed distinct witnesses into a single finding and silently
    // discarded the rest via merged_from.
    const coulter = f({
      category: "witness",
      title: "Witness profile: Brendan Coulter (Vice President of Engineering)",
      description: "Reliability 65/100 · Bias 80 · Credibility risk 47/100 (computed)",
      source_doc_ids: [],
    });
    const natarajan = f({
      category: "witness",
      title: "Witness profile: Priya Natarajan (Plaintiff, Director of Analytics)",
      description: "Reliability 90/100 · Bias 30 · Credibility risk 20/100 (computed)",
      source_doc_ids: [],
    });
    const patel = f({
      category: "witness",
      title: "Witness profile: Renee Patel (Chief People Officer (HR))",
      description: "Reliability 85/100 · Bias 40 · Credibility risk 24/100 (computed)",
      source_doc_ids: [],
    });
    const { finalized, stats } = finalizeFindings([coulter, natarajan, patel]);
    expect(stats.canonical_merged).toBe(0);
    expect(finalized).toHaveLength(3);
  });

  it("does NOT merge distinct witnesses even once source_doc_ids IS populated and overlaps (regression: shared-document collision)", () => {
    // Now that engines.server.ts populates source_doc_ids from evidence
    // citations, two different witnesses cited from the very same document
    // (routine — e.g. both named in the Complaint) must still stay
    // separate. Witness findings are entity-scoped, not claim-scoped.
    const coulter = f({
      category: "witness",
      title: "Witness profile: Brendan Coulter (Vice President of Engineering)",
      description: "Reliability 65/100 · Bias 80 · Credibility risk 47/100 (computed)",
      source_doc_ids: ["complaint.txt"],
    });
    const natarajan = f({
      category: "witness",
      title: "Witness profile: Priya Natarajan (Plaintiff, Director of Analytics)",
      description: "Reliability 90/100 · Bias 30 · Credibility risk 20/100 (computed)",
      source_doc_ids: ["complaint.txt"],
    });
    const { finalized, stats } = finalizeFindings([coulter, natarajan]);
    expect(stats.canonical_merged).toBe(0);
    expect(finalized).toHaveLength(2);
  });
});

describe("analyzer vs engine separation", () => {
  it("flags analyzer-only findings as provisional", () => {
    const a = f({ source_module: "analyzer:contradiction" });
    const { finalized } = finalizeFindings([a]);
    const meta = finalized[0].metadata as Record<string, unknown>;
    expect(meta.provisional).toBe(true);
    expect(meta.final).toBe(false);
  });
  it("merged engine + analyzer becomes authoritative", () => {
    const a = f({ source_module: "analyzer:contradiction", title: "x" });
    const e = f({ source_module: "engine:contradictions", title: "x" });
    const { finalized } = finalizeFindings([a, e]);
    expect(finalized).toHaveLength(1);
    const meta = finalized[0].metadata as Record<string, unknown>;
    expect(meta.final).toBe(true);
    expect(meta.provisional).toBe(false);
  });
});

describe("finalization barrier", () => {
  it("blocks consumers when state is not finalized", () => {
    const snap = buildRegistrySnapshot({ finalized: [], invalid: 0, warnings: [] });
    expect(() => assertFinalized(snap, "test")).not.toThrow();
    expect(() => assertFinalized({ ...snap, state: "draft" }, "test")).toThrow(/finalization-barrier/);
  });
  it("flags taxonomy violations in the snapshot", () => {
    const snap = buildRegistrySnapshot({ finalized: [], invalid: 3, warnings: ["x_failed"] });
    expect(snap.invariants.taxonomy_violations).toBe(3);
    expect(snap.pipeline_warnings).toContain("x_failed");
    expect(() => assertFinalized(snap, "test")).toThrow();
  });
});

// ============================================================================
// Canonical Reconciliation Design (2026-08-16) — cross-producer conflict
// detection. Real-shape regression: the analyzer's own contradiction pass
// affirmatively concludes "no existe contradicción" for a claim, while the
// report-writer's independent intelligence chunk affirmatively concludes
// "sí existe contradicción" about the same claim. Before this fix,
// finalizeFindings would have silently merged the two (severity-winner
// takes all), discarding whichever side lost with no record a disagreement
// ever happened.
// ============================================================================
describe("detectAssertionPolarity", () => {
  it("reads an explicit negation marker as negative", () => {
    expect(detectAssertionPolarity("El tribunal concluyó que no existe contradicción alguna.")).toBe(
      "negative",
    );
  });
  it("reads an explicit affirmation marker as affirmative", () => {
    expect(detectAssertionPolarity("La declaración contradice directamente el testimonio previo.")).toBe(
      "affirmative",
    );
  });
  it("returns unknown when no explicit marker is present", () => {
    expect(detectAssertionPolarity("El testigo declaró sobre los hechos del caso.")).toBe("unknown");
  });
});

describe("detectProducerConflict", () => {
  it("returns null when both findings come from the same producer family", () => {
    const a = f({
      source_module: "analyzer:contradiction",
      title: "Fechas de notificación",
      description: "No existe contradicción entre los documentos.",
    });
    const b = f({
      source_module: "analyzer:key",
      title: "Fechas de notificación",
      description: "La declaración contradice directamente el acta previa.",
    });
    expect(detectProducerConflict(a, b)).toBeNull();
  });

  it("returns null when neither side carries an explicit polarity marker", () => {
    const a = f({ source_module: "analyzer:contradiction", title: "x", description: "y" });
    const b = f({ source_module: "report_writer:contradiction", title: "x", description: "z" });
    expect(detectProducerConflict(a, b)).toBeNull();
  });

  it("detects a genuine cross-producer disagreement (real ADR-5829-shaped case)", () => {
    const analyzerFinding = f({
      source_module: "analyzer:contradiction",
      title: "Art. 230 LISSSTE",
      description: "No se advierte contradicción entre el acuerdo y la resolución impugnada.",
    });
    const reportWriterFinding = f({
      source_module: "report_writer:contradiction",
      title: "Art. 230 LISSSTE",
      description: "La resolución contradice expresamente el acuerdo previamente notificado.",
    });
    const conflict = detectProducerConflict(analyzerFinding, reportWriterFinding);
    expect(conflict).not.toBeNull();
    expect(conflict?.claim_a.source_module).toBe("analyzer:contradiction");
    expect(conflict?.claim_b.source_module).toBe("report_writer:contradiction");
  });
});

describe("finalizeFindings — conflict routing", () => {
  it("routes a real cross-producer disagreement to unresolved instead of silently merging", () => {
    const analyzerFinding = f({
      source_module: "analyzer:contradiction",
      title: "Art. 230 LISSSTE",
      description: "No se advierte contradicción entre el acuerdo y la resolución impugnada.",
      severity: "low",
      source_doc_ids: ["d1"],
    });
    const reportWriterFinding = f({
      source_module: "report_writer:contradiction",
      title: "Art. 230 LISSSTE",
      description: "La resolución contradice expresamente el acuerdo previamente notificado.",
      severity: "high",
      source_doc_ids: ["d1"],
    });
    const { finalized, stats } = finalizeFindings([analyzerFinding, reportWriterFinding]);
    expect(finalized).toHaveLength(1);
    expect(stats.canonical_merged).toBe(1);
    const meta = finalized[0].metadata as Record<string, unknown>;
    expect(meta.reconciliation_state).toBe("unresolved");
    expect(meta.merged_from).toBeUndefined();
    const conflict = meta.conflict as { claim_a: { source_module: string }; claim_b: { source_module: string } };
    expect(conflict.claim_a.source_module).toBe("analyzer:contradiction");
    expect(conflict.claim_b.source_module).toBe("report_writer:contradiction");
  });

  it("still merges ordinary duplicate restatements from different producers (no polarity marker)", () => {
    // Different wording (so exact_match_id does NOT collapse them before the
    // canonical-merge collision loop even runs — see the identical-wording
    // case just above, which exercises that earlier exact-dedup step
    // instead) but no explicit negation/affirmation marker in either.
    const a = f({
      source_module: "analyzer:contradiction",
      title: "Height conflict A",
      description: "5 ten vs 6 two",
      severity: "low",
    });
    const b = f({
      source_module: "report_writer:contradiction",
      title: "Height conflict B",
      description: "wholly different wording but same height issue",
      severity: "high",
    });
    const { finalized } = finalizeFindings([a, b]);
    expect(finalized).toHaveLength(1);
    const meta = finalized[0].metadata as Record<string, unknown>;
    expect(meta.reconciliation_state).toBeUndefined();
    expect(Array.isArray(meta.merged_from)).toBe(true);
  });
});
