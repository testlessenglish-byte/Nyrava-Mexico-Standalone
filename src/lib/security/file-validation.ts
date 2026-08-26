/**
 * Server-side upload validation (Phase 1 safe hardening).
 *
 * Design rule: this layer exists to reject *obviously* hostile or corrupted
 * uploads, never to second-guess a browser that supplied an unusual MIME
 * string for a legitimate legal document. Whenever the evidence is
 * ambiguous the file is ACCEPTED.
 *
 * Size/ZIP limits are NOT implemented here — the existing 50 MB per-file,
 * 200 MB total and ZIP-bomb protections in cases.functions.ts /
 * pipeline.server.ts remain the authority and are untouched.
 */

export type FileCategory =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "image"
  | "archive"
  | "audio"
  | "video"
  | "email";

/**
 * Inventory of every extension Nyrava currently accepts across the case
 * uploader, Talk-to-Case, Comprehensive Care and the knowledge center.
 * Derived from the existing `accept=` attributes and MIME_BY_EXT map — this
 * list is intentionally permissive so no legitimate legal document that
 * works today starts failing.
 */
export const SUPPORTED_EXTENSIONS: Record<string, FileCategory> = {
  pdf: "document",
  doc: "document",
  docx: "document",
  rtf: "document",
  odt: "document",
  pages: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  csv: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  txt: "text",
  md: "text",
  log: "text",
  json: "text",
  xml: "text",
  html: "text",
  htm: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  heif: "image",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  oga: "audio",
  aac: "audio",
  flac: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  eml: "email",
  msg: "email",
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(filename: string): FileCategory | null {
  return SUPPORTED_EXTENSIONS[extensionOf(filename)] ?? null;
}

export function isSupportedExtension(filename: string): boolean {
  return categoryOf(filename) !== null;
}

// ---------------------------------------------------------------------------
// Magic-byte detection
// ---------------------------------------------------------------------------

/** Coarse signature families — deliberately not a full MIME sniffer. */
export type SignatureFamily =
  | "pdf"
  | "zip" // also docx/xlsx/pptx/odt (OOXML/ODF are zip containers)
  | "rar"
  | "7z"
  | "ole" // legacy doc/xls/ppt/msg
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "tiff"
  | "bmp"
  | "heif"
  | "riff-wav"
  | "mp3"
  | "isobmff" // mp4/mov/m4a/m4v/heic
  | "ogg"
  | "flac"
  | "matroska" // webm
  | "unknown";

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

export function detectSignature(bytes: Uint8Array): SignatureFamily {
  if (bytes.length < 4) return "unknown";
  if (startsWith(bytes, ascii("%PDF"))) return "pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, ascii("GIF8"))) return "gif";
  if (startsWith(bytes, ascii("RIFF"))) {
    if (startsWith(bytes, ascii("WEBP"), 8)) return "webp";
    if (startsWith(bytes, ascii("WAVE"), 8)) return "riff-wav";
    return "unknown";
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return "tiff";
  if (startsWith(bytes, ascii("BM"))) return "bmp";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (startsWith(bytes, ascii("Rar!"))) return "rar";
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (startsWith(bytes, ascii("PK"))) return "zip";
  if (startsWith(bytes, ascii("OggS"))) return "ogg";
  if (startsWith(bytes, ascii("fLaC"))) return "flac";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "matroska";
  if (startsWith(bytes, ascii("ftyp"), 4)) {
    if (startsWith(bytes, ascii("heic"), 8) || startsWith(bytes, ascii("heif"), 8)) return "heif";
    return "isobmff";
  }
  if (startsWith(bytes, ascii("ID3")) || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
    return "mp3";
  return "unknown";
}

/**
 * Families a given extension may legitimately produce. An extension absent
 * from this map (plain text, csv, json, eml, …) is never signature-checked.
 */
const EXPECTED_FAMILIES: Record<string, SignatureFamily[]> = {
  pdf: ["pdf"],
  zip: ["zip"],
  rar: ["rar"],
  "7z": ["7z"],
  docx: ["zip"],
  xlsx: ["zip"],
  pptx: ["zip"],
  odt: ["zip"],
  ods: ["zip"],
  doc: ["ole", "zip"],
  xls: ["ole", "zip"],
  ppt: ["ole", "zip"],
  msg: ["ole"],
  png: ["png"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  gif: ["gif"],
  webp: ["webp"],
  bmp: ["bmp"],
  tif: ["tiff"],
  tiff: ["tiff"],
  heic: ["heif", "isobmff"],
  heif: ["heif", "isobmff"],
  wav: ["riff-wav"],
  mp3: ["mp3", "isobmff"],
  m4a: ["isobmff"],
  mp4: ["isobmff"],
  m4v: ["isobmff"],
  mov: ["isobmff"],
  webm: ["matroska"],
  ogg: ["ogg"],
  oga: ["ogg"],
  flac: ["flac"],
};

export type ValidationResult =
  | { ok: true; extension: string; category: FileCategory | null; signature: SignatureFamily }
  | {
      ok: false;
      extension: string;
      category: FileCategory | null;
      signature: SignatureFamily;
      reason: "unsupported_extension" | "signature_mismatch";
      message: string;
    };

/**
 * Validate a single upload. `declaredMime` is accepted for logging only —
 * browsers routinely report odd MIME strings for legitimate legal documents,
 * so a MIME disagreement alone never rejects a file.
 */
export function validateUpload(input: {
  filename: string;
  bytes: Uint8Array;
  declaredMime?: string | null;
  /** When false (default) unknown extensions are allowed through. */
  requireSupportedExtension?: boolean;
}): ValidationResult {
  const extension = extensionOf(input.filename);
  const category = SUPPORTED_EXTENSIONS[extension] ?? null;
  const signature = detectSignature(input.bytes);

  if (input.requireSupportedExtension && !category) {
    return {
      ok: false,
      extension,
      category,
      signature,
      reason: "unsupported_extension",
      message: `Unsupported file type ".${extension || "?"}"`,
    };
  }

  const expected = EXPECTED_FAMILIES[extension];
  // Only reject when the extension has a well-known signature AND the file
  // carries a *different recognised* signature. "unknown" always passes.
  if (expected && signature !== "unknown" && !expected.includes(signature)) {
    return {
      ok: false,
      extension,
      category,
      signature,
      reason: "signature_mismatch",
      message: `File contents do not match the ".${extension}" extension (detected: ${signature})`,
    };
  }

  return { ok: true, extension, category, signature };
}

/**
 * Structured, content-free log line for a rejected upload. Never includes
 * document contents — only the sanitized name, size and detection outcome.
 */
export function logRejectedUpload(entry: {
  filename: string;
  sizeBytes: number;
  declaredMime?: string | null;
  result: Extract<ValidationResult, { ok: false }>;
  caseId?: string;
  userId?: string;
}): void {
  console.warn(
    `[upload-rejected] ${JSON.stringify({
      filename: entry.filename,
      bytes: entry.sizeBytes,
      declared_mime: entry.declaredMime ?? null,
      extension: entry.result.extension,
      signature: entry.result.signature,
      reason: entry.result.reason,
      case_id: entry.caseId ?? null,
      user_id: entry.userId ?? null,
    })}`,
  );
}
