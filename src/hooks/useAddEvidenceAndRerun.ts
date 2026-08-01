// Shared "add evidence, rerun the affected pipeline stages, diff the result"
// flow. Extracted from CaseControlPanel's handleAddEvidenceFiles so any
// surface (the Evidence tab, Talk to Case chat, etc.) can trigger the same
// versioned, audited rerun instead of re-implementing the sequence.
//
// This intentionally does NOT auto-fire on its own — every caller decides
// when `run()` is invoked. Re-running the full pipeline is a real,
// multi-agent LLM job (analyzers -> agents -> timeline -> ... -> report), so
// it stays an explicit, attorney-initiated action with a visible button, not
// something that happens silently as a side effect of a chat reply.
import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { drivePipeline } from "@/lib/pipeline-driver";
import {
  addEvidenceAndRerun,
  queueCaseForPipeline,
  driveCasePipelineTick,
  finalizeReportChangeLog,
} from "@/lib/cases.functions";

export type AddEvidenceRerunResult = {
  ok: true;
  nextVersion: number | null;
};

export function useAddEvidenceAndRerun(caseId: string) {
  const addFn = useServerFn(addEvidenceAndRerun);
  const queueFn = useServerFn(queueCaseForPipeline);
  const tickFn = useServerFn(driveCasePipelineTick);
  const finalizeFn = useServerFn(finalizeReportChangeLog);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const runningRef = useRef(false);

  const run = useCallback(
    async (files: File[]): Promise<AddEvidenceRerunResult> => {
      if (files.length === 0) throw new Error("No files provided");
      if (runningRef.current) throw new Error("A rerun is already in progress for this case.");
      runningRef.current = true;
      setBusy(true);
      try {
        setProgress(`Uploading ${files.length} file(s) and extracting…`);
        const fd = new FormData();
        fd.append("caseId", caseId);
        for (const f of files) fd.append("files", f);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addRes = await (addFn as any)({ data: fd });

        setProgress("Re-queuing analyzers so the pipeline re-runs against the update…");
        const queueRes = await queueFn({ data: { caseId } });
        if (queueRes && (queueRes as { ok?: boolean }).ok === false) {
          const r = queueRes as { billingRequired?: boolean; alreadyRunning?: boolean; cancelling?: boolean };
          if (r.billingRequired) throw new Error("Billing required — an active subscription is needed to rerun this case.");
          if (r.alreadyRunning) throw new Error("This case is already running — wait for it to finish, then try again.");
          if (r.cancelling) throw new Error("A previous run is still stopping — try again in a moment.");
          throw new Error("Could not queue the case for rerun.");
        }

        // Drive the pipeline from this tab — the same fallback path
        // CaseControlPanel's self-driving effect uses — rather than assuming
        // a background worker is picking the case up. Safe to run alongside
        // a real worker: driveCasePipelineTick no-ops if another lease is
        // already active.
        setProgress("Running affected analysis stages…");
        // Also hand the case to the navigation-independent driver so the run
        // keeps advancing if the user leaves this page mid-rerun.
        drivePipeline(caseId);
        let attempts = 0;
        const maxAttempts = 300; // ~10 minutes ceiling at ~2s/tick
        for (;;) {
          attempts += 1;
          let tick: { done?: boolean; status?: string } | undefined;
          try {
            tick = await tickFn({ data: { caseId } });
          } catch (e) {
            console.error("[useAddEvidenceAndRerun] tick failed", e);
            if (attempts >= maxAttempts) throw e;
            await new Promise((r) => setTimeout(r, 4000));
            continue;
          }
          if (tick?.status) setProgress(`Running affected analysis stages… (${tick.status})`);
          if (tick?.done) break;
          if (attempts >= maxAttempts) {
            throw new Error("Pipeline is taking longer than expected — check Case Control for status.");
          }
          await new Promise((r) => setTimeout(r, 2000));
        }

        setProgress("Computing What's Changed…");
        await finalizeFn({ data: { caseId } });

        const nextVersion = (addRes?.nextVersion as number | undefined) ?? null;
        return { ok: true, nextVersion };
      } finally {
        runningRef.current = false;
        setBusy(false);
        setProgress("");
      }
    },
    [caseId, addFn, queueFn, tickFn, finalizeFn],
  );

  return { run, busy, progress };
}
