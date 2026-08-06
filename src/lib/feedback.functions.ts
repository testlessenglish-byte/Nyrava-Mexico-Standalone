// Direct feedback channel — beta testers (and any signed-in user) send a
// note straight to the admin inbox at /admin/feedback. Rows land in
// public.user_feedback: users may insert and read only their own, admins
// read everything (RLS policy feedback_select_own_or_admin).
import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Db = SupabaseClient<Database>;

function getAdminClient(): Db {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Backend environment unavailable.");
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

async function requireAdmin(ctx: { supabase: Db; userId: string }) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("is_admin_tier", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden — admin required.");
}

export const FEEDBACK_CATEGORIES = [
  "bug",
  "wrong_result",
  "missing_feature",
  "usability",
  "legal_accuracy",
  "general",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export type FeedbackRow = {
  id: string;
  user_id: string;
  email: string | null;
  category: string;
  severity: string;
  message: string;
  page_path: string | null;
  case_id: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

const SubmitSchema = z.object({
  message: z.string().trim().min(5).max(4000),
  category: z.enum(FEEDBACK_CATEGORIES).default("general"),
  severity: z.enum(["low", "normal", "high", "blocking"]).default("normal"),
  page_path: z.string().trim().max(300).optional(),
  case_id: z.string().uuid().optional(),
});

/** Send feedback to the admin inbox. Always attributed to the signed-in
 * user — the client cannot spoof user_id. */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubmitSchema.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    const { data: authUser } = await ctx.supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (ctx.supabase as any).from("user_feedback").insert({
      user_id: ctx.userId,
      email: authUser?.user?.email ?? null,
      category: data.category,
      severity: data.severity,
      message: data.message,
      page_path: data.page_path ?? null,
      case_id: data.case_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Everything anyone has sent, newest first — admin inbox. */
export const adminListFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.supabase as any)
      .from("user_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as FeedbackRow[];
  });

/** Triage: mark a submission read/resolved and optionally leave a note.
 * Writes go through the service-role client — `authenticated` only holds
 * SELECT/INSERT on the table by design. */
export const adminUpdateFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "read", "in_progress", "resolved"]).optional(),
        admin_note: z.string().trim().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.admin_note !== undefined) patch.admin_note = data.admin_note || null;
    if (!Object.keys(patch).length) return { ok: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (getAdminClient() as any)
      .from("user_feedback")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Count of untriaged submissions — drives the admin nav badge. */
export const adminCountNewFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (ctx.supabase as any)
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });
