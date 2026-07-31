// Client-facing endpoint backing the Usage Dashboard (see routes/usage.tsx).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUsageSnapshot } from "./usage.server";

export type UsageDashboardView = Awaited<ReturnType<typeof getUsageSnapshot>> & {
  activeCases: number;
  storageUsedBytes: number;
  byokConnectedProviders: string[];
};

export const getMyUsageDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsageDashboardView> => {
    const { supabase, userId } = context;

    const snapshot = await getUsageSnapshot(userId);

    // Active (non-archived) cases — used against the plan's case_limit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: activeCases } = await (supabase as any)
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null);

    // Storage used — sum of evidence document sizes for this user, across
    // all their cases. Compared against the plan's storage_gb_limit on the
    // dashboard; not itself a gate (uploads aren't blocked by this yet).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: docs } = await (supabase as any)
      .from("documents")
      .select("size_bytes")
      .eq("user_id", userId);
    const storageUsedBytes = (docs ?? []).reduce(
      (sum: number, d: { size_bytes: number | null }) => sum + (d.size_bytes ?? 0),
      0,
    );

    // Which providers this user has their own active BYOK key for — shown
    // on the dashboard so it's obvious when platform usage isn't being
    // consumed because a provider is already connected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: keys } = await (supabase as any)
      .from("user_ai_keys")
      .select("provider")
      .eq("user_id", userId)
      .eq("is_active", true);
    const byokConnectedProviders = Array.from(
      new Set((keys ?? []).map((k: { provider: string }) => k.provider)),
    ) as string[];

    return {
      ...snapshot,
      activeCases: activeCases ?? 0,
      storageUsedBytes,
      byokConnectedProviders,
    };
  });
