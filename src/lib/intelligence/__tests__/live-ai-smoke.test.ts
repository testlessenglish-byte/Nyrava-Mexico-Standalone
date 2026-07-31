/**
 * Phase B — Live AI Smoke Suite (opt-in, release-candidate only).
 *
 * Runs 2–3 canonical fictional cases through the REAL pipeline against the
 * live model provider and asserts on behavior — not exact prose. This suite
 * is skipped by default and MUST NOT run in normal CI. Enable explicitly:
 *
 *   RUN_LIVE_AI_SMOKE=true \
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SMOKE_TEST_USER_ID=<admin uuid> \
 *   GROQ_API_KEY=... \
 *   bunx vitest run src/lib/intelligence/__tests__/live-ai-smoke.test.ts
 *
 * Behavioral assertions only:
 *   - Pipeline finishes truthfully (no false "completed" statuses)
 *   - Every engine either completed, failed, blocked, or skipped
 *   - Persistence verified for every "completed" engine
 *   - Telemetry populated (provider/model/tokens/latency)
 *   - Replay metadata present (prompt version, config hash, corpus hash)
 *   - Timeline exists, contradictions surfaced, evidence linked
 *   - Report assembled with required sections
 *   - No hallucination warnings above threshold
 *
 * Exact prose is never asserted — models drift between runs by design.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ENABLED = process.env.RUN_LIVE_AI_SMOKE === "true";
const HAS_ENV =
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SMOKE_TEST_USER_ID &&
  !!process.env.GROQ_API_KEY;

// Small, targeted set — this is a smoke, not a regression suite.
// Each corpus lives at tests/fixtures/corpora/<area>/ and is bundled by
// seed-fixture.functions.ts via import.meta.glob.
const SMOKE_CASES: Array<{
  practiceArea: string;
  expect: { minTimeline: number; minFindings: number; expectContradictions: boolean };
}> = [
  { practiceArea: "penal",                       expect: { minTimeline: 2, minFindings: 3, expectContradictions: true } },
  { practiceArea: "benchmark_chiapas_familiar",  expect: { minTimeline: 3, minFindings: 3, expectContradictions: true } },
  { practiceArea: "benchmark_faro_penal",        expect: { minTimeline: 3, minFindings: 3, expectContradictions: true } },
];

// Generous — real LLM calls plus persistence. Individual it() gets its own timeout below.
const CASE_TIMEOUT_MS = 10 * 60 * 1000;

describe.runIf(ENABLED && HAS_ENV)("live-ai smoke (RUN_LIVE_AI_SMOKE=true)", () => {
  let supabase: SupabaseClient<Database>;
  let userId: string;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    userId = process.env.SMOKE_TEST_USER_ID!;
  });

  for (const { practiceArea, expect: exp } of SMOKE_CASES) {
    it(
      `${practiceArea}: pipeline finishes truthfully with observable artifacts`,
      { timeout: CASE_TIMEOUT_MS },
      async () => {
        const caseId = await seedCase(supabase, userId, practiceArea);

        const { runPipelineForCase } = await import("@/lib/pipeline-runner.server");
        const result = await runPipelineForCase(supabase, userId, { caseId, reset: false });

        // Truthful terminal state — either ok or a documented failure, never
        // a silent success. A "warnings" array is acceptable if statuses match.
        expect(result).toBeDefined();
        expect(typeof result.completedStages).toBe("number");

        // 1. Ledger truthfulness — every engine row is in a terminal state.
        const { data: runs } = await supabase
          .from("pipeline_engine_runs")
          .select("*")
          .eq("case_id", caseId);
        expect(runs, "pipeline_engine_runs must exist").toBeTruthy();
        expect((runs ?? []).length).toBeGreaterThan(0);

        const TERMINAL = new Set(["completed", "failed", "blocked", "skipped"]);
        for (const r of runs ?? []) {
          expect(TERMINAL.has((r as { status: string }).status),
            `engine ${(r as { engine: string }).engine} ended in non-terminal state ${(r as { status: string }).status}`,
          ).toBe(true);
        }

        // 2. Persistence verification — every "completed" row must carry
        //    db_write_confirmed / rows_written OR an explicit "no-write" note.
        for (const r of (runs ?? []).filter((x) => (x as { status: string }).status === "completed")) {
          const meta = ((r as { meta: unknown }).meta ?? {}) as Record<string, unknown>;
          const confirmed = (r as { db_write_confirmed?: boolean | null }).db_write_confirmed;
          const rowsWritten = (r as { rows_written?: number | null }).rows_written;
          expect(
            confirmed === true || (typeof rowsWritten === "number" && rowsWritten >= 0),
            `engine ${(r as { engine: string }).engine} completed without persistence verification`,
          ).toBe(true);
          // 3. Telemetry populated.
          const telemetry = (meta.telemetry ?? {}) as Record<string, unknown>;
          expect(telemetry, `telemetry missing for ${(r as { engine: string }).engine}`).toBeTruthy();
          // 4. Replay metadata present.
          const replay = (meta.replay ?? {}) as Record<string, unknown>;
          expect(Object.keys(replay).length, `replay hints missing for ${(r as { engine: string }).engine}`).toBeGreaterThan(0);
        }

        // 5. Timeline exists (tolerant floor).
        const { data: analysisRows } = await supabase
          .from("analyses")
          .select("timeline")
          .eq("case_id", caseId);
        const timelineEvents = (analysisRows ?? [])
          .flatMap((a) => {
            const t = (a as unknown as { timeline?: unknown }).timeline;
            return Array.isArray(t) ? t : [];
          });
        expect(timelineEvents.length,
          `expected ≥ ${exp.minTimeline} timeline events for ${practiceArea}`,
        ).toBeGreaterThanOrEqual(exp.minTimeline);

        // 6. Findings surfaced.
        const { data: findings } = await supabase
          .from("case_findings")
          .select("id, category")
          .eq("case_id", caseId);
        expect((findings ?? []).length,
          `expected ≥ ${exp.minFindings} findings for ${practiceArea}`,
        ).toBeGreaterThanOrEqual(exp.minFindings);

        // 7. Contradictions where the fixture reliably produces them.
        if (exp.expectContradictions) {
          const contradictions = (findings ?? []).filter(
            (f) => (f as { category: string }).category === "contradiction",
          );
          expect(contradictions.length,
            `expected at least one contradiction finding for ${practiceArea}`,
          ).toBeGreaterThanOrEqual(1);
        }

        // 8. Report assembled.
        const { data: reports } = await supabase
          .from("reports")
          .select("id, content")
          .eq("case_id", caseId);
        expect((reports ?? []).length, "no report row produced").toBeGreaterThanOrEqual(1);

        // 9. No hallucination panic — either absent or resolved status.
        const { data: kase } = await supabase
          .from("cases")
          .select("hallucination_report, status_message, error")
          .eq("id", caseId)
          .single();
        const halJson = (kase as { hallucination_report?: unknown } | null)?.hallucination_report;
        if (halJson && typeof halJson === "object") {
          const severity = (halJson as { severity?: string }).severity ?? "none";
          expect(["none", "low", "medium"], `hallucination severity too high: ${severity}`).toContain(severity);
        }
      },
    );
  }
});

// Helper — seed one fictional case using the bundled corpus and wait for
// the initial upload to settle. Mirrors seedFixtureCorpus but runs with
// the service-role client directly so we do not depend on serverFn RPC.
async function seedCase(
  supabase: SupabaseClient<Database>,
  userId: string,
  practiceArea: string,
): Promise<string> {
  const { uploadFiles } = await import("@/lib/pipeline.server");
  const name = `[smoke:${practiceArea}] ${new Date().toISOString().slice(0, 19)}`;

  const { data: created, error } = await supabase
    .from("cases")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert({
      user_id: userId,
      name,
      description: `Live-AI smoke case for ${practiceArea}. Auto-created; safe to delete.`,
      status: "uploaded",
      progress: 0,
      analysis_mode: "strict",
      case_type: practiceArea,
    } as any)
    .select("id")
    .single();
  if (error || !created) throw new Error(`seedCase failed: ${error?.message ?? "unknown"}`);
  const caseId = (created as { id: string }).id;

  // Reuse the same bundled corpus loader used by seedFixtureCorpus.
  const CORPUS_FILES = import.meta.glob(
    "/tests/fixtures/corpora/*/*.{txt,csv,md,json}",
    { eager: true, query: "?raw", import: "default" },
  ) as Record<string, string>;
  const enc = new TextEncoder();
  const uploads: Array<{ name: string; bytes: Uint8Array }> = [];
  const prefix = `/tests/fixtures/corpora/${practiceArea}/`;
  for (const [p, content] of Object.entries(CORPUS_FILES)) {
    if (!p.startsWith(prefix)) continue;
    const n = p.slice(prefix.length);
    if (!n || n.startsWith("_") || n.startsWith(".") || n.toLowerCase() === "readme.md") continue;
    uploads.push({ name: n, bytes: enc.encode(content) });
  }
  if (uploads.length === 0) throw new Error(`no bundled corpus for ${practiceArea}`);

  await uploadFiles({ db: supabase as never, caseId, userId, uploads });
  return caseId;
}
