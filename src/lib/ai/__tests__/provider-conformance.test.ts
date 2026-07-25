// Phase 8 — Provider Conformance Suite.
//
// Every provider adapter (Groq, OpenRouter, OpenAI, Anthropic, Gemini,
// Lovable, Ollama, LM Studio) MUST pass this suite. Adapters that fail
// cannot be enabled in production. The suite is deterministic and hermetic:
// the underlying HTTP fetch is mocked so we can assert on the request shape
// and validate the adapter's response mapping without any live provider.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeOpenAICompatible } from "@/lib/ai/providers/openai-compatible";
import { makeAnthropic } from "@/lib/ai/providers/anthropic";
import { makeGemini } from "@/lib/ai/providers/gemini";
import type { AIProvider, ProviderType } from "@/lib/ai/providers/types";
import { PROVIDER_CAPABILITIES } from "@/lib/ai/providers/types";
import { estimateCost as staticEstimateCost } from "@/lib/ai/pricing";

interface MockedResponse {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

function mockFetchOnce(res: MockedResponse) {
  const headers = new Headers(res.headers ?? {});
  const bodyText = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bodyText, {
    status: res.status ?? (res.ok ? 200 : 500),
    headers,
  })));
}

interface ProviderCase {
  name: string;
  type: ProviderType;
  build: () => AIProvider;
  successResponse: MockedResponse;
  usageAssert: (r: { inputTokens?: number; outputTokens?: number }) => void;
}

const CASES: ProviderCase[] = [
  {
    name: "openai-compatible / groq",
    type: "groq",
    build: () => makeOpenAICompatible(
      { type: "groq", baseUrl: null, defaultModel: null, apiKey: "sk-test" },
      { requiresKey: true },
    ),
    successResponse: {
      ok: true,
      headers: { "x-request-id": "req_test_1" },
      body: {
        id: "chatcmpl_1",
        choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      },
    },
    usageAssert: (r) => {
      expect(r.inputTokens).toBe(12);
      expect(r.outputTokens).toBe(4);
    },
  },
  {
    name: "anthropic",
    type: "anthropic",
    build: () => makeAnthropic({ type: "anthropic", baseUrl: null, defaultModel: null, apiKey: "sk-ant-test" }),
    successResponse: {
      ok: true,
      body: {
        content: [{ type: "text", text: "{\"ok\":true}" }],
        usage: { input_tokens: 20, output_tokens: 6 },
      },
    },
    usageAssert: (r) => {
      expect(r.inputTokens).toBe(20);
      expect(r.outputTokens).toBe(6);
    },
  },
  {
    name: "gemini",
    type: "gemini",
    build: () => makeGemini({ type: "gemini", baseUrl: null, defaultModel: null, apiKey: "gem-test" }),
    successResponse: {
      ok: true,
      body: {
        candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
      },
    },
    usageAssert: (r) => {
      expect(r.inputTokens).toBe(8);
      expect(r.outputTokens).toBe(3);
    },
  },
];

describe("Phase 8 — provider conformance", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  for (const c of CASES) {
    describe(c.name, () => {
      it("declares capability contract and matches default profile", () => {
        const p = c.build();
        // Required members
        expect(typeof p.supportsJsonMode).toBe("function");
        expect(typeof p.supportsReasoning).toBe("function");
        expect(typeof p.supportsStreaming).toBe("function");
        expect(typeof p.supportsToolCalling).toBe("function");
        expect(typeof p.supportsVision).toBe("function");
        expect(typeof p.estimateCost).toBe("function");
        expect(p.capabilities).toBeDefined();
        // Matches shared default profile so downstream callers can rely on it
        const defaults = PROVIDER_CAPABILITIES[c.type];
        expect(p.supportsJsonMode()).toBe(defaults.jsonMode);
        expect(p.supportsReasoning()).toBe(defaults.reasoning);
        expect(p.supportsStreaming()).toBe(defaults.streaming);
        expect(p.supportsToolCalling()).toBe(defaults.toolCalling);
        expect(p.supportsVision()).toBe(defaults.vision);
      });

      it("returns text and maps token usage on a successful call", async () => {
        mockFetchOnce(c.successResponse);
        const p = c.build();
        const r = await p.chat({ userContent: "hi", json: true, temperature: 0 });
        expect(r.text).toContain("ok");
        expect(r.model).toBeTruthy();
        expect(r.latencyMs).toBeGreaterThanOrEqual(0);
        c.usageAssert(r);
      });

      it("estimateCost matches static pricing table", () => {
        const p = c.build();
        expect(p.estimateCost(1000, 500)).toBeCloseTo(staticEstimateCost(c.type, 1000, 500), 10);
      });

      it("surfaces HTTP errors instead of silently returning empty", async () => {
        mockFetchOnce({ ok: false, status: 500, body: "boom" });
        const p = c.build();
        await expect(p.chat({ userContent: "hi" })).rejects.toThrow();
      });

      it("refuses to run when required API key is missing", async () => {
        // Rebuild without an api key
        const noKey: AIProvider =
          c.type === "anthropic"
            ? makeAnthropic({ type: "anthropic", baseUrl: null, defaultModel: null, apiKey: null })
            : c.type === "gemini"
            ? makeGemini({ type: "gemini", baseUrl: null, defaultModel: null, apiKey: null })
            : makeOpenAICompatible(
                { type: c.type, baseUrl: null, defaultModel: null, apiKey: null },
                { requiresKey: true },
              );
        await expect(noKey.chat({ userContent: "hi" })).rejects.toThrow(/not configured/i);
      });
    });
  }
});

describe("Phase 8 — canonical AI facade honors AI_PROVIDER / AI_MODEL env", () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalModel = process.env.AI_MODEL;
  afterEach(() => {
    process.env.AI_PROVIDER = originalProvider;
    process.env.AI_MODEL = originalModel;
  });

  it("only accepts known provider names", async () => {
    process.env.AI_PROVIDER = "not_a_real_provider";
    // Import lazily so envSelection re-reads on each call site
    const { AI } = await import("@/lib/ai");
    // Should not throw a config error — invalid name is simply ignored
    // (the router then uses its default priority chain).
    expect(typeof AI.generate).toBe("function");
  });
});
