// Extension point for future official-data connectors.
//
// The Transaction Center renders whatever this registry declares, so a new
// state Registro Público, municipal Catastro, predial payment check, utility
// "no adeudo" lookup, land-use or environmental service can be added here —
// with a `fetchStatus` implementation and `status: "available"` — and the
// dashboard starts using it with no UI change.

import type { VerificationCategory } from "@/lib/real-estate.functions";
import type { PropertyRecord } from "@/lib/real-estate.functions";

export type ConnectorId =
  | "rpp_state"
  | "catastro_municipal"
  | "predial_payment"
  | "water_noadeudo"
  | "land_use"
  | "environmental_check";

export type ConnectorResult = {
  /** Free-form human-readable finding, already localized by the connector. */
  message: string;
  satisfied: boolean;
};

export type Connector = {
  id: ConnectorId;
  category: VerificationCategory;
  status: "available" | "planned";
  /** Present only when `status === "available"`. */
  fetchStatus?: (property: PropertyRecord) => Promise<ConnectorResult>;
  /** Restricts the connector to the states/municipalities it actually covers. */
  covers?: (property: PropertyRecord) => boolean;
};

export const CONNECTORS: Connector[] = [
  { id: "rpp_state", category: "registry", status: "planned" },
  { id: "catastro_municipal", category: "catastro", status: "planned" },
  { id: "predial_payment", category: "predial", status: "planned" },
  { id: "water_noadeudo", category: "water", status: "planned" },
  { id: "land_use", category: "permits", status: "planned" },
  { id: "environmental_check", category: "environmental", status: "planned" },
];

/** Connectors that can actually answer for this property right now. */
export function activeConnectors(property: PropertyRecord | null): Connector[] {
  if (!property) return [];
  return CONNECTORS.filter(
    (c) => c.status === "available" && c.fetchStatus && (!c.covers || c.covers(property)),
  );
}

export function connectorsFor(category: VerificationCategory): Connector[] {
  return CONNECTORS.filter((c) => c.category === category);
}
