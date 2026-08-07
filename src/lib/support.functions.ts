// Unified in-app support/message system — "Comentarios" and "Help & Support"
// both funnel in here as different categories on one thread type. Unlike
// the older one-way user_feedback table (feedback.functions.ts, kept only
// for its historical rows), this is a real two-way thread: the sender sees
// the admin's reply inside the app, and the admin sees when the sender
// writes back, via server-tracked unread flags on the thread row.
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
  if (!error && isAdmin) return;
  // Fallback: user_roles is the source of truth, same reasoning as
  // feedback.functions.ts's requireAdmin — the RPC path can return false in
  // production when grants/PostgREST role drift, which would lock a real
  // admin out of their own inbox.
  const { data: roleRows, error: roleErr } = await getAdminClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId);
  if (roleErr) throw new Error(roleErr.message);
  const roles = (roleRows ?? []).map((r) => String((r as { role: string }).role));
  if (roles.some((r) => ["admin", "super_admin", "platform_admin", "firm_admin"].includes(r))) return;
  throw new Error("Forbidden — admin required.");
}

export const SUPPORT_CATEGORIES = [
  "support",
  "bug",
  "wrong_result",
  "missing_feature",
  "usability",
  "legal_accuracy",
  "general",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export type SupportThreadRow = {
  id: string;
  user_id: string;
  email: string | null;
  category: string;
  severity: string;
  page_path: string | null;
  case_id: string | null;
  status: string;
  unread_by_admin: boolean;
  unread_by_user: boolean;
  last_message_at: string;
  created_at: string;
};

export type SupportMessageRow = {
  id: string;
  thread_id: string;
  sender: "user" | "admin";
  sender_user_id: string | null;
  body: string;
  created_at: string;
};

const SubmitSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  category: z.enum(SUPPORT_CATEGORIES).default("general"),
  severity: z.enum(["low", "normal", "high", "blocking"]).default("normal"),
  page_path: z.string().trim().max(300).optional(),
  case_id: z.string().uuid().optional(),
  /** Append to an existing thread instead of starting a new one. */
  thread_id: z.string().uuid().optional(),
});

/** Start a new thread, or append a message to one of the caller's own
 * existing threads. Always attributed to the signed-in user. */
export const submitSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubmitSchema.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    const { data: authUser } = await ctx.supabase.auth.getUser();
    const email = authUser?.user?.email ?? null;
    const now = new Date().toISOString();

    let threadId = data.thread_id;
    if (threadId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: thread, error: threadErr } = await (ctx.supabase as any)
        .from("support_threads")
        .select("id,user_id")
        .eq("id", threadId)
        .maybeSingle();
      if (threadErr) throw new Error(threadErr.message);
      if (!thread || thread.user_id !== ctx.userId) throw new Error("Thread not found.");
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error: insertErr } = await (ctx.supabase as any)
        .from("support_threads")
        .insert({
          user_id: ctx.userId,
          email,
          category: data.category,
          severity: data.severity,
          page_path: data.page_path ?? null,
          case_id: data.case_id ?? null,
        })
        .select("id")
        .single();
      if (insertErr) throw new Error(insertErr.message);
      threadId = inserted.id as string;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: msgErr } = await (ctx.supabase as any).from("support_messages").insert({
      thread_id: threadId,
      sender: "user",
      sender_user_id: ctx.userId,
      body: data.body,
    });
    if (msgErr) throw new Error(msgErr.message);

    // A follow-up from the user always re-flags the thread as needing
    // admin attention, even if the admin had already replied and resolved
    // it — reopening is implicit, not a separate step the user has to know
    // to take.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (getAdminClient() as any)
      .from("support_threads")
      .update({ unread_by_admin: true, last_message_at: now, status: "open" })
      .eq("id", threadId);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true, thread_id: threadId };
  });

/** The caller's own threads, newest activity first. */
export const listMySupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.supabase as any)
      .from("support_threads")
      .select("*")
      .eq("user_id", ctx.userId)
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as SupportThreadRow[];
  });

/** Count of the caller's own threads with an unread admin reply — powers
 * the header bell badge for a regular (non-admin) user. */
export const countMyUnreadSupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (ctx.supabase as any)
      .from("support_threads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId)
      .eq("unread_by_user", true);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

/** Full message history for one of the caller's own threads. Marks it read
 * by the user as a side effect — opening the thread IS reading it. */
export const getMySupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: thread, error: threadErr } = await (ctx.supabase as any)
      .from("support_threads")
      .select("*")
      .eq("id", data.threadId)
      .maybeSingle();
    if (threadErr) throw new Error(threadErr.message);
    if (!thread || thread.user_id !== ctx.userId) throw new Error("Thread not found.");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: messages, error: msgErr } = await (ctx.supabase as any)
      .from("support_messages")
      .select("*")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error(msgErr.message);

    if (thread.unread_by_user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (getAdminClient() as any)
        .from("support_threads")
        .update({ unread_by_user: false })
        .eq("id", data.threadId);
    }

    return { thread: thread as SupportThreadRow, messages: (messages ?? []) as SupportMessageRow[] };
  });

// ---- Admin side ---------------------------------------------------------

/** Every thread, newest activity first — the unified admin inbox. */
export const adminListSupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // Service-role client, not ctx.supabase: requireAdmin's own fallback
    // exists precisely because is_admin_tier() can drift false in
    // production (see its comment above). If the query below still ran
    // through the RLS-bound user client, a drifted admin would pass the
    // permission check here and then silently get an empty/wrong inbox from
    // support_threads_select_own_or_admin's OWN is_admin_tier() check,
    // which has no such fallback — same class of "locked out of your own
    // inbox" bug this pattern was built to prevent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getAdminClient() as any)
      .from("support_threads")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as SupportThreadRow[];
  });

/** Count of threads with an unread message from a sender — powers the
 * header bell badge when the signed-in user is an admin. */
export const adminCountUnreadSupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (getAdminClient() as any)
      .from("support_threads")
      .select("id", { count: "exact", head: true })
      .eq("unread_by_admin", true);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

/** Full message history for any thread. Marks it read by the admin as a
 * side effect. */
export const adminGetSupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const admin = getAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: thread, error: threadErr } = await (admin as any)
      .from("support_threads")
      .select("*")
      .eq("id", data.threadId)
      .maybeSingle();
    if (threadErr) throw new Error(threadErr.message);
    if (!thread) throw new Error("Thread not found.");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: messages, error: msgErr } = await (admin as any)
      .from("support_messages")
      .select("*")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error(msgErr.message);

    if (thread.unread_by_admin) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from("support_threads").update({ unread_by_admin: false }).eq("id", data.threadId);
    }

    return { thread: thread as SupportThreadRow, messages: (messages ?? []) as SupportMessageRow[] };
  });

/** Reply to a thread as the admin — the sender sees this inside the app. */
export const adminReplyToSupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ threadId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const admin = getAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: msgErr } = await (admin as any).from("support_messages").insert({
      thread_id: data.threadId,
      sender: "admin",
      sender_user_id: ctx.userId,
      body: data.body,
    });
    if (msgErr) throw new Error(msgErr.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (admin as any)
      .from("support_threads")
      .update({ unread_by_user: true, unread_by_admin: false, last_message_at: new Date().toISOString() })
      .eq("id", data.threadId);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true };
  });

/** Mark a thread open/resolved. */
export const adminSetSupportThreadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ threadId: z.string().uuid(), status: z.enum(["open", "resolved"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (getAdminClient() as any)
      .from("support_threads")
      .update({ status: data.status })
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
