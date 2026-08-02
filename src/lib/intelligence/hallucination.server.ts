// Hallucination review: verifies that every finding's cited quote actually
// appears in the cited source document/page. Pure DB-driven, no LLM cost.
//
// Uses the SAME verifier (`verifyQuote` from grounding.server.ts) that the
// evidence gate applies at write time. Two independent implementations
// silently disagree on what counts as a match — a finding that passed the
// gate could still fail this review purely because the tolerances differed.
// One verifier, one source of truth.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildGroundingCorpus, verifyQuote, isLegalAuthorityCitation, type GroundingCorpus } from "./grounding.server";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

type Db = SupabaseClient<Database>;

type Finding = {
  id: string;
  title: string;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  source_doc_ids: string[] | null;
};

type Page = { document_id: string; page: number; text: string };

export type HallucinationReport = {
  ran_at: string;
  total: number;
  verified: number;
  unverified: number;
  no_citation: number;
  /** Citations to public legal authority, exempt from verbatim corpus matching. */
  authority_exempt: number;
  by_module: Record<string, { total: number; verified: number; unverified: number; no_citation: number; authority_exempt: number }>;
  unverified_examples: Array<{ id: string; title: string; reason: string }>;
};

export async function runHallucinationReview(args: {
  db: Db; caseId: string;
}): Promise<HallucinationReport> {
  const { db, caseId } = args;

  const { data: findingsRaw, error: fErr } = await db
    .from("case_findings")
    .select("id,title,source_module,source_document_id,source_page,source_quote,source_doc_ids")
    .eq("case_id", caseId)
    .not("source_module", "like", PROJECTION_LIKE);
  if (fErr) throw new Error(`Load findings failed: ${fErr.message}`);
  const findings = (findingsRaw ?? []) as Array<Finding & { source_module: string }>;

  // Load all pages for this case and reconstruct per-document text so we can
  // build a `GroundingCorpus` per doc — the exact structure `verifyQuote`
  // consumes at write time.
  const { data: pagesRaw } = await db
    .from("document_pages")
    .select("document_id,page,text")
    .eq("case_id", caseId);
  const pages = (pagesRaw ?? []) as Page[];

  const perDocPages = new Map<string, Page[]>();
  for (const p of pages) {
    const arr = perDocPages.get(p.document_id) ?? [];
    arr.push(p);
    perDocPages.set(p.document_id, arr);
  }
  const perDocCorpus = new Map<string, GroundingCorpus>();
  for (const [docId, pgs] of perDocPages) {
    pgs.sort((a, b) => a.page - b.page);
    const extracted = pgs.map((p) => p.text ?? "").join("\n");
    perDocCorpus.set(docId, buildGroundingCorpus([{ id: docId, filename: docId, extracted_text: extracted }]));
  }

  const report: HallucinationReport = {
    ran_at: new Date().toISOString(),
    total: findings.length, verified: 0, unverified: 0, no_citation: 0,
    by_module: {}, unverified_examples: [],
  };

  const nowIso = new Date().toISOString();
  const updates: Array<{ id: string; status: "verified" | "unverified" | "no_citation"; notes: string }> = [];
  for (const f of findings) {
    const mod = f.source_module || "unknown";
    if (!report.by_module[mod]) report.by_module[mod] = { total: 0, verified: 0, unverified: 0, no_citation: 0 };
    report.by_module[mod].total += 1;

    let status: "verified" | "unverified" | "no_citation" | "authority_exempt" = "no_citation";
    let notes = "";

    const quote = (f.source_quote ?? "").trim();
    const docId = f.source_document_id ?? ((Array.isArray(f.source_doc_ids) && f.source_doc_ids[0]) || null);

    if (!quote || !docId) {
      status = "no_citation";
      notes = !quote && !docId ? "No source document or quote." : !quote ? "No source quote." : "No source document.";
    } else {
      const corpus = perDocCorpus.get(docId);
      if (corpus && verifyQuote(quote, corpus)) {
        status = "verified";
        notes = f.source_page != null
          ? `Quote verified against document (page ${f.source_page}).`
          : "Quote verified against document.";
      } else if (isLegalAuthorityCitation(quote)) {
        // Constitutional / statutory / tesis references cite public law, not
        // the case record — verbatim corpus matching does not apply.
        status = "authority_exempt";
        notes = "Legal authority reference (constitutional/statutory/tesis) — exempt from verbatim corpus matching.";
      } else if (!corpus) {
        status = "unverified";
        notes = "Cited document has no extracted pages in the corpus.";
      } else {
        status = "unverified";
        notes = "Quote not found in cited source (grounding.verifyQuote).";
      }
    }

    report[status] += 1;
    report.by_module[mod][status] += 1;
    if (status === "unverified" && report.unverified_examples.length < 25) {
      report.unverified_examples.push({ id: f.id, title: f.title, reason: notes });
    }

    updates.push({ id: f.id, status, notes });
  }

  for (let i = 0; i < updates.length; i += 25) {
    const batch = updates.slice(i, i + 25);
    const results = await Promise.all(
      batch.map((u) =>
        db
          .from("case_findings")
          .update({
            verification_status: u.status,
            verification_notes: u.notes,
            verified_at: nowIso,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .eq("id", u.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`Finding verification update failed: ${failed.error.message}`);
  }

  await db.from("cases").update({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hallucination_report: report as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hallucination_at: nowIso as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).eq("id", caseId);

  return report;
}
