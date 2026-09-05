// Client-callable entry point for the 13-agent pipeline.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { AGENT_DEFINITIONS } from "@/lib/agents/types";

type Db = SupabaseClient<Database>;
type AuthContext = { supabase?: Db; userId?: string };

type AgentLogRow = { agent_key?: string | null; agent_index?: number | null; created_at?: string | null };

/**
 * Pure dedup step for getAgentLogs' default (no explicit runId) view. See
 * that handler's doc comment for WHY this exists: the 13-agent pipeline
 * writes agent_logs under TWO different run_ids per case (a 13-agent
 * preliminary pass, then a 4-agent final-release-review pass that always
 * runs last) — naively scoping to "the single most recent run_id" silently
 * drops the other 9 agents from every live view once a pipeline finishes.
 * `rows` MUST already be ordered newest-first by created_at; this keeps the
 * first (= newest) row seen per agent_key and discards the rest, then
 * re-sorts by agent_index for stable display order.
 */
export function latestRowPerAgentKey<T extends AgentLogRow>(rows: readonly T[]): T[] {
  const latestPerAgent = new Map<string, T>();
  for (const row of rows) {
    const key = String(row.agent_key ?? "");
    if (key && !latestPerAgent.has(key)) latestPerAgent.set(key, row);
  }
  return [...latestPerAgent.values()].sort(
    (a, b) => Number(a.agent_index ?? 0) - Number(b.agent_index ?? 0),
  );
}

async function getAuthedContext(context: AuthContext, label: string) {
  if (context?.supabase && context.userId) {
    return { supabase: context.supabase, userId: context.userId };
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error(`[${label}] backend env unavailable`);
  const { getRequest } = await import("@tanstack/react-start/server");
  const authHeader = getRequest()?.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error(`[${label}] signed-in session was not attached`);
  }
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  let userId: string;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('bad format');
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4);
    const claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    if (!claims?.sub) throw new Error('no sub');
    userId = claims.sub;
  } catch (_) {
    throw new Error(`[${label}] session invalid`);
  }
  return { supabase, userId };
}

export const runMultiAgentAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = await getAuthedContext(context, "MultiAgent");
    // Groq temporarily removed — see pipeline-runner.server.ts for details.
    // Router still resolves this user's active keys (Gemini) via userId.
    const apiKey = "";
    const keys: string[] = [];
    const { runMultiAgentPipeline } = await import("@/lib/agents/orchestrator.server");
    return runMultiAgentPipeline({
      db: supabase,
      userId,
      caseId: data.caseId,
      apiKey,
      apiKeys: keys,
      // Manual/admin reruns are analytical passes, not final release
      // reviews. A report may not exist yet; only runFinalReleaseReview()
      // may assign the terminal case status after Report Writer saves it.
      deferRelease: true,
    });
  });

export const getAgentLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid(), runId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = await getAuthedContext(context, "AgentLogs");
    if (data.runId) {
      // Explicit request for ONE specific historical run (e.g. an admin
      // inspecting a past run's raw log) — return exactly that run's rows,
      // unmodified.
      const { data: rows, error } = await supabase
        .from("agent_logs")
        .select("*")
        .eq("case_id", data.caseId)
        .eq("run_id", data.runId)
        .order("agent_index", { ascending: true });
      if (error) throw new Error(error.message);
      return { agents: AGENT_DEFINITIONS, logs: rows ?? [], runId: data.runId };
    }
    // Default (live case view): the 13-agent pipeline runs in TWO passes per
    // case — a preliminary pass covering all 13 agents (deferRelease:true),
    // then runFinalReleaseReview() as the pipeline's LAST step, which
    // re-runs only 4 gate agents (report/qa/judge/hallucination) under a
    // BRAND NEW run_id. Resolving "no runId" to "the single most recently
    // created run_id" (the previous behavior) therefore always resolved to
    // that narrower final-review run once a pipeline finished — silently
    // dropping the other 9 agents from every live view permanently after
    // every completed run (the reported bug: 13/13 executed mid-run,
    // 4/13 once "Report Generator completed" fires). Instead, take the
    // latest row PER agent_key across every run_id for this case — the
    // same aggregation buildAgentStatistics() (statistics.server.ts) already
    // uses server-side for the report's own persisted snapshot, so the live
    // view and the snapshot agree.
    const { data: rows, error } = await supabase
      .from("agent_logs")
      .select("*")
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const logs = latestRowPerAgentKey(rows ?? []);
    const runId = (rows?.[0] as { run_id?: string } | undefined)?.run_id;
    return { agents: AGENT_DEFINITIONS, logs, runId };
  });

