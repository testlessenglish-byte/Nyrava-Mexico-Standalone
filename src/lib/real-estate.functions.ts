// Server functions for the Real Estate (inmobiliario) Transaction Center.
// Mirrors the pattern in canonical.functions.ts: requireSupabaseAuth
// middleware supplies an RLS-scoped client via context, so every query here
// is already scoped to the signed-in user the same way every other table in
// this platform is — no separate auth logic needed.
//
// `(supabase as any)` casts on the three new tables follow the same
// precedent already in canonical.functions.ts for canonical_analysis: the
// generated Database type (integrations/supabase/types.ts) reflects the
// live Supabase project's schema and won't include property_records /
// verification_items / closing_milestones until the migration in
// supabase/migrations/20260728040000_real_estate_practice_area.sql has
// actually been applied and the types regenerated. Regenerate types and
// these casts can be dropped.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CaseIdInput = z.object({ caseId: z.string().uuid() });

export type PropertyRecord = {
  case_id: string;
  address: string | null;
  municipality: string | null;
  state: string | null;
  country: string;
  folio_real: string | null;
  cuenta_predial: string | null;
  catastro_id: string | null;
  property_type: string | null;
  purchase_price: number | null;
  buyer_name: string | null;
  seller_name: string | null;
  closing_date: string | null;
  notary: string | null;
  foreign_buyer: boolean;
  fideicomiso: boolean;
};

export type VerificationCategory =
  | "ownership"
  | "registry"
  | "catastro"
  | "predial"
  | "water"
  | "cfe"
  | "hoa"
  | "mortgage"
  | "permits"
  | "corporate_authority"
  | "environmental";

export type VerificationItem = {
  id: string;
  category: VerificationCategory;
  status: "verified" | "pending" | "missing" | "issue_found";
  verification_mode: "connected" | "document" | "manual";
  evidence_document_id: string | null;
  notes: string | null;
  updated_at: string;
};

export type ClosingMilestone = {
  id: string;
  milestone_key: string;
  label_es: string;
  label_en: string;
  weight: number;
  percent_complete: number;
};

export type TransactionCenterData = {
  property: PropertyRecord | null;
  verification: VerificationItem[];
  milestones: ClosingMilestone[];
  /** Weighted average from public.closing_readiness(case_id); null with no milestones yet. */
  readiness: number | null;
};

/** The five milestones registered in mx-procedural-stages.ts, seeded on first read
 *  so the UI always has the full sequence to render even before any progress exists. */
const DEFAULT_MILESTONES: Array<{ key: string; es: string; en: string; weight: number }> = [
  { key: "due_diligence", es: "Due diligence / verificación de título", en: "Due diligence / title verification", weight: 1 },
  { key: "firma_escritura", es: "Firma de la escritura", en: "Deed signed", weight: 1 },
  { key: "pago_isai", es: "Pago de impuesto de traslado de dominio", en: "Transfer-tax payment", weight: 1 },
  { key: "inscripcion_rpp", es: "Inscripción en el Registro Público de la Propiedad", en: "Registration at the RPP", weight: 1 },
  { key: "cierre", es: "Cierre (entrega y liberación de fondos)", en: "Closing (possession and funds release)", weight: 1 },
];

export const getTransactionCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CaseIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<TransactionCenterData> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const [{ data: property }, { data: verification }, { data: milestones }] = await Promise.all([
      db.from("property_records").select("*").eq("case_id", data.caseId).maybeSingle(),
      db.from("verification_items").select("*").eq("case_id", data.caseId),
      db.from("closing_milestones").select("*").eq("case_id", data.caseId),
    ]);

    let finalMilestones: ClosingMilestone[] = milestones ?? [];
    if (finalMilestones.length === 0) {
      // First visit to this materia's Transaction Center for this case:
      // seed the standard milestone sequence instead of rendering empty.
      const seeded = DEFAULT_MILESTONES.map((m) => ({
        case_id: data.caseId,
        user_id: userId,
        milestone_key: m.key,
        label_es: m.es,
        label_en: m.en,
        weight: m.weight,
        percent_complete: 0,
      }));
      const { data: inserted, error: seedError } = await db
        .from("closing_milestones")
        .insert(seeded)
        .select("*");
      if (!seedError && inserted) finalMilestones = inserted;
    }

    const { data: readinessRow } = await db.rpc("closing_readiness", { p_case_id: data.caseId });
    const readiness = typeof readinessRow === "number" ? readinessRow : (readinessRow ?? null);

    return {
      property: property ?? null,
      verification: verification ?? [],
      milestones: finalMilestones,
      readiness,
    };
  });

const UpsertPropertyInput = z.object({
  caseId: z.string().uuid(),
  address: z.string().max(500).optional(),
  municipality: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
  folio_real: z.string().max(100).optional(),
  cuenta_predial: z.string().max(100).optional(),
  catastro_id: z.string().max(100).optional(),
  property_type: z.string().max(100).optional(),
  purchase_price: z.number().nonnegative().optional(),
  buyer_name: z.string().max(300).optional(),
  seller_name: z.string().max(300).optional(),
  closing_date: z.string().optional(),
  notary: z.string().max(300).optional(),
  foreign_buyer: z.boolean().optional(),
  fideicomiso: z.boolean().optional(),
});

export const upsertPropertyRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpsertPropertyInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { caseId, ...fields } = data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db
      .from("property_records")
      .upsert({ case_id: caseId, user_id: userId, ...fields }, { onConflict: "case_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpsertVerificationInput = z.object({
  caseId: z.string().uuid(),
  category: z.enum([
    "ownership", "registry", "catastro", "predial", "water", "cfe",
    "hoa", "mortgage", "permits", "corporate_authority", "environmental",
  ]),
  status: z.enum(["verified", "pending", "missing", "issue_found"]),
  verification_mode: z.enum(["connected", "document", "manual"]),
  evidence_document_id: z.string().uuid().nullish(),
  notes: z.string().max(2000).nullish(),
});

export const upsertVerificationItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpsertVerificationInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { caseId, ...fields } = data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db
      .from("verification_items")
      .upsert({ case_id: caseId, user_id: userId, ...fields }, { onConflict: "case_id,category" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateMilestoneInput = z.object({
  caseId: z.string().uuid(),
  milestoneKey: z.string().max(100),
  percentComplete: z.number().min(0).max(100),
});

export const updateClosingMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpdateMilestoneInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db
      .from("closing_milestones")
      .update({ percent_complete: data.percentComplete })
      .eq("case_id", data.caseId)
      .eq("milestone_key", data.milestoneKey);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
