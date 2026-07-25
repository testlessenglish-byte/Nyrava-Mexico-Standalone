// Server-only agent output accounting.
// This is the audit source that separates "loaded" from "executed" from
// "produced" so reports cannot count initialized agents as productive work.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AGENT_DEFINITIONS, type AgentDefinition, type AgentJson, type AgentResult } from "./types";

type Db = SupabaseClient<Database>;

export type AgentOutputStats = {
  agent_key: string;
  agent_name: string;
  primary_function: string;
  loaded: boolean;
  executed: boolean;
  produced: boolean;
  status: string;
  documents_analyzed: number;
  findings_generated: number;
  findings_suppressed: number;
  findings_promoted: number;
  visible_findings: number;
  output_items: number;
  duration_ms: number;
  no_output_reason: string | null;
  suppression_rate: number;
};

export type AgentStatisticsReport = {
  generated_at: string;
  definitions: {
    loaded: number;
    executed: number;
    producing_output: number;
    producing_findings: number;
    suppressed_findings: number;
    visible_findings: number;
  };
  rows: AgentOutputStats[];
};

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0;
}

const AGENT_ENGINE_MAP: Record<string, string[]> = {
  intake: [],
  ocr: ["extraction", "ocr"],
  entities: [
    "analyzers",
    "fact_extraction",
    "analyzer_contradictions",
    "analyzer_discovery_gaps",
    "analyzer_evidence_intelligence",
  ],
  timeline: ["timeline"],
  evidence: ["evidence_intelligence", "evidence_map", "analyzer_evidence_intelligence", "analyzer_discovery_gaps"],
  contradictions: ["contradictions", "analyzer_contradictions"],
  legal: [
    "agents",
    "constitutional_compliance",
    "chain_of_custody",
    "cross_examination",
    "trial_prep",
    "theory",
    "strategy",
    "opportunity",
    "motion",
  ],
  risk: ["scoring", "ess_validator"],
  report: ["report_generator"],
  qa: ["report_validator", "claim_validator"],
  judge: ["report_validator"],
  hallucination: ["hallucination", "claim_validator"],
  orchestrator: [],
};

function findingMatchesAgent(agentKey: string, f: Record<string, unknown>): boolean {
  const source = String(f.source_module ?? "").toLowerCase();
  const category = String(f.category ?? "").toLowerCase();
  const meta = asObj(f.metadata);
  const raw = JSON.stringify(meta).toLowerCase();
  switch (agentKey) {
    case "entities":
      return source.startsWith("analyzer:") || source.includes(":fact") || category === "fact" || category === "entity";
    case "timeline":
      return (
        source.startsWith("engine:timeline") || category === "timeline" || source.includes("timeline_inconsistency")
      );
    case "evidence":
      return (
        source.includes("evidence_intelligence") ||
        source.includes("evidence_map") ||
        source.includes("discovery_gap") ||
        raw.includes("evidence_intelligence") ||
        ["evidence", "chain_of_custody", "discovery_gap", "missing_evidence", "weak", "weak_evidence"].includes(
          category,
        )
      );
    case "contradictions":
      return source.includes("contradiction") || category === "contradiction";
    case "legal":
      return (
        source.startsWith("agent:") ||
        source.includes("constitutional") ||
        source.includes("chain_of_custody") ||
        source.includes("cross_examination") ||
        source.includes("trial_prep") ||
        source.startsWith("engine:theory") ||
        source.startsWith("engine:strategy") ||
        source.startsWith("engine:opportunity") ||
        source.startsWith("engine:motion")
      );
    case "risk":
      return source.includes("scoring") || category === "risk";
    default:
      return false;
  }
}

// --- Exclusive finding -> agent assignment --------------------------------
// findingMatchesAgent() checks are independent per agent and NOT mutually
// exclusive. A promoted "timeline_inconsistency" finding has source_module
// "engine:evidence_intelligence:timeline_inconsistency", which matches BOTH
// the "timeline" branch (via the timeline_inconsistency substring) AND the
// "evidence" branch (via the evidence_intelligence substring). Calling
// findingMatchesAgent() separately per agent therefore double-counts that
// finding across two agents, which inflates both agents' generated/promoted
// counts and is exactly what causes an agent's own card (e.g. Contradiction
// Detection) to stop reconciling with the aggregate cover-page / Agent
// Statistics totals: the sum of per-agent counts no longer equals the
// actual number of distinct findings once any finding is claimed twice.
//
// Fix: assign every finding to exactly ONE agent by walking a fixed
// priority order and taking the first match. Order matters — more specific
// signals (an actual contradiction, a timeline-specific issue) must be
// checked before the generic "evidence_intelligence" catch-all, or the
// catch-all would win purely by chance of iteration order rather than by
// specificity.
const AGENT_MATCH_PRIORITY: string[] = ["contradictions", "timeline", "evidence", "entities", "legal", "risk"];

function classifyFindingAgent(f: Record<string, unknown>): string | null {
  for (const key of AGENT_MATCH_PRIORITY) {
    if (findingMatchesAgent(key, f)) return key;
  }
  return null;
}

function outputItemCount(agentKey: string, output: unknown): number {
  const o = asObj(output);
  const stats = asObj(o.agent_stats);
  if (stats.output_items != null) return n(stats.output_items);
  switch (agentKey) {
    case "intake":
      return n(o.file_count);
    case "ocr":
      return n(o.pages_extracted);
    case "entities":
      return n(o.findings_count);
    case "timeline":
      return n(o.total) || n(o.dated) || n(o.timeline_events);
    case "evidence":
      return n(o.classifications) || n(o.total) || n(o.promoted_findings);
    case "contradictions":
      return asArr(o.contradictions).length || n(o.total);
    case "legal":
      return n(o.agent_findings);
    case "risk":
      return Object.keys(o).length ? 1 : 0;
    case "report":
      return o.case_id ? 1 : 0;
    case "qa":
      return o.pass != null ? 1 : 0;
    case "judge":
      return o.verdict ? 1 : 0;
    case "hallucination":
      return o.total != null ? 1 : 0;
    case "orchestrator":
      return o.run_id ? 1 : 0;
    default:
      return 0;
  }
}

async function countDocs(db: Db, caseId: string) {
  const [{ count: docs }, { count: extracted }, { count: pages }] = await Promise.all([
    db.from("documents").select("id", { count: "exact", head: true }).eq("case_id", caseId),
    db.from("documents").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("status", "extracted"),
    db.from("document_pages").select("id", { count: "exact", head: true }).eq("case_id", caseId),
  ]);
  return { docs: docs ?? 0, extracted: extracted ?? 0, pages: pages ?? 0 };
}

export async function attachAgentStats(
  db: Db,
  caseId: string,
  def: AgentDefinition,
  result: AgentResult,
  startedAtMs: number,
): Promise<AgentResult> {
  const stats = await buildSingleAgentStats(db, caseId, def, result, startedAtMs);
  return {
    ...result,
    output: {
      ...asObj(result.output),
      agent_stats: stats as unknown as Record<string, unknown>,
    } as AgentJson,
  };
}

async function buildSingleAgentStats(
  db: Db,
  caseId: string,
  def: AgentDefinition,
  result: AgentResult,
  startedAtMs: number,
): Promise<AgentOutputStats> {
  const [{ extracted, docs }, { data: findings }, { data: runs }] = await Promise.all([
    countDocs(db, caseId),
    db.from("case_findings").select("source_module,category,metadata").eq("case_id", caseId),
    db
      .from("pipeline_engine_runs")
      .select(
        "engine,status,generated,accepted,rejected,suppressed_ess,suppressed_validator,skipped_reason,error,runtime_ms,created_at",
      )
      .eq("case_id", caseId),
  ]);

  const matchedFindings = (findings ?? []).filter(
    (f) => classifyFindingAgent(f as Record<string, unknown>) === def.key,
  ).length;
  const mapped = new Set(AGENT_ENGINE_MAP[def.key] ?? []);
  const engineRows = (runs ?? []).filter((r) => mapped.has(String(r.engine)));
  const generatedFromRuns = engineRows.reduce((sum, r) => sum + n((r as Record<string, unknown>).generated), 0);
  // Only the "contradictions" agent has this specific gap: its real output
  // (the rendered Contradiction Analysis section) comes from a narrative
  // LLM pass that never writes its own case_findings rows, so matchedFindings
  // alone always undercounts it — generated correctly reflects the real
  // count via generatedFromRuns, but promoted stayed 0 forever, making the
  // card falsely claim everything was "suppressed by validation" even
  // though the contradiction is fully rendered in the report. Every OTHER
  // agent's engine rows (theory, strategy, opportunity, motion,
  // report_validator, claim_validator, etc.) log `accepted` values that are
  // frequently set equal to `generated` unconditionally in their subRow()
  // calls, regardless of whether anything was actually suppressed —
  // folding acceptedFromRuns into every agent's `promoted` (as an earlier
  // version of this fix did) silently erased real suppression signal
  // report-wide (Suppressed findings dropped to 0 and "Agents producing
  // findings" jumped from 3 to 11 in one run, neither of which reflected
  // the actual pipeline output). Keep the fix scoped to the one agent it's
  // actually needed for.
  const acceptedFromRuns =
    def.key === "contradictions"
      ? engineRows.reduce((sum, r) => sum + n((r as Record<string, unknown>).accepted), 0)
      : 0;
  const rejectedFromRuns = engineRows.reduce(
    (sum, r) =>
      sum +
      n((r as Record<string, unknown>).rejected) +
      n((r as Record<string, unknown>).suppressed_ess) +
      n((r as Record<string, unknown>).suppressed_validator),
    0,
  );
  const latest = engineRows
    .slice()
    .sort((a, b) =>
      String((b as Record<string, unknown>).created_at ?? "").localeCompare(
        String((a as Record<string, unknown>).created_at ?? ""),
      ),
    )[0] as Record<string, unknown> | undefined;
  const outputItems = outputItemCount(def.key, result.output);
  const generated = Math.max(
    n(asObj(asObj(result.output).agent_stats).findings_generated),
    generatedFromRuns,
    matchedFindings,
  );
  const promoted = Math.max(
    n(asObj(asObj(result.output).agent_stats).findings_promoted),
    matchedFindings,
    acceptedFromRuns,
  );
  const suppressed = Math.max(0, rejectedFromRuns, generated - promoted);
  const status =
    result.status === "pending" && latest?.status
      ? String(latest.status)
      : String(result.status || latest?.status || "pending");
  const noOutputReason =
    status === "blocked" || status === "skipped" || status === "failed"
      ? String(result.errors?.[0] ?? latest?.skipped_reason ?? latest?.error ?? "No output produced.")
      : outputItems === 0 && promoted === 0
        ? suppressed > 0
          ? `${suppressed} candidate finding(s) generated but suppressed by validation.`
          : "Nothing found in supplied evidence."
        : null;
  const produced = outputItems > 0 || promoted > 0;
  const executed = status === "success" || status === "completed" ? produced || !!noOutputReason : false;

  return {
    agent_key: def.key,
    agent_name: def.name,
    primary_function: def.description,
    loaded: true,
    executed,
    produced,
    status,
    documents_analyzed: def.key === "intake" ? docs : extracted,
    findings_generated: generated,
    findings_suppressed: suppressed,
    findings_promoted: promoted,
    visible_findings: promoted,
    output_items: outputItems,
    duration_ms: Math.max(0, Date.now() - startedAtMs),
    no_output_reason: noOutputReason,
    suppression_rate: generated > 0 ? Math.round((suppressed / generated) * 1000) / 10 : 0,
  };
}

export async function buildAgentStatistics(
  db: Db,
  caseId: string,
  opts: { runId?: string } = {},
): Promise<AgentStatisticsReport> {
  let logsQuery = db
    .from("agent_logs")
    .select(
      "agent_key,agent_name,status,processing_time_ms,documents_analyzed,findings_generated,findings_suppressed,findings_promoted,findings_produced,output_items,no_output_reason,output,errors,created_at",
    )
    .eq("case_id", caseId);
  if (opts.runId) logsQuery = logsQuery.eq("run_id", opts.runId);
  const [{ data: logs }, { count: visibleFindings }] = await Promise.all([
    logsQuery.order("created_at", { ascending: false }),
    db.from("case_findings").select("id", { count: "exact", head: true }).eq("case_id", caseId),
  ]);
  const latestLog = new Map<string, Record<string, unknown>>();
  for (const row of logs ?? []) {
    const key = String((row as Record<string, unknown>).agent_key ?? "");
    if (key && !latestLog.has(key)) latestLog.set(key, row as Record<string, unknown>);
  }

  const rows: AgentOutputStats[] = [];
  for (const def of AGENT_DEFINITIONS) {
    const log = latestLog.get(def.key);
    if (log) {
      const output = asObj(log.output);
      const stats = asObj(output.agent_stats) as Partial<AgentOutputStats>;
      const recomputed = await buildSingleAgentStats(
        db,
        caseId,
        def,
        {
          status: String(log.status ?? "pending") as AgentResult["status"],
          confidence: 0,
          processingTime: n(log.processing_time_ms),
          tokensUsed: 0,
          outputFile: def.outputFile,
          errors: Array.isArray(log.errors) ? (log.errors as string[]) : [],
          output: output as AgentJson,
        },
        Date.now() - n(log.processing_time_ms),
      );
      const producedFindings = Math.max(
        n(stats.visible_findings),
        n(stats.findings_promoted),
        n((log as Record<string, unknown>).findings_produced),
      );
      const outputItems = Math.max(n(stats.output_items), n((log as Record<string, unknown>).output_items));
      const noOutputReason =
        typeof stats.no_output_reason === "string"
          ? stats.no_output_reason
          : typeof (log as Record<string, unknown>).no_output_reason === "string"
            ? String((log as Record<string, unknown>).no_output_reason)
            : null;
      const gen = Math.max(
        n(stats.findings_generated),
        n((log as Record<string, unknown>).findings_generated),
        recomputed.findings_generated,
      );
      const supp = Math.max(
        n(stats.findings_suppressed),
        n((log as Record<string, unknown>).findings_suppressed),
        recomputed.findings_suppressed,
      );
      rows.push({
        agent_key: def.key,
        agent_name: def.name,
        primary_function: def.description,
        loaded: true,
        executed: Boolean(
          stats.executed ||
          recomputed.executed ||
          (["success", "completed"].includes(String(log.status)) &&
            (outputItems > 0 || producedFindings > 0 || !!noOutputReason)),
        ),
        produced: Boolean(stats.produced || recomputed.produced || outputItems > 0 || producedFindings > 0),
        status: String(log.status ?? stats.status ?? "pending"),
        documents_analyzed: Math.max(
          n(stats.documents_analyzed),
          n((log as Record<string, unknown>).documents_analyzed),
          recomputed.documents_analyzed,
        ),
        findings_generated: gen,
        findings_suppressed: supp,
        findings_promoted: Math.max(
          n(stats.findings_promoted),
          n((log as Record<string, unknown>).findings_promoted),
          producedFindings,
          recomputed.findings_promoted,
        ),
        visible_findings: Math.max(producedFindings, recomputed.visible_findings),
        duration_ms: n(stats.duration_ms ?? log.processing_time_ms),
        output_items: Math.max(outputItems, recomputed.output_items),
        no_output_reason: noOutputReason ?? recomputed.no_output_reason,
        suppression_rate: gen > 0 ? Math.round((supp / gen) * 1000) / 10 : 0,
      });
    } else {
      const empty = await buildSingleAgentStats(
        db,
        caseId,
        def,
        {
          status: "pending",
          confidence: 0,
          processingTime: 0,
          tokensUsed: 0,
          outputFile: def.outputFile,
          errors: [],
          output: {},
        },
        Date.now(),
      );
      rows.push(empty);
    }
  }

  const defs = {
    loaded: rows.filter((r) => r.loaded).length,
    executed: rows.filter((r) => r.executed).length,
    producing_output: rows.filter((r) => r.produced).length,
    producing_findings: rows.filter((r) => r.findings_promoted > 0).length,
    suppressed_findings: rows.reduce((sum, r) => sum + r.findings_suppressed, 0),
    visible_findings: visibleFindings ?? rows.reduce((sum, r) => sum + r.visible_findings, 0),
  };
  return { generated_at: new Date().toISOString(), definitions: defs, rows };
}
