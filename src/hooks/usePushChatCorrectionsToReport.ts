// Talk-to-Case "Push to Report" — applies the AI's finding patch set to the
// EXISTING case intelligence and regenerates only the report, instead of
// rerunning the full pipeline (see useAddEvidenceAndRerun for that separate,
// genuinely-new-evidence flow). Deliberately much shorter than
// useAddEvidenceAndRerun's drivePipeline tick loop: there is no multi-agent
// pipeline to drive here, just one patch-generation LLM call, a handful of
// direct case_findings writes, and a report regeneration — all handled
// server-side by pushCaseChatCorrectionsToReport in a single round trip.
import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pushCaseChatCorrectionsToReport, finalizeReportChangeLog } from "@/lib/cases.functions";

export type PushChatCorrectionsResult = {
  ok: true;
  nextVersion: number | null;
  patchCount: number;
  ungrounded: number;
};

export function usePushChatCorrectionsToReport(caseId: string) {
  const pushFn = useServerFn(pushCaseChatCorrectionsToReport);
  const finalizeFn = useServerFn(finalizeReportChangeLog);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const runningRef = useRef(false);

  const run = useCallback(
    async (chatMessageId: string): Promise<PushChatCorrectionsResult> => {
      if (runningRef.current)
        throw new Error("A report update is already in progress for this case.");
      runningRef.current = true;
      setBusy(true);
      try {
        setProgress("Reviewing existing findings against this exchange…");
        const res = await pushFn({ data: { caseId, chatMessageId } });

        if (res.applied.length === 0) {
          return { ok: true, nextVersion: null, patchCount: 0, ungrounded: res.ungrounded };
        }

        if (res.nextVersion != null) {
          setProgress("Computing What's Changed…");
          await finalizeFn({ data: { caseId } });
        }

        return {
          ok: true,
          nextVersion: res.nextVersion,
          patchCount: res.applied.filter((o) => o.applied).length,
          ungrounded: res.ungrounded,
        };
      } finally {
        runningRef.current = false;
        setBusy(false);
        setProgress("");
      }
    },
    [caseId, pushFn, finalizeFn],
  );

  return { run, busy, progress };
}
