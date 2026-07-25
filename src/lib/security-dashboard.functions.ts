// Server functions powering the customer-facing Security Dashboard.
// Every read is scoped to the calling user via requireSupabaseAuth + RLS.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SecurityOverview = {
  user: {
    id: string;
    email: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    emailConfirmedAt: string | null;
    mfaEnrolled: boolean;
    mfaFactorCount: number;
    providers: string[];
  };
  workspace: {
    caseCount: number;
    documentCount: number;
    firmId: string | null;
  };
  apiKeys: Array<{
    provider: string;
    label: string | null;
    fingerprint: string;
    isActive: boolean;
    createdAt: string;
    lastUsedAt: string | null;
    lastTestOk: boolean | null;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    level: string;
    message: string | null;
    stage: string | null;
    createdAt: string;
  }>;
};

export const getSecurityOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SecurityOverview> => {
    const { supabase, userId, claims } = context;

    // Auth metadata for the current user (RLS scoped to the caller).
    const { data: userResp } = await supabase.auth.getUser();
    const authUser = userResp?.user ?? null;

    const factorsResp = await supabase.auth.mfa.listFactors().catch(() => null);
    const verifiedFactors =
      factorsResp?.data?.all?.filter((f) => f.status === "verified") ?? [];

    const [casesResp, docsResp, settingsResp, keysResp, activityResp] =
      await Promise.all([
        supabase.from("cases").select("id", { count: "exact", head: true }),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase
          .from("user_settings")
          .select("firm_id")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("user_ai_keys")
          .select(
            "provider,label,key_fingerprint,is_active,created_at,last_used_at,last_test_ok",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("audit_logs")
          .select("id,action,level,message,stage,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    const providers = Array.from(
      new Set([
        ...(authUser?.app_metadata?.providers as string[] | undefined ?? []),
        authUser?.app_metadata?.provider as string | undefined,
      ].filter((v): v is string => Boolean(v))),
    );

    return {
      user: {
        id: userId,
        email: authUser?.email ?? (claims?.email as string | undefined) ?? null,
        createdAt: authUser?.created_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        mfaEnrolled: verifiedFactors.length > 0,
        mfaFactorCount: verifiedFactors.length,
        providers: providers.length > 0 ? providers : ["email"],
      },
      workspace: {
        caseCount: casesResp.count ?? 0,
        documentCount: docsResp.count ?? 0,
        firmId: settingsResp.data?.firm_id ?? null,
      },
      apiKeys: (keysResp.data ?? []).map((k) => ({
        provider: k.provider,
        label: k.label,
        fingerprint: k.key_fingerprint,
        isActive: k.is_active,
        createdAt: k.created_at,
        lastUsedAt: k.last_used_at,
        lastTestOk: k.last_test_ok,
      })),
      recentActivity: (activityResp.data ?? []).map((a) => ({
        id: a.id,
        action: a.action,
        level: a.level,
        message: a.message,
        stage: a.stage,
        createdAt: a.created_at,
      })),
    };
  });
