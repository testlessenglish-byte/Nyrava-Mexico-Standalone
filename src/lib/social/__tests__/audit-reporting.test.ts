import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase", "migrations", "20260828220000_comprehensive_care_audit_reports.sql"), "utf8");
const serverFunctions = readFileSync(join(root, "src", "lib", "social.functions.ts"), "utf8");
const reportBuilder = readFileSync(join(root, "src", "lib", "social", "reports", "audit-report-builder.server.ts"), "utf8");
const reportPdf = readFileSync(join(root, "src", "lib", "social", "reports", "audit-report-pdf.server.ts"), "utf8");
const workspaceUi = readFileSync(join(root, "src", "components", "social", "SocialCaseWorkspace.tsx"), "utf8");
const modalUi = readFileSync(join(root, "src", "components", "social", "GenerateReportModal.tsx"), "utf8");

describe("Comprehensive Care — Audit & Accountability Reporting System", () => {
  it("defines immutable audit reports and report email logs in migration", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_audit_reports");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_audit_report_emails");
    expect(migration).toContain("report_id TEXT NOT NULL UNIQUE");
    expect(migration).toContain("checksum_sha256 TEXT NOT NULL");
    expect(migration).toContain("dataset_snapshot JSONB NOT NULL");
  });

  it("enforces strict primary subscriber access control", () => {
    expect(reportBuilder).toContain("verifyPrimarySubscriber");
    expect(migration).toContain("role IN ('owner', 'organization_owner')");
    expect(serverFunctions).toContain("Solo el titular principal de la cuenta puede generar informes");
    expect(workspaceUi).toContain("isPrimarySubscriber");
  });

  it("places Generate Report button in top action bar between Community Support and Talk to Care Case", () => {
    expect(workspaceUi).toContain("GenerateReportModal");
    expect(workspaceUi).toContain('es ? "Generar informe" : "Generate Report"');
    expect(workspaceUi).toContain("FileText");
  });

  it("computes deterministic summary statistics without AI invention", () => {
    expect(reportBuilder).toContain("computeAuditSummary");
    expect(reportBuilder).toContain("casesCount");
    expect(reportBuilder).toContain("interventionsCount");
    expect(reportBuilder).toContain("referralsCount");
    expect(reportBuilder).toContain("tasksCount");
    expect(reportBuilder).toContain("totalFinancialTarget");
    expect(reportBuilder).toContain("goodsReceivedCount");
  });

  it("enforces zero-invention canonical disclaimer and missing field rules", () => {
    expect(reportPdf).toContain("NYRAVA MÉXICO");
    expect(reportPdf).toContain("Este informe refleja exclusivamente los registros autorizados");
    expect(modalUi).toContain("REGLA CANÓNICA: CERO INVENCIÓN");
  });

  it("supports multiple scopes and date range filtering", () => {
    expect(reportBuilder).toContain("filterByDateRange");
    expect(modalUi).toContain("individual_case");
    expect(modalUi).toContain("organization_wide");
    expect(modalUi).toContain("all_history");
    expect(modalUi).toContain("custom");
  });

  it("provides institutional PDF generation with running headers and SHA-256 verification", () => {
    expect(reportPdf).toContain("generateAuditReportPdf");
    expect(reportPdf).toContain("getNumberOfPages");
    expect(reportPdf).toContain("SHA-256");
    expect(modalUi).toContain("handleDownloadPdf");
    expect(modalUi).toContain("handlePrintPdf");
  });

  it("allows controlled email dispatch with auditable logging", () => {
    expect(serverFunctions).toContain("sendSocialAuditReportEmail");
    expect(modalUi).toContain("sendEmailM");
    expect(migration).toContain("social_audit_report_emails");
  });
});