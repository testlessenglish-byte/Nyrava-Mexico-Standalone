/**
 * Intelligence engine server functions.
 *
 * All engines share `runEngine`: it loads matter context under RLS, invokes
 * the engine module, and persists structured knowledge + relationships.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getEngine } from "./engines/registry.server";
import type { EngineInput } from "./engines/types";

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
      .select("id, org_id, title, matter_type, description, client_name, jurisdiction")
      .eq("id", data.matterId).maybeSingle();
    if (mErr) throw mErr;
    if (!matter) throw new Error("Matter not found.");

    const { data: docs, error: dErr } = await supabase
      .from("matter_documents")
      .select("id, title, media_kind, text_content, classification")
      .eq("matter_id", data.matterId)
      .is("deleted_at", null)
      .limit(30);
    if (dErr) throw dErr;

    const { data: knowledge, error: kErr } = await supabase
      .from("matter_knowledge")
      .select("kind, title, body")
      .eq("matter_id", data.matterId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (kErr) throw kErr;

    // Create run row.
    const { data: run, error: rErr } = await supabase
      .from("intelligence_runs").insert({
        org_id: matter.org_id,
        matter_id: matter.id,
        engine: data.engine,
        status: "running",
        input: { engine: data.engine, language: data.language, documents: docs?.length ?? 0 },
        requested_by: userId,
        started_at: new Date().toISOString(),
      }).select("id").single();
    if (rErr) throw rErr;

    try {
      const engine = getEngine(data.engine);
      const input: EngineInput = {
        orgId: matter.org_id,
        matterId: matter.id,
        language: data.language,
        context: {
          matter: {
            title: matter.title,
            matter_type: matter.matter_type,
            description: matter.description,
            client_name: matter.client_name,
            jurisdiction: matter.jurisdiction,
          },
          documents: (docs ?? []).map((d) => ({
            id: d.id,
            title: d.title,
            media_kind: d.media_kind,
            text_content: d.text_content,
            classification: (d.classification as Record<string, unknown>) ?? {},
          })),
          knowledge: (knowledge ?? []).map((k) => ({ kind: k.kind, title: k.title, body: k.body })),
        },
      };

      const output = await engine.run(input);

      // Persist knowledge rows and remember ref → uuid mapping.
      const refToId = new Map<string, string>();
      for (const k of output.knowledge) {
        const { data: row, error } = await supabase.from("matter_knowledge").insert({
          org_id: matter.org_id,
          matter_id: matter.id,
          engine: data.engine,
          kind: k.kind,
          title: k.title,
          body: k.body ?? null,
          data: k.data ?? {},
          confidence: k.confidence ?? null,
          language: k.language ?? data.language,
          source_document_id: k.source_document_id ?? null,
          source_run_id: run.id,
        }).select("id").single();
        if (error) throw error;
        refToId.set(k.ref, row.id);
      }

      // Persist relationships that resolve on both sides.
      const relRows = output.relationships
        .map((r) => {
          const s = refToId.get(r.subject_ref);
          const o = refToId.get(r.object_ref);
          if (!s || !o || s === o) return null;
          return {
            org_id: matter.org_id,
            matter_id: matter.id,
            subject_id: s,
            object_id: o,
            relation: r.relation,
            weight: r.weight ?? null,
            data: r.data ?? {},
            source_run_id: run.id,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (relRows.length) {
        const { error } = await supabase.from("knowledge_relationships").insert(relRows);
        if (error) throw error;
      }

      await supabase.from("intelligence_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        model: output.model ?? null,
        tokens_used: output.tokens_used ?? null,
        output: {
          knowledge_count: output.knowledge.length,
          relationships_count: relRows.length,
          recommendations: output.recommendations ?? [],
        },
      }).eq("id", run.id);

      return {
        ok: true,
        runId: run.id,
        knowledge: output.knowledge.length,
        relationships: relRows.length,
        recommendations: output.recommendations ?? [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("intelligence_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: message,
      }).eq("id", run.id);
      return { ok: false, runId: run.id, error: message };
    }
  });

const ListInput = z.object({ matterId: z.string().uuid() });

export const listKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("matter_knowledge")
      .select("id, engine, kind, title, body, data, confidence, source_document_id, source_run_id, language, created_at")
      .eq("matter_id", data.matterId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return rows ?? [];
  });

export const listRelationships = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("knowledge_relationships")
      .select("id, subject_id, object_id, relation, weight, data, created_at")
      .eq("matter_id", data.matterId)
      .limit(2000);
    if (error) throw error;
    return rows ?? [];
  });

export const listRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("intelligence_runs")
      .select("id, engine, status, model, tokens_used, requested_by, started_at, completed_at, error, output, created_at")
      .eq("matter_id", data.matterId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return rows ?? [];
  });
