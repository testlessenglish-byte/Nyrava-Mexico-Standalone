import type { ProviderType } from "./providers/types";

export type CooldownReason = "rate_limit" | "quota" | "payment" | "transport";

export type ProviderCooldown = {
  provider: ProviderType;
  model: string;
  key: string;
  until: number;
  retryAfterMs: number;
  reason: CooldownReason;
  message: string;
};

const DEFAULT_RATE_LIMIT_MS = 60_000;
// A 429 is almost always a PER-MINUTE window (RPM/TPM), not an exhausted
// plan. Parking the key for an hour on the first minute-window bounce is what
// made fresh Gemini/Groq keys look "burnt" one stage into a run: every later
// engine skipped the provider entirely and the pipeline failed with keys that
// were healthy again seconds later. Default short; only genuinely daily or
// billing-level exhaustion gets a long cooldown.
const DEFAULT_QUOTA_MS = 90_000;
const DEFAULT_DAILY_QUOTA_MS = 15 * 60_000;
const DEFAULT_PAYMENT_MS = 30 * 60_000;
const DEFAULT_TRANSPORT_MS = 20_000;
const MAX_HINTED_RETRY_MS = 10 * 60_000;

/** True when the provider message names a per-day/lifetime limit rather than a per-minute window. */
function isDailyExhaustion(message: string): boolean {
  return (
    /per\s*day|perday|daily|per\s*24\s*hours|requests per day|RPD\b/i.test(message) ||
    // Gemini's free-tier REQUEST-COUNT quota is a small daily cap in
    // practice even when the 429 body doesn't literally spell out "per
    // day" — the quotaId/metric name is "generate_content_free_tier_
    // requests" with a low integer limit (e.g. "limit: 20"), never a
    // per-minute window (a genuine RPM cap would read closer to hundreds/
    // thousands). Confirmed on a live stuck report (laboral case,
    // despido injustificado, exploratory mode): the report stage looped
    // every ~40s for 20+ cycles, each attempt re-hitting the SAME
    // already-exhausted-for-the-day Gemini keys, because the short
    // Retry-After header/hint (see markProviderCooldown below) was
    // trusted over this daily signal.
    /free[\s_]*tier[\s_]*requests?\b/i.test(message)
  );
}


const cooldowns = new Map<string, ProviderCooldown>();

function norm(value: string | null | undefined, fallback: string): string {
  const v = value?.trim().toLowerCase();
  return v || fallback;
}

function cooldownKey(provider: ProviderType, model: string | null | undefined, key: string | null | undefined) {
  return `${provider}::${norm(model, "*")}::${norm(key, "env")}`;
}

export function parseRetryHintMs(message: string): number | null {
  const m =
    message.match(/(?:try again|retry(?:\s+after)?)\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|second|seconds|m|min|minute|minutes)?/i) ??
    message.match(/retry(?:-|\s+)after[:\s]+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|second|seconds|m|min|minute|minutes)?/i) ??
    message.match(/retryDelay["'\s:]+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|second|seconds|m|min|minute|minutes)?/i) ??
    message.match(/"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)(s|m)?"/i);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "s").toLowerCase();
  const ms = unit.startsWith("m") && unit !== "ms" ? n * 60_000 : unit === "ms" ? n : n * 1000;
  return Math.max(500, Math.min(MAX_HINTED_RETRY_MS, Math.ceil(ms)));
}

function defaultMs(reason: CooldownReason, message: string): number {
  // Daily/free-tier request-count exhaustion overrides any parsed retry
  // hint — a "try again in Ns" hint embedded in the message text is
  // generic per-attempt backoff guidance the provider sends on every 429
  // regardless of cause, not a real reset time for a quota that won't
  // recover until tomorrow. See isDailyExhaustion's own comment and
  // markProviderCooldown below for the live incident (an infinite ~40s
  // report-stage retry loop) this ordering fix closes.
  if (reason === "quota" && isDailyExhaustion(message)) return DEFAULT_DAILY_QUOTA_MS;
  const hinted = parseRetryHintMs(message);
  if (hinted != null) return hinted;
  if (reason === "payment") return DEFAULT_PAYMENT_MS;
  if (reason === "quota") return DEFAULT_QUOTA_MS;
  if (reason === "transport") return DEFAULT_TRANSPORT_MS;
  return DEFAULT_RATE_LIMIT_MS;
}

export function getProviderCooldown(args: {
  provider: ProviderType;
  model?: string | null;
  key?: string | null;
}): ProviderCooldown | null {
  const exact = cooldowns.get(cooldownKey(args.provider, args.model, args.key));
  const wildcard = cooldowns.get(cooldownKey(args.provider, args.model, null));
  const now = Date.now();
  const candidates = [exact, wildcard].filter(Boolean) as ProviderCooldown[];
  for (const c of candidates) {
    if (c.until <= now) {
      cooldowns.delete(cooldownKey(c.provider, c.model, c.key));
      continue;
    }
    return { ...c, retryAfterMs: c.until - now };
  }
  return null;
}

export function markProviderCooldown(args: {
  provider: ProviderType;
  model?: string | null;
  key?: string | null;
  reason: CooldownReason;
  message: string;
  retryAfterMs?: number | null;
}): ProviderCooldown {
  const model = norm(args.model, "*");
  const key = norm(args.key, "env");
  // Same daily-exhaustion override as defaultMs() above, but here for an
  // EXPLICIT retryAfterMs a caller already resolved before calling this
  // (e.g. providers/gemini.ts parses the HTTP Retry-After header itself
  // and passes it as args.retryAfterMs, bypassing defaultMs entirely).
  // That header is the same generic per-attempt guidance Google sends on
  // every 429 — equally untrustworthy for a genuinely daily-exhausted
  // quota. Confirmed live: this exact header value (~40s) was what a
  // report stage kept re-trusting on every retry cycle against an
  // already-exhausted-for-the-day Gemini free-tier key, looping ~20 times
  // over roughly 13 minutes without ever giving the OpenRouter fallback
  // enough of the checkpoint budget left to complete.
  const isDailyRequestExhaustion = args.reason === "quota" && isDailyExhaustion(args.message);
  const retryAfterMs = isDailyRequestExhaustion
    ? DEFAULT_DAILY_QUOTA_MS
    : Math.max(1_000, args.retryAfterMs ?? defaultMs(args.reason, args.message));
  const entry: ProviderCooldown = {
    provider: args.provider,
    model,
    key,
    until: Date.now() + retryAfterMs,
    retryAfterMs,
    reason: args.reason,
    message: args.message.slice(0, 500),
  };
  cooldowns.set(cooldownKey(args.provider, model, key), entry);
  return entry;
}

export function listProviderCooldowns(): ProviderCooldown[] {
  const now = Date.now();
  const out: ProviderCooldown[] = [];
  for (const [key, value] of cooldowns) {
    if (value.until <= now) {
      cooldowns.delete(key);
      continue;
    }
    out.push({ ...value, retryAfterMs: value.until - now });
  }
  return out.sort((a, b) => a.until - b.until);
}

export function clearProviderCooldowns(filter?: { provider?: ProviderType | null; model?: string | null }): number {
  let cleared = 0;
  for (const [key, value] of Array.from(cooldowns.entries())) {
    if (filter?.provider && value.provider !== filter.provider) continue;
    if (filter?.model && value.model !== filter.model.toLowerCase()) continue;
    cooldowns.delete(key);
    cleared += 1;
  }
  return cleared;
}