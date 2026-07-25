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

export type AIMessage = { role: "system" | "user" | "assistant"; content: string };

export type AIProvider = {
  chat(opts: {
    model?: string;
    messages: AIMessage[];
    temperature?: number;
    response_format?: { type: "json_object" };
  }): Promise<{ content: string; model: string }>;
};

export function getAIProvider(): AIProvider {
  const key = process.env.LOVABLE_API_KEY;
  return {
    async chat({ model = "google/gemini-2.5-flash", messages, temperature, response_format }) {
      if (!key) throw new Error("LOVABLE_API_KEY not configured");
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, messages, temperature, response_format }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AI gateway ${res.status}: ${body.slice(0, 400)}`);
      }
      const json = (await res.json()) as {
        choices: { message: { content: string } }[];
        model?: string;
      };
      return { content: json.choices?.[0]?.message?.content ?? "", model: json.model ?? model };
    },
  };
}
