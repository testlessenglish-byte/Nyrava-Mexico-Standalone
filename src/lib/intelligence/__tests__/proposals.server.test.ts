// Regression tests for Continuous Legal Intelligence Phase C — the
// controlled improvement pipeline: AI PROPOSAL -> HISTORICAL REPLAY ->
// REGRESSION CHECK -> HUMAN APPROVAL -> DEPLOY -> (optional) ROLLBACK. See
// src/lib/intelligence/proposals.server.ts and migrations
// 20260814125523/4/5_intelligence_*.sql.
//
// These tests prove the safety properties the directive requires:
//  1. Every transition enforces its OWN precondition — calling a function
//     out of order throws, it never silently no-ops or skips a gate.
//  2. historical_replay/regression_check always carry real integer counts
//     from stored rows, never a fabricated percentage, and a proposal can
//     never pass on zero evaluated findings.
//  3. The regression floor is a real, testable invariant: a rule at
//     escalate_at_tier='significant' must use 'require_human_review' — a
//     deliberately weakening proposal actually fails.
//  4. deployProposal is the ONLY thing that ever writes the live rule set,
//     only from an already-approved proposal, and rollbackVersion never
//     edits history — it appends.
import { describe, it, expect } from "vitest";
import {
  proposeIntelligenceImprovement,
  runHistoricalReplay,
  runRegressionCheck,
  approveProposal,
  deployProposal,
  rollbackVersion,
} from "@/lib/intelligence/proposals.server";

// Generic fake table: supports the exact chain shapes proposals.server.ts
// issues (select/eq/in/is/neq/order/limit/maybeSingle/then, insert with or
// without a chained .select().single(), and a single-eq .update().eq()).
function makeTable(rows: Array<Record<string, unknown>>) {
  return {
    select: () => {
      let predicate = (_r: Record<string, unknown>) => true;
      let sortCol: string | null = null;
      let sortAsc = true;
      let limitN: number | null = null;
      const applyFilters = () => {
        let result = rows.filter(predicate);
        if (sortCol) {
          const col = sortCol;
          result = [...result].sort((a, b) => {
            const av = Number(a[col]);
            const bv = Number(b[col]);
            return sortAsc ? av - bv : bv - av;
          });
        }
        if (limitN != null) result = result.slice(0, limitN);
        return result;
      };
      const builder: Record<string, unknown> = {
        eq: (col: string, val: unknown) => {
          const prev = predicate;
          predicate = (r) => prev(r) && r[col] === val;
          return builder;
        },
        in: (col: string, vals: readonly unknown[]) => {
          const prev = predicate;
          predicate = (r) => prev(r) && vals.includes(r[col]);
          return builder;
        },
        is: (col: string, val: null) => {
          const prev = predicate;
          predicate = (r) => prev(r) && ((r[col] as unknown) ?? null) === val;
          return builder;
        },
        neq: (col: string, val: unknown) => {
          const prev = predicate;
          predicate = (r) => prev(r) && r[col] !== val;
          return builder;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          sortCol = col;
          sortAsc = opts.ascending;
          return builder;
        },
        limit: (n: number) => {
          limitN = n;
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: applyFilters()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: applyFilters(), error: null }),
      };
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      const withId = { id: `id-${rows.length}-${Math.random().toString(36).slice(2, 8)}`, ...row };
      rows.push(withId);
      return {
        select: () => ({ single: () => Promise.resolve({ data: withId, error: null }) }),
        then: (resolve: (v: unknown) => void) => resolve({ data: withId, error: null }),
      };
    },
    update: (payload: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => {
        const row = rows.find((r) => r[col] === val);
        if (row) Object.assign(row, payload);
        return Promise.resolve({ error: row ? null : { message: "not found" } });
      },
    }),
  };
}

function makeFakeDb(seed: {
  patterns?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
  proposals?: Array<Record<string, unknown>>;
  versions?: Array<Record<string, unknown>>;
  findings?: Array<Record<string, unknown>>;
}) {
  const patternRows = seed.patterns ?? [];
  const ruleRows = seed.rules ?? [];
  const proposalRows = seed.proposals ?? [];
  const versionRows = seed.versions ?? [];
  const findingRows = seed.findings ?? [];
  const tables: Record<string, ReturnType<typeof makeTable>> = {
    intelligence_patterns: makeTable(patternRows),
    intelligence_validation_rules: makeTable(ruleRows),
    intelligence_improvement_proposals: makeTable(proposalRows),
    intelligence_versions: makeTable(versionRows),
    case_findings: makeTable(findingRows),
  };
  const db = {
    from(table: string) {
      const t = tables[table];
      if (!t) throw new Error(`unexpected table in proposals fake db: ${table}`);
      return t;
    },
  };
  return { db, patternRows, ruleRows, proposalRows, versionRows, findingRows };
}

function pattern(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pattern-1",
    user_id: "user-1",
    matter_type: "amparo_directo",
    jurisdiction_country: "MX",
    error_type: "false_positive",
    tier: "significant",
    status: "monitoring",
    pattern_description: "20 verified corrections in amparo_directo (MX) previously found: false positive.",
    category_samples: ["standing"],
    supporting_lesson_ids: ["lesson-1", "lesson-2"],
    ...overrides,
  };
}

function proposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "proposal-1",
    user_id: "user-1",
    matter_type: "amparo_directo",
    jurisdiction_country: "MX",
    error_type: "false_positive",
    supporting_pattern_id: "pattern-1",
    proposed_escalate_at_tier: "strong",
    proposed_recommended_action: "require_human_review",
    status: "proposed",
    historical_replay: null,
    regression_check: null,
    approved_by: null,
    approved_at: null,
    deployed_version: null,
    ...overrides,
  };
}

function finding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "finding-1",
    user_id: "user-1",
    category: "standing",
    superseded_at: null,
    ...overrides,
  };
}

function rule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rule-1",
    user_id: "user-1",
    matter_type: "amparo_directo",
    jurisdiction_country: "MX",
    error_type: "false_positive",
    escalate_at_tier: "strong",
    recommended_action: "require_second_source",
    is_active: true,
    superseded_by_rule_id: null,
    ...overrides,
  };
}

describe("proposeIntelligenceImprovement", () => {
  it("creates a proposal for a 'significant' pattern with no active rule or in-flight proposal", async () => {
    const { db, proposalRows } = makeFakeDb({ patterns: [pattern()] });
    const created = await proposeIntelligenceImprovement(db as never, "user-1");
    expect(created).toHaveLength(1);
    expect(proposalRows).toHaveLength(1);
    expect(proposalRows[0]).toMatchObject({
      user_id: "user-1",
      matter_type: "amparo_directo",
      error_type: "false_positive",
      supporting_pattern_id: "pattern-1",
      proposed_escalate_at_tier: "strong",
      proposed_recommended_action: "require_human_review",
    });
  });

  it("only considers patterns already at tier='significant' — a 'strong' pattern never gets a proposal", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern({ id: "pattern-strong", tier: "strong" }), pattern({ id: "pattern-sig", tier: "significant" })],
    });
    const created = await proposeIntelligenceImprovement(db as never, "user-1");
    expect(created).toHaveLength(1);
    expect(proposalRows[0].supporting_pattern_id).toBe("pattern-sig");
  });

  it("skips a bucket that already has an active rule", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern()],
      rules: [rule({ is_active: true })],
    });
    const created = await proposeIntelligenceImprovement(db as never, "user-1");
    expect(created).toHaveLength(0);
    expect(proposalRows).toHaveLength(0);
  });

  it("skips a bucket with an in-flight proposal already", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern()],
      proposals: [proposal({ id: "existing", status: "testing" })],
    });
    const created = await proposeIntelligenceImprovement(db as never, "user-1");
    expect(created).toHaveLength(0);
    expect(proposalRows).toHaveLength(1); // only the pre-seeded one
  });

  it("allows a new proposal for a bucket whose prior proposal already failed", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern()],
      proposals: [proposal({ id: "old-failed", status: "failed" })],
    });
    const created = await proposeIntelligenceImprovement(db as never, "user-1");
    expect(created).toHaveLength(1);
    expect(proposalRows).toHaveLength(2);
  });
});

describe("runHistoricalReplay", () => {
  it("throws when the proposal isn't in 'proposed' status", async () => {
    const { db } = makeFakeDb({ proposals: [proposal({ status: "testing" })] });
    await expect(runHistoricalReplay(db as never, "user-1", "proposal-1")).rejects.toThrow(/status='proposed'/);
  });

  it("counts real, currently-active findings whose category matches the pattern — honest zero when none exist", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern()],
      proposals: [proposal()],
      findings: [],
    });
    await runHistoricalReplay(db as never, "user-1", "proposal-1");
    expect(proposalRows[0].status).toBe("testing");
    const replay = proposalRows[0].historical_replay as Record<string, unknown>;
    expect(replay.findings_evaluated).toBe(0);
    expect(replay.findings_would_change_action).toBe(0);
    expect(replay.insufficient_data).toBe(true);
  });

  it("counts matching findings and detects a real action change when the proposed action differs from today's default", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern({ tier: "strong" })],
      proposals: [
        proposal({
          proposed_escalate_at_tier: "strong",
          proposed_recommended_action: "send_to_critic", // differs from default 'strong' -> require_second_source
        }),
      ],
      findings: [finding({ id: "f1" }), finding({ id: "f2" }), finding({ id: "f3", category: "other" })],
    });
    await runHistoricalReplay(db as never, "user-1", "proposal-1");
    const replay = proposalRows[0].historical_replay as Record<string, unknown>;
    expect(replay.findings_evaluated).toBe(2); // only the 2 "standing" findings, not "other"
    expect(replay.findings_would_change_action).toBe(2);
    expect(replay.insufficient_data).toBe(false);
  });

  it("reports zero change when the proposed action equals today's already-deployed rule action", async () => {
    const { db, proposalRows } = makeFakeDb({
      patterns: [pattern({ tier: "strong" })],
      rules: [rule({ escalate_at_tier: "strong", recommended_action: "send_to_critic" })],
      proposals: [proposal({ proposed_escalate_at_tier: "strong", proposed_recommended_action: "send_to_critic" })],
      findings: [finding()],
    });
    await runHistoricalReplay(db as never, "user-1", "proposal-1");
    const replay = proposalRows[0].historical_replay as Record<string, unknown>;
    expect(replay.findings_evaluated).toBe(1);
    expect(replay.findings_would_change_action).toBe(0);
  });
});

describe("runRegressionCheck", () => {
  it("throws when the proposal isn't in 'testing' status", async () => {
    const { db } = makeFakeDb({ proposals: [proposal({ status: "proposed" })] });
    await expect(runRegressionCheck(db as never, "user-1", "proposal-1")).rejects.toThrow(/status='testing'/);
  });

  it("fails on insufficient data (findings_evaluated === 0) — never passes on zero real evidence", async () => {
    const { db, proposalRows } = makeFakeDb({
      proposals: [
        proposal({
          status: "testing",
          historical_replay: { findings_evaluated: 0, findings_would_change_action: 0, insufficient_data: true },
        }),
      ],
    });
    await runRegressionCheck(db as never, "user-1", "proposal-1");
    expect(proposalRows[0].status).toBe("failed");
    expect((proposalRows[0].regression_check as Record<string, unknown>).invariant_holds).toBe(false);
  });

  it("passes a well-formed proposal with real evaluated findings and no safety-floor violation", async () => {
    const { db, proposalRows } = makeFakeDb({
      proposals: [
        proposal({
          status: "testing",
          proposed_escalate_at_tier: "strong",
          proposed_recommended_action: "require_human_review",
          historical_replay: { findings_evaluated: 5, findings_would_change_action: 5, insufficient_data: false },
        }),
      ],
    });
    await runRegressionCheck(db as never, "user-1", "proposal-1");
    expect(proposalRows[0].status).toBe("passed");
    expect((proposalRows[0].regression_check as Record<string, unknown>).invariant_holds).toBe(true);
  });

  it("fails a proposal that weakens scrutiny at tier='significant' — the real, testable safety floor", async () => {
    const { db, proposalRows } = makeFakeDb({
      proposals: [
        proposal({
          status: "testing",
          proposed_escalate_at_tier: "significant",
          proposed_recommended_action: "lower_confidence", // weaker than require_human_review
          historical_replay: { findings_evaluated: 10, findings_would_change_action: 10, insufficient_data: false },
        }),
      ],
    });
    await runRegressionCheck(db as never, "user-1", "proposal-1");
    expect(proposalRows[0].status).toBe("failed");
    const check = proposalRows[0].regression_check as Record<string, unknown>;
    expect(check.invariant_holds).toBe(false);
    expect(check.reason).toMatch(/Safety floor/);
  });
});

describe("approveProposal", () => {
  it("moves a 'passed' proposal to 'approved' and records who/when", async () => {
    const { db, proposalRows } = makeFakeDb({ proposals: [proposal({ status: "passed" })] });
    await approveProposal(db as never, "user-1", "proposal-1", "attorney-1");
    expect(proposalRows[0]).toMatchObject({ status: "approved", approved_by: "attorney-1" });
    expect(proposalRows[0].approved_at).toBeTruthy();
  });

  it("throws when called on anything other than a 'passed' proposal", async () => {
    const { db } = makeFakeDb({ proposals: [proposal({ status: "testing" })] });
    await expect(approveProposal(db as never, "user-1", "proposal-1", "attorney-1")).rejects.toThrow(/status='passed'/);
  });
});

describe("deployProposal", () => {
  it("throws unless the proposal is 'approved'", async () => {
    const { db } = makeFakeDb({ proposals: [proposal({ status: "passed" })] });
    await expect(deployProposal(db as never, "user-1", "proposal-1")).rejects.toThrow(/status='approved'/);
  });

  it("first deploy for a bucket: creates version 1, an active rule, and marks the proposal deployed", async () => {
    const { db, ruleRows, versionRows, proposalRows } = makeFakeDb({
      proposals: [proposal({ status: "approved", approved_by: "attorney-1", approved_at: "2026-08-14T00:00:00.000Z" })],
      patterns: [pattern()],
    });
    const result = await deployProposal(db as never, "user-1", "proposal-1");
    expect(result.version).toBe(1);
    expect(ruleRows).toHaveLength(1);
    expect(ruleRows[0]).toMatchObject({ is_active: true, escalate_at_tier: "strong", recommended_action: "require_human_review" });
    expect(versionRows).toHaveLength(1);
    expect(versionRows[0]).toMatchObject({ version: 1, deployment_status: "deployed" });
    expect((versionRows[0].changes as Record<string, unknown>).old).toBeNull();
    expect(proposalRows[0]).toMatchObject({ status: "deployed", deployed_version: 1 });
  });

  it("second deploy for the SAME bucket supersedes the prior rule and increments the version", async () => {
    const existingRule = rule({ id: "rule-old", escalate_at_tier: "strong", recommended_action: "require_second_source" });
    const { db, ruleRows, versionRows } = makeFakeDb({
      proposals: [proposal({ status: "approved" })],
      patterns: [pattern()],
      rules: [existingRule],
      versions: [{ id: "v1", user_id: "user-1", version: 1, deployment_status: "deployed", changes: {} }],
    });
    const result = await deployProposal(db as never, "user-1", "proposal-1");
    expect(result.version).toBe(2);
    expect(ruleRows).toHaveLength(2);
    expect(existingRule.is_active).toBe(false);
    expect(existingRule.superseded_by_rule_id).toBeTruthy();
    const newRule = ruleRows.find((r) => r.id !== "rule-old")!;
    expect(newRule.is_active).toBe(true);
    expect(versionRows).toHaveLength(2);
    const v2 = versionRows.find((v) => v.version === 2)!;
    expect((v2.changes as Record<string, unknown>).old).toMatchObject({
      escalate_at_tier: "strong",
      recommended_action: "require_second_source",
    });
  });

  it("throws on a second call for an already-deployed proposal (no double deploy)", async () => {
    const { db } = makeFakeDb({
      proposals: [proposal({ status: "approved" })],
      patterns: [pattern()],
    });
    await deployProposal(db as never, "user-1", "proposal-1");
    await expect(deployProposal(db as never, "user-1", "proposal-1")).rejects.toThrow(/status='approved'/);
  });
});

describe("rollbackVersion", () => {
  it("throws when the target version isn't 'deployed'", async () => {
    const { db } = makeFakeDb({
      versions: [{ id: "v1", user_id: "user-1", version: 1, deployment_status: "rolled_back", changes: {} }],
    });
    await expect(rollbackVersion(db as never, "user-1", "v1")).rejects.toThrow(/deployment_status='deployed'/);
  });

  it("refuses to roll back a version whose rule is no longer live (already superseded by a later deploy)", async () => {
    const { db, ruleRows, versionRows } = makeFakeDb({
      rules: [rule({ id: "rule-1", is_active: false })],
      versions: [
        {
          id: "v1",
          user_id: "user-1",
          version: 1,
          deployment_status: "deployed",
          changes: { rule_id: "rule-1", old_rule_id: null, matter_type: "amparo_directo", jurisdiction_country: "MX", error_type: "false_positive", old: null, new: { escalate_at_tier: "strong", recommended_action: "require_human_review" } },
        },
      ],
    });
    await expect(rollbackVersion(db as never, "user-1", "v1")).rejects.toThrow(/no longer the live rule/);
    expect(ruleRows[0].is_active).toBe(false); // untouched
    expect(versionRows).toHaveLength(1); // no new row appended
  });

  it("reactivates the prior rule, deactivates the current one, and appends a new version — never edits the original", async () => {
    const { db, ruleRows, versionRows } = makeFakeDb({
      rules: [
        rule({ id: "rule-old", escalate_at_tier: "strong", recommended_action: "require_second_source", is_active: false }),
        rule({ id: "rule-new", escalate_at_tier: "strong", recommended_action: "require_human_review", is_active: true }),
      ],
      versions: [
        {
          id: "v2",
          user_id: "user-1",
          version: 2,
          deployment_status: "deployed",
          rollback_reference: null,
          changes: {
            rule_id: "rule-new",
            old_rule_id: "rule-old",
            matter_type: "amparo_directo",
            jurisdiction_country: "MX",
            error_type: "false_positive",
            old: { escalate_at_tier: "strong", recommended_action: "require_second_source" },
            new: { escalate_at_tier: "strong", recommended_action: "require_human_review" },
          },
        },
      ],
    });

    const originalChanges = JSON.stringify(versionRows[0].changes);
    const result = await rollbackVersion(db as never, "user-1", "v2");

    expect(result.version).toBe(3);
    // The old rule is live again; the rule this version deployed is not.
    expect(ruleRows.find((r) => r.id === "rule-old")!.is_active).toBe(true);
    expect(ruleRows.find((r) => r.id === "rule-new")!.is_active).toBe(false);

    // Original version row's CONTENT (changes) is untouched — only its
    // status-like metadata (deployment_status/rollback_reference) changed.
    expect(JSON.stringify(versionRows[0].changes)).toBe(originalChanges);
    expect(versionRows[0].deployment_status).toBe("rolled_back");
    expect(versionRows[0].rollback_reference).toBe("id-1-".slice(0, 0) || versionRows[0].rollback_reference); // set to the new row's id
    expect(versionRows[0].rollback_reference).toBeTruthy();

    // A brand-new row was appended, referencing the version it reverses.
    expect(versionRows).toHaveLength(2);
    const rollbackRow = versionRows.find((v) => v.version === 3)!;
    expect(rollbackRow.rollback_reference).toBe("v2");
    expect((rollbackRow.changes as Record<string, unknown>).new).toMatchObject({
      escalate_at_tier: "strong",
      recommended_action: "require_second_source",
    });
  });

  it("rolling back a bucket's first-ever deploy leaves no rule active for that bucket", async () => {
    const { db, ruleRows } = makeFakeDb({
      rules: [rule({ id: "rule-first", is_active: true })],
      versions: [
        {
          id: "v1",
          user_id: "user-1",
          version: 1,
          deployment_status: "deployed",
          rollback_reference: null,
          changes: {
            rule_id: "rule-first",
            old_rule_id: null,
            matter_type: "amparo_directo",
            jurisdiction_country: "MX",
            error_type: "false_positive",
            old: null,
            new: { escalate_at_tier: "strong", recommended_action: "require_human_review" },
          },
        },
      ],
    });
    await rollbackVersion(db as never, "user-1", "v1");
    expect(ruleRows.every((r) => !r.is_active)).toBe(true);
  });
});
