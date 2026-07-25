/**
 * AI provider abstraction.
 *
 * The intelligence layer never talks to a vendor directly. It calls the
 * `AIProvider` interface, and the default implementation routes to Lovable AI
 * Gateway (OpenAI-compatible). Future providers (local models, enterprise
 * models, per-firm models) plug in behind the same shape.
 *
 * Server-only. Do NOT import from browser code.
 */

export type AIMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string | AIMessagePart[];
};

export type AIChatOptions = {
  model?: string;
  temperature?: number;
  response_format?: { type: "json_object" };
  max_tokens?: number;
};

export type AIChatResponse<T = string> = {
  content: T;
  model: string;
  tokens_used?: number;
};

export interface AIProvider {
  readonly name: string;
  chat(messages: AIMessage[], opts?: AIChatOptions): Promise<AIChatResponse<string>>;
  chatJSON<T = unknown>(messages: AIMessage[], opts?: AIChatOptions): Promise<AIChatResponse<T>>;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

class LovableGatewayProvider implements AIProvider {
  readonly name = "lovable-gateway";

  private async call(messages: AIMessage[], opts: AIChatOptions = {}) {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const body = {
      model: opts.model ?? DEFAULT_MODEL,
      messages,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.max_tokens != null ? { max_tokens: opts.max_tokens } : {}),
      ...(opts.response_format ? { response_format: opts.response_format } : {}),
    };
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI provider rate-limited (429). Reintente en unos segundos.");
      if (res.status === 402) throw new Error("Créditos de IA agotados (402). Agregue saldo en Workspace → Usage.");
      throw new Error(`AI provider error ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      model?: string;
      usage?: { total_tokens?: number };
    };
    return {
      content: json.choices?.[0]?.message?.content ?? "",
      model: json.model ?? (opts.model ?? DEFAULT_MODEL),
      tokens_used: json.usage?.total_tokens,
    };
  }

  async chat(messages: AIMessage[], opts?: AIChatOptions) {
    return this.call(messages, opts);
  }

  async chatJSON<T = unknown>(messages: AIMessage[], opts?: AIChatOptions) {
    const raw = await this.call(messages, {
      ...opts,
      response_format: { type: "json_object" },
    });
    let parsed: T;
    try {
      parsed = JSON.parse(raw.content) as T;
    } catch {
      // Some models wrap JSON in ```json fences — try to recover.
      const match = raw.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (!match) throw new Error("El modelo no devolvió JSON válido.");
      parsed = JSON.parse(match[1]) as T;
    }
    return { content: parsed, model: raw.model, tokens_used: raw.tokens_used };
  }
}

let _provider: AIProvider | null = null;
export function getAIProvider(): AIProvider {
  if (!_provider) _provider = new LovableGatewayProvider();
  return _provider;
}
