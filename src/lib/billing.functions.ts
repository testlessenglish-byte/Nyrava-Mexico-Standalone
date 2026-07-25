// Subscription billing — status reads for the UI, Stripe Checkout/portal
// session creation, and the internal free-case gating helpers used by
// createCaseAndUpload (cases.functions.ts).
//
// Writes to `subscriptions` always go through a service-role admin client
// (see getAdminClient below), scoped by a server-verified userId — never by
// a client-supplied one. RLS on the table grants `authenticated` SELECT
// only, so a normal user-scoped client could never write here even if it
// tried; the admin client is what makes free-case consumption and Stripe
// linkage possible at all. See the migration file for the full rationale.
import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { BILLING_PLANS, isPlanKey, type PlanKey } from "./billing-plans";

type Db = SupabaseClient<Database>;
type SubRow = Database["public"]["Tables"]["subscriptions"]["Row"];

function getAdminClient(): Db {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Billing backend environment unavailable (missing SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

async function getAuthedUserId(context: { supabase?: Db; userId?: string }): Promise<string> {
  if (context?.userId) return context.userId;
  throw new Error("Not signed in.");
}

// ---------------------------------------------------------------------
// Internal helpers — called from cases.functions.ts, not exposed as
// createServerFn endpoints themselves (no direct client access).
// ---------------------------------------------------------------------

export type BillingAccess = {
  allowed: boolean;
  plan: PlanKey | null;
  status: SubRow["status"];
  freeCaseUsed: boolean;
  reason: "beta_tester" | "subscribed" | "free_case_available" | "free_case_rerun" | "free_case_used_by_other_case";
};

/** Whether this user may queue/run `caseId` right now. Read-only — does not
 * consume the free case. Pass the caseId being queued so a rerun of the
 * SAME case that already used the free allowance is still permitted. */
export async function getBillingAccess(userId: string, caseId?: string): Promise<BillingAccess> {
  const admin = getAdminClient();

  // Platform admins bypass billing entirely — added same day as this whole
  // billing gate, because without it the account that OWNS the platform
  // gets locked out of running cases the moment its one-time free case is
  // used up on any other test case. Checked before everything else, same
  // precedence as the beta-tester bypass below.
  const { data: isAdmin, error: adminCheckErr } = await admin.rpc("is_admin_tier", { _user_id: userId });
  if (!adminCheckErr && isAdmin) {
    return { allowed: true, plan: null, status: "none", freeCaseUsed: false, reason: "beta_tester" };
  }

  const { data } = await admin
    .from("subscriptions")
    .select("plan,status,free_case_used,free_case_case_id,is_beta_tester")
    .eq("user_id", userId)
    .maybeSingle();
  const status = (data?.status ?? "none") as SubRow["status"];
  const plan = (data?.plan ?? null) as PlanKey | null;
  const freeCaseUsed = data?.free_case_used ?? false;
  // Beta testers bypass billing entirely — no subscription needed, no
  // free-case limit consumed. Checked first so a beta grant always wins
  // regardless of the user's Stripe status.
  if ((data as { is_beta_tester?: boolean } | null)?.is_beta_tester) {
    return { allowed: true, plan, status, freeCaseUsed, reason: "beta_tester" };
  }
  if (status === "active") {
    return { allowed: true, plan, status, freeCaseUsed, reason: "subscribed" };
  }
  if (!freeCaseUsed) {
    return { allowed: true, plan, status, freeCaseUsed, reason: "free_case_available" };
  }
  if (caseId && data?.free_case_case_id === caseId) {
    return { allowed: true, plan, status, freeCaseUsed, reason: "free_case_rerun" };
  }
  return { allowed: false, plan, status, freeCaseUsed, reason: "free_case_used_by_other_case" };
}

/** Marks the one-time free case as used, recording WHICH case used it. Call
 * ONLY right after successfully queuing a case for a user whose access was
 * granted via `free_case_available` — never for `subscribed` (their free
 * case should stay unconsumed in case they later cancel) or
 * `free_case_rerun` (already recorded). */
export async function consumeFreeCase(userId: string, caseId: string): Promise<void> {
  const admin = getAdminClient();
  await admin
    .from("subscriptions")
    .upsert({ user_id: userId, free_case_used: true, free_case_case_id: caseId }, { onConflict: "user_id" });
}

// ---------------------------------------------------------------------
// Client-facing endpoints
// ---------------------------------------------------------------------

export const getMyBillingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = await getAuthedUserId(context as { supabase?: Db; userId?: string });
    const access = await getBillingAccess(userId);
    const admin = getAdminClient();
    const { data } = await admin
      .from("subscriptions")
      .select("current_period_end,cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      plan: access.plan,
      status: access.status,
      freeCaseUsed: access.freeCaseUsed,
      hasAccess: access.allowed,
      isBetaTester: access.reason === "beta_tester",
      currentPeriodEnd: data?.current_period_end ?? null,
      cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    };
  });

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ planKey: z.string().min(1), origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = await getAuthedUserId(context as { supabase?: Db; userId?: string });
    const admin = getAdminClient();

    // Look up the admin-managed plan row for this key.
    const { data: planRow, error: planErr } = await admin
      .from("billing_plans")
      .select("key,label,stripe_price_id,self_serve,active")
      .eq("key", data.planKey)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!planRow || !planRow.active) throw new Error("That plan is no longer available.");
    if (!planRow.self_serve) throw new Error(`${planRow.label} is not available for self-serve checkout.`);

    // Prefer the DB-configured Stripe price; fall back to legacy env var
    // (STRIPE_PRICE_SOLO / STRIPE_PRICE_FIRM) so existing setups keep working.
    let priceId = planRow.stripe_price_id ?? null;
    if (!priceId && isPlanKey(planRow.key)) {
      const envVar = BILLING_PLANS[planRow.key].priceEnvVar;
      if (envVar) priceId = process.env[envVar] ?? null;
    }
    if (!priceId) {
      throw new Error(
        `Checkout is not configured for the ${planRow.label} plan yet — set its Stripe Price ID in Admin → Billing Plans.`,
      );
    }

    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();

    const { data: existing } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const { data: userResp } = await admin.auth.admin.getUserById(userId);
      const customer = await stripe.customers.create({
        email: userResp?.user?.email ?? undefined,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      await admin
        .from("subscriptions")
        .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: "user_id" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${data.origin}/billing?checkout=success`,
      cancel_url: `${data.origin}/billing?checkout=cancelled`,
      // Metadata on both the session AND the subscription — webhook events
      // fire on the subscription object itself (customer.subscription.*),
      // which wouldn't otherwise carry which plan tier was purchased.
      metadata: { user_id: userId, plan: planRow.key },
      subscription_data: { metadata: { user_id: userId, plan: planRow.key } },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url };
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = await getAuthedUserId(context as { supabase?: Db; userId?: string });
    const admin = getAdminClient();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      throw new Error("No billing account on file yet — subscribe to a plan first.");
    }
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${data.origin}/billing`,
    });
    return { url: portal.url };
  });

// ---------------------------------------------------------------------
// Admin: beta testers + subscriptions visibility
// ---------------------------------------------------------------------

async function requireAdmin(ctx: { supabase: Db; userId: string }) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("is_admin_tier", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden — admin required.");
}

export type AdminUserRow = {
  user_id: string;
  email: string | null;
  user_created_at: string | null;
  plan: PlanKey | null;
  status: SubRow["status"];
  is_beta_tester: boolean;
  beta_note: string | null;
  beta_granted_at: string | null;
  free_case_used: boolean;
  stripe_customer_id: string | null;
  current_period_end: string | null;
};

/** Every user joined with their subscription/beta status. Backs both the
 * admin Subscriptions view and the Beta Testers view — same underlying
 * data, the UI just filters/sorts differently. */
export const adminListUsersWithSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.supabase as any).rpc("admin_list_users_with_subscriptions");
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminUserRow[];
  });

/** Grant beta-tester access by email.
 *
 * If the account already exists: grants immediately (creates the
 * subscriptions row if the user has never touched billing before).
 *
 * If the account does NOT exist yet: creates a pending invite instead of
 * erroring. The moment someone signs up with that email, a database
 * trigger (handle_beta_invite_redemption, see
 * 20260716200000_beta_invites_presignup.sql) grants them beta access
 * automatically — no follow-up admin action needed. This lets you send
 * the invite email first and have testers sign up whenever.
 *
 * Does NOT touch user_ai_keys — the tester automatically rides on the
 * platform AI key (see ai-key-router.server.ts) unless/until they add
 * their own. */
export const adminAddBetaTester = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), note: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const email = data.email.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetId, error: lookupErr } = await (ctx.supabase as any).rpc("admin_get_user_id_by_email", {
      _email: email,
    });
    if (lookupErr) throw new Error(lookupErr.message);
    const admin = getAdminClient();

    if (!targetId) {
      // No account yet — queue a pre-signup invite instead of failing.
      const { error } = await admin.from("beta_invites").upsert(
        {
          email: email.toLowerCase(),
          note: data.note?.trim() || null,
          invited_by: ctx.userId,
          invited_at: new Date().toISOString(),
          redeemed_at: null,
          redeemed_user_id: null,
        },
        { onConflict: "email" },
      );
      if (error) throw new Error(error.message);
      return { ok: true, userId: null, pending: true as const };
    }

    const { error } = await admin.from("subscriptions").upsert(
      {
        user_id: targetId as string,
        is_beta_tester: true,
        beta_note: data.note?.trim() || null,
        beta_granted_by: ctx.userId,
        beta_granted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, userId: targetId as string, pending: false as const };
  });

/** Pending (unredeemed) pre-signup beta invites, for the admin Beta
 * Testers page. */
export const adminListPendingBetaInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.supabase as any).rpc("admin_list_pending_beta_invites");
    if (error) throw new Error(error.message);
    return (data ?? []) as { email: string; note: string | null; invited_at: string }[];
  });

/** Cancel a pending (not-yet-redeemed) invite before the person signs up. */
export const adminCancelBetaInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const admin = getAdminClient();
    const { error } = await admin
      .from("beta_invites")
      .delete()
      .eq("email", data.email.toLowerCase())
      .is("redeemed_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminRemoveBetaTester = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const admin = getAdminClient();
    const { error } = await admin.from("subscriptions").update({ is_beta_tester: false }).eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Recent Stripe webhook deliveries, for the admin Billing page's config
 * panel — proves the webhook is actually reaching the app, not just that
 * an env var is set. */
export const adminListWebhookEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const { data, error } = await ctx.supabase
      .from("webhook_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Stripe config status (no secrets returned — just booleans + last-4 of
 * the webhook secret so an admin can eyeball "is this the secret I think
 * it is" without ever seeing the full value). */
export const adminGetStripeConfigStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { supabase: Db; userId: string };
    await requireAdmin(ctx);
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    return {
      hasSecretKey: Boolean(secretKey),
      secretKeyMode: secretKey?.startsWith("sk_live_") ? "live" : secretKey?.startsWith("sk_test_") ? "test" : null,
      hasWebhookSecret: Boolean(webhookSecret),
      webhookSecretLast4: webhookSecret ? webhookSecret.slice(-4) : null,
    };
  });

export { isPlanKey };
