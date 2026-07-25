// Background pipeline worker. Called by pg_cron every minute.
// - Leases one queued case at a time (SKIP LOCKED semantics via
//   worker_lease_until timestamp so parallel ticks don't double-process).
// - Runs the full pipeline for that case using the admin client (bypasses RLS).
// - Clears queue markers on completion/failure.
//
// Security: this route lives under /api/public/* so it isn't behind auth,
// but it validates the Supabase anon apikey header AND requires an internal
// worker secret. Never returns row data.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const LEASE_MS = 20 * 60 * 1000; // 20 minutes

function workerTrace(event: string, extra: Record<string, unknown> = {}) {
  console.info(`[pipeline-worker] ${JSON.stringify({
    t: new Date().toISOString(),
    event,
    ...extra,
  })}`);
}

async function leaseOneCase(admin: ReturnType<typeof createClient<Database>>) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  // Pick the oldest queued case whose lease has expired (or never set).
  // NOTE: PostgREST's `.or()` with sibling `.not()` filters was picking up
  // zero rows in production even when a matching row existed; splitting the
  // two "unclaimed" cases into two explicit queries is boring and correct.
  const buildBase = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("cases")
      .select("id,user_id,worker_lease_until,queued_at,next_stage")
      .eq("status", "queued")
      .not("queued_at", "is", null)
      .order("queued_at", { ascending: true })
      .limit(1);
  const nullLease = await buildBase().is("worker_lease_until", null);
  let cand: { id: string; user_id: string; worker_lease_until: string | null; next_stage: string | null } | undefined =
    Array.isArray(nullLease.data) ? nullLease.data[0] : undefined;
  if (!cand) {
    const expired = await buildBase().lt("worker_lease_until", now.toISOString());
    cand = Array.isArray(expired.data) ? expired.data[0] : undefined;
  }
  if (!cand) {
    workerTrace("worker.no_queued_cases", { nullLeaseErr: nullLease.error?.message ?? null });
    return null;
  }
  workerTrace("worker.lease_candidate", { caseId: cand.id, next_stage: cand.next_stage ?? null });
  // Try to atomically claim it by CAS on worker_lease_until.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (admin as any)
    .from("cases")
    .update({ worker_lease_until: leaseUntil, status: "intelligence_running", status_message: "Worker leased" })
    .eq("id", cand.id);
  const claimed = cand.worker_lease_until
    ? await q.eq("worker_lease_until", cand.worker_lease_until).select("id,user_id,next_stage").maybeSingle()
    : await q.is("worker_lease_until", null).select("id,user_id,next_stage").maybeSingle();
  if (claimed.error || !claimed.data) {
    workerTrace("worker.lease_cas_failed", { caseId: cand.id, error: claimed.error?.message ?? null });
    return null;
  }
  workerTrace("worker.lease_acquired", { caseId: claimed.data.id, next_stage: claimed.data.next_stage ?? null, lease_until: leaseUntil });
  return claimed.data as { id: string; user_id: string; next_stage: string | null };
}


export const Route = createFileRoute("/api/public/hooks/pipeline-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-worker-secret");
        if (!provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          return new Response(JSON.stringify({ error: "backend env unavailable" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        const admin = createClient<Database>(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        // Validate the worker secret against the private table (service_role only).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sec, error: secErr } = await (admin as any).from("worker_secrets").select("secret").eq("name", "pipeline_worker").maybeSingle();
        if (secErr || !sec?.secret) {
          return new Response(JSON.stringify({ error: "worker not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        // Constant-time compare
        const a = new TextEncoder().encode(provided);
        const b = new TextEncoder().encode(sec.secret);
        let ok = a.length === b.length;
        for (let i = 0; i < Math.min(a.length, b.length); i++) ok = ok && a[i] === b[i];
        if (!ok) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }


        // Sweep stalled cases FIRST — recover any case whose lease died between
        // ticks so the next lease pass can pick it up (or the owner sees the
        // "failed — click Resume" state instead of a stuck spinner).
        try {
          const { sweepStalledCases } = await import("@/lib/pipeline-stall.server");
          await sweepStalledCases(admin);
        } catch (e) {
          console.warn("[pipeline-worker] stall sweep failed", e);
        }

        const leased = await leaseOneCase(admin);
        if (!leased) {
          return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: { "Content-Type": "application/json" } });
        }

        const reset = leased.next_stage === "reset";
        const startFrom = reset ? undefined : (leased.next_stage ?? undefined);
        try {
          const { runPipelineForCase } = await import("@/lib/pipeline-runner.server");
          workerTrace("worker.pipeline_start", { caseId: leased.id, reset, startFrom: startFrom ?? null });
          const result = await runPipelineForCase(admin, leased.user_id, { caseId: leased.id, reset, startFrom });
          // If the pipeline voluntarily checkpointed (a stage hit its wall-clock
          // budget), `requeueForContinuation` has already re-set `queued_at` so
          // the next worker tick picks this case back up. Do NOT clear the
          // queue markers here in that case — doing so unconditionally wiped
          // out that re-queue and orphaned the case (it would never be leased
          // again, appearing stuck at "queued" forever).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const checkpointed = (result as any)?.warnings?.some((w: any) => w?.error === "checkpoint");
          if (!checkpointed) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from("cases").update({
              queued_at: null, worker_lease_until: null, next_stage: null,
            }).eq("id", leased.id);
            workerTrace("worker.queue_cleared", { caseId: leased.id });
          } else {
            workerTrace("worker.checkpoint_preserved", { caseId: leased.id, startFrom: startFrom ?? null });
          }
          return new Response(JSON.stringify({ ok: true, processed: 1, caseId: leased.id, result }), { headers: { "Content-Type": "application/json" } });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          workerTrace("worker.pipeline_failed", { caseId: leased.id, error: msg.slice(0, 500) });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from("cases").update({
            queued_at: null, worker_lease_until: null, next_stage: null,
            status: "failed", status_message: "Worker error", error: msg.slice(0, 2000),
          }).eq("id", leased.id);
          return new Response(JSON.stringify({ ok: false, processed: 1, caseId: leased.id, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
      },
    },
  },
});
