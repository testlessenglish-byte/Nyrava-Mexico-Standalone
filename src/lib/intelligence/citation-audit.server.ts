// Citation Audit stage — Priority 0.
//
// Runs after findings are persisted and BEFORE the report compiler renders
// its narrative payload. Partitions every finding into:
//   • supported     — has complete citation (doc + quote + page|refs) → render
//   • quarantined   — incomplete citation → do NOT render as evidence;
//                     surface in the "Citation Audit" appendix instead.
//
// This stage NEVER fails the report. Missing citations are a quality note,
// not a hard block. The compiler always renders supported findings and
// always emits the quarantine appendix so the audit trail is preserved.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type QuarantineReason =
  | "missing_document"
  | "missing_quote"
  | "missing_page_and_refs"
  | "missing_all";

export type CitationAuditFinding = {
  finding_id: string;
  canonical_finding_id: string | null;
  title: string;
  category: string | null;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  evidence_refs_count: number;
  reason?: QuarantineReason;
};

export type CitationAudit = {
  generated_at: string;
  total: number;
  supported: number;
  quarantined: number;
  supported_pct: number;
  supported_ids: string[];
  quarantined_findings: CitationAuditFinding[];
  appendix_markdown: string;
};

function reasonFor(f: {
  hasDoc: boolean; hasQuote: boolean; hasPage: boolean; hasRefs: boolean;
}): QuarantineReason {
  if (!f.hasDoc && !f.hasQuote && !f.hasPage && !f.hasRefs) return "missing_all";
  if (!f.hasDoc) return "missing_document";
  if (!f.hasQuote) return "missing_quote";
  return "missing_page_and_refs";
}

function renderAppendix(quarantined: CitationAuditFinding[]): string {
  if (quarantined.length === 0) {
    return "## Citation Audit\n\nAll findings have complete citations (document, page/refs, and verbatim quote). No items quarantined.";
  }
  const lines: string[] = [
    "## Citation Audit",
    "",
    `The following ${quarantined.length} finding(s) were **quarantined** because their supporting citation is incomplete. They are excluded from the report body but retained here for audit and follow-up.`,
    "",
    "| # | Finding | Reason | Doc | Page | Quote |",
    "|---|---|---|---|---|---|",
  ];
  quarantined.forEach((q, i) => {
    lines.push(
      `| ${i + 1} | ${q.title.replace(/\|/g, "\\|")} | Unsupported – ${q.reason ?? "incomplete_citation"} | ${q.source_document_id ?? "—"} | ${q.source_page ?? "—"} | ${q.source_quote ? "✓" : "—"} |`,
    );
  });
  return lines.join("\n");
}

export async function buildCitationAudit(db: Db, caseId: string): Promise<CitationAudit> {
  const { data } = await db
    .from("case_findings")
    .select("id,canonical_finding_id,title,category,source_document_id,source_page,source_quote,evidence_refs")
    .eq("case_id", caseId);
  const rows = data ?? [];
  const supported_ids: string[] = [];
  const quarantined_findings: CitationAuditFinding[] = [];

  for (const r of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = r as any;
    const hasDoc = typeof x.source_document_id === "string" && x.source_document_id.length > 0;
    const hasQuote = typeof x.source_quote === "string" && x.source_quote.trim().length > 0;
    const hasPage = typeof x.source_page === "number" && x.source_page > 0;
    const refs = Array.isArray(x.evidence_refs) ? x.evidence_refs : [];
    const hasRefs = refs.length > 0;
    const complete = hasDoc && hasQuote && (hasPage || hasRefs);
    if (complete) {
      supported_ids.push(String(x.id));
    } else {
      quarantined_findings.push({
        finding_id: String(x.id),
        canonical_finding_id: (x.canonical_finding_id as string | null) ?? null,
        title: String(x.title ?? "Untitled"),
        category: (x.category as string | null) ?? null,
        source_document_id: hasDoc ? (x.source_document_id as string) : null,
        source_page: hasPage ? (x.source_page as number) : null,
        source_quote: hasQuote ? (x.source_quote as string) : null,
        evidence_refs_count: refs.length,
        reason: reasonFor({ hasDoc, hasQuote, hasPage, hasRefs }),
      });
    }
  }

  const total = rows.length;
  const supported = supported_ids.length;
  const quarantined = quarantined_findings.length;
  return {
    generated_at: new Date().toISOString(),
    total,
    supported,
    quarantined,
    supported_pct: total > 0 ? Math.round((supported / total) * 1000) / 10 : 0,
    supported_ids,
    quarantined_findings,
    appendix_markdown: renderAppendix(quarantined_findings),
  };
}
