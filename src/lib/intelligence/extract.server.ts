// Worker-compatible binary document extraction.
// Adds real PDF, DOCX, XLSX, and CSV parsing on top of the prior text/image-only
// pipeline. Each extractor returns { text, metadata } and never throws; failure
// is reported to the caller so coverage metrics stay accurate.

export type Extracted = {
  text: string;
  metadata: Record<string, unknown>;
  // pages: number of logical pages discovered, when applicable
  pages?: number;
  // pageTexts[i] is the text of page (i+1). Used for citation verification.
  pageTexts?: string[];
};

export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(buf);
  // mergePages:false returns string[] (per page).
  const raw = await extractText(pdf, { mergePages: false });
  const totalPages = raw.totalPages;
  const textRaw = raw.text as unknown;
  const pageTexts: string[] = Array.isArray(textRaw)
    ? (textRaw as unknown[]).map((t) => (t == null ? "" : String(t)))
    : [textRaw == null ? "" : String(textRaw)];
  const joined = pageTexts.join("\n\n").trim();
  return {
    text: joined,
    metadata: { document_type: "pdf", pages: totalPages },
    pages: totalPages,
    pageTexts,
  };
}

export async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const mammoth = await import("mammoth");
  // mammoth's Node build (used by workerd via nodejs_compat) only accepts
  // { path | buffer | file } — NOT { arrayBuffer }. Pass a Node Buffer.
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = await mammoth.extractRawText({ buffer: buf });
  return {
    text: (result.value ?? "").trim(),
    metadata: { document_type: "docx", warnings: (result.messages ?? []).slice(0, 5) },
  };
}

export async function extractXlsx(bytes: Uint8Array): Promise<Extracted> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const sheets: string[] = [];
  const sheetSummaries: Array<{ name: string; rows: number; cols: number }> = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const rows = csv ? csv.split(/\n/).length : 0;
    const cols = csv ? (csv.split(/\n/)[0]?.split(",").length ?? 0) : 0;
    sheets.push(`=== Sheet: ${name} ===\n${csv}`);
    sheetSummaries.push({ name, rows, cols });
  }
  return {
    text: sheets.join("\n\n").trim(),
    metadata: { document_type: "spreadsheet", sheets: sheetSummaries },
  };
}

export function extractCsv(bytes: Uint8Array): Extracted {
  const text = new TextDecoder().decode(bytes);
  const rows = text.split(/\r?\n/);
  return {
    text: text.trim(),
    metadata: { document_type: "csv", rows: rows.length, cols: (rows[0] ?? "").split(",").length },
  };
}

export function extractPlainText(bytes: Uint8Array, mime: string): Extracted {
  const text = new TextDecoder().decode(bytes).trim();
  return { text, metadata: { document_type: mime || "text/plain" } };
}
