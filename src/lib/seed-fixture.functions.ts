// Admin-only helper: seed a brand-new case from a substantive on-disk
// evidence corpus under tests/fixtures/corpora/<area>/. Used to verify the
// Witness / Opportunity / Trial Prep / Discovery pipelines against real
// named-individual content rather than the one-line routing benchmarks.
//
// The corpora are bundled at build time via import.meta.glob (?raw) so this
// works in the serverless Worker runtime — no filesystem read at request time.
//
// Gated to admin role. Returns the new case_id so the UI can deep-link.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Eagerly bundle every text/csv/md file under tests/fixtures/corpora/*/ as raw strings.
// Keys look like "/tests/fixtures/corpora/general_civil/01_Complaint.txt".
const CORPUS_FILES = import.meta.glob(
  "/tests/fixtures/corpora/*/*.{txt,csv,md,json}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
};

function loadCorpusFromBundle(area: string): Array<{ name: string; bytes: Uint8Array }> {
  const prefix = `/tests/fixtures/corpora/${area}/`;
  const enc = new TextEncoder();
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const [path, content] of Object.entries(CORPUS_FILES)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (!name || name.startsWith(".") || name.toLowerCase() === "readme.md") continue;
    files.push({ name, bytes: enc.encode(content) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function mimeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export const listFixtureCorpora = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const areas = new Set<string>();
    for (const path of Object.keys(CORPUS_FILES)) {
      const m = path.match(/^\/tests\/fixtures\/corpora\/([^/]+)\//);
      if (m) areas.add(m[1]);
    }
    return Array.from(areas).sort().map((area) => ({
      practiceArea: area,
      fileCount: loadCorpusFromBundle(area).length,
    }));
  });

export const seedFixtureCorpus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { practiceArea: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      supabase: import("@supabase/supabase-js").SupabaseClient;
      userId: string;
    };
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) throw new Error("Forbidden — admin role required");

    const uploads = loadCorpusFromBundle(data.practiceArea).map((u) => ({
      ...u,
      // pipeline.uploadFiles infers mime from filename; ensure caller-supplied
      // bytes get a sensible default content type when stored.
      mimeType: mimeFor(u.name),
    }));
    if (uploads.length === 0) {
      throw new Error(
        `No bundled corpus found for '${data.practiceArea}'. ` +
          `Author it under tests/fixtures/corpora/${data.practiceArea}/ and redeploy.`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uploadFiles } = await import("@/lib/pipeline.server");

    const name = `[fixture:${data.practiceArea}] ${new Date().toISOString().slice(0, 19)}`;
    const { data: created, error } = await supabaseAdmin
      .from("cases")
      .insert({
        user_id: userId,
        name,
        description: `Substantive evidence-depth fixture for ${data.practiceArea}. Seeded from tests/fixtures/corpora/${data.practiceArea}/.`,
        status: "uploaded",
        progress: 0,
        analysis_mode: "strict",
        case_type: data.practiceArea,
      } as never)
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(`Failed to create fixture case: ${error?.message ?? "unknown"}`);
    }
    const caseId = (created as { id: string }).id;

    await uploadFiles({
      db: supabaseAdmin as never,
      caseId,
      userId,
      uploads: uploads.map(({ name, bytes }) => ({ name, bytes })),
    });

    // Documents are uploaded with status='pending'. Extraction runs as part
    // of the main pipeline (Run Case), which needs the user's Groq key, so
    // we don't run it here. Return the upload count immediately.
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("case_id", caseId);

    return {
      caseId,
      practiceArea: data.practiceArea,
      documentCount: (docs ?? []).length,
      extractedChars: uploads.reduce((acc, u) => acc + u.bytes.byteLength, 0),
    };
  });

