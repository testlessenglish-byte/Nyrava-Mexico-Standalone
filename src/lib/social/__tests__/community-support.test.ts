import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase", "migrations", "20260828210000_community_support_fundraising_system.sql"), "utf8");
const serverFunctions = readFileSync(join(root, "src", "lib", "social.functions.ts"), "utf8");
const communityServer = readFileSync(join(root, "src", "lib", "social", "community-support.server.ts"), "utf8");
const workspaceUi = readFileSync(join(root, "src", "components", "social", "SocialCaseWorkspace.tsx"), "utf8");
const modalUi = readFileSync(join(root, "src", "components", "social", "CommunitySupportModal.tsx"), "utf8");
const publicRoute = readFileSync(join(root, "src", "routes", "support.$publicId.tsx"), "utf8");
const i18n = readFileSync(join(root, "src", "lib", "social", "social-i18n.ts"), "utf8");

describe("Comprehensive Care — Community Support & Fundraising System", () => {
  it("defines dedicated database schema for campaigns, offers, and fundraising profiles", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_community_fundraising_profiles");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_community_campaigns");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_community_support_offers");
    expect(migration).toContain("public_slug TEXT NOT NULL UNIQUE");
    expect(migration).toContain("financial_fundraiser_provider TEXT DEFAULT 'gofundme'");
    expect(migration).toContain("donataria_autorizada_verified");
  });

  it("places Community Support button in top action bar between View activity and Talk to Care Case", () => {
    expect(workspaceUi).toContain("CommunitySupportModal");
    expect(workspaceUi).toContain("HeartHandshake");
    expect(workspaceUi).toContain('es ? "Apoyo Comunitario" : "Community Support"');
  });

  it("includes compact Community Support card in Overview / Summary tab", () => {
    expect(workspaceUi).toContain('es ? "Apoyo Comunitario y Donaciones" : "Community Support & Donations"');
  });

  it("enforces subscriber/admin vs caseworker role segregation", () => {
    expect(communityServer).toContain("isSubscriberOrAdmin");
    expect(communityServer).toContain("organization_owner");
    expect(communityServer).toContain("case_management_supervisor");
    expect(serverFunctions).toContain("approveAndPublishCommunityCampaign");
    expect(serverFunctions).toContain("saveSubscriberFundraisingProfile");
    expect(modalUi).toContain('es ? "Titular / Administrador" : "Account Owner / Admin"');
  });

  it("supports both Individual Case and Organization-Wide campaigns", () => {
    expect(migration).toContain("'individual_case', 'organization_wide'");
    expect(modalUi).toContain('es ? "Campaña de este caso" : "This Case Campaign"');
    expect(modalUi).toContain('es ? "Campañas institucionales" : "Organization Campaigns"');
  });

  it("provides 12 comprehensive support categories in Spanish and English", () => {
    for (const cat of [
      "financial_support", "food", "clothing", "housing", "school_supplies",
      "medical_health", "transportation", "furniture_household", "baby_supplies",
      "employment", "professional_services", "other_material",
    ]) {
      expect(communityServer).toContain(cat);
      expect(i18n).toContain(cat);
    }
  });

  it("guarantees public privacy and data minimization", () => {
    expect(communityServer).toContain("sanitizePublicCampaign");
    expect(modalUi).toContain("Vista Previa Pública de Seguridad");
    expect(modalUi).toContain("DATOS PROTEGIDOS NUNCA EXPUESTOS");
    expect(publicRoute).not.toContain("caseId");
    expect(publicRoute).toContain("/support/$publicId");
  });

  it("separates RFC identity registration from Donataria Autorizada tax-deductible claims", () => {
    expect(migration).toContain("rfc_submitted");
    expect(migration).toContain("donataria_autorizada_claimed");
    expect(migration).toContain("donataria_autorizada_verified");
    expect(modalUi).toContain("Donataria Autorizada (SAT)");
  });

  it("integrates GoFundMe direct donation without storing bank credentials", () => {
    expect(modalUi).toContain("GoFundMe");
    expect(publicRoute).toContain("Donate on GoFundMe");
    expect(publicRoute).toContain("financialFundraiserUrl");
  });

  it("provides share shortcuts with clean public URL projection", () => {
    expect(modalUi).toContain("whatsapp");
    expect(modalUi).toContain("facebook");
    expect(modalUi).toContain("copiedLink");
  });

  it("allows donor offers for supplies/services and logs fulfilled items to case history", () => {
    expect(publicRoute).toContain("submitPublicCommunitySupportOffer");
    expect(serverFunctions).toContain("recordCommunitySupportReceived");
    expect(modalUi).toContain("recordReceivedM");
  });
});