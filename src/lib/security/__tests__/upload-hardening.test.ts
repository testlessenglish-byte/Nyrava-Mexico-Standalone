import { describe, expect, it } from "vitest";
import { sanitizeStorageFilename, buildStorageKey, baseName } from "@/lib/security/filename";
import {
  detectSignature,
  validateUpload,
  isSupportedExtension,
  categoryOf,
} from "@/lib/security/file-validation";
import { buildSecurityHeaders, withSecurityHeaders } from "@/lib/security/security-headers";

const bytes = (...v: number[]) => new Uint8Array(v);
const ascii = (s: string) => new Uint8Array(Array.from(s).map((c) => c.charCodeAt(0)));

describe("sanitizeStorageFilename", () => {
  it("strips directory separators and traversal", () => {
    expect(sanitizeStorageFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeStorageFilename("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(sanitizeStorageFilename("a/b/c/demanda.pdf")).toBe("demanda.pdf");
  });

  it("removes null and control characters", () => {
    expect(sanitizeStorageFilename("dem\u0000anda\u0007.pdf")).toBe("demanda.pdf");
  });

  it("removes bidi/zero-width spoofing characters", () => {
    const spoofed = "factura\u202Egpj.exe";
    const safe = sanitizeStorageFilename(spoofed);
    expect(safe).not.toContain("\u202E");
    expect(safe.endsWith(".exe")).toBe(true);
  });

  it("preserves readable Spanish filenames and extensions", () => {
    expect(sanitizeStorageFilename("Demanda de Amparo Indirecto.pdf")).toBe(
      "Demanda de Amparo Indirecto.pdf",
    );
    expect(sanitizeStorageFilename("Resolución Definitiva ñ.PDF")).toBe(
      "Resolución Definitiva ñ.pdf",
    );
  });

  it("never returns an empty or hidden filename", () => {
    expect(sanitizeStorageFilename("")).toBe("archivo");
    expect(sanitizeStorageFilename("...")).toBe("archivo");
    expect(sanitizeStorageFilename(".env")).toBe("env");
  });

  it("bounds length", () => {
    const long = "a".repeat(500) + ".pdf";
    expect(sanitizeStorageFilename(long).length).toBeLessThanOrEqual(130);
  });

  it("baseName reduces any path", () => {
    expect(baseName("x/y/z.txt")).toBe("z.txt");
  });
});

describe("buildStorageKey", () => {
  it("produces a three-segment key with a sanitized filename", () => {
    const key = buildStorageKey({
      prefixes: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
      uniqueId: "33333333",
      filename: "../evidencia final.pdf",
    });
    expect(key.split("/")).toHaveLength(3);
    expect(key.endsWith("33333333-evidencia final.pdf")).toBe(true);
    expect(key).not.toContain("..");
  });
});

describe("detectSignature", () => {
  it("recognises major formats", () => {
    expect(detectSignature(ascii("%PDF-1.7"))).toBe("pdf");
    expect(detectSignature(ascii("PK\u0003\u0004xx"))).toBe("zip");
    expect(detectSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(detectSignature(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectSignature(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe("ole");
  });

  it("returns unknown for plain text", () => {
    expect(detectSignature(ascii("Estimado licenciado,"))).toBe("unknown");
  });
});

describe("validateUpload", () => {
  it("accepts a real pdf", () => {
    expect(validateUpload({ filename: "demanda.pdf", bytes: ascii("%PDF-1.4 ...") }).ok).toBe(true);
  });

  it("accepts docx/xlsx as zip containers", () => {
    expect(validateUpload({ filename: "contrato.docx", bytes: ascii("PK\u0003\u0004") }).ok).toBe(
      true,
    );
    expect(validateUpload({ filename: "estado.xlsx", bytes: ascii("PK\u0003\u0004") }).ok).toBe(
      true,
    );
  });

  it("accepts text-like documents with no signature", () => {
    for (const name of ["notas.txt", "datos.csv", "correo.eml", "meta.json"]) {
      expect(validateUpload({ filename: name, bytes: ascii("hola") }).ok).toBe(true);
    }
  });

  it("accepts unusual browser MIME strings", () => {
    expect(
      validateUpload({
        filename: "acta.pdf",
        bytes: ascii("%PDF-1.4"),
        declaredMime: "application/octet-stream",
      }).ok,
    ).toBe(true);
  });

  it("rejects an executable disguised as a pdf", () => {
    const result = validateUpload({ filename: "acta.pdf", bytes: ascii("PK\u0003\u0004evil") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature_mismatch");
  });

  it("allows unsupported extensions unless explicitly required", () => {
    expect(validateUpload({ filename: "x.weird", bytes: ascii("abc") }).ok).toBe(true);
    const strict = validateUpload({
      filename: "x.weird",
      bytes: ascii("abc"),
      requireSupportedExtension: true,
    });
    expect(strict.ok).toBe(false);
  });

  it("keeps every currently supported legal document type accepted", () => {
    for (const name of ["a.pdf", "a.docx", "a.doc", "a.xlsx", "a.zip", "a.png", "a.mp3", "a.mp4"]) {
      expect(isSupportedExtension(name)).toBe(true);
      expect(categoryOf(name)).not.toBeNull();
    }
  });
});

describe("security headers", () => {
  it("emits CSP in report-only mode and never enforced", () => {
    const headers = buildSecurityHeaders();
    expect(headers["Content-Security-Policy-Report-Only"]).toBeTruthy();
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("includes the low-risk header set and preserves microphone access", () => {
    const headers = buildSecurityHeaders();
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("frame-ancestors");
  });

  it("skips internal lovable routes and never overwrites existing headers", () => {
    const skipped = withSecurityHeaders(new Response("ok"), "/lovable/email/auth/webhook");
    expect(skipped.headers.get("X-Content-Type-Options")).toBeNull();

    const applied = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
      "/dashboard",
    );
    expect(applied.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(applied.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
