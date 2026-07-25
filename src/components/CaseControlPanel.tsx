// Single-source execution surface: Run Case + Rerun Case + collapsed settings.
// Pipeline order is locked internally by runFullPipelineStep.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Play, RotateCw, Settings as SettingsIcon, ChevronDown, ChevronUp, FilePlus2 } from "lucide-react";
import {
  queueCaseForPipeline,
  updateCaseSettings,
  addEvidenceAndRerun,
  finalizeReportChangeLog,
  driveCasePipelineTick,
  getCaseRunState,
  PIPELINE_STAGES,
} from "@/lib/cases.functions";
import { AGENT_DEFINITIONS } from "@/lib/agents/types";
import { CASE_TYPE_SELECT_OPTIONS } from "@/lib/intelligence/practice-areas";
import { JURISDICTION_OPTIONS } from "@/lib/intelligence/jurisdictions";

const RUNNING_STATUSES = new Set([
  "queued",
  "running",
  "extracting",
  "analyzing",
  "agents_running",
  "ocr",
  "scoring",
  "reporting",
  "generating_report",
  "intelligence_running",
]);

export function CaseControlPanel({
  caseId,
  caseStatus,
  caseType,
  analysisMode,
  jurisdiction,
  documentsCount,
  invalidate,
}: {
  caseId: string;
  caseStatus: string | null | undefined;
  caseType: string | null;
  analysisMode: string | null;
  jurisdiction: string | null;
  documentsCount: number;
  invalidate: () => void;
}) {
  const qc = useQueryClient();
  const running = !!caseStatus && RUNNING_STATUSES.has(caseStatus);
  const queueFn = useServerFn(queueCaseForPipeline);
  const addFn = useServerFn(addEvidenceAndRerun);
  const finalizeFn = useServerFn(finalizeReportChangeLog);
  const tickFn = useServerFn(driveCasePipelineTick);
  const runStateFn = useServerFn(getCaseRunState);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drivingRef = useRef(false);
  const cancelWaitRef = useRef(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addProgress, setAddProgress] = useState("");
  const [awaitingCancel, setAwaitingCancel] = useState(false);

  // Self-driving fallback: while this case is queued/running, keep calling
  // driveCasePipelineTick from this open tab every couple seconds. This does
  // NOT depend on pg_cron or pg_net delivering their HTTP calls — if that
  // relay is broken (wrong URL, dead request queue, etc.) the case would
  // otherwise sit at "queued" forever with no visible error. If the real
  // background worker IS healthy, driveCasePipelineTick just no-ops whenever
  // it sees the worker already holds an active lease, so running both is
  // safe. Stops automatically once the case reaches a terminal status.
  //
  // 2026-07 audit: a single failed tick (a transient network blip, a
  // momentary RLS/auth hiccup, etc.) used to `break` out of this loop
  // permanently. Since `running` stays true for as long as the case sits at
  // "queued", the effect's own dependency array never changes, so nothing
  // ever restarted the loop — the tab silently stopped driving the case
  // with no visible error, which is exactly the "Rerun just sits there"
  // symptom. Now a failed tick is retried with backoff instead of killing
  // the loop; only after several CONSECUTIVE failures do we stop and
  // surface a toast, since at that point it's more likely a real, durable
  // problem than a blip.
  useEffect(() => {
    if (!running) return;
    if (drivingRef.current) return;
    drivingRef.current = true;
    let cancelled = false;

    (async () => {
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 5;
      while (!cancelled) {
        let delayMs = 2000;
        try {
          const res = await tickFn({ data: { caseId } });
          consecutiveFailures = 0;
          invalidate();
          qc.invalidateQueries({ queryKey: ["case", caseId] });
          if (res?.done) break;
        } catch (e) {
          consecutiveFailures += 1;
          console.error(
            `[pipeline] client-driven tick failed (attempt ${consecutiveFailures}/${maxConsecutiveFailures})`,
            e,
          );
          if (consecutiveFailures >= maxConsecutiveFailures) {
            toast.error("Lost connection to the pipeline worker — refresh the page to resume driving this case.");
            break;
          }
          // Back off a bit longer after a failure so a transient outage
          // doesn't get hammered, but still keep retrying automatically.
          delayMs = 4000 * consecutiveFailures;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      drivingRef.current = false;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, caseId]);

  // Run and Rerun both enqueue the case for the background worker. The
  // worker leases one case at a time, runs the full pipeline under an admin
  // client (no HTTP timeout tied to the user's tab), and yields between
  // stages via the wall-clock checkpoint. The user's tab observes progress
  // via realtime — see useCaseExecution.
  const runM = useMutation({
    mutationFn: async (reset: boolean) => {
      return await queueFn({ data: { caseId, reset } });
    },
    onMutate: (reset) =>
      toast.info(
        reset ? "Rerun queued — worker will pick this up shortly…" : "Run queued — worker will pick this up shortly…",
      ),
    onSuccess: (
      res:
        | { ok?: boolean; queued?: boolean; alreadyRunning?: boolean; cancelling?: boolean; billingRequired?: boolean }
        | undefined,
    ) => {
      if (res?.billingRequired) {
        toast.error("Billing required — this account has used its free case. Visit Billing to subscribe.");
      } else if (res?.alreadyRunning) {
        toast.warning("This case is already running — ignoring duplicate Run request.");
      } else if (res?.cancelling) {
        // Previously this just told the user to notice when the run had
        // stopped and click Rerun again themselves — in practice that
        // manual second step was easy to miss, and if the in-flight stage
        // was truly stuck, cancellation could take a while, making Rerun
        // look like it "did nothing." Now we auto-poll and auto-chain into
        // the real reset+requeue the moment cancellation lands, so Rerun is
        // a single action from the user's perspective.
        toast.info("Cancelling current run — will restart automatically once it stops…");
        waitForCancelThenRequeue();
      } else {
        toast.success("Case queued. Progress will stream in below.");
      }
      invalidate();
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to queue run");
      invalidate();
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
  });

  // Polls case status after a cooperative-cancel request until the in-flight
  // run actually reaches `cancelled`, then automatically fires the real
  // reset+requeue — so "Rerun" while a case is running is one click, not
  // two. Capped at ~90s; if cancellation hasn't landed by then (e.g. a
  // stage genuinely wedged outside any checkpoint/cancel check), we stop
  // polling and tell the user to try again rather than looping forever.
  function waitForCancelThenRequeue() {
    if (cancelWaitRef.current) return;
    cancelWaitRef.current = true;
    setAwaitingCancel(true);
    let attempts = 0;
    const maxAttempts = 60; // 60 * 1500ms = ~90s
    const poll = async () => {
      attempts += 1;
      try {
        const state = await runStateFn({ data: { caseId } });
        if (state?.status === "cancelled") {
          cancelWaitRef.current = false;
          setAwaitingCancel(false);
          toast.info("Previous run stopped — restarting with current settings…");
          runM.mutate(true);
          invalidate();
          qc.invalidateQueries({ queryKey: ["case", caseId] });
          return;
        }
        if (!RUNNING_STATUSES.has(String(state?.status ?? ""))) {
          // Landed on some other terminal status (e.g. failed) instead of
          // "cancelled" — safe to requeue rather than poll forever.
          cancelWaitRef.current = false;
          setAwaitingCancel(false);
          runM.mutate(true);
          invalidate();
          qc.invalidateQueries({ queryKey: ["case", caseId] });
          return;
        }
      } catch (e) {
        console.error("[pipeline] cancel-wait poll failed", e);
      }
      if (attempts >= maxAttempts) {
        cancelWaitRef.current = false;
        setAwaitingCancel(false);
        toast.warning("Still stopping the previous run — click Rerun again in a moment.");
        return;
      }
      setTimeout(poll, 1500);
    };
    poll();
  }

  async function handleAddEvidenceFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setAddBusy(true);
    try {
      setAddProgress(`Uploading ${arr.length} file(s) and extracting…`);
      const fd = new FormData();
      fd.append("caseId", caseId);
      for (const f of arr) fd.append("files", f);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (addFn as any)({ data: fd });
      toast.success(`Uploaded ${res?.uploaded ?? arr.length} file(s). Re-running affected analyses…`);
      invalidate();
      qc.invalidateQueries({ queryKey: ["case", caseId] });

      setAddProgress("Re-queuing analyzers so the worker re-runs them…");
      await queueFn({ data: { caseId } });

      setAddProgress("Computing What's Changed…");
      await finalizeFn({ data: { caseId } });

      toast.success(`Report v${res?.nextVersion ?? "?"} generated with change log`);
      invalidate();
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    } catch (e) {
      toast.error(`Add evidence failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAddBusy(false);
      setAddProgress("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const disabled = running || runM.isPending || addBusy || awaitingCancel || documentsCount === 0;
  const addDisabled = running || runM.isPending || addBusy || awaitingCancel;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Case Control</h2>
        <p className="mt-1 text-xs text-slate-400">
          One command runs the full pipeline in locked order. Outputs stream into the Analysis Command Center.
        </p>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Runs {PIPELINE_STAGES.length} intelligence stages + a {AGENT_DEFINITIONS.length}-agent verification pass
          (Judge, QA, Hallucination gates). Expect ~8–12 additional LLM calls per run vs. analyzers alone.
        </p>

        <button
          onClick={() => runM.mutate(false)}
          disabled={disabled}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/25 disabled:opacity-50"
        >
          {runM.isPending && !runM.variables ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Case
        </button>

        <button
          onClick={() => {
            if (
              confirm("Rerun Case will clear all findings, scores, and reports. Uploaded files are kept. Continue?")
            ) {
              runM.mutate(true);
            }
          }}
          disabled={disabled}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
        >
          {(runM.isPending && runM.variables) || awaitingCancel ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCw className="h-4 w-4" />
          )}
          {awaitingCancel ? "Stopping current run…" : "Rerun Case"}
        </button>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          disabled={addDisabled}
          onChange={(e) => e.target.files && handleAddEvidenceFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={addDisabled}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2.5 text-sm font-medium text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
        >
          {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
          {addBusy ? "Working…" : "Add Evidence"}
        </button>
        {addBusy && addProgress && <p className="mt-2 text-xs text-emerald-300">{addProgress}</p>}

        {documentsCount === 0 && (
          <p className="mt-3 text-xs text-amber-300">Upload at least one document before running.</p>
        )}
        {running && (
          <p className="mt-3 text-xs text-cyan-300">Pipeline in progress — see the Command Center for live status.</p>
        )}
      </div>

      <CollapsedCaseSettings
        caseId={caseId}
        caseType={caseType}
        analysisMode={analysisMode}
        jurisdiction={jurisdiction}
        running={running}
        invalidate={invalidate}
      />
    </div>
  );
}

function CollapsedCaseSettings({
  caseId,
  caseType,
  analysisMode,
  jurisdiction,
  running,
  invalidate,
}: {
  caseId: string;
  caseType: string | null;
  analysisMode: string | null;
  jurisdiction: string | null;
  running: boolean;
  invalidate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const updateFn = useServerFn(updateCaseSettings);
  const [ct, setCt] = useState<string>(caseType ?? "general_civil");
  const [mode, setMode] = useState<string>(analysisMode || "balanced");
  const [juris, setJuris] = useState<string>(jurisdiction ?? "");
  useEffect(() => {
    setCt(caseType ?? "general_civil");
    setMode(analysisMode || "balanced");
    setJuris(jurisdiction ?? "");
  }, [caseType, analysisMode, jurisdiction]);

  const m = useMutation({
    mutationFn: (patch: { case_type?: string; analysis_mode?: string; jurisdiction?: string | null }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateFn({ data: { caseId, ...(patch as any) } }),
    onSuccess: () => {
      toast.success("Settings saved. Rerun Case to apply.");
      setOpen(false);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const dirty =
    ct !== (caseType ?? "general_civil") || mode !== (analysisMode || "balanced") || juris !== (jurisdiction ?? "");
  const disabled = running || m.isPending;

  return (
    <div className="rounded-2xl border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <SettingsIcon className="h-3.5 w-3.5" /> Case Settings
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border p-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">Case type</label>
            <select
              value={ct}
              onChange={(e) => setCt(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm disabled:opacity-50"
            >
              {CASE_TYPE_SELECT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">Jurisdiction</label>
            <p className="text-[11px] text-muted-foreground">Scopes case-law lookups to this state's courts.</p>
            <select
              value={juris}
              onChange={(e) => setJuris(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm disabled:opacity-50"
            >
              <option value="">Nationwide (no state filter)</option>
              {JURISDICTION_OPTIONS.filter((o) => o.value !== "federal").map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">Analysis mode</label>
            <div className="grid gap-1.5">
              {[
                { v: "strict", label: "Strict", desc: "Only direct evidence." },
                { v: "balanced", label: "Balanced", desc: "Direct + evidence-based inferences." },
                { v: "exploratory", label: "Exploratory", desc: "Includes AI theories, labeled." },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(opt.v)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                    mode === opt.v ? "border-accent bg-accent/10" : "border-border bg-background hover:bg-secondary"
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => m.mutate({ case_type: ct, analysis_mode: mode, jurisdiction: juris || null })}
            disabled={disabled || !dirty}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {dirty ? "Save settings" : "Saved"}
          </button>
        </div>
      )}
    </div>
  );
}
