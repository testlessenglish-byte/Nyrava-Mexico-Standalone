import { describe, it, expect } from "vitest";
import {
  buildCorpusIndex,
  verifyWorkProductBody,
  formatUnsupportedBanner,
  insufficientEvidenceStub,
} from "../work-product-verify.server";

const docs = [
  {
    filename: "04_Invoice_History.csv",
    extracted_text: "Phase,Amount,Status\nDeposit,194000,Paid\nFinal,145500,Unpaid\n",
  },
  {
    filename: "01_Complaint.txt",
    extracted_text: "Plaintiff alleges breach of contract dated February 12, 2023.",
  },
];

describe("verifyWorkProductBody", () => {
  const corpus = buildCorpusIndex(docs);

  it("passes when every figure and filename is in the corpus", () => {
    const body = "Unpaid balance $145,500. See 04_Invoice_History.csv. Contract dated February 12, 2023.";
    expect(verifyWorkProductBody(body, corpus)).toEqual([]);
  });

  it("flags fabricated dollar figures", () => {
    const body = "Demand for $50,000 in damages plus $4,500 in fees.";
    const out = verifyWorkProductBody(body, corpus);
    expect(out.some((u) => u.kind === "dollar" && u.claim.includes("50,000"))).toBe(true);
    expect(out.some((u) => u.kind === "dollar" && u.claim.includes("4,500"))).toBe(true);
  });

  it("flags references to documents that were never extracted", () => {
    const body = "Per 05_Email_Correspondence.txt and 09_Project_Timeline.txt the delays are documented.";
    const out = verifyWorkProductBody(body, corpus);
    expect(out.filter((u) => u.kind === "filename").length).toBe(2);
  });

  it("flags fabricated dates", () => {
    const body = "On June 1, 2024 the parties met.";
    const out = verifyWorkProductBody(body, corpus);
    expect(out.some((u) => u.kind === "date")).toBe(true);
  });

  it("banner and stub contain the unsupported claims", () => {
    const u = [{ kind: "dollar" as const, claim: "$50,000" }];
    expect(formatUnsupportedBanner(u)).toContain("$50,000");
    expect(insufficientEvidenceStub("settlement_demand", u)).toContain("$50,000");
  });
});
