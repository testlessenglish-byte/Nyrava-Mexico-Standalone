// Context-aware next-step recommendations for a real-estate transaction.
//
// Deterministic and evidence-driven: every recommendation is derived from the
// case's own state (property record, verification items, and the instruments
// actually detected inside the uploaded documents) — nothing is invented and
// no AI quota is spent. A recommendation disappears the moment the thing it
// asks for exists, which is what makes this an assistant rather than a static
// checklist.

import type { OfficialResourceId } from "./official-resources";
import type { VerificationCategory } from "@/lib/real-estate.functions";
import { detectionMap } from "./document-detection";
import { RFC_PATTERN, type PropertyFileState } from "./closing-checklist";

export type RecommendationSeverity = "critical" | "warning" | "info";

export type Recommendation = {
  id: string;
  severity: RecommendationSeverity;
  /** i18n key: `re.rec.<id>` */
  messageKey: string;
  /** i18n key explaining why the missing piece matters. */
  whyKey?: string;
  /** Optional interpolation values for the message. */
  values?: Record<string, string>;
  /** Verification item this recommendation should open, when applicable. */
  category?: VerificationCategory;
  /** Official source that resolves this recommendation. */
  resource?: OfficialResourceId;
  /** Direct deep link, overrides the resource's default URL. */
  url?: string;
};

export type RecommendationInput = PropertyFileState;

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const { property, verification, detected } = input;
  const byCat = new Map(verification.map((v) => [v.category, v]));
  const docs = detectionMap(detected);
  const out: Recommendation[] = [];

  const isSettled = (cat: VerificationCategory) => byCat.get(cat)?.status === "verified";
  const hasEvidence = (cat: VerificationCategory) => Boolean(byCat.get(cat)?.evidence_document_id);

  const hasDeed = docs.has("deed");
  const hasRegistryCert = docs.has("registry_certificate");
  const hasPredial = docs.has("predial_receipt");
  const hasMortgageRelease = docs.has("mortgage_release");
  const hasPoa = docs.has("power_of_attorney");
  const hasId = docs.has("identity");

  // --- Ownership ------------------------------------------------------------
  if (!isSettled("ownership") && !hasDeed) {
    out.push({
      id: "ownershipUnverified",
      severity: "critical",
      messageKey: "re.rec.ownershipUnverified",
      whyKey: "re.rec.why.ownershipUnverified",
      category: "ownership",
      resource: "rpp_federal",
    });
  }

  // --- Registry -------------------------------------------------------------
  if (!isSettled("registry") && !hasRegistryCert) {
    out.push({
      id: property?.folio_real ? "registryFromFolio" : "registrySearch",
      severity: "critical",
      messageKey: property?.folio_real ? "re.rec.registryFromFolio" : "re.rec.registrySearch",
      whyKey: "re.rec.why.registry",
      values: property?.folio_real ? { folio: property.folio_real } : undefined,
      category: "registry",
      resource: "rpp_federal",
    });
  }
  if (hasDeed && !hasRegistryCert && !isSettled("registry")) {
    out.push({
      id: "titleWithoutCertificate",
      severity: "warning",
      messageKey: "re.rec.titleWithoutCertificate",
      whyKey: "re.rec.why.registry",
      category: "registry",
      resource: "rpp_federal",
    });
  }

  // --- SAT / RFC ------------------------------------------------------------
  const sellerHasRfc = RFC_PATTERN.test(property?.seller_name ?? "");
  if (property?.seller_name && !sellerHasRfc) {
    out.push({
      id: "verifySellerRfc",
      severity: "warning",
      messageKey: "re.rec.verifySellerRfc",
      whyKey: "re.rec.why.rfc",
      values: { party: property.seller_name },
      resource: "sat",
      url: "https://portalsat.plataforma.sat.gob.mx/ConsultaRFC/",
    });
  }
  if (property?.purchase_price && property.purchase_price > 0) {
    out.push({
      id: "validateCfdi",
      severity: "info",
      messageKey: "re.rec.validateCfdi",
      whyKey: "re.rec.why.cfdi",
      resource: "sat",
      url: "https://verificacfdi.facturaelectronica.sat.gob.mx/",
    });
  }

  // --- Notary ---------------------------------------------------------------
  if (!property?.notary) {
    const place = property?.municipality || property?.state || null;
    out.push({
      id: place ? "locateNotaryIn" : "noNotaryAssigned",
      severity: "warning",
      messageKey: place ? "re.rec.locateNotaryIn" : "re.rec.noNotaryAssigned",
      whyKey: "re.rec.why.notary",
      values: place ? { place } : undefined,
      resource: "notarios_nacionales",
    });
  } else {
    out.push({
      id: "confirmNotaryDirectory",
      severity: "info",
      messageKey: "re.rec.confirmNotaryDirectory",
      values: { notary: property.notary },
      resource: "notarios_federales",
    });
  }

  // --- Predial / catastro ---------------------------------------------------
  if (!hasPredial && !hasEvidence("predial") && !isSettled("predial")) {
    out.push({
      id: "predialMissing",
      severity: "warning",
      messageKey: "re.rec.predialMissing",
      whyKey: "re.rec.why.predial",
      category: "predial",
    });
  }
  if (!docs.has("catastro") && !property?.catastro_id && !isSettled("catastro")) {
    out.push({
      id: "catastroMissing",
      severity: "info",
      messageKey: "re.rec.catastroMissing",
      whyKey: "re.rec.why.catastro",
      category: "catastro",
    });
  }

  // --- Mortgage -------------------------------------------------------------
  const mortgage = byCat.get("mortgage");
  if (!hasMortgageRelease && !isSettled("mortgage")) {
    out.push({
      id: "mortgageReleaseMissing",
      severity: mortgage?.status === "issue_found" ? "critical" : "info",
      messageKey: "re.rec.mortgageReleaseMissing",
      whyKey: "re.rec.why.mortgage",
      category: "mortgage",
      resource: "rpp_federal",
    });
  }

  // --- Power of attorney / corporate authority ------------------------------
  if (hasPoa && !isSettled("corporate_authority")) {
    out.push({
      id: "verifyPoa",
      severity: "warning",
      messageKey: "re.rec.verifyPoa",
      whyKey: "re.rec.why.poa",
      category: "corporate_authority",
      resource: "notarios_nacionales",
    });
  }

  // --- Identity -------------------------------------------------------------
  if (!hasId) {
    out.push({
      id: "identityVerification",
      severity: "info",
      messageKey: "re.rec.identityVerification",
      whyKey: "re.rec.why.identity",
      resource: "registro_civil",
    });
  }

  // --- Utilities ------------------------------------------------------------
  if (!docs.has("water_clearance") && !isSettled("water")) {
    out.push({
      id: "waterClearanceMissing",
      severity: "info",
      messageKey: "re.rec.waterClearanceMissing",
      whyKey: "re.rec.why.utilities",
      category: "water",
    });
  }

  // --- Foreign buyer / fideicomiso ------------------------------------------
  if (property?.foreign_buyer && !property.fideicomiso) {
    out.push({
      id: "foreignBuyerFideicomiso",
      severity: "critical",
      messageKey: "re.rec.foreignBuyerFideicomiso",
      whyKey: "re.rec.why.fideicomiso",
    });
  }

  const order: Record<RecommendationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Official portals worth surfacing for the current state of this file. */
export function relevantResources(recs: Recommendation[]): OfficialResourceId[] {
  const ids = new Set<OfficialResourceId>();
  for (const r of recs) if (r.resource) ids.add(r.resource);
  return [...ids];
}
