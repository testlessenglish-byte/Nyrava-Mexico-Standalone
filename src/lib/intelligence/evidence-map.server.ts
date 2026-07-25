// Deterministic, per-document Evidence Map.
// Every uploaded document is classified into one of:
//   prosecution | defense | neutral | contradictory | missing_evidence
//
// Classification is heuristic-only (filename + extracted text + which findings
// reference the document). No LLM call — this guarantees consistency between
// the rendered Evidence Map, the rendered findings, and the document list.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type DocumentType =
  | "Charging Document"
  | "Search Warrant"
  | "Expert Report"
  | "Defense Motion"
  | "Prosecution Motion"
  | "Grand Jury Transcript"
  | "Witness Statement"
  | "Victim Impact Statement"
  | "Plea Agreement / Proffer"
  | "Defendant Statement"
  | "Financial Records"
  | "Correspondence"
  | "Other";

export type LitigationRole =
  | "Charging Authority"
  | "Evidence"
  | "Expert Opinion"
  | "Defense Challenge"
  | "Testimony"
  | "Negotiation"
  | "Background Context";

export type Party = "Prosecution" | "Defense" | "Neutral" | "Court";

export type EvidenceMapEntry = {
  document_id: string;
  filename: string;
  page_count: number;
  char_count: number;
  ocr_extracted: boolean;
  classification: "prosecution" | "defense" | "neutral" | "contradictory" | "missing_evidence";
  rationale: string;
  finding_count: number;
  contradiction_count: number;
  document_type: DocumentType;
  litigation_role: LitigationRole;
  party: Party;
};

export type EvidenceMap = {
  generated_at: string;
  documents: EvidenceMapEntry[];
  totals: {
    total: number;
    prosecution: number;
    defense: number;
    neutral: number;
    contradictory: number;
    missing_evidence: number;
    ocr_failed: number;
  };
};

// Doc-type detection from filename + heading text. First matching rule wins.
const DOC_TYPE_RULES: Array<{ match: RegExp; type: DocumentType; role: LitigationRole; party: Party }> = [
  { match: /\b(indictment|information|complaint|charging\s+doc)\b/i,          type: "Charging Document",       role: "Charging Authority", party: "Prosecution" },
  { match: /\b(search\s+warrant|arrest\s+warrant|warrant\s+affidavit)\b/i,    type: "Search Warrant",          role: "Evidence",           party: "Prosecution" },
  { match: /\b(expert\s+report|forensic\s+report|lab\s+report|autopsy)\b/i,   type: "Expert Report",           role: "Expert Opinion",     party: "Neutral" },
  { match: /\b(defense\s+motion|motion\s+to\s+suppress|motion\s+to\s+dismiss|defendant'?s\s+motion)\b/i, type: "Defense Motion", role: "Defense Challenge", party: "Defense" },
  { match: /\b(prosecution\s+motion|government'?s\s+motion|people'?s\s+motion|motion\s+in\s+limine)\b/i, type: "Prosecution Motion", role: "Evidence", party: "Prosecution" },
  { match: /\bgrand\s+jury\s+(transcript|testimony|minutes)\b/i,              type: "Grand Jury Transcript",   role: "Testimony",          party: "Prosecution" },
  { match: /\b(witness\s+statement|interview|deposition|declaration|affidavit)\b/i, type: "Witness Statement", role: "Testimony",          party: "Neutral" },
  { match: /\bvictim\s+(impact\s+)?statement\b/i,                             type: "Victim Impact Statement", role: "Testimony",          party: "Prosecution" },
  { match: /\b(plea\s+agreement|proffer|cooperation\s+agreement)\b/i,         type: "Plea Agreement / Proffer",role: "Negotiation",        party: "Neutral" },
  { match: /\b(defendant\s+statement|mirandized\s+statement|custodial\s+statement|confession)\b/i, type: "Defendant Statement", role: "Testimony", party: "Defense" },
  { match: /\b(bank\s+statement|wire\s+transfer|ledger|invoice|financial\s+record|tax\s+return|1099|k[- ]1)\b/i, type: "Financial Records", role: "Evidence", party: "Neutral" },
  { match: /\b(email|letter|correspondence|text\s+message|memo(?:randum)?)\b/i, type: "Correspondence",        role: "Background Context", party: "Neutral" },
];

function classifyDocument(filename: string, headText: string): { type: DocumentType; role: LitigationRole; party: Party } {
  const blob = `${filename}\n${headText.slice(0, 2000)}`;
  for (const r of DOC_TYPE_RULES) if (r.match.test(blob)) return { type: r.type, role: r.role, party: r.party };
  return { type: "Other", role: "Background Context", party: "Neutral" };
}


const RE_PROSECUTION = /(indictment|arrest|police[_ ]report|warrant|crime[_ ]scene|forensic|lab[_ ]report|victim[_ ]statement|prosecution|state[_ ]exhibit|charging|complaint(?!_for_dissolution)|booking)/i;
const RE_DEFENSE = /(defense|defendant|alibi|motion[_ ]to[_ ]suppress|exculpat|character[_ ]witness|expert[_ ]for[_ ]defense|defense[_ ]exhibit|answer(?!s)|counterclaim)/i;
const RE_CIVIL_PLAINTIFF = /(plaintiff|complaint|petition|ed[_ ]record|medical[_ ]record|ledger|invoice|contract|email[_ ]thread|inspection)/i;

export async function buildEvidenceMap(db: Db, caseId: string): Promise<EvidenceMap> {
  const [{ data: docs }, { data: findings }, { data: contradictions }] = await Promise.all([
    db.from("documents")
      .select("id,filename,extracted_text,status")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    db.from("case_findings")
      .select("source_document_id,source_doc_ids,affected_party,category")
      .eq("case_id", caseId),
    // Contradictions are stored inside reports.contradictions_struct; fall back
    // gracefully if absent.
    db.from("reports")
      .select("contradictions_struct")
      .eq("case_id", caseId)
      .maybeSingle(),
  ]);

  const pageCounts = new Map<string, number>();
  {
    const { data: pages } = await db
      .from("document_pages")
      .select("document_id,page")
      .eq("case_id", caseId);
    for (const p of pages ?? []) {
      pageCounts.set(p.document_id as string, Math.max(pageCounts.get(p.document_id as string) ?? 0, (p as { page: number }).page));
    }
  }

  // Index finding references by document_id.
  const findingsByDoc = new Map<string, { count: number; prosecution: number; defense: number }>();
  for (const f of findings ?? []) {
    const ids = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd = (f as any).source_document_id;
    if (typeof sd === "string") ids.add(sd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (f as any).source_doc_ids;
    if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") ids.add(x);
    for (const id of ids) {
      const cur = findingsByDoc.get(id) ?? { count: 0, prosecution: 0, defense: 0 };
      cur.count += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const party = String((f as any).affected_party ?? "").toLowerCase();
      if (party === "prosecution") cur.prosecution += 1;
      else if (party === "defense") cur.defense += 1;
      findingsByDoc.set(id, cur);
    }
  }

  // Count contradictions per document.
  const contraByDoc = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cstruct = (contradictions as any)?.contradictions_struct;
  if (Array.isArray(cstruct)) {
    for (const c of cstruct) {
      const ids: string[] = [];
      if (Array.isArray(c?.sources)) for (const s of c.sources) {
        if (typeof s?.document_id === "string") ids.push(s.document_id);
      }
      if (typeof c?.document_id === "string") ids.push(c.document_id);
      for (const id of ids) contraByDoc.set(id, (contraByDoc.get(id) ?? 0) + 1);
    }
  }

  const entries: EvidenceMapEntry[] = (docs ?? []).map((d) => {
    const id = d.id as string;
    const filename = String(d.filename ?? "Untitled");
    const text = String(d.extracted_text ?? "");
    const pages = pageCounts.get(id) ?? 0;
    const ocrOk = d.status === "extracted" && text.trim().length >= 100;
    const fcounts = findingsByDoc.get(id) ?? { count: 0, prosecution: 0, defense: 0 };
    const contraN = contraByDoc.get(id) ?? 0;

    let cls: EvidenceMapEntry["classification"];
    let why: string;

    if (!ocrOk) {
      cls = "missing_evidence";
      why = d.status === "extracted"
        ? "Document uploaded but extracted text is empty or unreadable — treat as missing evidence."
        : `Document not extracted (status=${d.status ?? "unknown"}).`;
    } else if (contraN > 0) {
      cls = "contradictory";
      why = `Cited by ${contraN} contradiction${contraN === 1 ? "" : "s"} elsewhere in the record.`;
    } else if (fcounts.prosecution > fcounts.defense && fcounts.prosecution > 0) {
      cls = "prosecution";
      why = `Supports ${fcounts.prosecution} prosecution/plaintiff finding${fcounts.prosecution === 1 ? "" : "s"}.`;
    } else if (fcounts.defense > fcounts.prosecution && fcounts.defense > 0) {
      cls = "defense";
      why = `Supports ${fcounts.defense} defense/respondent finding${fcounts.defense === 1 ? "" : "s"}.`;
    } else if (fcounts.count > 0) {
      cls = "neutral";
      why = `Cited by ${fcounts.count} finding${fcounts.count === 1 ? "" : "s"} with no clear directional lean.`;
    } else {
      // Heuristic from filename and content if no engine cited it.
      const blob = `${filename} ${text.slice(0, 2000)}`;
      if (RE_PROSECUTION.test(blob)) { cls = "prosecution"; why = "Filename/content matches prosecution-style document (indictment, arrest, lab report, etc.)."; }
      else if (RE_DEFENSE.test(blob)) { cls = "defense"; why = "Filename/content matches defense-style document (motion to suppress, defendant statement, alibi, etc.)."; }
      else if (RE_CIVIL_PLAINTIFF.test(blob)) { cls = "prosecution"; why = "Filename/content matches plaintiff-side civil document (complaint, ledger, contract, medical record)."; }
      else { cls = "neutral"; why = "No engine cited this document and no directional keywords in filename or content."; }
    }

    const docCls = classifyDocument(filename, text);
    return {
      document_id: id,
      filename,
      page_count: pages,
      char_count: text.length,
      ocr_extracted: ocrOk,
      classification: cls,
      rationale: why,
      finding_count: fcounts.count,
      contradiction_count: contraN,
      document_type: docCls.type,
      litigation_role: docCls.role,
      party: docCls.party,
    };
  });

  const totals = entries.reduce(
    (acc, e) => {
      acc.total += 1;
      acc[e.classification] += 1;
      if (!e.ocr_extracted) acc.ocr_failed += 1;
      return acc;
    },
    { total: 0, prosecution: 0, defense: 0, neutral: 0, contradictory: 0, missing_evidence: 0, ocr_failed: 0 },
  );

  return { generated_at: new Date().toISOString(), documents: entries, totals };
}

// ---------------------------------------------------------------------------
// OCR coverage report — purely derived from documents + document_pages.
// ---------------------------------------------------------------------------
export type OcrCoverage = {
  total_documents: number;
  extracted: number;
  failed: number;
  pending: number;
  coverage_pct: number;          // extracted / total
  avg_chars_per_doc: number;
  total_pages: number;
  docs_with_pages: number;
};

export async function buildOcrCoverage(db: Db, caseId: string): Promise<OcrCoverage> {
  const [{ data: docs }, { data: pages }] = await Promise.all([
    db.from("documents").select("id,status,extracted_text").eq("case_id", caseId),
    db.from("document_pages").select("document_id").eq("case_id", caseId),
  ]);
  const list = docs ?? [];
  const total = list.length;
  let extracted = 0; let failed = 0; let pending = 0; let chars = 0;
  for (const d of list) {
    const status = String(d.status ?? "");
    if (status === "extracted") { extracted += 1; chars += String(d.extracted_text ?? "").length; }
    else if (status === "failed") failed += 1;
    else pending += 1;
  }
  const pageDocSet = new Set<string>();
  for (const p of pages ?? []) pageDocSet.add(p.document_id as string);
  return {
    total_documents: total,
    extracted, failed, pending,
    coverage_pct: total > 0 ? Math.round((extracted / total) * 1000) / 10 : 0,
    avg_chars_per_doc: extracted > 0 ? Math.round(chars / extracted) : 0,
    total_pages: (pages ?? []).length,
    docs_with_pages: pageDocSet.size,
  };
}

// ---------------------------------------------------------------------------
// Report Quality audit — every finding must have document number + page +
// citation + supporting evidence. Returns counters used in validation block.
// ---------------------------------------------------------------------------
export type ReportQualityAudit = {
  total_findings: number;
  with_document: number;
  with_page: number;
  with_quote: number;
  with_evidence_refs: number;
  fully_cited: number;            // doc + (page OR refs) + quote
  fully_cited_pct: number;
  missing_citation: number;
  missing_citation_titles: string[];
};

export async function buildReportQualityAudit(db: Db, caseId: string): Promise<ReportQualityAudit> {
  const { data } = await db
    .from("case_findings")
    .select("title,source_document_id,source_page,source_quote,evidence_refs")
    .eq("case_id", caseId);
  const rows = data ?? [];
  const audit: ReportQualityAudit = {
    total_findings: rows.length,
    with_document: 0, with_page: 0, with_quote: 0, with_evidence_refs: 0,
    fully_cited: 0, fully_cited_pct: 0,
    missing_citation: 0, missing_citation_titles: [],
  };
  for (const r of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = r as any;
    const hasDoc = typeof x.source_document_id === "string" && x.source_document_id.length > 0;
    const hasPage = typeof x.source_page === "number" && x.source_page > 0;
    const hasQuote = typeof x.source_quote === "string" && x.source_quote.trim().length > 0;
    const refs = Array.isArray(x.evidence_refs) ? x.evidence_refs : [];
    const hasRefs = refs.length > 0;
    if (hasDoc) audit.with_document += 1;
    if (hasPage) audit.with_page += 1;
    if (hasQuote) audit.with_quote += 1;
    if (hasRefs) audit.with_evidence_refs += 1;
    if (hasDoc && hasQuote && (hasPage || hasRefs)) audit.fully_cited += 1;
    else {
      audit.missing_citation += 1;
      if (audit.missing_citation_titles.length < 25) audit.missing_citation_titles.push(String(x.title ?? "Untitled"));
    }
  }
  audit.fully_cited_pct = audit.total_findings > 0
    ? Math.round((audit.fully_cited / audit.total_findings) * 1000) / 10
    : 0;
  return audit;
}
