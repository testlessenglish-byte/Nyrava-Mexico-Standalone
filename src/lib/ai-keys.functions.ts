// BYO-AI-Keys — user-managed provider credentials.
// Single source of truth for ALL providers (including groq — the old
// user_groq_keys / "Platform Groq keys (admin pool)" panel is retired).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PROVIDERS = ["groq", "openai", "gemini", "anthropic", "openrouter"] as const;
type Provider = (typeof PROVIDERS)[number];

const ProviderSchema = z.enum(PROVIDERS);

// Known daily token ceilings, for the usage bar. Unknown/unset -> no bar,
// just raw counts. Adjust as providers change their limits.
export const DAILY_TOKEN_LIMIT: Partial<Record<Provider, number>> = {
  groq: 500_000,
};

export type UserAIKeyView = {
  id: string;
  provider: Provider;
  label: string | null;
  keyPreview: string;
  isActive: boolean;
  priority: number | null;
  lastUsedAt: string | null;
  createdAt: string;
  callsToday: number;
  tokensToday: number;
  callsMonth: number;
  tokensMonth: number;
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
};

// Any change to the key pool must immediately invalidate the router's
// in-memory provider/credential caches and drop that provider's cooldowns —
// otherwise a freshly added key stays invisible (or still "burnt") for the
// cache TTL / cooldown window.
async function resetRouterStateFor(provider: Provider | null, userId: string) {
  try {
    const { resetAiRuntimeState } = await import("@/lib/ai/router.server");
    resetAiRuntimeState({ provider: provider as never, userId });
  } catch {
    // Router module unavailable (e.g. tests) — cache TTL will catch up.
  }
}

export const listUserAIKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserAIKeyView[]> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("user_ai_keys")
      .select(
        "id,provider,label,key_fingerprint,is_active,priority,last_used_at,created_at,calls_today,tokens_today,calls_month,tokens_month,usage_date,usage_month,last_test_ok,last_test_latency_ms,last_test_error",
      )
      .eq("user_id", userId)
      .order("provider", { ascending: true })
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);

    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      provider: r.provider as Provider,
      label: (r.label as string | null) ?? null,
      keyPreview: String(r.key_fingerprint).slice(0, 4) + "…" + String(r.key_fingerprint).slice(-4),
      isActive: Boolean(r.is_active),
      priority: (r.priority as number | null) ?? null,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      createdAt: String(r.created_at),
      // Stale counters (from a previous day/month) display as 0 rather than
      // waiting for a write to reset them — reset happens lazily on next use.
      callsToday: r.usage_date === today ? Number(r.calls_today ?? 0) : 0,
      tokensToday: r.usage_date === today ? Number(r.tokens_today ?? 0) : 0,
      callsMonth: r.usage_month === month ? Number(r.calls_month ?? 0) : 0,
      tokensMonth: r.usage_month === month ? Number(r.tokens_month ?? 0) : 0,
      lastTestOk: r.last_test_ok == null ? null : Boolean(r.last_test_ok),
      lastTestLatencyMs: (r.last_test_latency_ms as number | null) ?? null,
      lastTestError: (r.last_test_error as string | null) ?? null,
    }));
  });

const AddInput = z.object({
  provider: ProviderSchema,
  apiKey: z.string().trim().min(8, "API key looks too short").max(4096),
  label: z.string().trim().max(80).optional(),
});

export const addUserAIKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AddInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; validated: boolean; validationError?: string }> => {
    const { supabase, userId } = context;
    const { encryptKey, keyFingerprint } = await import("@/lib/canonical/encryption.server");
    const { validateProviderKey } = await import("@/lib/ai-keys.server");
    // Live probe happens exactly once, here, at add-time. Nowhere else.
    const validation = await validateProviderKey(data.provider, data.apiKey);
    if (!validation.ok) {
      return { id: "", validated: false, validationError: validation.error };
    }
    const encrypted = encryptKey(data.apiKey);
    const fingerprint = keyFingerprint(data.apiKey);

    // New keys go to the back of the rotation (max priority + 1) so they
    // don't jump ahead of existing keys for this provider.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any)
      .from("user_ai_keys")
      .select("priority")
      .eq("user_id", userId)
      .eq("provider", data.provider)
      .order("priority", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const nextPriority = existing?.priority != null ? existing.priority + 1 : 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (supabase as any)
      .from("user_ai_keys")
      .upsert(
        {
          user_id: userId,
          provider: data.provider,
          label: data.label ?? null,
          encrypted_key: encrypted,
          key_fingerprint: fingerprint,
          is_active: true,
          priority: nextPriority,
          last_test_ok: true,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider,key_fingerprint" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await resetRouterStateFor(data.provider, userId);
    return { id: String(row.id), validated: true };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const deleteUserAIKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("user_ai_keys").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    await resetRouterStateFor(null, userId);
    return { ok: true };
  });

const ToggleInput = z.object({ id: z.string().uuid(), isActive: z.boolean() });

export const toggleUserAIKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_ai_keys")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    await resetRouterStateFor(null, userId);
    return { ok: true };
  });

// Swap this key's priority with its neighbor in the current sort order.
// direction: -1 = move up (earlier in rotation), 1 = move down.
const ReorderInput = z.object({
  id: z.string().uuid(),
  direction: z.union([z.literal(-1), z.literal(1)]),
});

export const reorderUserAIKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReorderInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error: rowErr } = await (supabase as any)
      .from("user_ai_keys")
      .select("id,provider,priority")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (rowErr || !row) throw new Error(rowErr?.message ?? "Key not found.");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: siblings, error: sibErr } = await (supabase as any)
      .from("user_ai_keys")
      .select("id,priority")
      .eq("user_id", userId)
      .eq("provider", row.provider)
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (sibErr) throw new Error(sibErr.message);

    const ordered = (siblings ?? []) as Array<{ id: string; priority: number | null }>;
    const idx = ordered.findIndex((s) => s.id === row.id);
    const swapIdx = idx + data.direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return { ok: true }; // no-op at either end

    const a = ordered[idx];
    const b = ordered[swapIdx];
    const aPriority = a.priority ?? idx;
    const bPriority = b.priority ?? swapIdx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("user_ai_keys").update({ priority: bPriority }).eq("id", a.id).eq("user_id", userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("user_ai_keys").update({ priority: aPriority }).eq("id", b.id).eq("user_id", userId);
    await resetRouterStateFor(null, userId);
    return { ok: true };
  });

// Provider-level toggle: flips is_active for every key under a provider at
// once, used by the "Enabled" switch in the provider Manage drawer.
const ToggleProviderInput = z.object({ provider: ProviderSchema, isActive: z.boolean() });

export const toggleProviderAIKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleProviderInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_ai_keys")
      .update({ is_active: data.isActive })
      .eq("user_id", userId)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    await resetRouterStateFor(data.provider, userId);
    return { ok: true };
  });

// Provider-level delete: removes every key under a provider, used by
// "Delete Provider" in the Manage drawer.
const DeleteProviderInput = z.object({ provider: ProviderSchema });

export const deleteProviderAIKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DeleteProviderInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_ai_keys")
      .delete()
      .eq("user_id", userId)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    await resetRouterStateFor(data.provider, userId);
    return { ok: true };
  });

const TestInput = z.object({ id: z.string().uuid() });

export const testUserAIKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => TestInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; latencyMs?: number }> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (supabase as any)
      .from("user_ai_keys")
      .select("provider,encrypted_key")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !row) return { ok: false, error: "Key not found." };
    const { decryptKey } = await import("@/lib/canonical/encryption.server");
    const { validateProviderKey } = await import("@/lib/ai-keys.server");
    const started = Date.now();
    const plaintext = decryptKey(row.encrypted_key);
    // This is the ONLY other place a live probe is allowed to run — behind
    // the explicit "Test" button, never inline in the completion path.
    const v = await validateProviderKey(row.provider, plaintext);
    const latencyMs = Date.now() - started;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("user_ai_keys")
      .update({
        last_used_at: new Date().toISOString(),
        last_test_ok: v.ok,
        last_test_latency_ms: latencyMs,
        last_test_error: v.ok ? null : (v.error ?? "Test failed."),
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: v.ok, error: v.error, latencyMs };
  });
