// Server-only helper for resolving + rotating a user's active provider keys.
// Replaces groq-keys.server.ts. Same rotation contract (priority asc, nulls
// last, then created_at), but works for any provider in user_ai_keys instead
// of a groq-only shadow table. Usage recording is fire-and-forget so it
// never adds latency to the actual completion call.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProviderName } from "@/lib/ai-keys.server";

type Db = SupabaseClient<Database>;

export interface ResolvedKeys {
  /** Ordered candidate keys (decrypted, ready to use): saved user keys, or platform key only when the user has none. */
  keys: string[];
  /** Parallel array — user_ai_keys.id for each entry in `keys`; null for the platform key. */
  keyIds: (string | null)[];
  userKeyCount: number;
  hasPlatform: boolean;
}

// In-process attribution cache: `${userId}:${provider}` -> ordered key ids.
// Populated on every resolve() so log/usage sites can map a router-returned
// keyIndex back to the row that served the request.
const _keyIndexCache = new Map<string, (string | null)[]>();

const PLATFORM_ENV: Record<ProviderName, string | undefined> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export async function resolveProviderKeys(db: Db, userId: string, provider: ProviderName): Promise<ResolvedKeys> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("user_ai_keys")
    .select("id,encrypted_key,priority,created_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_active", true)
    .order("priority", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ id: string; encrypted_key: string; priority: number | null }>;
  const { decryptKey } = await import("@/lib/canonical/encryption.server");

  const keys: string[] = [];
  const keyIds: (string | null)[] = [];
  for (const r of rows) {
    if (!r.encrypted_key) continue;
    try {
      keys.push(decryptKey(r.encrypted_key));
      keyIds.push(r.id);
    } catch {
      // Skip rows that fail to decrypt rather than aborting rotation for
      // every other key — this is what "one bad key stalls the pipeline"
      // usually turns out to be.
      continue;
    }
  }

  const envVar = PLATFORM_ENV[provider];
  const platform = envVar ? process.env[envVar] : undefined;
  if (keys.length === 0 && platform) {
    keys.push(platform);
    keyIds.push(null);
  }

  _keyIndexCache.set(`${userId}:${provider}`, keyIds);

  return { keys, keyIds, userKeyCount: rows.length, hasPlatform: Boolean(platform) };
}

export function getKeyIdByIndex(
  userId: string,
  provider: ProviderName,
  keyIndex: number | undefined | null,
): string | null {
  if (userId == null || keyIndex == null || keyIndex < 0) return null;
  const arr = _keyIndexCache.get(`${userId}:${provider}`);
  if (!arr) return null;
  return arr[keyIndex] ?? null;
}

/**
 * Record usage AFTER a real completion call succeeds. Fire-and-forget by
 * design — callers should NOT `await` this on the hot path; a failed usage
 * write should never fail or delay the user's actual request.
 *
 * This is a single round-trip (one RPC), not a live provider probe — do not
 * call validateProviderKey()/testUserAIKey() here. That probe belongs only
 * behind the explicit "Test" button and the one-time "Add" validation.
 */
export function recordKeyUsage(db: Db, keyId: string | null, tokens: number): void {
  if (!keyId) return; // platform key — nothing to attribute
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  void (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (db as any)
        .from("user_ai_keys")
        .select("usage_date,usage_month,calls_today,tokens_today,calls_month,tokens_month")
        .eq("id", keyId)
        .maybeSingle();
      if (!row) return;

      const sameDay = row.usage_date === today;
      const sameMonth = row.usage_month === month;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from("user_ai_keys")
        .update({
          usage_date: today,
          usage_month: month,
          calls_today: (sameDay ? row.calls_today : 0) + 1,
          tokens_today: (sameDay ? row.tokens_today : 0) + tokens,
          calls_month: (sameMonth ? row.calls_month : 0) + 1,
          tokens_month: (sameMonth ? row.tokens_month : 0) + tokens,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", keyId);
    } catch {
      // usage tracking is best-effort; never surface this to the caller
    }
  })();
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Voice (STT/TTS) provider chain
// ---------------------------------------------------------------------------
// Text chat/pipeline gets real cross-provider fallback through routeAI()'s
// loadUserProviderKeyGroups(). Voice previously called resolveProviderKeys()
// with the provider hardcoded to "groq", so any account without a Groq key
// failed outright even with working OpenAI/Gemini keys configured. This is
// the voice equivalent: every active key the user has for a voice-capable
// provider, grouped by provider (all of one provider's keys tried before
// moving to the next), ordered by priority/created_at — same rotation
// contract as resolveProviderKeys, just spanning providers instead of one.
export type VoiceProvider = "groq" | "openai" | "gemini";
export const VOICE_PROVIDERS: VoiceProvider[] = ["groq", "openai", "gemini"];

export interface VoiceProviderGroup {
  provider: VoiceProvider;
  keys: string[];
  keyIds: (string | null)[];
}

export interface VoiceChain {
  groups: VoiceProviderGroup[];
  userKeyCount: number;
  hasPlatform: boolean;
}

export async function resolveVoiceProviderChain(db: Db, userId: string): Promise<VoiceChain> {
  const groups: VoiceProviderGroup[] = [];
  let userKeyCount = 0;
  const providersWithUserKeys = new Set<VoiceProvider>();

  for (const provider of VOICE_PROVIDERS) {
    const { keys, keyIds, userKeyCount: count } = await resolveProviderKeys(db, userId, provider);
    userKeyCount += count;
    // resolveProviderKeys() already appends a platform-env fallback key when
    // the user has none for that specific provider — that's the wrong shape
    // here (it would insert a platform key into the middle of the chain
    // ahead of a *different* provider's real user key). Strip platform-only
    // entries at this stage; platform fallback for EVERY provider (used or
    // not) is added in one pass below instead, after all real user keys.
    const userOnlyKeys = keys.filter((_, i) => keyIds[i] !== null);
    const userOnlyKeyIds = keyIds.filter((id) => id !== null);
    if (userOnlyKeys.length > 0) {
      groups.push({ provider, keys: userOnlyKeys, keyIds: userOnlyKeyIds });
      providersWithUserKeys.add(provider);
    }
  }

  // Platform fallback used to be all-or-nothing: it only kicked in when the
  // user had ZERO keys across every voice provider. That meant an account
  // with, say, two exhausted Gemini keys and no Groq/OpenAI keys had no
  // fallback at all — the presence of ANY user key (even a fully quota-
  // exhausted one) silently blocked the platform key from ever being tried,
  // for every OTHER provider too. Fixed: append a platform key for each
  // voice provider the user has no active key for, regardless of what they
  // do have configured for a different provider — same as how routeAI's
  // server_secret_fallback already behaves for text chat. This only reads
  // the same per-provider env vars already used elsewhere in this file
  // (GROQ_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) — never the Lovable AI
  // Gateway key.
  let hasPlatform = false;
  for (const provider of VOICE_PROVIDERS) {
    if (providersWithUserKeys.has(provider)) continue;
    const envVar = { groq: "GROQ_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" }[provider];
    const platformKey = process.env[envVar];
    if (platformKey) {
      hasPlatform = true;
      groups.push({ provider, keys: [platformKey], keyIds: [null] });
    }
  }

  return { groups, userKeyCount, hasPlatform };
}

/**
 * Flattens a VoiceChain into a single ordered list of (provider, key, keyId)
 * attempts — one entry per key, providers grouped, ready for a simple
 * for-loop with round-robin offset support (used by /api/voice/speak to
 * keep using the same provider+key across chunks once one works).
 */
export function flattenVoiceChain(
  chain: VoiceChain,
): Array<{ provider: VoiceProvider; key: string; keyId: string | null }> {
  const out: Array<{ provider: VoiceProvider; key: string; keyId: string | null }> = [];
  for (const g of chain.groups) {
    for (let i = 0; i < g.keys.length; i++) {
      out.push({ provider: g.provider, key: g.keys[i], keyId: g.keyIds[i] });
    }
  }
  return out;
}
