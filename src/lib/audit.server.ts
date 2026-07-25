// Best-effort audit logger. Never throws — audit failures must not break flows.
// Uses service role so writes bypass the very restrictive RLS on admin_audit_log.

export async function logAudit(params: {
  actorId: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("admin_audit_log").insert({
      actor_id: params.actorId,
      action: params.action,
      target: params.target ?? null,
      meta: params.meta ?? {},
    });
  } catch {
    // swallow — audit is non-critical
  }
}
