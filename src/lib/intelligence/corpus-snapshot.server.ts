// Corpus snapshot — Phase 6.5.
//
// A replay is only meaningful when we can prove the corpus that the engine
// consumed is the same corpus available now. We compute a lightweight
// deterministic hash of (document_ids, evidence_classification_ids, updated_at
// timestamps) for the case. Callers store it in meta.replay.corpus_hash;
// future replay tooling can recompute and compare.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sha256Hex, type CorpusSnapshot } from "../ai/telemetry.server";

type Db = SupabaseClient<Database>;

export async function snapshotCorpus(db: Db, caseId: string): Promise<CorpusSnapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [docsRes, evRes, caseRes] = await Promise.all([
    (db as any).from("documents").select("id, updated_at").eq("case_id", caseId).order("id", { ascending: true }),
    (db as any).from("evidence_classifications").select("id, updated_at").eq("case_id", caseId).order("id", { ascending: true }),
    (db as any).from("cases").select("updated_at").eq("id", caseId).maybeSingle(),
  ]);

  const docs = ((docsRes as { data?: Array<{ id: string; updated_at?: string }> }).data ?? []);
  const evs = ((evRes as { data?: Array<{ id: string; updated_at?: string }> }).data ?? []);
  const caseUpdated = (caseRes as { data?: { updated_at?: string } }).data?.updated_at ?? "";

  const parts: Array<string | number> = [caseId, "|docs:", docs.length];
  for (const d of docs) parts.push(d.id, d.updated_at ?? "");
  parts.push("|ev:", evs.length);
  for (const e of evs) parts.push(e.id, e.updated_at ?? "");

  return {
    case_id: caseId,
    case_snapshot_version: caseUpdated || undefined,
    document_count: docs.length,
    evidence_count: evs.length,
    corpus_hash: sha256Hex(parts),
    captured_at: new Date().toISOString(),
  };
}

