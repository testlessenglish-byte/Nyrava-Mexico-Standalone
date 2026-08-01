// Navigation-independent, multi-case pipeline driver.
//
// Why this exists: the tab-driven tick loop used to live inside
// CaseControlPanel's useEffect, so it died the moment the user navigated to
// another page (or to another case). This module holds the loops in
// MODULE state instead of component state, so:
//   - a run keeps ticking while the user browses other pages,
//   - several cases drive concurrently (one independent loop per case_id),
//   - unmounting a component never cancels an in-flight run.
//
// Every loop is keyed strictly by case_id — starting Case B never touches
// Case A's loop. React components are pure observers (useCaseExecution).

export type PipelineTickFn = (args: {
  data: { caseId: string };
}) => Promise<{ done?: boolean; status?: string; ran?: boolean } | undefined>;

type Loop = { cancelled: boolean };

const loops = new Map<string, Loop>();

let tickFn: PipelineTickFn | null = null;
let onChange: ((caseId: string) => void) | null = null;

/** Wired once by the app shell (needs a React-bound server-fn caller). */
export function configurePipelineDriver(opts: {
  tick: PipelineTickFn;
  onChange?: (caseId: string) => void;
}) {
  tickFn = opts.tick;
  onChange = opts.onChange ?? null;
}

export function isDrivingCase(caseId: string): boolean {
  return loops.has(caseId);
}

export function drivingCaseIds(): string[] {
  return [...loops.keys()];
}

/**
 * Start (or reuse) a background loop for one case. Idempotent per case_id.
 * Safe to call from any component on any route.
 */
export function drivePipeline(caseId: string): void {
  if (!caseId) return;
  if (loops.has(caseId)) return;
  const loop: Loop = { cancelled: false };
  loops.set(caseId, loop);

  void (async () => {
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 5;
    try {
      while (!loop.cancelled) {
        let delayMs = 2000;
        try {
          if (!tickFn) break;
          const res = await tickFn({ data: { caseId } });
          consecutiveFailures = 0;
          onChange?.(caseId);
          if (res?.done) break;
        } catch (e) {
          consecutiveFailures += 1;
          console.error(
            `[pipeline-driver] tick failed for ${caseId} (${consecutiveFailures}/${maxConsecutiveFailures})`,
            e,
          );
          if (consecutiveFailures >= maxConsecutiveFailures) break;
          delayMs = 4000 * consecutiveFailures;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } finally {
      loops.delete(caseId);
      onChange?.(caseId);
    }
  })();
}

/** Explicit stop — only used by cancel / clear-state flows, never by unmount. */
export function stopDrivingPipeline(caseId: string): void {
  const loop = loops.get(caseId);
  if (loop) loop.cancelled = true;
}
