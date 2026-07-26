// Read-side of the pipeline instrumentation. RLS scopes every row to the
// caller's own cases, so no extra ownership check is needed beyond auth.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PipelineTraceRow = {
  id: number;
  case_id: string;
  correlation_id: string | null;
  phase: string;
  step: string;
  status: string;
  level: string;
  provider: string | null;
  model: string | null;
  attempt: number | null;
  duration_ms: number | null;
  detail: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
};

const Input = z.object({
  caseId: z.string().uuid(),
  /** Only return rows newer than this id (incremental polling). */
  sinceId: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const getPipelineTrace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: import("@supabase/supabase-js").SupabaseClient };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("pipeline_trace")
      .select("id,case_id,correlation_id,phase,step,status,level,provider,model,attempt,duration_ms,detail,error,created_at")
      .eq("case_id", data.caseId)
      .order("id", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.sinceId) q = q.gt("id", data.sinceId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = ((rows ?? []) as PipelineTraceRow[]).slice().reverse();
    return {
      rows: list,
      maxId: list.length ? list[list.length - 1].id : (data.sinceId ?? 0),
    };
  });
