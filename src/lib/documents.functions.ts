/**
 * Document server functions — metadata + processing queue.
 *
 * Upload flow:
 *   1. Client uploads the file directly to Supabase Storage under the
 *      RLS-scoped path {orgId}/{matterId}/{documentId}/v1/{filename}
 *      using the browser client (RLS enforces org isolation).
 *   2. Client calls `registerDocument` (below) which creates the metadata
 *      row and enqueues a `document_processing_jobs` row.
 *   3. Client (or a scheduler) invokes `processDocumentJob` to advance
 *      the pipeline.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RegisterInput = z.object({
  orgId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  title: z.string().min(1).max(500),
  storagePath: z.string().min(1).max(1000),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  mediaKind: z.enum([
    "pdf", "docx", "txt", "image", "spreadsheet",
    "email", "audio", "video", "other",
  ]),
});

export const registerDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RegisterInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify matter belongs to org & user is contributor (RLS enforces too).
    const { data: matter, error: mErr } = await supabase
      .from("matters").select("id, org_id").eq("id", data.matterId).maybeSingle();
    if (mErr) throw mErr;
    if (!matter || matter.org_id !== data.orgId) throw new Error("Matter not found in this org.");

    const { error: docErr } = await supabase.from("matter_documents").insert({
      id: data.documentId,
      matter_id: data.matterId,
      org_id: data.orgId,
      title: data.title,
      storage_path: data.storagePath,
      mime_type: data.mimeType,
      size_bytes: data.sizeBytes,
      media_kind: data.mediaKind,
      uploaded_by: userId,
      processing_status: "pending",
      current_version: 1,
    });
    if (docErr) throw docErr;

    const { error: verErr } = await supabase.from("document_versions").insert({
      document_id: data.documentId,
      version: 1,
      storage_path: data.storagePath,
      checksum: null,
      uploaded_by: userId,
      org_id: data.orgId,
    });
    if (verErr && verErr.code !== "23505") throw verErr;

    const { data: job, error: jobErr } = await supabase.from("document_processing_jobs").insert({
      document_id: data.documentId,
      org_id: data.orgId,
      stage: "extract",
      status: "pending",
      progress: 0,
      payload: {},
    } as never).select("id").single();
    if (jobErr) throw jobErr;


    return { ok: true, documentId: data.documentId, jobId: job.id };
  });

const ListInput = z.object({ matterId: z.string().uuid() });
export const listMatterDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: docs, error } = await context.supabase
      .from("matter_documents")
      .select("id, title, media_kind, mime_type, size_bytes, processing_status, processing_error, language, page_count, created_at")
      .eq("matter_id", data.matterId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return docs ?? [];
  });

const JobsInput = z.object({ matterId: z.string().uuid() });
export const listDocumentJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("document_processing_jobs")
      .select("id, document_id, stage, status, progress, error, attempts, created_at, completed_at, matter_documents!inner(matter_id, title)")
      .eq("matter_documents.matter_id", data.matterId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return rows ?? [];
  });
