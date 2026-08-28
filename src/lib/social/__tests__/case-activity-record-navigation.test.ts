import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const feedSource = readFileSync(join(root, "src", "components", "social", "CaseActivityFeed.tsx"), "utf8");
const drawerSource = readFileSync(join(root, "src", "components", "social", "CaseActivityDrawerModal.tsx"), "utf8");
const workspaceSource = readFileSync(join(root, "src", "components", "social", "SocialCaseWorkspace.tsx"), "utf8");
const functionsSource = readFileSync(join(root, "src", "lib", "social.functions.ts"), "utf8");

describe("Case Activity Record Navigation & Interactive Feed", () => {
  it("defines friendly bilingual activity headlines instead of raw database table names", () => {
    // Spanish headlines
    expect(feedSource).toContain("Intervención registrada");
    expect(feedSource).toContain("Plan de atención creado");
    expect(feedSource).toContain("Evaluación de riesgo creada");
    expect(feedSource).toContain("Documento agregado");
    expect(feedSource).toContain("Alerta actualizada");
    expect(feedSource).toContain("Acceso a documento registrado");
    expect(feedSource).toContain("Caso actualizado");
    expect(feedSource).toContain("Canalización registrada");

    // English headlines
    expect(feedSource).toContain("Intervention recorded");
    expect(feedSource).toContain("Care Plan created");
    expect(feedSource).toContain("Risk Assessment created");
    expect(feedSource).toContain("Document added");
    expect(feedSource).toContain("Alert updated");
    expect(feedSource).toContain("Document access recorded");
    expect(feedSource).toContain("Case updated");
    expect(feedSource).toContain("Referral recorded");
  });

  it("extracts dynamic record context into activity subtitles", () => {
    expect(feedSource).toContain("getRecordSubtitle");
    expect(feedSource).toContain("social_interventions");
    expect(feedSource).toContain("social_care_plans");
    expect(feedSource).toContain("social_assessments");
    expect(feedSource).toContain("social_documents");
    expect(feedSource).toContain("social_alerts");
    expect(feedSource).toContain("social_document_access_events");
  });

  it("implements server functions for activity detail resolution and intervention management", () => {
    expect(functionsSource).toContain("export const getSocialActivityRecordDetail");
    expect(functionsSource).toContain("export const updateSocialIntervention");
    expect(functionsSource).toContain("export const deleteSocialIntervention");
    expect(functionsSource).toContain('entity_type: "social_interventions"');
    expect(functionsSource).toContain('event_type: "update"');
    expect(functionsSource).toContain('event_type: "delete"');
  });

  it("renders type-specific record view and protects immutable historical versions", () => {
    expect(drawerSource).toContain("social_interventions");
    expect(drawerSource).toContain("social_care_plans");
    expect(drawerSource).toContain("social_assessments");
    expect(drawerSource).toContain("social_documents");
    expect(drawerSource).toContain("social_alerts");
    expect(drawerSource).toContain("social_document_access_events");

    // Read only protection for historical versions
    expect(drawerSource).toContain("Las versiones del Plan de Atención son inmutables");
    expect(drawerSource).toContain("Evaluación inmutable");

    // Technical details collapsible for administrators
    expect(drawerSource).toContain("Detalles técnicos para administradores");
    expect(drawerSource).toContain("Technical details for administrators");
  });

  it("integrates CaseActivityFeed into SocialCaseWorkspace activity tab", () => {
    expect(workspaceSource).toContain("<CaseActivityFeed");
    expect(workspaceSource).toContain("activities={caseData.activity}");
    expect(workspaceSource).toContain("interventions={caseData.interventions}");
    expect(workspaceSource).toContain("plans={caseData.plans}");
    expect(workspaceSource).toContain("assessments={caseData.assessments}");
    expect(workspaceSource).toContain("documents={caseData.documents}");
  });

  it("supports deep-linking and in-context tab navigation", () => {
    expect(drawerSource).toContain("onNavigateTab");
    expect(drawerSource).toContain("targetTab");
    expect(feedSource).toContain("selectedActivityId");
  });
});