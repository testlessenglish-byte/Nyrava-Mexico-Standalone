// Image Intelligence (Vision Pipeline) — Batch 3
// Builds a structured "vision" descriptor for image documents on top of the
// raw OCR text the extractor already produced. Pure derivation: no LLM call
// here, so it is deterministic and cheap to recompute.
//
// Source of truth: documents.extracted_text + documents.entities + filename.
// Output is written into documents.metadata.vision (additive) so all existing
// readers continue to work.

export type VisionDescriptor = {
  version: 1;
  is_image: boolean;
  has_text: boolean;
  has_signature: boolean;
  has_dates: boolean;
  has_amounts: boolean;
  has_handwriting_hint: boolean;
  detected_dates: string[];
  detected_amounts: string[];
  detected_parties: string[];
  document_kind:
    | "photograph"
    | "scanned_document"
    | "signed_form"
    | "receipt_or_ledger"
    | "diagram_or_chart"
    | "unknown";
  confidence: "high" | "medium" | "low";
};

const SIG_RE = /\b(signed|signature|\/s\/|x\s*_+|witness:|notary)\b/i;
const HAND_RE = /\b(handwritten|cursive|illegible|smudged)\b/i;
const DATE_RE = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi;
const AMOUNT_RE = /\$\s?[\d,]+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\s*(?:USD|dollars)?\b/gi;
const RECEIPT_RE = /\b(total|subtotal|tax|invoice|receipt|amount due|balance|payment|ledger)\b/i;
const FORM_RE = /\b(form|application|affidavit|declaration|consent|waiver|petition)\b/i;
const DIAGRAM_RE = /\b(figure|fig\.|diagram|chart|graph|exhibit\s+[A-Z])\b/i;
const PARTY_RE = /\b(Mr\.|Mrs\.|Ms\.|Dr\.|Officer|Detective|Judge|Plaintiff|Defendant|Petitioner|Respondent)\s+([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,2})/g;

function uniq(xs: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

export function buildVisionDescriptor(args: {
  filename: string;
  mimeType: string | null;
  extractedText: string;
  entities?: Array<{ type?: string; value?: string }> | null;
}): VisionDescriptor {
  const mime = String(args.mimeType ?? "").toLowerCase();
  const fn = args.filename.toLowerCase();
  const isImg = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|tiff|bmp|heic)$/i.test(fn);
  const text = args.extractedText ?? "";
  const len = text.trim().length;

  const dates = uniq(text.match(DATE_RE) ?? [], 25);
  const amounts = uniq(text.match(AMOUNT_RE) ?? [], 25);
  const partyMatches: string[] = [];
  for (const m of text.matchAll(PARTY_RE)) partyMatches.push(`${m[1]} ${m[2]}`);
  const fromEntities = (args.entities ?? [])
    .filter((e) => typeof e?.value === "string" && /person|party|witness|officer/i.test(String(e?.type ?? "")))
    .map((e) => String(e!.value));
  const parties = uniq([...partyMatches, ...fromEntities], 15);

  const hasSig = SIG_RE.test(text);
  const hasHand = HAND_RE.test(text);

  let kind: VisionDescriptor["document_kind"] = "unknown";
  if (RECEIPT_RE.test(text) && amounts.length > 0) kind = "receipt_or_ledger";
  else if (hasSig && FORM_RE.test(text)) kind = "signed_form";
  else if (DIAGRAM_RE.test(text)) kind = "diagram_or_chart";
  else if (isImg && len >= 200) kind = "scanned_document";
  else if (isImg) kind = "photograph";

  // Confidence reflects how much signal we actually saw, not vibes.
  let confidence: VisionDescriptor["confidence"] = "low";
  const signals = [len >= 200, dates.length > 0, parties.length > 0, amounts.length > 0, hasSig].filter(Boolean).length;
  if (signals >= 4) confidence = "high";
  else if (signals >= 2) confidence = "medium";

  return {
    version: 1,
    is_image: isImg,
    has_text: len >= 20,
    has_signature: hasSig,
    has_dates: dates.length > 0,
    has_amounts: amounts.length > 0,
    has_handwriting_hint: hasHand,
    detected_dates: dates,
    detected_amounts: amounts,
    detected_parties: parties,
    document_kind: kind,
    confidence,
  };
}
