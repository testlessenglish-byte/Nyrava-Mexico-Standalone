// Log/render scrubber. Pure, no I/O. Used by audit logs and any surface that
// might serialize internal state. Removes:
//   - API keys (sk_, sk-, sk-live_, Bearer, gsk_, sb_secret_)
//   - JWTs (3 base64url segments)
//   - UUIDs (case ids, row ids, provider ids)
//   - Long hex blobs (>=24 chars)
// Returns a structurally identical value with sensitive substrings masked.

const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_KEY]"],
  [/\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g, "[REDACTED_KEY]"],
  [/\bgsk_[A-Za-z0-9]{20,}\b/g, "[REDACTED_KEY]"],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._\-]{20,}\b/gi, "Bearer [REDACTED_TOKEN]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]"],
  [/\b[0-9a-f]{24,}\b/gi, "[REDACTED_HEX]"],
];

export function scrubString(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function scrub<T>(v: T): T {
  if (v == null) return v;
  if (typeof v === "string") return scrubString(v) as unknown as T;
  if (Array.isArray(v)) return v.map(scrub) as unknown as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // Redact common secret-bearing keys outright.
      if (/^(api[_-]?key|apikey|secret|token|authorization|password|service[_-]?role|encrypted[_-]?key)$/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = scrub(val);
      }
    }
    return out as unknown as T;
  }
  return v;
}
