import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

const TERMINAL_STATUSES = new Set(["complete", "released", "needs_revision", "failed", "cancelled"]);
const RUNNING_STATUSES = new Set([
  "queued",
  "running",
  "extracting",
  "analyzing",
  "scoring",
  "reporting",
  "intelligence_running",
  "extraction_running",
  "extraction_complete",
  "analyzers_running",
  "analyzers_complete",
  "agents_running",
  "agents_complete",
  "timeline_running",
  "evidence_running",
  "sufficiency_running",
  "report_running",
]);

function isRunningStatus(status: string | null): boolean {
  return RUNNING_STATUSES.has(String(status ?? ""));
}

export type PipelineLeaseClaim =
  | { claimed: true; previousStatus: string | null; leaseUntil: string }
  | { claimed: false; done: true; status: string | null }
  | { claimed: false; alreadyRunning: true; status: string | null; leaseUntil: string | null };

export async function claimPipelineLease(
  db: Db,
  caseId: string,
  opts?: { reset?: boolean; leaseMs?: number },
): Promise<PipelineLeaseClaim> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: readErr } = await (db as any)
    .from("cases")
    .select("status, worker_lease_until")
    .eq("id", caseId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("Case not found");

  const status = (row.status as string | null) ?? null;
  if (!opts?.reset && TERMINAL_STATUSES.has(String(status ?? ""))) {
    return { claimed: false, done: true, status };
  }

  const leaseUntilMs = row.worker_lease_until ? new Date(row.worker_lease_until as string).getTime() : 0;
  const leaseActive = leaseUntilMs > Date.now();
  if (leaseActive || isRunningStatus(status)) {
    return {
      claimed: false,
      alreadyRunning: true,
      status,
      leaseUntil: (row.worker_lease_until as string | null) ?? null,
    };
  }

  const claimUntil = new Date(Date.now() + (opts?.leaseMs ?? 60_000)).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePatch = { worker_lease_until: claimUntil };
  const base = (db as any)
    .from("cases")
    .update(updatePatch)
    .eq("id", caseId)
    .not("status", "in", `(${[...RUNNING_STATUSES].join(",")})`);
  const claim = row.worker_lease_until
    ? await base.eq("worker_lease_until", row.worker_lease_until).select("id").maybeSingle()
    : await base.is("worker_lease_until", null).select("id").maybeSingle();
  if (claim.error || !claim.data) {
    return {
      claimed: false,
      alreadyRunning: true,
      status,
      leaseUntil: (row.worker_lease_until as string | null) ?? null,
    };
  }
  return { claimed: true, previousStatus: status, leaseUntil: claimUntil };
}