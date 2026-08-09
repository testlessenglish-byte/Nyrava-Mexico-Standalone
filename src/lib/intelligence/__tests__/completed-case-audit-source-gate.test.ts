// Regression test for the zero-hallucination "technical barrier" the spec
// explicitly asked for: "the model should be unable to mark something
// CONFIRMED unless it has an attached source reference." This exercises the
// REAL enforceStatementSource()/enforceLawSource()/resolveSource() gate
// functions from completed-case-audit.server.ts — the model's own
// self-assigned classification is a claim, not a fact, and these functions
// are what independently re-checks it.
import { describe, it, expect } from "vitest";
import { buildGroundingCorpus } from "@/lib/intelligence/grounding.server";
import {
  enforceStatementSource,
  enforceLawSource,
  resolveSource,
} from "@/lib/intelligence/completed-case-audit.server";
import type { StatutoryCitationVerification } from "@/lib/legal/citation-verification.server";

const REAL_QUOTE =
  "el juzgador determinó que la notificación se realizó conforme al artículo 26 de la Ley de Amparo";

function corpus() {
  return buildGroundingCorpus([
    { id: "doc-1", filename: "sentencia.pdf", extracted_text: REAL_QUOTE },
  ]);
}
const docs = [{ id: "doc-1", filename: "sentencia.pdf", extracted_text: REAL_QUOTE }];

describe("completed-case-audit source gate", () => {
  it("keeps FACT_DOCUMENTED when the claimed quote actually appears in the case documents", () => {
    const result = enforceStatementSource(
      {
        text: "The court found notification was proper.",
        classification: "FACT_DOCUMENTED",
        quote: REAL_QUOTE,
      },
      corpus(),
      docs,
    );
    expect(result?.classification).toBe("FACT_DOCUMENTED");
    expect(result?.source?.document_id).toBe("doc-1");
    expect(result?.source?.page).toBe(1);
  });

  it("forcibly downgrades a FACT_DOCUMENTED claim with an invented/paraphrased quote — never trusts the model's own label", () => {
    const result = enforceStatementSource(
      {
        text: "The court found the defendant had a prior criminal record.",
        classification: "FACT_DOCUMENTED",
        quote: "This exact sentence does not appear anywhere in the case record and was invented.",
      },
      corpus(),
      docs,
    );
    expect(result?.classification).toBe("UNKNOWN");
    expect(result?.note).toMatch(/SOURCE NOT LOCATED/);
  });

  it("forcibly downgrades a FACT_DOCUMENTED claim with NO quote at all", () => {
    const result = enforceStatementSource(
      {
        text: "The defendant confessed during interrogation.",
        classification: "FACT_DOCUMENTED",
        quote: null,
      },
      corpus(),
      docs,
    );
    expect(result?.classification).toBe("UNKNOWN");
    expect(result?.note).toMatch(/SOURCE NOT LOCATED/);
  });

  it("never requires a source for INFERENCE/POSSIBILITY, but does not upgrade them either", () => {
    const result = enforceStatementSource(
      { text: "This may suggest a procedural gap.", classification: "POSSIBILITY", quote: null },
      corpus(),
      docs,
    );
    expect(result?.classification).toBe("POSSIBILITY");
    expect(result?.source).toBeNull();
  });

  it("keeps LAW_VERIFIED only when the citation was independently marked VERIFIED by verifyStatutoryCitation", () => {
    const verifiedReview = {
      citation_text: "Art. 26 de la Ley de Amparo",
      verification: {
        status: "VERIFIED",
        matched_article_body: "El texto real del artículo 26.",
      } as unknown as StatutoryCitationVerification,
    };
    const ok = enforceLawSource(
      { text: "Notification must be personal.", citation_text: "Art. 26 de la Ley de Amparo" },
      [verifiedReview],
    );
    expect(ok?.classification).toBe("LAW_VERIFIED");

    const unverifiedReview = {
      citation_text: "Art. 999 de un Código Inventado",
      verification: { status: "UNVERIFIED" } as unknown as StatutoryCitationVerification,
    };
    const rejected = enforceLawSource(
      { text: "A fabricated legal rule.", citation_text: "Art. 999 de un Código Inventado" },
      [unverifiedReview],
    );
    expect(rejected?.classification).toBe("UNKNOWN");
    expect(rejected?.note).toMatch(/LEGAL AUTHORITY NOT VERIFIED/);

    const noCitation = enforceLawSource({ text: "An unsupported legal claim." }, [verifiedReview]);
    expect(noCitation?.classification).toBe("UNKNOWN");
  });

  it("resolveSource returns null for a quote that doesn't verify, and a real reference for one that does", () => {
    expect(resolveSource("invented text not in the record", corpus(), docs)).toBeNull();
    const real = resolveSource(REAL_QUOTE, corpus(), docs);
    expect(real?.document_id).toBe("doc-1");
    expect(real?.quote).toBe(REAL_QUOTE);
  });
});
