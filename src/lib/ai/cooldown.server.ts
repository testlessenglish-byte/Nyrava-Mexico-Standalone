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
const DEFAULT_QUOTA_MS = 60 * 60_000;
const DEFAULT_PAYMENT_MS = 60 * 60_000;
const DEFAULT_TRANSPORT_MS = 20_000;
const MAX_HINTED_RETRY_MS = 10 * 60_000;

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
  const retryAfterMs = Math.max(1_000, args.retryAfterMs ?? defaultMs(args.reason, args.message));
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