// Single-motion drafting — powers the "Draft this motion" button in Motion
// Center.
//
// Deliberately NOT built on runWorkProductEngine (engines.server.ts). That
// engine drafts a fixed generic batch (case_summary, discovery_request,
// cross_exam_plan, trial_outline, and one or two motion types depending on
// case type) and, on every run, does `delete().eq("case_id", caseId)` then
// reinserts the whole batch into case_work_product. It also has no way to
// target a *specific* motion title — the exact ones the Opportunity engine
// recommends (e.g. "Motion in Limine to Exclude Controlled Buy Testimony")
// aren't even in its allowed document_type enum.
//
// This module drafts exactly the motion the lawyer clicked, grounded in the
// same corpus + evidence-gate verification as the batch engine, and writes
// to its own table (case_motion_drafts) so a later automatic rerun of the
// batch work-product engine can never silently delete it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mexicoLock } from "@/lib/mexico-lock";
import type { Database } from "@/integrations/supabase/types";
import { callGroq, parseJsonLoose } from "../groq.server";
import { buildContext, logUsage } from "./engines.server";

type Db = SupabaseClient<Database>;
const MODEL = "openai/gpt-oss-120b";

/**
 * Detects "X v. Y" case-name citations in the drafted body that are NOT
 * among the verified `validCases` passed in from the Supporting Authority
 * card. Complements verifyWorkProductBody, which checks factual claims
 * (dollar amounts, dates, document references) against the corpus — but
 * previously had no equivalent check for case-law names, so a model citing
 * a case never present in AVAILABLE CASE LAW would pass straight through to
 * status: "complete". Matching is substring-tolerant in both directions to
 * absorb minor punctuation/whitespace drift between how the model renders a
 * name and how it was stored (e.g. "Miranda v. Arizona" vs "Miranda v Arizona").
 */
function findUnverifiedCaseCitations(
  body: string,
  validCases: Array<{ case_name?: string | null; citation?: string | null }>,
): string[] {
  const CASE_NAME_RX =
    /\b([A-Z][A-Za-z.&'-]+(?:\s+[A-Z][A-Za-z.&'-]+){0,4})\s+v\.?\s+([A-Z][A-Za-z.&'-]+(?:\s+[A-Za-z.&'-]+){0,4})/g;
  const validNames = [...validCases]
    .map((c) => (c.case_name ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = CASE_NAME_RX.exec(body)) !== null) {
    const full = m[0].replace(/\s+/g, " ").trim();
    const normalized = full.toLowerCase();
    const isVerified = validNames.some((vn) => vn.includes(normalized) || normalized.includes(vn));
    if (!isVerified) found.add(full);
  }
  return [...found];
}

function formatCaseLawBanner(names: string[]): string {
  return `> ⚠️ **Citation verification warning:** this draft cites case(s) not found in the verified Supporting Authority for this motion — ${names.join("; ")}. Remove or replace before filing.`;
}

export async function draftSingleMotion(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
  /** The exact motion title as shown in Motion Center, e.g. "Motion to Suppress Physical Evidence". */
  motionTitle: string;
  /** Optional rationale/citations from the Opportunity that recommended this motion, used to anchor the draft. */
  opportunityContext?: { description?: string | null } | null;
  /**
   * Real, already-verified case law for this motion's matched legal issue
   * (from buildSupportingAuthority / CourtListener via case-law.server.ts —
   * see authority.ts). Passed in from the client rather than re-fetched
   * here so the draft cites exactly what the attorney sees in the
   * Supporting Authority card, and never a second, independently-drifting
   * search result. Capped defensively at 5 even if more are passed.
   */
  caseLawCitations?: Array<{
    case_name?: string | null;
    citation?: string | null;
    court?: string | null;
    url?: string | null;
  }> | null;
}) {
  const { db, caseId, userId, apiKey, apiKeys, motionTitle, opportunityContext, caseLawCitations } = args;
  if (!motionTitle || !motionTitle.trim()) throw new Error("Motion title is required.");

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  const { resolveCaseType, isCriminalCaseType } = await import("../pipeline.server");
  const caseType = await resolveCaseType(db, caseId, ctx.corpus.slice(0, 4000));
  const isCriminal = isCriminalCaseType(caseType);

  const { buildCorpusIndex, verifyWorkProductBody, formatUnsupportedBanner, insufficientEvidenceStub } =
    await import("./work-product-verify.server");

  // Same grounding index the batch work-product engine uses, so this draft
  // is held to an identical evidence standard.
  const docsRes = await db
    .from("documents")
    .select("filename,extracted_text,status")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const docRows = (docsRes.data ?? []).filter((d) => d.status === "extracted");
  const corpusIndex = buildCorpusIndex(docRows);
  const knownFilenames = docRows.map((d) => d.filename).filter(Boolean) as string[];
  const knownFilenamesList = knownFilenames.length
    ? knownFilenames.map((f) => `- ${f}`).join("\n")
    : "(no extracted documents)";

  const caseFrame = isCriminal
    ? `This is a CRIMINAL matter (case_type=${caseType}). Criminal terminology and procedure are appropriate.`
    : `This is a CIVIL matter (case_type=${caseType}). Use civil terminology and procedure only.`;

  const anchor = opportunityContext?.description
    ? `\n\nThe litigation team's rationale for recommending this motion:\n${opportunityContext.description}`
    : "";

  // Real case law only — never a model-invented citation. If nothing was
  // matched for this motion's legal issue, the block is omitted entirely
  // and the prompt tells the model to skip case law rather than reach for
  // one, since an absent block reads very differently from an explicit
  // "none available" the model might paraphrase into a fabricated cite.
  const validCases = (caseLawCitations ?? []).filter((c) => c && c.case_name).slice(0, 5);
  const caseLawBlock =
    validCases.length > 0
      ? `\n\nAVAILABLE CASE LAW (the ONLY authorities you may cite by name — cite the exact case_name and citation given here, verbatim, next to the argument point it supports; do NOT invent, paraphrase into a different case, or cite anything not in this list):\n${validCases
          .map(
            (c, i) => `${i + 1}. ${c.case_name}${c.citation ? `, ${c.citation}` : ""}${c.court ? ` (${c.court})` : ""}`,
          )
          .join("\n")}`
      : "\n\nNo verified case law was found for this motion's legal issue — do NOT cite any case names or citations; rely on the cited Federal/state rule or statute number only.";

  const r = await callGroq({
    apiKey,
    apiKeys,
    // Without this, the router only ever sees the explicit Groq keys passed
    // in above and has no way to reach any other provider (Gemini, etc.)
    // the user has configured in AI Provider Keys — a Groq-only quota error
    // would kill the whole draft even with working fallback keys sitting
    // right there. Every other engine gets this for free by running inside
    // withAIUser(userId, ...) in the pipeline runner; this is a standalone
    // user-triggered action, so it's passed explicitly instead.
    userId,
    model: MODEL,
    systemInstruction:
      mexicoLock("es") + "\n\n" +
      'You draft attorney-ready legal motions. ABSOLUTE RULES: (1) Every concrete figure (dollar amount, percentage, date) MUST appear verbatim in the provided CASE CORPUS; if not present, say \'insufficient evidence\' instead. (2) NEVER reference a document filename that is not in the KNOWN DOCUMENTS list. (3) NEVER invent facts, quotes, exhibits, or case holdings. (4) NEVER cite a case name or citation that is not explicitly given to you in AVAILABLE CASE LAW — if that list is empty, cite zero cases. (5) Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". (6) Output STRICT JSON only.',
    userContent: `${caseFrame}

Draft the following motion in full, attorney-ready form: proper caption placeholder, headings (Introduction, Statement of Facts, Legal Standard, Argument, Relief Requested, Conclusion), and a signature block placeholder. Ground every factual assertion in the CASE CORPUS below, with a document citation in parentheses (see FILENAME) on every factual sentence — in the Argument section as well as Statement of Facts, not only there. The Relief Requested section must be a numbered list (use "1.", "2." etc, same as Statement of Facts) of the specific relief sought, e.g. excluding evidence, precluding testimony, or other relief the Court can actually grant — never leave it as vague prose.

MOTION TO DRAFT: "${motionTitle}"${anchor}${caseLawBlock}

Return STRICT JSON:
{ "title": string, "body_markdown": string }

KNOWN DOCUMENTS (the ONLY filenames you may reference):
${knownFilenamesList}

CASE CORPUS:
${ctx.corpus.slice(0, 80000)}

KEY FINDINGS:
${JSON.stringify(ctx.findingsLite).slice(0, 15000)}

REMINDER: if you cannot trace a concrete figure, quote, or document reference to the CASE CORPUS / KNOWN DOCUMENTS above, OMIT it and write "insufficient evidence to determine [X] from current corpus" instead. Do not invent facts, and do not cite any case not listed in AVAILABLE CASE LAW above.`,
    json: true,
    temperature: 0.2,
  });

  await logUsage(db, {
    userId,
    caseId,
    operation: "motion_draft",
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    success: true,
    keyIndex: r.keyIndex,
  });

  const parsed = parseJsonLoose<{ title?: string; body_markdown?: string }>(r.text) ?? {};
  const draftBody = typeof parsed.body_markdown === "string" ? parsed.body_markdown : "";
  const draftTitle = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : motionTitle;

  let status: "complete" | "unverified" | "rejected" | "failed" = "complete";
  let finalBody = draftBody;
  let errorMessage: string | null = null;

  if (!draftBody.trim()) {
    status = "failed";
    finalBody = "";
    errorMessage = "Generator returned an empty draft.";
  } else {
    const unsupported = verifyWorkProductBody(draftBody, corpusIndex);
    // Same class of check as verifyWorkProductBody, applied to case-law
    // names instead of factual claims — this is the check that was missing.
    const unverifiedCitations = findUnverifiedCaseCitations(draftBody, validCases);
    if (unsupported.length > 0 || unverifiedCitations.length > 0) {
      const wordCount = draftBody.split(/\s+/).filter(Boolean).length;
      const dense = unsupported.length >= 4 && wordCount < 400;
      if (dense) {
        status = "rejected";
        finalBody = insufficientEvidenceStub(draftTitle, unsupported);
        errorMessage = `Rejected by evidence gate (${unsupported.length} unverifiable claim(s)).`;
      } else {
        status = "unverified";
        const banners = [
          unverifiedCitations.length > 0 ? formatCaseLawBanner(unverifiedCitations) : "",
          unsupported.length > 0 ? formatUnsupportedBanner(unsupported) : "",
        ]
          .filter(Boolean)
          .join("\n");
        finalBody = `${banners}\n${draftBody}`.replace(/\n{3,}/g, "\n\n");
        const parts: string[] = [];
        if (unverifiedCitations.length > 0) {
          parts.push(`${unverifiedCitations.length} unverified case citation(s): ${unverifiedCitations.join("; ")}`);
        }
        if (unsupported.length > 0) parts.push(`${unsupported.length} unverifiable claim(s)`);
        errorMessage = `Flagged by evidence gate: ${parts.join("; ")}.`;
      }
    }
  }

  const { data, error } = await db
    .from("case_motion_drafts")
    .upsert(
      {
        case_id: caseId,
        user_id: userId,
        motion_title: motionTitle,
        title: draftTitle,
        body_markdown: finalBody,
        status,
        error_message: errorMessage,
      },
      { onConflict: "case_id,motion_title" },
    )
    .select()
    .maybeSingle();
  // Same class of bug fixed in runTrialPrepEngine — Supabase upsert() does
  // NOT throw on its own. Check the result explicitly so a failed write
  // surfaces as a real error to the caller instead of silently vanishing
  // while the UI is told the draft succeeded.
  if (error) throw new Error(`case_motion_drafts upsert failed: ${error.message}`);

  return data;
}

// In-browser editor autosave. Deliberately narrow: updates only
// body_markdown (+ title, if the attorney renamed the draft) on the row the
// attorney is editing, scoped to their own user_id so one attorney can never
// overwrite another's edit via a guessed draft id. Everything else about the
// draft (status, error_message, evidence-gate verification result) is left
// untouched — an attorney's manual edit shouldn't silently flip a
// "rejected"/"unverified" draft back to "complete" behind the gate's back.
export async function updateMotionDraftBody(args: {
  db: Db;
  id: string;
  userId: string;
  bodyMarkdown: string;
  title?: string | null;
}) {
  const { db, id, userId, bodyMarkdown, title } = args;
  const patch: { body_markdown: string; title?: string } = { body_markdown: bodyMarkdown };
  if (title && title.trim()) patch.title = title.trim();

  const { data, error } = await db
    .from("case_motion_drafts")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  // Supabase update() doesn't throw on a zero-row match (wrong id / not this
  // user's draft) — check explicitly so autosave failures surface instead of
  // reporting "Saved" while nothing was written.
  if (error) throw new Error(`case_motion_drafts update failed: ${error.message}`);
  if (!data) throw new Error("Draft not found, or you don't have permission to edit it.");
  return data;
}

// Attorney Notes autosave. Deliberately a separate function/column from
// body_markdown — notes are private scratch space that must never leak
// into body_markdown (and therefore never into the PDF/Print/Copy output,
// all of which read body_markdown only), so a notes save can't accidentally
// carry a stale/edited body along with it, or vice versa.
export async function updateMotionDraftNotes(args: { db: Db; id: string; userId: string; attorneyNotes: string }) {
  const { db, id, userId, attorneyNotes } = args;
  const { data, error } = await db
    .from("case_motion_drafts")
    .update({ attorney_notes: attorneyNotes })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`case_motion_drafts notes update failed: ${error.message}`);
  if (!data) throw new Error("Draft not found, or you don't have permission to edit it.");
  return data;
}

export async function getMotionDrafts(db: Db, caseId: string) {
  const { data, error } = await db
    .from("case_motion_drafts")
    .select("*")
    .eq("case_id", caseId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`case_motion_drafts read failed: ${error.message}`);
  return data ?? [];
}
