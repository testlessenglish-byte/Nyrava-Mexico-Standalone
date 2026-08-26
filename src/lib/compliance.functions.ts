import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Compliance infrastructure (additive, Phase 1).
 *
 * These functions expose the consent registry, the legal-document version
 * registry and the Mexican ARCO request register. Nothing here gates access
 * to the product: no consent is required to use Nyrava today, and no existing
 * permission or RLS rule depends on these records.
 */

type ConsentInput = {
  documentType: string;
  consentType?: string;
  purpose?: string | null;
  language?: string;
  source?: string | null;
};

/** Active legal document versions (privacy notice, terms, AI disclosure). */
export const listActiveLegalVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_document_versions")
      .select("document_type, version, language, effective_date, document_hash, summary, source_url")
      .eq("is_active", true)
      .order("effective_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Consent records for the signed-in user. */
export const listMyConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_consents")
      .select(
        "id, document_type, document_version, language, consent_type, purpose, granted_at, withdrawn_at, source",
      )
      .eq("user_id", context.userId)
      .order("granted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Record consent for the currently active version of a legal document.
 * The version and hash are resolved server-side so the record is verifiable.
 */
export const recordConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConsentInput) => {
    if (!input?.documentType) throw new Error("documentType is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const language = data.language ?? "es";
    const { data: version, error: versionError } = await context.supabase
      .from("legal_document_versions")
      .select("version, document_hash, language")
      .eq("document_type", data.documentType)
      .eq("is_active", true)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) throw new Error(`No active version registered for "${data.documentType}"`);

    const { data: inserted, error } = await context.supabase
      .from("user_consents")
      .insert({
        user_id: context.userId,
        document_type: data.documentType,
        document_version: version.version,
        document_hash: version.document_hash,
        language: version.language ?? language,
        consent_type: data.consentType ?? "acceptance",
        purpose: data.purpose ?? null,
        source: data.source ?? "web",
      })
      .select("id, document_type, document_version, granted_at")
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

/** Withdraw a previously granted consent (record is retained, not deleted). */
export const withdrawConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { consentId: string }) => {
    if (!input?.consentId) throw new Error("consentId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_consents")
      .update({ withdrawn_at: new Date().toISOString() })
      .eq("id", data.consentId)
      .eq("user_id", context.userId)
      .is("withdrawn_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** ARCO requests submitted by (or on behalf of) the signed-in user. */
export const listMyArcoRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("arco_requests")
      .select(
        "id, reference, request_type, status, submitted_at, response_deadline, resolution, completed_at",
      )
      .eq("user_id", context.userId)
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

type ArcoType = "acceso" | "rectificacion" | "cancelacion" | "oposicion" | "revocacion";
const ARCO_TYPES: readonly ArcoType[] = [
  "acceso",
  "rectificacion",
  "cancelacion",
  "oposicion",
  "revocacion",
];

/**
 * Submit an ARCO request (Acceso, Rectificación, Cancelación, Oposición).
 * Intake only — identity verification and fulfilment are handled by staff.
 */
export const submitArcoRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      requestType: ArcoType | string;
      requesterName: string;
      requesterEmail: string;
      requesterPhone?: string | null;
      details: string;
    }) => {
      if (!ARCO_TYPES.includes(input?.requestType as ArcoType))
        throw new Error("requestType must be one of: " + ARCO_TYPES.join(", "));
      if (!input.requesterName?.trim()) throw new Error("requesterName is required");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.requesterEmail ?? ""))
        throw new Error("A valid requesterEmail is required");
      if (!input.details?.trim() || input.details.trim().length < 10)
        throw new Error("Please describe the request (at least 10 characters)");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("arco_requests")
      .insert({
        request_type: data.requestType as ArcoType,
        requester_name: data.requesterName.trim(),
        requester_email: data.requesterEmail.trim().toLowerCase(),
        requester_phone: data.requesterPhone?.trim() || null,
        user_id: context.userId,
        request_details: data.details.trim(),
      })
      .select("id, reference, request_type, status, submitted_at, response_deadline")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("arco_request_events").insert({
      request_id: inserted.id,
      event_type: "submitted",
      notes: "Request submitted through the web application.",
      actor_id: context.userId,
    });

    return inserted;
  });
