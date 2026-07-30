/**
 * Thin adapter over the ONE provider manager (`routeAI`).
 *
 * History / why this file changed:
 * Until now this was a standalone shim that POSTed directly to
 * `https://ai.gateway.lovable.dev/v1/chat/completions` with
 * `process.env.LOVABLE_API_KEY`, completely bypassing `ai_providers`,
 * `user_ai_keys`, cooldowns, rotation and usage accounting. That made it a
 * second, invisible AI routing layer: every document extract/classify/entity
 * call during case execution billed platform credits instead of using the
 * user's own Groq/Gemini keys — which is exactly the divergence from the USA
 * branch that this audit found.
 *
 * It is now a pure translation layer: OpenAI-style `messages[]` in, `routeAI`
 * out. No gateway URL, no LOVABLE_API_KEY, no provider selection of its own.
 * Providers come solely from `ai_providers` + the caller's `user_ai_keys`.
 */

import { routeAI } from "./router.server";
import type { AITask, AIContent } from "./providers/types";

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
  /** Routes through the calling user's own provider keys (user_ai_keys). */
  userId?: string;
  /** Optional task pin, resolved against ai_task_routing. */
  task?: AITask;
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

/**
 * Collapse an OpenAI-style message array into the router's
 * { systemInstruction, userContent } shape. System messages are concatenated;
 * non-system messages are flattened in order, preserving image parts so PDF /
 * image OCR still works.
 */
function toRouteInput(messages: AIMessage[]): {
  systemInstruction?: string;
  userContent: AIContent;
} {
  const systemParts: string[] = [];
  const parts: AIContentPart[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      else
        for (const p of m.content) if (p.type === "text") systemParts.push(p.text);
      continue;
    }
    if (typeof m.content === "string") parts.push({ type: "text", text: m.content });
    else parts.push(...m.content);
  }

  const systemInstruction = systemParts.join("\n\n").trim() || undefined;
  const onlyText = parts.every((p) => p.type === "text");
  const userContent: AIContent = onlyText
    ? parts.map((p) => (p as { text: string }).text).join("\n\n")
    : parts;

  return { systemInstruction, userContent };
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
      const res = await routeAI({
        ...toRouteInput(messages),
        model: opts.model,
        temperature: opts.temperature,
        userId: opts.userId,
        task: opts.task,
      });
      return { content: res.text, model: res.model };
    },
    async chatJSON<T>(messages: AIMessage[], opts: AIChatOptions = {}) {
      const res = await routeAI({
        ...toRouteInput(messages),
        model: opts.model,
        temperature: opts.temperature,
        userId: opts.userId,
        task: opts.task,
        json: true,
      });
      const parsed = JSON.parse(extractJSON(res.text)) as T;
      return { content: parsed, model: res.model };
    },
  };
}
