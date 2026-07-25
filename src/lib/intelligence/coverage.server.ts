// Evidence coverage metrics. Surfaces ingestion transparency so the user
// always knows how complete the analysis is.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type CoverageReport = {
  documents_found: number;
  documents_parsed: number;
  documents_failed: number;
  documents_pending: number;
  ocr_attempted: number;
  ocr_successful: number;
  ocr_coverage_pct: number;
  parse_coverage_pct: number;
  metadata_coverage_pct: number;
  text_chars_total: number;
  by_status: Record<string, number>;
  by_kind: Record<string, { found: number; parsed: number; failed: number }>;
  failed_documents: Array<{ id: string; filename: string; error: string | null }>;
  generated_at: string;
};

const OCR_KINDS = new Set(["image", "pdf"]);

function kindFromMime(mime: string | null, filename: string): string {
  const m = (mime ?? "").toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (m.startsWith("image/")) return "image";
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "spreadsheet";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/") || ["txt", "md", "log", "json", "xml", "html", "htm"].includes(ext)) return "text";
  return "other";
}

export async function computeCoverage(db: Db, caseId: string): Promise<CoverageReport> {
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,mime_type,status,error,extracted_text,metadata")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const list = docs ?? [];

  const by_status: Record<string, number> = {};
  const by_kind: Record<string, { found: number; parsed: number; failed: number }> = {};
  let parsed = 0;
  let failed = 0;
  let pending = 0;
  let ocrAttempted = 0;
  let ocrSuccessful = 0;
  let metadataCovered = 0;
  let textChars = 0;
  const failedDocs: CoverageReport["failed_documents"] = [];

  for (const d of list) {
    const s = String(d.status ?? "pending");
    by_status[s] = (by_status[s] ?? 0) + 1;
    const kind = kindFromMime(d.mime_type, d.filename);
    if (!by_kind[kind]) by_kind[kind] = { found: 0, parsed: 0, failed: 0 };
    by_kind[kind].found += 1;
    if (s === "extracted") {
      parsed += 1;
      by_kind[kind].parsed += 1;
      const text = String(d.extracted_text ?? "");
      textChars += text.length;
      if (text.length > 40 && !text.startsWith("[Binary file stored")) {
        if (OCR_KINDS.has(kind)) {
          ocrAttempted += 1;
          ocrSuccessful += 1;
        }
      } else if (OCR_KINDS.has(kind)) {
        ocrAttempted += 1;
      }
      const meta = d.metadata as Record<string, unknown> | null;
      if (meta && Object.keys(meta).length > 0) metadataCovered += 1;
    } else if (s === "failed") {
      failed += 1;
      by_kind[kind].failed += 1;
      failedDocs.push({ id: d.id, filename: d.filename, error: d.error ?? null });
    } else {
      pending += 1;
    }
  }

  const found = list.length;
  return {
    documents_found: found,
    documents_parsed: parsed,
    documents_failed: failed,
    documents_pending: pending,
    ocr_attempted: ocrAttempted,
    ocr_successful: ocrSuccessful,
    ocr_coverage_pct: ocrAttempted ? Math.round((ocrSuccessful / ocrAttempted) * 1000) / 10 : 0,
    parse_coverage_pct: found ? Math.round((parsed / found) * 1000) / 10 : 0,
    metadata_coverage_pct: parsed ? Math.round((metadataCovered / parsed) * 1000) / 10 : 0,
    text_chars_total: textChars,
    by_status,
    by_kind,
    failed_documents: failedDocs,
    generated_at: new Date().toISOString(),
  };
}
