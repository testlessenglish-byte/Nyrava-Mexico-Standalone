// DB-backed connector configuration — the "enabled: true/false per source,
// no code changes needed to add a state" requirement from Phase 20.
//
// public.legal_source_connectors is the config layer (which sources exist,
// enabled/disabled, sync schedule). src/lib/legal-connectors/types.ts's
// IMPLEMENTED_CONNECTORS is the code layer (which ones actually have a
// working implementation). A connector can be enabled in the DB before its
// code exists — getEnabledConnectors() below only returns the intersection
// of "enabled in DB" AND "actually implemented", so turning on a
// not-yet-built source in config is safe (it just won't run) rather than
// crashing the scheduler.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { IMPLEMENTED_CONNECTORS, type LegalSourceConnector } from "./types";

type Db = SupabaseClient<Database>;

export type ConnectorConfigRow = {
  code: string;
  name: string;
  status: string; // "planned" | "active" | "paused" | "error"
  last_sync_at: string | null;
};

export async function getConnectorConfigs(db: Db): Promise<ConnectorConfigRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("legal_source_connectors")
    .select("code,name,status,last_sync_at")
    .order("code");
  if (error) throw new Error(`Failed to load connector configs: ${error.message}`);
  return (data ?? []) as ConnectorConfigRow[];
}

/** Sources enabled in the DB config AND actually implemented in code. */
export async function getEnabledConnectors(db: Db): Promise<LegalSourceConnector[]> {
  const configs = await getConnectorConfigs(db);
  const enabledCodes = new Set(configs.filter((c) => c.status === "active").map((c) => c.code));
  return IMPLEMENTED_CONNECTORS.filter((c) => enabledCodes.has(c.code));
}

export async function setConnectorStatus(
  db: Db,
  code: string,
  status: "planned" | "active" | "paused" | "error",
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("legal_source_connectors").update({ status }).eq("code", code);
  if (error) throw new Error(`Failed to update connector status for ${code}: ${error.message}`);
}
