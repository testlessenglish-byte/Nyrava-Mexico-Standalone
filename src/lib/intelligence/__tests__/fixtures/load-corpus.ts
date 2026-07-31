// Evidence-depth corpus loader.
//
// Reads a folder under tests/fixtures/corpora/<practice_area>/ and creates
// a fresh case populated with those documents, exercising the same upload +
// extraction code path the UI uses. Returns the new case_id once extraction
// has settled.
//
// Used by the Acceptance Test (scripts/certify.ts) to swap the in-repo
// routing-benchmark fixtures (one-line .txt files whose only job is to
// exercise case-type routing) for substantive corpora suitable for
// evidence-depth, timeline, witness, contradictions, and scoring checks.
//
// Pure server-side. Imports the admin client lazily so this module stays
// out of any browser bundle that transitively grabs it via tests.

import { promises as fs } from "node:fs";
import path from "node:path";

import type { PracticeArea } from "@/lib/intelligence/practice-areas";

const CORPUS_ROOT = path.resolve(process.cwd(), "tests/fixtures/corpora");

export type LoadCorpusOptions = {
  practiceArea: PracticeArea;
  /** Optional override for the seeded user that owns the fixture case. */
  userId?: string;
  /** Override case name. Defaults to `[fixture:<area>] <timestamp>`. */
  name?: string;
  /** Wait up to this many ms for extraction to complete (default 60_000). */
  extractionTimeoutMs?: number;
};

export type LoadedCorpus = {
  caseId: string;
  practiceArea: PracticeArea;
  documentCount: number;
  extractedChars: number;
};

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function inferMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function readCorpusFiles(area: PracticeArea): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const dir = path.join(CORPUS_ROOT, area);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    throw new Error(
      `Corpus not found for practice area '${area}' at ${dir}. ` +
        `Author it under tests/fixtures/corpora/<area>/ — see tests/fixtures/corpora/README.md.`,
    );
  }
  const files = entries.filter(
    (f) => !f.startsWith(".") && !f.startsWith("_") && f.toLowerCase() !== "readme.md",
  );
  if (files.length === 0) {
    throw new Error(`Corpus directory '${dir}' is empty.`);
  }
  return Promise.all(
    files.sort().map(async (filename) => {
      const buf = await fs.readFile(path.join(dir, filename));
      return { name: filename, bytes: new Uint8Array(buf) };
    }),
  );
}

/**
 * Create a case for the given practice area, seeded with the matching
 * evidence-depth corpus. Uses the same `uploadFiles` server helper as the
 * UI, so extraction, hashing, and storage paths are exercised end-to-end.
 */
export async function loadCorpus(opts: LoadCorpusOptions): Promise<LoadedCorpus> {
  const area = opts.practiceArea;
  const uploads = await readCorpusFiles(area);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { uploadFiles } = await import("@/lib/pipeline.server");

  // Resolve owning user. In a test environment a dedicated fixture user is
  // expected — caller may pass it explicitly. We do NOT silently create one.
  const userId = opts.userId;
  if (!userId) {
    throw new Error(
      "loadCorpus requires opts.userId — pass the test fixture user's auth.uid(). " +
        "Do not run this against production without an explicit owner.",
    );
  }

  const name = opts.name ?? `[fixture:${area}] ${new Date().toISOString()}`;
  const { data: created, error } = await supabaseAdmin
    .from("cases")
    .insert({
      user_id: userId,
      name,
      description: `Evidence-depth fixture corpus for ${area}. See tests/fixtures/corpora/${area}/.`,
      status: "uploaded",
      progress: 0,
      analysis_mode: "strict",
      case_type: area,
    } as never)
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Failed to create fixture case: ${error?.message ?? "unknown error"}`);
  }
  const caseId = (created as { id: string }).id;

  await uploadFiles({ db: supabaseAdmin as never, caseId, userId, uploads });

  // Wait for extraction to settle.
  const timeout = opts.extractionTimeoutMs ?? 60_000;
  const started = Date.now();
  let lastChars = 0;
  let lastCount = 0;
  while (Date.now() - started < timeout) {
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("status, extracted_text")
      .eq("case_id", caseId);
    const rows = (docs ?? []) as Array<{ status: string | null; extracted_text: string | null }>;
    lastCount = rows.length;
    lastChars = rows.reduce((acc, r) => acc + (r.extracted_text?.length ?? 0), 0);
    const settled =
      rows.length === uploads.length &&
      rows.every((r) => r.status === "extracted" || r.status === "failed");
    if (settled) break;
    await new Promise((r) => setTimeout(r, 750));
  }

  return {
    caseId,
    practiceArea: area,
    documentCount: lastCount,
    extractedChars: lastChars,
  };
}

/** All practice areas that have an evidence-depth corpus on disk. */
export async function listAvailableCorpora(): Promise<PracticeArea[]> {
  const entries = await fs.readdir(CORPUS_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name as PracticeArea)
    .sort();
}
