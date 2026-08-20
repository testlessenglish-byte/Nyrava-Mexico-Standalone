import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("stale-data and persistence guard coverage", () => {
  it("full rerun clears decision reconstruction and finding patches", () => {
    const source = read("src/lib/pipeline-reset.ts");
    expect(source).toContain('"case_decision_reconstructions"');
    expect(source).toContain('"case_finding_patches"');
  });

  it("database migration guards every persistence surface used by ADR exports", () => {
    const sql = read("supabase/migrations/20260820023500_guard_coverage_and_reset_integrity.sql");
    expect(sql).toContain("trg_nyrava_guard_case_finding_personal_notice");
    expect(sql).toContain("trg_nyrava_sanitize_analysis_personal_notice");
    expect(sql).toContain("trg_nyrava_sanitize_agent_finding_personal_notice");
    expect(sql).toContain("trg_nyrava_sanitize_agent_log_personal_notice");
    expect(sql).toContain("trg_nyrava_enforce_released_case_terminal_state");
    expect(sql).toContain("next_stage, worker_lease_until ON public.cases");
  });

  it("factory reset includes current provenance and stale-derived tables", () => {
    const sql = read("supabase/migrations/20260820023500_guard_coverage_and_reset_integrity.sql");
    const preview = read("src/lib/factory-reset.functions.ts");
    for (const table of [
      "pipeline_trace",
      "cross_agent_audit",
      "finding_version_snapshots",
      "case_outcome_assessments",
      "case_decision_reconstructions",
      "case_finding_patches",
      "verification_items",
    ]) {
      expect(sql).toContain(`'${table}'`);
      expect(preview).toContain(`"${table}"`);
    }
  });

  it("preserves the current service-role-only factory reset RPC contract", () => {
    const sql = read("supabase/migrations/20260820023500_guard_coverage_and_reset_integrity.sql");
    const caller = read("src/lib/factory-reset.functions.ts");
    expect(sql).toContain("p_actor_id uuid DEFAULT NULL");
    expect(sql).toContain("service role required");
    expect(sql).toContain("TO service_role");
    expect(caller).toContain("p_actor_id: context.userId");
  });

  it("the persistence guard is corpus-aware, not cache-aware", () => {
    const sql = read("supabase/migrations/20260820023500_guard_coverage_and_reset_integrity.sql");
    expect(sql).toContain("nyrava_case_denies_personal_notice_duty");
    expect(sql).toContain("documents d");
    expect(sql).toContain("extracted_text");
  });
});
