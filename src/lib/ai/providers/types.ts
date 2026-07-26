// Groq provider interface. Server-only.
// Runtime execution is Groq-only; legacy adapters are not registered in the router.

export type ProviderType = "groq" | "openai" | "anthropic" | "gemini" | "openrouter" | "lovable" | "ollama" | "lmstudio";

export type AITask = "extraction" | "analysis" | "reasoning" | "report" | "chat";

export type AIContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface ChatOpts {
  systemInstruction?: string;
  userContent: AIContent;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  model?: string; // override provider's default
}

export interface ChatResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model: string;
  latencyMs: number;
  /** Provider-reported request id (e.g. OpenAI `x-request-id`). Undefined when not returned. */
  providerRequestId?: string;
}

export interface ProviderConfig {
  type: ProviderType;
  baseUrl?: string | null;
  defaultModel?: string | null;
  apiKey?: string | null; // resolved from secret_name
}

// Phase 8 — capability contract. Engines must never `if (provider === "groq")`;
// they interrogate capabilities: `if (provider.supportsJsonMode()) ...`.
// Every adapter declares the same shape so the router (and any downstream
// caller) can select behavior by capability, not by name.
export interface ProviderCapabilities {
  jsonMode: boolean;
  reasoning: boolean;
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  maxContextTokens: number;
}

export interface AIProvider {
  type: ProviderType;
  capabilities: ProviderCapabilities;
  chat(opts: ChatOpts): Promise<ChatResult>;
  testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
    organization?: string;
    requestId?: string;
    model?: string;
  }>;
  supportsJsonMode(): boolean;
  supportsReasoning(): boolean;
  supportsStreaming(): boolean;
  supportsToolCalling(): boolean;
  supportsVision(): boolean;
  estimateCost(inputTokens: number, outputTokens: number): number;
}

// Default capability profile per provider type. Adapters may override.
export const PROVIDER_CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
  groq: {
    jsonMode: true,
    reasoning: false,
    streaming: true,
    toolCalling: true,
    vision: false,
    maxContextTokens: 128_000,
  },
  openai: {
    jsonMode: true,
    reasoning: true,
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 128_000,
  },
  anthropic: {
    jsonMode: false,
    reasoning: true,
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 200_000,
  },
  gemini: {
    jsonMode: true,
    reasoning: true,
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 1_000_000,
  },
  openrouter: {
    jsonMode: true,
    reasoning: true,
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 128_000,
  },
  lovable: {
    jsonMode: true,
    reasoning: true,
    streaming: true,
    toolCalling: true,
    vision: true,
    maxContextTokens: 1_000_000,
  },
  ollama: {
    jsonMode: true,
    reasoning: false,
    streaming: true,
    toolCalling: false,
    vision: false,
    maxContextTokens: 32_000,
  },
  lmstudio: {
    jsonMode: true,
    reasoning: false,
    streaming: true,
    toolCalling: false,
    vision: false,
    maxContextTokens: 32_000,
  },
};

export class ProviderConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderConfigError";
  }
}

export const PROVIDER_DEFAULTS: Record<ProviderType, { baseUrl: string; model: string; secretName: string | null }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", secretName: "GROQ_API_KEY" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", secretName: "OPENAI_API_KEY" },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest",
    secretName: "ANTHROPIC_API_KEY",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    secretName: "GEMINI_API_KEY",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    secretName: "OPENROUTER_API_KEY",
  },
  // Lovable AI Gateway — platform-managed capacity. No user key required:
  // LOVABLE_API_KEY is injected server-side, so this provider is the
  // always-available fallback when user keys hit quota.
  lovable: {
    baseUrl: "https://ai.gateway.lovable.dev/v1",
    model: "google/gemini-3.6-flash",
    secretName: "LOVABLE_API_KEY",
  },
  ollama: { baseUrl: "http://localhost:11434", model: "llama3.1:8b", secretName: null },
  lmstudio: { baseUrl: "http://localhost:1234/v1", model: "qwen2.5-7b-instruct", secretName: null },
};

// 2026-07 audit: was 16_000ms — a hard ceiling every provider call obeyed
// regardless of how much checkpoint budget was actually left. Reasoning
// models (e.g. Groq's gpt-oss-120b, used for report generation) routinely
// need more than 16s to produce several thousand tokens of structured JSON,
// so report calls timed out on every attempt, deterministically, forever.
// Keep this in sync with MAX_AI_CALL_TIMEOUT_MS in pipeline-checkpoint.server.ts.
export const PROVIDER_TIMEOUT_MS = 26_000;

export function withTimeout(parent: AbortSignal | undefined, ms: number) {
  const ac = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, ms);
  const onParent = () => ac.abort();
  if (parent) {
    if (parent.aborted) ac.abort();
    else parent.addEventListener("abort", onParent, { once: true });
  }
  return {
    signal: ac.signal,
    cancel: () => {
      clearTimeout(t);
      if (parent) parent.removeEventListener("abort", onParent);
    },
    timedOut: () => timedOut,
  };
}

export function buildOAIMessages(opts: ChatOpts) {
  const messages: Array<{ role: string; content: AIContent }> = [];
  if (opts.systemInstruction) messages.push({ role: "system", content: opts.systemInstruction });
  messages.push({ role: "user", content: opts.userContent });
  return messages;
}
