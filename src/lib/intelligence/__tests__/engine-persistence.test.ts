import { describe, it, expect } from "vitest";
import {
  verifyPersistence,
  runVerifiedEngine,
  ENGINE_TABLE_SPECS,
} from "../engine-persistence.server";

/**
 * Fake supabase client with:
 *   - programmable per-table row stores
 *   - `.from(table).select("id").eq(col, val)` returning stored rows
 *   - `.from("pipeline_engine_runs").insert(...).select("id").maybeSingle()` used by runEngine
 *   - `.from("pipeline_engine_runs").update(...).eq(...)` used by runEngine
 *   - `.from("pipeline_events").insert(...)` used by emitEvent
 */
function makeFakeDb(rowsByTable: Record<string, Array<{ id: string; case_id: string }>>) {
  const ledger: Array<{ id: string; status: string; meta?: unknown; error?: string; db_write_confirmed?: boolean | null; rows_written?: number | null }> = [];
  let ledgerSeq = 1;

  const client = {
    from(table: string) {
      return {
        select(_cols: string) {
          // Chainable filter builder: production code may call `.eq()`/`.gte()`
          // several times (case_id + engine + created_at) before awaiting.
          type Row = { id: string; case_id: string };
          const makeFilter = (rows: Row[]) => ({
            eq(col: string, val: string) {
              return makeFilter(rows.filter((r) => (r as Record<string, unknown>)[col] === val));
            },
            gte() {
              return makeFilter(rows);
            },
            lte() {
              return makeFilter(rows);
            },
            order() {
              return makeFilter(rows);
            },
            limit() {
              return makeFilter(rows);
            },
            then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
          });
          return makeFilter(rowsByTable[table] ?? []);
        },


        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table === "pipeline_engine_runs") {
            const id = `ledger-${ledgerSeq++}`;
            ledger.push({ id, status: String(rows[0].status ?? "running") });
            return {
              select(_c: string) {
                return {
                  maybeSingle: async () => ({ data: { id }, error: null }),
                };
              },
              // Also usable without select() chain (recordBlocked/recordSkipped)
              then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
            };
          }
          // Normal table insert — accept everything
          rowsByTable[table] = rowsByTable[table] ?? [];
          for (const r of rows) {
            rowsByTable[table].push({ id: String(r.id ?? `${table}-${rowsByTable[table].length + 1}`), case_id: String(r.case_id ?? "case-1") });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              const row = ledger.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
    __ledger: ledger,
    __rows: rowsByTable,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

describe("verifyPersistence", () => {
  it("returns ok when actual >= expectedMin", async () => {
    const db = makeFakeDb({
      case_theories: [
        { id: "t1", case_id: "c1" },
        { id: "t2", case_id: "c1" },
      ],
    });
    const report = await verifyPersistence(db, {
      caseId: "c1",
      expectations: [{ table: "case_theories", expectedMin: 2 }],
    });
    expect(report.ok).toBe(true);
    expect(report.rows_written).toBe(2);
    expect(report.primary_keys).toEqual(["t1", "t2"]);
  });

  it("returns not-ok when actual < expectedMin (silent data loss detected)", async () => {
    const db = makeFakeDb({ case_theories: [] });
    const report = await verifyPersistence(db, {
      caseId: "c1",
      expectations: [{ table: "case_theories", expectedMin: 3 }],
    });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/expected >=3/);
    expect(report.rows_written).toBe(0);
  });

  it("passes for legitimately-empty engine output (expectedMin=0)", async () => {
    const db = makeFakeDb({ case_witnesses: [] });
    const report = await verifyPersistence(db, {
      caseId: "c1",
      expectations: [{ table: "case_witnesses", expectedMin: 0 }],
    });
    expect(report.ok).toBe(true);
    expect(report.rows_written).toBe(0);
  });
});

describe("runVerifiedEngine", () => {
  it("marks the engine completed when writes are verified", async () => {
    const db = makeFakeDb({
      case_theories: [{ id: "t1", case_id: "c1" }],
    });
    const value = await runVerifiedEngine(
      db,
      { caseId: "c1", userId: "u1", engine: "theory" },
      ENGINE_TABLE_SPECS.theory,
      async () => ({ value: { theories: [{ theory_type: "defense" }] } }),
    );
    expect(value).toEqual({ theories: [{ theory_type: "defense" }] });
    // Ledger updated with completed + db_write_confirmed
    const row = db.__ledger.find((r: { status: string }) => r.status === "completed");
    expect(row).toBeTruthy();
    expect(row.db_write_confirmed).toBe(true);
    expect(row.rows_written).toBe(1);
  });

  it("marks the engine failed when the engine claims output but the DB is empty", async () => {
    // Simulate a silent insert failure — engine returned a value implying
    // one theory should exist, but the table is empty.
    const db = makeFakeDb({ case_theories: [] });
    await expect(
      runVerifiedEngine(
        db,
        { caseId: "c1", userId: "u1", engine: "theory" },
        ENGINE_TABLE_SPECS.theory,
        async () => ({ value: { theories: [{ theory_type: "defense" }] } }),
      ),
    ).rejects.toThrow(/Persistence verification failed for theory/);
    const failedRow = db.__ledger.find((r: { status: string }) => r.status === "failed");
    expect(failedRow).toBeTruthy();
  });

  it("marks db_write_confirmed=true with no table check when spec is empty", async () => {
    const db = makeFakeDb({});
    await runVerifiedEngine(
      db,
      { caseId: "c1", userId: "u1", engine: "evidence_map" },
      ENGINE_TABLE_SPECS.evidence_map,
      async () => ({ value: { ok: true } }),
    );
    const row = db.__ledger.find((r: { status: string }) => r.status === "completed");
    expect(row.db_write_confirmed).toBe(true);
  });
});
