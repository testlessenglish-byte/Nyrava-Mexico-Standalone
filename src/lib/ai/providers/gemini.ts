// Google Gemini (Generative Language API) adapter.
import { createHash } from "node:crypto";
import {
  AIProvider, ChatOpts, ChatResult, ProviderConfig, ProviderConfigError,
  PROVIDER_DEFAULTS, PROVIDER_TIMEOUT_MS, withTimeout,
} from "./types";
import { withCapabilities } from "./capabilities";
import { aiCallTimeoutForCheckpoint, assertCheckpointBudget } from "../../pipeline-checkpoint.server";
import { currentTelemetryScope } from "../telemetry.server";
import { traceAsync } from "../../pipeline-trace.server";

/**
 * Single live Flash-class fallback tried when the configured id answers 404
 * NOT_FOUND. We deliberately cap this to one fallback so a retired model slug
 * cannot multiply one logical engine call into several real Gemini requests.
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

function hashBody(body: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
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
      // retired id answers with HTTP 404 NOT_FOUND. Try the configured id once,
      // then exactly one fallback; do not walk the whole ladder and burn quota.
      const requested = o.model ?? defaultModel;
      const fallback = GEMINI_MODEL_FALLBACKS.find((m) => m !== requested);
      const candidates = [requested, fallback].filter(
        (m, i, arr): m is string => typeof m === "string" && m.length > 0 && arr.indexOf(m) === i,
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
      const aiCallId = `gemini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const promptSha256 = hashBody(body);
      const engine = currentTelemetryScope()?.replay?.engine;
      let res: Response;
      try {
        traceAsync({
          phase: "ai",
          step: "provider.request",
          status: "start",
          provider: "gemini",
          model,
          detail: { ai_call_id: aiCallId, engine: typeof engine === "string" ? engine : null, prompt_sha256: promptSha256 },
        });
        res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: to.signal,
        });
      } catch (e) {
        to.cancel();
        const message = to.timedOut() ? `gemini timed out after ${timeoutMs}ms` : (e instanceof Error ? e.message : String(e));
        traceAsync({
          phase: "ai",
          step: "provider.request",
          status: "error",
          provider: "gemini",
          model,
          durationMs: Date.now() - t0,
          error: message,
          detail: { ai_call_id: aiCallId, engine: typeof engine === "string" ? engine : null, prompt_sha256: promptSha256 },
        });
        throw new Error(message);
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
        traceAsync({
          phase: "ai",
          step: "provider.request",
          status: "error",
          provider: "gemini",
          model,
          durationMs: latencyMs,
          error: err.message,
          detail: {
            ai_call_id: aiCallId,
            engine: typeof engine === "string" ? engine : null,
            prompt_sha256: promptSha256,
            http_status: res.status,
            retry_after_ms: (err as unknown as { retryAfterMs?: number }).retryAfterMs ?? null,
          },
        });
        throw err;
      }
      const json = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      };
      const text = (json.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("");
      if (!text) throw new Error("gemini: empty response");
      traceAsync({
        phase: "ai",
        step: "provider.request",
        status: "ok",
        provider: "gemini",
        model,
        durationMs: latencyMs,
        detail: {
          ai_call_id: aiCallId,
          engine: typeof engine === "string" ? engine : null,
          prompt_sha256: promptSha256,
          input_tokens: json.usageMetadata?.promptTokenCount ?? null,
          output_tokens: json.usageMetadata?.candidatesTokenCount ?? null,
          total_tokens: json.usageMetadata?.totalTokenCount ?? null,
          provider_request_id: providerRequestId ?? null,
        },
      });
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
