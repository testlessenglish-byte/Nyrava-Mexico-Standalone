// DB-driven AI router. Server-only.
//
// Reads ai_providers ordered by priority, walks the chain trying each enabled
// provider in turn. On 429/timeout/5xx/network failure, falls through to the
// next provider. On success, stamps last_ok_at; on failure, stamps last_error_at.
// Task routing pins specific tasks to specific providers (looked up first).

import { createHash } from "node:crypto";
import type { AIProvider, AITask, ChatOpts, ChatResult, ProviderType } from "./providers/types";
import { buildProvider, ProviderRow } from "./providers/factory";
import {
  aiCallTimeoutForCheckpoint,
  assertCheckpointBudget,
  isCheckpointError,
} from "../pipeline-checkpoint.server";
import { traceAsync } from "@/lib/pipeline-trace.server";
import {
  clearProviderCooldowns,
  getProviderCooldown,
  listProviderCooldowns,
  markProviderCooldown,
  parseRetryHintMs,
  type CooldownReason,
} from "./cooldown.server";

export interface RouteOpts extends ChatOpts {
  task?: AITask;
  forceProvider?: ProviderType;
  skipProviders?: ProviderType[];
  cache?: boolean;
  /** Runtime key override (single). */
  apiKey?: string;
  /** Ordered runtime key overrides. First key is tried first. */
  apiKeys?: string[];
  /** When set with apiKey/apiKeys, treats those keys as belonging to this provider. */
  runtimeProvider?: ProviderType;
  /** When set, loads the user's active provider keys from user_ai_keys and prepends them to the chain. */
  userId?: string;
  /** Internal: how many times this call already waited out a provider cooldown. */
  _cooldownWaits?: number;
}

export interface RouteResult extends ChatResult {
  provider: ProviderType;
  providerId: string;
  fellBackFrom?: ProviderType[];
  cached?: boolean;
  keyIndex?: number;
  /** Number of provider-side retries that ran before the response was returned. */
  retryCount?: number;
  /** Reasons for retries in try order (e.g. "HTTP 429", "timeout"). */
  retryReasons?: string[];
}

type RuntimeGroqRow = ProviderRow & {
  runtimeApiKey?: string;
  runtimeKeyIndex?: number;
  runtimeKeyFingerprint?: string;
  rotationStartIndex?: number;
  rotationAdvanced?: boolean;
  selectionReason?: string;
  consideredKeyIndexes?: number[];
};

interface CallRecord {
  ts: number;
  provider: ProviderType;
  providerId: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  failover?: boolean;
  cached?: boolean;
}

const _state = {
  last: undefined as CallRecord | undefined,
  lastSuccess: undefined as CallRecord | undefined,
  lastError: undefined as CallRecord | undefined,
  history: [] as CallRecord[],
  failovers: 0,
  cacheHits: 0,
  totalCalls: 0,
  byProvider: {} as Record<
    string,
    { lastOk?: number; lastError?: string; lastErrorTs?: number; totalOk: number; totalErr: number }
  >,
};

const MAX_LOGICAL_PROVIDER_ATTEMPTS = 4;
const MAX_PROVIDER_RETRIES_PER_CALL = 1;

/**
 * Per-request INPUT token budget by provider. This is not the model context
 * window — it is the largest single request the provider will actually accept
 * on the plans these keys use. Groq's free tier rejects any request larger
 * than its 8k tokens-per-minute ceiling with HTTP 413, so we keep headroom for
 * the completion and route bigger prompts to a wide-context provider instead.
 */
const PROVIDER_INPUT_TOKEN_BUDGET: Partial<Record<ProviderType, number>> = {
  // 2026-07: was 6_000, which skipped Groq on virtually every engine prompt
  // and serialized the whole pipeline onto Gemini at ~15s/call. Groq accepts
  // far larger single requests than its per-minute ceiling suggests, and a
  // 413/429 is already self-healed (split + failover), so the conservative
  // gate cost far more than it saved.
  // 2026-07-27: raised again to 30_000. The report stage builds a ~17k-token
  // prompt, which was still over the 12k gate — so Groq was skipped on EVERY
  // report chunk and the whole stage fell onto Gemini, which then 503'd
  // ("model experiencing high demand") or blew the 26s call timeout, giving
  // zero forward progress until the checkpoint loop-breaker aborted the run.
  // gpt-oss-120b has a 131k context window; a 413/429 is already self-healed.
  groq: 30_000,

  openrouter: 60_000,
  gemini: 900_000,
  openai: 100_000,
  anthropic: 150_000,
};
const DEFAULT_PROVIDER_INPUT_BUDGET = 60_000;

function providerInputBudget(p: ProviderType): number {
  return PROVIDER_INPUT_TOKEN_BUDGET[p] ?? DEFAULT_PROVIDER_INPUT_BUDGET;
}

/** ~3.5 chars/token is a safe over-estimate for Spanish legal prose. */
function estimateInputTokens(opts: { systemInstruction?: string; userContent: unknown }): number {
  let chars = (opts.systemInstruction ?? "").length;
  const uc = opts.userContent;
  if (typeof uc === "string") chars += uc.length;
  else if (Array.isArray(uc))
    for (const part of uc) {
      if (part && typeof part === "object" && "text" in part)
        chars += String((part as { text?: string }).text ?? "").length;
      else chars += 1_500; // image part — rough fixed cost
    }
  return Math.ceil(chars / 3.5);
}


function bumpProvider(p: ProviderType) {
  return (_state.byProvider[p] ??= { totalOk: 0, totalErr: 0 });
}

function record(r: CallRecord) {
  _state.last = r;
  const bp = bumpProvider(r.provider);
  if (r.ok) {
    _state.lastSuccess = r;
    bp.totalOk++;
    bp.lastOk = r.ts;
  } else {
    _state.lastError = r;
    bp.totalErr++;
    bp.lastError = r.error;
    bp.lastErrorTs = r.ts;
  }
  _state.history.push(r);
  if (_state.history.length > 50) _state.history.shift();
  if (r.failover) _state.failovers++;
}

export function getRouterDiagnostics() {
  return {
    last: _state.last ?? null,
    lastSuccess: _state.lastSuccess ?? null,
    lastError: _state.lastError ?? null,
    history: _state.history.slice(-20),
    byProvider: _state.byProvider,
    failovers: _state.failovers,
    cacheHits: _state.cacheHits,
    totalCalls: _state.totalCalls,
    cacheSize: _cache.size,
    cooldowns: listProviderCooldowns(),
  };
}

// In-memory completion cache (per-worker, ephemeral).
const _cache = new Map<string, { result: RouteResult; ts: number }>();
const CACHE_MAX = 500;

// Runtime Groq key try-order: strict round-robin per keyset/model. This gives
// balanced first-key selection without a read/write database race, and every
// selection is emitted into telemetry below.
const _groqKeyCursor = new Map<string, number>();

// Groq enforces quotas at the ORGANIZATION level for a given model. Users
// may hold keys across multiple orgs, so cooldown is keyed by (model, org)
// — not by model alone — otherwise a TPM 429 on one org blocks a healthy
// key from a different org. Duration depends on the limit kind parsed from
// the 429 body:
//   - "tokens per min" / "rpm": ~60s (bucket resets each minute)
//   - "tokens per day" / "requests per day": ~1h retry cadence
//     (the worker will keep requeuing; TPD truly resets at 00:00 UTC but
//     we don't want to block for that long in-process — the pipeline
//     retries anyway).
//   - unknown: 45s (previous default).
const GROQ_COOLDOWN_TPM_MS = 60_000;
const GROQ_COOLDOWN_TPD_MS = 60 * 60_000;
const GROQ_COOLDOWN_DEFAULT_MS = 45_000;
const _groqCooldown = new Map<string, number>(); // key = `${model}::${org}`
function cooldownKey(model: string | undefined | null, org: string | undefined | null): string {
  return `${(model ?? "default").toLowerCase()}::${org ?? "*"}`;
}
function getGroqCooldownUntil(
  model: string | undefined | null,
  org?: string | null,
): number | undefined {
  const k = cooldownKey(model, org);
  const until = _groqCooldown.get(k);
  if (!until) return undefined;
  if (Date.now() >= until) {
    _groqCooldown.delete(k);
    return undefined;
  }
  return until;
}
function markGroqCoolingDown(
  model: string | undefined | null,
  org: string | undefined | null,
  kind: "tpm" | "tpd" | "unknown",
): void {
  const ms =
    kind === "tpm"
      ? GROQ_COOLDOWN_TPM_MS
      : kind === "tpd"
        ? GROQ_COOLDOWN_TPD_MS
        : GROQ_COOLDOWN_DEFAULT_MS;
  _groqCooldown.set(cooldownKey(model, org), Date.now() + ms);
}
/** Parse `on tokens per min` / `on tokens per day` / `on requests per …` out of a Groq 429 body. */
function parseGroqLimitKind(msg: string): "tpm" | "tpd" | "unknown" {
  if (/per\s*min/i.test(msg)) return "tpm";
  if (/per\s*day/i.test(msg)) return "tpd";
  return "unknown";
}
// Back-compat shim for call sites that don't have org context.
function markGroqModelCoolingDown(model: string | undefined | null): void {
  markGroqCoolingDown(model, null, "unknown");
}
function getGroqModelCooldownUntil(model: string | undefined | null): number | undefined {
  // Any org-scoped cooldown that matches this model still counts as "cooling".
  const prefix = `${(model ?? "default").toLowerCase()}::`;
  let latest: number | undefined;
  for (const [k, until] of _groqCooldown) {
    if (!k.startsWith(prefix)) continue;
    if (Date.now() >= until) {
      _groqCooldown.delete(k);
      continue;
    }
    if (latest === undefined || until > latest) latest = until;
  }
  return latest;
}

/**
 * Admin: list active Groq cooldowns.
 * Returns one entry per (model, org) pair whose cooldown has not yet expired.
 */
export function listGroqCooldowns(): Array<{
  model: string;
  org: string;
  until: number;
  retryAfterMs: number;
}> {
  const now = Date.now();
  const out: Array<{ model: string; org: string; until: number; retryAfterMs: number }> = [];
  for (const [k, until] of _groqCooldown) {
    if (now >= until) {
      _groqCooldown.delete(k);
      continue;
    }
    const [model, org] = k.split("::");
    out.push({ model, org: org ?? "*", until, retryAfterMs: until - now });
  }
  return out;
}

export function listAiProviderCooldowns() {
  return listProviderCooldowns();
}

/**
 * Admin: clear Groq cooldowns.
 * - No args → clears every cooldown entry.
 * - `model` provided → clears every (model, *) entry for that model.
 * Returns the number of entries cleared.
 */
export function clearGroqCooldowns(model?: string | null): number {
  if (!model) {
    const n = _groqCooldown.size;
    _groqCooldown.clear();
    return n;
  }
  const prefix = `${model.toLowerCase()}::`;
  let n = 0;
  for (const k of Array.from(_groqCooldown.keys())) {
    if (k.startsWith(prefix)) {
      _groqCooldown.delete(k);
      n++;
    }
  }
  return n;
}

export function clearAiProviderCooldowns(provider?: ProviderType | null, model?: string | null): number {
  const generic = clearProviderCooldowns({ provider, model });
  if (provider && provider !== "groq") return generic;
  return generic + clearGroqCooldowns(model);
}

function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}
function cursorKey(model: string | undefined | null, fingerprints: string[]): string {
  return `${(model ?? "default").toLowerCase()}:${fingerprints.join("|")}`;
}

function cacheKey(model: string, opts: RouteOpts) {
  const h = createHash("sha256");
  h.update(model);
  h.update("\0");
  h.update((opts.skipProviders ?? []).slice().sort().join(","));
  h.update("\0");
  h.update(opts.systemInstruction ?? "");
  h.update("\0");
  h.update(
    typeof opts.userContent === "string" ? opts.userContent : JSON.stringify(opts.userContent),
  );
  h.update("\0");
  h.update(opts.json ? "json" : "text");
  h.update("\0");
  h.update(String(opts.temperature ?? 0.2));
  return h.digest("hex");
}

// ---- DB access (uses admin client; this is server-only infra) ----

// A full pipeline run calls routeAI() ~25-30 times, and until now each one
// independently re-queried ai_providers AND user_ai_keys from scratch —
// this data cannot change mid-run in any way that matters for routing a
// single case, so re-fetching it every single call was pure redundant
// latency. Short TTL (not a long one) so the admin AI Providers page still
// reflects a just-added/edited key reasonably quickly.
const PROVIDER_ROWS_CACHE_TTL_MS = 20_000;
let _providerRowsCache: { rows: ProviderRow[]; expiresAt: number } | null = null;

async function loadProviderRows(): Promise<ProviderRow[]> {
  if (_providerRowsCache && _providerRowsCache.expiresAt > Date.now())
    return _providerRowsCache.rows;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("ai_providers")
    .select(
      "id,provider_type,display_name,enabled,priority,base_url,default_model,secret_name,api_key_encrypted",
    )
    .order("priority", { ascending: true });
  if (error) throw new Error(`ai_providers load failed: ${error.message}`);
  // Drop rows whose provider_type has no adapter in the factory. Left in, they
  // build an undefined provider and take the whole chain down with a TypeError
  // instead of failing over.
  const SUPPORTED: ProviderType[] = [
    "groq",
    "openai",
    "anthropic",
    "gemini",
    "openrouter",
    "ollama",
    "lmstudio",
  ];

  const rows = ((data ?? []) as ProviderRow[]).filter((r) => SUPPORTED.includes(r.provider_type));
  _providerRowsCache = { rows, expiresAt: Date.now() + PROVIDER_ROWS_CACHE_TTL_MS };
  return rows;
}

/**
 * Resolve ALL of the user's active providers + decrypted keys from user_ai_keys,
 * grouped by provider, ordered by the provider group's earliest created_at
 * (oldest-added provider tried first). Multiple keys for the same provider
 * become that provider's rotation pool. This is what lets a user add Groq +
 * Gemini + OpenAI etc. and have the router fall through across providers
 * (not just across keys within one provider) when one runs out of quota.
 */
const _userProviderGroupsCache = new Map<
  string,
  { groups: Array<{ provider: ProviderType; keys: string[] }>; expiresAt: number }
>();
const USER_PROVIDER_GROUPS_CACHE_TTL_MS = 20_000;

async function loadUserProviderKeyGroups(
  userId: string,
): Promise<Array<{ provider: ProviderType; keys: string[] }>> {
  const cached = _userProviderGroupsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.groups;
  const groups = await _loadUserProviderKeyGroupsUncached(userId);
  _userProviderGroupsCache.set(userId, {
    groups,
    expiresAt: Date.now() + USER_PROVIDER_GROUPS_CACHE_TTL_MS,
  });
  return groups;
}

async function _loadUserProviderKeyGroupsUncached(
  userId: string,
): Promise<Array<{ provider: ProviderType; keys: string[] }>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptKey } = await import("@/lib/canonical/encryption.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from("user_ai_keys")
    .select("provider,encrypted_key,is_active,created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error || !data || data.length === 0) return [];

  const order: ProviderType[] = [];
  const byProvider = new Map<ProviderType, string[]>();
  for (const row of data as Array<{ provider: string; encrypted_key: string }>) {
    const provider = row.provider as ProviderType;
    if (!byProvider.has(provider)) {
      byProvider.set(provider, []);
      order.push(provider); // first time we see a provider = its group's oldest key
    }
    try {
      const plain = decryptKey(row.encrypted_key);
      if (plain) byProvider.get(provider)!.push(plain);
    } catch {
      /* skip undecryptable */
    }
  }
  const groups = order
    .map((provider) => ({ provider, keys: byProvider.get(provider) ?? [] }))
    .filter((g) => g.keys.length > 0);
  if (groups.length <= 1) return groups; // nothing to reorder

  // Apply the user's saved provider-order preference (Intelligence Providers
  // page), if any — previously this preference was saved and displayed but
  // never actually consulted here, so reordering it had zero real effect.
  // Only reorders among providers that actually have a working key; a
  // provider with no key was never in `groups` to begin with, so this can't
  // resurrect an unconfigured provider into the chain.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orderRows } = await (supabaseAdmin as any)
      .from("user_provider_order")
      .select("provider,order_index")
      .eq("user_id", userId)
      .order("order_index", { ascending: true });
    if (orderRows && orderRows.length > 0) {
      const preferredOrder = (orderRows as Array<{ provider: string }>).map((r) => r.provider);
      const byPreference = (p: ProviderType) => {
        const idx = preferredOrder.indexOf(p);
        return idx === -1 ? preferredOrder.length : idx; // unlisted providers keep their created_at position, after all listed ones
      };
      groups.sort((a, b) => byPreference(a.provider) - byPreference(b.provider));
    }
  } catch {
    /* saved order is a preference layer, not a credential — never fail the call over it */
  }

  return groups;
}

async function loadTaskRoute(
  task: AITask,
): Promise<{ provider_id: string | null; model: string | null } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("ai_task_routing")
    .select("provider_id,model")
    .eq("task", task)
    .maybeSingle();
  return data ?? null;
}

async function stampProvider(id: string, ok: boolean, error?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const patch = ok
    ? { last_ok_at: new Date().toISOString(), last_error: null }
    : { last_error_at: new Date().toISOString(), last_error: (error ?? "").slice(0, 500) };
  await supabaseAdmin.from("ai_providers").update(patch).eq("id", id);
}

// ---- Public API ----

export async function listProviderRows() {
  return loadProviderRows();
}

/**
 * Largest per-request payload (in CHARS) that EVERY configured provider can
 * accept, capped at `ceilingChars`.
 *
 * Why this exists: the pre-flight size gate in `routeAI` skips any provider
 * whose input budget is smaller than the prompt. With a 60k-char batch, Groq
 * (6k-token budget) is skipped on every single call — so all load lands on the
 * wide-context providers, and when those are rate-limited or out of credits the
 * whole run dies even though a perfectly healthy Groq key is sitting idle.
 * Packing to the narrowest configured provider keeps every provider in the
 * fallback chain eligible. The corpus size is unchanged; it is simply split
 * into more, smaller requests.
 */
export async function packingCharBudget(ceilingChars: number): Promise<number> {
  const rows = await loadProviderRows();
  let narrowest = Infinity;
  for (const r of rows) {
    narrowest = Math.min(narrowest, providerInputBudget(r.provider_type) * 3.5);
  }
  if (!Number.isFinite(narrowest)) return ceilingChars;
  return Math.max(MIN_PACKING_CHARS, Math.min(ceilingChars, Math.floor(narrowest)));
}

/** Never pack below this — tiny batches multiply request count for no gain. */
const MIN_PACKING_CHARS = 8_000;


export async function routeAI(opts: RouteOpts): Promise<RouteResult> {
  _state.totalCalls++;
  const skippedProviders = new Set(opts.skipProviders ?? []);
  const rows = (await loadProviderRows()).filter((r) => !skippedProviders.has(r.provider_type));

  // Resolve runtime keys: explicit apiKey(s) first (single provider, unchanged);
  // then per-user keys, which may now span MULTIPLE providers.
  let runtimeProvider: ProviderType | undefined = opts.runtimeProvider;
  const explicitKeys = [...(opts.apiKeys ?? []), ...(opts.apiKey ? [opts.apiKey] : [])].filter(
    (k, i, a): k is string => typeof k === "string" && k.trim().length > 0 && a.indexOf(k) === i,
  );

  // Groups of {provider, keys}, tried in order, each group's keys rotated
  // internally. Populated from an explicit override (if provided) AND from
  // every active provider/key the user has configured, merged together —
  // NOT either/or. This ensures fallback keys added in Admin -> AI
  // Providers are always tried even when the caller (e.g. the pipeline)
  // also passes its own explicit Groq apiKey/apiKeys.
  let runtimeGroups: Array<{ provider: ProviderType; keys: string[] }> = [];
  if (explicitKeys.length > 0) {
    runtimeProvider = runtimeProvider ?? "groq"; // back-compat default
    runtimeGroups = [{ provider: runtimeProvider, keys: explicitKeys }];
  }
  if (opts.userId) {
    const userGroups = await loadUserProviderKeyGroups(opts.userId);
    const explicitProviders = new Set(runtimeGroups.map((g) => g.provider));
    for (const g of userGroups) {
      if (explicitProviders.has(g.provider)) {
        // Same provider as the explicit override — append any keys not
        // already included, so user-added keys still act as fallbacks.
        const existing = runtimeGroups.find((r) => r.provider === g.provider)!;
        const newKeys = g.keys.filter((k) => !existing.keys.includes(k));
        existing.keys.push(...newKeys);
      } else {
        // A different provider entirely — add it as its own fallback group.
        runtimeGroups.push(g);
      }
    }
  }

  if (!rows.length && runtimeGroups.length === 0) throw new Error("No AI providers configured.");

  // Build the ordered chain across every runtime group.
  let chain: RuntimeGroqRow[] = [];
  if (runtimeGroups.length > 0) {
    for (const { provider, keys } of runtimeGroups) {
      if (keys.length === 0) continue;
      const baseRow: ProviderRow = rows.find((r) => r.provider_type === provider) ?? {
        id: `runtime-${provider}`,
        provider_type: provider,
        display_name: `${provider} runtime key`,
        enabled: true,
        priority: 1,
        base_url: null,
        default_model: null,
        secret_name: null,
        api_key_encrypted: null,
      };
      const fingerprints = keys.map(keyFingerprint);
      const ck = cursorKey(opts.model, fingerprints);
      const start = keys.length > 1 ? (_groqKeyCursor.get(ck) ?? 0) % keys.length : 0;
      if (keys.length > 1) _groqKeyCursor.set(ck, (start + 1) % keys.length);
      const rotatedIndices = keys.map((_, idx) => (start + idx) % keys.length);
      chain.push(
        ...rotatedIndices.map((idx) => ({
          ...baseRow,
          id: `${baseRow.id}:runtime:${idx}`,
          enabled: true,
          runtimeApiKey: keys[idx],
          runtimeKeyIndex: idx,
          runtimeKeyFingerprint: fingerprints[idx],
          rotationStartIndex: start,
          rotationAdvanced: keys.length > 1,
          selectionReason: `${provider}_round_robin_runtime_key`,
          consideredKeyIndexes: rotatedIndices,
        })),
      );
    }
    // Server-secret fallback: after every user/runtime key has been tried,
    // fall through to enabled ai_providers rows whose key comes from a
    // server-side secret. This never includes a platform/credit-billed
    // gateway — the Lovable provider was removed from ProviderType, from the
    // factory and from the database, so only self-hosted or self-funded
    // provider secrets (GROQ_API_KEY, GEMINI_API_KEY, ...) can appear here.
    // A provider already tried above as a user key is skipped so the same
    // provider is not walked twice per call.
    const alreadyTried = new Set(runtimeGroups.map((g) => g.provider));
    const { resolveApiKey } = await import("./providers/factory");
    for (const r of rows) {
      if (!r.enabled) continue;
      if (alreadyTried.has(r.provider_type)) continue;
      if (!resolveApiKey(r)) continue; // no server key configured — nothing to try
      chain.push({ ...r, selectionReason: "server_secret_fallback" });
    }
  } else if (opts.forceProvider) {
    chain = rows.filter((r) => r.provider_type === opts.forceProvider && r.enabled);
    if (!chain.length)
      throw new Error(`Provider '${opts.forceProvider}' is not enabled or not configured.`);

  } else {
    let pinned: ProviderRow | undefined;
    if (opts.task) {
      const tr = await loadTaskRoute(opts.task);
      if (tr?.provider_id) pinned = rows.find((r) => r.id === tr.provider_id && r.enabled);
    }
    const enabled = rows.filter((r) => r.enabled && r.id !== pinned?.id);
    chain = pinned ? [pinned, ...enabled] : enabled;
  }

  if (!chain.length) throw new Error("No enabled AI providers available.");

  // Cache lookup (keyed by intended model of the FIRST provider in chain).
  const firstModel = opts.model ?? chain[0].default_model ?? chain[0].provider_type;
  const useCache = opts.cache !== false;
  const ck = useCache ? cacheKey(firstModel, opts) : "";
  if (useCache && ck) {
    const hit = _cache.get(ck);
    if (hit) {
      _state.cacheHits++;
      return { ...hit.result, cached: true };
    }
  }

  const fellBackFrom: ProviderType[] = [];
  const errors: string[] = [];
  const preAttemptSkips: string[] = [];
  const cooldownSkips: Array<{
    provider: ProviderType;
    model: string | null;
    retryAfterMs: number;
    reason: string;
  }> = [];
  // Track Groq orgs proven exhausted this call and the (fingerprint→org)
  // attribution learned from their 429 responses. Lets us skip only
  // known-same-org keys while still trying keys from other Groq accounts.
  const exhaustedOrgs = new Set<string>();
  const keyOrgMap = new Map<string, string>();
  // Providers actually attempted (a chat() call was made) — as opposed to
  // every provider present in the built chain, some of which may have been
  // skipped entirely (e.g. remaining same-provider keys after a 413, or
  // Groq keys skipped during an active cooldown). Used for the final error
  // message so "tried: x, y" reflects reality instead of the full chain.
  const attemptedProviders = new Set<ProviderType>();

  const effectiveModelFor = (row: RuntimeGroqRow): string | null =>
    row.provider_type === "groq"
      ? opts.model ?? row.default_model ?? null
      : row.default_model ?? opts.model ?? null;
  const cooldownIdentityFor = (row: RuntimeGroqRow): string =>
    row.runtimeKeyFingerprint ?? row.id ?? row.provider_type;

  traceAsync({
    phase: "ai",
    step: "router.chain_built",
    status: "info",
    model: opts.model ?? null,
    detail: {
      chain: chain.map((r, idx) => ({
        order: idx + 1,
        provider: r.provider_type,
        model: r.default_model ?? null,
        runtime_key: r.runtimeKeyIndex != null ? `key#${r.runtimeKeyIndex + 1}` : "(env)",
      })),
      skipped_providers: [...skippedProviders],
      requested_model: opts.model ?? null,
    },
  });

  // ---------------------------------------------------------------------
  // Pre-flight request-size gate.
  //
  // Groq's free tier caps a SINGLE request at the tokens-per-minute ceiling
  // (8k). A 17k-token engine prompt therefore returns HTTP 413 every single
  // time — it burns an attempt, marks the key, and (worse) the run then dies
  // even though Gemini, with a 1M-token window, could have served it fine.
  // Estimate the payload once and route around providers that physically
  // cannot accept it, instead of learning that from a guaranteed rejection.
  // ---------------------------------------------------------------------
  const estimatedInputTokens = estimateInputTokens(opts);
  const sizeEligible = chain.map((r) => estimatedInputTokens <= providerInputBudget(r.provider_type));
  const anySizeEligible = sizeEligible.some(Boolean);

  let realAttempts = 0;
  for (let i = 0; i < chain.length; i++) {
    const row = chain[i];
    if (anySizeEligible && !sizeEligible[i]) {
      preAttemptSkips.push(
        `${row.display_name} [payload_too_large]: estimated ${estimatedInputTokens} input tokens exceeds ${providerInputBudget(row.provider_type)} token provider budget`,
      );
      traceAsync({
        phase: "ai",
        step: "router.provider_skipped",
        status: "warn",
        provider: row.provider_type,
        model: effectiveModelFor(row),
        detail: {
          reason: "payload_exceeds_provider_limit",
          estimated_input_tokens: estimatedInputTokens,
          provider_input_budget: providerInputBudget(row.provider_type),
        },
      });
      continue;
    }

    if (realAttempts >= MAX_LOGICAL_PROVIDER_ATTEMPTS && attemptedProviders.has(row.provider_type)) {
      traceAsync({
        phase: "ai",
        step: "router.attempt_budget_exhausted",
        status: "warn",
        model: opts.model ?? null,
        detail: {
          max_attempts: MAX_LOGICAL_PROVIDER_ATTEMPTS,
          attempted_providers: [...attemptedProviders],
          remaining_chain: chain.length - i,
        },
      });
      preAttemptSkips.push(
        `${row.display_name} [attempt_budget]: skipped duplicate ${row.provider_type} key after ${MAX_LOGICAL_PROVIDER_ATTEMPTS} real provider calls`,
      );
      continue;
    }
    const effectiveModel = effectiveModelFor(row);
    const candidateCooldown = getProviderCooldown({
      provider: row.provider_type,
      model: effectiveModel,
      key: cooldownIdentityFor(row),
    });
    if (candidateCooldown) {
      cooldownSkips.push({
        provider: row.provider_type,
        model: effectiveModel,
        retryAfterMs: candidateCooldown.retryAfterMs,
        reason: candidateCooldown.reason,
      });
      preAttemptSkips.push(
        `${row.display_name} [cooldown]: ${row.provider_type}/${effectiveModel ?? "default"} key ${row.runtimeKeyIndex != null ? `#${row.runtimeKeyIndex + 1}` : "env"} retry in ${Math.ceil(candidateCooldown.retryAfterMs / 1000)}s (${candidateCooldown.reason})`,
      );
      traceAsync({
        phase: "ai",
        step: "router.provider_skipped",
        status: "warn",
        provider: row.provider_type,
        model: effectiveModel,
        detail: {
          reason: "cooldown_active",
          cooldown_ms: candidateCooldown.retryAfterMs,
          cooldown_reason: candidateCooldown.reason,
          key: row.runtimeKeyIndex != null ? `key#${row.runtimeKeyIndex + 1}` : "(env)",
        },
      });
      continue;
    }
    const provider: AIProvider = buildProvider(row, row.runtimeApiKey);
    const maskedKey = row.runtimeApiKey
      ? `${row.runtimeApiKey.slice(0, 4)}…${row.runtimeApiKey.slice(-4)}`
      : "(env)";
    const keyLabel =
      row.runtimeKeyIndex != null ? `key#${row.runtimeKeyIndex + 1} ${maskedKey}` : maskedKey;
    const t0 = Date.now();
    realAttempts++;
    attemptedProviders.add(row.provider_type);
    traceAsync({
      phase: "ai",
      step: "router.attempt",
      status: "start",
      provider: row.provider_type,
      model: opts.model ?? row.default_model ?? null,
      attempt: i + 1,
      detail: { key: keyLabel, chain_position: `${i + 1}/${chain.length}` },
    });
    try {
      // The requested opts.model may be provider-specific (e.g. a Groq model
      // like "meta-llama/llama-4-scout..."). When we fail over to a different
      // provider family, strip opts.model so that provider's default_model is
      // used instead of forwarding an unknown model name.
      const baseProviderOpts =
        row.provider_type === "groq" ? opts : { ...opts, model: row.default_model ?? undefined };
      // Retry-with-backoff only for transient transport/5xx failures. HTTP 429
      // never retries in-place: the outer cooldown/failover path must mark the
      // exact key/model unavailable immediately so a single logical AI call
      // cannot hammer a fresh Gemini/Groq key repeatedly.
      let r: ChatResult | undefined;
      let lastErr: unknown;
      const RETRY_DELAYS_MS = [400].slice(0, MAX_PROVIDER_RETRIES_PER_CALL);
      let retryCount = 0;
      const retryReasons: string[] = [];
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          assertCheckpointBudget(`before AI call attempt ${attempt + 1}`);
          const providerOpts = {
            ...baseProviderOpts,
            timeoutMs:
              baseProviderOpts.timeoutMs ??
              aiCallTimeoutForCheckpoint(`AI call attempt ${attempt + 1}`),
          };
          r = await provider.chat(providerOpts);
          assertCheckpointBudget(`after AI call attempt ${attempt + 1}`);
          lastErr = undefined;
          break;
        } catch (err) {
          if (isCheckpointError(err)) throw err;
          lastErr = err;
          const em = err instanceof Error ? err.message : String(err);
          const isPayment =
            /HTTP 402|payment_required|not enough credits|insufficient credits/i.test(em);
          const isRateLimit = !isPayment && /HTTP 429|rate.?limit|too many requests/i.test(em);
          const isTransport =
            /HTTP 5\d\d|timeout|ETIMEDOUT|ECONNRESET/i.test(em) &&
            !/HTTP 413|request too large|payload too large|context.*length|maximum context/i.test(
              em,
            ) &&
            !/HTTP 401|HTTP 403|invalid_api_key|unauthor/i.test(em);

          if (isRateLimit) throw err;

          if (!isTransport || attempt >= RETRY_DELAYS_MS.length) throw err;
          retryCount++;
          retryReasons.push(em.slice(0, 120));
          assertCheckpointBudget(
            `before retry backoff ${attempt + 1}`,
            RETRY_DELAYS_MS[attempt] + 2_000,
          );
          console.warn(
            `[router.key] retry attempt=${attempt + 1} after ${RETRY_DELAYS_MS[attempt]}ms provider=${row.provider_type} ${keyLabel} err=${em.slice(0, 120)}`,
          );
          await new Promise((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
        }
      }
      if (!r) throw lastErr ?? new Error("provider returned no result");
      record({
        ts: Date.now(),
        provider: row.provider_type,
        providerId: row.id,
        model: r.model,
        ok: true,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        failover: i > 0,
      });
      // Push into current engine's telemetry scope (no-op outside a scope).
      try {
        const { pushTelemetryCall, computePromptSha256 } = await import("./telemetry.server");
        const routingStrategy =
          runtimeGroups.length > 0
            ? "runtime_key_chain"
            : opts.forceProvider
              ? "force_provider"
              : opts.task
                ? "task_route"
                : "priority_chain";
        pushTelemetryCall({
          ts: Date.now(),
          provider: row.provider_type,
          providerId: row.id,
          model: r.model,
          ok: true,
          latencyMs: Date.now() - t0,
          providerLatencyMs: r.latencyMs,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          retryCount,
          retryReasons: retryReasons.length ? retryReasons : undefined,
          providerRequestId: r.providerRequestId,
          fellBackFrom: fellBackFrom.length ? [...fellBackFrom] : undefined,
          keyIndex: row.runtimeKeyIndex,
          keyLabel,
          keyFingerprint: row.runtimeKeyFingerprint,
          keySelectionReason:
            row.selectionReason ??
            (row.runtimeApiKey
              ? `${row.provider_type}_runtime_key`
              : `${row.provider_type}_configured_provider`),
          consideredProviders:
            runtimeGroups.length > 0 ? runtimeGroups.map((g) => g.provider) : [row.provider_type],
          consideredKeyIndexes: row.consideredKeyIndexes,
          rotationStartIndex: row.rotationStartIndex,
          rotationAdvanced: row.rotationAdvanced,
          cooldownState: "inactive",
          promptSha256: computePromptSha256({
            systemInstruction: opts.systemInstruction,
            userContent: opts.userContent,
            model: r.model,
            temperature: opts.temperature,
            json: opts.json,
          }),
          config: {
            provider: row.provider_type,
            model: r.model,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            json_mode: opts.json,
            routing_strategy: routingStrategy,
          },
        });
      } catch {
        /* noop */
      }
      console.info(
        `[router.key] served ok provider=${row.provider_type} ${keyLabel} tokens=${r.totalTokens ?? 0} ms=${r.latencyMs}`,
      );
      traceAsync({
        phase: "ai",
        step: "router.served",
        status: "ok",
        provider: row.provider_type,
        model: r.model ?? opts.model ?? row.default_model ?? null,
        attempt: i + 1,
        durationMs: r.latencyMs ?? Date.now() - t0,
        detail: {
          key: keyLabel,
          total_tokens: r.totalTokens ?? null,
          retries: retryCount,
          fell_back_from: fellBackFrom.length ? fellBackFrom : null,
        },
      });
      if (!row.runtimeApiKey)
        void stampProvider(row.id, true).catch((e) =>
          console.warn("[router] stampProvider failed", e),
        );
      const result: RouteResult = {
        ...r,
        provider: row.provider_type,
        providerId: row.id,
        retryCount,
        ...(retryReasons.length ? { retryReasons } : {}),
        ...(row.runtimeKeyIndex != null ? { keyIndex: row.runtimeKeyIndex } : {}),
        ...(fellBackFrom.length ? { fellBackFrom } : {}),
      } as RouteResult;
      if (useCache && ck) {
        if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value as string);
        _cache.set(ck, { result, ts: Date.now() });
      }
      return result;
    } catch (e) {
      if (isCheckpointError(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // Classify failure so operators can distinguish transient / retryable
      // faults from quota-exhaustion (whole KEY is out) and payload-too-large
      // (which should be split-and-retried by the caller, not by rotating keys).
      const isPayload =
        /HTTP 413|request too large|payload too large|context.*length|maximum context/i.test(msg);
      // Groq returns code:"rate_limit_exceeded" in the JSON body for TPM-exceeded
      // 413s. Require an actual HTTP 429 (or an explicit quota keyword that is
      // NOT co-occurring with 413) so genuine payload-too-large errors aren't
      // mislabeled as quota and don't defeat payload splitting.
      const isPayment = /HTTP 402|payment_required|not enough credits|insufficient credits/i.test(
        msg,
      );
      const isQuota =
        !isPayload &&
        (/HTTP 429/i.test(msg) || /insufficient_quota|too many requests|quota exceeded/i.test(msg));
      const isAuth = /HTTP 401|HTTP 403|invalid_api_key|unauthor/i.test(msg);
      const kind = isPayload
        ? "payload_too_large"
        : isPayment || isQuota
          ? "quota"
          : isAuth
            ? "auth"
            : "other";
      console.warn(
        `[router.key] failed provider=${row.provider_type} ${keyLabel} kind=${kind} err=${msg.slice(0, 200)}`,
      );
      traceAsync({
        phase: "ai",
        step: "router.attempt_failed",
        status: "error",
        provider: row.provider_type,
        model: opts.model ?? row.default_model ?? null,
        attempt: i + 1,
        durationMs: Date.now() - t0,
        error: msg,
        detail: {
          key: keyLabel,
          kind,
          real_attempts: realAttempts,
          max_real_attempts: MAX_LOGICAL_PROVIDER_ATTEMPTS,
        },
      });
      record({
        ts: Date.now(),
        provider: row.provider_type,
        providerId: row.id,
        model: opts.model ?? row.default_model ?? "?",
        ok: false,
        latencyMs: Date.now() - t0,
        error: `[${kind}] ${msg}`,
      });
      try {
        const { pushTelemetryCall } = await import("./telemetry.server");
        pushTelemetryCall({
          ts: Date.now(),
          provider: row.provider_type,
          providerId: row.id,
          model: opts.model ?? row.default_model ?? "?",
          ok: false,
          latencyMs: Date.now() - t0,
          error: msg.slice(0, 300),
          errorKind: kind,
          keyIndex: row.runtimeKeyIndex,
          keyLabel,
          keyFingerprint: row.runtimeKeyFingerprint,
          keySelectionReason:
            row.selectionReason ??
            (row.runtimeApiKey
              ? `${row.provider_type}_runtime_key`
              : `${row.provider_type}_configured_provider`),
          consideredProviders:
            runtimeGroups.length > 0 ? runtimeGroups.map((g) => g.provider) : [row.provider_type],
          consideredKeyIndexes: row.consideredKeyIndexes,
          rotationStartIndex: row.rotationStartIndex,
          rotationAdvanced: row.rotationAdvanced,
          cooldownState: isQuota ? "marked" : "inactive",
          providerRequestId: (e as { providerRequestId?: string })?.providerRequestId,
        });
      } catch {
        /* noop */
      }

      if (!row.runtimeApiKey)
        void stampProvider(row.id, false, msg).catch((e) =>
          console.warn("[router] stampProvider failed", e),
        );
      errors.push(`${row.display_name} [${kind}]: ${msg}`);
      fellBackFrom.push(row.provider_type);
      if (isPayment || isQuota) {
        const cooldownReason: CooldownReason = isPayment ? "payment" : isQuota ? "quota" : "rate_limit";
        const retryAfterMs = (e as { retryAfterMs?: number })?.retryAfterMs ?? parseRetryHintMs(msg);
        const cd = markProviderCooldown({
          provider: row.provider_type,
          model: effectiveModel,
          key: cooldownIdentityFor(row),
          reason: cooldownReason,
          message: msg,
          retryAfterMs,
        });
        traceAsync({
          phase: "ai",
          step: "router.cooldown_marked",
          status: "warn",
          provider: row.provider_type,
          model: effectiveModel,
          detail: {
            key: keyLabel,
            retry_after_ms: cd.retryAfterMs,
            reason: cd.reason,
          },
        });
        if (row.provider_type === "groq") {
          const orgMatch = msg.match(/organization[\s`'"]+([a-z0-9_]+)/i);
          const exhaustedOrg = orgMatch?.[1] ?? null;
          const limitKind = isQuota ? parseGroqLimitKind(msg) : "unknown";
          markGroqCoolingDown(opts.model, exhaustedOrg, limitKind);
          if (isQuota && exhaustedOrg) {
            exhaustedOrgs.add(exhaustedOrg);
            if (row.runtimeKeyFingerprint) keyOrgMap.set(row.runtimeKeyFingerprint, exhaustedOrg);
            console.warn(
              `[router.key] cooldown set org=${exhaustedOrg} model=${opts.model ?? "default"} kind=${limitKind}`,
            );
          }
        }
      }
      // Payload-too-large is not a key problem — rotating to the next Groq
      // key with the same oversized payload will fail identically, so
      // short-circuit remaining runtime keys.
      //
      // Quota (HTTP 429) is per-ORGANIZATION at Groq. Extract the org id
      // from the 429 body and only skip subsequent keys already proven to
      // belong to an exhausted org this run. Unknown-org keys are still
      // tried — an extra fast 429 is cheap compared to stalling the
      // pipeline when the next key is a healthy different-org key.
      if (row.runtimeApiKey && isPayload) {
        // Only skip ahead over remaining keys of the SAME provider — a 413
        // from Groq says nothing about Gemini/OpenAI/etc.'s limits, and
        // those later groups deserve a real attempt, not a skip.
        let j = i + 1;
        while (
          j < chain.length &&
          chain[j].runtimeApiKey &&
          chain[j].provider_type === row.provider_type
        )
          j++;
        if (j > i + 1) {
          console.warn(
            `[router.key] skipping ${j - i - 1} remaining ${row.provider_type} key(s) — payload too large is not per-key`,
          );
          i = j - 1;
        }
      } else if (row.runtimeApiKey && isQuota && row.provider_type === "groq") {
        let skipped = 0;
        while (i + 1 < chain.length && chain[i + 1].runtimeApiKey) {
          const nextFp = chain[i + 1].runtimeKeyFingerprint;
          const nextOrg = nextFp ? keyOrgMap.get(nextFp) : undefined;
          if (nextOrg && exhaustedOrgs.has(nextOrg)) {
            i++;
            skipped++;
            continue;
          }
          break;
        }
        if (skipped > 0)
          console.warn(
            `[router.key] skipping ${skipped} runtime key(s) known-attributed to exhausted org(s) [${[...exhaustedOrgs].join(",")}]`,
          );
      }
      // Continue to next Groq key only for per-key auth/network failures.
    }
  }

  const triedProviders = [...attemptedProviders].join(", ") || "none";
  const chainProviders = [...new Set(chain.map((r) => r.provider_type))];
  const untried = chainProviders.filter((p) => !attemptedProviders.has(p));
  const untriedNote = untried.length
    ? ` (configured but never attempted: ${untried.join(", ")})`
    : "";
  const skipNote = preAttemptSkips.length
    ? ` Skipped before attempt: ${preAttemptSkips.slice(0, 8).join(" | ")}`
    : "";
  // No provider was actually called and at least one was held back by a
  // cooldown: waiting is the only path that can still succeed.
  const allAttemptsSkippedByCooldown =
    attemptedProviders.size === 0 && cooldownSkips.length > 0;
  const soonestCooldownMs = cooldownSkips.reduce<number | null>(
    (min, s) => (min == null ? s.retryAfterMs : Math.min(min, s.retryAfterMs)),
    null,
  );
  traceAsync({
    phase: "ai",
    step: "router.exhausted",
    status: "error",
    model: opts.model ?? null,
    error: `All configured provider keys failed (tried: ${triedProviders})`,
    detail: {
      tried: [...attemptedProviders],
      never_attempted: untried,
      errors: errors.slice(0, 5),
      skipped_before_attempt: preAttemptSkips.slice(0, 8),
      cooldowns: cooldownSkips.slice(0, 8),
    },
  });
  if (allAttemptsSkippedByCooldown) {
    // Rate-limit cooldowns are short-lived. Failing the whole stage the instant
    // every key is cooling down is what makes a run collapse seconds after a
    // single 429. Wait the shortest cooldown out (when the checkpoint budget
    // allows) and try the chain again before giving up.
    const waits = opts._cooldownWaits ?? 0;
    const MAX_COOLDOWN_WAITS = 3;
    const MAX_WAIT_MS = 95_000;
    if (waits < MAX_COOLDOWN_WAITS && soonestCooldownMs != null && soonestCooldownMs <= MAX_WAIT_MS) {
      const waitMs = Math.min(MAX_WAIT_MS, soonestCooldownMs + 1_000);
      let budgetOk = true;
      try {
        assertCheckpointBudget("before provider cooldown wait", waitMs + 5_000);
      } catch (err) {
        if (isCheckpointError(err)) budgetOk = false;
        else throw err;
      }
      if (budgetOk) {
        traceAsync({
          phase: "ai",
          step: "router.cooldown_wait",
          status: "warn",
          model: opts.model ?? null,
          detail: { wait_ms: waitMs, attempt: waits + 1, cooldowns: cooldownSkips.slice(0, 8) },
        });
        await new Promise((res) => setTimeout(res, waitMs));
        return routeAI({ ...opts, _cooldownWaits: waits + 1 });
      }
    }
    const retryText = soonestCooldownMs != null ? ` Retry after ${Math.ceil(soonestCooldownMs / 1000)}s.` : "";
    throw new Error(
      `All configured provider keys are cooling down after HTTP 429/rate-limit responses (tried: none${untriedNote}).${retryText}${skipNote}`,
    );
  }
  throw new Error(
    `All configured provider keys failed (tried: ${triedProviders}${untriedNote}). ${errors.join(" | ")}${skipNote}`,
  );
}
