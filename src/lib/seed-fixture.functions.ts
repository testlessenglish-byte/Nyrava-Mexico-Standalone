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
  .inputValidator((input: { practiceArea?: string | null } | undefined) => input ?? {})
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

    // Auto mode: no practiceArea supplied. Pick a bundled corpus ourselves so
    // the operator never has to choose a materia — the platform classifies the
    // seeded content afterwards and locks case_type from the evidence itself.
    const available = Array.from(
      new Set(
        Object.keys(CORPUS_FILES)
          .map((path) => path.match(/^\/tests\/fixtures\/corpora\/([^/]+)\//)?.[1])
          .filter((a): a is string => Boolean(a)),
      ),
    ).sort();
    const requestedArea = (data.practiceArea ?? "").trim();
    const corpusArea =
      requestedArea.length > 0
        ? requestedArea
        : (available[Math.floor(Math.random() * available.length)] ?? "");
    if (!corpusArea) throw new Error("No bundled fixture corpora available.");

    const uploads = loadCorpusFromBundle(corpusArea).map((u) => ({
      ...u,
      // pipeline.uploadFiles infers mime from filename; ensure caller-supplied
      // bytes get a sensible default content type when stored.
      mimeType: mimeFor(u.name),
    }));
    if (uploads.length === 0) {
      throw new Error(
        `No bundled corpus found for '${corpusArea}'. ` +
          `Author it under tests/fixtures/corpora/${corpusArea}/ and redeploy.`,
      );
    }

    // Classify the materia from the corpus content (Mexican vocabulary), so a
    // seeded case arrives with the same auto-detected case_type a real upload
    // would get. Folder label is only a fallback.
    const dec = new TextDecoder();
    const corpusText = uploads
      .map((u) => dec.decode(u.bytes))
      .join("\n\n")
      .slice(0, 120_000);
    const { resolveMxCaseType, MX_CASE_TYPE_LABELS } = await import("@/lib/mx-case-classifier");
    const detected = resolveMxCaseType({ text: corpusText, declaredArea: corpusArea });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uploadFiles } = await import("@/lib/pipeline.server");

    const name = `[fixture:${MX_CASE_TYPE_LABELS[detected.caseType].es}] ${new Date()
      .toISOString()
      .slice(0, 19)}`;
    const { data: created, error } = await supabaseAdmin
      .from("cases")
      .insert({
        user_id: userId,
        name,
        description:
          `Caso semilla con acervo probatorio real. Corpus: tests/fixtures/corpora/${corpusArea}/. ` +
          `Materia detectada automáticamente: ${MX_CASE_TYPE_LABELS[detected.caseType].es} ` +
          `(origen: ${detected.source}, confianza ${detected.classification.confidence}).`,
        status: "uploaded",
        progress: 0,
        analysis_mode: "strict",
        case_type: detected.caseType,
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
      practiceArea: corpusArea,
      detectedCaseType: detected.caseType,
      detectedLabel: MX_CASE_TYPE_LABELS[detected.caseType].es,
      detectionSource: detected.source,
      detectionConfidence: detected.classification.confidence,
      documentCount: (docs ?? []).length,
      extractedChars: uploads.reduce((acc, u) => acc + u.bytes.byteLength, 0),
    };
  });

