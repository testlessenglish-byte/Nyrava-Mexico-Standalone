// Backwards-compat shim. All AI traffic is Groq-only and flows through
// src/lib/ai/router.server.ts (same telemetry, same fingerprint). This file
// preserves legacy `callGroq` / `pingProvider` exports while keeping non-Groq
// providers structurally unreachable from execution paths.

import { routeAI, getRouterDiagnostics, listProviderRows, type RouteResult } from "./ai/router.server";
import { buildProvider } from "./ai/providers/factory";
import type { AIContent, AITask, ProviderType } from "./ai/providers/types";

const GROQ_DEFAULT = "openai/gpt-oss-120b";

export const GROQ_DEFAULT_MODEL = GROQ_DEFAULT;
export const GROQ_PROVIDER_LABEL = "Groq";
export const GROQ_MODEL_LABEL = GROQ_DEFAULT;

export type ProviderId = ProviderType;
export type ProviderMode = "auto" | ProviderType;
export type GroqContent = AIContent;

export interface GroqCallOpts {
  apiKey?: string;
  apiKeys?: string[];
  model?: string;
  systemInstruction?: string;
  userContent: AIContent;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  forceProvider?: ProviderType;
  skipProviders?: ProviderType[];
  cache?: boolean;
  mode?: ProviderMode;
  task?: AITask;
  /** Provider the runtime apiKey(s) belong to. Defaults to "groq". */
  runtimeProvider?: ProviderType;
  /** User id — when set, loads active provider keys from user_ai_keys. */
  userId?: string;
}

export class CancelledError extends Error {
  readonly kind = "cancelled" as const;
  constructor() {
    super("Cancelled by user");
    this.name = "CancelledError";
  }
}

export class GroqQuotaError extends Error {
  readonly kind = "quota_exhausted" as const;
  readonly status: number;
  constructor(message: string, status = 429) {
    super(message);
    this.name = "GroqQuotaError";
    this.status = status;
  }
}

export class GroqAuthError extends Error {
  readonly kind = "auth_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "GroqAuthError";
  }
}

export class GroqNoKeyError extends Error {
  readonly kind = "no_key" as const;
  constructor() {
    super("No AI provider configured. Open Admin → AI Providers to add a provider and API key.");
    this.name = "GroqNoKeyError";
  }
}

export interface GroqResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  model: string;
  provider: ProviderType;
  fellBackFrom?: ProviderType[];
  keyIndex?: number;
  cached?: boolean;
}

function toGroqResult(r: RouteResult): GroqResult {
  return {
    text: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    model: r.model,
    provider: r.provider,
    fellBackFrom: r.fellBackFrom,
    keyIndex: r.keyIndex,
    cached: r.cached,
  };
}

export async function callGroq(opts: GroqCallOpts): Promise<GroqResult> {
  // Resolve mode → forceProvider
  let force: ProviderType | undefined;
  if (opts.forceProvider) force = opts.forceProvider;
  else if (opts.mode && opts.mode !== "auto") force = opts.mode;

  // Resolve ambient user scope (set by pipeline runner via withAIUser). This
  // is always resolved — not just when no apiKey/apiKeys were passed —
  // because the router uses userId to find *fallback* provider keys
  // (Gemini/OpenAI/OpenRouter/Anthropic) even when a primary Groq apiKeys
  // chain is already present. Without this, non-Groq keys added in AI
  // Provider Keys were silently never used.
  let userId = opts.userId;
  if (!userId) {
    const { getCurrentAIUser } = await import("./ai/user-scope.server");
    userId = getCurrentAIUser();
  }

  try {
    const r = await routeAI({
      systemInstruction: opts.systemInstruction,
      userContent: opts.userContent,
      model: opts.model,
      json: opts.json,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      task: opts.task,
      cache: opts.cache,
      skipProviders: opts.skipProviders,
      forceProvider: force,
      apiKey: opts.apiKey,
      apiKeys: opts.apiKeys,
      runtimeProvider: opts.runtimeProvider,
      userId,
    });
    return toGroqResult(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no ai providers|no enabled|not configured|no enabled ai providers/i.test(msg)) {
      throw new GroqNoKeyError();
    }
    if (/HTTP 429/.test(msg) || /quota/i.test(msg) || /rate.?limit/i.test(msg)) {
      throw new GroqQuotaError(msg, 429);
    }
    if (/HTTP 401/.test(msg) || /HTTP 403/.test(msg) || /unauthor/i.test(msg)) {
      throw new GroqAuthError(msg);
    }
    throw e;
  }
}

export function getLlmDiagnostics() {
  const d = getRouterDiagnostics();
  return {
    ...d,
    providers: {
      groq: { configured: Boolean(process.env.GROQ_API_KEY), ...(d.byProvider.groq ?? { totalOk: 0, totalErr: 0 }) },
    },
  };
}

export async function pingProvider(
  id: ProviderId = "groq",
  apiKey?: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  // If a candidate apiKey is supplied (e.g. validating a key the user is
  // about to save), test THAT key directly — do NOT fall back to the stored
  // row, which would test a different key.
  if (apiKey) {
    const rows = await listProviderRows();
    const row = rows.find((r) => r.provider_type === id);
    const cfg = {
      type: id,
      apiKey,
      baseUrl: row?.base_url ?? null,
      defaultModel: row?.default_model ?? null,
    };
    const { makeOpenAICompatible } = await import("./ai/providers/openai-compatible");
    return makeOpenAICompatible(cfg, { requiresKey: true }).testConnection();
  }
  const rows = await listProviderRows();
  const row = rows.find((r) => r.provider_type === id);
  if (!row) return { ok: false, latencyMs: 0, error: `${id} not configured` };
  return buildProvider(row).testConnection();
}

export function assertEnv(): { ok: boolean; missing: string[] } {
  const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export function parseJsonLoose<T = unknown>(text: string): T | null {
  // Instrumented for Phase 6.5: every parse attempt is recorded on the
  // current engine's telemetry scope so response_valid_json / repair_attempts
  // / repair_strategy are captured verbatim, never inferred. Safe no-op
  // outside a telemetry scope.
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const record = (ok: boolean, attempts: number, strategy: string | null, reason: string | null) => {
    // Dynamic import to avoid a hard dep between groq.server and telemetry.
    import("./ai/telemetry.server")
      .then(({ recordJsonValidation }) =>
        recordJsonValidation({
          responseValidJson: ok,
          repairAttempts: attempts,
          repairStrategy: strategy,
          repairReason: reason,
          bytes: text.length,
        }),
      )
      .catch(() => {
        /* noop */
      });
  };
  try {
    const v = JSON.parse(cleaned) as T;
    record(true, 0, "none", null);
    return v;
  } catch (e1) {
    const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        const v = JSON.parse(m[0]) as T;
        record(true, 1, "regex-extract-braces", (e1 as Error)?.message?.slice(0, 200) ?? null);
        return v;
      } catch (e2) {
        record(false, 2, "regex-extract-braces", (e2 as Error)?.message?.slice(0, 200) ?? null);
        return null;
      }
    }
    record(false, 1, "none", (e1 as Error)?.message?.slice(0, 200) ?? null);
    return null;
  }
}
