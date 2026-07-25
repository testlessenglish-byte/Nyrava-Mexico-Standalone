// Static cost estimates (USD per 1M tokens). Approximate; for display only.
import type { ProviderType } from "./providers/types";

export interface Price { input: number; output: number }

export const PRICING: Record<ProviderType, Price> = {
  groq:       { input: 0.15, output: 0.60 },
  openai:     { input: 0.15, output: 0.60 },
  anthropic:  { input: 3.00, output: 15.00 },
  gemini:     { input: 0.10, output: 0.40 },
  openrouter: { input: 0.50, output: 1.50 },
  ollama:     { input: 0,    output: 0 },
  lmstudio:   { input: 0,    output: 0 },
};

export function estimateCost(type: ProviderType, inputTokens: number, outputTokens: number) {
  const p = PRICING[type];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
