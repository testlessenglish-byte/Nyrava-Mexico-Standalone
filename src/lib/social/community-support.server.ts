import { randomBytes } from "node:crypto";

export const SUPPORT_CATEGORIES = [
  "financial_support",
  "food",
  "clothing",
  "housing",
  "school_supplies",
  "medical_health",
  "transportation",
  "furniture_household",
  "baby_supplies",
  "employment",
  "professional_services",
  "other_material",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUBSCRIBER_ADMIN_ROLES = [
  "owner",
  "admin",
  "organization_owner",
  "program_director",
  "case_management_supervisor",
];

export function isSubscriberOrAdmin(role?: string | null): boolean {
  if (!role) return false;
  return SUBSCRIBER_ADMIN_ROLES.includes(role.toLowerCase());
}

export function generatePublicSlug(): string {
  // Non-guessable 16-character alphanumeric slug
  return randomBytes(10).toString("hex");
}

export function sanitizePublicCampaign(campaign: any, profile: any, offers: any[] = []) {
  if (!campaign || campaign.lifecycle_status !== "published") {
    return null;
  }

  // Count fulfilled offers
  const receivedOffers = (offers || []).filter((o: any) => o.status === "received");

  return {
    publicId: campaign.public_slug,
    title: campaign.title,
    publicDescription: campaign.public_description,
    organizationName: profile?.legal_name || "Organización de Atención Integral",
    state: profile?.state || campaign.location_display || "México",
    categories: campaign.support_categories || [],
    urgency: campaign.urgency || "normal",
    displayName: campaign.public_display_name || (campaign.campaign_scope === "organization_wide" ? "Campaña Institucional" : "Familia en Atención"),
    locationDisplay: campaign.location_display || "México",
    financialFundraiserProvider: campaign.financial_fundraiser_provider || "gofundme",
    financialFundraiserUrl: campaign.financial_fundraiser_url || null,
    financialTargetAmount: campaign.financial_target_amount || null,
    financialCurrency: campaign.financial_currency || "MXN",
    taxDeductibleStatus: profile?.tax_deductible_status || "not_verified",
    offersCount: (offers || []).length,
    receivedCount: receivedOffers.length,
    publishedAt: campaign.published_at,
  };
}

export function buildPublicSafeDraft(caseData: any, scope: "individual_case" | "organization_wide" = "individual_case", lang: "es" | "en" = "es") {
  const c = caseData?.case || {};
  const p = caseData?.person || {};
  const loc = [p.municipality, p.state].filter(Boolean).join(", ") || (lang === "es" ? "México" : "Mexico");

  if (scope === "organization_wide") {
    return {
      title: lang === "es" ? "Apoyo para Familias en Atención Integral" : "Support Families Receiving Comprehensive Care",
      publicDescription: lang === "es"
        ? "Ayúdanos a brindar alimentos, transporte de emergencia, alojamiento temporal y asistencia esencial a familias en situación de vulnerabilidad que reciben atención integral."
        : "Help us provide food, emergency transportation, temporary housing, and essential assistance to vulnerable families receiving comprehensive care.",
      supportCategories: ["financial_support", "food", "clothing", "housing", "transportation"],
      publicIdentityMode: "organization_wide",
      publicDisplayName: lang === "es" ? "Campaña Institucional" : "Organization Campaign",
      locationDisplay: loc,
      urgency: "normal",
    };
  }

  // Individual / Family campaign
  const isFamily = Boolean(caseData?.family || c.case_type === "family");
  const defaultDisplayName = isFamily
    ? (lang === "es" ? `Familia en ${loc}` : `Family in ${loc}`)
    : (lang === "es" ? `Persona en ${loc}` : `Individual in ${loc}`);

  return {
    title: lang === "es" ? `Apoyo para una ${isFamily ? "familia" : "persona"} en ${loc}` : `Support for a ${isFamily ? "family" : "person"} in ${loc}`,
    publicDescription: lang === "es"
      ? `Una ${isFamily ? "familia" : "persona"} en ${loc} se encuentra actualmente recibiendo atención integral y requiere apoyo comunitario para cubrir necesidades esenciales de subsistencia, vivienda y bienestar.`
      : `A ${isFamily ? "family" : "person"} in ${loc} is currently receiving comprehensive care and requires community support for essential subsistence, housing, and well-being.`,
    supportCategories: ["food", "clothing", "housing", "medical_health"],
    publicIdentityMode: "anonymous",
    publicDisplayName: defaultDisplayName,
    locationDisplay: loc,
    urgency: c.priority === "emergency" || c.priority === "urgent" ? "high" : "normal",
  };
}
