// Server side of the `jurisdiction_intel` stage ("Inteligencia de
// Jurisdicción"). Reads the case row + extracted corpus, resolves the Mexican
// jurisdiction profile deterministically, and persists it on
// cases.jurisdiction_profile so every downstream engine and the report can
// cite the correct codes and courts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildJurisdictionProfile, type JurisdictionProfile } from "./mx-jurisdiction";
import { resolveCaseIdentity } from "./case-classification.server";

type Db = SupabaseClient<Database>;

const CORPUS_CHAR_LIMIT = 120_000;

export async function loadCaseCorpusText(db: Db, caseId: string, limit = CORPUS_CHAR_LIMIT): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("documents")
    .select("extracted_text")
    .eq("case_id", caseId)
    .is("archived_at", null);
  const rows = (data ?? []) as { extracted_text: string | null }[];
  let out = "";
  for (const r of rows) {
    if (!r.extracted_text) continue;
    out += `${r.extracted_text}\n\n`;
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export async function runJurisdictionIntelligence(args: {
  db: Db;
  caseId: string;
}): Promise<JurisdictionProfile> {
  const { db, caseId } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any)
    .from("cases")
    .select("case_type, jurisdiction")
    .eq("id", caseId)
    .maybeSingle();
  const row = (caseRow ?? {}) as { case_type?: string | null; jurisdiction?: string | null };

  // VERIFIED CASE IDENTITY — jurisdiction/materia law selection is legal
  // reasoning; never a raw cases.case_type read. Verified/attorney-locked/
  // declared value is used (buildJurisdictionProfile also cross-checks
  // against corpusText itself); a genuinely unknown identity passes null,
  // which buildJurisdictionProfile is already designed to accept rather
  // than a guessed materia.
  const jurisdictionIdentity = await resolveCaseIdentity(db, caseId);
  const resolvedCaseType = jurisdictionIdentity.caseType;

  const corpusText = await loadCaseCorpusText(db, caseId);
  const profile = buildJurisdictionProfile({
    caseType: resolvedCaseType,
    jurisdictionField: row.jurisdiction ?? null,
    corpusText,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from("cases")
    .update({ jurisdiction_profile: profile as unknown as Record<string, unknown> })
    .eq("id", caseId);
  if (error) throw new Error(`No se pudo guardar el perfil de jurisdicción: ${error.message}`);

  return profile;
}
