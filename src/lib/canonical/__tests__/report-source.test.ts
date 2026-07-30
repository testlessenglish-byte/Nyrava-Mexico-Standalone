import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCanonicalOrder,
  loadCanonicalReportSource,
  canonicalStalenessNotice,
  isCanonicalReportEnabled,
} from "@/lib/canonical/report-source.server";

describe("canonical report source (Phase 4)", () => {
  it("is off unless the env flag is explicitly true", () => {
    const prev = process.env.CANONICAL_REPORT_ENABLED;
    delete process.env.CANONICAL_REPORT_ENABLED;
    expect(isCanonicalReportEnabled()).toBe(false);
    process.env.CANONICAL_REPORT_ENABLED = "false";
    expect(isCanonicalReportEnabled()).toBe(false);
    process.env.CANONICAL_REPORT_ENABLED = "true";
    expect(isCanonicalReportEnabled()).toBe(true);
    if (prev === undefined) delete process.env.CANONICAL_REPORT_ENABLED;
    else process.env.CANONICAL_REPORT_ENABLED = prev;
  });

  it("reorders raw rows into the canonical ranking and drops non-canonical rows", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(applyCanonicalOrder(rows, ["c", "a"])).toEqual([{ id: "c" }, { id: "a" }]);
  });

  it("ignores canonical ids that no longer exist in the raw rows", () => {
    const rows = [{ id: "a" }];
    expect(applyCanonicalOrder(rows, ["ghost", "a"])).toEqual([{ id: "a" }]);
  });

  it("signals fallback when canonical and raw findings do not overlap", () => {
    expect(applyCanonicalOrder([{ id: "a" }], ["x", "y"])).toBeNull();
  });

  it("only warns about staleness when a strictly newer canonical version exists", () => {
    expect(canonicalStalenessNotice(2, 2)).toBeNull();
    expect(canonicalStalenessNotice(3, 2)).toBeNull();
    expect(canonicalStalenessNotice(null, 4)).toBeNull();
    expect(canonicalStalenessNotice(1, 4)).toContain("versión canónica 1");
    expect(canonicalStalenessNotice(1, 4, "en")).toContain("version 4");
  });
});

// --- Reachability coverage for the reader-path fallback reasons ---------
// Tracing a code path and proving it fires are different claims: the
// `flag_disabled` variant looked reachable by inspection and was in fact
// dead. These stub-client tests hold the remaining reader-path variants to
// the same standard as `no_overlap_with_raw_findings` and `read_error`, so
// an empty `canonical_fallback` trace during the Amparo rollout means "no
// fallbacks happened" rather than "the reporting path is broken".

type TracedRow = { phase?: string; step?: string; detail?: { reason?: string } };

function stubDb(canonicalRow: unknown, opts: { readError?: string } = {}) {
  const traced: TracedRow[] = [];
  const db = {
    from(table: string) {
      if (table === "pipeline_trace") {
        return {
          insert: async (row: TracedRow) => {
            traced.push(row);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              opts.readError
                ? { data: null, error: { message: opts.readError } }
                : { data: canonicalRow, error: null },
          }),
        }),
      };
    },
  };
  return { db, traced };
}

describe("canonical fallback reasons are actually emitted", () => {
  const prev = process.env.CANONICAL_REPORT_ENABLED;
  beforeEach(() => {
    process.env.CANONICAL_REPORT_ENABLED = "true";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CANONICAL_REPORT_ENABLED;
    else process.env.CANONICAL_REPORT_ENABLED = prev;
  });

  it("emits no_canonical_row when the gate row was deleted (e.g. by pipeline reset)", async () => {
    const { db, traced } = stubDb(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await loadCanonicalReportSource(db as any, "case-1");
    expect(out).toBeNull();
    expect(traced).toHaveLength(1);
    expect(traced[0].phase).toBe("report");
    expect(traced[0].step).toBe("canonical_fallback");
    expect(traced[0].detail?.reason).toBe("no_canonical_row");
  });

  it("emits canonical_not_completed for each non-terminal gate status", async () => {
    for (const status of ["orchestrating", "failed"]) {
      const { db, traced } = stubDb({ version: 2, status, analysis_payload: { Findings: [{ id: "a" }] } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = await loadCanonicalReportSource(db as any, "case-1");
      expect(out).toBeNull();
      expect(traced[0]?.detail?.reason).toBe("canonical_not_completed");
    }
  });

  it("emits empty_payload when the gate completed with no findings", async () => {
    const { db, traced } = stubDb({ version: 3, status: "completed", analysis_payload: { Findings: [] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await loadCanonicalReportSource(db as any, "case-1");
    expect(out).toBeNull();
    expect(traced[0]?.detail?.reason).toBe("empty_payload");
  });

  it("emits read_error when the canonical read is rejected (e.g. RLS)", async () => {
    const { db, traced } = stubDb(null, { readError: "permission denied" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await loadCanonicalReportSource(db as any, "case-1");
    expect(out).toBeNull();
    expect(traced[0]?.detail?.reason).toBe("read_error");
  });

  it("returns the canonical source (and traces nothing) on the happy path", async () => {
    const { db, traced } = stubDb({
      version: 7,
      status: "completed",
      analysis_payload: { Findings: [{ id: "b" }, { id: "a" }] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await loadCanonicalReportSource(db as any, "case-1");
    expect(out?.version).toBe(7);
    expect(out?.orderedIds).toEqual(["b", "a"]);
    expect(traced).toHaveLength(0);
  });
});
