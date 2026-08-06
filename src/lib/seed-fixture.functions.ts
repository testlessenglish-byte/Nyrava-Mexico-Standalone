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
// The corpus loading/seeding mechanics live in seed-corpus.server.ts, shared
// with beta onboarding (two starter amparo matters per new account).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listFixtureCorpora = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { availableAreas, loadCorpusFromBundle, loadManifest } = await import(
      "@/lib/seed-corpus.server"
    );
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

    const { availableAreas, seedCorpusForUser } = await import("@/lib/seed-corpus.server");

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

    const res = await seedCorpusForUser({ userId, area: corpusArea });

    return {
      caseId: res.caseId,
      practiceArea: res.practiceArea,
      detectedCaseType: res.caseType,
      detectedLabel: res.label,
      detectionSource: res.detectionSource,
      detectionConfidence: res.detectionConfidence,
      detectedJurisdiction: res.jurisdiction,
      detectedFuero: res.fuero,
      courtCaseNumber: res.courtCaseNumber,
      courtName: res.courtName,
      analysisMode: "exploratory" as const,
      documentCount: res.documentCount,
      extractedChars: res.extractedChars,
    };
  });
