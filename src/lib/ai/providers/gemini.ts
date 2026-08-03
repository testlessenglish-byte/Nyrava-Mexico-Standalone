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
 * Live Flash-class ids tried when the configured id is unusable on this key —
 * either retired (HTTP 404 NOT_FOUND) or carrying a hard-zero free-tier quota
 * (HTTP 429 with `limit: 0`, which Google returns for models whose free tier
 * has been withdrawn, e.g. gemini-2.0-flash). A zero-quota model 429s
 * instantly on a brand-new key, so it must switch models, not cool down the key.
 */
const GEMINI_MODEL_FALLBACKS = [
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
] as const;

function isModelNotFound(message: string): boolean {
  return (
    /HTTP 404/.test(message) &&
    /(NOT_FOUND|not found|no longer available|is not supported)/i.test(message)
  );
}

/**
 * True when a 429 says this *model* has no free-tier allowance at all
 * (`limit: 0`). This is not rate limiting — retrying or waiting never helps;
 * only a different model id does.
 */
function isZeroQuotaModel(message: string): boolean {
  return /HTTP 429/.test(message) && /limit:\s*0\b/.test(message);
}

/**
 * Model ids proven unusable on this deployment (retired, or free tier removed).
 * Process-local so one discovery spares every later call the wasted round-trip.
 */
const UNUSABLE_MODELS = new Set<string>();




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
      // Google retires model ids and withdraws free-tier quota without notice:
      // a retired id answers 404 NOT_FOUND, a withdrawn free tier answers 429
      // with `limit: 0`. Both are rejected before any tokens are billed, so we
      // may walk a short ladder (max 3 ids) without burning real quota.
      const requested = o.model ?? defaultModel;
      const candidates = [requested, ...GEMINI_MODEL_FALLBACKS]
        .filter((m, i, arr): m is string => typeof m === "string" && m.length > 0 && arr.indexOf(m) === i)
        .filter((m) => !UNUSABLE_MODELS.has(m) || m === requested)
        .slice(0, 3);
      let lastModelError: Error | null = null;
      for (const candidate of candidates) {
        try {
          const result = await callModel(candidate, o);
          UNUSABLE_MODELS.delete(candidate);
          return result;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (isModelNotFound(err.message) || isZeroQuotaModel(err.message)) {
            // Remember it so later calls in this process skip the dead id.
            UNUSABLE_MODELS.add(candidate);
            lastModelError = err;
            continue;
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
      const userText = typeof o.userContent === "string"
        ? o.userContent
        : o.userContent.map(p => p.type === "text" ? p.text : "").join("\n");

      const buildBody = (includeThinkingConfig: boolean): Record<string, unknown> => {
        const body: Record<string, unknown> = {
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            temperature: o.temperature ?? 0.2,
            maxOutputTokens: Math.min(o.maxTokens ?? 4096, 8192),
            ...(o.json ? { responseMimeType: "application/json" } : {}),
            // JSON-mode callers (analyzers, scoring, report structuring, etc.)
            // need reliable structured extraction, not open-ended reasoning.
            // Without this, "thinking" models (gemini-flash-latest and similar)
            // spend most/all of maxOutputTokens on invisible internal reasoning
            // before writing the JSON, leaving a small, roughly constant
            // remainder for the actual answer — a technically-successful call
            // (ok:true) that returns next to nothing, on every call, regardless
            // of prompt size. See docs incident trace 2026-08-02 (analyzers
            // stage returning empty findings for every case that drew Gemini).
            ...(o.json && includeThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        };
        if (o.systemInstruction) body.systemInstruction = { parts: [{ text: o.systemInstruction }] };
        return body;
      };

      // 2026-08-03: `thinkingConfig` isn't uniformly supported across every
      // model/alias behind "gemini-flash-latest" — Google silently rotates
      // what that alias resolves to, and not every generation recognizes the
      // field. When it doesn't, Gemini rejects the ENTIRE request with a
      // generic, undetailed "HTTP 400: Request contains an invalid
      // argument." — indistinguishable from any other malformed-request 400
      // from the message alone. This was firing on effectively every single
      // JSON-mode call across every engine in a real production session
      // (confirmed via pipeline_engine_runs telemetry — analyzers, theory,
      // witness_credibility, report_generator all showed the identical
      // error on both configured keys before falling back to openrouter),
      // silently doubling or tripling the latency of nearly every pipeline
      // stage and making long operations (like a full case Rerun) feel like
      // they'd hung even though they were still grinding forward through
      // fallback providers. Retrying the SAME model once with the
      // thinking-disable field simply omitted (a request shape every Gemini
      // model accepts) is a targeted, low-risk recovery: if the 400 was
      // caused by something else entirely, this retry just fails the same
      // way and falls through to the existing provider-fallback chain
      // unchanged — it cannot make a genuine failure worse, and it directly
      // removes the most common source of wasted round-trips when it is the
      // cause.
      const doFetch = async (includeThinkingConfig: boolean) => {
        const body = buildBody(includeThinkingConfig);
        const to = withTimeout(o.signal, timeoutMs);
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
        return { res, aiCallId, promptSha256, engine };
      };

      let { res, aiCallId, promptSha256, engine } = await doFetch(Boolean(o.json));
      if (!res.ok && res.status === 400 && o.json) {
        const probe = (await res.clone().text().catch(() => "")).toLowerCase();
        if (probe.includes("invalid argument")) {
          const retried = await doFetch(false);
          res = retried.res;
          aiCallId = retried.aiCallId;
          promptSha256 = retried.promptSha256;
          engine = retried.engine;
        }
      }

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
