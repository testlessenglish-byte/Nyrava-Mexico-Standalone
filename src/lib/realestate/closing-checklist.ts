// Closing progress — the single source of truth for "how far is this
// transaction from being closeable?".
//
// Every row is derived from the case's own state: the property record, the
// verification items the attorney has worked, and the instruments detected in
// the uploaded documents (OCR-aware, see document-detection.ts). Rows flip to
// satisfied automatically, which is what makes the percentage move without
// anyone maintaining a checklist by hand.

import type { PropertyRecord, VerificationItem, VerificationCategory } from "@/lib/real-estate.functions";
import type { DocumentKind, DetectedDocument } from "./document-detection";
import { detectionMap } from "./document-detection";
import type { OfficialResourceId } from "./official-resources";

export const RFC_PATTERN = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/;

export type ChecklistKey =
  | "property_verification"
  | "registry_search"
  | "seller_identity"
  | "buyer_identity"
  | "rfc_verification"
  | "notary_assigned"
  | "predial_receipt"
  | "mortgage_release"
  | "catastro_record"
  | "utility_clearance"
  | "corporate_authority"
  | "fideicomiso";

export type ChecklistRow = {
  key: ChecklistKey;
  satisfied: boolean;
  /** Requirement this row opens in the Verification Center, when applicable. */
  category?: VerificationCategory;
  /** Official portal where the missing piece is obtained. */
  resource?: OfficialResourceId;
  /** Document kind that satisfies this row, when it is document-based. */
  kind?: DocumentKind;
  /** Filename of the evidence that satisfied the row. */
  evidence?: string;
  /** True when the evidence was recognised from OCR text rather than the filename. */
  fromText?: boolean;
};

export type ClosingProgress = {
  rows: ChecklistRow[];
  satisfied: number;
  total: number;
  percent: number;
};

export type PropertyFileState = {
  property: PropertyRecord | null;
  verification: VerificationItem[];
  detected: DetectedDocument[];
};

export function buildClosingProgress(state: PropertyFileState): ClosingProgress {
  const { property, verification, detected } = state;
  const byCat = new Map(verification.map((v) => [v.category, v]));
  const docs = detectionMap(detected);

  const verified = (c: VerificationCategory) => byCat.get(c)?.status === "verified";
  const has = (k: DocumentKind) => docs.has(k);

  const row = (
    key: ChecklistKey,
    satisfied: boolean,
    extra: Omit<ChecklistRow, "key" | "satisfied"> = {},
  ): ChecklistRow => {
    const hit = extra.kind ? docs.get(extra.kind) : undefined;
    return {
      key,
      satisfied,
      ...extra,
      evidence: hit?.filename,
      fromText: hit?.matchedOn === "text",
    };
  };

  const rows: ChecklistRow[] = [
    row("property_verification", verified("ownership") || has("deed"), {
      category: "ownership",
      kind: "deed",
    }),
    row("registry_search", verified("registry") || has("registry_certificate"), {
      category: "registry",
      kind: "registry_certificate",
      resource: "rpp_federal",
    }),
    row("seller_identity", Boolean(property?.seller_name) && has("identity"), {
      kind: "identity",
      resource: "registro_civil",
    }),
    row("buyer_identity", Boolean(property?.buyer_name) && has("identity"), {
      kind: "identity",
      resource: "registro_civil",
    }),
    row(
      "rfc_verification",
      RFC_PATTERN.test(property?.seller_name ?? "") || RFC_PATTERN.test(property?.buyer_name ?? ""),
      { resource: "sat" },
    ),
    row("notary_assigned", Boolean(property?.notary), { resource: "notarios_nacionales" }),
    row("predial_receipt", verified("predial") || has("predial_receipt"), {
      category: "predial",
      kind: "predial_receipt",
    }),
    row("mortgage_release", verified("mortgage") || has("mortgage_release"), {
      category: "mortgage",
      kind: "mortgage_release",
      resource: "rpp_federal",
    }),
    row("catastro_record", verified("catastro") || has("catastro") || Boolean(property?.catastro_id), {
      category: "catastro",
      kind: "catastro",
    }),
    row(
      "utility_clearance",
      (verified("water") || has("water_clearance")) && (verified("cfe") || has("cfe_clearance")),
      { category: "water" },
    ),
  ];

  // Conditional rows — only relevant to some transactions.
  if (has("power_of_attorney") || byCat.has("corporate_authority")) {
    rows.push(
      row("corporate_authority", verified("corporate_authority"), {
        category: "corporate_authority",
        kind: "power_of_attorney",
        resource: "notarios_nacionales",
      }),
    );
  }
  if (property?.foreign_buyer) {
    rows.push(row("fideicomiso", Boolean(property.fideicomiso)));
  }

  const satisfied = rows.filter((r) => r.satisfied).length;
  const total = rows.length;
  return {
    rows,
    satisfied,
    total,
    percent: total === 0 ? 0 : Math.round((satisfied / total) * 100),
  };
}
