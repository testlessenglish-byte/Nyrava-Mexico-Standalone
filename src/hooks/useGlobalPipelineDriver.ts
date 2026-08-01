// Mounted ONCE by the authenticated app shell. Keeps every active case
// ticking regardless of which route the user is on, and starts a loop for
// any case that is queued/running (including runs started in another tab or
// picked up by the cron worker).
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { driveCasePipelineTick, listActivePipelineCases } from "@/lib/cases.functions";
import { configurePipelineDriver, drivePipeline } from "@/lib/pipeline-driver.client";

export function useGlobalPipelineDriver() {
  const qc = useQueryClient();
  const tickFn = useServerFn(driveCasePipelineTick);
  const activeFn = useServerFn(listActivePipelineCases);

  useEffect(() => {
    configurePipelineDriver({
      tick: tickFn as never,
      onChange: (caseId) => {
        qc.invalidateQueries({ queryKey: ["case", caseId] });
        qc.invalidateQueries({ queryKey: ["case-execution", caseId] });
        qc.invalidateQueries({ queryKey: ["cases"] });
      },
    });
  }, [tickFn, qc]);

  const { data: activeIds } = useQuery({
    queryKey: ["active-pipeline-cases"],
    queryFn: () => activeFn(),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 5_000,
  });

  useEffect(() => {
    for (const id of activeIds ?? []) drivePipeline(id);
  }, [activeIds]);
}
