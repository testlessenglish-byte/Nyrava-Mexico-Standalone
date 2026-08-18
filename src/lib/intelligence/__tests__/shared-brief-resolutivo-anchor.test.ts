// Regression coverage for briefToPrompt's resolutivo_verbatim anchoring —
// companion to resolutivo-parser.test.ts (which covers extraction itself)
// and shared-brief.server.ts's own doc comment on the field.
//
// Real case: Amparo Directo en Revisión 5829/2025 — multi-agent
// perspectives AND strategy synthesis both asserted the opposite of what
// the sentencia's own resolutivo actually granted. Root cause: every
// downstream engine reads ONLY the compact SharedBrief (built from a
// 70,000-char-budget corpus slice), never the raw documents — so once the
// brief's own LLM-generated case_summary inverted the holding (plausible
// when the dispositive section, which sits at the end of a Mexican
// judgment, falls outside the truncation budget), every consumer inherited
// the same error simultaneously. briefToPrompt's old behavior — building
// a JSON blob and then blindly `.slice(0, maxChars)`-ing it — would have
// silently dropped a verbatim resolutivo anchor placed at the end of that
// same JSON exactly like it dropped the original corpus. This suite proves
// the anchor is never truncated away, regardless of how large the rest of
// the brief is or how tight the caller's maxChars budget is.
import { describe, it, expect } from "vitest";
import { briefToPrompt, type SharedBrief } from "../shared-brief.server";

function makeBrief(overrides: Partial<SharedBrief> = {}): SharedBrief {
  return {
    case_summary: "Resumen del caso.",
    parties: [],
    key_entities: [],
    timeline: [],
    key_facts: [],
    issues: [],
    evidence_inventory: [],
    contradictions: [],
    open_questions: [],
    document_index: [],
    generated_at: new Date().toISOString(),
    model: "test-model",
    source_doc_ids: [],
    resolutivo_verbatim: null,
    ...overrides,
  };
}

describe("briefToPrompt — resolutivo_verbatim anchor", () => {
  it("is a no-op when resolutivo_verbatim is null (backward compatible)", () => {
    const brief = makeBrief();
    const prompt = briefToPrompt(brief, 500);
    expect(prompt).not.toContain("RESOLUTIVO_VERBATIM");
    expect(prompt.length).toBeLessThanOrEqual(500);
  });

  it("always includes the resolutivo text even under a tight maxChars budget", () => {
    const resolutivo =
      "--- sentencia_scjn.pdf ---\nSEGUNDO. La Justicia de la Unión ampara y protege al quejoso " +
      "en contra del acto reclamado por la autoridad responsable.";
    const brief = makeBrief({
      case_summary: "X".repeat(2000), // large enough to normally dominate a tight budget
      resolutivo_verbatim: resolutivo,
    });
    const prompt = briefToPrompt(brief, 300);
    expect(prompt).toContain(resolutivo);
    expect(prompt).toContain("RESOLUTIVO_VERBATIM");
  });

  it("the real reported bug shape: never drops the anchor behind a large compact JSON blob", () => {
    const resolutivo =
      "--- sentencia_scjn.pdf ---\nSEGUNDO. Se concede el amparo y protección de la justicia federal.";
    const brief = makeBrief({
      case_summary: "Y".repeat(15000),
      key_facts: Array.from({ length: 50 }, (_, i) => ({ fact: `hecho ${i}`.repeat(20) })),
      resolutivo_verbatim: resolutivo,
    });
    const prompt = briefToPrompt(brief, 16000);
    expect(prompt.endsWith(resolutivo)).toBe(true);
  });

  it("labels the anchor as authoritative over the rest of the brief", () => {
    const brief = makeBrief({ resolutivo_verbatim: "PRIMERO. Se revoca la sentencia recurrida." });
    const prompt = briefToPrompt(brief);
    expect(prompt).toMatch(/AUTORIDAD MÁXIMA/);
  });
});
