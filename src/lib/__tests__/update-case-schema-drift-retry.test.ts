// Regression test for the "Could not find the 'case_type_source' column of
// 'cases' in the schema cache" bug: updateCaseSettings bundled case_type_source
// into every save (CaseControlPanel.tsx always sends case_type), and a single
// Postgres UPDATE referencing an unknown column fails ATOMICALLY for the whole
// statement — so an environment missing the additive migration
// (20260809143021_case_classification_evidence.sql) silently lost every OTHER
// field in the same save too (case_analysis_mode, analysis_mode,
// jurisdiction...), which is what produced the live report showing
// case_analysis_mode stuck on "exploratory" after the attorney set it to
// "ongoing". updateCaseWithSchemaDriftRetry retries once with the two
// additive columns stripped so the rest of the patch still persists, and logs
// that a pending migration needs to be applied.
import { describe, it, expect, vi } from "vitest";
import { updateCaseWithSchemaDriftRetry } from "@/lib/cases.functions";

function makeFakeDb(opts: {
  row: Record<string, unknown>;
  /** Simulates an UPDATE that fails whenever the patch touches these columns. */
  unknownColumns: string[];
  /** Simulates the retry (post-strip) failing too. */
  retryAlsoFails?: boolean;
}) {
  let updateCalls = 0;
  return {
    calls: () => updateCalls,
    from(table: string) {
      if (table !== "cases") throw new Error(`unexpected table in fake db: ${table}`);
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            updateCalls += 1;
            const hitsUnknownColumn = opts.unknownColumns.some((c) => c in patch);
            if (hitsUnknownColumn && updateCalls === 1) {
              return Promise.resolve({
                error: {
                  message: `Could not find the '${opts.unknownColumns[0]}' column of 'cases' in the schema cache`,
                },
              });
            }
            if (opts.retryAlsoFails && updateCalls > 1) {
              return Promise.resolve({ error: { message: "retry also failed" } });
            }
            expect(id).toBe(opts.row.id);
            Object.assign(opts.row, patch);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
}

describe("updateCaseWithSchemaDriftRetry", () => {
  it("persists a normal patch on the first attempt when no column is missing", async () => {
    const row: Record<string, unknown> = { id: "case-1", analysis_mode: "balanced" };
    const db = makeFakeDb({ row, unknownColumns: [] });

    await updateCaseWithSchemaDriftRetry(db as never, "case-1", {
      analysis_mode: "strict",
      case_analysis_mode: "ongoing",
    });

    expect(db.calls()).toBe(1);
    expect(row.analysis_mode).toBe("strict");
    expect(row.case_analysis_mode).toBe("ongoing");
  });

  it("retries without case_type_source/case_type_verification_status when those columns don't exist yet, and still persists the rest of the patch", async () => {
    const row: Record<string, unknown> = { id: "case-1", case_analysis_mode: "exploratory" };
    const db = makeFakeDb({ row, unknownColumns: ["case_type_source"] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateCaseWithSchemaDriftRetry(db as never, "case-1", {
      case_type: "amparo",
      case_type_source: "manual_override",
      case_type_verification_status: "unverified",
      case_analysis_mode: "ongoing",
    });

    expect(db.calls()).toBe(2);
    // The fields blocking the schema cache never persist...
    expect(row.case_type_source).toBeUndefined();
    expect(row.case_type_verification_status).toBeUndefined();
    // ...but every other field in the same save does — this is the actual
    // bug: without the retry, case_analysis_mode below would have stayed
    // "exploratory" forever because the whole UPDATE was rejected atomically.
    expect(row.case_type).toBe("amparo");
    expect(row.case_analysis_mode).toBe("ongoing");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("recovered by saving without case_type_source"),
      expect.objectContaining({ originalError: expect.any(Object) }),
    );

    errorSpy.mockRestore();
  });

  it("throws the ORIGINAL error when the retry also fails, not the retry's error", async () => {
    const row: Record<string, unknown> = { id: "case-1" };
    const db = makeFakeDb({ row, unknownColumns: ["case_type_source"], retryAlsoFails: true });

    await expect(
      updateCaseWithSchemaDriftRetry(db as never, "case-1", {
        case_type_source: "manual_override",
        analysis_mode: "strict",
      }),
    ).rejects.toThrow(/case_type_source' column of 'cases' in the schema cache/);
  });
});
