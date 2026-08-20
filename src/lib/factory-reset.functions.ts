// Factory Reset — operational legal data wipe.
//
// Clears case/matter working data (uploads, extracted text, findings,
// analyses, reports, pipeline runs, background jobs) from both Postgres and
// object storage, while leaving platform configuration untouched:
// users, organizations, roles/permissions, subscriptions & billing plans,
// AI provider config and keys, legal corpus (legal_authorities, citations,
// legal_profiles), legal source connectors, feature flags, app settings.
//
// DB side is done by the SQL function public.admin_factory_reset_case_data(),
// which re-verifies super_admin server-side and writes an admin audit entry.
// Storage side is done here with the service-role client, because RLS-scoped
// clients cannot enumerate other users' objects.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Buckets holding user-uploaded case evidence / derived artifacts. */
const CASE_BUCKETS = ["case-files", "matter-documents"] as const;
/** Only wiped when the admin opts into clearing demo/sample content. */
const DEMO_BUCKETS = ["demo-cases"] as const;

/** Tables reported in the pre-reset preview (mirrors the SQL target list). */
const PREVIEW_TABLES = [
  "cases",
  "documents",
  "document_pages",
  "document_versions",
  "document_processing_jobs",
  "reports",
  "report_versions",
  "canonical_analysis",
  "analyses",
  "case_findings",
  "case_timeline_events",
  "case_witnesses",
  "case_motion_drafts",
  "case_work_product",
  "case_chat_messages",
  "case_perspectives",
  "case_finding_patches",
  "case_decision_reconstructions",
  "case_outcome_assessments",
  "verification_items",
  "cross_agent_audit",
  "finding_version_snapshots",
  "pipeline_trace",
  "agent_findings",
  "agent_logs",
  "pipeline_engine_runs",
  "pipeline_events",
  "intelligence_runs",
  "evidence_classifications",
  "image_intelligence",
  "matters",
  "matter_documents",
  "demo_cases",
  "audit_log",
  "audit_logs",
  "ai_usage",
] as const;

async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (error) throw new Error(`[FactoryReset] role check failed: ${error.message}`);
  if (data !== true) throw new Error("Forbidden — super admin required.");
}

/** Recursively enumerate every object path under a bucket. */
async function listAllObjects(admin: any, bucket: string, prefix = ""): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) {
    // A missing bucket is not fatal for a reset.
    if (/not found/i.test(error.message)) return [];
    throw new Error(`[FactoryReset] listing ${bucket}/${prefix} failed: ${error.message}`);
  }
  const paths: string[] = [];
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // Folder placeholder — recurse.
      paths.push(...(await listAllObjects(admin, bucket, full)));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

async function emptyBucket(admin: any, bucket: string): Promise<number> {
  const paths = await listAllObjects(admin, bucket);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`[FactoryReset] deleting from ${bucket} failed: ${error.message}`);
    removed += batch.length;
  }
  return removed;
}

/** Row/file counts so the admin can see exactly what a reset would remove. */
export const previewFactoryReset = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tables: Record<string, number> = {};
    for (const table of PREVIEW_TABLES) {
      const { count, error } = await supabaseAdmin
        .from(table as any)
        .select("*", { count: "exact", head: true });
      if (!error && (count ?? 0) > 0) tables[table] = count ?? 0;
    }

    const buckets: Record<string, number> = {};
    for (const bucket of [...CASE_BUCKETS, ...DEMO_BUCKETS]) {
      buckets[bucket] = (await listAllObjects(supabaseAdmin, bucket)).length;
    }

    return { tables, buckets };
  });

export const factoryResetCaseData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        includeDemo: z.boolean().default(false),
        includeAudit: z.boolean().default(false),
        includeAiUsage: z.boolean().default(false),
        confirm: z.literal("RESET"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Object storage first, so a mid-run failure never leaves orphaned files
    //    with no DB rows pointing at them.
    const storage: Record<string, number> = {};
    for (const bucket of [...CASE_BUCKETS, ...(data.includeDemo ? DEMO_BUCKETS : [])]) {
      storage[bucket] = await emptyBucket(supabaseAdmin, bucket);
    }

    // 2) Database rows (+ audit entry) via the guarded SQL routine. The routine
    //    is service_role-only; the super-admin identity was verified above and
    //    is passed through so the audit entry names the real actor.
    const { data: deleted, error } = await supabaseAdmin.rpc(
      "admin_factory_reset_case_data",
      {
        p_include_demo: data.includeDemo,
        p_include_audit: data.includeAudit,
        p_include_ai_usage: data.includeAiUsage,
        p_actor_id: context.userId,
      } as any,
    );
    if (error) throw new Error(`[FactoryReset] database reset failed: ${error.message}`);

    return { deletedRows: (deleted ?? {}) as Record<string, number>, deletedFiles: storage };
  });