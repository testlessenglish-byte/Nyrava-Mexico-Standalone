// Final Release Validation gate.
//
// Reconciles the Case-Type Manifest (what the engine INTENDED to run) against
// what actually executed and what will render. Produces a deterministic list
// of issues that the pipeline writes onto `full_report.release_gate` and
// appends to `pipeline_warnings`. The pipeline never crashes on a release-gate
// mismatch — it surfaces them so the audit trail records the drift.
//
// Pure module: no DB, no IO, fully unit-testable from fixtures.

import type { CaseTypeManifest } from "./practice-areas";

export type EngineRunRow = {
  engine: string;
  // canonical statuses written by engine-audit.server.ts
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
    executed: number; // completed only
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
 * Pure reconciliation. Caller wires DB rows in; this returns a deterministic
 * verdict suitable for persisting to the report and warnings array.
 */
export function reconcileManifest(input: {
  manifest: CaseTypeManifest;
  runs: EngineRunRow[];
  activations: DomainActivationRow[];
  workProducts?: WorkProductRow[];
}): ReleaseGateResult {
  const { manifest, runs, activations } = input;
  const work = input.workProducts ?? [];
  const issues: ReleaseGateIssue[] = [];

  // Latest row per engine (in case the same engine ran multiple times).
  const latest = new Map<string, EngineRunRow>();
  for (const r of runs) latest.set(r.engine, r);

  const enabledSet = new Set(manifest.enabled_engines);
  // report_generator is the engine currently executing this reconciliation —
  // by design (see the NOTE in pipeline.server.ts _runReportInner) its own
  // pipeline_engine_runs row is only flipped to "completed" by the outer
  // runEngine wrapper AFTER this whole report-generation function returns,
  // which is after this check runs. It is therefore structurally guaranteed
  // to still read as "running" here on every single case, not just failing
  // ones. Checking it against itself is a self-referential test that can
  // never pass, so it must be excluded from both the terminal-status check
  // and the stage-count reconciliation below.
  enabledSet.delete("report_generator");
  const skippedPolicySet = new Set(manifest.skipped_engines);
  const crossSet = new Set(manifest.cross_domain_engines);

  // 1) Enabled engines must reach a terminal state.
  let executed = 0;
  let failed = 0;
  let skipped = 0;
  for (const e of enabledSet) {
    const row = latest.get(e);
    if (!row) {
      // Some "enabled" engines (e.g. `report_validator`) are universal helpers
      // that may not produce a row for every case; we only flag when the row
      // exists and is non-terminal.
      continue;
    }
    if (!TERMINAL.has(row.status)) {
      issues.push({
        code: "pending_after_run",
        engine: e,
        detail: `Enabled engine "${e}" finished pipeline with non-terminal status "${row.status}".`,
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

  // 2) Skipped-by-policy engines must NOT have run successfully — that would
  //    be a silent activation bypassing the practice-area gate.
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

  // 3) Cross-domain engines need either a recorded activation for their
  //    domain or to be in the enabled set already (universal). We can't map
  //    engine→domain perfectly, but every cross-domain engine implies at
  //    least one activation row must exist for the case.
  if (crossSet.size > 0 && activations.length === 0) {
    issues.push({
      code: "cross_domain_no_audit",
      detail: `Manifest lists ${crossSet.size} cross-domain engine(s) but no activation audit rows were recorded.`,
    });
  }

  // 4) Activation hygiene: every activation must carry source + reason,
  //    evidence-source activations must cite at least one finding.
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

  // 5) Work product must be Generated or Skipped — never an empty
  //    title-only row. "Generated" is defined as body_markdown length > 40
  //    (matches export.ts::renderWorkProduct).
  let workGenerated = 0;
  let workSkipped = 0;
  for (const wp of work) {
    const body = String(wp.body_markdown ?? "").trim();
    const isGenerated = body.length > 40;
    const reason = String(wp.skipped_reason ?? wp.error_message ?? "").trim();
    if (isGenerated) {
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

  // 6) Stage-count reconciliation: enabled engines that produced a row must
  //    account for completed+failed+skipped. Surface only if numbers diverge.
  const enabledWithRows = Array.from(enabledSet).filter((e) => latest.has(e)).length;
  const accounted = executed + failed + skipped;
  if (enabledWithRows !== accounted) {
    issues.push({
      code: "stage_count_mismatch",
      detail: `Enabled engines with rows=${enabledWithRows} but terminal counts sum to ${accounted}.`,
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

/** Compact human-readable summary for pipeline_warnings. */
export function summarizeReleaseGate(r: ReleaseGateResult): string[] {
  if (r.ok) return [];
  return r.issues.map((i) => `[release-gate:${i.code}] ${i.detail}`);
}
