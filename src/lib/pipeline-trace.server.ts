// =============================================================================
// Pipeline instrumentation sink ("Live Debug Mode").
//
// Every observable step of the upload → queue → worker → stage → AI-call →
// DB-write path emits one row into `public.pipeline_trace` AND one JSON line
// to the worker log. The DB rows are what the Live Debug panel polls, so a
// failing live run can be watched end-to-end without shell access.
//
// Design rules:
//  - NEVER throw. Instrumentation must not be able to break the pipeline.
//  - Works with an explicit db handle (server functions / worker route) or
//    from deep inside the call stack via an AsyncLocalStorage scope opened by
//    the pipeline runner (so `router.server.ts` can trace without plumbing).
//  - Fire-and-forget writes are awaited only when cheap; failures are logged
//    to console and swallowed.
// =============================================================================
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type TracePhase =
  | "upload"
  | "queue"
  | "worker"
  | "stage"
  | "engine"
  | "ai"
  | "db"
  | "pipeline";

export type TraceStatus = "start" | "ok" | "warn" | "error" | "info";

export type TraceScope = {
  db: Db;
  caseId: string;
  userId?: string | null;
  correlationId: string;
};

const scopeStore = new AsyncLocalStorage<TraceScope>();

/** Open a trace scope so nested code (engines, AI router) can emit without plumbing. */
export function withTraceScope<T>(scope: TraceScope, fn: () => Promise<T>): Promise<T> {
  return scopeStore.run(scope, fn);
}

export function currentTraceScope(): TraceScope | undefined {
  return scopeStore.getStore();
}

export function newCorrelationId(caseId: string): string {
  return `run-${caseId.slice(0, 8)}-${Date.now().toString(36)}`;
}

export type TraceEntry = {
  phase: TracePhase;
  step: string;
  status?: TraceStatus;
  level?: "debug" | "info" | "warn" | "error";
  provider?: string | null;
  model?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  detail?: Record<string, unknown>;
  error?: string | null;
  /** Explicit target when no ALS scope is open (server fns, worker route). */
  db?: Db;
  caseId?: string;
  userId?: string | null;
  correlationId?: string | null;
};

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Strip anything that looks like a credential before persisting. */
function sanitize(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (/key|secret|token|password|authorization/i.test(k)) {
      out[k] = typeof v === "string" && v.length > 8 ? `${v.slice(0, 3)}…${v.slice(-3)}` : "[redacted]";
      continue;
    }
    if (typeof v === "string") out[k] = clip(v, 2000);
    else if (v instanceof Error) out[k] = clip(v.message, 2000);
    else out[k] = v;
  }
  return out;
}

/**
 * Emit one trace entry. Always logs to console; persists when a db handle is
 * available (explicit or from the ambient scope). Never throws.
 */
export async function trace(entry: TraceEntry): Promise<void> {
  const scope = scopeStore.getStore();
  const db = entry.db ?? scope?.db;
  const caseId = entry.caseId ?? scope?.caseId;
  const userId = entry.userId ?? scope?.userId ?? null;
  const correlationId = entry.correlationId ?? scope?.correlationId ?? null;
  const status: TraceStatus = entry.status ?? "info";
  const level = entry.level ?? (status === "error" ? "error" : status === "warn" ? "warn" : "info");
  const detail = sanitize(entry.detail);

  const line = {
    t: new Date().toISOString(),
    corr: correlationId,
    caseId: caseId ?? null,
    phase: entry.phase,
    step: entry.step,
    status,
    provider: entry.provider ?? null,
    model: entry.model ?? null,
    attempt: entry.attempt ?? null,
    ms: entry.durationMs ?? null,
    error: clip(entry.error, 500),
    ...detail,
  };
  const rendered = `[trace] ${JSON.stringify(line)}`;
  if (level === "error") console.error(rendered);
  else if (level === "warn") console.warn(rendered);
  else console.info(rendered);

  if (!db || !caseId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("pipeline_trace").insert({
      case_id: caseId,
      user_id: userId,
      correlation_id: correlationId,
      phase: entry.phase,
      step: entry.step.slice(0, 200),
      status,
      level,
      provider: entry.provider ?? null,
      model: entry.model ? entry.model.slice(0, 200) : null,
      attempt: entry.attempt ?? null,
      duration_ms: entry.durationMs != null ? Math.round(entry.durationMs) : null,
      detail,
      error: clip(entry.error, 4000),
    });
    if (error) console.warn(`[trace] persist failed (${entry.phase}/${entry.step}): ${error.message}`);
  } catch (e) {
    console.warn(`[trace] persist threw (${entry.phase}/${entry.step})`, e);
  }
}

/** Fire-and-forget variant for hot paths (AI router). */
export function traceAsync(entry: TraceEntry): void {
  void trace(entry).catch(() => {});
}

/**
 * Wrap a unit of work: emits `start`, then `ok` with duration, or `error`
 * with the message + first stack frames. Re-throws so control flow is
 * unchanged.
 */
export async function traceSpan<T>(
  entry: Omit<TraceEntry, "status" | "durationMs">,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  await trace({ ...entry, status: "start" });
  try {
    const result = await fn();
    await trace({ ...entry, status: "ok", durationMs: Date.now() - t0 });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    await trace({
      ...entry,
      status: "error",
      durationMs: Date.now() - t0,
      error: err.message,
      detail: {
        ...(entry.detail ?? {}),
        error_name: err.name,
        stack: (err.stack ?? "").split("\n").slice(0, 6).join("\n"),
      },
    });
    throw e;
  }
}

/** Record a database write outcome (captures RLS / constraint violations). */
export async function traceDbWrite(args: {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  rows?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error?: { message?: string; code?: string; details?: string; hint?: string } | null;
  db?: Db;
  caseId?: string;
}): Promise<void> {
  await trace({
    phase: "db",
    step: `${args.op}:${args.table}`,
    status: args.error ? "error" : "ok",
    error: args.error?.message ?? null,
    detail: {
      rows: args.rows ?? null,
      pg_code: args.error?.code ?? null,
      pg_details: args.error?.details ?? null,
      pg_hint: args.error?.hint ?? null,
    },
    db: args.db,
    caseId: args.caseId,
  });
}
