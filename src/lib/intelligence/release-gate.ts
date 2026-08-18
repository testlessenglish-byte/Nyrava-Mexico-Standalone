// Manifest reconciliation used inside the report audit trail.
//
// IMPORTANT: this module is not the authoritative final release decision.
// QA/Judge/Hallucination + rendered-report validation own release. This
// reconciliation detects structural drift without falsely declaring a report
// unreleasable merely because an optional/auxiliary agent row is still
// finishing when report_generator takes its snapshot.

import type { CaseTypeManifest } from "./practice-areas";

export type EngineRunRow = {
  engine: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped" | string;
  skipped_reason?: string | null;
};

export type DomainActivationRow = {
  domain: string;
  source: "user" | "hybrid" | "evidence" | string;
  trigger_id?: string | null;
  reason?: string | null;
  evidence_finding_ids?: string[] | null;
};

export type WorkProductRow = {
  id?: string;
  kind?: string | null;
  title?: string | null;
  body_markdown?: string | null;
  error_message?: string | null;
  skipped_reason?: string | null;
};

export type ReleaseGateIssue = {
  code:
    | "pending_after_run"
    | "enabled_not_executed"
    | "silent_activation"
    | "skipped_without_reason"
    | "cross_domain_no_audit"
    | "activation_missing_reason"
    | "activation_missing_evidence"
    | "work_product_empty"
    | "stage_count_mismatch";
  engine?: string;
  domain?: string;
  detail: string;
};

export type ReleaseGateResult = {
  ok: boolean;
  issues: ReleaseGateIssue[];
  stats: {
    enabled: number;
    executed: number;
    failed: number;
    skipped: number;
    cross_domain: number;
    activations: number;
    work_generated: number;
    work_skipped: number;
  };
};

const TERMINAL = new Set(["completed", "failed", "skipped"]);

/**
 * Agent rows can legitimately still read `running` in the report-generator
 * snapshot because the outer orchestrator writes their terminal row after
 * the inner report snapshot. The FINAL release gate evaluates those agents
 * after completion. Treating these transient rows as manifest failures made
 * `full_report.release_gate.ok=false` coexist with `case.status=released`.
 */
function isTransientAuxiliaryRow(engine: string, status: string): boolean {
  return engine.startsWith("agent:") && (status === "queued" || status === "running");
}

export function reconcileManifest(input: {
  manifest: CaseTypeManifest;
  runs: EngineRunRow[];
  activations: DomainActivationRow[];
  workProducts?: WorkProductRow[];
}): ReleaseGateResult {
  const { manifest, runs, activations } = input;
  const work = input.workProducts ?? [];
  const issues: ReleaseGateIssue[] = [];

  const latest = new Map<string, EngineRunRow>();
  for (const r of runs) latest.set(r.engine, r);

  const enabledSet = new Set(manifest.enabled_engines);
  // report_generator is necessarily running while this function executes.
  enabledSet.delete("report_generator");
  const skippedPolicySet = new Set(manifest.skipped_engines);
  const crossSet = new Set(manifest.cross_domain_engines);

  let executed = 0;
  let failed = 0;
  let skipped = 0;
  for (const e of enabledSet) {
    const row = latest.get(e);
    if (!row) continue;
    if (!TERMINAL.has(row.status)) {
      if (isTransientAuxiliaryRow(e, row.status)) continue;
      issues.push({
        code: "pending_after_run",
        engine: e,
        detail: `Enabled engine "${e}" has non-terminal status "${row.status}" in the report snapshot.`,
      });
      continue;
    }
    if (row.status === "completed") executed += 1;
    else if (row.status === "failed") failed += 1;
    else if (row.status === "skipped") {
      skipped += 1;
      if (!row.skipped_reason) {
        issues.push({
          code: "skipped_without_reason",
          engine: e,
          detail: `Engine "${e}" skipped without a recorded reason.`,
        });
      }
    }
  }

  for (const e of skippedPolicySet) {
    const row = latest.get(e);
    if (row && row.status === "completed") {
      issues.push({
        code: "silent_activation",
        engine: e,
        detail: `Engine "${e}" is gated out for this case type but ran to completion.`,
      });
    }
  }

  if (crossSet.size > 0 && activations.length === 0) {
    issues.push({
      code: "cross_domain_no_audit",
      detail: `Manifest lists ${crossSet.size} cross-domain engine(s) but no activation audit rows were recorded.`,
    });
  }

  for (const a of activations) {
    if (!a.reason || !String(a.reason).trim()) {
      issues.push({
        code: "activation_missing_reason",
        domain: a.domain,
        detail: `Activation for domain "${a.domain}" missing reason.`,
      });
    }
    if (a.source === "evidence" && (!a.evidence_finding_ids || a.evidence_finding_ids.length === 0)) {
      issues.push({
        code: "activation_missing_evidence",
        domain: a.domain,
        detail: `Evidence-triggered activation for "${a.domain}" cites no finding ids.`,
      });
    }
  }

  let workGenerated = 0;
  let workSkipped = 0;
  for (const wp of work) {
    const body = String(wp.body_markdown ?? "").trim();
    const reason = String(wp.skipped_reason ?? wp.error_message ?? "").trim();
    if (body.length > 40) {
      workGenerated += 1;
      continue;
    }
    if (reason) {
      workSkipped += 1;
      continue;
    }
    issues.push({
      code: "work_product_empty",
      detail: `Work product "${wp.title ?? wp.kind ?? wp.id ?? "(untitled)"}" has no body and no skip reason.`,
    });
  }

  // Count only rows that are expected to be terminal at this snapshot. Agent
  // rows still in-flight are intentionally left for the authoritative final
  // release gate and therefore cannot create a fake stage-count mismatch.
  const enabledWithTerminalRows = Array.from(enabledSet).filter((e) => {
    const row = latest.get(e);
    return Boolean(row && TERMINAL.has(row.status));
  }).length;
  const accounted = executed + failed + skipped;
  if (enabledWithTerminalRows !== accounted) {
    issues.push({
      code: "stage_count_mismatch",
      detail: `Terminal enabled-engine rows=${enabledWithTerminalRows} but terminal counts sum to ${accounted}.`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      enabled: enabledSet.size,
      executed,
      failed,
      skipped,
      cross_domain: crossSet.size,
      activations: activations.length,
      work_generated: workGenerated,
      work_skipped: workSkipped,
    },
  };
}

export function summarizeReleaseGate(r: ReleaseGateResult): string[] {
  if (r.ok) return [];
  return r.issues.map((i) => `[release-gate:${i.code}] ${i.detail}`);
}
