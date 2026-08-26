/**
 * Phase 1 safe security hardening — browser security headers.
 *
 * Everything here is additive and low-risk:
 *   - HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors
 *   - Content-Security-Policy-Report-Only (DISCOVERY ONLY — never enforced)
 *
 * The CSP is deliberately emitted in Report-Only mode so violations can be
 * observed in the browser console without breaking TanStack hydration,
 * Supabase realtime, Google Fonts, document previews, blob-backed exports,
 * voice/audio playback, or Google OAuth.
 */

const SUPABASE_HOSTS = () => {
  const raw = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const hosts = new Set<string>();
  if (raw) {
    try {
      const url = new URL(raw);
      hosts.add(`https://${url.host}`);
      hosts.add(`wss://${url.host}`);
    } catch {
      /* ignore malformed env */
    }
  }
  // Wildcards keep the report-only policy resilient across preview/prod refs.
  hosts.add("https://*.supabase.co");
  hosts.add("wss://*.supabase.co");
  return Array.from(hosts);
};

/** AI + platform endpoints the browser or SSR layer may legitimately reach. */
const CONNECT_EXTRA = [
  "https://*.lovable.app",
  "https://*.lovable.dev",
  "https://api.groq.com",
  "https://generativelanguage.googleapis.com",
  "https://accounts.google.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

export function buildCspReportOnly(): string {
  const supabase = SUPABASE_HOSTS();
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // TanStack Start inlines hydration scripts; 'unsafe-inline' is required
    // and is one of the things this report-only pass exists to measure.
    "script-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com", "blob:"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", "data:", ...supabase],
    "connect-src": ["'self'", "blob:", "data:", ...supabase, ...CONNECT_EXTRA],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'", "blob:", "https://accounts.google.com", ...supabase],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https://accounts.google.com"],
    "frame-ancestors": FRAME_ANCESTORS(),
  };
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Clickjacking protection. Lovable preview and the published site both embed
 * the app in an editor iframe, and Google OAuth uses popups (not frames), so
 * we allow self + the Lovable editor origins rather than a blanket DENY.
 */
function FRAME_ANCESTORS(): string[] {
  return ["'self'", "https://*.lovable.app", "https://*.lovable.dev", "https://lovable.dev"];
}

export function buildSecurityHeaders(): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Voice Companion needs the microphone; everything else stays off.
    "Permissions-Policy": [
      "microphone=(self)",
      "camera=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ].join(", "),
    "Content-Security-Policy-Report-Only": buildCspReportOnly(),
  };
}

/** True when the header set should be applied to this response. */
export function shouldApplySecurityHeaders(pathname: string): boolean {
  // Internal Lovable routes (email webhooks/previews) are excluded, matching
  // the existing error-middleware bypass.
  return !pathname.startsWith("/lovable/");
}

/**
 * Apply the headers to a response without mutating an immutable header bag.
 * Existing headers already set by the app win — nothing is overwritten.
 */
export function withSecurityHeaders(response: Response, pathname: string): Response {
  if (!shouldApplySecurityHeaders(pathname)) return response;
  const headers = buildSecurityHeaders();
  try {
    for (const [key, value] of Object.entries(headers)) {
      if (!response.headers.has(key)) response.headers.set(key, value);
    }
    return response;
  } catch {
    const merged = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) {
      if (!merged.has(key)) merged.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: merged,
    });
  }
}
