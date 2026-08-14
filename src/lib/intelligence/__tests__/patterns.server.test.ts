// Regression tests for Continuous Legal Intelligence Phase B — cross-case
// pattern aggregation (aggregateIntelligencePatterns/upsertIntelligencePattern)
// and self-auditing (auditFindingAgainstPatterns). See
// src/lib/intelligence/patterns.server.ts and migration
// 20260813235408_intelligence_patterns.sql.
//
// These tests prove three safety properties the directive requires:
//  1. Tiers are computed purely from stored verified_count, never asserted —
//     exact boundary values must land on the documented tier.
//  2. Only evidence_verified+ lessons count toward a pattern's tier — an
//     unreviewed ai_supported lesson must never move a pattern up.
//  3. Self-audit only escalates (never rejects/removes) and only fires at
//     candidate tier or above, scoped correctly by matter_type/jurisdiction.
import { describe, it, expect } from "vitest";
import {
  aggregateIntelligencePatterns,
  upsertIntelligencePattern,
  auditFindingAgainstPatterns,
  computeTier,
  TIER_THRESHOLDS,
  type PatternBucketKey,
} from "@/lib/intelligence/patterns.server";

// Same predicate-accumulating generic query-builder fake already established
// in chat-patch.server.test.ts — every call this module makes is a plain
// filtered SELECT (eq/is/in/neq), so one builder serves intelligence_lessons,
// case_findings, and intelligence_patterns alike.
function queryBuilder(rows: Array<Record<string, unknown>>) {
  let predicate = (_r: Record<string, unknown>) => true;
  const self: Record<string, unknown> = {
    select: () => self,
    eq: (col: string, val: unknown) => {
      const prev = predicate;
      predicate = (r) => prev(r) && r[col] === val;
      return self;
    },
    in: (col: string, vals: unknown[]) => {
      const prev = predicate;
      predicate = (r) => prev(r) && vals.includes(r[col]);
      return self;
    },
    is: (col: string, val: null) => {
      const prev = predicate;
      predicate = (r) => prev(r) && ((r[col] as unknown) ?? null) === val;
      return self;
    },
    neq: (col: string, val: unknown) => {
      const prev = predicate;
      predicate = (r) => prev(r) && r[col] !== val;
      return self;
    },
    then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter(predicate), error: null }),
  };
  return self;
}

function makeFakeDb(opts: {
  lessons?: Array<Record<string, unknown>>;
  findings?: Array<Record<string, unknown>>;
  patterns?: Array<Record<string, unknown>>;
}) {
  const lessonRows = opts.lessons ?? [];
  const findingRows = opts.findings ?? [];
  const patternRows = opts.patterns ?? [];
  const db = {
    from(table: string) {
      if (table === "intelligence_lessons") return { select: () => queryBuilder(lessonRows) };
      if (table === "case_findings") return { select: () => queryBuilder(findingRows) };
      if (table === "intelligence_patterns") {
        return {
          select: () => queryBuilder(patternRows),
          upsert: (row: Record<string, unknown>, upsertOpts: { onConflict: string }) => {
            const keyCols = upsertOpts.onConflict.split(",");
            const existing = patternRows.find((p) => keyCols.every((c) => p[c] === row[c]));
            if (existing) Object.assign(existing, row);
            else patternRows.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table in patterns fake db: ${table}`);
    },
  };
  return { db, lessonRows, findingRows, patternRows };
}

function lesson(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `lesson-${Math.random()}`,
    user_id: "user-1",
    finding_id: "finding-1",
    matter_type: "amparo_directo",
    jurisdiction_country: "MX",
    jurisdiction_state: null,
    error_type: "false_positive",
    validation_status: "evidence_verified",
    times_successful: 0,
    times_rejected: 0,
    ...overrides,
  };
}

const KEY: PatternBucketKey = {
  matterType: "amparo_directo",
  jurisdictionCountry: "MX",
  jurisdictionState: null,
  errorType: "false_positive",
};

describe("computeTier", () => {
  it("lands exactly on the documented boundaries", () => {
    expect(computeTier(0)).toBe("insufficient_sample");
    expect(computeTier(TIER_THRESHOLDS.insufficientMax)).toBe("insufficient_sample");
    expect(computeTier(TIER_THRESHOLDS.insufficientMax + 1)).toBe("emerging");
    expect(computeTier(TIER_THRESHOLDS.emergingMax)).toBe("emerging");
    expect(computeTier(TIER_THRESHOLDS.emergingMax + 1)).toBe("candidate");
    expect(computeTier(TIER_THRESHOLDS.candidateMax)).toBe("candidate");
    expect(computeTier(TIER_THRESHOLDS.candidateMax + 1)).toBe("strong");
    expect(computeTier(TIER_THRESHOLDS.strongMax)).toBe("strong");
    expect(computeTier(TIER_THRESHOLDS.strongMax + 1)).toBe("significant");
    expect(computeTier(25)).toBe("significant");
  });
});

describe("aggregateIntelligencePatterns", () => {
  it("returns an honest INSUFFICIENT_SAMPLE-shaped result for an empty bucket — never fabricates", async () => {
    const { db } = makeFakeDb({ lessons: [] });
    const agg = await aggregateIntelligencePatterns(db as never, "user-1", KEY);
    expect(agg.sampleSize).toBe(0);
    expect(agg.verifiedCount).toBe(0);
    expect(agg.confidence).toBeNull();
    expect(agg.tier).toBe("insufficient_sample");
    expect(agg.supportingLessonIds).toEqual([]);
    expect(agg.categorySamples).toEqual([]);
  });

  it("counts only evidence_verified/multi_source_verified/human_confirmed lessons toward verifiedCount — ai_supported and unverified never move the tier", async () => {
    const lessons = [
      lesson({ id: "l1", validation_status: "evidence_verified" }),
      lesson({ id: "l2", validation_status: "multi_source_verified" }),
      lesson({ id: "l3", validation_status: "human_confirmed" }),
      lesson({ id: "l4", validation_status: "ai_supported" }),
      lesson({ id: "l5", validation_status: "unverified" }),
    ];
    const { db } = makeFakeDb({ lessons });
    const agg = await aggregateIntelligencePatterns(db as never, "user-1", KEY);
    expect(agg.sampleSize).toBe(5);
    expect(agg.verifiedCount).toBe(3);
    // 3 verified lands at "emerging" (<=4), not the "candidate" it would
    // reach if the two ai_supported/unverified lessons counted too.
    expect(agg.tier).toBe("emerging");
    expect(agg.confidence).toBeCloseTo(3 / 5);
  });

  it("never leaks a lesson from a different matter_type or jurisdiction_state into the bucket", async () => {
    const lessons = [
      lesson({ id: "l1", validation_status: "evidence_verified" }),
      lesson({ id: "l2", validation_status: "evidence_verified", matter_type: "civil_mercantil" }),
      lesson({ id: "l3", validation_status: "evidence_verified", jurisdiction_state: "Jalisco" }),
    ];
    const { db } = makeFakeDb({ lessons });
    const agg = await aggregateIntelligencePatterns(db as never, "user-1", KEY);
    expect(agg.sampleSize).toBe(1);
    expect(agg.supportingLessonIds).toEqual(["l1"]);
  });

  it("dedupes categorySamples from the findings the bucket's lessons actually reference", async () => {
    const lessons = [
      lesson({ id: "l1", finding_id: "f1", validation_status: "evidence_verified" }),
      lesson({ id: "l2", finding_id: "f2", validation_status: "evidence_verified" }),
      lesson({ id: "l3", finding_id: "f3", validation_status: "evidence_verified" }),
    ];
    const findings = [
      { id: "f1", category: "standing" },
      { id: "f2", category: "standing" },
      { id: "f3", category: "evidence" },
      // Not referenced by any lesson in this bucket — must not leak in.
      { id: "f4", category: "procedure" },
    ];
    const { db } = makeFakeDb({ lessons, findings });
    const agg = await aggregateIntelligencePatterns(db as never, "user-1", KEY);
    expect(agg.categorySamples.sort()).toEqual(["evidence", "standing"]);
  });
});

describe("upsertIntelligencePattern", () => {
  it("writes a fresh row without asserting a status — the table's own DEFAULT applies on first insert", async () => {
    const { db, patternRows } = makeFakeDb({
      lessons: [lesson({ id: "l1", validation_status: "evidence_verified" })],
    });
    await upsertIntelligencePattern(db as never, "user-1", KEY);
    expect(patternRows).toHaveLength(1);
    expect(patternRows[0]).not.toHaveProperty("status");
    expect(patternRows[0]).toMatchObject({
      user_id: "user-1",
      matter_type: "amparo_directo",
      error_type: "false_positive",
      sample_size: 1,
      verified_count: 1,
    });
  });

  it("never resets an existing pattern's status back to 'monitoring' on a later recompute", async () => {
    const existing = {
      user_id: "user-1",
      matter_type: "amparo_directo",
      jurisdiction_country: "MX",
      jurisdiction_state: null,
      error_type: "false_positive",
      status: "active", // a human previously promoted this pattern
      sample_size: 1,
      verified_count: 1,
    };
    const { db, patternRows } = makeFakeDb({
      lessons: [lesson({ id: "l1", validation_status: "evidence_verified" })],
      patterns: [existing],
    });
    await upsertIntelligencePattern(db as never, "user-1", KEY);
    expect(patternRows).toHaveLength(1);
    expect(patternRows[0].status).toBe("active");
  });
});

describe("auditFindingAgainstPatterns", () => {
  function pattern(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "pattern-1",
      user_id: "user-1",
      matter_type: "amparo_directo",
      jurisdiction_country: "MX",
      error_type: "false_positive",
      tier: "candidate",
      status: "monitoring",
      pattern_description: "3 verified corrections...",
      category_samples: ["standing"],
      ...overrides,
    };
  }

  it("returns null when no pattern exists", async () => {
    const { db } = makeFakeDb({ patterns: [] });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice).toBeNull();
  });

  it("returns null below candidate tier — an 'emerging' pattern is visible in data but never escalates", async () => {
    const { db } = makeFakeDb({ patterns: [pattern({ tier: "emerging" })] });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice).toBeNull();
  });

  it("returns null for a retired pattern even at 'significant' tier", async () => {
    const { db } = makeFakeDb({
      patterns: [pattern({ tier: "significant", status: "retired" })],
    });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice).toBeNull();
  });

  it("returns null when the finding's category doesn't match the pattern's category_samples", async () => {
    const { db } = makeFakeDb({ patterns: [pattern({ category_samples: ["evidence"] })] });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice).toBeNull();
  });

  it("escalates a 'candidate' match to require_additional_evidence — never a reject/remove action", async () => {
    const { db } = makeFakeDb({ patterns: [pattern({ tier: "candidate" })] });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice).toMatchObject({
      patternId: "pattern-1",
      tier: "candidate",
      similarityBasis: "category_match",
      recommendedAction: "require_additional_evidence",
    });
  });

  it("escalates a 'strong' match to require_second_source and 'significant' to require_human_review", async () => {
    const { db: dbStrong } = makeFakeDb({ patterns: [pattern({ tier: "strong" })] });
    const strongNotice = await auditFindingAgainstPatterns(dbStrong as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(strongNotice?.recommendedAction).toBe("require_second_source");

    const { db: dbSig } = makeFakeDb({ patterns: [pattern({ tier: "significant" })] });
    const sigNotice = await auditFindingAgainstPatterns(dbSig as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(sigNotice?.recommendedAction).toBe("require_human_review");
  });

  it("picks the highest-tier match when multiple patterns share the category", async () => {
    const { db } = makeFakeDb({
      patterns: [
        pattern({ id: "pattern-candidate", tier: "candidate" }),
        pattern({ id: "pattern-significant", tier: "significant", error_type: "wrong_evidence_interpretation" }),
      ],
    });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice?.patternId).toBe("pattern-significant");
  });

  it("never leaks a pattern from a different matter_type into scope", async () => {
    const { db } = makeFakeDb({
      patterns: [pattern({ matter_type: "civil_mercantil", tier: "significant" })],
    });
    const notice = await auditFindingAgainstPatterns(db as never, {
      userId: "user-1",
      matterType: "amparo_directo",
      jurisdictionCountry: "MX",
      findingCategory: "standing",
    });
    expect(notice).toBeNull();
  });
});
