// Regression test for Phase 1 item #1 of the "Universal Completed Case
// Legal Audit Architecture Fix": the judicial-hierarchy taxonomy
// (speaker_role/proposition_type/adoption_status — finding-taxonomy.ts) was
// previously requested by only ONE prompt (the analyzers stage's
// contradictions/key_findings buckets), so every other finding-producing
// engine — including the 11 amparo/constitucional specialized agents most
// likely to encounter multi-instance judicial review — never asked the LLM
// for it, and the fields stayed null for their findings. This asserts every
// targeted agent's prompt now carries both the schema fragment and the
// instructional paragraph, sourced from the SAME shared module the
// analyzers stage and findings.server.ts's normalizers already use — and
// that agents outside the intended scope were NOT touched.
//
// FOLLOW-UP: confirmed on a real completed-case audit (ADR-4321-2017-180507)
// that audit_classification (case-analysis-mode.ts's completed-case
// taxonomy) had the EXACT same bug — getCaseAnalysisObjective() already
// injects the instructional prose into these same 11 agents' preamble, but
// none of their JSON schemas listed the field itself, so it came back null
// on every finding except ways_out_analysis (whose own hand-written schema
// happened to already ask for it). Same fix, same shared-fragment pattern,
// spliced immediately after the judicial-hierarchy fragment.
import { describe, it, expect } from "vitest";
import {
  judicialHierarchyInstructions,
  judicialHierarchySchemaFragment,
  auditClassificationSchemaFragment,
} from "../finding-taxonomy";

const WIRED_AGENT_TYPES = [
  "witness_credibility",
  "chain_of_custody",
  "constitutional_compliance",
  "procedural_violations",
  "standing_procedencia",
  "suspension_analysis",
  "conventionality_pro_persona",
  "constitutional_rights_mapping",
  "authority_notification_validation",
  "international_human_rights_analysis",
  "constitutional_controversy_analysis",
];

// A representative sample of agents deliberately OUT of Phase 1 item #1's
// scope (other materias' specialized investigators) — must be untouched.
const UNWIRED_AGENT_TYPES = [
  "search_warrant_arrest_legality",
  "property_verification",
  "lft_compliance_review",
  "ways_out_analysis",
];

describe("AGENTS array: judicial-hierarchy taxonomy wiring", () => {
  it("every targeted amparo/constitucional agent's prompt carries the shared schema fragment and instructions", async () => {
    const { __test__AGENTS } = await import("@/lib/pipeline.server");
    const fragment = judicialHierarchySchemaFragment();
    const instructions = judicialHierarchyInstructions();
    const byType = new Map(__test__AGENTS.map((a) => [a.type, a]));

    for (const type of WIRED_AGENT_TYPES) {
      const agent = byType.get(type);
      expect(agent, `agent "${type}" not found in AGENTS`).toBeDefined();
      expect(agent!.prompt, `${type} prompt missing schema fragment`).toContain(fragment);
      expect(agent!.prompt, `${type} prompt missing instructions`).toContain(instructions);
    }
  });

  it("agents outside Phase 1 item #1's scope were not touched", async () => {
    const { __test__AGENTS } = await import("@/lib/pipeline.server");
    const fragment = judicialHierarchySchemaFragment();
    const byType = new Map(__test__AGENTS.map((a) => [a.type, a]));

    for (const type of UNWIRED_AGENT_TYPES) {
      const agent = byType.get(type);
      expect(agent, `agent "${type}" not found in AGENTS`).toBeDefined();
      expect(agent!.prompt, `${type} prompt unexpectedly carries the JH fragment`).not.toContain(
        fragment,
      );
    }
  });

  it("every wired agent's schema carries speaker_role/... immediately followed by audit_classification, then evidence_refs", async () => {
    const { __test__AGENTS } = await import("@/lib/pipeline.server");
    const fragment = judicialHierarchySchemaFragment();
    const auditFragment = auditClassificationSchemaFragment();
    const byType = new Map(__test__AGENTS.map((a) => [a.type, a]));

    for (const type of WIRED_AGENT_TYPES) {
      const prompt = byType.get(type)!.prompt;
      expect(prompt).toContain(`${fragment}, ${auditFragment}, "evidence_refs":`);
    }
  });

  it("every targeted agent's prompt also carries the shared audit_classification fragment", async () => {
    const { __test__AGENTS } = await import("@/lib/pipeline.server");
    const auditFragment = auditClassificationSchemaFragment();
    const byType = new Map(__test__AGENTS.map((a) => [a.type, a]));

    for (const type of WIRED_AGENT_TYPES) {
      const agent = byType.get(type);
      expect(
        agent!.prompt,
        `${type} prompt missing shared audit_classification fragment`,
      ).toContain(auditFragment);
    }
  });

  it("agents outside Phase 1 item #1's scope do not carry the SHARED audit_classification fragment (ways_out_analysis keeps its own independently-defined field)", async () => {
    const { __test__AGENTS } = await import("@/lib/pipeline.server");
    const auditFragment = auditClassificationSchemaFragment();
    const byType = new Map(__test__AGENTS.map((a) => [a.type, a]));

    for (const type of UNWIRED_AGENT_TYPES) {
      const agent = byType.get(type);
      expect(agent, `agent "${type}" not found in AGENTS`).toBeDefined();
      expect(
        agent!.prompt,
        `${type} prompt unexpectedly carries the shared audit_classification fragment`,
      ).not.toContain(auditFragment);
    }
  });
});
