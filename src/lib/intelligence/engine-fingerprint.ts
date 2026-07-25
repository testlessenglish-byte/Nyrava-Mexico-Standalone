// Engine version registry — Phase 6.5.
//
// Every engine gets a semantic version. Bump when the engine's business
// logic, prompt template, or output schema changes so replay records
// captured on a prior version can be identified as stale.
//
// Keep this file dependency-free (no server imports) so it can be read from
// tests and both client/server bundles without ordering issues.

export const ENGINE_VERSIONS: Record<string, string> = {
  theory: "1.0.0",
  opportunity: "1.0.0",
  witness_intelligence: "1.0.0",
  trial_prep: "1.0.0",
  strategy: "1.0.0",
  work_product: "1.0.0",
  perspectives: "1.0.0",
  evidence_intelligence: "1.0.0",
  discovery_gaps: "1.0.0",
  contradictions: "1.0.0",
  evidence_map: "1.0.0",
  constitutional_compliance: "1.0.0",
  hallucination: "1.0.0",
};

export function engineVersion(engine: string): string {
  return ENGINE_VERSIONS[engine] ?? "0.0.0";
}
