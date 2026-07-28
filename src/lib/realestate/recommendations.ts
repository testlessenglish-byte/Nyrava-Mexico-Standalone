// Context-aware next-step recommendations for a real-estate transaction.
//
// Deterministic and evidence-driven: every recommendation is derived from the
// case's own state (property record, verification items, uploaded document
// filenames) — nothing is invented and no AI quota is spent. The AI assistant
// inside the verification workspace remains the place for reasoning about a
// document's *contents*; this layer answers the cheaper question an attorney
// asks constantly: "what am I still missing, and where do I go to get it?"

import type { OfficialResourceId } from "./official-resources";
import type { PropertyRecord, VerificationItem, VerificationCategory } from "@/lib/real-estate.functions";

export type RecommendationSeverity = "critical" | "warning" | "info";

export type Recommendation = {
  id: string;
  severity: RecommendationSeverity;
  /** i18n key: `re.rec.<id>` */
  messageKey: string;
  /** Optional interpolation values for the message. */
  values?: Record<string, string>;
  /** Verification item this recommendation should open, when applicable. */
  category?: VerificationCategory;
  /** Official source that resolves this recommendation. */
  resource?: OfficialResourceId;
  /** Direct deep link, overrides the resource's default URL. */
  url?: string;
};

export type RecommendationInput = {
  property: PropertyRecord | null;
  verification: VerificationItem[];
  documents: Array<{ filename: string }>;
};

const RFC_PATTERN = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/;

function matches(documents: Array<{ filename: string }>, re: RegExp): boolean {
  return documents.some((d) => re.test(d.filename.toLowerCase()));
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const { property, verification, documents } = input;
  const byCat = new Map(verification.map((v) => [v.category, v]));
  const out: Recommendation[] = [];

  const isSettled = (cat: VerificationCategory) => byCat.get(cat)?.status === "verified";
  const hasEvidence = (cat: VerificationCategory) => Boolean(byCat.get(cat)?.evidence_document_id);

  const hasTitle = matches(documents, /escritura|titulo|título|compraventa|contrato/);
  const hasRegistryCert = matches(documents, /libertad|gravamen|certificado|rpp|registro/);
  const hasPredial = matches(documents, /predial|catastr/);
  const hasMortgageRelease = matches(documents, /cancelaci[oó]n|liberaci[oó]n|hipoteca/);
  const hasPoa = matches(documents, /poder|notarial|mandato/);
  const hasId = matches(documents, /ine|curp|acta|identificaci[oó]n|pasaporte/);

  // --- Registry -------------------------------------------------------------
  if (!isSettled("registry") && !hasRegistryCert) {
    out.push({
      id: property?.folio_real ? "registryFromFolio" : "registrySearch",
      severity: "critical",
      messageKey: property?.folio_real ? "re.rec.registryFromFolio" : "re.rec.registrySearch",
      values: property?.folio_real ? { folio: property.folio_real } : undefined,
      category: "registry",
      resource: "rpp_federal",
    });
  }
  if (hasTitle && !hasRegistryCert) {
    out.push({
      id: "titleWithoutCertificate",
      severity: "warning",
      messageKey: "re.rec.titleWithoutCertificate",
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
      values: place ? { place } : undefined,
      resource: "notarios_nacionales",
    });
  }

  // --- Predial / catastro ---------------------------------------------------
  if (!hasPredial && !hasEvidence("predial")) {
    out.push({
      id: "predialMissing",
      severity: "warning",
      messageKey: "re.rec.predialMissing",
      category: "predial",
    });
  }

  // --- Mortgage -------------------------------------------------------------
  const mortgage = byCat.get("mortgage");
  if ((mortgage?.status === "issue_found" || !hasMortgageRelease) && !isSettled("mortgage")) {
    out.push({
      id: "mortgageReleaseMissing",
      severity: mortgage?.status === "issue_found" ? "critical" : "info",
      messageKey: "re.rec.mortgageReleaseMissing",
      category: "mortgage",
      resource: "rpp_federal",
    });
  }

  // --- Power of attorney / corporate authority ------------------------------
  if (hasPoa) {
    out.push({
      id: "verifyPoa",
      severity: "warning",
      messageKey: "re.rec.verifyPoa",
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
      resource: "registro_civil",
    });
  }

  // --- Foreign buyer / fideicomiso ------------------------------------------
  if (property?.foreign_buyer && !property.fideicomiso) {
    out.push({
      id: "foreignBuyerFideicomiso",
      severity: "critical",
      messageKey: "re.rec.foreignBuyerFideicomiso",
    });
  }

  // --- Federal-patrimony notary shortcut ------------------------------------
  if (property?.notary) {
    out.push({
      id: "confirmNotaryDirectory",
      severity: "info",
      messageKey: "re.rec.confirmNotaryDirectory",
      values: { notary: property.notary },
      resource: "notarios_federales",
    });
  }

  const order: Record<RecommendationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
