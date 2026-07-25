/**
 * Intelligence engine server functions — PORT IN PROGRESS.
 *
 * Phase 1 of the Nyrava México port has copied the full US intelligence
 * engine (`src/lib/intelligence/`, `src/lib/canonical/`, `src/lib/ai/`,
 * `src/lib/agents/`, `src/lib/execution/`) into this project. Those modules
 * expect a superset schema (case_findings, agent_logs, document_pages, …)
 * that the México database does not yet expose — that work lands in
 * Phase 4 (schema parity). They are excluded from typecheck in tsconfig
 * until Phase 4 lands.
 *
 * This file preserves the existing UI-facing surface (`runEngine`,
 * `listKnowledge`, `listRelationships`, `listRuns`) using the current
 * México schema so the app compiles and runs. Real wiring into the ported
 * engine graph happens in Phase 3.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RunInput = z.object({
  matterId: z.string().uuid(),
  engine: z.enum(["case", "legal", "evidence"]),
  language: z.enum(["es", "en"]).default("es"),
});

export const runEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: matter, error: mErr } = await supabase
      .from("matters")
      .select("id, org_id, title")
      .eq("id", data.matterId)
      .maybeSingle();
    if (mErr) return { ok: false as const, error: mErr.message };
    if (!matter) return { ok: false as const, error: "Matter not found." };

    const { data: run, error: rErr } = await supabase
      .from("intelligence_runs")
      .insert({
        matter_id: matter.id,
        org_id: matter.org_id,
        engine: data.engine,
        language: data.language,
        status: "queued",
        triggered_by: userId,
      })
      .select("id")
      .single();
    if (rErr) return { ok: false as const, error: rErr.message };

    return {
      ok: true as const,
      runId: run.id,
      status: "queued" as const,
      note: "Motor portado en Fase 1. Ejecución completa disponible tras Fase 4 (paridad de esquema).",
    };
  });

const MatterInput = z.object({ matterId: z.string().uuid() });

export const listKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MatterInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("matter_knowledge")
      .select("id, kind, title, body, engine, confidence, created_at")
      .eq("matter_id", data.matterId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return rows ?? [];
  });

export const listRelationships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MatterInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("knowledge_relationships")
      .select("id, subject_id, object_id, relation")
      .eq("matter_id", data.matterId)
      .limit(500);
    if (error) throw error;
    return rows ?? [];
  });

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MatterInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("intelligence_runs")
      .select("id, engine, status, model, created_at")
      .eq("matter_id", data.matterId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return rows ?? [];
  });
