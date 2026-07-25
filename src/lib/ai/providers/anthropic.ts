// Anthropic Messages API adapter.
import {
  AIProvider, ChatOpts, ChatResult, ProviderConfig, ProviderConfigError,
  PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_MS, withTimeout,
} from "./types";
import { withCapabilities } from "./capabilities";

export function makeAnthropic(cfg: ProviderConfig): AIProvider {
  const baseUrl = (cfg.baseUrl ?? PROVIDER_DEFAULTS.anthropic.baseUrl).replace(/\/+$/, "");
  const defaultModel = cfg.defaultModel ?? PROVIDER_DEFAULTS.anthropic.model;
  const key = cfg.apiKey ?? "";

  if (!key) {
    return withCapabilities({
      type: "anthropic",
      async chat() { throw new ProviderConfigError("anthropic: API key not configured"); },
      async testConnection() { return { ok: false, latencyMs: 0, error: "API key not configured" }; },
    });
  }

  return withCapabilities({
    type: "anthropic",
    async chat(o: ChatOpts): Promise<ChatResult> {
      const model = o.model ?? defaultModel;
      const t0 = Date.now();
      const to = withTimeout(o.signal, PROVIDER_TIMEOUT_MS);
      const userText = typeof o.userContent === "string"
        ? o.userContent
        : o.userContent.map(p => p.type === "text" ? p.text : "").join("\n");
      const body = {
        model,
        max_tokens: Math.min(o.maxTokens ?? 4096, 8192),
        temperature: o.temperature ?? 0.2,
        system: o.systemInstruction,
        messages: [{ role: "user", content: userText }],
      };
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: to.signal,
        });
      } catch (e) {
        to.cancel();
        throw new Error(to.timedOut() ? `anthropic timed out after ${PROVIDER_TIMEOUT_MS}ms` : (e instanceof Error ? e.message : String(e)));
      }
      to.cancel();
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 500);
        throw new Error(`anthropic HTTP ${res.status}: ${text}`);
      }
      const json = await res.json() as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (json.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("");
      if (!text) throw new Error("anthropic: empty response");
      return {
        text, model, latencyMs,
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
        totalTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      };
    },
    async testConnection() {
      const t0 = Date.now();
      try {
        // Use a minimal real call — Anthropic has no /models endpoint
        const r = await fetch(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model: defaultModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
          signal: withTimeout(undefined, 8000).signal,
        });
        return { ok: r.ok, latencyMs: Date.now() - t0, error: r.ok ? undefined : `HTTP ${r.status}` };
      } catch (e) {
        return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}
