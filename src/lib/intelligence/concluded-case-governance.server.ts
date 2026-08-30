import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  detectConcludedCaseGovernance,
  type ConcludedCaseGovernance,
} from "./concluded-case-governance";

type Db = SupabaseClient<Database>;

/**
 * Centrally loads and resolves Concluded Case Governance for a case from Supabase.
 */
export async function loadConcludedCaseGovernance(
  db: Db,
  caseId: string,
  extra?: { is_final_resolution?: boolean; resolutivos?: string | null; corpusText?: string | null },
): Promise<ConcludedCaseGovernance> {
  const { data: caseRow } = await db
    .from("cases")
    .select("procedural_posture,case_analysis_mode,analysis_mode,matter_metadata")
    .eq("id", caseId)
    .maybeSingle();

  const row = (caseRow as Record<string, unknown> | null) ?? {};
  const meta = (row.matter_metadata as Record<string, unknown> | null) ?? {};

  const governance = detectConcludedCaseGovernance({
    procedural_posture: (row.procedural_posture as string | null) ?? (meta.procedural_posture as string | null) ?? null,
    case_analysis_mode: (row.case_analysis_mode as string | null) ?? (meta.case_analysis_mode as string | null) ?? null,
    analysis_mode: (row.analysis_mode as string | null) ?? null,
    post_judgment_options_analysis: Boolean(meta.post_judgment_options_analysis),
    is_final_resolution: extra?.is_final_resolution,
    resolutivos: extra?.resolutivos,
    corpusText: extra?.corpusText,
  });

  return governance;
}
