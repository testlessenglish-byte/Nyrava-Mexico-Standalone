// Capability decorator — wraps a raw provider (type + chat + testConnection)
// with the Phase 8 capability contract so every adapter satisfies AIProvider
// without repeating boilerplate. Adapters may pass `override` to adjust the
// default capability profile for a specific model/deployment.

import {
  AIProvider,
  ChatOpts,
  ChatResult,
  ProviderCapabilities,
  ProviderType,
  PROVIDER_CAPABILITIES,
} from "./types";
import { estimateCost as staticEstimateCost } from "../pricing";

export interface RawProvider {
  type: ProviderType;
  chat(opts: ChatOpts): Promise<ChatResult>;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

export function withCapabilities(
  raw: RawProvider,
  override?: Partial<ProviderCapabilities>,
): AIProvider {
  const capabilities: ProviderCapabilities = {
    ...PROVIDER_CAPABILITIES[raw.type],
    ...(override ?? {}),
  };
  return {
    type: raw.type,
    capabilities,
    chat: raw.chat.bind(raw),
    testConnection: raw.testConnection.bind(raw),
    supportsJsonMode: () => capabilities.jsonMode,
    supportsReasoning: () => capabilities.reasoning,
    supportsStreaming: () => capabilities.streaming,
    supportsToolCalling: () => capabilities.toolCalling,
    supportsVision: () => capabilities.vision,
    estimateCost: (inputTokens: number, outputTokens: number) =>
      staticEstimateCost(raw.type, inputTokens, outputTokens),
  };
}
