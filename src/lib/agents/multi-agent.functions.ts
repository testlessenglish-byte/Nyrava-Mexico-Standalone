// Client-callable entry point for the 13-agent pipeline.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { AGENT_DEFINITIONS } from "@/lib/agents/types";

type Db = SupabaseClient<Database>;
type AuthContext = { supabase?: Db; userId?: string };

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
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error(`[${label}] session invalid`);
  return { supabase, userId: data.claims.sub };
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
    });
  });

export const getAgentLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid(), runId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = await getAuthedContext(context, "AgentLogs");
    let runId = data.runId;
    if (!runId) {
      const { data: latest, error: latestErr } = await supabase
        .from("agent_logs")
        .select("run_id")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestErr) throw new Error(latestErr.message);
      runId = latest?.run_id;
    }
    let q = supabase.from("agent_logs").select("*").eq("case_id", data.caseId);
    if (runId) q = q.eq("run_id", runId);
    const { data: rows, error } = await q.order("agent_index", { ascending: true });
    if (error) throw new Error(error.message);
    return { agents: AGENT_DEFINITIONS, logs: rows ?? [], runId };
  });
