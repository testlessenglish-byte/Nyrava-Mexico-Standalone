// Shared corpus seeder.
//
// Bundled evidence corpora under tests/fixtures/corpora/<area>/ are the single
// source of seeded matters. Two consumers use this module:
//   1. the admin "seed fixture corpus" tool (seed-fixture.functions.ts)
//   2. beta onboarding, which drops two ready-to-run amparo matters into every
//      new account so a tester can run the pipeline without uploading anything.
//
// Files are embedded at build time (import.meta.glob ?raw) so this works in the
// serverless Worker runtime — no filesystem read at request time.

import { parseSeedManifest, type SeedMatterMetadata } from "@/lib/seed-metadata";

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

/** Corpora seeded into every new account. Both are full amparo expedientes. */
export const BETA_STARTER_CORPORA = [
  "beta_amparo_indirecto_fiscal",
  "beta_amparo_directo_laboral",
] as const;

/** Files that describe the corpus rather than being evidence in it. */
function isMetaFile(name: string): boolean {
  return (
    !name ||
    name.startsWith(".") ||
    name.startsWith("_") ||
    name.toLowerCase() === "readme.md"
  );
}

export function loadCorpusFromBundle(area: string): Array<{ name: string; bytes: Uint8Array }> {
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

export function loadManifest(area: string): SeedMatterMetadata | null {
  const raw = CORPUS_FILES[`/tests/fixtures/corpora/${area}/_manifest.json`];
  if (!raw) return null;
  try {
    return parseSeedManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function mimeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function availableAreas(): string[] {
  const areas = new Set<string>();
  for (const path of Object.keys(CORPUS_FILES)) {
    const m = path.match(/^\/tests\/fixtures\/corpora\/([^/]+)\//);
    if (m) areas.add(m[1]);
  }
  return Array.from(areas).sort();
}

export interface SeedCorpusResult {
  caseId: string;
  practiceArea: string;
  caseType: string;
  label: string;
  jurisdiction: string | null;
  fuero: string;
  courtCaseNumber: string | null;
  courtName: string | null;
  documentCount: number;
  detectionSource: string;
  detectionConfidence: number | string;
  extractedChars: number;
}

/**
 * Create one case for `userId` from the bundled corpus `area`, uploading every
 * document in it. Documents land as status='pending'; extraction runs when the
 * user presses Run Case.
 */
export async function seedCorpusForUser(opts: {
  userId: string;
  area: string;
  /** Extra fields merged into cases.matter_metadata (e.g. { seedKind }). */
  metadataExtra?: Record<string, unknown>;
}): Promise<SeedCorpusResult> {
  const { userId, area } = opts;

  const uploads = loadCorpusFromBundle(area).map((u) => ({ ...u, mimeType: mimeFor(u.name) }));
  if (uploads.length === 0) {
    throw new Error(`No bundled corpus found for '${area}'.`);
  }

  const manifest = loadManifest(area);

  const dec = new TextDecoder();
  const corpusText = uploads
    .map((u) => dec.decode(u.bytes))
    .join("\n\n")
    .slice(0, 120_000);

  const { resolveMxCaseType, MX_CASE_TYPE_LABELS } = await import("@/lib/mx-case-classifier");
  const detected = resolveMxCaseType({ text: corpusText, declaredArea: area });
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
  const label =
    MX_CASE_TYPE_LABELS[caseType as keyof typeof MX_CASE_TYPE_LABELS]?.es ?? caseType;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { uploadFiles } = await import("@/lib/pipeline.server");

  const name =
    manifest?.title ?? `[fixture:${label}] ${new Date().toISOString().slice(0, 19)}`;

  const provenance =
    `Datos ficticios de prueba (corpus tests/fixtures/corpora/${area}/). ` +
    `Materia: ${label}` +
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
      analysis_mode: "exploratory",
      case_type: caseType,
      jurisdiction,
      matter_metadata: {
        ...(manifest ?? {}),
        ...(opts.metadataExtra ?? {}),
        corpus: area,
        seededAt: new Date().toISOString(),
      },
    } as never)
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Failed to create seeded case: ${error?.message ?? "unknown"}`);
  }
  const caseId = (created as { id: string }).id;

  await uploadFiles({
    db: supabaseAdmin as never,
    caseId,
    userId,
    uploads: uploads.map(({ name, bytes }) => ({ name, bytes })),
  });

  const { data: docs } = await supabaseAdmin.from("documents").select("id").eq("case_id", caseId);

  return {
    caseId,
    practiceArea: area,
    caseType,
    label,
    jurisdiction,
    fuero: jurProfile.fuero,
    courtCaseNumber: manifest?.courtCaseNumber ?? null,
    courtName: manifest?.courtName ?? null,
    documentCount: (docs ?? []).length,
    detectionSource: manifest ? "manifest" : detected.source,
    detectionConfidence: detected.classification.confidence,
    extractedChars: uploads.reduce((acc, u) => acc + u.bytes.byteLength, 0),
  };
}

/**
 * Idempotently give `userId` the two starter amparo matters. Safe to call on
 * every sign-in / profile completion: it checks for an existing seeded case per
 * corpus first and never throws — a seeding hiccup must not block onboarding.
 */
export async function ensureStarterCasesForUser(userId: string): Promise<{
  created: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  for (const area of BETA_STARTER_CORPORA) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabaseAdmin as any)
        .from("cases")
        .select("id")
        .eq("user_id", userId)
        .filter("matter_metadata->>corpus", "eq", area)
        .limit(1);
      if (existing && existing.length > 0) {
        skipped.push(area);
        continue;
      }
      const res = await seedCorpusForUser({
        userId,
        area,
        metadataExtra: { seedKind: "beta_starter" },
      });
      created.push(res.caseId);
    } catch (e) {
      console.error("[starter-cases] failed to seed", area, e);
    }
  }

  return { created, skipped };
}
