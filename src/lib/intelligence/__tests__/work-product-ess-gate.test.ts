// Regression test for ESS suppression reaching case_work_product generation.
//
// Before this fix, runWorkProductEngine (engines.server.ts) was gated only
// by analysis_mode (the STRICT-mode firewall) — evidence sufficiency never
// factored in. A case whose report showed STATUS=Limitado / PUNTAJES
// suprimido for insufficient evidence still produced "COMPLETE"
// attorney-ready drafts (Demanda de Amparo, Ofrecimiento de Pruebas) with
// unsupported generic evidentiary content, because verifyWorkProductBody
// only rejects a draft whose CONCRETE claims (dates, filenames, figures)
// fail to trace to the corpus — a generically-worded boilerplate pleading
// sails through that check while still misrepresenting the case's actual
// evidentiary posture.
//
// computeWorkProductEss (sufficiency.server.ts) reuses the same
// allowMotionGeneration gate the report itself already enforces, built from
// data runWorkProductEngine has on hand (extracted document rows + findings)
// rather than the report stage's own later ESS run.
import { describe, it, expect } from "vitest";
import { computeWorkProductEss } from "@/lib/intelligence/sufficiency.server";

describe("computeWorkProductEss", () => {
  it("suppresses motion generation for a sparse corpus with few verified facts", () => {
    const docRows = [{ extracted_text: "Breve nota sin mayor detalle.", filename: "nota.txt" }];
    const findings: Array<{ source_doc_ids?: string[] }> = [
      { source_doc_ids: ["doc-1"] },
      { source_doc_ids: ["doc-1"] },
    ];
    const ess = computeWorkProductEss(docRows, findings);
    expect(ess.bin).toBe("minimal");
    expect(ess.allowMotionGeneration).toBe(false);
  });

  it("allows motion generation for a substantive corpus with enough verified facts", () => {
    const bigText = "Demanda de amparo. ".repeat(3000); // well over the 20,000-char "low" threshold
    const docRows = Array.from({ length: 10 }, (_, i) => ({
      extracted_text: bigText,
      filename: `doc-${i}.pdf`,
    }));
    const findings: Array<{ source_doc_ids?: string[] }> = Array.from({ length: 10 }, (_, i) => ({
      source_doc_ids: [`doc-${i}`, `doc-${(i + 1) % 10}`],
    }));
    const ess = computeWorkProductEss(docRows, findings);
    expect(ess.bin).not.toBe("minimal");
    expect(ess.allowMotionGeneration).toBe(true);
  });

  it("promotes a concise but litigation-ready corpus via the charging-document override", () => {
    // Short corpus, few facts — would otherwise land in "minimal" — but it
    // IS a real demanda, so the Full Analysis override should still allow
    // motion generation, matching the report's own posture for the same
    // corpus (computeESS's fullAnalysisOverride).
    const docRows = [
      {
        extracted_text: "Demanda de amparo interpuesta por el quejoso contra el acto reclamado.",
        filename: "demanda.pdf",
      },
    ];
    const findings: Array<{ source_doc_ids?: string[] }> = [{ source_doc_ids: ["doc-1"] }];
    const ess = computeWorkProductEss(docRows, findings);
    expect(ess.fullAnalysisOverride).toBe(true);
    expect(ess.allowMotionGeneration).toBe(true);
  });

  it("treats missing source_doc_ids defensively rather than throwing", () => {
    const docRows = [{ extracted_text: "x".repeat(100), filename: "a.txt" }];
    const findings: Array<{ source_doc_ids?: string[] }> = [{}, { source_doc_ids: undefined }];
    expect(() => computeWorkProductEss(docRows, findings)).not.toThrow();
  });
});
