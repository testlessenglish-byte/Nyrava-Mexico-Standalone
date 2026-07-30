import { describe, expect, it } from "vitest";
import {
  applyCanonicalOrder,
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
