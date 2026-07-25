/**
 * Provider shim — Phase 1 landing zone.
 *
 * The full US multi-provider fallback router lives under `src/lib/ai/router.server.ts`
 * (ported in Phase 1, excluded from typecheck until Phase 4 schema parity is done).
 * This shim keeps `pipeline.functions.ts` and `test-cases.functions.ts` running
 * against the Lovable AI Gateway with the previous single-provider behavior.
 * It will be replaced by the ported router in Phase 2.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string | AIContentPart[];
};

export type AIChatOptions = {
  model?: string;
  temperature?: number;
};

export type AIProvider = {
  chat(
    messages: AIMessage[],
    opts?: AIChatOptions,
  ): Promise<{ content: string; model: string }>;
  chatJSON<T = unknown>(
    messages: AIMessage[],
    opts?: AIChatOptions,
  ): Promise<{ content: T; model: string }>;
};

async function raw(
  messages: AIMessage[],
  opts: AIChatOptions & { response_format?: { type: "json_object" } },
): Promise<{ content: string; model: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const model = opts.model ?? "google/gemini-2.5-flash";
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature,
      response_format: opts.response_format,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI gateway ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
  };
  return {
    content: json.choices?.[0]?.message?.content ?? "",
    model: json.model ?? model,
  };
}

function extractJSON(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

export function getAIProvider(): AIProvider {
  return {
    async chat(messages, opts = {}) {
      return raw(messages, opts);
    },
    async chatJSON<T>(messages: AIMessage[], opts: AIChatOptions = {}) {
      const { content, model } = await raw(messages, {
        ...opts,
        response_format: { type: "json_object" },
      });
      const parsed = JSON.parse(extractJSON(content)) as T;
      return { content: parsed, model };
    },
  };
}
