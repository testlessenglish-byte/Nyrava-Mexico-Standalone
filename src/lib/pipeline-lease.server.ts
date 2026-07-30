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

/**
 * Cap on how many pipelines ONE user may have running at the same time.
 * Sized to what a single set of Groq/Gemini keys can sustain without
 * tripping provider rate limits. Override with PIPELINE_MAX_CONCURRENT.
 */
export const MAX_CONCURRENT_PIPELINES_PER_USER = Number(
  process.env.PIPELINE_MAX_CONCURRENT ?? 2,
);

/** Returns the active (non-expired) lease timestamp for a case, or null. */
export async function getActiveCaseLease(db: Db, caseId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("cases")
    .select("worker_lease_until")
    .eq("id", caseId)
    .maybeSingle();
  const until = (data?.worker_lease_until as string | null) ?? null;
  if (!until) return null;
  return new Date(until).getTime() > Date.now() ? until : null;
}

/**
 * Side-door guard for the individual stage-level step endpoints. The full
 * pipeline holds a case lease while it runs; a stage button, a double-click,
 * or a stale retry must NOT fire AI calls for the same case concurrently.
 */
export async function assertCaseNotLeased(db: Db, caseId: string, label: string): Promise<void> {
  const until = await getActiveCaseLease(db, caseId);
  if (until) {
    console.warn(`[lease] ${label} blocked — case ${caseId} leased until ${until}`);
    throw new Error(
      `[${label}] Este asunto ya tiene una ejecución en curso (hasta ${until}). Espera a que termine o usa "Limpiar estado" antes de ejecutar esta etapa.`,
    );
  }
}

/** How many OTHER cases this user currently has under an active lease. */
export async function countActiveUserPipelines(
  db: Db,
  userId: string,
  excludeCaseId?: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (db as any)
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("worker_lease_until", new Date().toISOString());
  if (excludeCaseId) q = q.neq("id", excludeCaseId);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Throws when the user is already at the concurrent-pipeline ceiling.
 * Prevents one account from kicking off N cases at once and burning the
 * whole Gemini/Groq quota.
 */
export async function assertUserPipelineCapacity(
  db: Db,
  userId: string,
  caseId: string,
): Promise<void> {
  const active = await countActiveUserPipelines(db, userId, caseId);
  if (active >= MAX_CONCURRENT_PIPELINES_PER_USER) {
    console.warn(`[lease] capacity block — user ${userId} has ${active} active pipelines`);
    throw new Error(
      `Límite de ejecuciones simultáneas alcanzado (${active}/${MAX_CONCURRENT_PIPELINES_PER_USER}). Espera a que termine otro asunto antes de iniciar este.`,
    );
  }
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
  // Only an ACTIVE lease means someone else is really working the case. A
  // running-looking status with an expired (or missing) lease is a stale run
  // that died mid-stage — resume must be able to take it over, otherwise the
  // "Resume pipeline" button silently does nothing forever.
  if (leaseActive) {
    return {
      claimed: false,
      alreadyRunning: true,
      status,
      leaseUntil: (row.worker_lease_until as string | null) ?? null,
    };
  }
  const staleRunning = isRunningStatus(status);

  const claimUntil = new Date(Date.now() + (opts?.leaseMs ?? 60_000)).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePatch = { worker_lease_until: claimUntil };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let base = (db as any).from("cases").update(updatePatch).eq("id", caseId);
  if (!staleRunning) {
    base = base.not("status", "in", `(${[...RUNNING_STATUSES].join(",")})`);
  }
  // Compare-and-swap on the lease column keeps two concurrent takeovers apart.
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