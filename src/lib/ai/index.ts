// Phase 8 — canonical AI facade.
//
// Every engine calls exactly one API:
//
//   import { AI } from "@/lib/ai";
//   const res = await AI.generate({ engine: "witness", prompt, responseSchema, temperature });
//
// Runtime execution is Groq-only. The router owns model selection, retries,
// JSON mode, telemetry, cost, and cooldown behavior.

import { routeAI, type RouteResult } from "./router.server";
import type { AITask, ProviderType } from "./providers/types";

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export interface GenerateRequest {
  /** Engine identifier — captured into telemetry and replay metadata. */
  engine: string;
  /** System instruction — sent verbatim to the provider. */
  system?: string;
  /** Prompt / user content. String or multipart. */
  prompt: string;
  /** Zod-like JSON schema (any shape) — its presence triggers JSON mode. */
  responseSchema?: unknown;
  /** Sampling temperature. Defaults to 0.2. */
  temperature?: number;
  /** Max tokens for the completion. */
  maxTokens?: number;
  /** Reasoning intensity hint. Providers without reasoning ignore it. */
  reasoningLevel?: ReasoningLevel;
  /** Task hint used by DB-driven task routing. */
  task?: AITask;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Disable in-memory cache lookup for this call. */
  cache?: boolean;
  /** Runtime key overrides (e.g. per-user Groq keys). */
  apiKey?: string;
  apiKeys?: string[];
}

export interface GenerateResult {
  text: string;
  provider: ProviderType;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  cached?: boolean;
  retryCount?: number;
  fellBackFrom?: ProviderType[];
  /** Parsed JSON when responseSchema was supplied and parse succeeded. */
  json?: unknown;
}

/**
 * Read AI_PROVIDER / AI_MODEL env config. Phase 8 exit criterion: swapping
 * these two env vars changes the executing provider with no code changes.
 */
function envSelection(): { provider?: ProviderType; model?: string } {
  const providerRaw = process.env.AI_PROVIDER?.trim().toLowerCase();
  const model = process.env.AI_MODEL?.trim() || undefined;
  const provider = providerRaw === "groq" ? "groq" as ProviderType : undefined;
  return { provider, model };
}

export const AI = {
  /**
   * Canonical entry point. All engine code should call this — never routeAI,
   * callGroq, or a provider adapter directly.
   */
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const env = envSelection();
    const forceProvider = env.provider;
    const model = req.responseSchema ? (env.model ?? undefined) : env.model;

    const wantsJson = Boolean(req.responseSchema);

    const r: RouteResult = await routeAI({
      systemInstruction: req.system,
      userContent: req.prompt,
      model,
      json: wantsJson,
      temperature: req.temperature ?? 0.2,
      maxTokens: req.maxTokens,
      signal: req.signal,
      task: req.task,
      cache: req.cache,
      forceProvider,
      apiKey: req.apiKey,
      apiKeys: req.apiKeys,
    });

    let json: unknown;
    if (wantsJson) {
      try {
        json = JSON.parse(r.text);
      } catch {
        // Fall back to loose extraction; engines that need strict parsing
        // should validate `json` themselves against their schema.
        const m = r.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (m) { try { json = JSON.parse(m[0]); } catch { /* noop */ } }
      }
    }

    return {
      text: r.text,
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      latencyMs: r.latencyMs,
      cached: r.cached,
      retryCount: r.retryCount,
      fellBackFrom: r.fellBackFrom,
      json,
    };
  },
};

export type { ProviderType, AITask };
