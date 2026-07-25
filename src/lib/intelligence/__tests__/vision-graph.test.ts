// Batch 3 + 4 Validation Suite — pure helpers, no DB.
import { describe, it, expect } from "vitest";
import { buildVisionDescriptor } from "@/lib/intelligence/vision.server";
import { computeReportHash } from "@/lib/intelligence/report-version.server";

describe("VisionDescriptor", () => {
  it("classifies a signed form", () => {
    const v = buildVisionDescriptor({
      filename: "consent.png",
      mimeType: "image/png",
      extractedText:
        "Consent and Waiver Form. I, Mr. John Doe, declare on 01/15/2024 that I have read this. Signed: /s/ John Doe. Witness: Officer Smith.",
      entities: [{ type: "person", value: "John Doe" }],
    });
    expect(v.is_image).toBe(true);
    expect(v.has_signature).toBe(true);
    expect(v.has_dates).toBe(true);
    expect(v.detected_parties.length).toBeGreaterThan(0);
    expect(v.document_kind).toBe("signed_form");
    expect(["high", "medium"]).toContain(v.confidence);
  });

  it("classifies a receipt/ledger", () => {
    const v = buildVisionDescriptor({
      filename: "invoice.jpg",
      mimeType: "image/jpeg",
      extractedText: "Invoice #1024 Total: $1,250.00 Subtotal $1,100 Tax $150 Amount Due $1,250.00",
      entities: [],
    });
    expect(v.document_kind).toBe("receipt_or_ledger");
    expect(v.detected_amounts.length).toBeGreaterThan(0);
  });

  it("non-image text file is not flagged as image", () => {
    const v = buildVisionDescriptor({
      filename: "notes.txt",
      mimeType: "text/plain",
      extractedText: "Meeting notes from 2024-03-04.",
      entities: [],
    });
    expect(v.is_image).toBe(false);
    expect(v.has_dates).toBe(true);
  });
});

describe("Report version hash determinism", () => {
  it("identical content yields identical hash regardless of key order", async () => {
    const r1 = { case_strength_score: 72, full_report: { a: 1, b: [1, 2] }, version: 3 };
    const r2 = { version: 3, full_report: { b: [1, 2], a: 1 }, case_strength_score: 72 };
    expect(await computeReportHash(r1)).toBe(await computeReportHash(r2));
  });
  it("changing substantive content changes the hash", async () => {
    const h1 = await computeReportHash({ case_strength_score: 72 });
    const h2 = await computeReportHash({ case_strength_score: 73 });
    expect(h1).not.toBe(h2);
  });
});
