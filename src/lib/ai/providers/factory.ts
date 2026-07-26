// Provider factory — returns the right adapter for a stored DB row.
import { createDecipheriv, createHash } from "node:crypto";
import { AIProvider, ProviderConfig, PROVIDER_DEFAULTS, ProviderType } from "./types";
import { makeOpenAICompatible } from "./openai-compatible";
import { makeAnthropic } from "./anthropic";
import { makeGemini } from "./gemini";

export interface ProviderRow {
  id: string;
  provider_type: ProviderType;
  display_name: string;
  enabled: boolean;
  priority: number;
  base_url: string | null;
  default_model: string | null;
  secret_name: string | null;
  api_key_encrypted?: string | null;
}

function decryptApiKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const secret = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if (!secret) return null;
  try {
    const [version, ivB64, tagB64, valueB64] = encrypted.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !valueB64) return null;
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(valueB64, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

export function resolveApiKey(row: ProviderRow): string | null {
  const storedKey = decryptApiKey(row.api_key_encrypted);
  if (storedKey) return storedKey;
  const name = row.secret_name ?? PROVIDER_DEFAULTS[row.provider_type].secretName;
  if (!name) return null;
  return process.env[name] ?? null;
}

export function buildProvider(row: ProviderRow, apiKeyOverride?: string | null): AIProvider {
  const cfg: ProviderConfig = {
    type: row.provider_type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    apiKey: apiKeyOverride ?? resolveApiKey(row),
  };
  switch (row.provider_type) {
    case "groq":
    case "openai":
    case "openrouter":
    case "ollama":
    case "lmstudio":
      return makeOpenAICompatible(cfg, { requiresKey: row.provider_type !== "ollama" && row.provider_type !== "lmstudio" });
    // No "lovable" case: the Lovable AI Gateway adapter was removed so that no
    // execution path can bill platform credits. See provider.server.ts header.
    case "anthropic":
      return makeAnthropic(cfg);
    case "gemini":
      return makeGemini(cfg);
  }
}

