/**
 * Intelligence engine server functions — PORT IN PROGRESS.
 *
 * Phase 1 of the Nyrava México port has copied the full US intelligence
 * engine (`src/lib/intelligence/`, `src/lib/canonical/`, `src/lib/ai/`,
 * `src/lib/agents/`, `src/lib/execution/`) into this project. Those modules
 * expect a superset schema (case_findings, agent_logs, document_pages, …)
 * that the México database does not yet expose — that work lands in
 * Phase 4 (schema parity).
 *
 * Until Phase 4 is complete, this file exposes a minimal `runEngine`
 * signature so the existing UI compiles and can call the engines without
 * crashing. The handler records an intelligence_run row and returns a
 * placeholder note; real wiring into the ported engine graph happens in
 * Phase 3 once the schema is in place.
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
    if (mErr) throw mErr;
    if (!matter) throw new Error("Matter not found.");

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
    if (rErr) throw rErr;

    return {
      runId: run.id,
      status: "queued" as const,
      note: "Motor portado en Fase 1. Ejecución completa disponible tras Fase 4 (paridad de esquema).",
    };
  });
