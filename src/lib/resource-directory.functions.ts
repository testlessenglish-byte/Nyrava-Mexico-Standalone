// Server functions behind the Resource Network's automatic contact
// population. Users only ever read the stored directory; refreshing against
// the authoritative sources is a central, administrator-triggered (or
// scheduled) operation.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AuthContext = { supabase: any; userId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

function ctx(context: unknown): AuthContext {
  const c = context as AuthContext;
  if (!c?.supabase || !c.userId) throw new Error("Sesión requerida / Signed-in session required");
  return c;
}

async function requireAdmin(c: AuthContext) {
  const { data: isAdmin, error } = await c.supabase.rpc("is_admin_tier", { _user_id: c.userId });
  if (!error && isAdmin) return;
  const { data: roles } = await c.supabase.from("user_roles").select("role").eq("user_id", c.userId);
  const allowed = new Set(["admin", "super_admin"]);
  if ((roles ?? []).some((r: { role: string }) => allowed.has(r.role))) return;
  throw new Error("Administrator access required");
}

/** Catalog of approved official sources plus the most recent refresh results. */
export const getResourceContactSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = ctx(context);
    const [sources, runs] = await Promise.all([
      c.supabase.from("resource_official_sources").select("slug,official_name,source_urls,source_type,website,refresh_interval_days,active").order("slug"),
      c.supabase.from("resource_contact_refresh_runs").select("slug,status,source_url,fields_updated,detail,started_at").order("started_at", { ascending: false }).limit(60),
    ]);
    return { sources: sources.data ?? [], runs: runs.data ?? [] };
  });

/**
 * Refresh contact information from the authoritative sources. Admin-only and
 * deliberately not called from any user-facing read path.
 */
export const refreshResourceContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ slugs: z.array(z.string().trim().min(1).max(80)).max(50).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const c = ctx(context);
    await requireAdmin(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshOfficialContacts } = await import("./resource-directory/contact-refresh.server");
    const results = await refreshOfficialContacts(supabaseAdmin as never, data.slugs);
    return {
      checked: results.length,
      updated: results.filter((r) => r.status === "updated").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };
  });

/**
 * Mark specific fields of a resource as administrator-corrected so the
 * automatic refresh can never overwrite them.
 */
export const lockResourceFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        institutionId: z.string().uuid(),
        fields: z.array(z.enum(["phone", "email", "whatsapp", "website", "address", "hours"])).max(6),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = ctx(context);
    await requireAdmin(c);
    const { error } = await c.supabase
      .from("social_institutions")
      .update({
        admin_locked_fields: data.fields,
        contact_verification: "manually_verified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.institutionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
