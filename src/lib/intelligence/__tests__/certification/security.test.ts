// Security & Privacy — log scrubber must redact API keys, JWTs, UUIDs,
// long hex blobs, and secret-bearing field names before anything reaches
// audit logs or shipped reports.
import { describe, it, expect } from "vitest";
import { scrub, scrubString } from "@/lib/log-scrub";

describe("log scrubber", () => {
  it("redacts OpenAI-style sk- keys", () => {
    expect(scrubString("key=sk-abcdefghijklmnopqrstuvwxyz123456")).not.toContain("sk-abcdefg");
  });

  it("redacts Groq gsk_ keys", () => {
    expect(scrubString("auth=gsk_abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED_KEY]");
  });

  it("redacts Supabase sb_secret_ and sb_publishable_", () => {
    expect(scrubString("sb_secret_abcdefghij1234567890")).toContain("[REDACTED_KEY]");
    expect(scrubString("sb_publishable_yLoP7NTPqt5fwhgKAo1owW9r75XWn")).toContain("[REDACTED_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const s = scrubString("Authorization: Bearer abc.def.ghi.jklmnopqrstuvwxyz0123456789");
    expect(s).toContain("Bearer [REDACTED_TOKEN]");
  });

  it("redacts JWT-shaped values", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturepartabcdef";
    expect(scrubString(jwt)).toBe("[REDACTED_JWT]");
  });

  it("redacts UUID-shaped internal ids", () => {
    expect(scrubString("case_id=f0e9c4a2-1234-4abc-9def-0123456789ab")).toContain("[REDACTED_ID]");
  });

  it("redacts secret-bearing field names in nested objects", () => {
    const out = scrub({
      ok: true,
      api_key: "should-not-appear",
      nested: { Authorization: "Bearer xyz", note: "ok" },
      list: [{ secret: "boom" }],
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("should-not-appear");
    expect(JSON.stringify(out)).not.toContain("boom");
    expect((out.nested as Record<string, unknown>).Authorization).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).note).toBe("ok");
  });

  it("passes through ordinary content unchanged", () => {
    expect(scrubString("Defendant moved to suppress on Jan 4, 2026.")).toBe("Defendant moved to suppress on Jan 4, 2026.");
  });
});
