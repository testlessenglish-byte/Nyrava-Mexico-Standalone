// Account administration server functions — profile + voice + notification
// preferences, plus password / email change. All operations scope to the
// signed-in user via RLS.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ----- Profile + preferences --------------------------------------------

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;

    const [{ data: profile }, { data: settings }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,avatar_url").eq("id", userId).maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    // Ensure a settings row exists
    let s = settings;
    if (!s) {
      const { data: inserted } = await supabase
        .from("user_settings")
        .insert({ user_id: userId })
        .select("*")
        .maybeSingle();
      s = inserted;
    }

    const { data: authUser } = await supabase.auth.getUser();

    return {
      userId,
      email: authUser?.user?.email ?? profile?.email ?? null,
      emailConfirmedAt: authUser?.user?.email_confirmed_at ?? null,
      lastSignInAt: authUser?.user?.last_sign_in_at ?? null,
      profile: profile ?? null,
      settings: s ?? null,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
    };
  });

const ProfileSchema = z.object({
  full_name: z.string().trim().max(120).optional(),
  display_name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  firm_name: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  avatar_url: z.string().url().max(512).optional().or(z.literal("")),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProfileSchema.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;

    if (data.full_name !== undefined || data.avatar_url !== undefined) {
      await supabase.from("profiles").update({
        ...(data.full_name !== undefined ? { full_name: data.full_name } : {}),
        ...(data.avatar_url !== undefined ? { avatar_url: data.avatar_url || null } : {}),
      }).eq("id", userId);
    }
    const settingsPatch: Record<string, unknown> = {};
    for (const k of ["display_name","phone","firm_name","title","avatar_url"] as const) {
      if (data[k] !== undefined) settingsPatch[k] = data[k] || null;
    }
    if (Object.keys(settingsPatch).length) {
      await supabase.from("user_settings").upsert({ user_id: userId, ...settingsPatch });
    }
    return { ok: true };
  });

const VoiceSchema = z.object({
  voice_id: z.string().min(1).max(64).optional(),
  voice_speed: z.number().min(0.5).max(1.5).optional(),
  voice_muted: z.boolean().optional(),
  voice_autoplay: z.boolean().optional(),
  voice_continuous: z.boolean().optional(),
  voice_pitch: z.enum(["low", "medium", "high"]).optional(),
  voice_accent: z.enum(["us", "uk", "au", "ca", "es-mx", "es-es", "neutral"]).optional(),
  voice_gender: z.enum(["female", "male"]).optional(),
});

export const updateVoicePrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => VoiceSchema.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;
    await supabase.from("user_settings").upsert({ user_id: userId, ...data });
    return { ok: true };
  });

const NotifSchema = z.object({
  notify_email: z.boolean().optional(),
  notify_pipeline_complete: z.boolean().optional(),
  notify_pipeline_failed: z.boolean().optional(),
  notify_new_evidence: z.boolean().optional(),
});

export const updateNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => NotifSchema.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;
    await supabase.from("user_settings").upsert({ user_id: userId, ...data });
    return { ok: true };
  });

const AISchema = z.object({
  ai_default_mode: z.enum(["evidence_grounded", "exploratory", "strategic"]).optional(),
  ai_response_style: z.enum(["professional", "conversational", "concise"]).optional(),
  ai_max_response_chars: z.number().int().min(200).max(8000).optional(),
});

export const updateAIPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AISchema.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;
    await supabase.from("user_settings").upsert({ user_id: userId, ...data });
    return { ok: true };
  });

// ----- Email / Password ---------------------------------------------------

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ newPassword: z.string().min(8).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const { error } = await supabase.auth.updateUser({ password: data.newPassword });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const changeEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ newEmail: z.string().email().max(255) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const { error } = await supabase.auth.updateUser({ email: data.newEmail });
    if (error) throw new Error(error.message);
    return { ok: true, message: "Confirmation email sent. Check your inbox to finalize the change." };
  });

// ----- Activity history --------------------------------------------------

export const getRecentActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;

    const [{ data: cases }, { data: runs }, { data: chats }] = await Promise.all([
      supabase.from("cases").select("id,name,status,created_at").eq("owner_id", userId).order("created_at", { ascending: false }).limit(10),
      supabase.from("pipeline_engine_runs").select("id,engine,status,started_at,case_id").eq("user_id", userId).order("started_at", { ascending: false }).limit(15),
      supabase.from("case_chat_messages").select("id,role,created_at,case_id").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    ]);

    return {
      cases: cases ?? [],
      runs: runs ?? [],
      chats: chats ?? [],
    };
  });
