// Reliability regression tests — pipeline_engine_runs lifecycle invariants.
//
// Guards against the "Report stuck RUNNING forever" release blocker:
// 1. runEngine must throw if the ledger insert doesn't produce an id
//    (silent skip of the failed-transition is banned).
// 2. runEngine must flip the ledger to `failed` when the inner fn throws.
// 3. runEngine must flip the ledger to `completed` when the inner fn
//    returns, with db_write_confirmed = true.
// 4. sweepStalledCases must force-fail any pipeline_engine_runs row that
//    has been `running` past the stall cutoff.
import { describe, it, expect } from "vitest";
import { runEngine } from "@/lib/intelligence/engine-audit.server";
import { requeueForContinuation, sweepStalledCases } from "@/lib/pipeline-stall.server";
import {
  seedResumeState,
  withCheckpointScope,
  assertCheckpointBudget,
  aiCallTimeoutForCheckpoint,
  CheckpointRequired,
  MIN_AI_CALL_BUDGET_MS,
  MAX_AI_CALL_TIMEOUT_MS,
  CHECKPOINT_SAFETY_BUFFER_MS,
  rethrowIfCheckpoint,
} from "@/lib/pipeline-checkpoint.server";


// Minimal fake Supabase client sufficient for the ledger update chain used
// by runEngine and sweepStalledCases. We record every mutation so tests can
// assert terminal transitions.
type Recorded = { table: string; op: string; payload?: unknown; match?: Record<string, unknown> };

function makeFakeDb(opts: { insertId?: string | null; insertErr?: string | null; updateErr?: string | null } = {}) {
  const recorded: Recorded[] = [];
  const chain = (table: string, op: string, payload?: unknown, err?: string | null) => {
    const match: Record<string, unknown> = {};
    const b: any = {
      eq: (k: string, v: unknown) => { match[k] = v; return b; },
      in: (k: string, v: unknown) => { match[k] = v; return b; },
      lt: (k: string, v: unknown) => { match[`${k}<`] = v; return b; },
      select: () => ({
        maybeSingle: async () => {
          recorded.push({ table, op, payload, match });
          if (op === "insert" && opts.insertErr) return { data: null, error: { message: opts.insertErr } };
          if (op === "insert") return { data: opts.insertId === null ? null : { id: opts.insertId ?? "row-1" }, error: null };
          return { data: null, error: null };
        },
        // no-op await for chained selects on updates (used by stall sweep)
        then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
          recorded.push({ table, op, payload, match });
          resolve({ data: [], error: err ? { message: err } : null });
        },
      }),
      order: () => b,
      // Direct await support for updates without .select() (emitEvent path)
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        recorded.push({ table, op, payload, match });
        resolve({ data: null, error: err ? { message: err } : null });
      },
    };
    return b;
  };
  return {
    recorded,
    from: (table: string) => ({
      insert: (payload: unknown) => chain(table, "insert", payload, opts.insertErr),
      update: (payload: unknown) => chain(table, "update", payload, opts.updateErr),
      delete: () => chain(table, "delete"),
      select: () => chain(table, "select"),
    }),
  } as any;
}

const args = { caseId: "case-1", userId: "user-1", engine: "report_generator" as const };

describe("runEngine ledger lifecycle", () => {
  it("throws immediately when ledger insert returns no id (no silent skip)", async () => {
    const db = makeFakeDb({ insertId: null });
    await expect(runEngine(db, args, async () => "ok")).rejects.toThrow(/failed to create ledger row/i);
  });

  it("throws immediately when ledger insert returns an error", async () => {
    const db = makeFakeDb({ insertErr: "rls denied" });
    await expect(runEngine(db, args, async () => "ok")).rejects.toThrow(/rls denied/i);
  });

  it("marks ledger row `failed` when the inner fn throws", async () => {
    const db = makeFakeDb({ insertId: "row-42" });
    await expect(
      runEngine(db, args, async () => { throw new Error("boom"); }),
    ).rejects.toThrow(/boom/);
    const updates = db.recorded.filter((r: Recorded) => r.table === "pipeline_engine_runs" && r.op === "update");
    const failing = updates.find((r: Recorded) => (r.payload as any)?.status === "failed");
    expect(failing, "expected a failed-status update").toBeTruthy();
    expect((failing!.match as any).id).toBe("row-42");
  });

  it("marks ledger row `completed` on success with db_write_confirmed=true", async () => {
    const db = makeFakeDb({ insertId: "row-99" });
    const value = await runEngine(db, args, async () => ({ value: "done" }));
    expect(value).toBe("done");
    const updates = db.recorded.filter((r: Recorded) => r.table === "pipeline_engine_runs" && r.op === "update");
    const completed = updates.find((r: Recorded) => (r.payload as any)?.status === "completed");
    expect(completed, "expected a completed-status update").toBeTruthy();
    expect((completed!.payload as any).db_write_confirmed).toBe(true);
  });
});

describe("sweepStalledCases ledger sweep", () => {
  it("issues an update against pipeline_engine_runs to force-fail stale running rows", async () => {
    const db = makeFakeDb();
    await sweepStalledCases(db, { staleMs: 1 });
    const ledgerUpdate = db.recorded.find(
      (r: Recorded) => r.table === "pipeline_engine_runs" && r.op === "update" && (r.payload as any)?.status === "failed",
    );
    expect(ledgerUpdate, "expected a failed-status update against pipeline_engine_runs").toBeTruthy();
    expect((ledgerUpdate!.match as any).status).toBe("running");
  });

  it("requeues checkpoints with next_stage preserved so workers resume instead of restarting", async () => {
    const db = makeFakeDb();
    await requeueForContinuation(db, "case-1", "report");
    const caseUpdate = db.recorded.find(
      (r: Recorded) => r.table === "cases" && r.op === "update" && (r.payload as any)?.status === "queued",
    );
    expect(caseUpdate, "expected queued case update").toBeTruthy();
    expect((caseUpdate!.payload as any).next_stage).toBe("report");
    expect((caseUpdate!.payload as any).worker_lease_until).toBeNull();
  });
});

// Regression coverage for the production bug: a case whose `perspectives`
// stage failed on an earlier worker tick, then resumed via `startFrom` on a
// later tick, let `work_product` run anyway because the in-memory
// failed/blocked Sets don't survive across separate `runPipelineForCase`
// invocations. `seedResumeState` reconstructs that history from the
// persisted ledger; these tests pin its exact contract.
describe("seedResumeState — cross-tick dependency reconstruction", () => {
  const engineForStage = (k: string) =>
    ({ perspectives: "perspectives", theories: "theory", strategy: "strategy", work_product: "work_product" }[k] ?? k);

  it("marks a stage failed when its engine's latest ledger row is failed", () => {
    const latestStatusByEngine = new Map([["perspectives", "failed"]]);
    const { failed, blocked } = seedResumeState({
      priorStageKeys: ["perspectives", "theories", "strategy"],
      engineForStage,
      latestStatusByEngine,
    });
    expect(failed.has("perspectives")).toBe(true);
    // theories/strategy have no ledger row of their own here (they never
    // ran) — seeding only reflects what's persisted; the runner's own
    // dependency gate is what turns that into `blocked` for them in the
    // same pass once perspectives is seeded as failed.
    expect(blocked.size).toBe(0);
  });

  it("marks a stage blocked when its engine's latest ledger row is blocked", () => {
    const latestStatusByEngine = new Map([
      ["perspectives", "failed"],
      ["theory", "blocked"],
      ["strategy", "blocked"],
    ]);
    const { failed, blocked } = seedResumeState({
      priorStageKeys: ["perspectives", "theories", "strategy", "work_product"],
      engineForStage,
      latestStatusByEngine,
    });
    expect(failed.has("perspectives")).toBe(true);
    expect(blocked.has("theories")).toBe(true);
    expect(blocked.has("strategy")).toBe(true);
    // work_product has no ledger row (never ran) — not seeded as blocked
    // itself; it's the runner's live DEPENDS_ON check against this seeded
    // `blocked` set that must block it, which this test's sibling in the
    // full pipeline-runner suite should assert end-to-end.
    expect(blocked.has("work_product")).toBe(false);
  });

  it("does not mark a stage failed/blocked if its latest ledger row is completed (a later retry succeeded)", () => {
    const latestStatusByEngine = new Map([["perspectives", "completed"]]);
    const { failed, blocked } = seedResumeState({
      priorStageKeys: ["perspectives"],
      engineForStage,
      latestStatusByEngine,
    });
    expect(failed.size).toBe(0);
    expect(blocked.size).toBe(0);
  });

  it("ignores stages with no prior ledger row at all (never attempted)", () => {
    const { failed, blocked } = seedResumeState({
      priorStageKeys: ["perspectives", "theories"],
      engineForStage,
      latestStatusByEngine: new Map(),
    });
    expect(failed.size).toBe(0);
    expect(blocked.size).toBe(0);
  });
});

// Production-failure regression: the "worker killed mid-Groq-call, ledger
// stuck running forever" bug. Proves the full timeout-recovery path works
// end-to-end at the seam that broke in prod:
//   1. AsyncLocalStorage scope with a real deadline → guards fire.
//   2. Guard fires BEFORE the expensive call actually starts.
//   3. runEngine catches CheckpointRequired and updates pipeline_engine_runs
//      to `queued` (NOT `failed`) with resume info in the error column.
//   4. requeueForContinuation stamps the case row `queued` with next_stage
//      preserved so the next worker tick continues from the checkpoint.
describe("checkpoint scope — timeout recovery path (production regression)", () => {
  it("assertCheckpointBudget throws CheckpointRequired when deadline is within the safety buffer", async () => {
    await expect(
      withCheckpointScope(
        { stage: "analyzers", deadlineAt: Date.now() + 100 /* well below CHECKPOINT_SAFETY_BUFFER_MS */ },
        async () => {
          assertCheckpointBudget("batch 3/10");
          return "should not reach";
        },
      ),
    ).rejects.toBeInstanceOf(CheckpointRequired);
  });

  it("aiCallTimeoutForCheckpoint throws BEFORE the AI call starts when remaining < MIN_AI_CALL_BUDGET_MS", async () => {
    let aiCallStarted = false;
    const mockAiCall = async () => { aiCallStarted = true; return "response"; };

    await expect(
      withCheckpointScope(
        { stage: "analyzers", deadlineAt: Date.now() + CHECKPOINT_SAFETY_BUFFER_MS + MIN_AI_CALL_BUDGET_MS - 500 },
        async () => {
          const timeoutMs = aiCallTimeoutForCheckpoint("analyzer batch 1");
          // If we ever reach here, run the mock call so the assertion below can fail.
          if (timeoutMs) await mockAiCall();
          return "ok";
        },
      ),
    ).rejects.toBeInstanceOf(CheckpointRequired);
    expect(aiCallStarted, "AI call must NOT start when budget is exhausted").toBe(false);
  });

  it("aiCallTimeoutForCheckpoint returns a bounded timeout when the budget is healthy", async () => {
    await withCheckpointScope(
      { stage: "analyzers", deadlineAt: Date.now() + 30_000 },
      async () => {
        const timeoutMs = aiCallTimeoutForCheckpoint("analyzer batch 1");
        expect(timeoutMs).toBeDefined();
        expect(timeoutMs!).toBeGreaterThanOrEqual(MIN_AI_CALL_BUDGET_MS);
        expect(timeoutMs!).toBeLessThanOrEqual(MAX_AI_CALL_TIMEOUT_MS);
      },
    );
  });

  it("outside a scope both guards are inert (backward-compatible no-ops)", async () => {
    // Direct calls with no scope — must NOT throw.
    expect(() => assertCheckpointBudget("no scope")).not.toThrow();
    expect(aiCallTimeoutForCheckpoint("no scope")).toBeUndefined();
  });

  it("runEngine catches CheckpointRequired inside the scope and stamps ledger `queued` with resume info (NOT `failed`)", async () => {
    const db = makeFakeDb({ insertId: "row-checkpoint-1" });
    await expect(
      runEngine(db, { caseId: "case-1", userId: "user-1", engine: "analyzers" as const }, async () => {
        return withCheckpointScope(
          { stage: "analyzers", deadlineAt: Date.now() + 10 },
          async () => {
            assertCheckpointBudget("batch 7/12");
            return "unreachable";
          },
        );
      }),
    ).rejects.toBeInstanceOf(CheckpointRequired);

    const updates = db.recorded.filter(
      (r: Recorded) => r.table === "pipeline_engine_runs" && r.op === "update",
    );
    const checkpointUpdate = updates.find((r: Recorded) => (r.payload as any)?.status === "queued");
    expect(checkpointUpdate, "expected a queued-status update (checkpoint, not failure)").toBeTruthy();
    expect((checkpointUpdate!.match as any).id).toBe("row-checkpoint-1");
    // Resume info lives in the error column per engine-audit contract.
    expect(String((checkpointUpdate!.payload as any).error)).toMatch(/checkpoint/i);
    expect(String((checkpointUpdate!.payload as any).error)).toMatch(/batch 7\/12/);
    // Critical negative assertion: must NOT be marked failed.
    const failedUpdate = updates.find((r: Recorded) => (r.payload as any)?.status === "failed");
    expect(failedUpdate, "checkpoint must not be recorded as a failure").toBeFalsy();
  });

  it("requeueForContinuation stamps the case queued with next_stage preserved so the next worker tick resumes from the checkpoint", async () => {
    const db = makeFakeDb();
    await requeueForContinuation(db, "case-1", "analyzers");
    const caseUpdate = db.recorded.find(
      (r: Recorded) => r.table === "cases" && r.op === "update" && (r.payload as any)?.status === "queued",
    );
    expect(caseUpdate, "expected queued case update carrying resume info").toBeTruthy();
    expect((caseUpdate!.payload as any).next_stage).toBe("analyzers");
    // Lease must be released so a fresh worker tick can pick this up immediately.
    expect((caseUpdate!.payload as any).worker_lease_until).toBeNull();
  });
});

describe("sweepStalledCases — ledger/case split-brain regression", () => {
  it("force-failing a stale running ledger row also terminates the owning running case", async () => {
    const recorded: Recorded[] = [];
    const db = {
      recorded,
      from: (table: string) => ({
        select: (_cols?: string) => {
          const match: Record<string, unknown> = {};
          const b: any = {
            in: (k: string, v: unknown) => { match[k] = v; return b; },
            lt: (k: string, v: unknown) => { match[`${k}<`] = v; return b; },
            eq: (k: string, v: unknown) => { match[k] = v; return b; },
            then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
              recorded.push({ table, op: "select", match });
              // No stale case selected up front — this reproduces the live
              // split-brain where the case lease was still unexpired, but the
              // engine run itself had already exceeded the stall cutoff.
              resolve({ data: [], error: null });
            },
          };
          return b;
        },
        update: (payload: unknown) => {
          const match: Record<string, unknown> = {};
          const b: any = {
            eq: (k: string, v: unknown) => { match[k] = v; return b; },
            in: (k: string, v: unknown) => { match[k] = v; return b; },
            lt: (k: string, v: unknown) => { match[`${k}<`] = v; return b; },
            select: () => ({
              then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
                recorded.push({ table, op: "update", payload, match });
                resolve({
                  data: table === "pipeline_engine_runs" ? [{ id: "run-1", case_id: "case-split-brain" }] : [],
                  error: null,
                });
              },
            }),
            then: (resolve: (v: { data: null; error: null }) => void) => {
              recorded.push({ table, op: "update", payload, match });
              resolve({ data: null, error: null });
            },
          };
          return b;
        },
      }),
    } as any;

    await sweepStalledCases(db, { staleMs: 1 });

    const ledgerFail = recorded.find(
      (r) => r.table === "pipeline_engine_runs" && r.op === "update" && (r.payload as any)?.status === "failed",
    );
    expect(ledgerFail, "expected stale running ledger row to be force-failed").toBeTruthy();

    const caseFail = recorded.find(
      (r) => r.table === "cases" && r.op === "update" && (r.payload as any)?.status === "failed",
    );
    expect(caseFail, "expected owning case to be failed too, not left intelligence_running").toBeTruthy();
    expect((caseFail!.payload as any).stall_reason).toBe("worker_timeout");
    expect((caseFail!.payload as any).worker_lease_until).toBeNull();
  });
});

describe("rethrowIfCheckpoint — systemic guard for stage inner catches", () => {
  it("re-throws a CheckpointRequired instead of letting a catch swallow it (the trial_prep / work_product bug pattern)", () => {
    // Simulate an engine's inner catch block: without the guard the checkpoint
    // signal is converted into a `failed` batch record and the runner never
    // yields — which is exactly how two separate stages timed out in prod.
    const swallowed = () => {
      try {
        throw new CheckpointRequired("agents", "batch 3/12");
      } catch (e) {
        rethrowIfCheckpoint(e);
        // legacy path — treat as a warning/log only
        return "swallowed";
      }
    };
    expect(swallowed).toThrow(CheckpointRequired);
  });

  it("passes ordinary errors through so recovery/logging still runs", () => {
    let recovered: string | null = null;
    const boom = new Error("HTTP 500 provider unavailable");
    try {
      throw boom;
    } catch (e) {
      rethrowIfCheckpoint(e);
      recovered = e instanceof Error ? e.message : String(e);
    }
    expect(recovered).toBe("HTTP 500 provider unavailable");
  });
});

