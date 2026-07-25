// Google Gemini (Generative Language API) adapter.
import {
  AIProvider, ChatOpts, ChatResult, ProviderConfig, ProviderConfigError,
  PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_MS, withTimeout,
} from "./types";
import { withCapabilities } from "./capabilities";

export function makeGemini(cfg: ProviderConfig): AIProvider {
  const baseUrl = (cfg.baseUrl ?? PROVIDER_DEFAULTS.gemini.baseUrl).replace(/\/+$/, "");
  const defaultModel = cfg.defaultModel ?? PROVIDER_DEFAULTS.gemini.model;
  const key = cfg.apiKey ?? "";

  if (!key) {
    return withCapabilities({
      type: "gemini",
      async chat() { throw new ProviderConfigError("gemini: API key not configured"); },
      async testConnection() { return { ok: false, latencyMs: 0, error: "API key not configured" }; },
    });
  }

  return withCapabilities({
    type: "gemini",
    async chat(o: ChatOpts): Promise<ChatResult> {
      const model = o.model ?? defaultModel;
      const t0 = Date.now();
      const to = withTimeout(o.signal, PROVIDER_TIMEOUT_MS);
      const userText = typeof o.userContent === "string"
        ? o.userContent
        : o.userContent.map(p => p.type === "text" ? p.text : "").join("\n");
      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          temperature: o.temperature ?? 0.2,
          maxOutputTokens: Math.min(o.maxTokens ?? 4096, 8192),
          ...(o.json ? { responseMimeType: "application/json" } : {}),
        },
      };
      if (o.systemInstruction) body.systemInstruction = { parts: [{ text: o.systemInstruction }] };
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: to.signal,
        });
      } catch (e) {
        to.cancel();
        throw new Error(to.timedOut() ? `gemini timed out after ${PROVIDER_TIMEOUT_MS}ms` : (e instanceof Error ? e.message : String(e)));
      }
      to.cancel();
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 500);
        throw new Error(`gemini HTTP ${res.status}: ${text}`);
      }
      const json = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };
      const text = (json.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("");
      if (!text) throw new Error("gemini: empty response");
      return {
        text, model, latencyMs,
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
        totalTokens: json.usageMetadata?.totalTokenCount,
      };
    },
    async testConnection() {
      const t0 = Date.now();
      try {
        const r = await fetch(`${baseUrl}/models?key=${encodeURIComponent(key)}`, { signal: withTimeout(undefined, 8000).signal });
        return { ok: r.ok, latencyMs: Date.now() - t0, error: r.ok ? undefined : `HTTP ${r.status}` };
      } catch (e) {
        return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}
