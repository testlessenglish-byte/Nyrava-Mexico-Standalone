// Statutory Citation Verification (NYRAVA México).
//
// Answers, deterministically, for one proposed citation ("Artículo 14
// CPEUM", claiming some exact text): does this statute exist, does this
// article number exist within it, is it the correct jurisdiction, is it in
// force at the relevant date (or is the applicable historical version
// identified), and does the claimed "exact text" actually match the
// authoritative source word for word? See mexico-lock.ts's
// GROUNDING_CONTRACT rule 6 for the policy this enforces, and
// legal-validity.ts for the jurisdiction/temporal-validity primitives this
// reuses rather than reimplementing.
//
// This function NEVER fails loudly and NEVER upgrades a citation to
// verified on missing data — the corpus (public.legal_authorities /
// legal_articles) is populated incrementally by the connector framework in
// src/lib/legal-connectors/, so an UNVERIFIED result very often means
// "not ingested yet", not "wrong". Callers must present that as
// UNVERIFIED, never suppress it or guess.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { authorityValidity } from "./legal-validity";
import type { JurisdictionLevel } from "./authority-registry";

type Db = SupabaseClient<Database>;

export type CitationVerificationStatus = "VERIFIED" | "UNVERIFIED";

export type StatutoryCitationCheck = {
  /** Free-text name/hint of the statute or code, e.g. "CPEUM", "Ley de Amparo", "Código Civil Federal". */
  authorityHint: string;
  /** e.g. "14", "3 Bis", "80". */
  articleNumber: string;
  /** The "exact text"/verbatim quote being claimed for this article, if any. */
  claimedText?: string | null;
  /** Expected jurisdiction, if known — used only to flag a mismatch, never to select a different article. */
  jurisdictionHint?: JurisdictionLevel | null;
  /** Case's relevant date (filing date, acto reclamado date, etc.) for temporal validity. */
  caseDate?: string | Date | null;
};

export type StatutoryCitationVerification = {
  status: CitationVerificationStatus;
  /** Human-readable reasons, in the order checks were performed — always non-empty. */
  reasons: string[];
  matched_authority_id: string | null;
  matched_authority_label: string | null;
  matched_authority_jurisdiction: string | null;
  matched_article_id: string | null;
  matched_article_body: string | null;
  /** null when no claimedText was supplied to check. */
  quote_match: boolean | null;
  temporal_status: "in_force" | "expired" | "not_yet_in_force" | "unknown" | null;
  jurisdiction_match: boolean | null;
  /** Not independently machine-checkable here — whether the article's text
   *  actually supports the proposition attributed to it requires legal
   *  judgment. Always null from this function; callers that need this
   *  (e.g. an LLM-judge pass) must compute it separately using
   *  matched_article_body as the source of truth, never model memory. */
  proposition_supported: null;
};

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/\s+/g, " ")
    .trim();
}

/** Verbatim means "the same words, in the same order" — tolerant only of
 *  whitespace/accent normalization, never of paraphrase or reordering. */
function quoteMatchesBody(claimed: string, body: string): boolean {
  const c = normalizeForMatch(claimed);
  const b = normalizeForMatch(body);
  return c.length > 0 && b.includes(c);
}

export async function verifyStatutoryCitation(
  db: Db,
  check: StatutoryCitationCheck,
): Promise<StatutoryCitationVerification> {
  const reasons: string[] = [];
  const base: StatutoryCitationVerification = {
    status: "UNVERIFIED",
    reasons,
    matched_authority_id: null,
    matched_authority_label: null,
    matched_authority_jurisdiction: null,
    matched_article_id: null,
    matched_article_body: null,
    quote_match: null,
    temporal_status: null,
    jurisdiction_match: null,
    proposition_supported: null,
  };

  const hint = String(check.authorityHint ?? "").trim();
  const articleNumber = String(check.articleNumber ?? "").trim();
  if (!hint || !articleNumber) {
    reasons.push("No statute name or article number was provided to verify.");
    return base;
  }

  try {
    // Step 1 — does the statute exist? Match on short_title/title/citation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: authorities, error: authErr } = await (db as any)
      .from("legal_authorities")
      .select("id,title,short_title,citation,jurisdiction,body")
      .or(`short_title.ilike.%${hint}%,title.ilike.%${hint}%,citation.ilike.%${hint}%`)
      .limit(5);
    if (authErr) {
      reasons.push(`Legal-source lookup failed: ${authErr.message}.`);
      return base;
    }
    const authority = (authorities ?? [])[0] as
      | { id: string; title: string; short_title: string | null; citation: string | null; jurisdiction: string | null }
      | undefined;
    if (!authority) {
      reasons.push(`"${hint}" was not found in the validated legal-source corpus — cannot verify this citation.`);
      return base;
    }
    base.matched_authority_id = authority.id;
    base.matched_authority_label = authority.short_title ?? authority.title;
    base.matched_authority_jurisdiction = authority.jurisdiction;
    reasons.push(`Statute matched: ${base.matched_authority_label} (id=${authority.id}).`);

    // Step 2 — jurisdiction correctness (never selects a different match, only flags).
    if (check.jurisdictionHint) {
      base.jurisdiction_match = authority.jurisdiction === check.jurisdictionHint;
      if (!base.jurisdiction_match) {
        reasons.push(
          `Jurisdiction mismatch: expected "${check.jurisdictionHint}", the matched statute is "${authority.jurisdiction ?? "unknown"}".`,
        );
      }
    }

    // Step 3 — does the article number exist within this statute?
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: article, error: artErr } = await (db as any)
      .from("legal_articles")
      .select("id,article_number,body,effective_at,repealed_at,verification_status")
      .eq("authority_id", authority.id)
      .eq("article_number", articleNumber)
      .maybeSingle();
    if (artErr) {
      reasons.push(`Article lookup failed: ${artErr.message}.`);
      return base;
    }
    if (!article) {
      reasons.push(
        `Article "${articleNumber}" was not found under ${base.matched_authority_label} in the validated corpus — cannot verify this citation.`,
      );
      return base;
    }
    base.matched_article_id = article.id;
    base.matched_article_body = article.body ?? null;
    reasons.push(`Article ${articleNumber} matched (source verification_status="${article.verification_status}").`);

    // Step 4 — temporal validity: in force / historical version.
    const validity = authorityValidity(
      {
        id: authority.id,
        source_type: "ley_federal",
        jurisdiction: (authority.jurisdiction as JurisdictionLevel) ?? "federal",
        effective_from: article.effective_at ?? "1900-01-01",
        effective_until: article.repealed_at ?? null,
        authority_weight: 0,
        label: base.matched_authority_label ?? hint,
      },
      check.caseDate ?? null,
    );
    base.temporal_status =
      validity.reason === "in_force" || validity.reason === "expired" || validity.reason === "not_yet_in_force"
        ? validity.reason
        : "unknown";
    if (validity.reason === "expired") {
      reasons.push(
        `This article was repealed/superseded on ${article.repealed_at} — distinguish this as historical law, not currently applicable law, unless the case's relevant date predates that.`,
      );
    } else if (validity.reason === "not_yet_in_force") {
      reasons.push(`This article did not take effect until ${article.effective_at} — it postdates the case's relevant date.`);
    } else if (validity.reason === "unknown_date") {
      reasons.push("No case date was supplied — vigency could not be confirmed; treat as unconfirmed, not as current law.");
    }

    // Step 5 — verbatim quote match, if a claimed exact text was supplied.
    if (check.claimedText) {
      base.quote_match = base.matched_article_body ? quoteMatchesBody(check.claimedText, base.matched_article_body) : false;
      if (!base.quote_match) {
        reasons.push('The claimed "exact text" does not appear verbatim in the authoritative article body — reject it as invented/paraphrased.');
      }
    }

    // A citation is VERIFIED only when every check that COULD run actually
    // passed — never on a partial match. Source rows still marked "pending"
    // (not yet human/source-confirmed by the ingest pipeline) stay
    // UNVERIFIED even if every other check passes, since presenting them as
    // confirmed would outrun the corpus's own confidence in that text.
    const sourceConfirmed = article.verification_status === "verified";
    if (!sourceConfirmed) {
      reasons.push(`This article's own source verification_status is "${article.verification_status}", not "verified" — treat as UNVERIFIED until source-confirmed.`);
    }
    const temporalOk = base.temporal_status === "in_force";
    const jurisdictionOk = base.jurisdiction_match !== false;
    const quoteOk = base.quote_match !== false;
    if (sourceConfirmed && temporalOk && jurisdictionOk && quoteOk) {
      base.status = "VERIFIED";
    }
    return base;
  } catch (e) {
    reasons.push(`Verification failed unexpectedly: ${e instanceof Error ? e.message : String(e)}.`);
    return base;
  }
}
