// Intelligence Providers control center — failover order across providers,
// and per-feature routing preference (which provider + mode a given Nyrava
// feature should use). Both are user-scoped and layered on top of
// user_ai_keys, which remains the single source of truth for credentials.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PROVIDERS = ["groq", "openai", "gemini", "anthropic", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];
const ProviderSchema = z.enum(PROVIDERS);

// Mexico-appropriate default — OpenAI/Anthropic keys are rarely configured
// out of the box here (unlike the USA product this was ported from); the
// providers actually likely to have real keys go first so a fresh user's
// display and initial routing aren't misleadingly OpenAI-first before
// they've configured anything. A user's own saved order (if any) always
// takes priority over this — see listProviderOrder below.
export const DEFAULT_PROVIDER_ORDER: Provider[] = [
  "gemini",
  "groq",
  "openrouter",
  "openai",
  "anthropic",
];

export const listProviderOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Provider[]> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("user_provider_order")
      .select("provider,order_index")
      .eq("user_id", userId)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);

    const saved = (data ?? []).map((r: { provider: Provider }) => r.provider);
    // Fill in any providers the user hasn't explicitly ordered yet, in the
    // default order, so the list always contains exactly the 5 providers.
    const rest = DEFAULT_PROVIDER_ORDER.filter((p) => !saved.includes(p));
    return [...saved, ...rest];
  });

export const listProviderCooldownStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { listAiProviderCooldowns } = await import("@/lib/ai/router.server");
    return { ts: Date.now(), cooldowns: listAiProviderCooldowns() };
  });

const SetOrderInput = z.object({ order: z.array(ProviderSchema).length(5) });

export const setProviderOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SetOrderInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const rows = data.order.map((provider, i) => ({ user_id: userId, provider, order_index: i }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_provider_order")
      .upsert(rows, { onConflict: "user_id,provider" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------------------
// Feature routing
// ------------------------------------------------------------
export const FEATURE_KEYS = [
  "case_intelligence",
  "talk_to_cases",
  "motion_drafting",
  "reports",
  "ocr_documents",
  "voice_transcription",
  "evidence_explorer",
  "timeline_builder",
  "witness_intelligence",
  "strategy_center",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const MODES = ["maximum_accuracy", "balanced", "fastest", "lowest_cost", "private"] as const;
export type Mode = (typeof MODES)[number];

export type FeatureRouting = {
  featureKey: FeatureKey;
  provider: Provider | "auto";
  mode: Mode;
};

const FEATURE_DEFAULTS: Record<FeatureKey, { provider: Provider | "auto"; mode: Mode }> = {
  case_intelligence: { provider: "auto", mode: "maximum_accuracy" },
  talk_to_cases: { provider: "openai", mode: "balanced" },
  motion_drafting: { provider: "anthropic", mode: "maximum_accuracy" },
  reports: { provider: "auto", mode: "maximum_accuracy" },
  ocr_documents: { provider: "gemini", mode: "balanced" },
  voice_transcription: { provider: "groq", mode: "fastest" },
  evidence_explorer: { provider: "auto", mode: "maximum_accuracy" },
  timeline_builder: { provider: "auto", mode: "balanced" },
  witness_intelligence: { provider: "auto", mode: "maximum_accuracy" },
  strategy_center: { provider: "auto", mode: "balanced" },
};

export const listFeatureRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeatureRouting[]> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("user_intelligence_features")
      .select("feature_key,provider,mode")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const saved = new Map<string, { provider: string; mode: string }>();
    for (const r of data ?? []) saved.set(r.feature_key, { provider: r.provider, mode: r.mode });

    return FEATURE_KEYS.map((featureKey) => {
      const row = saved.get(featureKey);
      const fallback = FEATURE_DEFAULTS[featureKey];
      return {
        featureKey,
        provider: (row?.provider as Provider | "auto") ?? fallback.provider,
        mode: (row?.mode as Mode) ?? fallback.mode,
      };
    });
  });

const SetFeatureInput = z.object({
  featureKey: z.enum(FEATURE_KEYS),
  provider: z.union([ProviderSchema, z.literal("auto")]),
  mode: z.enum(MODES),
});

export const setFeatureRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SetFeatureInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("user_intelligence_features").upsert(
      {
        user_id: userId,
        feature_key: data.featureKey,
        provider: data.provider,
        mode: data.mode,
      },
      { onConflict: "user_id,feature_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
