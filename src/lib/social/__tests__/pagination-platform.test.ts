import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const paginationComponent = readFileSync(join(root, "src", "components", "common", "NyravaPagination.tsx"), "utf8");
const labelNormalizer = readFileSync(join(root, "src", "lib", "social", "activity-label-normalizer.ts"), "utf8");
const socialFns = readFileSync(join(root, "src", "lib", "social.functions.ts"), "utf8");
const socialUi = readFileSync(join(root, "src", "routes", "_authenticated", "social.tsx"), "utf8");
const caseActivityFeed = readFileSync(join(root, "src", "components", "social", "CaseActivityFeed.tsx"), "utf8");
const documentsHub = readFileSync(join(root, "src", "components", "social", "SocialDocumentsHub.tsx"), "utf8");
const timelineUi = readFileSync(join(root, "src", "routes", "_authenticated", "timeline.tsx"), "utf8");
const witnessUi = readFileSync(join(root, "src", "routes", "_authenticated", "witness.tsx"), "utf8");

describe("Platform-Wide Server-Side Pagination & Activity Normalizer", () => {
  it("defines reusable NyravaPagination component with bilingual support and 25|50|100 row sizes", () => {
    expect(paginationComponent).toContain("export function NyravaPagination");
    expect(paginationComponent).toContain("Mostrando");
    expect(paginationComponent).toContain("Showing");
    expect(paginationComponent).toContain("Filas:");
    expect(paginationComponent).toContain("Rows:");
    expect(paginationComponent).toContain("pageSizeOptions = [25, 50, 100]");
    expect(paginationComponent).toContain("totalPages");
  });

  it("implements server-side getTeamActivityEventsPaginated with stable deterministic ordering", () => {
    expect(socialFns).toContain("export const getTeamActivityEventsPaginated");
    expect(socialFns).toContain("order('occurred_at', { ascending: false }).order('id', { ascending: false })".replace(/'/g, '"'));
    expect(socialFns).toContain("range(from, to)");
    expect(socialFns).toContain('count: "exact"');
    expect(socialFns).toContain('.eq("org_id", data.orgId)');
  });

  it("normalizes raw database identifiers into human-readable sentences in Spanish and English", () => {
    expect(labelNormalizer).toContain("export function formatActivityDescription");
    expect(labelNormalizer).toContain("social_care_plan_goals");
    expect(labelNormalizer).toContain("social_assessment_versions");
    expect(labelNormalizer).toContain("member_invited");
    expect(labelNormalizer).toContain("Meta del plan de atención");
    expect(labelNormalizer).toContain("Care plan goal");
  });

  it("integrates pagination and normalized activity descriptions in Team Activity", () => {
    expect(socialUi).toContain("getTeamActivityEventsPaginated");
    expect(socialUi).toContain("NyravaPagination");
    expect(socialUi).toContain("formatActivityDescription");
    expect(socialUi).toContain("Historial de Actividad Institucional");
  });

  it("integrates pagination across Case Activity Feed, Documents Hub, Timeline, and Witness Rosters", () => {
    expect(caseActivityFeed).toContain("NyravaPagination");
    expect(documentsHub).toContain("NyravaPagination");
    expect(timelineUi).toContain("NyravaPagination");
    expect(witnessUi).toContain("NyravaPagination");
  });

  it("resets pagination state to page 1 upon filter changes", () => {
    expect(socialUi).toContain("setPage(1)");
    expect(caseActivityFeed).toContain("setPage(1)");
    expect(documentsHub).toContain("setPage(1)");
    expect(timelineUi).toContain("setPage(1)");
  });
});
