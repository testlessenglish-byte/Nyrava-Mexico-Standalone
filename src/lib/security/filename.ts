/**
 * Server-side filename sanitization for NEW uploads.
 *
 * Storage keys were previously built from the raw user-supplied filename.
 * This module produces a safe, still-readable key segment.
 *
 * Guarantees:
 *   - no "/" or "\" (no path traversal, no forced directory placement)
 *   - no ".." segments
 *   - no NUL / control characters
 *   - no Unicode bidi/zero-width spoofing characters
 *   - leading dots stripped (no hidden files)
 *   - extension preserved (lower-cased)
 *   - bounded length
 *
 * EXISTING storage objects are never renamed or migrated — this is applied
 * only when a new object key is generated.
 */

const MAX_BASE_LENGTH = 120;
const MAX_EXT_LENGTH = 12;

// Bidi overrides, zero-width and other invisible formatting characters that
// can be used to disguise a file extension (e.g. "invoice\u202Egpj.exe").
const SPOOFING_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Reduce any user-supplied path to its bare basename. */
export function baseName(name: string): string {
  const normalized = String(name ?? "").replace(/\\/g, "/");
  const last = normalized.split("/").filter(Boolean).pop() ?? "";
  return last;
}

/**
 * Sanitize a filename for use inside a storage object key.
 * Always returns a non-empty, safe string.
 */
export function sanitizeStorageFilename(rawName: string): string {
  let name = baseName(rawName)
    .normalize("NFKC")
    .replace(CONTROL_CHARS, "")
    .replace(SPOOFING_CHARS, "")
    .trim();

  // Collapse any remaining traversal attempts and separators.
  name = name.replace(/\.{2,}/g, ".").replace(/[/\\]/g, "_");

  // Split extension before aggressive character filtering so it survives.
  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot + 1) : "";

  base = base
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/_{2,}/g, "_")
    .replace(/^[._\s-]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, MAX_BASE_LENGTH)
    .trim();

  ext = ext
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_EXT_LENGTH);

  if (!base) base = "archivo";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Build a storage object key from trusted prefix parts plus one untrusted
 * filename. The unique id keeps collisions impossible after sanitization.
 */
export function buildStorageKey(parts: {
  prefixes: string[];
  uniqueId: string;
  filename: string;
}): string {
  const safePrefixes = parts.prefixes
    .map((p) => String(p).replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);
  return [...safePrefixes, `${parts.uniqueId}-${sanitizeStorageFilename(parts.filename)}`].join("/");
}
