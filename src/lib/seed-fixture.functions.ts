// Admin-only helper: seed a brand-new case from a substantive on-disk
// evidence corpus under tests/fixtures/corpora/<area>/. Used to verify the
// Witness / Opportunity / Trial Prep / Discovery pipelines against real
// named-individual content rather than the one-line routing benchmarks.
//
// Every corpus ships a `_manifest.json` (see src/lib/seed-metadata.ts) with
// complete, internally consistent Mexican court-file metadata — expediente
// number, juzgado, judge, parties, counsel, filing date, procedural stage,
// authorities. The seeder copies it into the case so an attorney opening a
// seeded matter never has to type a field.
//
// The corpora are bundled at build time via import.meta.glob (?raw) so this
// works in the serverless Worker runtime — no filesystem read at request time.
//
// Gated to admin role. Returns the new case_id so the UI can deep-link.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseSeedManifest, type SeedMatterMetadata } from "@/lib/seed-metadata";

// Eagerly bundle every text/csv/md file under tests/fixtures/corpora/*/ as raw strings.
// Keys look like "/tests/fixtures/corpora/penal/01_Carpeta_de_Investigacion.txt".
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

/** Files that describe the corpus rather than being evidence in it. */
function isMetaFile(name: string): boolean {
  return (
    !name ||
    name.startsWith(".") ||
    name.startsWith("_") ||
    name.toLowerCase() === "readme.md"
  );
}

function loadCorpusFromBundle(area: string): Array<{ name: string; bytes: Uint8Array }> {
  const prefix = `/tests/fixtures/corpora/${area}/`;
  const enc = new TextEncoder();
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const [path, content] of Object.entries(CORPUS_FILES)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (isMetaFile(name)) continue;
    files.push({ name, bytes: enc.encode(content) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function loadManifest(area: string): SeedMatterMetadata | null {
  const raw = CORPUS_FILES[`/tests/fixtures/corpora/${area}/_manifest.json`];
  if (!raw) return null;
  try {
    return parseSeedManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

function mimeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function availableAreas(): string[] {
  const areas = new Set<string>();
  for (const path of Object.keys(CORPUS_FILES)) {
    const m = path.match(/^\/tests\/fixtures\/corpora\/([^/]+)\//);
    if (m) areas.add(m[1]);
  }
  return Array.from(areas).sort();
}

export const listFixtureCorpora = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return availableAreas().map((area) => {
      const manifest = loadManifest(area);
      return {
        practiceArea: area,
        fileCount: loadCorpusFromBundle(area).length,
        title: manifest?.title ?? null,
        courtCaseNumber: manifest?.courtCaseNumber ?? null,
        jurisdiction: manifest?.jurisdiction ?? null,
        courtName: manifest?.courtName ?? null,
      };
    });
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
    // the operator never has to choose a materia — the manifest (or, absent
    // one, the classifier) supplies the materia and jurisdiction.
    const available = availableAreas();
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

    const manifest = loadManifest(corpusArea);

    // Classify the materia from the corpus content (Mexican vocabulary), so a
    // seeded case arrives with the same auto-detected case_type a real upload
    // would get. The manifest wins when present; classification is the fallback
    // and is still recorded for diagnostics.
    const dec = new TextDecoder();
    const corpusText = uploads
      .map((u) => dec.decode(u.bytes))
      .join("\n\n")
      .slice(0, 120_000);
    const { resolveMxCaseType, MX_CASE_TYPE_LABELS } = await import("@/lib/mx-case-classifier");
    const detected = resolveMxCaseType({ text: corpusText, declaredArea: corpusArea });
    // Jurisdiction is inferred from the corpus too (entidad federativa / fuero),
    // so the operator never types a state either.
    const { buildJurisdictionProfile } = await import("@/lib/intelligence/mx-jurisdiction");
    const jurProfile = buildJurisdictionProfile({
      caseType: manifest?.caseType ?? detected.caseType,
      jurisdictionField: manifest?.jurisdiction ?? null,
      corpusText,
    });
    const detectedJurisdiction =
      jurProfile.state?.name ?? (jurProfile.fuero === "federal" ? "Federal" : null);

    const caseType = manifest?.caseType ?? detected.caseType;
    const jurisdiction = manifest?.jurisdiction ?? detectedJurisdiction;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uploadFiles } = await import("@/lib/pipeline.server");

    const name =
      manifest?.title ??
      `[fixture:${MX_CASE_TYPE_LABELS[detected.caseType].es}] ${new Date().toISOString().slice(0, 19)}`;

    // A seeded matter must read like a real intake summary, not a debug label.
    // The manifest description is the case description; provenance is appended
    // as a short, clearly separated testing note.
    const provenance =
      `Datos ficticios de prueba (corpus tests/fixtures/corpora/${corpusArea}/). ` +
      `Materia: ${MX_CASE_TYPE_LABELS[caseType as keyof typeof MX_CASE_TYPE_LABELS]?.es ?? caseType}` +
      (manifest ? " (manifiesto)" : ` (detección automática, confianza ${detected.classification.confidence})`) +
      ` — fuero ${jurProfile.fuero}.`;
    const description = manifest
      ? `${manifest.description}\n\n— ${provenance}`
      : `Caso semilla con acervo probatorio real. ${provenance}`;

    const { data: created, error } = await supabaseAdmin
      .from("cases")
      .insert({
        user_id: userId,
        name,
        description,
        status: "uploaded",
        progress: 0,
        // Seeded benchmark matters run in exploratory mode so every engine
        // produces output instead of being gated by strict evidence thresholds.
        analysis_mode: "exploratory",
        case_type: caseType,
        jurisdiction,
        matter_metadata: manifest
          ? { ...manifest, corpus: corpusArea, seededAt: new Date().toISOString() }
          : null,
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
      detectedCaseType: caseType,
      detectedLabel:
        MX_CASE_TYPE_LABELS[caseType as keyof typeof MX_CASE_TYPE_LABELS]?.es ?? caseType,
      detectionSource: manifest ? "manifest" : detected.source,
      detectionConfidence: detected.classification.confidence,
      detectedJurisdiction: jurisdiction,
      detectedFuero: jurProfile.fuero,
      courtCaseNumber: manifest?.courtCaseNumber ?? null,
      courtName: manifest?.courtName ?? null,
      analysisMode: "exploratory" as const,
      documentCount: (docs ?? []).length,
      extractedChars: uploads.reduce((acc, u) => acc + u.bytes.byteLength, 0),
    };

  });
