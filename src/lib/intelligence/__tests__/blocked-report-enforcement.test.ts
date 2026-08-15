// Regression test for backend enforcement of the frozen release contract
// (docs/FREEZE.md: "A report with quality_blocked=true must never produce a
// downloadable PDF or DOCX"). PDF/DOCX generation happens client-side
// (src/lib/export.ts) from data supplied by cases.functions.ts::getCase.
// Previously that endpoint returned the full `reports` row — including
// full_report and every prose content field — regardless of
// quality_blocked, so a direct call to the server function (bypassing the
// frontend's UI-level check) could still retrieve everything needed to
// render a false "evidence-grounded, citation-audited" PDF.
//
// This test exercises sanitizeBlockedReport() directly with generic,
// synthetic report shapes — no case-specific content, no fixture
// hardcoding.
import { describe, it, expect } from "vitest";
import { sanitizeBlockedReport, isReportStale, isReportStaleByDocumentHash } from "@/lib/cases.functions";
import { sha256Hex } from "@/lib/intelligence/evidence-provenance.server";

describe("sanitizeBlockedReport", () => {
  it("strips substantive content fields when quality_blocked is true", () => {
    const blocked = {
      id: "report-1",
      case_id: "case-1",
      user_id: "user-1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      version: 3,
      quality_blocked: true,
      quality_block_reasons: ["citation_verification_failed"],
      report_mode: "LIMITED",
      // Substantive content — must all become null when blocked.
      full_report: { some: "content" },
      executive_summary: "Sustentado en evidencia. Citas auditadas.",
      facts: "Some narrative the user should never see for a blocked report.",
      risk_analysis: "Risk narrative",
      timeline_summary: "Timeline narrative",
      citations: [{ quote: "verbatim quote" }],
      recommendations: "Formal recommendation text",
    };

    const result = sanitizeBlockedReport(blocked);

    // Metadata survives — the UI needs this to render an accurate blocked state.
    expect(result?.quality_blocked).toBe(true);
    expect(result?.quality_block_reasons).toEqual(["citation_verification_failed"]);
    expect(result?.report_mode).toBe("LIMITED");
    expect(result?.id).toBe("report-1");
    expect(result?.version).toBe(3);

    // Every substantive content field is stripped.
    expect(result?.full_report).toBeNull();
    expect(result?.executive_summary).toBeNull();
    expect(result?.facts).toBeNull();
    expect(result?.risk_analysis).toBeNull();
    expect(result?.timeline_summary).toBeNull();
    expect(result?.citations).toBeNull();
    expect(result?.recommendations).toBeNull();
  });

  it("returns an unblocked report completely unchanged", () => {
    const clean = {
      id: "report-2",
      quality_blocked: false,
      full_report: { some: "content" },
      executive_summary: "A legitimately released summary.",
    };

    const result = sanitizeBlockedReport(clean);
    expect(result).toBe(clean); // same reference — genuinely untouched, not just equal
  });

  it("passes through null/undefined report rows unchanged", () => {
    expect(sanitizeBlockedReport(null)).toBeNull();
    expect(sanitizeBlockedReport(undefined)).toBeUndefined();
  });

  it("fails closed: a field not on the metadata allowlist is stripped even if it looks harmless", () => {
    // Simulates a future column added to `reports` without updating the
    // allowlist — must default to being treated as content, not metadata.
    const blocked = {
      quality_blocked: true,
      some_brand_new_column_nobody_updated_the_allowlist_for: "still gets stripped",
    };
    const result = sanitizeBlockedReport(blocked);
    expect(result?.some_brand_new_column_nobody_updated_the_allowlist_for).toBeNull();
  });
});

describe("isReportStale", () => {
  const BLOCKING = new Set(["extraction", "analyzers", "scoring"]);

  it("is not stale when the report postdates every blocking-tier engine's latest run", () => {
    const report = { updated_at: "2026-01-02T00:00:00Z" };
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00Z" },
      { engine: "analyzers", ended_at: "2026-01-01T12:00:00Z" },
      { engine: "scoring", ended_at: "2026-01-01T18:00:00Z" },
    ];
    expect(isReportStale(report, runs, BLOCKING)).toBe(false);
  });

  it("is stale when a blocking-tier engine completed AFTER the report was generated (the resume/retry scenario)", () => {
    const report = { updated_at: "2026-01-01T00:00:00Z" };
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00Z" }, // original run
      // Case was resumed and analyzers re-ran later, but the report row
      // (singleton, updated in place) was never regenerated afterward.
      { engine: "analyzers", ended_at: "2026-01-02T00:00:00Z" },
    ];
    expect(isReportStale(report, runs, BLOCKING)).toBe(true);
  });

  it("ignores non-blocking-tier engines entirely — an optional stage re-running later does not mark the report stale", () => {
    const report = { updated_at: "2026-01-01T00:00:00Z" };
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00Z" },
      // "multi_agent" is not in the BLOCKING set for this test.
      { engine: "multi_agent", ended_at: "2026-01-05T00:00:00Z" },
    ];
    expect(isReportStale(report, runs, BLOCKING)).toBe(false);
  });

  // BUG FIXED (confirmed on two real, independently-audited released cases,
  // ADR-4321-2017-180507 and ADR-4640-2017-180212): a completed, released
  // case's exported report came back with every substantive field null and
  // stale:true, even though nothing was ever actually resumed or retried.
  // jurisdiction_intel and legal_qa (both blocking-tier) have no dedicated
  // `cases.<x>_at` column — their completion is knowable only via their
  // pipeline_engine_runs row — and report generation begins as soon as its
  // own in-memory dependency check sees them done, with nothing forcing
  // their ledger-row UPDATE to have already committed before the report's
  // own row is written a moment later. A bare `t > reportTime` comparison
  // flagged that ordinary few-second write-ordering jitter as "a blocking
  // stage re-ran after the report" on effectively every normal completion.
  it("a blocking engine landing a couple seconds after the report (normal write-ordering jitter) is NOT flagged stale", () => {
    const report = { updated_at: "2026-01-01T00:00:00.000Z" };
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00.000Z" },
      { engine: "analyzers", ended_at: "2025-12-31T23:59:00.000Z" },
      // legal_qa's own ledger write lands ~2s after the report row — the
      // exact race observed on both real cases (hallucination_at landed
      // ~1.7s after report_at on one of them).
      { engine: "scoring", ended_at: "2026-01-01T00:00:02.000Z" },
    ];
    expect(isReportStale(report, runs, BLOCKING)).toBe(false);
  });

  it("still flags a genuine resume/retry minutes later — the grace period does not swallow real staleness", () => {
    const report = { updated_at: "2026-01-01T00:00:00.000Z" };
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00.000Z" },
      // A real resume: re-queued, worker cold start, full stage re-run —
      // minutes later, far outside any plausible write-ordering jitter.
      { engine: "analyzers", ended_at: "2026-01-01T00:05:00.000Z" },
    ];
    expect(isReportStale(report, runs, BLOCKING)).toBe(true);
  });

  it("fails closed on a missing/unparseable report timestamp — never asserts staleness it can't support", () => {
    expect(isReportStale({ updated_at: null, created_at: null }, [], BLOCKING)).toBe(false);
    expect(isReportStale(null, [], BLOCKING)).toBe(false);
  });

  it("falls back to created_at when updated_at is absent", () => {
    const report = { created_at: "2026-01-01T00:00:00Z" };
    const runs = [{ engine: "extraction", ended_at: "2026-01-02T00:00:00Z" }];
    expect(isReportStale(report, runs, BLOCKING)).toBe(true);
  });

  // Regression for the pipeline-runner.server.ts staleness override: a stale
  // report is dropped from the resume state so the "report" stage gets a
  // real chance to regenerate (see _runPipelineForCase's staleness-override
  // block). These tests prove the specific properties that override relies
  // on — the full pipeline run itself is not unit-testable in isolation
  // (it needs a live/mocked Supabase + AI provider stack), but its
  // correctness reduces entirely to isReportStale()'s behavior across a
  // regenerate cycle, which IS directly testable here.
  it("regeneration cycle: once the report is rewritten with a timestamp newer than every blocking engine, staleness clears", () => {
    const BLOCKING2 = new Set(["extraction", "analyzers", "scoring"]);
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00Z" },
      { engine: "analyzers", ended_at: "2026-01-02T00:00:00Z" }, // re-ran after the old report
    ];
    const staleReport = { updated_at: "2026-01-01T06:00:00Z" };
    expect(isReportStale(staleReport, runs, BLOCKING2)).toBe(true);

    // runReport() always deletes+rewrites the report_generator ledger row
    // and the `reports` singleton on a real regeneration — simulate that:
    // the new report's updated_at is set at generation time, necessarily
    // after every blocking engine row it just read.
    const regeneratedReport = { updated_at: "2026-01-03T00:00:00Z" };
    expect(isReportStale(regeneratedReport, runs, BLOCKING2)).toBe(false);
  });

  it("no infinite regeneration loop: staleness cannot re-trigger from the same blocking-engine rows once the report postdates them", () => {
    // If regeneration only bumped the report's timestamp without any
    // blocking engine ALSO re-running afterward, a second staleness check
    // against the SAME runs must stay false — otherwise the pipeline would
    // regenerate forever on every tick even though nothing upstream changed.
    const BLOCKING2 = new Set(["extraction", "analyzers"]);
    const runs = [
      { engine: "extraction", ended_at: "2026-01-01T00:00:00Z" },
      { engine: "analyzers", ended_at: "2026-01-01T00:00:00Z" },
    ];
    const report = { updated_at: "2026-01-01T00:00:01Z" };
    expect(isReportStale(report, runs, BLOCKING2)).toBe(false);
    // Checking again with the identical inputs (simulating the next tick)
    // must be stable, not flip to true.
    expect(isReportStale(report, runs, BLOCKING2)).toBe(false);
  });
});

describe("isReportStaleByDocumentHash", () => {
  it("is not stale when every cited document's current hash matches what the report recorded", () => {
    const text = "El arrendador entrega el inmueble al arrendatario.";
    const report = {
      citations: [
        { document_id: "doc-1", document_hash: sha256Hex(text) },
      ],
    };
    const documents = [{ id: "doc-1", extracted_text: text }];
    expect(isReportStaleByDocumentHash(report, documents)).toBe(false);
  });

  it("is stale when a cited document's content changed after the report was generated", () => {
    const originalText = "El arrendador entrega el inmueble al arrendatario.";
    const editedText = "El arrendador entrega el inmueble remodelado al arrendatario.";
    const report = {
      citations: [{ document_id: "doc-1", document_hash: sha256Hex(originalText) }],
    };
    const documents = [{ id: "doc-1", extracted_text: editedText }];
    expect(isReportStaleByDocumentHash(report, documents)).toBe(true);
  });

  it("is stale when a cited document was deleted/archived out from under the report", () => {
    const report = {
      citations: [{ document_id: "doc-1", document_hash: sha256Hex("some text") }],
    };
    expect(isReportStaleByDocumentHash(report, [])).toBe(true);
  });

  it("fails closed when no citation carries a stored document_hash (e.g. a pre-Phase-1 report)", () => {
    const report = { citations: [{ document_id: "doc-1", quote: "no hash on this old citation" }] };
    const documents = [{ id: "doc-1", extracted_text: "anything, does not matter" }];
    expect(isReportStaleByDocumentHash(report, documents)).toBe(false);
  });

  it("fails closed on missing/malformed inputs", () => {
    expect(isReportStaleByDocumentHash(null, [])).toBe(false);
    expect(isReportStaleByDocumentHash({ citations: undefined }, [])).toBe(false);
    expect(isReportStaleByDocumentHash({ citations: [] }, [])).toBe(false);
    expect(isReportStaleByDocumentHash({ citations: "not-an-array" as unknown }, [])).toBe(false);
  });

  it("checks every distinct cited document, not just the first", () => {
    const textA = "Contrato A sin cambios.";
    const textB = "Contrato B original.";
    const report = {
      citations: [
        { document_id: "doc-A", document_hash: sha256Hex(textA) },
        { document_id: "doc-B", document_hash: sha256Hex(textB) },
      ],
    };
    // doc-A unchanged, doc-B edited — must still detect staleness via doc-B.
    const documents = [
      { id: "doc-A", extracted_text: textA },
      { id: "doc-B", extracted_text: "Contrato B editado." },
    ];
    expect(isReportStaleByDocumentHash(report, documents)).toBe(true);
  });

  it("only considers the first stored hash per document (stable, does not flip on duplicate citations)", () => {
    const text = "Texto estable del documento.";
    const report = {
      citations: [
        { document_id: "doc-1", document_hash: sha256Hex(text) },
        { document_id: "doc-1", document_hash: sha256Hex(text) },
      ],
    };
    const documents = [{ id: "doc-1", extracted_text: text }];
    expect(isReportStaleByDocumentHash(report, documents)).toBe(false);
  });
});

describe("sanitizeBlockedReport: staleness path", () => {
  it("strips content and sets stale/stale_reason when stale is true, even if quality_blocked is false", () => {
    // audit B8: sanitizeBlockedReport<T> returns the SAME type T as its
    // input — it adds stale/stale_reason dynamically at runtime (via an
    // internal Record<string, unknown> cast back to T), which the generic
    // signature doesn't express. Declaring them here as optional on the
    // input fixture's type lets T include them, matching what the function
    // actually does, without changing the production function's signature.
    const report: {
      id: string;
      quality_blocked: boolean;
      full_report: Record<string, unknown> | null;
      executive_summary: string | null;
      stale?: boolean;
      stale_reason?: string | null;
    } = {
      id: "report-1",
      quality_blocked: false,
      full_report: { some: "content" },
      executive_summary: "An analysis that predates the latest pipeline run.",
    };
    const result = sanitizeBlockedReport(report, { stale: true });
    expect(result?.full_report).toBeNull();
    expect(result?.executive_summary).toBeNull();
    expect(result?.stale).toBe(true);
    expect(typeof result?.stale_reason).toBe("string");
  });

  it("does not touch a fresh, non-blocked report", () => {
    const report = { id: "report-2", quality_blocked: false, full_report: { some: "content" } };
    const result = sanitizeBlockedReport(report, { stale: false });
    expect(result).toBe(report);
  });
});

describe("export.ts: explicit backend quality_blocked guard (defense-in-depth)", () => {
  it("downloadPdf throws REPORT_BLOCKED when report.quality_blocked is true, before doing any rendering work", async () => {
    const { downloadPdf } = await import("@/lib/export");
    const data = {
      case: { id: "case-1", name: "Generic Case" },
      documents: [],
      analysis: null,
      agents: [],
      score: null,
      report: { quality_blocked: true },
    };
    await expect(downloadPdf(data as never, "test")).rejects.toThrow(/REPORT_BLOCKED/);
  });

  it("downloadDocx throws REPORT_BLOCKED when report.quality_blocked is true", async () => {
    const { downloadDocx } = await import("@/lib/export");
    const data = {
      case: { id: "case-1", name: "Generic Case" },
      documents: [],
      analysis: null,
      agents: [],
      score: null,
      report: { quality_blocked: true },
    };
    await expect(downloadDocx(data as never, "test")).rejects.toThrow(/REPORT_BLOCKED/);
  });

  it("does not throw REPORT_BLOCKED for an unblocked report (may still fail later for unrelated reasons — this only proves the guard itself doesn't false-positive)", async () => {
    const { downloadPdf } = await import("@/lib/export");
    const data = {
      case: { id: "case-1", name: "Generic Case" },
      documents: [],
      analysis: null,
      agents: [],
      score: null,
      report: { quality_blocked: false },
    };
    try {
      await downloadPdf(data as never, "test");
    } catch (e) {
      expect(String(e instanceof Error ? e.message : e)).not.toMatch(/REPORT_BLOCKED/);
    }
  });
});
