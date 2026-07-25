// Recovery Certification — pre-flight gate must keep refusing report
// generation until the specific failed engines are re-run AND completed.
// "Only failed engines retry" is enforced by deriving from the latest row
// per engine; previously-completed engines remain completed.
import { describe, it, expect } from "vitest";
import {
  missingRequiredEngines,
  REPORT_REQUIRED_ENGINES,
  type ExecutionRow,
} from "@/lib/execution-state";

const t = (m: number) => `2026-06-25T10:${String(m).padStart(2, "0")}:00Z`;
const row = (engine: string, status: ExecutionRow["status"], iso: string): ExecutionRow => ({
  id: `${engine}-${iso}`, engine, status, started_at: iso, ended_at: iso, created_at: iso,
});

describe("Recovery — failure → retry → completion", () => {
  it("a single engine failure blocks report and clears after retry-complete", () => {
    const completed = REPORT_REQUIRED_ENGINES.map((e) => row(e, "completed", t(0)));
    const target = REPORT_REQUIRED_ENGINES[3];
    const failed = [
      ...completed.filter((r) => r.engine !== target),
      row(target, "failed", t(5)),
    ];
    expect(missingRequiredEngines(failed)).toEqual([target]);

    const retried = [...failed, row(target, "completed", t(10))];
    expect(missingRequiredEngines(retried)).toEqual([]);
  });

  it("a provider-outage scenario (multiple failed engines) reports all of them", () => {
    const completed = REPORT_REQUIRED_ENGINES.map((e) => row(e, "completed", t(0)));
    const failedEngines: string[] = REPORT_REQUIRED_ENGINES.slice(2, 5);
    const failed = [
      ...completed.filter((r) => !failedEngines.includes(r.engine)),
      ...failedEngines.map((e) => row(e, "failed", t(5))),
    ];
    expect(missingRequiredEngines(failed).sort()).toEqual([...failedEngines].sort());
  });

  it("a previously-completed engine is not re-required after a transient running row", () => {
    const e = REPORT_REQUIRED_ENGINES[0];
    const rows: ExecutionRow[] = [
      row(e, "completed", t(0)),
      // Newer running row would normally win, simulating a retry mid-flight.
      // The gate correctly blocks the report until that retry completes.
      row(e, "running",   t(5)),
    ];
    expect(missingRequiredEngines(rows)).toContain(e);
    const settled = [...rows, row(e, "completed", t(10))];
    expect(missingRequiredEngines(settled)).not.toContain(e);
  });
});
