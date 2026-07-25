// Server functions for reading canonical case analysis.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { CaseAnalysis, ValidationIssue } from "@/lib/canonical/case-analysis";

const CaseIdInput = z.object({ caseId: z.string().uuid() });

export type CanonicalReadResult = {
  status: string;
  version: number;
  updatedAt: string;
  analysis: CaseAnalysis | null;
  validationIssues: ValidationIssue[];
};

export const getCanonicalAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CaseIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<CanonicalReadResult | null> => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (supabase as any)
      .from("canonical_analysis")
      .select("status,version,updated_at,analysis_payload,validation_errors")
      .eq("case_id", data.caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const payload = row.analysis_payload as Record<string, unknown> | null;
    const isCanonical = payload && payload._canonical === true;
    return {
      status: String(row.status),
      version: Number(row.version ?? 1),
      updatedAt: String(row.updated_at),
      analysis: isCanonical ? (payload as unknown as CaseAnalysis) : null,
      validationIssues: (row.validation_errors ?? []) as ValidationIssue[],
    };
  });

const RegenInput = z.object({ caseId: z.string().uuid(), reportMode: z.enum(["FULL", "LIMITED"]).default("FULL") });

export const regenerateCanonical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RegenInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { runCanonicalGate } = await import("@/lib/canonical/gate.server");
    const gate = await runCanonicalGate(supabase, data.caseId, data.reportMode);
    return {
      ok: gate.ok,
      status: gate.status,
      issueCount: gate.validation.issues.length,
      issues: gate.validation.issues.slice(0, 100),
    };
  });
