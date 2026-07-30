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

// Warn at most once per provider row per process — this is a static
// misconfiguration (missing env var, or a key encrypted under a different
// AI_PROVIDER_ENCRYPTION_KEY than the one currently deployed), not a
// transient condition, so repeating it on every routeAI() call (a full
// pipeline run calls it ~25-30 times) would just be log spam.
const _warnedProviderIds = new Set<string>();

function warnOnce(id: string, message: string): void {
  if (_warnedProviderIds.has(id)) return;
  _warnedProviderIds.add(id);
  console.warn(message);
}

/**
 * Decrypt a DB-stored provider API key.
 *
 * 2026-07-30 investigation: this previously returned `null` identically for
 * three very different situations — (1) no key was ever stored, (2) a key
 * IS stored but `AI_PROVIDER_ENCRYPTION_KEY` isn't set in this deployment,
 * and (3) a key is stored but fails to decrypt (wrong/rotated encryption
 * key, corrupted value). Only (1) is normal. (2) and (3) mean an admin
 * configured a provider (e.g. a paid OpenRouter key) that the router then
 * silently treats as "not configured" and skips — indistinguishable, from
 * the outside, from the provider simply never having been set up. That
 * silent equivalence is exactly what makes "I configured a paid provider
 * but the system still runs out of capacity" so hard to diagnose. (2) and
 * (3) are now logged with the provider identity so they show up in server
 * logs; the return value (null, so routing falls through) is unchanged.
 */
function decryptApiKey(
  encrypted: string | null | undefined,
  context: { id: string; displayName: string },
): string | null {
  if (!encrypted) return null;
  const secret = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if (!secret) {
    warnOnce(
      `${context.id}:no_secret`,
      `[ai.provider_key] "${context.displayName}" has a stored api_key_encrypted value, but ` +
        `AI_PROVIDER_ENCRYPTION_KEY is not set in this environment — the key cannot be decrypted, ` +
        `so this provider is silently treated as unconfigured and skipped by the router. Set ` +
        `AI_PROVIDER_ENCRYPTION_KEY to the value used when the key was saved, or re-save the key ` +
        `after setting it.`,
    );
    return null;
  }
  try {
    const [version, ivB64, tagB64, valueB64] = encrypted.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !valueB64) {
      warnOnce(
        `${context.id}:bad_format`,
        `[ai.provider_key] "${context.displayName}" has a stored api_key_encrypted value in an ` +
          `unrecognized format (expected "v1:iv:tag:value") — treating it as unconfigured. It may ` +
          `need to be re-saved from Admin → AI Providers.`,
      );
      return null;
    }
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(valueB64, "base64")), decipher.final()]);
    return plain.toString("utf8");
  } catch (err) {
    warnOnce(
      `${context.id}:decrypt_failed`,
      `[ai.provider_key] "${context.displayName}": failed to decrypt stored api_key_encrypted ` +
        `(${err instanceof Error ? err.message : String(err)}) — treating it as unconfigured. ` +
        `Common cause: AI_PROVIDER_ENCRYPTION_KEY was rotated/changed since this key was saved. ` +
        `Re-save the key from Admin → AI Providers to fix.`,
    );
    return null;
  }
}

export function resolveApiKey(row: ProviderRow): string | null {
  const storedKey = decryptApiKey(row.api_key_encrypted, { id: row.id, displayName: row.display_name });
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
      return makeOpenAICompatible(cfg, {
        requiresKey: row.provider_type !== "ollama" && row.provider_type !== "lmstudio",
      });
    // No "lovable" case: the Lovable AI Gateway adapter was removed so that no
    // execution path can bill platform credits. See provider.server.ts header.
    case "anthropic":
      return makeAnthropic(cfg);
    case "gemini":
      return makeGemini(cfg);
  }
}
