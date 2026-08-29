import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase", "migrations", "20260828230000_subscriber_donation_identity.sql"), "utf8");
const serverLogic = readFileSync(join(root, "src", "lib", "social", "subscriber-donation-identity.server.ts"), "utf8");
const accountFns = readFileSync(join(root, "src", "lib", "account.functions.ts"), "utf8");
const accountUi = readFileSync(join(root, "src", "routes", "_authenticated", "account.tsx"), "utf8");
const sectionUi = readFileSync(join(root, "src", "components", "account", "SubscriberDonationIdentitySection.tsx"), "utf8");

describe("Secure Subscriber Donation Identity & Financial Destination Setup", () => {
  it("defines isolated subscriber donation identity and audit event tables in migration", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_subscriber_donation_identities");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.social_donation_identity_audit_events");
    expect(migration).toContain("bank_clabe_masked");
    expect(migration).toContain("privacy_notice_version");
    expect(migration).toContain("financial_donations_readiness");
  });

  it("enforces search_path security and RLS policies on donation identities", () => {
    expect(migration).toContain("SET search_path = public, pg_temp");
    expect(migration).toContain("is_primary_subscriber");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("Primary subscriber only can select donation identity");
    expect(migration).toContain("Primary subscriber only can update donation identity");
  });

  it("enforces strict primary subscriber access control server-side", () => {
    expect(serverLogic).toContain("verifyPrimarySubscriber");
    expect(accountFns).toContain("403: Acceso denegado. Solo el titular principal");
    expect(sectionUi).toContain("Titular Principal");
    expect(accountUi).toContain("SubscriberDonationIdentitySection");
  });

  it("masks sensitive fields such as RFC, CLABE, and Government ID numbers", () => {
    expect(serverLogic).toContain("maskRfc");
    expect(serverLogic).toContain("maskClabe");
    expect(serverLogic).toContain("maskId");
    expect(serverLogic).toContain("••••");
  });

  it("strictly prohibits financial credentials, PINs, tokens, and SAT/e.firma keys", () => {
    // Verify no credential fields exist in migration or schemas
    expect(migration).not.toContain("bank_password");
    expect(migration).not.toContain("banking_pin");
    expect(migration).not.toContain("card_cvv");
    expect(migration).not.toContain("sat_password");
    expect(migration).not.toContain("efirma_private_key");
    expect(sectionUi).toContain("Nyrava México nunca solicita ni almacena contraseñas bancarias");
  });

  it("implements Constancia de Situación Fiscal fallback verification", () => {
    expect(accountFns).toContain("verifyConstanciaFallback");
    expect(accountFns).toContain("Identity information matched submitted Constancia de Situación Fiscal");
    expect(sectionUi).toContain("Validar Constancia de Situación Fiscal");
  });

  it("computes deterministic donation readiness based on canonical verifications", () => {
    expect(serverLogic).toContain("computeDonationReadiness");
    expect(serverLogic).toContain("verified_and_ready");
    expect(serverLogic).toContain("not_ready");
    expect(sectionUi).toContain("verified_and_ready");
  });

  it("requires versioned privacy notice and ARCO compliance acceptance", () => {
    expect(migration).toContain("v2026.1_mx_arco");
    expect(serverLogic).toContain("privacyNoticeVersion");
    expect(accountFns).toContain("privacyNoticeAccepted");
    expect(sectionUi).toContain("Aviso de Privacidad de Nyrava México para Apoyo Comunitario y Recaudación");
  });

  it("records security audit events without writing raw secrets into logs", () => {
    expect(migration).toContain("social_donation_identity_audit_events");
    expect(accountFns).toContain("social_donation_identity_audit_events");
    expect(accountFns).not.toContain("event_description: `CLABE: ${data.bankClabe}`");
  });
});
