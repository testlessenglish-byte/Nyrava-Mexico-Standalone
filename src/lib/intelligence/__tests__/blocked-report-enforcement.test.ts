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
import { sanitizeBlockedReport } from "@/lib/cases.functions";

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
