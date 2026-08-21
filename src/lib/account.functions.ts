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
      const { error } = await supabase.from("user_settings").upsert({ user_id: userId, ...settingsPatch });
      if (error) throw new Error(error.message);
    }

    let organizationCreated = false;
    let organizationId: string | null = null;
    const firmName = data.firm_name?.trim();
    if (firmName) {
      const { data: membership, error: membershipError } = await supabase
        .from("org_memberships")
        .select("org_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (membershipError) throw new Error(membershipError.message);
      if (!membership?.org_id) {
        const slugBase = firmName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 40) || "organization";
        const { data: organization, error: organizationError } = await supabase.rpc(
          "create_account_organization",
          {
            p_name: firmName,
            p_slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`,
            p_prefix: "NYR-SOC",
          },
        );
        if (organizationError) throw new Error(organizationError.message);
        const result = organization as { id?: string } | null;
        organizationId = result?.id ?? null;
        organizationCreated = true;
      } else {
        organizationId = membership.org_id;
      }
    }
    return { ok: true, organizationCreated, organizationId };
  });

// ----- Beta / professional profile intake ---------------------------------
// Beta testers get full product access (no subscription, no free-case cap)
// but no admin powers. The trade is that they complete a real professional
// profile first, so every session is attributable to a named practitioner.

export type ProfileSetupStatus = {
  isBetaTester: boolean;
  complete: boolean;
  values: {
    full_name: string;
    phone: string;
    firm_name: string;
    title: string;
    cedula_profesional: string;
    state_practice: string;
    practice_focus: string;
    years_experience: string;
  };
};

const REQUIRED_PROFILE_FIELDS = [
  "full_name",
  "firm_name",
  "title",
  "state_practice",
  "practice_focus",
] as const;

export const getProfileSetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;

    const [{ data: profile }, { data: settings }, { data: sub }] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("subscriptions").select("is_beta_tester").eq("user_id", userId).maybeSingle(),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (settings ?? {}) as any;
    const values = {
      full_name: (profile?.full_name as string | null) ?? "",
      phone: s.phone ?? "",
      firm_name: s.firm_name ?? "",
      title: s.title ?? "",
      cedula_profesional: s.cedula_profesional ?? "",
      state_practice: s.state_practice ?? "",
      practice_focus: s.practice_focus ?? "",
      years_experience: s.years_experience ?? "",
    };
    const complete =
      Boolean(s.profile_completed_at) &&
      REQUIRED_PROFILE_FIELDS.every((k) => String(values[k] ?? "").trim().length > 0);

    return {
      isBetaTester: Boolean(sub?.is_beta_tester),
      complete,
      values,
    } as ProfileSetupStatus;
  });

const ProfileSetupSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  firm_name: z.string().trim().min(2).max(160),
  title: z.string().trim().min(2).max(120),
  state_practice: z.string().trim().min(2).max(80),
  practice_focus: z.string().trim().min(2).max(200),
  cedula_profesional: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(40).optional(),
  years_experience: z.string().trim().max(40).optional(),
});

export const completeProfileSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProfileSetupSchema.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    const supabase = ctx.supabase;
    const userId = ctx.userId as string;

    const { error: profErr } = await supabase
      .from("profiles")
      .upsert({ id: userId, full_name: data.full_name });
    if (profErr) throw new Error(profErr.message);

    const { error } = await supabase.from("user_settings").upsert({
      user_id: userId,
      phone: data.phone || null,
      firm_name: data.firm_name,
      title: data.title,
      cedula_profesional: data.cedula_profesional || null,
      state_practice: data.state_practice,
      practice_focus: data.practice_focus,
      years_experience: data.years_experience || null,
      profile_completed_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    // Every account lands in the workspace with two ready-to-run amparo
    // matters (~24 documents each) so a tester can execute the full pipeline
    // immediately, without uploading anything and without adding an API key —
    // beta accounts run on platform intelligence keys. Never blocks the save.
    let starterCases: string[] = [];
    try {
      const { ensureStarterCasesForUser } = await import("@/lib/seed-corpus.server");
      const res = await ensureStarterCasesForUser(userId);
      starterCases = res.created;
    } catch (e) {
      console.error("[profile-setup] starter case seeding failed", e);
    }

    return { ok: true, starterCases };
  });

/**
 * Idempotent top-up of the two starter amparo matters. Called from the
 * workspace for accounts that signed up before seeding existed, or whose
 * seeding failed during profile setup.
 */
export const ensureStarterCases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (context as any).userId as string;
    const { ensureStarterCasesForUser } = await import("@/lib/seed-corpus.server");
    return await ensureStarterCasesForUser(userId);
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
