// Google Gemini (Generative Language API) adapter.
import {
  AIProvider, ChatOpts, ChatResult, ProviderConfig, ProviderConfigError,
  PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_MS, withTimeout,
} from "./types";
import { withCapabilities } from "./capabilities";
import { aiCallTimeoutForCheckpoint, assertCheckpointBudget } from "../../pipeline-checkpoint.server";

/**
 * Live Flash-class ids tried, in order, when the configured id answers 404
 * NOT_FOUND. Ordered cheapest-and-most-available first. Keeping this here
 * (rather than in the DB row) means a retired id can never permanently break
 * an engine: the adapter self-heals on the next call.
 */
const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

function isModelNotFound(message: string): boolean {
  return (
    /HTTP 404/.test(message) &&
    /(NOT_FOUND|not found|no longer available|is not supported)/i.test(message)
  );
}

function retryAfterHeaderMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(1000, dateMs - Date.now());
  return undefined;
}


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
      // Google retires Generative Language model ids without notice, and a
      // retired id answers with HTTP 404 NOT_FOUND ("no longer available to
      // new users") — a permanent failure that used to kill the whole engine
      // even though other, live Flash ids work with the exact same key.
      // Try the configured id first, then a small ladder of current ids.
      const requested = o.model ?? defaultModel;
      const candidates = [requested, ...GEMINI_MODEL_FALLBACKS].filter(
        (m, i, arr) => !!m && arr.indexOf(m) === i,
      );
      let lastModelError: Error | null = null;
      for (const candidate of candidates) {
        try {
          return await callModel(candidate, o);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (isModelNotFound(err.message)) {
            lastModelError = err;
            continue; // retired/unavailable id — try the next one
          }
          throw err;
        }
      }
      throw lastModelError ?? new Error("gemini: no usable model");
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

  async function callModel(model: string, o: ChatOpts): Promise<ChatResult> {
    {
      const t0 = Date.now();
      assertCheckpointBudget(`before gemini fetch ${model}`);
      const scopedTimeoutMs = aiCallTimeoutForCheckpoint(`gemini fetch ${model}`);
      const timeoutMs = Math.max(1_000, Math.min(o.timeoutMs ?? scopedTimeoutMs ?? PROVIDER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS));
      const to = withTimeout(o.signal, timeoutMs);
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
        throw new Error(to.timedOut() ? `gemini timed out after ${timeoutMs}ms` : (e instanceof Error ? e.message : String(e)));
      }
      to.cancel();
      assertCheckpointBudget(`after gemini fetch ${model}`);
      const latencyMs = Date.now() - t0;
      const providerRequestId =
        res.headers.get("x-request-id") ??
        res.headers.get("x-goog-request-id") ??
        undefined;
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 500);
        const err = new Error(`gemini HTTP ${res.status}: ${text}`);
        (err as unknown as { providerRequestId?: string; retryAfterMs?: number }).providerRequestId = providerRequestId;
        (err as unknown as { providerRequestId?: string; retryAfterMs?: number }).retryAfterMs = retryAfterHeaderMs(
          res.headers.get("retry-after"),
        );
        throw err;
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
        providerRequestId,
      };
    }
  }
}
