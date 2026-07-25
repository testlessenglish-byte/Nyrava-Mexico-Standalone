// Shared OpenAI-compatible provider used by Groq, OpenRouter, OpenAI, Ollama,
// and LM Studio. Provider-specific tweaks (headers, default URL) are passed in.

import {
  AIProvider, ChatOpts, ChatResult, ProviderConfig, ProviderConfigError,
  PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_MS, withTimeout, buildOAIMessages,
} from "./types";
import { withCapabilities } from "./capabilities";
import { aiCallTimeoutForCheckpoint, assertCheckpointBudget } from "../../pipeline-checkpoint.server";

export interface OAICompatOpts {
  requiresKey: boolean;
  extraHeaders?: Record<string, string>;
}

export function makeOpenAICompatible(cfg: ProviderConfig, opts: OAICompatOpts): AIProvider {
  const baseUrl = (cfg.baseUrl ?? PROVIDER_DEFAULTS[cfg.type].baseUrl).replace(/\/+$/, "");
  const defaultModel = cfg.defaultModel ?? PROVIDER_DEFAULTS[cfg.type].model;
  const key = cfg.apiKey ?? "";

  if (opts.requiresKey && !key) {
    return withCapabilities({
      type: cfg.type,
      async chat() { throw new ProviderConfigError(`${cfg.type}: API key not configured`); },
      async testConnection() { return { ok: false, latencyMs: 0, error: "API key not configured" }; },
    });
  }

  async function rawCall(body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatResult> {
    const model = String(body.model);
    const t0 = Date.now();
    assertCheckpointBudget(`before ${cfg.type} fetch ${model}`);
    const scopedTimeoutMs = aiCallTimeoutForCheckpoint(`${cfg.type} fetch ${model}`);
    const requestedTimeoutMs = Number(body.__timeoutMs ?? scopedTimeoutMs ?? PROVIDER_TIMEOUT_MS);
    const timeoutMs = Math.max(1_000, Math.min(requestedTimeoutMs, PROVIDER_TIMEOUT_MS));
    delete body.__timeoutMs;
    const to = withTimeout(signal, timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(opts.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: to.signal,
      });
    } catch (e) {
      to.cancel();
      throw new Error(to.timedOut()
        ? `${cfg.type} timed out after ${timeoutMs}ms`
        : (e instanceof Error ? e.message : String(e)));
    }
    to.cancel();
    assertCheckpointBudget(`after ${cfg.type} fetch ${model}`);
    const latencyMs = Date.now() - t0;
    // Capture provider-reported request id when present. OpenAI returns
    // `x-request-id`; OpenRouter returns `x-request-id`; Groq returns
    // `x-request-id` too. Anthropic uses `request-id`. If a provider omits
    // it entirely we record undefined — never fabricated.
    const providerRequestId =
      res.headers.get("x-request-id") ??
      res.headers.get("request-id") ??
      res.headers.get("openai-request-id") ??
      undefined;
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 500);
      const err = new Error(`${cfg.type} HTTP ${res.status}: ${text}`);
      (err as unknown as { providerRequestId?: string }).providerRequestId = providerRequestId ?? undefined;
      throw err;
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      id?: string;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) {
      const fr = json.choices?.[0]?.finish_reason ?? "no choices";
      throw new Error(`${cfg.type}: empty response (finish_reason=${fr}, model=${model})`);
    }
    return {
      text,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      totalTokens: json.usage?.total_tokens,
      latencyMs, model,
      providerRequestId: providerRequestId ?? json.id ?? undefined,
    };
  }


  return withCapabilities({
    type: cfg.type,
    async chat(o: ChatOpts) {
      const body: Record<string, unknown> = {
        model: o.model ?? defaultModel,
        messages: buildOAIMessages(o),
        temperature: o.temperature ?? 0.2,
      };
      if (o.timeoutMs) body.__timeoutMs = o.timeoutMs;
      if (o.maxTokens) body.max_tokens = Math.min(o.maxTokens, 8192);
      if (o.json) body.response_format = { type: "json_object" };
      return rawCall(body, o.signal);
    },
    async testConnection() {
      const t0 = Date.now();
      // Validate using a minimal chat completion against the SAME endpoint
      // the runtime uses. /models is unreliable across providers (Groq keys
      // with scoped permissions return 401/403 on /models but work fine for
      // chat completions). Capture provider org + request-id headers so the
      // probe result can be cross-checked against production telemetry.
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
            ...(opts.extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model: defaultModel,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
            temperature: 0,
          }),
          signal: withTimeout(undefined, 10000).signal,
        });
        const organization =
          res.headers.get("x-groq-organization") ??
          res.headers.get("openai-organization") ??
          res.headers.get("x-organization") ??
          res.headers.get("x-organization-id") ??
          undefined;
        const requestId =
          res.headers.get("x-request-id") ??
          res.headers.get("request-id") ??
          undefined;
        if (res.ok) return { ok: true, latencyMs: Date.now() - t0, organization, requestId, model: defaultModel };
        const body = (await res.text().catch(() => "")).slice(0, 400);
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          error: `HTTP ${res.status}${body ? `: ${body}` : ""}`,
          organization,
          requestId,
          model: defaultModel,
        };
      } catch (e) {
        return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}
