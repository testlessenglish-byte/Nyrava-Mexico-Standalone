// Server-only extraction of the full-pipeline runner so it can be invoked
// both from an authenticated server function (user click) and from the
// background worker route (cron / queue drain) with an admin client.
import { CASE_RESET_FIELDS, clearCaseDerivedData } from "./pipeline-reset";
import { unzipSync } from "fflate";
import { classifyMexicanCaseType } from "@/lib/mx-case-classifier";
import { normalizeMexicanCaseType } from "@/lib/jurisdiction/mexico";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { PIPELINE_STAGES, runTimelineAudit, type PipelineStageKey } from "./cases.functions";
import { callGroq, parseJsonLoose, type GroqContent } from "./groq.server";
import { mexicoLock, getReportLocale } from "@/lib/mexico-lock";
import { sha256Hex } from "./hash.server";
import {
  addFindings,
  addGatedFindings,
  clearFindingsByModule,
  normalizeLlmFindings,
  listFindings,
} from "./intelligence/findings.server";
import { extractPdf, extractDocx, extractXlsx, extractCsv, extractPlainText } from "./intelligence/extract.server";
import { computeDeterministicScorecard } from "./intelligence/scoring.server";
import { computeCoverage } from "./intelligence/coverage.server";
import { runEngine, clearEngineRuns, buildEnginesSummary } from "./intelligence/engine-audit.server";
import { classifyContradiction, stripUnsupportedAmplification } from "./intelligence/dispute-classifier.server";
import { isGroqCooldownOrRateLimit, rethrowIfCheckpoint } from "./pipeline-checkpoint.server";
import { buildCaseTypeStandardsBlock } from "./intelligence/case-type-standards";
import { scoreReportQuality } from "./intelligence/report-quality-gate";
import {
  buildCanonicalReportContext,
  serializeCanonicalContextForPrompt,
} from "./intelligence/report-canonical-context";
import { mergeCanonicalRecommendations } from "./intelligence/report-recommendations";
import { withStageTimeout } from "@/lib/execution/blocking-stage-guard.server";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

type Db = SupabaseClient<Database>;

const MODEL = "openai/gpt-oss-120b";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|log|json|xml|html?)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.docx?$/i;
const XLSX_EXT = /\.(xlsx|xls)$/i;
const CSV_EXT = /\.csv$/i;
type J = import("@/integrations/supabase/types").Json;

const RUNNER_LEASE_EXTENSION_MS = 20 * 60 * 1000;

export type RunPipelineOpts = {
  caseId: string;
  startFrom?: string;
  reset?: boolean;
};

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

function inferMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// Benchmark/test corpora (like the fixture packs used for internal QA and
// gold-standard evals) sometimes bundle a solution sheet alongside the real
// case documents — e.g. "00_ANSWER_KEY_Ground_Truth.txt" — so a human grader
// can check output against a known-correct answer set. That file must never
// enter the evidentiary corpus: every downstream engine (shared brief,
// extraction, findings, citations, case law) treats every ingested document
// as case evidence with no distinction, so an answer key present at ingestion
// gets read, quoted, and cited exactly like a real exhibit — silently
// contaminating every score and finding it touches, and making it impossible
// to tell how much of a report reflects genuine detection vs. an LLM finding
// the solution sheet. This is a pattern match on filename only (cheap, no
// content read), applied once, at the single choke point (uploadFiles) that
// every ingestion path — direct upload and zip-expansion alike — passes
// through.
const NON_EVIDENTIARY_FILENAME = /^(00[_-]?)?answer[_-]?key|ground[_-]?truth|solution[_-]?(key|sheet)|^read[_-]?me\b/i;

/**
 * True if a filename matches a known non-evidentiary pattern (answer keys,
 * ground-truth solution sheets) that should never be ingested as case
 * evidence, regardless of upload path (direct upload or expanded from a zip).
 */
export function isNonEvidentiaryFilename(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return NON_EVIDENTIARY_FILENAME.test(base);
}

const ZIP_EXT = /\.zip$/i;
const MAX_ZIP_COMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB compressed input
const MAX_ZIP_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB total uncompressed

/**
 * Expand any .zip entries in the raw upload list into their individual
 * contained files (flattened to basename — folder structure inside the zip
 * is not preserved as a path, only used to disambiguate duplicate names is
 * lost, which is fine since files are deduped by content hash downstream).
 * Non-zip files pass through unchanged. Guards against decompression bombs
 * with both a compressed-input cap and a running uncompressed-size cap.
 */
function expandZipsAndFiles(
  files: Array<{ name: string; bytes: Uint8Array }>,
): Array<{ name: string; bytes: Uint8Array }> {
  const out: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const f of files) {
    if (!ZIP_EXT.test(f.name)) {
      out.push(f);
      continue;
    }
    if (f.bytes.length > MAX_ZIP_COMPRESSED_BYTES) {
      console.error("zip rejected: compressed size exceeds limit", f.name, f.bytes.length);
      continue;
    }
    try {
      const unzipped = unzipSync(f.bytes);
      const archiveEntries: Array<{ name: string; bytes: Uint8Array }> = [];
      let totalBytes = 0;
      let bomb = false;
      for (const [path, data] of Object.entries(unzipped)) {
        if (!data || data.length === 0 || path.endsWith("/")) continue;
        totalBytes += data.length;
        if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          console.error("zip rejected: uncompressed size exceeds limit", f.name);
          bomb = true;
          break;
        }
        const base = path.split("/").pop() ?? path;
        if (base.startsWith(".") || base.startsWith("__MACOSX")) continue;
        archiveEntries.push({ name: base, bytes: data });
      }
      if (!bomb) out.push(...archiveEntries);
    } catch (e) {
      console.error("zip unpack failed", f.name, e);
    }
  }
  return out;
}

/**
 * Store raw uploaded files in the "case-files" storage bucket and register
 * one `documents` row per file. Any .zip in the upload list is expanded into
 * its contained files first (recursively unsupported — nested zips are
 * stored as-is), so a single zip upload becomes N individual documents
 * rather than one opaque application/zip document. Files are content-hashed
 * (sha256) so exact duplicates already attached to the case are skipped
 * rather than re-uploaded. Documents are inserted with status="pending" —
 * extraction is a separate, later pipeline stage.
 */
export async function uploadFiles(opts: {
  db: Db;
  caseId: string;
  userId: string;
  uploads: Array<{ name: string; bytes: Uint8Array }>;
}): Promise<{ uploaded: number; skipped: number; excludedNonEvidentiary: string[] }> {
  const { db, caseId, userId, uploads: rawUploads } = opts;
  const { sha256Hex } = await import("./hash.server");
  const uploads = expandZipsAndFiles(rawUploads);

  let uploaded = 0;
  let skipped = 0;
  const excludedNonEvidentiary: string[] = [];

  for (const file of uploads) {
    // Never ingest answer keys / ground-truth solution sheets as evidence —
    // see isNonEvidentiaryFilename for why this must happen before storage
    // upload or the documents insert, not as a later filter.
    if (isNonEvidentiaryFilename(file.name)) {
      excludedNonEvidentiary.push(file.name);
      continue;
    }

    const contentHash = await sha256Hex(file.bytes);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (db as any)
      .from("documents")
      .select("id")
      .eq("case_id", caseId)
      .eq("content_hash", contentHash)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const mimeType = inferMimeType(file.name);
    // RLS policy "case files own write" on storage.objects requires the
    // first path segment to equal auth.uid() — see
    // supabase/migrations/20260620074128_..._8045ed19.sql. caseId must NOT
    // be the first segment or every insert is rejected with 42501.
    const storagePath = `${userId}/${caseId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await db.storage.from("case-files").upload(storagePath, file.bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadError) {
      throw new Error(`Failed to upload "${file.name}": ${uploadError.message}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (db as any).from("documents").insert({
      case_id: caseId,
      user_id: userId,
      filename: file.name,
      content_hash: contentHash,
      mime_type: mimeType,
      size_bytes: file.bytes.byteLength,
      storage_path: storagePath,
      status: "pending",
    });
    if (insertError) {
      await db.storage.from("case-files").remove([storagePath]);
      throw new Error(`Failed to record "${file.name}": ${insertError.message}`);
    }

    uploaded += 1;
  }

  return { uploaded, skipped, excludedNonEvidentiary };
}

export async function runPipelineForCase(
  supabase: Db,
  userId: string,
  opts: RunPipelineOpts,
): Promise<{
  ok: boolean;
  cancelled?: boolean;
  completedStages: number;
  warnings?: Array<{ key: string; error: string }>;
  failedAt?: string;
}> {
  const runner = await import("@/lib/pipeline-runner.server");
  return runner.runPipelineForCase(supabase, userId, opts);
}

async function _runPipelineForCase(
  supabase: Db,
  userId: string,
  opts: RunPipelineOpts,
): Promise<{
  ok: boolean;
  cancelled?: boolean;
  completedStages: number;
  warnings?: Array<{ key: string; error: string }>;
  failedAt?: string;
}> {
  const { caseId, startFrom, reset } = opts;

  // Structured instrumentation — every stage transition and case-status write
  // logs a single JSON line so the full automatic execution path can be
  // reconstructed from worker logs. correlationId ties every line together.
  const correlationId = `run-${caseId}-${Date.now().toString(36)}`;
  const runStart = Date.now();
  const trace = (event: string, extra: Record<string, unknown> = {}) => {
    const payload = {
      t: new Date().toISOString(),
      corr: correlationId,
      caseId,
      userId,
      event,
      elapsed_ms: Date.now() - runStart,
      ...extra,
    };
    console.info(`[pipeline] ${JSON.stringify(payload)}`);
  };

  const updateCase = async (patch: Record<string, unknown>, source: string) => {
    const withHeartbeat: Record<string, unknown> = { ...patch };
    const statusValue = typeof patch.status === "string" ? patch.status : null;
    const terminalStatuses = new Set(["complete", "released", "needs_revision", "failed", "cancelled"]);
    const shouldExtendLease = statusValue === "intelligence_running" && !terminalStatuses.has(statusValue);
    if (shouldExtendLease) {
      withHeartbeat.worker_lease_until = new Date(Date.now() + RUNNER_LEASE_EXTENSION_MS).toISOString();
    } else if (statusValue && terminalStatuses.has(statusValue)) {
      withHeartbeat.worker_lease_until = null;
    }
    const includesStatus = Object.prototype.hasOwnProperty.call(patch, "status");
    let before: Record<string, unknown> | null = null;
    if (includesStatus) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("cases")
        .select("status,status_message,next_stage,queued_at,worker_lease_until")
        .eq("id", caseId)
        .maybeSingle();
      before = (data ?? null) as Record<string, unknown> | null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("cases")
      .update(withHeartbeat as any)
      .eq("id", caseId);
    if (error) throw new Error(`case update failed at ${source}: ${error.message}`);
    if (includesStatus) {
      trace("case.status.write", {
        source,
        previous_status: before?.status ?? null,
        new_status: patch.status ?? null,
        previous_next_stage: before?.next_stage ?? null,
        new_next_stage: withHeartbeat.next_stage ?? before?.next_stage ?? null,
        previous_lease_until: before?.worker_lease_until ?? null,
        new_lease_until: withHeartbeat.worker_lease_until,
      });
    }
  };

  if (reset) {
    await clearCaseDerivedData(supabase, caseId);
    await updateCase({ ...CASE_RESET_FIELDS }, "pipeline.reset");
  } else {
    await supabase
      .from("cases")
      .update({ cancel_requested: false } as any)
      .eq("id", caseId);
  }

  // Groq temporarily removed from the loop: the platform Groq key is dead
  // and we don't want every batch to waste a guaranteed-401 attempt on it
  // before falling through. apiKey/apiKeys are left empty here — the router
  // still resolves this user's full active key set (currently Gemini) via
  // the userId passed in baseArgs below, so nothing else needs to change.
  // To bring Groq back later: restore the resolveProviderKeys(...,"groq")
  // call that used to populate apiKey/apiKeys here.
  const apiKey = "";
  const keys: string[] = [];
  const baseArgs = { db: supabase, caseId, userId, apiKey, apiKeys: keys };

  const pipe = await import("@/lib/pipeline.server");
  const eng = await import("@/lib/intelligence/engines.server");
  const lit = await import("@/lib/intelligence/litigation.server");
  const hal = await import("@/lib/intelligence/hallucination.server");
  const prog = await import("@/lib/intelligence/progress.server");
  const persist = await import("@/lib/intelligence/engine-persistence.server");
  const audit = await import("@/lib/intelligence/engine-audit.server");

  // Bug 2 (fix A): witness / discovery / evidence_intel are wired to the
  // REAL LLM engines (runWitnessEngine / runDiscoveryGapEngine /
  // runEvidenceIntelEngine). The prior `derive*` stubs counted findings
  // categories that no upstream stage actually produced, so every dashboard
  // count returned 0. The real engines already batch, gate, and cite; they
  // just were never wired into this runner map.
  //
  // Phase 3 (reliability freeze): every audit.runEngine call for an engine
  // that writes to the database is routed through persist.runCatalogedEngine,
  // which re-queries the target table(s) after the engine returns. A silent
  // insert failure → verification failure → engine marked `failed` →
  // downstream dependents marked `blocked` by the loop below. No engine may
  // report `completed` unless its persistence has been confirmed.
  const runners: Record<
    PipelineStageKey,
    {
      run: () => Promise<unknown>;
      stage?: import("@/lib/intelligence/progress.server").StageKey;
      engine?: string;
    }
  > = {
    extraction: { run: () => pipe.runExtraction(baseArgs), stage: "extraction" },
    agents: { run: () => pipe.runAgents(baseArgs), stage: "agents" },
    analyzers: { run: () => pipe.runAnalyzers(baseArgs), stage: "analyzers" },
    scoring: { run: () => pipe.runScoring(baseArgs), stage: "scoring", engine: "scoring" },
    jurisdiction_intel: {
      run: () =>
        withStageTimeout(
          "jurisdiction_intel",
          () =>
            persist.runCatalogedEngine(supabase, { caseId, userId, engine: "jurisdiction_intel" }, async () => {
              const { runJurisdictionIntelligence } = await import("@/lib/intelligence/jurisdiction-intel.server");
              const value = await runJurisdictionIntelligence({ db: supabase, caseId });
              return {
                value,
                stats: { generated: 1, accepted: 1, rows_written: 1, db_write_confirmed: true },
              };
            }),
          { caseId, userId },
        ),
    },

    procedural_compliance: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "procedural_compliance" }, async () => {
          const { runProceduralCompliance } = await import("@/lib/intelligence/procedural-compliance.server");
          const value = await runProceduralCompliance({ db: supabase, caseId, userId });
          return {
            value,
            stats: {
              generated: value.evaluated,
              accepted: value.satisfied,
              rows_written: value.findings_written,
              db_write_confirmed: true,
            },
          };
        }),
    },
    legal_qa: {
      run: () =>
        withStageTimeout(
          "legal_qa",
          () =>
            persist.runCatalogedEngine(supabase, { caseId, userId, engine: "legal_qa" }, async () => {
              const { runLegalQaGate } = await import("@/lib/intelligence/legal-qa.server");
              const value = await runLegalQaGate({ db: supabase, caseId, userId });
              return {
                value,
                stats: {
                  generated: value.checked_fields,
                  accepted: value.checked_fields - value.warnings.length,
                  rows_written: value.remediated_fields,
                  db_write_confirmed: true,
                },
              };
            }),
          { caseId, userId },
        ),
    },

    report: { run: () => pipe.runReport(baseArgs), stage: "report", engine: "report_generator" },
    timeline: { run: () => runTimelineAudit({ supabase, userId, caseId }) },
    evidence_map: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "evidence_map" }, async () => {
          const m = await import("@/lib/intelligence/evidence-map.server");
          const em = await m.buildEvidenceMap(supabase, caseId);
          return {
            value: em,
            stats: {
              generated: em.totals.total,
              accepted: em.totals.total - em.totals.missing_evidence,
            },
          };
        }),
    },
    contradictions: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "contradictions" }, async () => {
          const d = await import("@/lib/intelligence/derived-engines.server");
          const result = await d.deriveContradictions(supabase, caseId);
          await updateCase({ contradiction_at: new Date().toISOString() }, "pipeline.contradictions");
          return result;
        }),
      stage: "contradictions",
    },
    // Task-9/10 stat plumbing: engines whose output is a mix of LLM + deterministic
    // templates now return real generated/accepted/rejected counts. Row counts come
    // from the target case_* tables (source of truth), audit numbers come from the
    // engine's own return value where available. Meta.source labels the pipeline
    // ("llm" | "template" | "hybrid") so the UI stops showing 0/0/0 for engines
    // that produced legitimate deterministic output.
    witness: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "witness_intelligence" }, async () => {
          const value = (await eng.runWitnessEngine(baseArgs)) as {
            witnesses?: unknown[];
            audit?: { input?: number; accepted?: number };
          };
          const { count } = await supabase
            .from("case_witnesses")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const rows = count ?? value.witnesses?.length ?? 0;
          const gen = Math.max(value.audit?.input ?? 0, rows);
          const acc = Math.max(value.audit?.accepted ?? 0, rows);
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: Math.max(0, gen - acc),
              rows_written: rows,
              meta: { source: "hybrid" },
            },
          };
        }),
      stage: "witness_intel",
    },
    evidence_intel: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "evidence_intelligence" }, async () => {
          const value = (await lit.runEvidenceIntelEngine(baseArgs)) as {
            classifications?: number;
            promoted_findings?: number;
            promotion_gate?: unknown;
            promotion_mode?: unknown;
            promotion_corpus?: unknown;
          };
          const gen = value.classifications ?? 0;
          const acc = value.promoted_findings ?? gen;
          await updateCase({ evidence_intel_at: new Date().toISOString() }, "pipeline.evidence_intel");
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: Math.max(0, gen - acc),
              rows_written: gen,
              meta: {
                source: "hybrid",
                evidence_gate: {
                  mode: value.promotion_mode,
                  audit: value.promotion_gate,
                  corpus: value.promotion_corpus,
                },
              },
            },
          };
        }),
      stage: "evidence_intel",
    },
    constitutional: {
      // PRACTICE-AREA GATE: this stage previously ran unconditionally for
      // every case type, which is what produced the release-gate
      // "silent_activation:constitutional_compliance" failure — the engine
      // ran to completion (with a stub value) even when the manifest listed
      // it under skipped_engines. Mirrors the same gate already used in
      // runAgents() and ensureRequiredEngines() above.
      run: async () => {
        const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE } = await import("./intelligence/practice-areas");
        const { getActiveDomains } = await import("./intelligence/cross-domain.server");
        const { recordSkipped } = await import("./intelligence/engine-audit.server");

        const { data: caseRow } = await supabase
          .from("cases")
          .select("case_type" as any)
          .eq("id", caseId)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const area = String((caseRow as any)?.case_type ?? "general_civil");
        const activeDomains = await getActiveDomains(supabase, caseId);

        if (!isAnalyzerAllowed(area, "constitutional_compliance", activeDomains)) {
          await recordSkipped(supabase, {
            caseId,
            userId,
            engine: "constitutional_compliance" as never,
            reason: SKIP_REASON_NOT_APPLICABLE,
          });
          return { skipped: true, reason: SKIP_REASON_NOT_APPLICABLE };
        }

        return persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: "constitutional_compliance" },
          async () => ({
            value: { derived_from: "analyzers+agents" },
          }),
        );
      },
    },
    discovery: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "discovery_gaps" }, async () => {
          const value = (await eng.runDiscoveryGapEngine(baseArgs)) as {
            findings_gate?: unknown;
            findings_gate_mode?: unknown;
            findings_gate_corpus?: unknown;
          };
          const { count } = await supabase
            .from("case_findings")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId)
            .like("source_module", "engine:discovery%");
          const n = count ?? 0;
          await updateCase({ discovery_at: new Date().toISOString() }, "pipeline.discovery");
          return {
            value,
            stats: {
              generated: n,
              accepted: n,
              rows_written: n,
              meta: {
                source: "engine",
                evidence_gate: {
                  mode: value.findings_gate_mode,
                  audit: value.findings_gate,
                  corpus: value.findings_gate_corpus,
                },
              },
            },
          };
        }),
      stage: "discovery_gaps",
    },
    perspectives: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "perspectives" }, async () => {
          const value = await lit.runPerspectivesEngine(baseArgs);
          const { count } = await supabase
            .from("case_perspectives")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? 0;
          return {
            value,
            stats: { generated: n, accepted: n, rows_written: n, meta: { source: "engine" } },
          };
        }),
    },
    theories: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "theory" }, async () => {
          const value = (await eng.runTheoryEngine(baseArgs)) as {
            theories?: unknown[];
            audit?: { rejected?: number };
          };
          const { count } = await supabase
            .from("case_theories")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const acc = count ?? value.theories?.length ?? 0;
          const gen = acc + (value.audit?.rejected ?? 0);
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: Math.max(0, gen - acc),
              rows_written: acc,
              meta: { source: "engine" },
            },
          };
        }),
      stage: "theories",
    },
    opportunities: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "opportunity" }, async () => {
          const value = (await eng.runOpportunityEngine(baseArgs)) as {
            opportunities?: unknown[];
            potential_opportunities?: unknown[];
            audit?: { input?: number; rejected?: number; rejections?: unknown[] };
          };
          const { count } = await supabase
            .from("case_opportunities")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const verified = value.opportunities?.length ?? 0;
          const potential = value.potential_opportunities?.length ?? 0;
          const rows = count ?? verified + potential;
          const gen = Math.max(value.audit?.input ?? 0, verified + potential, rows);
          const rejected = Math.max(value.audit?.rejected ?? potential, gen - verified);
          return {
            value,
            stats: {
              generated: gen,
              accepted: verified,
              rejected,
              rows_written: rows,
              meta: {
                source: "engine",
                verified_opportunities: verified,
                potential_requires_review: potential,
                gate_rejections: value.audit?.rejections ?? [],
              },
            },
          };
        }),
    },
    trial_prep: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "trial_prep" }, async () => {
          const value = (await eng.runTrialPrepEngine(baseArgs)) as {
            findings_gate?: unknown;
            findings_gate_mode?: unknown;
            findings_gate_corpus?: unknown;
          };
          const { count } = await supabase
            .from("case_trial_prep")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? (value ? 1 : 0);
          return {
            value,
            stats: {
              generated: n,
              accepted: n,
              rows_written: n,
              meta: {
                source: "engine",
                evidence_gate: {
                  mode: value.findings_gate_mode,
                  audit: value.findings_gate,
                  corpus: value.findings_gate_corpus,
                },
              },
            },
          };
        }),
    },
    strategy: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "strategy" }, async () => {
          const value = await lit.runStrategyEngine(baseArgs);
          const { count } = await supabase
            .from("case_strategy")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? 0;
          return {
            value,
            stats: { generated: n, accepted: n, rows_written: n, meta: { source: "engine" } },
          };
        }),
      stage: "strategy",
    },
    // PIPELINE_STAGES (cases.functions.ts) lists 21 stages, but this object
    // only ever implemented 20 of them — litigation_strategy_center had no
    // entry at all. That's a missing-property error, not an extra/wrong
    // field: TypeScript's Record<PipelineStageKey, {...}> requires every
    // key in PipelineStageKey to be present, so the object literal never
    // satisfied its own declared type. Mirrors the working implementation
    // already present in pipeline-runner.server.ts.
    litigation_strategy_center: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "litigation_strategy_center" }, async () => {
          const value = await lit.runLitigationStrategyCenterEngine(baseArgs);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { count } = await (supabase as any)
            .from("case_strategy_center")
            .select("case_id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? (value ? 1 : 0);
          return {
            value,
            stats: { generated: n, accepted: n, rows_written: n, meta: { source: "engine" } },
          };
        }),
    },
    work_product: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "work_product" }, async () => {
          const value = (await eng.runWorkProductEngine(baseArgs)) as {
            documents?: unknown[];
            failed?: number;
            verification?: {
              total?: number;
              clean?: number;
              flagged?: number;
              rejected?: number;
              empty?: number;
            };
          };
          const { count } = await supabase
            .from("case_work_product")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const rows = count ?? 0;
          const gen = value.verification?.total ?? rows;
          const acc = value.verification?.clean ?? rows;
          const rej = (value.verification?.rejected ?? 0) + (value.verification?.empty ?? 0);
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: rej,
              rows_written: rows,
              meta: { source: "template", verification: value.verification ?? null },
            },
          };
        }),
    },
    hallucination: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "hallucination" }, async () => ({
          value: await hal.runHallucinationReview({ db: supabase, caseId }),
        })),
    },
    multi_agent: {
      run: async () =>
        audit.runEngine(supabase, { caseId, userId, engine: "multi_agent" }, async () => {
          const { runMultiAgentPipeline } = await import("@/lib/agents/orchestrator.server");
          const result = await runMultiAgentPipeline({
            db: supabase,
            userId,
            caseId,
            apiKey,
            apiKeys: keys,
          });
          const successful = result.results.filter((r) => r.status === "success").length;
          return {
            value: result,
            stats: {
              generated: result.results.length,
              accepted: successful,
              rejected: result.results.length - successful,
              rows_written: result.results.length,
              db_write_confirmed: true,
              meta: { run_id: result.runId, released: result.released },
            },
          };
        }),
    },
  };

  // Dependency graph — derived from CANONICAL_STAGES so there is exactly
  // one place that defines stage dependencies platform-wide.
  const { CANONICAL_STAGES } = await import("@/lib/execution/canonical");
  const DEPENDS_ON = Object.fromEntries(CANONICAL_STAGES.map((s) => [s.key, [...s.dependsOn]])) as Record<
    PipelineStageKey,
    PipelineStageKey[]
  >;
  // See matching comment in pipeline-runner.server.ts: only blocking/enriching
  // stage failures should flip the whole pipeline to "failed" — optional
  // stages are documented as "decorative; never blocks".
  const stageRequirement = (k: string): "blocking" | "enriching" | "optional" =>
    CANONICAL_STAGES.find((c) => c.key === k)?.requirement ?? "blocking";

  let stages: (typeof PIPELINE_STAGES)[number][] = [...PIPELINE_STAGES];
  if (startFrom) {
    const idx = stages.findIndex((s) => s.key === startFrom);
    if (idx > 0) stages = stages.slice(idx);
  }

  // Clear stale failed/blocked pipeline_engine_runs rows for every engine
  // this invocation is about to (re-)execute. Without this, a row left
  // over from a prior tick (e.g. a transient provider 413, or a partial
  // resume) is still the *latest* row for that engine until this run's own
  // stage writes a fresh one. Any dependency check that reads
  // latest-row-by-engine directly from the DB (assertCanRun,
  // canGenerateReport, computeStageViews — see execution/canonical.ts)
  // will see that stale failed/blocked status and gate a downstream stage
  // (e.g. work_product) even though its upstream (e.g. strategy) goes on
  // to complete later in this very run. `reset: true` already wipes the
  // whole table so this is a no-op there; this specifically covers the
  // non-reset re-run / resume path where individual stages only clear a
  // hand-picked subset of engines (analyzers, agents) and everything else
  // — strategy, work_product, multi_agent, etc. — was never cleared.
  // Scoped to only the engines in `stages` so a resume tick never erases
  // history for stages it isn't going to re-run.
  {
    const engineForStage = (k: string) => CANONICAL_STAGES.find((c) => c.key === k)?.engine ?? k;
    const engines = Array.from(new Set(stages.map((s) => engineForStage(s.key))));
    if (engines.length > 0) {
      const { error: staleClearErr } = await supabase
        .from("pipeline_engine_runs")
        .delete()
        .eq("case_id", caseId)
        .in("engine", engines)
        .in("status", ["failed", "blocked"]);
      if (staleClearErr) {
        trace("pipeline.stale_row_clear_failed", { error: staleClearErr.message });
      }
    }
  }

  const total = stages.length;
  const FATAL_STAGES = new Set<PipelineStageKey>(["extraction", "analyzers", "agents"]);
  const stageFailures: Array<{ key: string; error: string }> = [];
  const completed = new Set<PipelineStageKey>();
  const failed = new Set<PipelineStageKey>();
  const blocked = new Set<PipelineStageKey>();
  const { withCheckpointScope, budgetFor, WORKER_INVOCATION_BUDGET_MS, CHECKPOINT_SAFETY_BUFFER_MS } =
    await import("./pipeline-checkpoint.server");
  const invocationDeadlineAt = runStart + WORKER_INVOCATION_BUDGET_MS;

  // Cross-tick dependency correctness. `failed`/`blocked` above only track
  // what THIS invocation observes. A case resumes across separate worker
  // ticks via `startFrom`, which slices `stages` to start partway through —
  // so any stage before that point (e.g. `perspectives` failing on tick 1)
  // is invisible to tick 3's freshly-empty Sets, and a downstream dependent
  // (e.g. `work_product`) could run unblocked even though its real upstream
  // dependency never completed. Reconstruct the missing history from the
  // persisted ledger for exactly the stages this tick will NOT re-attempt.
  const resumeIdx = startFrom ? PIPELINE_STAGES.findIndex((s) => s.key === startFrom) : 0;
  if (resumeIdx > 0) {
    const engineForStage = (k: string) => CANONICAL_STAGES.find((c) => c.key === k)?.engine ?? k;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: priorRuns, error: priorErr } = await (supabase as any)
      .from("pipeline_engine_runs")
      .select("engine,status,started_at")
      .eq("case_id", caseId)
      .order("started_at", { ascending: true });
    if (priorErr) {
      // Fail loudly rather than silently proceeding with an incomplete
      // picture of prior failures — a swallowed error here is exactly the
      // kind of gap that let work_product run past a failed perspectives.
      throw new Error(`failed to read pipeline_engine_runs history for resume: ${priorErr.message}`);
    }
    const latestStatusByEngine = new Map<string, string>();
    for (const row of (priorRuns ?? []) as Array<{ engine: string; status: string }>) {
      latestStatusByEngine.set(row.engine, row.status); // ascending order → last write wins
    }
    const { seedResumeState } = await import("./pipeline-checkpoint.server");
    const seeded = seedResumeState({
      priorStageKeys: PIPELINE_STAGES.slice(0, resumeIdx).map((s) => s.key),
      engineForStage,
      latestStatusByEngine,
    });
    for (const k of seeded.failed) failed.add(k as PipelineStageKey);
    for (const k of seeded.blocked) blocked.add(k as PipelineStageKey);
    trace("pipeline.resume_state_seeded", {
      resume_from: startFrom,
      seeded_failed: [...failed],
      seeded_blocked: [...blocked],
    });
  }

  trace("pipeline.start", {
    total_stages: stages.length,
    reset: !!reset,
    startFrom: startFrom ?? null,
  });

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const key = s.key as PipelineStageKey;
    const r = runners[key];
    const pct = Math.floor((i / total) * 95);

    // Dependency gate — record a `blocked` row so the ledger, UI, and report
    // gate all see the truth: this engine did not run because upstream failed.
    const unmet = (DEPENDS_ON[key] ?? []).filter((d) => failed.has(d) || blocked.has(d));
    if (unmet.length > 0) {
      blocked.add(key);
      const reason = `Blocked: upstream stage(s) failed — ${unmet.join(", ")}`;
      if (stageRequirement(key) !== "optional") stageFailures.push({ key: s.key, error: reason });
      trace("stage.blocked", { stage: s.key, index: i + 1, unmet });
      try {
        await prog.emitEvent(supabase, caseId, s.key, reason, { level: "warn" });
      } catch {
        /* noop */
      }
      try {
        const { CANONICAL_STAGES: stagesDef } = await import("@/lib/execution/canonical");
        const engineFor = (k: string) => stagesDef.find((st) => st.key === k)?.engine ?? k;
        const audit = await import("@/lib/intelligence/engine-audit.server");
        await audit.recordBlocked(supabase, {
          caseId,
          userId,
          engine: engineFor(key),
          blockingEngines: unmet.map(engineFor),
          reason,
        });
      } catch (recErr) {
        console.warn(`[pipeline] failed to record blocked row for ${s.key}`, recErr);
      }
      await updateCase(
        {
          status: "intelligence_running",
          status_message: `${s.label} blocked (${i + 1}/${total})`,
          progress: pct,
          next_stage: s.key,
        },
        `stage.blocked:${s.key}`,
      );
      console.warn(`[pipeline] ${s.key} BLOCKED — ${reason}`);
      continue;
    }

    await updateCase(
      {
        status: "intelligence_running",
        status_message: `${s.label} (${i + 1}/${total})`,
        progress: pct,
        next_stage: s.key,
      },
      `stage.start:${s.key}`,
    );

    const remainingInvocationMs = invocationDeadlineAt - Date.now();
    if (remainingInvocationMs <= CHECKPOINT_SAFETY_BUFFER_MS) {
      try {
        const { requeueForContinuation } = await import("@/lib/pipeline-stall.server");
        await requeueForContinuation(supabase, caseId, s.key);
      } catch (rqErr) {
        console.warn(`[pipeline] re-queue before ${s.key} checkpoint failed`, rqErr);
      }
      trace("stage.checkpoint_before_start", {
        stage: s.key,
        index: i + 1,
        remaining_invocation_ms: remainingInvocationMs,
      });
      try {
        await prog.emitEvent(
          supabase,
          caseId,
          s.key,
          `${s.label} checkpointed before start — will resume on next worker tick`,
          { level: "warn" },
        );
      } catch {
        /* noop */
      }
      return {
        ok: true,
        completedStages: i,
        warnings: [{ key: s.key, error: "checkpoint" }],
        failedAt: s.key,
      };
    }

    trace("stage.start", { stage: s.key, index: i + 1, progress_pct: pct });
    try {
      await prog.emitEvent(supabase, caseId, s.key, `${s.label} started`);
    } catch {
      /* noop */
    }

    const stageStart = Date.now();
    try {
      // Open the AsyncLocalStorage checkpoint scope so router.server.ts's
      // assertCheckpointBudget / aiCallTimeoutForCheckpoint guards can see a
      // real deadline and yield with CheckpointRequired before the worker is
      // killed mid AI call. Without this scope those guards are no-ops and
      // only the coarse per-stage progress checks fire — which is exactly the
      // "died mid-Groq-call, never wrote terminal state" symptom.
      const stageBudgetMs = Math.min(budgetFor(s.key), WORKER_INVOCATION_BUDGET_MS);
      const { withHardCheckpointDeadline } = await import("./pipeline-checkpoint.server");
      await withHardCheckpointDeadline(
        {
          stage: s.key,
          deadlineAt: Math.min(stageStart + stageBudgetMs, invocationDeadlineAt),
          correlationId,
        },
        () => r.run(),
      );
      completed.add(key);
      if (key === "report") {
        // Report stage finished cleanly — clear the checkpoint counter so a
        // later regenerate starts with a fresh backstop budget.
        await (supabase as any)
          .from("cases")
          .update({ report_checkpoint_count: 0 })
          .eq("id", caseId)
          .then(
            () => {},
            () => {},
          );
      }
      trace("stage.complete", { stage: s.key, runtime_ms: Date.now() - stageStart });
      try {
        await prog.emitEvent(supabase, caseId, s.key, `${s.label} complete`);
      } catch {
        /* noop */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Cancelled by user" || (e instanceof Error && e.name === "CancelledError")) {
        await updateCase(
          { status: "cancelled", status_message: `Cancelled at ${s.label}` },
          `stage.cancelled:${s.key}`,
        );
        trace("pipeline.cancelled", { stage: s.key });
        return { ok: false, cancelled: true, failedAt: s.key, completedStages: i };
      }
      if (e instanceof Error && e.name === "CheckpointRequired") {
        try {
          const { requeueForContinuation } = await import("@/lib/pipeline-stall.server");
          await requeueForContinuation(supabase, caseId, s.key);
        } catch (rqErr) {
          console.warn(`[pipeline] re-queue after checkpoint failed`, rqErr);
        }
        if (s.key === "report") {
          // Backstop counter — see MAX_REPORT_CHECKPOINTS. runReport() reads
          // this on its next invocation to decide whether to keep retrying
          // raw LLM calls or force finalization with whatever succeeded.
          try {
            const { data: cur } = await (supabase as any)
              .from("cases")
              .select("report_checkpoint_count")
              .eq("id", caseId)
              .maybeSingle();
            const next = ((cur as { report_checkpoint_count?: number } | null)?.report_checkpoint_count ?? 0) + 1;
            await (supabase as any).from("cases").update({ report_checkpoint_count: next }).eq("id", caseId);
            trace("report.checkpoint_count", { count: next });
          } catch (cntErr) {
            console.warn("[pipeline] failed to increment report_checkpoint_count", cntErr);
          }
        }
        trace("stage.checkpoint", { stage: s.key, runtime_ms: Date.now() - stageStart });
        try {
          await prog.emitEvent(supabase, caseId, s.key, `${s.label} checkpointed — will resume on next worker tick`, {
            level: "warn",
          });
        } catch {
          /* noop */
        }
        return {
          ok: true,
          completedStages: i,
          warnings: [{ key: s.key, error: "checkpoint" }],
          failedAt: s.key,
        };
      }
      failed.add(key);
      trace("stage.failed", {
        stage: s.key,
        runtime_ms: Date.now() - stageStart,
        error: msg.slice(0, 500),
      });
      try {
        await prog.emitEvent(supabase, caseId, s.key, msg, { level: "error" });
      } catch {
        /* noop */
      }
      if (stageRequirement(key) !== "optional") stageFailures.push({ key: s.key, error: msg });
      if (FATAL_STAGES.has(key)) {
        await updateCase(
          {
            status: "failed",
            status_message: `Failed at ${s.label}`,
            error: msg.slice(0, 2000),
            next_stage: s.key,
          },
          `stage.failed:${s.key}`,
        );
        throw new Error(`[${s.label}] ${msg}`);
      }
      console.warn(`[pipeline] non-fatal failure at ${s.key}: ${msg}`);
    }
  }

  // Truthful final status. Multi-agent may have already stamped the case as
  // "released" or "needs_revision" — that is the authoritative post-pipeline
  // state and must NOT be overwritten by a blanket "complete". Only fall
  // back to complete/failed when multi-agent didn't stamp.
  const hasFailures = stageFailures.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postRun } = await (supabase as any)
    .from("cases")
    .select("status,status_message")
    .eq("id", caseId)
    .maybeSingle();
  const preserved = postRun?.status === "released" || postRun?.status === "needs_revision";
  const finalStatus = preserved ? postRun.status : hasFailures ? "failed" : "complete";
  const finalMessage = preserved
    ? (postRun.status_message ?? "Pipeline finalized by multi-agent release gate.")
    : hasFailures
      ? `Pipeline finished with ${stageFailures.length} failed/blocked stage(s): ${stageFailures.map((f) => f.key).join(", ")}`
      : "Full pipeline complete";
  await updateCase(
    {
      status: finalStatus,
      status_message: finalMessage,
      progress: 100,
      next_stage: null,
      error: hasFailures
        ? stageFailures
            .map((f) => `${f.key}: ${f.error}`)
            .join(" | ")
            .slice(0, 2000)
        : null,
    },
    "pipeline.finalize",
  );

  // Canonical projection — additive, never blocks legacy path. Projects every
  // engine table into the 17-section CaseAnalysis, validates, and upserts to
  // canonical_analysis. Validation failures are recorded on the row, not
  // thrown, so the legacy report path stays intact.
  try {
    const { runCanonicalGate } = await import("@/lib/canonical/gate.server");
    // canonical_analysis is service-role-write only (users get SELECT via RLS),
    // so the projection must run with the privileged server client.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reportMode = hasFailures ? "LIMITED" : "FULL";
    const gate = await runCanonicalGate(supabaseAdmin as typeof supabase, caseId, reportMode);

    trace("pipeline.canonical", {
      ok: gate.ok,
      status: gate.status,
      issues: gate.validation.issues.length,
    });
  } catch (canonErr) {
    console.warn("[pipeline] canonical projection failed:", canonErr);
    trace("pipeline.canonical.failed", {
      error: canonErr instanceof Error ? canonErr.message : String(canonErr),
    });
  }

  trace("pipeline.finalized", {
    total_runtime_ms: Date.now() - runStart,
    final_status: finalStatus,
    preserved_from_multi_agent: preserved,
    failures: stageFailures.length,
    completed: completed.size,
    blocked: blocked.size,
  });
  return { ok: true, completedStages: total, warnings: stageFailures };
}

// ---------------------------------------------------------------
// Restored pipeline step implementations (runExtraction, runAnalyzers,
// runAgents, runScoring, runReport, retryFailedExtractions,
// rollbackExtractions, resolveCaseType, isCriminalCaseType, detectCaseType).
// Recovered from an earlier snapshot after these were lost from
// pipeline.server.ts; uploadFiles/inferMimeType above are the current,
// already-working versions and were NOT replaced by the older ones
// bundled in that snapshot.
// ---------------------------------------------------------------
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function logUsage(
  db: Db,
  args: {
    userId: string;
    caseId: string;
    operation: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    success: boolean;
    error?: string;
    provider?: string;
    keyIndex?: number;
  },
) {
  const { getKeyIdByIndex } = await import("@/lib/ai-key-router.server");
  const provider = (args.provider ?? "groq") as "groq" | "openai" | "gemini" | "anthropic" | "openrouter";
  const groqKeyId = getKeyIdByIndex(args.userId, provider, args.keyIndex);
  await db.from("ai_usage").insert({
    user_id: args.userId,
    case_id: args.caseId,
    model: args.model,
    operation: args.operation,
    provider_type: args.provider ?? null,
    input_tokens: args.inputTokens ?? null,
    output_tokens: args.outputTokens ?? null,
    total_tokens: args.totalTokens ?? null,
    latency_ms: args.latencyMs,
    success: args.success,
    error: args.error ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...((groqKeyId ? { groq_key_id: groqKeyId } : {}) as any),
  });
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "CancelledError";
  }
}

async function setCase(db: Db, caseId: string, patch: Record<string, unknown>) {
  // Cooperative cancellation: every progress write checks the cancel flag.

  const { data: row } = await db
    .from("cases")
    .select("cancel_requested" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((row as any)?.cancel_requested) {
    await db
      .from("cases")
      .update({
        status: "cancelled",
        status_message: "Cancelled by user",

        cancel_requested: false,
        error: null,
        // 2026-07 audit: this write previously left worker_lease_until
        // untouched. The outer runner's own updateCase() wrapper nulls the
        // lease whenever it writes a terminal status, but THIS raw write
        // (the one that actually fires first, from inside the stage that
        // noticed cancel_requested) did not — leaving a stale, still-active
        // lease behind even though the case is now idle at status
        // "cancelled". Every subsequent queueCaseForPipeline call then saw
        // leaseActive === true and treated the dead case as "still
        // running", so Rerun just kept re-requesting cancellation on a
        // process that no longer existed instead of ever actually
        // requeuing — the "Rerun sits at cancelled forever" symptom.
        worker_lease_until: null,
      } as any)
      .eq("id", caseId);
    console.info(
      `[pipeline] ${JSON.stringify({
        t: new Date().toISOString(),
        event: "case.status.write",
        source: "pipeline.setCase.cancel_requested",
        caseId,
        previous_status: null,
        new_status: "cancelled",
      })}`,
    );
    throw new CancelledError();
  }
  const includesStatus = Object.prototype.hasOwnProperty.call(patch, "status");
  let before: Record<string, unknown> | null = null;
  if (includesStatus) {
    const { data: beforeRow } = await db
      .from("cases")
      .select("status,status_message,next_stage,worker_lease_until" as any)
      .eq("id", caseId)
      .maybeSingle();
    before = (beforeRow ?? null) as Record<string, unknown> | null;
  }

  const { error } = await db
    .from("cases")
    .update(patch as any)
    .eq("id", caseId);
  if (error) throw new Error(`Failed to update case status: ${error.message}`);
  if (includesStatus) {
    console.info(
      `[pipeline] ${JSON.stringify({
        t: new Date().toISOString(),
        event: "case.status.write",
        source: "pipeline.setCase",
        caseId,
        previous_status: before?.status ?? null,
        new_status: patch.status ?? null,
        previous_next_stage: before?.next_stage ?? null,
        new_next_stage: patch.next_stage ?? before?.next_stage ?? null,
      })}`,
    );
  }
}

function assertDbOk(error: { message: string } | null | undefined, action: string) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

function isPayloadTooLargeError(msg: string): boolean {
  return /HTTP 413|request too large|payload too large|context.*length|maximum context/i.test(msg);
}

function isProviderUnavailableError(msg: string): boolean {
  return /All Groq keys failed|Groq model cooldown active|All AI providers failed|temporarily unavailable|cooldown|HTTP 402|payment_required|not enough credits|insufficient credits|HTTP 429|quota|rate.?limit|too many requests|model is unavailable/i.test(
    msg,
  );
}

function isRetryableTransportError(msg: string): boolean {
  return /timeout|ETIMEDOUT|ECONNRESET|HTTP 5\d\d/i.test(msg);
}

function isAuthProviderError(msg: string): boolean {
  return /HTTP 401|HTTP 403|invalid_api_key|unauthor/i.test(msg);
}

// ===== STEP 1: Extraction =====
export async function runExtraction(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, {
    status: "extracting",
    status_message: "Extracting evidence",
    progress: 5,
    error: null,
  });
  // Fresh pipeline pass — clear prior engine audit so the dashboard reflects
  // this run only.
  await clearEngineRuns(db, caseId);
  return runEngine(db, { caseId, userId, engine: "extraction" }, async () => {
    return _runExtractionInner({ db, caseId, userId, apiKey, apiKeys });
  });
}

async function _runExtractionInner(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;

  const MAX_RETRIES = 3;
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,mime_type,storage_path,content_hash,status,extraction_retry_count")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  // Exclude files that are conventionally instructions/metadata about the
  // test fixture itself, not legal evidence — a README/manifest counted as
  // a "corpus document" inflates document counts and pollutes the Evidence
  // Sufficiency Score with non-evidentiary content. Conservative pattern:
  // only matches clearly-conventional non-evidence filenames, never a real
  // party/court document (which won't be named "README" or "MANIFEST").
  const NON_EVIDENCE_FILENAME = /^(readme|manifest|case[-_]?manifest|test[-_]?metadata|\.gitkeep)/i;
  const list = (docs ?? []).filter((d) => !NON_EVIDENCE_FILENAME.test(d.filename ?? ""));
  const total = list.length;
  if (total === 0) throw new Error("No documents uploaded");

  let processed = 0;
  let extractedOk = 0;
  let extractedFail = 0;
  let skipped = 0;
  // Wall-clock checkpoint: if the loop exceeds the extraction budget, break
  // out and let the runner re-queue the case. Already-extracted docs are
  // skipped on the next pass (status === "extracted" short-circuits above),
  // so this is safe and preserves per-document progress.
  const { budgetFor, CheckpointRequired } = await import("./pipeline-checkpoint.server");
  const stageBudgetMs = budgetFor("extraction");
  const stageStartedAt = Date.now();
  for (const d of list) {
    if (Date.now() - stageStartedAt > stageBudgetMs && processed > 0 && processed < total) {
      console.warn(`[extraction] checkpoint reached after ${processed}/${total} docs — yielding`);
      throw new CheckpointRequired("extraction", `${processed}/${total} docs`);
    }
    processed += 1;
    const pct = 5 + Math.floor((processed / total) * 90);
    await setCase(db, caseId, {
      status_message: `Extracting ${processed}/${total}: ${d.filename}`,
      progress: pct,
    });

    // Idempotency: skip already-completed docs (prevents duplicate AI cost on rerun)
    if (d.status === "extracted") {
      extractedOk += 1;
      skipped += 1;
      continue;
    }
    // Cap retries: do not reprocess docs that have failed MAX_RETRIES times
    if ((d.extraction_retry_count ?? 0) >= MAX_RETRIES) {
      await db
        .from("documents")
        .update({ status: "failed", error: `Permanently failed after ${MAX_RETRIES} retries` })
        .eq("id", d.id);
      extractedFail += 1;
      continue;
    }
    // Atomic claim: only proceed if row is not already being processed by another worker
    const { data: claimed } = await db
      .from("documents")
      .update({
        status: "extracting",
        error: null,
        last_extraction_attempt_at: new Date().toISOString(),
      })
      .eq("id", d.id)
      .neq("status", "extracting")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      const { data: blob, error: dlErr } = await db.storage.from("case-files").download(d.storage_path!);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "download failed");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      let extractedText = "";
      let entities: unknown = [];
      let metadata: unknown = {};
      let pageTexts: string[] | null = null;

      if (TEXT_EXT.test(d.filename) || (d.mime_type ?? "").startsWith("text/")) {
        const ex = extractPlainText(bytes, d.mime_type ?? "text/plain");
        extractedText = ex.text;
        metadata = ex.metadata;
      } else if (CSV_EXT.test(d.filename)) {
        const ex = extractCsv(bytes);
        extractedText = ex.text;
        metadata = ex.metadata;
      } else if (PDF_EXT.test(d.filename) || (d.mime_type ?? "") === "application/pdf") {
        try {
          const ex = await extractPdf(bytes);
          extractedText = ex.text;
          metadata = ex.metadata;
          pageTexts = ex.pageTexts ?? null;
          // If the PDF was scanned (no extractable text), try LLM OCR on the file directly.
          if (!extractedText && bytes.byteLength <= MAX_IMAGE_BYTES * 4) {
            extractedText = `[Scanned PDF detected — ${bytes.byteLength} bytes — embedded text layer empty. Page-image OCR not yet enabled for this file type.]`;
          }
        } catch (pdfErr) {
          const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
          throw new Error(`PDF extraction failed: ${msg}`);
        }
      } else if (DOCX_EXT.test(d.filename)) {
        const ex = await extractDocx(bytes);
        extractedText = ex.text;
        metadata = ex.metadata;
      } else if (XLSX_EXT.test(d.filename)) {
        const ex = await extractXlsx(bytes);
        extractedText = ex.text;
        metadata = ex.metadata;
      } else if (IMAGE_EXT.test(d.filename) && bytes.byteLength <= MAX_IMAGE_BYTES) {
        const dataUrl = `data:${d.mime_type};base64,${bytesToBase64(bytes)}`;
        const content: GroqContent = [
          {
            type: "text",
            text:
              "Extract ALL text from this image (OCR). Return STRICT JSON only:\n" +
              '{ "text": string, "metadata": { "document_type": string, "date": string|null, "parties": string[], "summary": string }, "entities": [ { "type": string, "value": string } ] }',
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ];
        const r = await callGroq({
          apiKey,
          apiKeys,
          systemInstruction: `${mexicoLock(await getReportLocale(db, caseId))}\nYou are a precise legal-document extractor for the Mexican legal system. Recognize Mexican document types and formats (carpeta de investigación, escritura pública, demanda, contestación, acuerdo, oficio, etc.). Output JSON only.`,
          userContent: content,
          json: true,
        });
        await logUsage(db, {
          userId,
          caseId,
          operation: "extract",
          model: r.model,
          provider: r.provider,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          latencyMs: r.latencyMs,
          success: true,
          keyIndex: r.keyIndex,
        });
        const parsed = parseJsonLoose<{ text?: string; metadata?: unknown; entities?: unknown }>(r.text);
        extractedText = parsed?.text ?? r.text;
        metadata = parsed?.metadata ?? {};
        entities = parsed?.entities ?? [];
        // Vision Pipeline (Batch 3): attach a deterministic structured descriptor
        // (parties, dates, amounts, signatures, document_kind) to image metadata.
        try {
          const { buildVisionDescriptor } = await import("./intelligence/vision.server");
          const vision = buildVisionDescriptor({
            filename: d.filename,
            mimeType: d.mime_type ?? "image/*",
            extractedText,
            entities: Array.isArray(entities) ? (entities as Array<{ type?: string; value?: string }>) : null,
          });
          metadata = { ...(metadata as Record<string, unknown>), vision };
        } catch (visErr) {
          console.warn("[vision] descriptor failed for", d.id, visErr);
        }

        // Step 4: Image Intelligence second pass — ask the vision model for
        // {summary, objects, text_found, face_count}. Failures are logged and
        // ignored; extraction succeeds regardless.
        try {
          const visionContent: GroqContent = [
            {
              type: "text",
              text:
                "Analyze this image as legal evidence. Return STRICT JSON only:\n" +
                '{ "summary": string, "objects": string[], "text_found": string, "face_count": number, "confidence": number }\n' +
                "confidence is 0..1. face_count is a count only — do NOT identify anyone.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ];
          const vr = await callGroq({
            apiKey,
            apiKeys,
            systemInstruction: `${mexicoLock(await getReportLocale(db, caseId))}\nYou describe evidentiary images relevant to a Mexican legal proceeding. Output JSON only. Never identify people.`,
            userContent: visionContent,
            json: true,
          });
          await logUsage(db, {
            userId,
            caseId,
            operation: "image_intel",
            model: vr.model,
            provider: vr.provider,
            inputTokens: vr.inputTokens,
            outputTokens: vr.outputTokens,
            totalTokens: vr.totalTokens,
            latencyMs: vr.latencyMs,
            success: true,
            keyIndex: vr.keyIndex,
          });
          const vp = parseJsonLoose<{
            summary?: string;
            objects?: unknown;
            text_found?: string;
            face_count?: number;
            confidence?: number;
          }>(vr.text);
          if (vp) {
            await db.from("image_intelligence" as never).insert({
              case_id: caseId,
              document_id: d.id,
              page_number: 1,
              summary: typeof vp.summary === "string" ? vp.summary.slice(0, 4000) : null,
              objects: (Array.isArray(vp.objects) ? vp.objects : []) as J,
              text_found: typeof vp.text_found === "string" ? vp.text_found.slice(0, 8000) : null,
              ocr_text: extractedText ? String(extractedText).slice(0, 8000) : null,
              confidence: typeof vp.confidence === "number" ? vp.confidence : null,
              source_model: vr.model,
              face_count: typeof vp.face_count === "number" ? vp.face_count : null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }
        } catch (imgErr) {
          rethrowIfCheckpoint(imgErr);
          console.warn("[image_intel] second pass failed for", d.id, imgErr instanceof Error ? imgErr.message : imgErr);
        }
      } else {
        throw new Error(
          `Unsupported file type for analysis: ${d.filename} (${d.mime_type}). Convert to PDF/DOCX/TXT and re-upload.`,
        );
      }

      const { error: docWriteErr } = await db
        .from("documents")
        .update({
          status: "extracted",
          extracted_text: extractedText,
          metadata: metadata as J,
          entities: entities as J,
          error: null,
        })
        .eq("id", d.id);
      {
        const { trace } = await import("./pipeline-trace.server");
        await trace({
          phase: "engine",
          step: "extraction.document",
          status: docWriteErr ? "error" : extractedText.trim().length === 0 ? "warn" : "ok",
          error: docWriteErr?.message ?? null,
          detail: {
            document_id: d.id,
            filename: d.filename,
            mime_type: d.mime_type,
            bytes: bytes.byteLength,
            chars_extracted: extractedText.length,
            pages: pageTexts?.length ?? null,
            index: `${processed}/${total}`,
            pg_code: docWriteErr?.code ?? null,
          },
          db,
          caseId,
          userId,
        });
      }

      // Persist per-page text for citation verification. Replace any prior pages
      // for this document so re-extraction stays consistent.
      try {
        await db.from("document_pages").delete().eq("document_id", d.id);
        const pages = pageTexts && pageTexts.length > 0 ? pageTexts : [extractedText];
        const rows = pages.map((t, i) => ({
          document_id: d.id,
          case_id: caseId,
          user_id: userId,
          page: i + 1,
          text: t ?? "",
          char_count: (t ?? "").length,
        }));
        if (rows.length > 0) {
          // chunk in case of very large PDFs
          const CHUNK = 200;
          for (let i = 0; i < rows.length; i += CHUNK) {
            await db.from("document_pages").insert(rows.slice(i, i + CHUNK));
          }
        }
      } catch (pageErr) {
        console.error("document_pages persist failed", d.id, pageErr);
      }
      extractedOk += 1;
    } catch (e) {
      rethrowIfCheckpoint(e);
      const msg = e instanceof Error ? e.message : String(e);
      {
        const { trace } = await import("./pipeline-trace.server");
        await trace({
          phase: "engine",
          step: "extraction.document",
          status: "error",
          error: msg,
          detail: {
            document_id: d.id,
            filename: d.filename,
            mime_type: d.mime_type,
            index: `${processed}/${total}`,
            retry_count: (d.extraction_retry_count ?? 0) + 1,
            stack: e instanceof Error ? (e.stack ?? "").split("\n").slice(0, 5).join("\n") : null,
          },
          db,
          caseId,
          userId,
        });
      }
      const newCount = (d.extraction_retry_count ?? 0) + 1;
      await db
        .from("documents")
        .update({
          status: "failed",
          error: msg,
          extraction_retry_count: newCount,
        })
        .eq("id", d.id);
      await logUsage(db, {
        userId,
        caseId,
        operation: "extract",
        model: MODEL,
        latencyMs: 0,
        success: false,
        error: msg,
      });
      extractedFail += 1;
    }
  }

  const coverage = await computeCoverage(db, caseId);
  if (extractedOk === 0) {
    // Every document failed — do NOT mark the case as extracted, or downstream
    // steps will look "unlocked" while having nothing to work with.
    const firstErr = (
      await db.from("documents").select("error").eq("case_id", caseId).eq("status", "failed").limit(1).maybeSingle()
    ).data?.error;
    await setCase(db, caseId, {
      status: "failed",
      status_message: "Extraction failed for every document",
      progress: 0,
      error: firstErr ?? `Extraction failed for all ${total} document(s).`,
      extraction_report: { total, extracted: 0, failed: extractedFail, coverage } as J,
    });
    throw new Error(firstErr ?? `Extraction failed for all ${total} document(s).`);
  }
  await setCase(db, caseId, {
    status: "extracted",
    status_message: "Extraction complete",
    progress: 100,
    extracted_at: new Date().toISOString(),
    extraction_report: {
      total,
      extracted: extractedOk,
      failed: extractedFail,
      skipped,
      coverage,
    } as J,
  });
  return {
    value: undefined,
    stats: {
      generated: total,
      accepted: extractedOk,
      rejected: extractedFail,
      meta: { coverage, skipped },
    },
  };
}

// ===== EXTRACTION RETRY =====
// Resets failed documents to "pending" and re-runs extraction.
// Only retries documents whose retry count is below the max (3).
export async function retryFailedExtractions(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  const MAX_RETRIES = 3;

  // Find failed documents that haven't exceeded retry limit
  const { data: failedDocs } = await db
    .from("documents")
    .select("id,filename,extraction_retry_count")
    .eq("case_id", caseId)
    .eq("status", "failed")
    .lt("extraction_retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true });

  const docsToRetry = failedDocs ?? [];
  if (docsToRetry.length === 0) {
    return {
      retried: 0,
      message: "No failed documents eligible for retry (either none failed or max retries reached).",
    };
  }

  // Reset status to pending and increment retry count
  for (const d of docsToRetry) {
    await db
      .from("documents")
      .update({
        status: "pending",
        error: null,
        extraction_retry_count: (d.extraction_retry_count ?? 0) + 1,
        last_extraction_attempt_at: new Date().toISOString(),
      })
      .eq("id", d.id);
  }

  // Now re-run extraction
  await setCase(db, caseId, {
    status: "extracting",
    status_message: `Retrying extraction for ${docsToRetry.length} failed document(s)`,
    progress: 0,
    error: null,
  });

  const result = await runExtraction({ db, caseId, userId, apiKey, apiKeys });
  return { retried: docsToRetry.length, result };
}

// ===== EXTRACTION ROLLBACK =====
// Clears extracted_text, metadata, and entities for specified documents,
// resetting them to "pending" so they can be re-extracted fresh.
export async function rollbackExtractions(args: { db: Db; caseId: string; documentIds: string[] }) {
  const { db, caseId, documentIds } = args;
  if (documentIds.length === 0) {
    return { cleared: 0, message: "No documents specified for rollback." };
  }

  // Only rollback documents that are currently extracted
  const { data: docs } = await db
    .from("documents")
    .select("id,status")
    .eq("case_id", caseId)
    .in("id", documentIds)
    .eq("status", "extracted");

  const eligible = (docs ?? []).map((d) => d.id);
  if (eligible.length === 0) {
    return { cleared: 0, message: "No extracted documents found among the specified IDs." };
  }

  // Clear extraction data and reset to pending
  await db
    .from("documents")
    .update({
      status: "pending",
      extracted_text: null,
      metadata: {} as J,
      entities: [] as J,
      error: null,
      extraction_retry_count: 0,
    })
    .in("id", eligible);

  // Also clear document_pages for these documents
  await db.from("document_pages").delete().in("document_id", eligible);

  return { cleared: eligible.length, documentIds: eligible };
}

async function buildCorpus(db: Db, caseId: string) {
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,extracted_text,metadata,entities,status")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const extracted = (docs ?? []).filter((d) => d.status === "extracted");
  const chunks: CorpusChunk[] = extracted.map((d, i) => {
    const header = `=== DOCUMENT ${i + 1} (id=${d.id}): ${d.filename} ===`;
    const body = `${header}\nMETADATA: ${JSON.stringify(d.metadata)}\nENTITIES: ${JSON.stringify(d.entities)}\nTEXT:\n${(d.extracted_text ?? "").slice(0, 40000)}`;
    return {
      docId: d.id as string,
      filename: d.filename as string,
      index: i + 1,
      text: body,
      size: body.length,
    };
  });
  const corpus = chunks.map((c) => c.text).join("\n\n");
  return { corpus, chunks, docMap: new Map(extracted.map((d) => [d.filename, d.id as string])) };
}

// Per-request corpus payload budget (chars). Held at PARITY with the US build
// (Nyrava.com: 60_000 / 8_000), which runs all day on two keys. Lowering this
// does NOT save quota: the corpus is the same size either way, so a smaller
// budget just splits it into 3-4x more requests — more per-request overhead,
// more rotations, and more chances to trip a per-minute request cap. The
// correct guard is the runtime 413/429 auto-split below (splitOversizeChunk),
// which shrinks only the batches that actually get rejected.
const ANALYZER_CORPUS_BUDGET_CHARS = 60_000;
const ANALYZER_MIN_BATCH_CHARS = 8_000;

type CorpusChunk = { docId: string; filename: string; index: number; text: string; size: number };

function packChunks(chunks: CorpusChunk[], budget: number): CorpusChunk[][] {
  const batches: CorpusChunk[][] = [];
  let cur: CorpusChunk[] = [];
  let curSize = 0;
  for (const c of chunks) {
    if (c.size > budget) {
      if (cur.length) {
        batches.push(cur);
        cur = [];
        curSize = 0;
      }
      // A single document larger than the budget used to be sent whole and
      // only split AFTER a 413 came back. The router's pre-flight size gate
      // skips the narrow provider instead of returning a 413, so that split
      // never fired and the batch silently overshot the provider budget.
      // Split it up front instead.
      for (const piece of splitToBudget(c, budget)) batches.push([piece]);
      continue;
    }
    if (curSize + c.size > budget && cur.length) {
      batches.push(cur);
      cur = [];
      curSize = 0;
    }
    cur.push(c);
    curSize += c.size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Recursively halve an oversize document until every piece fits `budget`. */
function splitToBudget(c: CorpusChunk, budget: number): CorpusChunk[] {
  // Floor is deliberately below ANALYZER_MIN_BATCH_CHARS: that constant guards
  // the reactive 413 path, but here the budget already reflects the narrowest
  // provider and must win, otherwise the piece still overshoots.
  if (c.size <= Math.max(budget, 1_500)) return [c];
  const halves = splitOversizeChunk(c, 1_500);
  if (halves.length < 2) return [c];
  return halves.flatMap((h) => splitToBudget(h, budget));
}

function splitOversizeChunk(c: CorpusChunk, minChars = ANALYZER_MIN_BATCH_CHARS): CorpusChunk[] {
  if (c.size <= minChars) return [c];
  const mid = Math.floor(c.text.length / 2);
  const a = c.text.slice(0, mid);
  const b = `=== DOCUMENT ${c.index} (id=${c.docId}) [cont.]: ${c.filename} ===\n${c.text.slice(mid)}`;
  return [
    { ...c, text: a, size: a.length },
    { ...c, text: b, size: b.length },
  ];
}

// ===== STEP 2: Analyzers =====
export async function runAnalyzers(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId } = args;
  await setCase(db, caseId, {
    status: "analyzing",
    status_message: "Running analyzers",
    progress: 20,
  });
  // Reset per-engine rows for the sub-engines this stage covers so a re-run
  // shows fresh counts.
  await db.from("pipeline_engine_runs").delete().eq("case_id", caseId).in("engine", [
    "fact_extraction",
    "analyzer_contradictions",
    "analyzer_discovery_gaps",
    "analyzer_evidence_intelligence",
    // Clear downstream rows too; analyzer re-run makes them stale. They must
    // NOT be reinserted here, otherwise the UI shows later stages complete
    // before their own buttons / orchestrated stages actually run.
    "contradictions",
    "discovery_gaps",
    "evidence_intelligence",
    "analyzers",
  ]);
  return runEngine(db, { caseId, userId, engine: "analyzers" }, async () => _runAnalyzersInner(args));
}

async function _runAnalyzersInner(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  const { corpus, chunks } = await buildCorpus(db, caseId);
  if (!corpus) throw new Error("No extracted documents. Run Extraction first.");

  // Practice-area context for the analyzer LLM so it stays in-domain.
  const { PRACTICE_AREA_LABELS, normalizePracticeArea, isFindingAllowed } =
    await import("./intelligence/practice-areas");
  const { getActiveDomains } = await import("./intelligence/cross-domain.server");

  const { data: caseRowForArea } = await db
    .from("cases")
    .select("case_type" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analyzerArea = String((caseRowForArea as any)?.case_type ?? "general_civil");
  const analyzerDomains = await getActiveDomains(db, caseId);
  const analyzerAreaLabel = PRACTICE_AREA_LABELS[normalizePracticeArea(analyzerArea)];
  const analyzerPreamble =
    `${mexicoLock(await getReportLocale(db, caseId))}\n` +
    `CASE TYPE: ${analyzerAreaLabel} (${analyzerArea}). ` +
    `Only surface findings whose legal theory applies to a ${analyzerAreaLabel} matter. ` +
    `Do NOT generate findings framed around sistema penal acusatorio concepts (vinculación a proceso, ` +
    `medidas cautelares, cadena de custodia), derecho laboral, derecho migratorio, or derecho fiscal ` +
    `unless this case type expressly covers them. ` +
    `Do NOT infer missing procedural facts (e.g. "no proof of service") absent a verbatim corpus quote.`;

  const systemInstruction =
    `${analyzerPreamble}\n` +
    "You are a senior legal analyst. Every finding MUST cite at least one verbatim quote (<=200 chars) copied exactly from the corpus, with the source DOCUMENT filename. If you cannot cite verbatim evidence, DO NOT include the finding. " +
    'For every "legal_significance" field: do not restate the fact or the finding\'s title. Instead, in one sentence, explain the legal mechanism — WHY this fact matters (e.g. which element it undermines or supports, what evidentiary rule or doctrine it implicates, what it would let opposing counsel argue or what motion it supports). A reader who has not seen the underlying document should understand the legal consequence, not just the fact pattern. Output STRICT JSON only.';

  const analyzerLocale = await getReportLocale(db, caseId);
  const { mxPartyRoleEnum } = await import("./execution/mx-pipeline");

  const buildPrompt = (corpusText: string) =>
    `Return STRICT JSON. EVERY item in contradictions, missing_evidence, procedural_issues, and key_findings MUST include an evidence_refs array of { doc_id?: string, doc_n?: number, quote: string (verbatim from corpus, <=200 chars) }. Every "legal_significance" value must explain the legal consequence of the fact (why it matters), not just restate the fact itself.

CRITICAL: every string VALUE in this JSON (title, description, legal_significance, potential_impact, rule) MUST be written entirely in ${analyzerLocale === "en" ? "English" : "Spanish"} — regardless of what language the underlying source documents/corpus are written in. Never carry over English from an English-language source document (e.g. a WhatsApp message, bank statement, or email quoted in the corpus) into these fields; translate the legal analysis, only verbatim quotes inside evidence_refs may stay in their original language since they must match the source exactly.

{
  "timeline": [ { "date": string, "event": string, "source_document": string } ],
  "contradictions": [ { "title": string, "description": string, "documents": string[], "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ],
  "missing_evidence": [ { "title": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ],
  "procedural_issues": [ { "title": string, "description": string, "rule": string|null, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ],
  "evidence_relationships": [ { "from": string, "to": string, "relationship": string } ],
  "key_findings": [ { "title": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ]
}

CASE CORPUS:
${corpusText}`;

  // Batch-level execution with dynamic sizing + 413 auto-split.
  // The budget is capped by the NARROWEST configured provider so Groq stays in
  // the fallback chain instead of being skipped as oversize on every call.
  const { packingCharBudget, PROMPT_OVERHEAD_CHARS } = await import("@/lib/ai/router.server");
  const analyzerBudgetChars = await packingCharBudget(ANALYZER_CORPUS_BUDGET_CHARS, PROMPT_OVERHEAD_CHARS.analyzers);
  const initialBatches = packChunks(chunks, analyzerBudgetChars);
  console.log(
    `[analyzers] docs=${chunks.length} totalChars=${corpus.length} batches=${initialBatches.length} budgetChars=${analyzerBudgetChars}`,
  );

  // Resume support: skip batches already completed in a prior run.

  const { data: priorBatchRuns } = await db
    .from("pipeline_engine_runs")
    .select("meta,status" as any)
    .eq("case_id", caseId)
    .eq("engine", "analyzers_batch");
  const completedDocSets = new Set<string>();
  for (const row of (priorBatchRuns ?? []) as unknown as Array<{
    status: string;
    meta: { docIds?: string[] } | null;
  }>) {
    if (row.status === "completed" && Array.isArray(row.meta?.docIds)) {
      completedDocSets.add(row.meta!.docIds!.slice().sort().join("|"));
    }
  }

  type AnalyzerBucket = {
    timeline: unknown[];
    contradictions: unknown[];
    missing_evidence: unknown[];
    procedural_issues: unknown[];
    evidence_relationships: unknown[];
    key_findings: unknown[];
  };
  const merged: AnalyzerBucket = {
    timeline: [],
    contradictions: [],
    missing_evidence: [],
    procedural_issues: [],
    evidence_relationships: [],
    key_findings: [],
  };
  const providerErrors: string[] = [];

  const queue: CorpusChunk[][] = [...initialBatches];
  let batchIdx = 0;
  let successes = 0;
  // Wall-clock checkpoint for the analyzer batch loop. Completed batches
  // persist their own `analyzers_batch` row and are skipped on resume, so
  // yielding here loses no work.
  const { budgetFor: _analyzerBudgetFor, CheckpointRequired: _AnalyzerCheckpoint } =
    await import("./pipeline-checkpoint.server");
  const analyzerBudgetMs = _analyzerBudgetFor("analyzers");
  const analyzerStartedAt = Date.now();
  while (queue.length) {
    if (Date.now() - analyzerStartedAt > analyzerBudgetMs && successes > 0) {
      console.warn(`[analyzers] checkpoint reached after ${successes} batches — yielding, ${queue.length} remaining`);
      throw new _AnalyzerCheckpoint("analyzers", `${successes} batches done, ${queue.length} remaining`);
    }
    batchIdx++;
    const batch = queue.shift()!;
    const key = batch
      .map((c) => c.docId)
      .sort()
      .join("|");
    if (completedDocSets.has(key)) {
      console.log(`[analyzers] batch ${batchIdx} skipped (already completed in prior run) docs=${batch.length}`);
      continue;
    }
    const batchCorpus = batch.map((c) => c.text).join("\n\n");
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      console.log(`[analyzers] batch ${batchIdx} start docs=${batch.length} chars=${batchCorpus.length}`);
      const r = await callGroq({
        apiKey,
        apiKeys,
        systemInstruction,
        userContent: buildPrompt(batchCorpus),
        json: true,
        temperature: 0.1,
      });
      await logUsage(db, {
        userId,
        caseId,
        operation: "analyze",
        model: r.model,
        provider: r.provider,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        latencyMs: r.latencyMs,
        success: true,
        keyIndex: r.keyIndex,
      });
      const parsed = parseJsonLoose<Record<string, unknown>>(r.text) ?? {};
      const push = (k: keyof AnalyzerBucket) => {
        const v = parsed[k];
        if (Array.isArray(v)) merged[k].push(...v);
      };
      push("timeline");
      push("contradictions");
      push("missing_evidence");
      push("procedural_issues");
      push("evidence_relationships");
      push("key_findings");
      successes++;

      await db.from("pipeline_engine_runs").insert({
        case_id: caseId,
        user_id: userId,
        engine: "analyzers_batch",
        status: "completed",
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        runtime_ms: Date.now() - t0,
        generated: 0,
        accepted: 0,
        rejected: 0,
        suppressed_ess: 0,
        suppressed_validator: 0,
        meta: {
          batchIdx,
          docs: batch.length,
          chars: batchCorpus.length,
          docIds: batch.map((c) => c.docId),
          provider: r.provider,
        } as any,
      } as any);
    } catch (e) {
      rethrowIfCheckpoint(e);
      const msg = e instanceof Error ? e.message : String(e);
      const payloadTooLarge = isPayloadTooLargeError(msg);
      const providerUnavailable = isProviderUnavailableError(msg);
      const retryableTransport = isRetryableTransportError(msg);
      const nonRetryable = isAuthProviderError(msg);
      console.warn(
        `[analyzers] batch ${batchIdx} failed (payload=${payloadTooLarge} providerUnavailable=${providerUnavailable} transport=${retryableTransport} nonRetryable=${nonRetryable}) chars=${batchCorpus.length}: ${msg.slice(0, 300)}`,
      );

      await db.from("pipeline_engine_runs").insert({
        case_id: caseId,
        user_id: userId,
        engine: "analyzers_batch",
        status: "failed",
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        runtime_ms: Date.now() - t0,
        generated: 0,
        accepted: 0,
        rejected: 0,
        suppressed_ess: 0,
        suppressed_validator: 0,
        meta: {
          batchIdx,
          docs: batch.length,
          chars: batchCorpus.length,
          docIds: batch.map((c) => c.docId),
          error: msg.slice(0, 500),
        } as any,
      } as any);
      if (payloadTooLarge && !nonRetryable && batch.length > 1) {
        // Split batch in half and re-queue.
        const mid = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(0, mid), batch.slice(mid));
        console.log(`[analyzers] batch ${batchIdx} split → 2 sub-batches of ${mid}/${batch.length - mid}`);
        continue;
      }
      if (payloadTooLarge && !nonRetryable && batch.length === 1 && batch[0].size > ANALYZER_MIN_BATCH_CHARS) {
        // Single oversize doc: split its text.
        const halves = splitOversizeChunk(batch[0]);
        if (halves.length > 1) {
          queue.unshift(...halves.map((h) => [h]));
          console.log(`[analyzers] batch ${batchIdx} single-doc split by text (${halves.length} halves)`);
          continue;
        }
      }
      providerErrors.push(
        `batch ${batchIdx} (${batch.length} docs, ${batchCorpus.length} chars): ${msg.slice(0, 300)}`,
      );
      if (isGroqCooldownOrRateLimit(msg)) {
        const { CheckpointRequired } = await import("./pipeline-checkpoint.server");
        console.warn(`[analyzers] Groq cooldown/rate limit reached; yielding for worker retry instead of failing case`);
        throw new CheckpointRequired("analyzers", `after ${successes} successful batch(es) — ${msg.slice(0, 300)}`);
      }
      if (providerUnavailable || retryableTransport) {
        console.warn(
          `[analyzers] stopping remaining batches after provider/capacity failure to avoid repeated AI spend`,
        );
        break;
      }
    }
  }

  if (successes === 0) {
    // Soft-catch: a transient batch failure (malformed JSON, provider capacity,
    // transport hiccup) must not hard-fail the stage and cascade every
    // downstream engine into `blocked`. Only a real configuration error
    // (bad/absent API key) is fatal here.
    const fatalConfig = providerErrors.some((m) => isAuthProviderError(m));
    if (fatalConfig) {
      throw new Error(`Analyzers failed on every batch. Details:\n${providerErrors.join("\n")}`);
    }
    console.warn(
      `[analyzers] every batch failed transiently — continuing with empty analyzer buckets so downstream stages still run. Details:\n${providerErrors.join("\n")}`,
    );
  }
  if (providerErrors.length) {
    console.warn(`[analyzers] completed with ${providerErrors.length} failed batch(es); ${successes} succeeded`);
  }

  // ── Cross-batch synthesis pass ───────────────────────────────────────────
  // The per-batch loop above only ever shows the model ONE ~60K-char slice
  // of the corpus at a time. On any case whose corpus exceeds that budget,
  // a contradiction or finding that requires comparing two documents in
  // DIFFERENT batches is structurally invisible to every single batch call.
  // This pass fixes that generically: it builds a SHORT digest of every
  // document so many more documents fit in one call, and asks the model
  // specifically to find connections that span documents. Findings from
  // this pass flow into the SAME merged buckets, so they go through the
  // same dedupe + grounding/verification as everything else below.
  const SYNTHESIS_DIGEST_CHARS_PER_DOC = 700;
  const SYNTHESIS_BATCH_BUDGET_CHARS = 90_000;
  try {
    const digestChunks: CorpusChunk[] = chunks.map((c) => {
      const text = c.text.slice(0, SYNTHESIS_DIGEST_CHARS_PER_DOC);
      return { ...c, text, size: text.length };
    });
    const synthesisBatches = packChunks(digestChunks, SYNTHESIS_BATCH_BUDGET_CHARS);
    console.log(`[analyzers:synthesis] docs=${digestChunks.length} batches=${synthesisBatches.length}`);

    const synthesisSystem =
      `${analyzerPreamble}\n` +
      "You are a senior legal analyst doing a SECOND PASS over a case. You have already " +
      "seen detailed single-document analysis; now you are shown SHORT DIGESTS of every " +
      "document in the case side by side. Your ONLY job is to find contradictions, " +
      "corroborations, or connections that require comparing details from TWO OR MORE " +
      "DIFFERENT documents (names, dates, times, amounts, locations, descriptions that " +
      "conflict or confirm each other across documents). Do NOT report anything observable " +
      "from a single document alone. Every item MUST cite at least one verbatim quote " +
      "(<=200 chars) copied EXACTLY from the digest text below, with the source DOCUMENT " +
      "filename — if you cannot find an exact quote, do not include the finding. Output " +
      "STRICT JSON only.";

    const buildSynthesisPrompt = (digestText: string) =>
      `Return STRICT JSON. Every item MUST include an evidence_refs array of ` +
      `{ doc_id?: string, doc_n?: number, quote: string (verbatim, <=200 chars) }, ` +
      `citing AT LEAST TWO different documents where possible — that's the point of this pass.

{
  "contradictions": [ { "title": string, "description": string, "documents": string[], "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ],
  "missing_evidence": [ { "title": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ],
  "key_findings": [ { "title": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ]
}

DOCUMENT DIGESTS (short excerpts — full text was already analyzed in a prior pass; you are only cross-referencing):
${digestText}`;

    let synthesisIdx = 0;
    for (const batch of synthesisBatches) {
      synthesisIdx++;
      const digestText = batch.map((c) => c.text).join("\n\n");
      const t0 = Date.now();
      try {
        const r = await callGroq({
          apiKey,
          apiKeys,
          systemInstruction: synthesisSystem,
          userContent: buildSynthesisPrompt(digestText),
          json: true,
          temperature: 0.1,
        });
        await logUsage(db, {
          userId,
          caseId,
          operation: "analyze",
          model: r.model,
          provider: r.provider,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          totalTokens: r.totalTokens,
          latencyMs: r.latencyMs,
          success: true,
          keyIndex: r.keyIndex,
        });
        const parsed = parseJsonLoose<Record<string, unknown>>(r.text) ?? {};
        const pushSyn = (k: keyof AnalyzerBucket) => {
          const v = parsed[k];
          if (Array.isArray(v)) merged[k].push(...v);
        };
        pushSyn("contradictions");
        pushSyn("missing_evidence");
        pushSyn("key_findings");

        await db.from("pipeline_engine_runs").insert({
          case_id: caseId,
          user_id: userId,
          engine: "analyzers_batch",
          status: "completed",
          started_at: new Date(t0).toISOString(),
          ended_at: new Date().toISOString(),
          runtime_ms: Date.now() - t0,
          generated: 0,
          accepted: 0,
          rejected: 0,
          suppressed_ess: 0,
          suppressed_validator: 0,
          meta: {
            synthesis: true,
            synthesisBatchIdx: synthesisIdx,
            docs: batch.length,
            provider: r.provider,
          } as any,
        } as any);
      } catch (e) {
        // Additive pass — if it fails, the case still has everything the
        // per-batch pass found. Log and move on instead of failing the run.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[analyzers:synthesis] batch ${synthesisIdx} failed: ${msg.slice(0, 300)}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[analyzers:synthesis] pass skipped due to setup error: ${msg.slice(0, 300)}`);
  }

  // De-dupe merged arrays by (title|description) fingerprint to prevent
  // near-duplicate findings from overlapping batches.
  const dedupe = <T extends Record<string, unknown>>(items: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const it of items) {
      const key = `${String(it.title ?? "")
        .trim()
        .toLowerCase()}::${String(it.description ?? "")
        .trim()
        .slice(0, 120)
        .toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  };
  const a: Record<string, unknown> = {
    timeline: merged.timeline,
    contradictions: dedupe(merged.contradictions as Record<string, unknown>[]),
    missing_evidence: dedupe(merged.missing_evidence as Record<string, unknown>[]),
    procedural_issues: dedupe(merged.procedural_issues as Record<string, unknown>[]),
    evidence_relationships: merged.evidence_relationships,
    key_findings: dedupe(merged.key_findings as Record<string, unknown>[]),
  };

  const { data: docsForGround } = await db
    .from("documents")
    .select("id,filename,extracted_text")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const { buildGroundingCorpus, groundItems } = await import("./intelligence/grounding.server");
  const groundCorpus = buildGroundingCorpus(
    (docsForGround ?? []).map((d) => ({
      id: d.id as string,
      filename: d.filename,
      extracted_text: d.extracted_text,
    })),
  );
  const groundCat = <T extends Record<string, unknown>>(items: T[]) =>
    groundItems(items, groundCorpus, { minVerified: 1 });

  await db.from("analyses").upsert(
    {
      case_id: caseId,
      user_id: userId,
      timeline: (a.timeline ?? null) as J,
      contradictions: (a.contradictions ?? null) as J,
      missing_evidence: (a.missing_evidence ?? null) as J,
      procedural_issues: (a.procedural_issues ?? null) as J,
      evidence_relationships: (a.evidence_relationships ?? null) as J,
      key_findings: (a.key_findings ?? null) as J,
    },
    { onConflict: "case_id" },
  );

  await clearFindingsByModule(db, caseId, "analyzer:");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr = (k: string): any[] => (Array.isArray(a[k]) ? (a[k] as any[]) : []);
  const rawContradictions = arr("contradictions");
  const rawMissing = arr("missing_evidence");
  const rawProcedural = arr("procedural_issues");
  const rawKey = arr("key_findings");
  const groundedContradictions = groundCat(rawContradictions);
  const groundedMissing = groundCat(rawMissing);
  const groundedProcedural = groundCat(rawProcedural);
  const groundedKey = groundCat(rawKey);
  const analyzerRowsRaw = [
    ...normalizeLlmFindings({
      caseId,
      userId,
      sourceModule: "analyzer:contradiction",
      defaultCategory: "contradiction",
      items: groundedContradictions,
    }),
    ...normalizeLlmFindings({
      caseId,
      userId,
      sourceModule: "analyzer:missing",
      defaultCategory: "missing_evidence",
      items: groundedMissing,
    }),
    ...normalizeLlmFindings({
      caseId,
      userId,
      sourceModule: "analyzer:procedural",
      defaultCategory: "procedural",
      items: groundedProcedural,
    }),
    ...normalizeLlmFindings({
      caseId,
      userId,
      sourceModule: "analyzer:key",
      defaultCategory: "strength",
      items: groundedKey,
    }),
  ];
  // Practice-area filter: drop findings whose category resolves to a domain
  // not allowed for this case type (belt-and-braces if the LLM ignored the
  // case-type preamble and emitted e.g. a "miranda" key_finding on a civil
  // case). source_module wrappers like "analyzer:*" carry no domain, so we
  // re-key the gate on the category token.
  const analyzerRows = analyzerRowsRaw.filter((row) =>
    isFindingAllowed(analyzerArea, `analyzer:${String(row.category ?? "")}`, analyzerDomains),
  );
  // FIX (2026-07-29): missing_evidence findings are absence-of-evidence
  // claims by nature ("this document should exist in the corpus but
  // doesn't") — they structurally cannot carry a verbatim supporting
  // quote the same way a contradiction or key finding can. Passing the
  // whole combined batch through addGatedFindings() with no
  // exemptCitation meant every missing_evidence item that lacked a
  // literal quotable passage was silently dropped by the citation gate
  // (the "else: dropped by strict/balanced gate" branch), even though its
  // own sub-engine stats reported it as "accepted" — confirmed via a
  // real case where analyzer_discovery_gaps reported 3 accepted but zero
  // analyzer:missing rows existed in case_findings afterward. Splitting
  // the gate call so missing_evidence gets the same AI_THEORY-tagged
  // exemption addGatedFindings already supports for exactly this
  // evidentiary shape (see findings.server.ts's addGatedFindings
  // comment: "discovery-gap, trial risk/strength").
  const missingRows = analyzerRows.filter((row) => String(row.category ?? "") === "missing_evidence");
  const otherRows = analyzerRows.filter((row) => String(row.category ?? "") !== "missing_evidence");
  const otherGate = await addGatedFindings(db, caseId, otherRows);
  const missingGate = await addGatedFindings(db, caseId, missingRows, { exemptCitation: true });
  const analyzerGate = {
    inserted: otherGate.inserted + missingGate.inserted,
    mode: otherGate.mode,
    corpus: otherGate.corpus,
    audit:
      otherGate.audit && missingGate.audit
        ? {
            ...otherGate.audit,
            input: (otherGate.audit.input ?? 0) + (missingGate.audit.input ?? 0),
            accepted: (otherGate.audit.accepted ?? 0) + (missingGate.audit.accepted ?? 0),
            rejections: [...(otherGate.audit.rejections ?? []), ...(missingGate.audit.rejections ?? [])],
          }
        : (otherGate.audit ?? missingGate.audit),
  };
  console.log(
    "[analyzers] evidence-gate audit",
    analyzerGate.audit,
    "practice_area_filtered",
    analyzerRowsRaw.length - analyzerRows.length,
  );

  // Emit per-sub-engine audit rows so the dashboard shows every engine that
  // contributed findings, not just the umbrella "analyzers" step.
  const subRow = (engine: string, raw: unknown[], grounded: unknown[]) => ({
    case_id: caseId,
    user_id: userId,
    engine,
    status: "completed" as const,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    runtime_ms: 0,
    generated: raw.length,
    accepted: grounded.length,
    rejected: Math.max(0, raw.length - grounded.length),
    suppressed_ess: 0,
    suppressed_validator: 0,
    meta: {} as never,
  });
  await db
    .from("pipeline_engine_runs")
    .insert([
      subRow("fact_extraction", rawKey, groundedKey),
      subRow("analyzer_contradictions", rawContradictions, groundedContradictions),
      subRow("analyzer_discovery_gaps", rawMissing, groundedMissing),
      subRow("analyzer_evidence_intelligence", rawProcedural, groundedProcedural),
    ]);

  await setCase(db, caseId, {
    status: "analyzed",
    status_message: "Analyzers complete",
    progress: 100,
    analysis_at: new Date().toISOString(),
  });
  return {
    value: undefined,
    stats: {
      generated: analyzerRows.length,
      accepted: analyzerGate.inserted,
      rejected: Math.max(0, analyzerRows.length - analyzerGate.inserted),
      meta: {
        evidence_gate: {
          mode: analyzerGate.mode,
          audit: analyzerGate.audit,
          corpus: analyzerGate.corpus,
          practice_area_filtered: analyzerRowsRaw.length - analyzerRows.length,
        },
      },
    },
  };
}

// ===== STEP 3: Agents (specialized investigators in parallel) =====
const AGENTS: { type: string; category: string; system: string; prompt: string }[] = [
  {
    type: "witness_credibility",
    category: "witness",
    system:
      "You are a witness credibility investigator. Examine statements for consistency, motive, bias, and corroboration. Output JSON only. EVERY finding MUST be grounded in a verbatim quote from the corpus and cite the source document — if you cannot ground a finding, DO NOT emit it.",
    prompt: `Return STRICT JSON. EVERY item in findings MUST include evidence_refs with at least one { doc_n (matching the corpus document number), quote (verbatim from that document, <=200 chars) } entry. Do NOT emit any finding you cannot ground in a verbatim quote — omit it entirely.
{ "summary": string, "confidence": number (0-1),
  "findings": [ { "title": string, "subject": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": "parte_actora"|"parte_demandada"|"ambas", "evidence_refs": [ { "doc_n": number, "quote": string } ] } ] }`,
  },
  {
    type: "chain_of_custody",
    category: "chain_of_custody",
    system:
      "You are a chain-of-custody investigator. Examine evidence handling for gaps, breaks, and documentation failures. Output JSON only. EVERY finding MUST be grounded in a verbatim quote from the corpus and cite the source document — if you cannot ground a finding, DO NOT emit it.",
    prompt: `Return STRICT JSON. EVERY item in findings MUST include evidence_refs with at least one { doc_n (matching the corpus document number), quote (verbatim from that document, <=200 chars) } entry. Do NOT emit any finding you cannot ground in a verbatim quote — omit it entirely.
{ "summary": string, "confidence": number (0-1),
  "findings": [ { "title": string, "item": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": "parte_actora"|"parte_demandada"|"ambas", "evidence_refs": [ { "doc_n": number, "quote": string } ] } ] }`,
  },
  {
    type: "constitutional_compliance",
    category: "constitutional",
    system:
      // REBUILT 2026-07-29: previously instructed the model to search for
      // "4th/5th/6th Amendment issues, Miranda, search/seizure, due
      // process" — U.S. constitutional doctrine with no standing in a
      // Mexican proceeding. This platform is built exclusively for
      // Mexican law. Rebuilt around CPEUM arts. 14, 16, 19, 20.
      "You are a Mexican constitutional-rights investigator (CPEUM). Examine for violations of Art. 16 (cateo, detención, control judicial), Art. 19 (plazo constitucional, auto de vinculación a proceso), and Art. 20 apartados A/B/C (debido proceso, presunción de inocencia, derecho de defensa adecuada, derecho a guardar silencio, derechos de la víctima). Output JSON only. EVERY finding MUST be grounded in a verbatim quote from the corpus and cite the source document — if you cannot ground a finding, DO NOT emit it.",
    prompt: `Return STRICT JSON. EVERY item in findings MUST include evidence_refs with at least one { doc_n (matching the corpus document number), quote (verbatim from that document, <=200 chars) } entry. Do NOT emit any finding you cannot ground in a verbatim quote — omit it entirely.
{ "summary": string, "confidence": number (0-1),
  "findings": [ { "title": string, "right": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": "parte_actora"|"parte_demandada"|"ambas", "evidence_refs": [ { "doc_n": number, "quote": string } ] } ] }`,
  },
  {
    type: "procedural_violations",
    category: "procedural",
    system:
      // REBUILT 2026-07-29: previously instructed the model to search for
      // "FRCP/FRCrP/local rule violations" — U.S. Federal Rules of Civil/
      // Criminal Procedure, inapplicable to a CNPP/CFPC proceeding.
      "You are a Mexican procedural-rules investigator. Examine for violations of the CNPP (materia penal) or the Código Federal de Procedimientos Civiles / código procesal local aplicable (materia civil, mercantil, familiar), including plazos vencidos, defectos de notificación o emplazamiento, y omisiones en la carpeta de investigación. Output JSON only. EVERY finding MUST be grounded in a verbatim quote from the corpus and cite the source document — if you cannot ground a finding, DO NOT emit it.",
    prompt: `Return STRICT JSON. EVERY item in findings MUST include evidence_refs with at least one { doc_n (matching the corpus document number), quote (verbatim from that document, <=200 chars) } entry. Do NOT emit any finding you cannot ground in a verbatim quote — omit it entirely.
{ "summary": string, "confidence": number (0-1),
  "findings": [ { "title": string, "rule": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": "parte_actora"|"parte_demandada"|"ambas", "evidence_refs": [ { "doc_n": number, "quote": string } ] } ] }`,
  },
];

// Map agent.type → engine key persisted in pipeline_engine_runs.
//
// FIX (2026-07-30): `witness_credibility` used to persist as
// "witness_intelligence" — the SAME engine key as the independent canonical
// witness stage (execution/canonical.ts). Because STAGE_KEY_ALIASES maps that
// engine to the `witness` stage, the nested agent's run row rendered in the
// ledger as a top-level "Inteligencia de Testigos" stage executing during
// "Agentes de Verificación", and on materias where the witness stage is
// legally excluded (amparo, apelación, inmobiliario) it collided with that
// stage's OMITIDO skip row — the case appeared to both skip and run witness
// intelligence. The agent now owns a distinct namespaced key. The other three
// agent engines are NOT canonical stages, so they never had this collision.
const AGENT_ENGINE: Record<string, string> = {
  witness_credibility: "agent:witness_credibility",
  chain_of_custody: "chain_of_custody",
  constitutional_compliance: "constitutional_compliance",
  procedural_violations: "procedural_violations",
};

/**
 * How many investigator agents may execute simultaneously inside the "agents"
 * stage.
 *
 * The four agents (witness_credibility, chain_of_custody,
 * constitutional_compliance, procedural_violations) are genuinely independent:
 * each one's only input is the shared corpus plus its own system/user prompt.
 * None reads another's agent_findings, summary, or confidence, so ordering is
 * a scheduling choice, not a correctness constraint.
 *
 * 2026-07-30: raised 1 → 2. At 1, a 9-chunk corpus needed ~36 sequential Groq
 * calls; measured wall clock was ~15-20 min for ~5 min of actual AI time —
 * the rest was inter-tick stalls. 2 halves the tick count while holding the
 * in-flight token rate at 2x rather than 4x, which matters because the shared
 * Groq/Gemini key pool is the binding constraint, not CPU.
 *
 * ROLLBACK: set this back to 1. That is the complete revert — there is no
 * migration, no persisted state, and no schema tied to the value. Agent
 * results are checkpointed per batch in pipeline_engine_runs, and resume keys
 * off agent_findings.status, both of which are concurrency-agnostic; a case
 * that ran part-way at 2 resumes correctly at 1 and vice versa. The only
 * artifact left behind is pipeline_trace instrumentation rows, which are
 * append-only diagnostics.
 */
const AGENT_CONCURRENCY = 2;

export async function runAgents(args: { db: Db; caseId: string; userId: string; apiKey: string; apiKeys?: string[] }) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, {
    status: "agents_running",
    status_message: "Dispatching agents",
    progress: 10,
  });

  // Resume support: preserve rows for agents that already completed on a
  // previous worker tick. Only wipe engine rows / agent_findings for agents
  // that haven't finished yet, so a checkpointed re-entry doesn't re-run
  // work that's already persisted.
  const { data: prevAgentRows } = await db.from("agent_findings").select("agent_type,status").eq("case_id", caseId);
  const completedAgentTypes = new Set(
    (prevAgentRows ?? [])
      .filter((r) => (r as { status?: string }).status === "complete")
      .map((r) => String((r as { agent_type?: string }).agent_type)),
  );
  const completedEngines = Array.from(completedAgentTypes).map(
    (t) => AGENT_ENGINE[t as keyof typeof AGENT_ENGINE] ?? t,
  );
  const engineWipeList = ["agents", ...Object.values(AGENT_ENGINE)].filter((e) => !completedEngines.includes(e));
  if (engineWipeList.length > 0) {
    await db.from("pipeline_engine_runs").delete().eq("case_id", caseId).in("engine", engineWipeList);
  }

  return runEngine(db, { caseId, userId, engine: "agents" }, async () => {
    const { corpus, chunks } = await buildCorpus(db, caseId);
    if (!corpus) throw new Error("No extracted documents. Run Extraction first.");

    // PRACTICE-AREA GATE: Only dispatch agents whose engine is allowed for
    // this case type + active cross-domain activations. Skipped agents are
    // recorded in pipeline_engine_runs so the manifest/audit shows them as
    // intentionally-skipped (not silently missing).
    const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE, isFindingAllowed } =
      await import("./intelligence/practice-areas");
    const { getActiveDomains } = await import("./intelligence/cross-domain.server");
    const { recordSkipped } = await import("./intelligence/engine-audit.server");

    const { data: caseRow } = await db
      .from("cases")
      .select("case_type" as any)
      .eq("id", caseId)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const area = String((caseRow as any)?.case_type ?? "general_civil");
    const activeDomains = await getActiveDomains(db, caseId);

    const activeAgents: typeof AGENTS = [];
    for (const agent of AGENTS) {
      const engine = AGENT_ENGINE[agent.type] ?? agent.type;
      if (isAnalyzerAllowed(area, engine, activeDomains)) {
        activeAgents.push(agent);
      } else {
        await recordSkipped(db, {
          caseId,
          userId,
          engine: engine as never,
          reason: SKIP_REASON_NOT_APPLICABLE,
        });
      }
    }

    // Reset prior agent rows only for agents we're about to actually run.
    // Rows for agents that already completed on a prior tick are preserved
    // so a checkpointed resume doesn't wipe finished work. Finding rows
    // scoped `agent:<type>:` are cleared per-agent inside runOneAgent just
    // before that agent writes fresh output.
    const agentsToRun = activeAgents.filter((a) => !completedAgentTypes.has(a.type));
    const agentTypesToRun = agentsToRun.map((a) => a.type);
    if (agentTypesToRun.length > 0) {
      assertDbOk(
        (await db.from("agent_findings").delete().eq("case_id", caseId).in("agent_type", agentTypesToRun)).error,
        "Failed to clear previous agent runs",
      );
      for (const t of agentTypesToRun) {
        await clearFindingsByModule(db, caseId, `agent:${t}`);
      }
    }

    // Practice-area context for every agent prompt so the LLM doesn't invent
    // off-domain findings (e.g. Miranda on a contract dispute).
    const { PRACTICE_AREA_LABELS, normalizePracticeArea } = await import("./intelligence/practice-areas");
    const areaLabel = PRACTICE_AREA_LABELS[normalizePracticeArea(area)];
    const areaPreamble =
      `${mexicoLock(await getReportLocale(db, caseId))}\n` +
      `CASE TYPE: ${areaLabel} (${area}). ` +
      `Only surface findings whose legal theory is applicable to a ${areaLabel} matter. ` +
      `Do NOT manufacture findings from other practice areas. ` +
      `Do NOT infer missing procedural facts (service of process, deadlines, custody chains) ` +
      `that are not affirmatively established by a verbatim quote in the corpus. ` +
      `If the corpus does not establish a fact, omit the finding.`;

    // Grounding corpus for agents that require verbatim citation (currently
    // only chain_of_custody — every other agent is untouched per directive).
    const { data: docsForAgentGround } = await db
      .from("documents")
      .select("id,filename,extracted_text")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    const { buildGroundingCorpus, groundItems } = await import("./intelligence/grounding.server");
    const agentGroundCorpus = buildGroundingCorpus(
      (docsForAgentGround ?? []).map((d) => ({
        id: d.id as string,
        filename: d.filename,
        extracted_text: d.extracted_text,
      })),
    );

    // Checkpoint budget: yield mid-stage so a large-corpus run can resume on
    // the next worker tick instead of stranding the case at agents_running
    // if the worker invocation hits its own execution time limit.
    const { budgetFor: _agentBudgetFor, CheckpointRequired: _AgentCheckpoint } =
      await import("./pipeline-checkpoint.server");
    const agentBudgetMs = _agentBudgetFor("agents");
    const agentStageStart = Date.now();

    // ---- Concurrency experiment instrumentation (2026-07-30) ------------
    // Raising AGENT_CONCURRENCY only pays off if wall-clock drops WITHOUT the
    // 429/cooldown burden growing to match. Wall clock alone can improve while
    // the same total delay is merely redistributed into more-frequent, shorter
    // stalls — that is not a win. So we record, per tick: the gap since the
    // previous tick's last batch (the stall we actually paid), every cooldown
    // checkpoint, and at stage end a rollup of events + total stalled ms
    // against total AI ms. All of it lands in pipeline_trace under
    // phase "stage" with step prefix "agents_", queryable per case and comparable across runs.
    const { trace: _agentTrace } = await import("./pipeline-trace.server");
    const { data: _lastBatchRow } = await db
      .from("pipeline_engine_runs")
      .select("ended_at" as any)
      .eq("case_id", caseId)
      .like("engine", "%_batch")
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _lastEnd = (_lastBatchRow as any)?.ended_at ? Date.parse((_lastBatchRow as any).ended_at) : null;
    const resumeGapMs = _lastEnd && Number.isFinite(_lastEnd) ? Math.max(0, agentStageStart - _lastEnd) : 0;
    if (resumeGapMs > 0) {
      await _agentTrace({
        db,
        caseId,
        userId,
        phase: "stage",
        step: "agents_tick_resume_gap",
        status: "info",
        durationMs: resumeGapMs,
        detail: { concurrency: AGENT_CONCURRENCY, resumed_agents: completedAgentTypes.size },
      });
    }

    let done = completedAgentTypes.size;
    const totalAgentCount = activeAgents.length;
    const failures: string[] = [];
    let totalGenerated = 0;
    let totalAccepted = 0;

    const runOneAgent = async (agent: (typeof AGENTS)[number]) => {
      const engine = AGENT_ENGINE[agent.type] ?? agent.type;
      const t0 = Date.now();
      try {
        // We call runEngine for each agent so they show up individually.
        // We also collect stats for the collective "agents" row.
        await runEngine(db, { caseId, userId, engine }, async () => {
          // BATCHED EXECUTION: reuse the analyzer packing so each agent
          // processes the FULL corpus in payload-safe chunks instead of a
          // single 180K-char slice that (a) blows past Groq's per-request TPM
          // cap and (b) silently drops every document past the truncation.
          const { packingCharBudget: agentBudgetFn, PROMPT_OVERHEAD_CHARS: AGENT_OVERHEAD } =
            await import("@/lib/ai/router.server");
          const agentBatches = packChunks(
            chunks,
            await agentBudgetFn(ANALYZER_CORPUS_BUDGET_CHARS, AGENT_OVERHEAD.agents),
          );
          const batchEngine = `${engine}_batch`;
          const batchKey = (batch: CorpusChunk[]) =>
            batch
              .map((c) => `${c.docId}:${c.index}:${c.size}:${c.text.slice(0, 24)}`)
              .sort()
              .join("|");

          type AgentBatchMeta = {
            batchKey?: string;
            docIds?: string[];
            findings?: unknown[];
            summary?: string;
            confidence?: number;
            provider?: string;
          };
          const { data: priorAgentBatchRuns } = await db
            .from("pipeline_engine_runs")
            .select("meta,status" as any)
            .eq("case_id", caseId)
            .eq("engine", batchEngine);
          const completedBatchKeys = new Set<string>();
          const priorBatchMetas: AgentBatchMeta[] = [];
          for (const row of (priorAgentBatchRuns ?? []) as unknown as Array<{
            status: string;
            meta: AgentBatchMeta | null;
          }>) {
            if (row.status !== "completed" || !Array.isArray(row.meta?.docIds)) continue;
            completedBatchKeys.add(row.meta.batchKey ?? row.meta.docIds.slice().sort().join("|"));
            priorBatchMetas.push(row.meta);
          }

          console.log(
            `[agent:${agent.type}] docs=${chunks.length} totalChars=${corpus.length} batches=${agentBatches.length} resumed=${priorBatchMetas.length}`,
          );
          const queue: CorpusChunk[][] = agentBatches.filter((batch) => !completedBatchKeys.has(batchKey(batch)));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mergedFindings: any[] = priorBatchMetas.flatMap((m) =>
            Array.isArray(m.findings) ? (m.findings as any[]) : [],
          );
          const summaries: string[] = priorBatchMetas
            .map((m) => (typeof m.summary === "string" ? m.summary.trim() : ""))
            .filter(Boolean);
          const confidences: number[] = priorBatchMetas
            .map((m) => m.confidence)
            .filter((n): n is number => typeof n === "number");
          const batchErrors: string[] = [];
          let batchIdx = 0;
          let successes = priorBatchMetas.length;
          let lastModel = MODEL;
          while (queue.length) {
            batchIdx++;
            const batch = queue.shift()!;
            const key = batchKey(batch);
            if (completedBatchKeys.has(key)) continue;
            const batchCorpus = batch.map((c) => c.text).join("\n\n");
            const bt0 = Date.now();
            try {
              const r = await callGroq({
                apiKey,
                apiKeys,
                systemInstruction: `${areaPreamble}\n${agent.system}`,
                userContent: `${agent.prompt}\n\nCASE CORPUS:\n${batchCorpus}`,
                json: true,
                temperature: 0.15,
              });
              lastModel = r.model;
              await logUsage(db, {
                userId,
                caseId,
                operation: `agent:${agent.type}`,
                model: r.model,
                provider: r.provider,
                inputTokens: r.inputTokens,
                outputTokens: r.outputTokens,
                totalTokens: r.totalTokens,
                latencyMs: r.latencyMs,
                success: true,
                keyIndex: r.keyIndex,
              });

              const parsed = parseJsonLoose<{ summary?: string; confidence?: number; findings?: any[] }>(r.text) ?? {};
              if (Array.isArray(parsed.findings)) mergedFindings.push(...parsed.findings);
              if (typeof parsed.summary === "string" && parsed.summary.trim()) summaries.push(parsed.summary.trim());
              if (typeof parsed.confidence === "number") confidences.push(parsed.confidence);
              assertDbOk(
                (
                  await db.from("pipeline_engine_runs").insert({
                    case_id: caseId,
                    user_id: userId,
                    engine: batchEngine,
                    status: "completed",
                    started_at: new Date(bt0).toISOString(),
                    ended_at: new Date().toISOString(),
                    runtime_ms: Date.now() - bt0,
                    generated: Array.isArray(parsed.findings) ? parsed.findings.length : 0,
                    accepted: Array.isArray(parsed.findings) ? parsed.findings.length : 0,
                    rejected: 0,
                    suppressed_ess: 0,
                    suppressed_validator: 0,
                    meta: {
                      agent_type: agent.type,
                      batchIdx,
                      batchKey: key,
                      docs: batch.length,
                      chars: batchCorpus.length,
                      docIds: batch.map((c) => c.docId),
                      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 4000) : null,
                      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
                      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
                      provider: r.provider,
                    } as any,
                  } as any)
                ).error,
                `Failed to save ${agent.type} agent batch checkpoint`,
              );
              completedBatchKeys.add(key);
              successes++;
            } catch (be) {
              rethrowIfCheckpoint(be);
              const bmsg = be instanceof Error ? be.message : String(be);
              const payloadTooLarge = isPayloadTooLargeError(bmsg);
              const providerUnavailable = isProviderUnavailableError(bmsg);
              const retryableTransport = isRetryableTransportError(bmsg);
              const nonRetryable = isAuthProviderError(bmsg);
              console.warn(
                `[agent:${agent.type}] batch ${batchIdx} failed (payload=${payloadTooLarge} providerUnavailable=${providerUnavailable} transport=${retryableTransport}) chars=${batchCorpus.length}: ${bmsg.slice(0, 300)}`,
              );
              await logUsage(db, {
                userId,
                caseId,
                operation: `agent:${agent.type}`,
                model: MODEL,
                latencyMs: Date.now() - bt0,
                success: false,
                error: bmsg,
              });
              if (payloadTooLarge && !nonRetryable && batch.length > 1) {
                const mid = Math.ceil(batch.length / 2);
                queue.unshift(batch.slice(0, mid), batch.slice(mid));
                continue;
              }
              if (payloadTooLarge && !nonRetryable && batch.length === 1 && batch[0].size > ANALYZER_MIN_BATCH_CHARS) {
                const halves = splitOversizeChunk(batch[0]);
                if (halves.length > 1) {
                  queue.unshift(...halves.map((h) => [h]));
                  continue;
                }
              }
              batchErrors.push(`batch ${batchIdx}: ${bmsg.slice(0, 200)}`);
              if (isGroqCooldownOrRateLimit(bmsg)) {
                const { CheckpointRequired } = await import("./pipeline-checkpoint.server");
                console.warn(
                  `[agent:${agent.type}] Groq cooldown/rate limit reached; yielding for worker retry instead of failing case`,
                );
                // Instrumented so cooldown COUNT can be compared across
                // concurrency settings, not just total wall clock. More
                // frequent short stalls at the same total delay is a null
                // result, and only this row makes that visible.
                await _agentTrace({
                  db,
                  caseId,
                  userId,
                  phase: "stage",
                  step: "agents_cooldown_checkpoint",
                  status: "warn",
                  durationMs: Date.now() - t0,
                  detail: {
                    concurrency: AGENT_CONCURRENCY,
                    agent: agent.type,
                    batches_done: successes,
                    message: bmsg.slice(0, 300),
                  },
                });
                throw new CheckpointRequired(
                  "agents",
                  `${agent.type} after ${successes} successful batch(es) — ${bmsg.slice(0, 300)}`,
                );
              }
              if (providerUnavailable || retryableTransport) {
                console.warn(
                  `[agent:${agent.type}] stopping remaining batches after provider/capacity failure to avoid repeated AI spend`,
                );
                break;
              }
            }
          }
          if (successes === 0) {
            const providerBlocked =
              batchErrors.some(isProviderUnavailableError) || batchErrors.some(isRetryableTransportError);
            if (!providerBlocked) {
              throw new Error(`Agent ${agent.type} failed on every batch. ${batchErrors.join(" | ")}`);
            }
          }
          const parsed = {
            summary:
              successes === 0
                ? `Agent pass suppressed: AI providers were unavailable or out of quota during this run. No uncited findings were generated.`
                : summaries.join(" ").slice(0, 4000),
            confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
            findings: mergedFindings,
          };
          const generated = Array.isArray(parsed.findings) ? parsed.findings.length : 0;
          // Chain-of-custody grounding gate: every finding must carry a
          // verbatim quote traceable to a specific document in the corpus.
          // Findings that fail grounding are dropped BEFORE persistence so
          // the report quality gate isn't blocked by uncited items.
          //
          // groundingDropped is computed BEFORE the agent_findings upsert
          // (reordered from the original single-pass version) so the drop
          // count can be persisted on the same row, instead of being known
          // only after the row was already written. A dimension backed by
          // this agent showing 0 contributors must be distinguishable from
          // "verified clean" vs. "verification failed and everything was
          // thrown away" — that distinction lived only in a log line before.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let findingsForNormalize: any[] = Array.isArray(parsed.findings) ? parsed.findings : [];
          let groundingDropped = 0;
          if (agent.type === "chain_of_custody") {
            const before = findingsForNormalize.length;
            findingsForNormalize = groundItems(findingsForNormalize, agentGroundCorpus, {
              minVerified: 1,
            });
            groundingDropped = before - findingsForNormalize.length;
            if (before > 0 && findingsForNormalize.length === 0) {
              console.warn(
                `[grounding-gate] case=${caseId} agent=${agent.type} dropped ALL ${before} findings — ` +
                  `no verbatim quote could be grounded. This dimension will show 0 contributors, ` +
                  `which must not be read as "clean record."`,
              );
            }
          }
          void lastModel;
          assertDbOk(
            (
              await db.from("agent_findings").upsert(
                {
                  case_id: caseId,
                  user_id: userId,
                  agent_type: agent.type,
                  status: "complete",
                  summary: parsed.summary ?? "",
                  confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
                  findings: (parsed.findings ?? []) as J,
                  latency_ms: Date.now() - t0,
                  error: null,
                  grounding_dropped_count: groundingDropped,
                },
                { onConflict: "case_id,agent_type" },
              )
            ).error,
            `Failed to save ${agent.type} agent result`,
          );
          // Practice-area finding filter: drop findings whose source_module
          // domain token is forbidden for this case type. Belt-and-braces in
          // case the LLM ignores the preamble.
          const normalizedRows = normalizeLlmFindings({
            caseId,
            userId,
            sourceModule: `agent:${agent.type}`,
            defaultCategory: agent.category,
            items: findingsForNormalize,
          });
          const allowedRows = normalizedRows.filter(
            (row) =>
              isFindingAllowed(area, row.source_module ?? `agent:${agent.type}`, activeDomains) &&
              isFindingAllowed(area, `agent:${String(row.category ?? agent.category)}`, activeDomains),
          );
          const gate = await addGatedFindings(db, caseId, allowedRows);
          const accepted = gate.audit?.accepted ?? allowedRows.length;
          totalGenerated += generated;
          totalAccepted += accepted;
          return {
            value: undefined,
            stats: {
              generated,
              accepted,
              rejected: Math.max(0, generated - accepted),
              meta: {
                evidence_gate: {
                  mode: gate.mode,
                  audit: gate.audit,
                  corpus: gate.corpus,
                  practice_area_filtered: normalizedRows.length - allowedRows.length,
                },
              },
            },
          };
        });
      } catch (e) {
        rethrowIfCheckpoint(e);
        const msg = e instanceof Error ? e.message : String(e);
        assertDbOk(
          (
            await db.from("agent_findings").upsert(
              {
                case_id: caseId,
                user_id: userId,
                agent_type: agent.type,
                status: "failed",
                error: msg,
                latency_ms: Date.now() - t0,
              },
              { onConflict: "case_id,agent_type" },
            )
          ).error,
          `Failed to save ${agent.type} agent failure`,
        );
        await logUsage(db, {
          userId,
          caseId,
          operation: `agent:${agent.type}`,
          model: MODEL,
          latencyMs: Date.now() - t0,
          success: false,
          error: msg,
        });
        failures.push(`${agent.type}: ${msg}`);
      }
      done += 1;
      await setCase(db, caseId, {
        status_message: `Agents ${done}/${totalAgentCount} complete`,
        progress: 10 + Math.floor((done / Math.max(1, totalAgentCount)) * 90),
      });
    };

    // Bounded-concurrency runner: cap simultaneous agent execution so a
    // large corpus doesn't fan out into dozens of parallel Groq calls that
    // collectively saturate the org-wide TPM quota and trigger cascading
    // 429s. Between agents we check the stage wall-clock budget and yield
    // via CheckpointRequired so an oversized run resumes on the next tick
    // instead of being killed mid-flight.
    // Concurrency is the module-level AGENT_CONCURRENCY constant — flipping
    // it back to 1 is the entire rollback (see its declaration).
    let queueIdx = 0;
    let checkpointNeeded = false;
    const startingDone = completedAgentTypes.size;
    const workers = Array.from({ length: Math.min(AGENT_CONCURRENCY, agentsToRun.length) }, async () => {
      while (!checkpointNeeded) {
        const myIdx = queueIdx++;
        if (myIdx >= agentsToRun.length) break;
        await runOneAgent(agentsToRun[myIdx]);
        // Yield only if (i) at least one agent has completed THIS tick (so
        // we're making forward progress a resume can build on) and (ii) work
        // remains. Avoids a livelock where the very first agent overruns the
        // budget and every resume re-throws before anything new commits.
        if (done < totalAgentCount && done > startingDone && Date.now() - agentStageStart > agentBudgetMs) {
          checkpointNeeded = true;
          break;
        }
      }
    });
    await Promise.all(workers);

    if (checkpointNeeded && done < totalAgentCount) {
      throw new _AgentCheckpoint("agents", `${done}/${totalAgentCount} agents complete`);
    }

    if (failures.length > 0) {
      const error = failures.join("; ").slice(0, 2000);
      await setCase(db, caseId, {
        status: "failed",
        status_message: `${failures.length}/${activeAgents.length} agents failed`,
        progress: 100,
        error,
      });
      throw new Error(error);
    }

    // Stage rollup: the comparison row. wall_ms is the honest end-to-end
    // duration (first batch start → now, including every stall); ai_ms is the
    // summed provider time. cooldown_events / cooldown_stall_ms are the
    // guardrail — if wall_ms drops but these rise proportionally, concurrency
    // 2 only redistributed the delay and should be reverted to 1.
    try {
      const { data: _batchRows } = await db
        .from("pipeline_engine_runs")
        .select("runtime_ms,started_at" as any)
        .eq("case_id", caseId)
        .like("engine", "%_batch");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _rows = (_batchRows ?? []) as any[];
      const aiMs = _rows.reduce((a, r) => a + (Number(r.runtime_ms) || 0), 0);
      const firstStart = _rows
        .map((r) => Date.parse(String(r.started_at)))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)[0];
      const { data: _traceRows } = await db
        .from("pipeline_trace")
        .select("step,duration_ms" as any)
        .eq("case_id", caseId)
        .eq("phase", "stage")
        .in("step", ["agents_cooldown_checkpoint", "agents_tick_resume_gap"]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _tr = (_traceRows ?? []) as any[];
      const cooldownEvents = _tr.filter((r) => r.step === "agents_cooldown_checkpoint").length;
      const stallMs = _tr
        .filter((r) => r.step === "agents_tick_resume_gap")
        .reduce((a, r) => a + (Number(r.duration_ms) || 0), 0);
      const wallMs = firstStart ? Date.now() - firstStart : Date.now() - agentStageStart;
      await _agentTrace({
        db,
        caseId,
        userId,
        phase: "stage",
        step: "agents_concurrency_metrics",
        status: "info",
        durationMs: wallMs,
        detail: {
          concurrency: AGENT_CONCURRENCY,
          agents: totalAgentCount,
          batches: _rows.length,
          ai_ms: aiMs,
          wall_ms: wallMs,
          cooldown_events: cooldownEvents,
          cooldown_stall_ms: stallMs,
          overhead_pct: wallMs > 0 ? Math.round(((wallMs - aiMs) / wallMs) * 100) : null,
        },
      });
    } catch {
      // Instrumentation must never fail the stage.
    }

    await setCase(db, caseId, {
      status: "agents_complete",
      status_message: "Agents complete",
      progress: 100,
      agents_at: new Date().toISOString(),
    });
    return { value: undefined, stats: { generated: totalGenerated, accepted: totalAccepted } };
  });
}

// ===== STEP 4: Scoring (explainable, sources from unified findings) =====
export async function runScoring(args: { db: Db; caseId: string; userId: string; apiKey: string; apiKeys?: string[] }) {
  const { db, caseId, userId } = args;
  await setCase(db, caseId, {
    status: "scoring",
    status_message: "Computing explainable scorecard",
    progress: 30,
  });
  await db.from("pipeline_engine_runs").delete().eq("case_id", caseId).eq("engine", "scoring");
  return runEngine(db, { caseId, userId, engine: "scoring" }, async () => _runScoringInner(args));
}

async function _runScoringInner(args: { db: Db; caseId: string; userId: string; apiKey: string; apiKeys?: string[] }) {
  const { db, caseId, userId, apiKey, apiKeys } = args;

  // SINGLE SOURCE OF TRUTH: canonical finding selection (engine:* only,
  // pipeline must be finalized). Shared with the report generator.
  const { getCanonicalScoringFindings, assertPipelineOrder, PipelineNotFinalizedError, CanonicalFindingsEmptyError } =
    await import("./intelligence/scoring-selection");
  const { data: caseRow } = await db
    .from("cases")
    .select("discovery_at,contradiction_at,evidence_intel_at,scored_at")
    .eq("id", caseId)
    .maybeSingle();
  const caseTs = (caseRow ?? {
    discovery_at: null,
    contradiction_at: null,
    evidence_intel_at: null,
    scored_at: null,
  }) as {
    discovery_at: string | null;
    contradiction_at: string | null;
    evidence_intel_at: string | null;
    scored_at: string | null;
  };

  const rawFindings = await listFindings(db, caseId);
  let findings: typeof rawFindings;
  try {
    assertPipelineOrder(caseTs, "scoring");
    findings = getCanonicalScoringFindings({
      caseRow: caseTs,
      findings: rawFindings as unknown as never,
    });
  } catch (e) {
    const code =
      e instanceof PipelineNotFinalizedError
        ? "PIPELINE_NOT_FINALIZED"
        : e instanceof CanonicalFindingsEmptyError
          ? "CANONICAL_FINDINGS_EMPTY"
          : "INVALID_PIPELINE_ORDER";
    // Loud (not silent) evidence-limited fallback so the master pipeline can
    // still emit a report instead of dead-stopping. The flag is surfaced in
    // case_scores.rationale and the final report.
    assertDbOk(
      (
        await db.from("case_scores").upsert(
          {
            case_id: caseId,
            user_id: userId,
            evidence_strength: null,
            witness_reliability: null,
            timeline_integrity: null,
            chain_of_custody: null,
            constitutional_compliance: null,
            investigation_completeness: null,
            case_quality: null,
            conviction_risk: null,
            appeal_risk: null,
            overall_confidence: 0,
            methodology: `Scoring suppressed (${code}); quantitative scores withheld.`,
            rationale: { flags: [code], deterministic: {}, llm: {} } as unknown as J,
            positive_contributors: [] as unknown as J,
            negative_contributors: [] as unknown as J,
            dimension_breakdowns: {
              authoritative: "canonical_guard",
              flags: [code],
              deterministic: { dimensions: {} },
            } as unknown as J,
            source_finding_ids: [],
          },
          { onConflict: "case_id" },
        )
      ).error,
      "Failed to save evidence-limited scorecard",
    );
    await setCase(db, caseId, {
      status: "scored",
      status_message: `Scoring suppressed — ${code}`,
      progress: 100,
      scored_at: new Date().toISOString(),
    });
    return {
      value: undefined,
      stats: { generated: 0, accepted: 0, suppressed_ess: 1, meta: { reason: code } },
    };
  }

  // Case type drives which dimensions are scored at all.
  const caseTypeForScore = await resolveCaseType(
    db,
    caseId,
    findings
      .map((f) => `${f.category} ${f.title}`)
      .join(" ")
      .slice(0, 4000),
  );

  // Cap by item count, not JSON.stringify(...).slice(N) — slicing raw JSON
  // text risks cutting the array off mid-object on cases with many
  // findings, and was the direct cause of a Groq 413 "payload too large"
  // failure on another engine with the same pattern. 150 findings is far
  // more than any dimension_breakdowns synthesis needs to cite specific
  // positive/negative contributors.
  const findingsForLlm = findings.slice(0, 150).map((f) => ({
    id: f.id,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    title: f.title,
    affected_party: f.affected_party,
  }));

  const r = await callGroq({
    apiKey,
    apiKeys,
    systemInstruction: `${mexicoLock(await getReportLocale(db, caseId))}\nYou score legal cases objectively across 10 dimensions. EVERY score must list specific positive and negative contributors that reference finding ids. NEVER produce opaque scores. Output STRICT JSON only.`,
    userContent: `Return STRICT JSON. Each numeric field is 0-100 (integer). Each dimension_breakdowns entry must list at least 2 positive and 2 negative contributors with finding_id references when available.

{
  "evidence_strength": number,
  "witness_reliability": number,
  "timeline_integrity": number,
  "chain_of_custody": number,
  "constitutional_compliance": number,
  "investigation_completeness": number,
  "case_quality": number,
  "conviction_risk": number,
  "appeal_risk": number,
  "overall_confidence": number,
  "methodology": string,
  "positive_contributors": [ { "label": string, "weight": number (1-100), "finding_id": string|null } ],
  "negative_contributors": [ { "label": string, "weight": number (1-100), "finding_id": string|null } ],
  "dimension_breakdowns": {
    "evidence_strength":     { "score": number, "reasoning": string, "positive": [ { "label": string, "finding_id": string|null } ], "negative": [ { "label": string, "finding_id": string|null } ] },
    "witness_reliability":   { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "timeline_integrity":    { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "chain_of_custody":      { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "constitutional_compliance": { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "investigation_completeness":{ "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "case_quality":          { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "conviction_risk":       { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "appeal_risk":           { "score": number, "reasoning": string, "positive": [...], "negative": [...] },
    "overall_confidence":    { "score": number, "reasoning": string, "positive": [...], "negative": [...] }
  }
}

FINDINGS (${findings.length}):
${JSON.stringify(findingsForLlm)}`,
    json: true,
    temperature: 0.1,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "score",
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    success: true,
    keyIndex: r.keyIndex,
  });
  const s = parseJsonLoose<Record<string, unknown>>(r.text) ?? {};
  const num = (k: string) => {
    const v = s[k];
    return typeof v === "number" ? Math.max(0, Math.min(100, Math.round(v))) : null;
  };

  // Collect finding ids referenced

  const allContribs = [...((s.positive_contributors as any[]) ?? []), ...((s.negative_contributors as any[]) ?? [])];

  const ids = allContribs
    .map((c: any) => c?.finding_id)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

  // DETERMINISTIC scorecard derived from verified findings. This overrides
  // the LLM's numeric outputs so every score is defensible by formula.
  const det = computeDeterministicScorecard(findings, caseTypeForScore);
  const detNum = (k: string) => det.dimensions[k]?.score ?? num(k);
  const detContrib = (k: string, sign: "positives" | "negatives") =>
    (det.dimensions[k]?.[sign] ?? []).map((c) => ({
      label: c.title,
      weight: Math.round(Math.abs(c.signed_weight)),
      finding_id: c.finding_id,
    }));
  const flatPos = Object.keys(det.dimensions).flatMap((k) => detContrib(k, "positives"));
  const flatNeg = Object.keys(det.dimensions).flatMap((k) => detContrib(k, "negatives"));

  const { getActiveDomains, isCriminalEffective } = await import("./intelligence/cross-domain.server");
  const activeDomainsForScore = await getActiveDomains(db, caseId);
  const criminalLike = isCriminalEffective(caseTypeForScore, activeDomainsForScore);

  // Strip non-applicable dimensions from the LLM payload BEFORE persistence
  // so renderers (PDF, DOCX, dashboard) cannot show off-domain dimensions
  // like "Conviction Risk" or "Chain of Custody" on a civil case.
  const { applicableDimensionsFor } = await import("./intelligence/scoring.server");
  const applicableSet = new Set(applicableDimensionsFor(caseTypeForScore));
  // Cross-domain escalation (e.g. a tax_law case where a charging document
  // was detected): union in the criminal dimension set so chain_of_custody /
  // constitutional_compliance / conviction_risk / appeal_risk become
  // available instead of being permanently suppressed by the civil base type.
  if (criminalLike && !isCriminalCaseType(caseTypeForScore)) {
    for (const d of applicableDimensionsFor("criminal")) applicableSet.add(d);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llmDimsRaw = (s.dimension_breakdowns ?? {}) as Record<string, any>;
  const llmDimsScoped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(llmDimsRaw)) if (applicableSet.has(k)) llmDimsScoped[k] = v;
  // Also drop off-domain contributors that reference suppressed dimensions
  // by label. Match is best-effort; deterministic contributors override.
  const offDomainLabel =
    /(conviction|appeal|chain of custody|miranda|4th amendment|5th amendment|6th amendment|search and seizure|grand jury|indictment|brady|giglio)/i;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrubContribs = (arr: any[]) => arr.filter((c) => criminalLike || !offDomainLabel.test(String(c?.label ?? "")));

  // MODEL_DISAGREEMENT — deterministic is authoritative; LLM is comparison
  // only. Flag any dimension where the gap exceeds the threshold so the
  // renderer can show it explicitly.
  const { computeScoreDelta, SCORE_DISAGREEMENT_THRESHOLD } = await import("./intelligence/case-state.server");
  const llmDims = llmDimsScoped as Record<string, { score?: number | null }>;

  const detDims = det.dimensions as Record<string, { score?: number | null }>;
  const delta = computeScoreDelta(detDims, llmDims);

  assertDbOk(
    (
      await db.from("case_scores").upsert(
        {
          case_id: caseId,
          user_id: userId,
          evidence_strength: detNum("evidence_strength"),
          witness_reliability: detNum("witness_reliability"),
          timeline_integrity: detNum("timeline_integrity"),
          // Criminal-only dimensions: suppress entirely for civil matters so the
          // report can't display "Chain of Custody: 0" or "Constitutional
          // Compliance: 0" on a medical-malpractice or employment case.
          chain_of_custody: criminalLike ? detNum("chain_of_custody") : null,
          constitutional_compliance: criminalLike ? detNum("constitutional_compliance") : null,
          investigation_completeness: detNum("investigation_completeness"),
          case_quality: num("case_quality"),
          conviction_risk: criminalLike ? num("conviction_risk") : null,
          appeal_risk: criminalLike ? num("appeal_risk") : null,
          overall_confidence: Math.round(det.overall_confidence * 100),
          methodology: det.methodology,
          rationale: { llm: llmDimsScoped, deterministic: det.dimensions } as unknown as J,

          positive_contributors: (flatPos.length
            ? flatPos
            : scrubContribs((s.positive_contributors as any[]) ?? [])) as J,

          negative_contributors: (flatNeg.length
            ? flatNeg
            : scrubContribs((s.negative_contributors as any[]) ?? [])) as J,
          dimension_breakdowns: {
            llm: llmDimsScoped,
            deterministic: det,
            case_type: caseTypeForScore,
            authoritative: "deterministic",
            applicable_dimensions: Array.from(applicableSet),
            score_deltas: delta.deltas,
            max_delta: delta.max_delta,
            model_disagreement: delta.disagreement,
            disagreement_threshold: SCORE_DISAGREEMENT_THRESHOLD,
            flags: delta.disagreement ? ["MODEL_DISAGREEMENT"] : [],
          } as unknown as J,
          source_finding_ids: ids,
        },
        { onConflict: "case_id" },
      )
    ).error,
    "Failed to save case score",
  );

  await setCase(db, caseId, {
    status: "scored",
    status_message: "Scoring complete",
    progress: 100,
    scored_at: new Date().toISOString(),
  });
  return {
    value: undefined,
    stats: {
      generated: findings.length,
      accepted: findings.length,
      meta: { case_type: caseTypeForScore, max_delta: delta.max_delta },
    },
  };
}

// ===== STEP 5: Litigation Intelligence Report =====
// This is NOT a summary generator. It produces an attorney-grade intelligence
// brief with page-level citations, contradiction analysis with legal impact,
// missing evidence, attorney strategy, cross-exam questions, constitutional
// analysis, motion opportunities, case-strength and risk scores, and a
// prioritized next-actions list.
const INTELLIGENCE_VERSION = "intel-v2";
const PAGE_CHARS = 3000;

function paginate(text: string): string[] {
  const t = (text ?? "").replace(/\r\n/g, "\n");
  if (!t) return [];
  const pages: string[] = [];
  for (let i = 0; i < t.length; i += PAGE_CHARS) pages.push(t.slice(i, i + PAGE_CHARS));
  return pages;
}

async function buildPaginatedCorpus(db: Db, caseId: string) {
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,extracted_text,status")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const extracted = (docs ?? []).filter((d) => d.status === "extracted");
  const docIndex: { doc_n: number; document_id: string; filename: string; pages: number }[] = [];
  const blocks: string[] = [];
  extracted.forEach((d, i) => {
    const docN = i + 1;
    const pages = paginate(d.extracted_text ?? "");
    docIndex.push({
      doc_n: docN,
      document_id: d.id as string,
      filename: d.filename,
      pages: pages.length,
    });
    blocks.push(`=== DOC ${docN} | ${d.filename} | id=${d.id} | pages=${pages.length} ===`);
    pages.forEach((p, j) => {
      blocks.push(`--- DOC ${docN} p.${j + 1} ---\n${p}`);
    });
  });
  return { corpus: blocks.join("\n"), docIndex };
}

// Cluster near-duplicate findings so the report sees one consolidated row per issue.
function dedupeFindings<T extends Record<string, unknown>>(
  rows: T[],
): Array<T & { _alias_ids?: string[]; _alias_titles?: string[] }> {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 6)
      .join(" ");
  const groups = new Map<string, Array<T>>();
  for (const f of rows) {
    const cat = String((f as Record<string, unknown>).category ?? "misc").toLowerCase();
    const title = String((f as Record<string, unknown>).title ?? "");
    const key = `${cat}::${norm(title)}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  const out: Array<T & { _alias_ids?: string[]; _alias_titles?: string[] }> = [];
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as Record<string, number>;
  for (const arr of groups.values()) {
    arr.sort(
      (a, b) =>
        (sevRank[String((a as Record<string, unknown>).severity ?? "info")] ?? 9) -
        (sevRank[String((b as Record<string, unknown>).severity ?? "info")] ?? 9),
    );
    const master = arr[0] as T & { _alias_ids?: string[]; _alias_titles?: string[] };
    if (arr.length > 1) {
      master._alias_ids = arr.slice(1).map((a) => String((a as Record<string, unknown>).id ?? ""));
      master._alias_titles = arr.slice(1).map((a) => String((a as Record<string, unknown>).title ?? ""));
      const mEv = (master as Record<string, unknown>).evidence_refs;
      const refs: unknown[] = Array.isArray(mEv) ? [...(mEv as unknown[])] : [];
      for (const a of arr.slice(1)) {
        const ev = (a as Record<string, unknown>).evidence_refs;
        if (Array.isArray(ev)) refs.push(...(ev as unknown[]));
      }
      if (refs.length) (master as Record<string, unknown>).evidence_refs = refs;
    }
    out.push(master);
  }
  return out;
}

/**
 * Materia detection for cases whose `case_type` is not stamped yet. Delegates
 * to the single Mexican classifier (src/lib/mx-case-classifier.ts) — there is
 * no second keyword taxonomy and no foreign case-type vocabulary here.
 */
export function detectCaseType(text: string): string {
  return classifyMexicanCaseType(text).caseType;
}

export function isCriminalCaseType(caseType: string | undefined | null): boolean {
  return normalizeMexicanCaseType(caseType) === "penal";
}

/**
 * Returns the authoritative case type for a case.
 * USER-LOCKED case_type wins absolutely. Detection is only a fallback when
 * the user did not select one at upload time.
 */
export async function resolveCaseType(db: Db, caseId: string, fallbackText?: string): Promise<string> {
  const { data } = await db
    .from("cases")
    .select("case_type,name,description" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locked = (data as any)?.case_type;
  if (typeof locked === "string" && locked.length > 0) return locked;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  return detectCaseType(`${row?.name ?? ""} ${row?.description ?? ""} ${fallbackText ?? ""}`);
}

// Auto-run any REPORT_REQUIRED_ENGINES that are missing or failed. This
// removes the dead-end "Pipeline incomplete — cannot generate report" error:
// instead of failing, the report step backfills its own upstream so the
// user can hit Generate Report directly and the platform completes the work.
async function ensureRequiredEngines(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}): Promise<{ ran: string[]; failed: Array<{ engine: string; error: string }> }> {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  const { REPORT_REQUIRED_ENGINES, missingRequiredEngines } = await import("@/lib/execution-state");
  const { data: runs } = await db
    .from("pipeline_engine_runs")
    .select("id,engine,status,started_at,ended_at,created_at")
    .eq("case_id", caseId)
    .in("engine", REPORT_REQUIRED_ENGINES as unknown as string[])
    .order("created_at", { ascending: false });
  const missing = missingRequiredEngines((runs ?? []) as never);
  if (!missing.length) return { ran: [], failed: [] };

  const baseArgs = { db, caseId, userId, apiKey, apiKeys };
  const derived = await import("./intelligence/derived-engines.server");
  // contradictions / discovery_gaps / evidence_intelligence / witness_intelligence
  // are derived from Analyzers + Agents output; do NOT re-run the standalone
  // LLM engines here (they duplicated work and blew the 30K TPM cap).

  const runners: Record<string, () => Promise<unknown>> = {
    extraction: () => runExtraction(baseArgs),
    analyzers: () => runAnalyzers(baseArgs),
    agents: () => runAgents(baseArgs),
    timeline: () =>
      runEngine(db, { caseId, userId, engine: "timeline" }, async () => {
        const { buildCanonicalTimeline } = await import("./intelligence/canonical-timeline.server");
        const ct = await buildCanonicalTimeline(db, caseId);
        return { value: ct, stats: { generated: ct.totals.total, accepted: ct.totals.dated } };
      }),

    evidence_intelligence: () =>
      runEngine(db, { caseId, userId, engine: "evidence_intelligence" }, async () => {
        const result = await derived.deriveEvidenceIntel(db, caseId);
        await setCase(db, caseId, { evidence_intel_at: new Date().toISOString() });
        return result;
      }),
    contradictions: () =>
      runEngine(db, { caseId, userId, engine: "contradictions" }, async () => {
        const result = await derived.deriveContradictions(db, caseId);
        await setCase(db, caseId, { contradiction_at: new Date().toISOString() });
        return result;
      }),
    discovery_gaps: () =>
      runEngine(db, { caseId, userId, engine: "discovery_gaps" }, async () => {
        const result = await derived.deriveDiscoveryGaps(db, caseId);
        await setCase(db, caseId, { discovery_at: new Date().toISOString() });
        return result;
      }),
    witness_intelligence: () =>
      runEngine(db, { caseId, userId, engine: "witness_intelligence" }, async () =>
        derived.deriveWitnessIntel(db, caseId),
      ),
    constitutional_compliance: () =>
      runEngine(db, { caseId, userId, engine: "constitutional_compliance" }, async () => ({
        value: { derived_from: "analyzers+agents" },
      })),
    evidence_map: () =>
      runEngine(db, { caseId, userId, engine: "evidence_map" }, async () => {
        const m = await import("./intelligence/evidence-map.server");
        const em = await m.buildEvidenceMap(db, caseId);
        return {
          value: em,
          stats: {
            generated: em.totals.total,
            accepted: em.totals.total - em.totals.missing_evidence,
          },
        };
      }),
    scoring: () => runScoring(baseArgs),
  };

  // Run in REPORT_REQUIRED_ENGINES order so dependencies (extraction→analyzers→agents→…)
  // are respected. Practice-area gated engines that don't apply to this case
  // type are skipped here too (constitutional_compliance etc.) so the
  // report-pre-flight gate is satisfied without forcing irrelevant work.
  const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE, buildCaseTypeManifest } =
    await import("./intelligence/practice-areas");
  const { getActiveDomains } = await import("./intelligence/cross-domain.server");
  const { recordSkipped } = await import("./intelligence/engine-audit.server");
  const { emitEvent } = await import("./intelligence/progress.server");

  const { data: caseRow } = await db
    .from("cases")
    .select("case_type" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const area = String((caseRow as any)?.case_type ?? "general_civil");
  const activeDomains = await getActiveDomains(db, caseId);

  // Emit the Case-Type Manifest — what the engine INTENDS to run, before any
  // engine actually executes. Persisted to pipeline_events for the audit trail.
  const manifest = buildCaseTypeManifest(area, activeDomains);
  await emitEvent(db, caseId, "manifest", `Case-Type Manifest: ${manifest.case_type_label}`, {
    meta: manifest as unknown as Record<string, unknown>,
  });

  const ordered = (REPORT_REQUIRED_ENGINES as readonly string[]).filter((e) => missing.includes(e));

  const ran: string[] = [];
  const failed: Array<{ engine: string; error: string }> = [];
  for (const engine of ordered) {
    if (!isAnalyzerAllowed(area, engine, activeDomains)) {
      await recordSkipped(db, {
        caseId,
        userId,
        engine: engine as never,
        reason: SKIP_REASON_NOT_APPLICABLE,
      });
      ran.push(`${engine}:skipped`);
      continue;
    }
    const fn = runners[engine];
    if (!fn) {
      failed.push({ engine, error: "no runner registered" });
      continue;
    }
    try {
      await setCase(db, caseId, { status_message: `Auto-running ${engine}`, progress: 10 });
      await fn();
      ran.push(engine);
    } catch (e) {
      rethrowIfCheckpoint(e);
      failed.push({ engine, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ran, failed };
}

export async function runReport(args: { db: Db; caseId: string; userId: string; apiKey: string; apiKeys?: string[] }) {
  const { db, caseId, userId } = args;
  // Clear the per-case findings audit accumulator BEFORE any engine runs.
  // Without this, `_findingsAudit` (module-level Map keyed by caseId) keeps
  // adding to the prior run's totals on every rerun/regenerate, and the
  // cover-page "Findings Summary" silently inflates across regenerations.
  const { resetFindingsAudit } = await import("./intelligence/findings.server");
  resetFindingsAudit(caseId);
  await setCase(db, caseId, {
    status: "reporting",
    status_message: "Preparing report pipeline",
    progress: 5,
  });

  // Backstop: if this case has already checkpointed out of the report stage
  // MAX_REPORT_CHECKPOINTS times without finishing, the raw LLM calls are
  // not going to succeed on attempt N+1 either — same prompt, same model,
  // same timeout. Stop retrying and force finalization with whatever
  // chunks are already cached, via the existing salvage/fallback path,
  // so the case always terminates instead of checkpointing forever.
  let forceFinalize = false;
  try {
    const { MAX_REPORT_CHECKPOINTS } = await import("./pipeline-checkpoint.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cur } = await (db as any)
      .from("cases")
      .select("report_checkpoint_count")
      .eq("id", caseId)
      .maybeSingle();
    const count = (cur as { report_checkpoint_count?: number } | null)?.report_checkpoint_count ?? 0;
    if (count >= MAX_REPORT_CHECKPOINTS) {
      forceFinalize = true;
      console.warn(
        `[report] checkpoint backstop reached (${count}/${MAX_REPORT_CHECKPOINTS}) — forcing finalization with cached chunks`,
      );
      await setCase(db, caseId, {
        status_message: `Report generation timed out repeatedly — finalizing with partial results (${count} attempts)`,
      });
    }
  } catch (e) {
    console.warn("[report] failed to read report_checkpoint_count — proceeding normally", e);
  }

  // Backfill any missing upstream engines BEFORE we clear report-tier rows,
  // so the pre-flight gate inside _runReportInner can succeed without
  // forcing the user to manually click each prior step.
  const ensured = await ensureRequiredEngines(args);
  if (ensured.failed.length) {
    console.warn("[report] some required engines failed during auto-backfill", ensured.failed);
  }
  // Collect pipeline warnings for inclusion in the final report (Section 10).
  const pipelineWarnings: string[] = ensured.failed.map((f) => `${f.engine}_failed`);

  await setCase(db, caseId, {
    status: "reporting",
    status_message: "Building litigation intelligence",
    progress: 20,
  });
  // 2026-07-31: theory/strategy/opportunity removed from this list. They
  // were being deleted here immediately after ensureRequiredEngines() (the
  // auto-backfill, one call above) had just written fresh success rows for
  // them — so the pre-flight gate inside _runReportInner, which re-queries
  // this same table, always found them missing and reported "failed to
  // complete even after auto-backfill" even when they'd genuinely just
  // succeeded. Confirmed against a real case: pipeline_trace showed all
  // three completing cleanly (twice — original run and backfill retry),
  // but pipeline_engine_runs had zero rows for them at gate-check time.
  // This delete is for *report-tier* rows only — the engines that are
  // about to run fresh as part of THIS report-generation attempt
  // (report_generator itself, plus the downstream QA/validator engines) —
  // not the upstream analysis engines that just fed it.
  await db
    .from("pipeline_engine_runs")
    .delete()
    .eq("case_id", caseId)
    .in("engine", ["report_generator", "motion", "ess_validator", "claim_validator", "report_validator"]);
  return runEngine(db, { caseId, userId, engine: "report_generator" }, async () =>
    _runReportInner({ ...args, pipelineWarnings, forceFinalize }),
  );
}

async function _runReportInner(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
  pipelineWarnings?: string[];
  forceFinalize?: boolean;
}) {
  const { db, caseId, userId, apiKey, apiKeys, forceFinalize } = args;
  const pipelineWarnings: string[] = Array.isArray(args.pipelineWarnings) ? [...args.pipelineWarnings] : [];

  // ---- Pre-flight validation gate -------------------------------------
  // Block report generation unless the upstream engines actually completed.
  // Single source of truth: pipeline_engine_runs + REPORT_REQUIRED_ENGINES.
  // runReport() above auto-backfills missing engines first, so this gate
  // only trips when an engine genuinely cannot complete.
  {
    const { REPORT_REQUIRED_ENGINES, REPORT_BLOCKING_ENGINES, missingRequiredEngines } =
      await import("@/lib/execution-state");
    const { data: runs } = await db
      .from("pipeline_engine_runs")
      .select("id,engine,status,started_at,ended_at,created_at")
      .eq("case_id", caseId)
      .in("engine", REPORT_REQUIRED_ENGINES as unknown as string[])
      .order("created_at", { ascending: false });
    const rows = (runs ?? []) as never;
    const blockingMissing = missingRequiredEngines(rows, REPORT_BLOCKING_ENGINES);
    const nonBlockingMissing = missingRequiredEngines(rows).filter(
      (e) => !REPORT_BLOCKING_ENGINES.includes(e as never),
    );
    if (nonBlockingMissing.length) {
      pipelineWarnings.push(...nonBlockingMissing.map((e) => `${e}_incomplete`));
    }
    if (blockingMissing.length) {
      throw new Error(
        `Pipeline incomplete — cannot generate report. The following core engines failed to complete even after auto-backfill: ${blockingMissing.join(", ")}.`,
      );
    }
  }

  const [
    { data: analysis },
    { data: agents },
    { data: score },
    rawFindings,
    { data: theories },
    { data: opps },
    { data: witnesses },
    { data: trial },
    { data: perspectives },
    { data: evidenceIntel },
    { data: strategyRows },
    { data: workProduct },
    { data: contradictionsExisting },
  ] = await Promise.all([
    db.from("analyses").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("agent_findings").select("agent_type,summary,findings,confidence").eq("case_id", caseId),
    db.from("case_scores").select("*").eq("case_id", caseId).maybeSingle(),
    listFindings(db, caseId),
    db.from("case_theories").select("*").eq("case_id", caseId),
    db.from("case_opportunities").select("*").eq("case_id", caseId),
    db.from("case_witnesses").select("*").eq("case_id", caseId),
    db.from("case_trial_prep").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("case_perspectives").select("*").eq("case_id", caseId),
    db.from("evidence_classifications").select("*").eq("case_id", caseId),
    db.from("case_strategy").select("*").eq("case_id", caseId),
    db.from("case_work_product").select("*").eq("case_id", caseId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .from("agent_findings")
      .select("agent_type,findings")
      .eq("case_id", caseId)
      .eq("agent_type", "contradictions"),
  ]);
  if (!analysis) throw new Error("Run Analyzers first.");
  if (!score) throw new Error("Run Score Case first.");

  await setCase(db, caseId, { status_message: "Consolidating findings", progress: 35 });
  const allFindings = dedupeFindings(rawFindings);
  // SINGLE SOURCE OF TRUTH: identical filter as the scoring engine.
  // Analyzer (provisional) rows are excluded entirely; pipeline must be
  // finalized and ordered correctly. If the canonical set is empty or order
  // is wrong, we degrade loudly via a pipeline warning rather than aborting
  // the entire report — scoring already handled the hard-error case.
  const { getCanonicalScoringFindings, assertPipelineOrder } = await import("./intelligence/scoring-selection");
  const { data: caseTsRow } = await db
    .from("cases")
    .select("discovery_at,contradiction_at,evidence_intel_at,scored_at")
    .eq("id", caseId)
    .maybeSingle();
  const caseTs = (caseTsRow ?? {
    discovery_at: null,
    contradiction_at: null,
    evidence_intel_at: null,
    scored_at: null,
  }) as {
    discovery_at: string | null;
    contradiction_at: string | null;
    evidence_intel_at: string | null;
    scored_at: string | null;
  };
  let findings: typeof allFindings;
  try {
    assertPipelineOrder(caseTs, "report");
    findings = getCanonicalScoringFindings({
      caseRow: caseTs,
      findings: allFindings as unknown as never,
    });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "CANONICAL_GUARD_FAILED";
    pipelineWarnings.push(code);
    findings = allFindings.filter(
      (f) => !String((f as { source_module?: string }).source_module ?? "").startsWith("analyzer:"),
    );
  }
  // Defensive fallback (mirrors cases.functions.ts): if the strict canonical
  // filter (engine:*-sourced only) leaves nothing, but the case genuinely has
  // findings, fall back to the unfiltered set for both consolidated_findings
  // and finding_counters. Without this, a case whose only findings are
  // analyzer:*-sourced reports "0 findings" on the cover page while the
  // exported Key Findings table (which applies the same fallback) still
  // renders them — the exact mismatch this fallback exists to prevent.
  if (findings.length === 0 && allFindings.length > 0) {
    pipelineWarnings.push(`canonical_findings_empty_fallback:${allFindings.length}`);
    findings = allFindings;
  }
  if (allFindings.length !== findings.length) {
    pipelineWarnings.push(`analyzer_findings_excluded:${allFindings.length - findings.length}`);
  }

  // ---- Phase 4: canonical_analysis is the report's finding authority ----
  // Flagged (CANONICAL_REPORT_ENABLED, default off). When on, the gate's
  // persisted selection + ranking replaces the locally re-derived order, and
  // the canonical version rendered from is recorded on the report row. Every
  // fallback to the raw-table path above is traced.
  let canonicalVersion: number | null = null;
  {
    const { loadCanonicalReportSource, applyCanonicalOrder, traceCanonicalFallback } =
      await import("@/lib/canonical/report-source.server");
    const src = await loadCanonicalReportSource(db, caseId);
    if (src) {
      const ordered = applyCanonicalOrder(findings as unknown as { id?: string | null }[], src.orderedIds);
      if (ordered) {
        canonicalVersion = src.version;
        findings = ordered as unknown as typeof findings;
        pipelineWarnings.push(`canonical_report_source:v${src.version}`);
      } else {
        await traceCanonicalFallback(db, caseId, "no_overlap_with_raw_findings", {
          canonical_findings: src.orderedIds.length,
          raw_findings: findings.length,
        });
      }
    }
  }

  // Derive deterministic Legal Attack Surface from current findings so the
  // renderer has a ranked attack-lane breakdown without re-analysis.
  // Attack Surface buckets are criminal-procedure specific (suppression,
  // Miranda, Brady/Giglio, Franks, chain of custody, Daubert, etc.). On
  // non-criminal practice areas we explicitly record a Skipped — Not
  // Applicable marker instead of running the regex categorizer and
  // surfacing an indistinguishable empty result.
  try {
    const caseTypeForAS = await resolveCaseType(db, caseId, String(JSON.stringify(analysis ?? {})).slice(0, 4000));
    const { getActiveDomains, isCriminalEffective } = await import("./intelligence/cross-domain.server");
    const activeDomainsForAS = await getActiveDomains(db, caseId);
    if (isCriminalEffective(caseTypeForAS, activeDomainsForAS)) {
      const { runAttackSurfaceEngine } = await import("./intelligence/litigation.server");
      await runAttackSurfaceEngine({ db, caseId, userId });
    } else {
      const { recordSkipped } = await import("./intelligence/engine-audit.server");
      const reason = `Omitido — el análisis de superficie de ataque es específico del proceso penal acusatorio y no aplica a la materia ${caseTypeForAS}.`;
      await recordSkipped(db, { caseId, userId, engine: "attack_surface" as never, reason });

      await db
        .from("cases")
        .update({
          attack_surface: { skipped: true, reason, case_type: caseTypeForAS } as unknown as J,
        } as any)
        .eq("id", caseId);
    }
  } catch (e) {
    console.warn("attack-surface build failed", e);
  }

  await setCase(db, caseId, { status_message: "Indexing evidence pages", progress: 45 });
  const { corpus, docIndex } = await buildPaginatedCorpus(db, caseId);
  if (!corpus) throw new Error("No extracted documents. Run Extraction first.");

  // User-locked case type — never overridden by document content
  const caseType = await resolveCaseType(db, caseId, String(JSON.stringify(analysis ?? {})).slice(0, 4000));
  // Control constitucional aplica en materia penal, amparo y constitucional.
  const materiaForReport = normalizeMexicanCaseType(caseType);
  const isCriminalOrCivilRights =
    materiaForReport === "penal" || materiaForReport === "amparo" || materiaForReport === "constitucional";

  const docLegend = docIndex
    .map((d) => `DOC ${d.doc_n} = "${d.filename}" (id=${d.document_id}, ${d.pages} pages)`)
    .join("\n");
  const findingsLite = findings.map((f) => ({
    id: f.id,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    title: f.title,
    affected_party: f.affected_party,
    description: (f.description ?? "").slice(0, 240),
    legal_significance: f.legal_significance,
  }));

  await setCase(db, caseId, {
    status_message: "Running litigation intelligence pass (Groq)",
    progress: 55,
  });

  // --- Cooperative cancellation: poll cancel_requested every 2s and abort the in-flight fetch.
  const ac = new AbortController();
  let cancelled = false;
  const watcher = setInterval(async () => {
    try {
      const { data: row } = await db
        .from("cases")
        .select("cancel_requested" as any)
        .eq("id", caseId)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((row as any)?.cancel_requested) {
        cancelled = true;
        ac.abort();
      }
    } catch {
      /* swallow */
    }
  }, 2000);

  let r: Awaited<ReturnType<typeof callGroq>> | null = null;
  let reportLlmError: string | null = null;
  // Bug 4: retry the report LLM call. Previously a single 429/413/timeout
  // silently fell through to the deterministic "Insufficient evidence"
  // boilerplate even on a healthy corpus. Retry with progressive
  // payload-shrinking, then only fall back after all attempts fail.
  const buildUserContent = (scale: number) => {
    const s = (n: number) => Math.max(1200, Math.floor(n * scale));
    return `Return STRICT JSON with this exact shape. Markdown prose fields MUST contain inline citations like \`[DOC 3 p.2]\` for every concrete claim. Structured arrays MUST include doc_n, page, and quote for every citation object.

{
  "prose": {
    "executive_summary": string,
    "attorney_summary": string,
    "investigator_summary": string,
    "case_overview": string,
    "facts": string,
    "timeline_summary": string,
    "evidence_summary": string,
    "witness_analysis": string,
    "contradiction_report": string,
    "discovery_analysis": string,
    "missing_evidence_report": string,
    "constitutional_issues": string,
    "procedural_issues_report": string,
    "prosecution_theory_report": string,
    "defense_theory_report": string,
    "alternative_theory_report": string,
    "risk_analysis": string,
    "score_breakdown": string,
    "recommendations": string,
    "appendix_sources": string
  },
  "citations": [
    { "id": string, "doc_n": number, "document_id": string|null, "page": number, "quote": string, "topic": string, "finding_id": string|null }
  ],
  "evidence_index": [
    { "doc_n": number, "document_id": string|null, "filename": string, "type": string, "role": "inculpatory"|"exculpatory"|"neutral"|"impeachment"|"chain_of_custody"|"procedural", "key_pages": number[], "summary": string, "supports": string[], "undermines": string[] }
  ],
  "contradictions": [
    {
      "title": string,
      "document_a": { "doc_n": number, "page": number, "quote": string },
      "document_b": { "doc_n": number, "page": number, "quote": string },
      "nature": string,
      "credibility_impact": string,
      "trial_significance": string,
      "impeachment_value": string,
      "strategic_implications": string,
      "side_helped": "defense"|"prosecution"|"plaintiff"|"respondent"|"both",
      "severity": "low"|"medium"|"high"|"critical",
      "description": string,
      "legal_impact": string,
      "citations": [ { "doc_n": number, "page": number, "quote": string } ],
      "recommended_use": string
    }
  ],
  "missing_evidence": [
    { "item": string, "why_critical": string, "severity": "low"|"medium"|"high"|"critical", "omision_probatoria_risk": boolean, "how_to_obtain": string, "recommended_motion": string|null, "side_harmed": string, "side_benefits": string }
  ],
  "constitutional_issues": ${isCriminalOrCivilRights ? '[ { "right": string, "articulo_cpeum": string, "issue": string, "facts": string, "legal_standard": string, "likely_outcome": string, "remedy_sought": string, "citations": [ { "doc_n": number, "page": number, "quote": string } ] } ]' : "[]"},
  "motion_opportunities": [
    {
      "motion": string,
      "basis": string,
      "elements": string[],
      "supporting_facts": string,
      "legal_rationale": string,
      "anticipated_opposing_response": string,
      "likely_outcome": string,
      "likelihood_of_success": "low"|"medium"|"high",
      "priority": number,
      "draft_outline": string,
      "citations": [ { "doc_n": number, "page": number, "quote": string } ]
    }
  ],
  "cross_examination": [
    { "witness": string, "objective": string, "lines": [ { "topic": string, "questions": string[], "impeachment_with": string|null, "citation": { "doc_n": number, "page": number, "quote": string }|null } ] }
  ],
  "strategy_recommendations": [
    { "title": string, "rationale": string, "category": "investigation"|"motions"|"negotiation"|"trial"|"discovery"|"expert"|"client", "priority": "low"|"medium"|"high"|"critical", "expected_impact": string, "side_benefits": string }
  ],
  "next_actions": [
    { "order": number, "action": string, "owner": "attorney"|"investigator"|"paralegal"|"expert"|"client", "deadline_hint": string, "depends_on": string[], "why": string }
  ],
  "case_strength_score": number,
  "risk_score": number,
  "score_rationale": string,
  "legal_memorandum": {
    "caption": { "title": string, "date": string, "re": string },
    "executive_summary": {
      "dispositive_recommendation": string,
      "case_strength": "Excellent"|"Strong"|"Moderate"|"Weak",
      "primary_risk": string,
      "urgent_actions": string[]
    },
    "statement_of_facts": {
      "undisputed": string[],
      "disputed": string[],
      "chronology": string[]
    },
    "legal_analysis": [
      { "issue": string, "rule": string, "application": string, "conclusion": string, "cited_evidence": string[] }
    ],
    "recommended_motions": [
      { "motion": string, "legal_standard": string, "factual_basis": string[], "likelihood": "High"|"Medium"|"Low", "draft_paragraph": string }
    ],
    "evidence_appendix": [
      { "exhibit": string, "description": string, "page": string, "key_quote": string, "proves": string, "admissibility_risk": "Low"|"Medium"|"High" }
    ],
    "risk_matrix": [
      { "risk": string, "probability": "High"|"Medium"|"Low", "impact": "Severe"|"Moderate"|"Minor", "mitigation": string }
    ],
    "next_actions": [
      { "action": string, "owner": "Attorney"|"Paralegal"|"Investigator"|"Expert"|"Client", "deadline": string, "priority": "Critical"|"High"|"Medium" }
    ]
  }
}

ADDITIONAL SECTION — LEGAL MEMORANDUM (IRAC):
Populate \`legal_memorandum\` as a court-ready memo derived from the same corpus and citations used above.
- Every fact in \`statement_of_facts\` and every entry in \`cited_evidence\` / \`factual_basis\` / \`key_quote\` MUST use the same \`[DOC N p.M]\` pinpoint-citation format and verbatim quotes (<=200 chars) as the rest of this response.
- \`legal_analysis\` follows IRAC (Issue, Rule, Application, Conclusion) — one entry per distinct legal question actually supported by the corpus.
- \`recommended_motions[].draft_paragraph\` must be a ready-to-file paragraph, present tense, active voice, with inline citations.
- Respect the case-type gating already stated above: do NOT manufacture criminal or constitutional motions on non-criminal/non-civil-rights matters.
- Set \`caption.date\` to today's date in the user's locale format.
- Omit rows you cannot cite; do not fabricate exhibits, pages, or quotes.

EVALUATE these motion categories (skip any not supported by the corpus): ${
      isCriminalOrCivilRights
        ? "Motion to dismiss, Motion to suppress, Motion in limine, Motion to compel, Discovery sanctions, Summary judgment, Evidentiary objections, Appellate preservation issues"
        : "Motion to dismiss (civil), Motion to compel discovery, Motion for protective order, Motion in limine, Motion for summary judgment, Discovery sanctions, Evidentiary objections, Appellate preservation issues"
    }.

PAGINATION RULES:
- The corpus below is split into pages. Each page block is prefixed with \`--- DOC N p.M ---\`.
- Every citation must reference a real (DOC N, page M) pair from the corpus.
- Quotes must be short (<= 200 chars) and copied verbatim from the cited page.
- Do NOT fabricate page numbers, quotes, or document ids.

DOCUMENT LEGEND:
${docLegend}

KNOWN (DEDUPLICATED) FINDINGS (${findings.length}) — reference by id where relevant; DO NOT restate them:
${JSON.stringify(findingsLite).slice(0, s(50000))}

ANALYSIS:
${JSON.stringify(analysis).slice(0, s(18000))}

AGENT OUTPUT:
${JSON.stringify(agents ?? []).slice(0, s(14000))}

CASE SCORE (explainable):
${JSON.stringify(score).slice(0, s(10000))}

ENGINE OUTPUT (perspectives / evidence intel / strategy / witnesses / trial prep / theories / opportunities):
${JSON.stringify({
  perspectives: perspectives ?? [],
  evidence_intel: evidenceIntel ?? [],
  strategy: strategyRows ?? [],
  witnesses: witnesses ?? [],
  trial: trial ?? null,
  theories: theories ?? [],
  opportunities: opps ?? [],
  prior_contradictions: contradictionsExisting ?? [],
}).slice(0, s(35000))}

CORPUS (paginated):
${corpus.slice(0, s(160000))}`;
  };

  const systemInstruction =
    `${mexicoLock(await getReportLocale(db, caseId))}\n` +
    "You are an elite litigation intelligence engine for Mexican attorneys, NOT a summarizer. You produce court-ready work product grounded in the sistema penal acusatorio and Mexican civil procedure." +
    `\nCASE TYPE: ${caseType}. ` +
    (isCriminalOrCivilRights
      ? "Análisis constitucional y de procedimiento penal SÍ son relevantes cuando el corpus los respalda. Fundamenta en el Art. 20 CPEUM (derechos del imputado y la víctima), el catálogo de prisión preventiva oficiosa del Art. 19 CPEUM, y las reglas de cadena de custodia (Arts. 227-230 CNPP) — nunca en doctrina estadounidense (Miranda, Brady/Giglio, enmiendas constitucionales de EE.UU.)."
      : "Este NO es un asunto penal ni de derechos humanos por violación de autoridad. NO manufactures cuestiones constitucionales ni recursos de amparo. Regresa arreglos vacíos para `constitutional_issues` y excluye recursos penales de `motion_opportunities`. Concéntrate en el procedimiento civil, ofrecimiento de pruebas, y mociones dispositivas conforme al derecho mexicano.") +
    '\nMANDATORY CITATION RULE: Every factual claim MUST include a `[DOC N p.M]` bracket immediately after a 10–30 word verbatim quote from that page, written as natural prose — the quote goes in the sentence itself, in quotation marks, NOT inside the brackets. Correct: the report states the officer "failed to inspect the equipment" [DOC 3 p.2]. WRONG — never do this: [DOC 3 p.2: "failed to inspect the equipment"]. A claim without a citation is UNVERIFIED and must be rewritten or omitted. No exceptions.' +
    "\nDO NOT duplicate findings already provided — extend them with deeper analysis; do not restate them as new items." +
    "\nFor every CONTRADICTION: Document A specific quote vs Document B specific quote, plus (nature, credibility impact, trial significance, impeachment value, strategic implications)." +
    "\nFor every MOTION: supporting facts, legal rationale, anticipated opposing response, and likely outcome." +
    (() => {
      // Length targets scale with how much there actually is to say. A case
      // with 6 findings forced into 15+ sections each carrying a fixed
      // 300-600 word MINIMUM has no source material to fill that quota with
      // except repeating the same 6 findings over and over — which is
      // exactly the "repetitive, AI-generated" complaint. Evidence Sufficiency
      // (sufficiency.server.ts) already exists to solve this but only runs
      // AFTER generation as a truncation pass — it can shorten a bloated,
      // repetitive section but can't stop the repetition from being written
      // in the first place. This scales the targets DOWN at generation time
      // instead, for the same reason ESS caps narrative length after the fact.
      const n = findings.length;
      const tier = n >= 15 ? "rich" : n >= 8 ? "moderate" : "sparse";
      const targets =
        tier === "rich"
          ? "executive_summary 300-500; case_overview 350-600; facts 600-1200 chronological; timeline_summary 300-600; risk_analysis 300-600; recommendations 400-800; theory reports 300-600 each; evidence/witness/discovery/contradiction reports 300-600"
          : tier === "moderate"
            ? "executive_summary 200-350; case_overview 250-400; facts 400-700 chronological; timeline_summary 200-350; risk_analysis 200-350; recommendations 250-450; theory reports 200-350 each; evidence/witness/discovery/contradiction reports 200-350"
            : "executive_summary 150-250; case_overview 150-300; facts 250-450 chronological; timeline_summary 150-250; risk_analysis 150-250; recommendations 150-300; theory reports 120-250 each; evidence/witness/discovery/contradiction reports 120-250";
      return (
        `\nLENGTH TARGETS (MANDATORY, scaled to this case's ${n} confirmed findings — a ${tier} evidence case; do NOT pad sections beyond what the evidence supports to hit a bigger number): ${targets}. Write in flowing prose with topic sentences and analysis, NOT bullet fragments. Generic statements like 'The evidence suggests negligence' are FORBIDDEN — replace with 'The evidence suggests negligence because the defendant "failed to inspect the equipment per OSHA 29 CFR 1910.147" [DOC 3 p.2], which establishes...'. Note the quote sits in the sentence, in quotation marks — the citation bracket that follows contains ONLY \`DOC N p.M\`, never the quote text itself. If the corpus is genuinely insufficient, write a detailed paragraph explaining what evidence is missing and why — never a one-line placeholder.` +
        `\nPROGRESSIVE DISCLOSURE (MANDATORY): each finding gets ONE section where it is explained in full (its natural home — e.g. a constitutional violation belongs to constitutional_issues, not to five sections). Every OTHER section that touches that same finding must reference it in a single short clause (e.g. "the post-invocation questioning discussed above further undermines...") and then move directly into analysis THAT SECTION alone is responsible for — the section's distinct lens on the case (timeline placement, discovery implications, risk exposure, strategic use), never a second full re-explanation of the same fact pattern. If you find yourself writing the same 2-3 sentences that already appear in an earlier section, stop and write the section's unique contribution instead, even if that means the section runs shorter than the target range.` +
        `\nEXECUTIVE SUMMARY STRUCTURE (MANDATORY): \`prose.executive_summary\` must let an attorney understand the whole case in under two minutes. Write it as flowing professional prose (not headers or a bullet dump), but it must touch every one of these in order, each as its own sentence or two: (1) case overview — what happened and who the parties are; (2) the core legal issue(s) actually in play; (3) the single strongest piece of evidence and why; (4) the single biggest weakness and why; (5) the most consequential contradiction, if one exists; (6) overall litigation posture in one clear phrase (e.g. "favorable for the defense," "evenly balanced," "unfavorable absent further discovery"); (7) the immediate recommended action; (8) an explicit confidence level in the assessment (e.g. "high confidence given a complete medical record" or "moderate confidence — key witness statements are still outstanding"); (9) any critical deadline apparent from the corpus (statute of limitations, a filing deadline, a hearing date) — if none is apparent from the record, say so in one clause rather than omitting the topic silently. Every factual claim inside this summary still needs its \`[DOC N p.M]\` citation like every other section.` +
        `\nATTORNEY VOICE (MANDATORY): write like a senior litigation attorney, not an AI describing a case. Prefer one direct, confident sentence over three hedged ones. FORBIDDEN filler/hedge phrases (rewrite around every instance, do not use a synonym that means the same thing): "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to", "based on the available evidence", "this could indicate", "it is possible that", "there are indications", "the evidence suggests" (state directly what the evidence shows or establishes instead). Example of the required register: NOT "The prosecution's case is significantly compromised by evidentiary gaps" but "The State's strongest evidence is the knife recovered at arrest; its admissibility is vulnerable because the chain of custody contains a documented gap [DOC 3 p.1]." NOT "Based on the available evidence, there appears to be a discrepancy" but "The record shows a discrepancy between the incident report and the officer's deposition testimony [DOC 2 p.4]."`
      );
    })() +
    "\nFEW-SHOT IRAC EXAMPLE (target quality bar for legal_analysis entries):" +
    '\nGOOD: {"issue":"Si el cateo practicado en el domicilio de Hernández sin orden judicial violó el Art. 16 CPEUM","rule":"Conforme al Art. 16 CPEUM, todo cateo requiere orden escrita de autoridad judicial competente que exprese el lugar a inspeccionar, la persona o personas a aprehender, y los objetos buscados; a falta de estos requisitos, la diligencia y sus frutos carecen de valor probatorio.","application":"En este caso, los elementos de la Policía ingresaron al domicilio a las 15:08 sin exhibir orden de cateo, según consta en el parte informativo que señala que \'se ingresó de forma inmediata ante la negativa de apertura voluntaria\' [DOC 2 p.4]. No existe constancia de orden judicial previa en el expediente. El delito investigado no encuadra en las excepciones de flagrancia o caso urgente previstas en el CNPP.","conclusion":"El cateo violó el Art. 16 CPEUM. Procede solicitar la exclusión del arma recuperada conforme a la regla de exclusión de prueba ilícita.","cited_evidence":["DOC 2 p.4","DOC 5 p.1"]}' +
    '\nBAD (do NOT produce): {"issue":"Cuestión de cateo","rule":"El Art. 16 CPEUM protege contra cateos irregulares","application":"El cateo fue irregular porque no había orden","conclusion":"Procede la exclusión de la prueba"}' +
    "\nSELF-CRITIQUE (before returning JSON, verify): (1) every [DOC N p.M] matches the DOCUMENT LEGEND; (2) no legal standard stated without supporting document evidence; (3) case-type gate respected; (4) every finding id from KNOWN FINDINGS appears in at least one section; (5) IRAC blocks have specific rule statements with case names and years. If any check fails, rewrite the failing section." +
    "\nOutput STRICT JSON only." +
    // CASE-TYPE STANDARDS INJECTION — domain law (controlling standards,
    // leading cases, canonical motions, evidentiary rules, damages
    // framework) keyed to the resolved practice area. Transforms generic AI
    // output into work product that reflects the actual doctrine.
    buildCaseTypeStandardsBlock(caseType);

  // --- CHUNKED GENERATION (Fix 1) ---
  // Split into 3 focused parallel chunks (narrative prose, legal memo,
  // structured intelligence) instead of one monolithic 16k-token call.
  // Each chunk gets its full token budget → no truncation, deeper analysis,
  // rate-limit friendly on the free tier (calls rotate across `apiKeys`
  // inside callGroq).
  // 2026-07-27 — report input budget cut roughly in half again (corpus
  // 55k→22k chars, findings 18k→9k, engine block 12k→7k, etc.). Two hard
  // limits force this, and both were being violated:
  //   1. At ~19.6k input tokens the report chunk was over EVERY fast
  //      provider's per-request budget, so it was routed to Gemini every
  //      time and Groq never saw it.
  //   2. Gemini then had to generate up to 10k output tokens, which cannot
  //      finish inside the 26s per-call ceiling — every attempt died with
  //      "gemini timed out after 26000ms", producing zero forward progress
  //      until the checkpoint loop-breaker killed the run.
  // Trimmed to ~9-10k input tokens the chunk fits Groq's request budget, so
  // the fast provider takes it first and Gemini is only a fallback.
  const sharedContext = `DOCUMENT LEGEND:
${docLegend}

KNOWN (DEDUPLICATED) FINDINGS (${findings.length}) — reference by id where relevant; DO NOT restate them:
${JSON.stringify(findingsLite).slice(0, 6500)}

ANALYSIS:
${JSON.stringify(analysis).slice(0, 3000)}

AGENT OUTPUT:
${JSON.stringify(agents ?? []).slice(0, 2500)}

CASE SCORE (explainable):
${JSON.stringify(score).slice(0, 2000)}

ENGINE OUTPUT (perspectives / evidence intel / strategy / witnesses / trial prep / theories / opportunities):
${JSON.stringify({
  perspectives: perspectives ?? [],
  evidence_intel: evidenceIntel ?? [],
  strategy: strategyRows ?? [],
  witnesses: witnesses ?? [],
  trial: trial ?? null,
  theories: theories ?? [],
  opportunities: opps ?? [],
  prior_contradictions: contradictionsExisting ?? [],
}).slice(0, 5000)}

PAGINATION RULES:
- The corpus below is split into pages. Each page block is prefixed with \`--- DOC N p.M ---\`.
- Every citation must reference a real (DOC N, page M) pair from the corpus.
- Quotes must be short (<= 200 chars) and copied verbatim from the cited page.
- Do NOT fabricate page numbers, quotes, or document ids.

CORPUS (paginated):
${corpus.slice(0, 14000)}`;

  const narrativeShape = `Return STRICT JSON with this exact shape. Every prose field is a substantive narrative with inline \`[DOC N p.M]\` citations for every concrete claim — length per the LENGTH TARGETS already given above (scaled to this case's evidence volume; do not pad past what the evidence supports).

{
  "prose": {
    "executive_summary": string,
    "attorney_summary": string,
    "investigator_summary": string,
    "case_overview": string,
    "facts": string,
    "timeline_summary": string,
    "evidence_summary": string,
    "witness_analysis": string,
    "contradiction_report": string,
    "discovery_analysis": string,
    "missing_evidence_report": string,
    "constitutional_issues": string,
    "procedural_issues_report": string,
    "prosecution_theory_report": string,
    "defense_theory_report": string,
    "alternative_theory_report": string,
    "risk_analysis": string,
    "score_breakdown": string,
    "recommendations": string,
    "appendix_sources": string
  }
}`;

  const memoShape = `Return STRICT JSON with this exact shape — a court-ready IRAC legal memorandum derived from the corpus. Every fact and quote MUST carry an inline \`[DOC N p.M]\` pinpoint citation with a verbatim quote (<=200 chars). Omit rows you cannot cite; do not fabricate exhibits, pages, or quotes. \`legal_analysis\` follows IRAC (Issue, Rule, Application, Conclusion) — one entry per distinct legal question actually supported by the corpus.

{
  "legal_memorandum": {
    "caption": { "title": string, "date": string, "re": string },
    "executive_summary": { "dispositive_recommendation": string, "case_strength": "Excellent"|"Strong"|"Moderate"|"Weak", "primary_risk": string, "urgent_actions": string[] },
    "statement_of_facts": { "undisputed": string[], "disputed": string[], "chronology": string[] },
    "legal_analysis": [ { "issue": string, "rule": string, "application": string, "conclusion": string, "cited_evidence": string[] } ],
    "recommended_motions": [ { "motion": string, "legal_standard": string, "factual_basis": string[], "likelihood": "High"|"Medium"|"Low", "draft_paragraph": string } ],
    "evidence_appendix": [ { "exhibit": string, "description": string, "page": string, "key_quote": string, "proves": string, "admissibility_risk": "Low"|"Medium"|"High" } ],
    "risk_matrix": [ { "risk": string, "probability": "High"|"Medium"|"Low", "impact": "Severe"|"Moderate"|"Minor", "mitigation": string } ],
    "next_actions": [ { "action": string, "owner": "Attorney"|"Paralegal"|"Investigator"|"Expert"|"Client", "deadline": string, "priority": "Critical"|"High"|"Medium" } ]
  }
}`;

  const intelShape = `Return STRICT JSON with this exact shape — structured intelligence outputs. Cross-reference every output against KNOWN FINDINGS. Every citation object MUST include doc_n, page, and a verbatim quote.

{
  "citations": [ { "id": string, "doc_n": number, "document_id": string|null, "page": number, "quote": string, "topic": string, "finding_id": string|null } ],
  "evidence_index": [ { "doc_n": number, "document_id": string|null, "filename": string, "type": string, "role": "inculpatory"|"exculpatory"|"neutral"|"impeachment"|"chain_of_custody"|"procedural", "key_pages": number[], "summary": string, "supports": string[], "undermines": string[] } ],
  "contradictions": [ { "title": string, "document_a": { "doc_n": number, "page": number, "quote": string }, "document_b": { "doc_n": number, "page": number, "quote": string }, "nature": string, "credibility_impact": string, "trial_significance": string, "impeachment_value": string, "strategic_implications": string, "side_helped": "defense"|"prosecution"|"plaintiff"|"respondent"|"both", "severity": "low"|"medium"|"high"|"critical", "description": string, "legal_impact": string, "citations": [ { "doc_n": number, "page": number, "quote": string } ], "recommended_use": string } ],
  "missing_evidence": [ { "item": string, "why_critical": string, "severity": "low"|"medium"|"high"|"critical", "omision_probatoria_risk": boolean, "how_to_obtain": string, "recommended_motion": string|null, "side_harmed": string, "side_benefits": string } ],
  "constitutional_issues": ${isCriminalOrCivilRights ? '[ { "right": string, "articulo_cpeum": string, "issue": string, "facts": string, "legal_standard": string, "likely_outcome": string, "remedy_sought": string, "citations": [ { "doc_n": number, "page": number, "quote": string } ] } ]' : "[]"},
  "motion_opportunities": [ { "motion": string, "basis": string, "elements": string[], "supporting_facts": string, "legal_rationale": string, "anticipated_opposing_response": string, "likely_outcome": string, "likelihood_of_success": "low"|"medium"|"high", "priority": number, "draft_outline": string, "citations": [ { "doc_n": number, "page": number, "quote": string } ] } ],
  "cross_examination": [ { "witness": string, "objective": string, "lines": [ { "topic": string, "questions": string[], "impeachment_with": string|null, "citation": { "doc_n": number, "page": number, "quote": string }|null } ] } ],
  "strategy_recommendations": [ { "title": string, "rationale": string, "category": "investigation"|"motions"|"negotiation"|"trial"|"discovery"|"expert"|"client", "priority": "low"|"medium"|"high"|"critical", "expected_impact": string, "side_benefits": string } ],
  "next_actions": [ { "order": number, "action": string, "owner": "attorney"|"investigator"|"paralegal"|"expert"|"client", "deadline_hint": string, "depends_on": string[], "why": string } ],
  "case_strength_score": number,
  "risk_score": number,
  "score_rationale": string
}`;

  type ChunkName = "narrative" | "memo" | "intelligence";
  const chunkStatus: Record<ChunkName, { ok: boolean; error?: string }> = {
    narrative: { ok: false },
    memo: { ok: false },
    intelligence: { ok: false },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunkParsedByName: Partial<Record<ChunkName, Record<string, any>>> = {};

  // --- Chunk-level resume cache ---------------------------------------
  // Without this, a report stage that gets interrupted by the wall-clock
  // checkpoint (CHECKPOINT_SAFETY_BUFFER_MS) restarts ALL THREE chunk calls
  // from zero on the next worker tick — narrative, memo, AND intelligence,
  // every time. If the combined systemInstruction + sharedContext for a
  // given case type is heavy enough that the three parallel calls routinely
  // can't finish inside one stage budget window (e.g. tax_law's
  // buildCaseTypeStandardsBlock bundles both civil AND criminal doctrine —
  // key cases, canonical motions, evidentiary rules, dual damages framework
  // — into every single chunk's system prompt, on top of the shared corpus
  // context), this stage can checkpoint-and-restart forever: same oversized
  // prompt, same timeout, same restart, no forward progress ever made. This
  // is the general form of the bug — any practice area with a large enough
  // STANDARDS block or a large enough corpus can trigger it, not just tax
  // law. Persisting each chunk's result to `reports.report_chunk_cache` as
  // soon as it succeeds, and skipping already-cached chunks on the next
  // attempt, means each worker tick only has to finish whatever chunks are
  // still outstanding — guaranteeing forward progress instead of a loop.
  let chunkCache: Partial<Record<ChunkName, Record<string, unknown>>> = {};
  try {
    const { data: cacheRow } = await db
      .from("reports")
      .select("report_chunk_cache")
      .eq("case_id", caseId)
      .maybeSingle();
    const raw = (cacheRow as { report_chunk_cache?: unknown } | null)?.report_chunk_cache;
    if (raw && typeof raw === "object") chunkCache = raw as typeof chunkCache;
  } catch (cacheErr) {
    console.warn("[report:chunk] failed to load chunk cache — starting fresh", cacheErr);
  }
  for (const name of ["narrative", "memo", "intelligence"] as ChunkName[]) {
    if (chunkCache[name]) {
      chunkParsedByName[name] = chunkCache[name] as Record<string, unknown>;
      chunkStatus[name].ok = true;
      console.info(`[report:chunk] ${name} resumed from cache — skipping regeneration`);
    }
  }
  const persistChunkCache = async (name: ChunkName) => {
    try {
      await db.from("reports").upsert(
        {
          case_id: caseId,
          user_id: userId,
          report_chunk_cache: { ...chunkCache, [name]: chunkParsedByName[name] } as unknown as Json,
        },
        { onConflict: "case_id" },
      );
      chunkCache = { ...chunkCache, [name]: chunkParsedByName[name] };
    } catch (persistErr) {
      // Non-fatal: worst case this chunk just gets regenerated on the next
      // checkpoint instead of resumed, which is the pre-fix behavior — not
      // a regression.
      console.warn(`[report:chunk] failed to persist ${name} to cache`, persistErr);
    }
  };
  const clearChunkCache = async () => {
    try {
      await db.from("reports").update({ report_chunk_cache: {} }).eq("case_id", caseId);
    } catch {
      /* noop — stale cache entries are harmless; they're only ever read by name-match */
    }
  };

  const handleChunkCancel = async (e: unknown) => {
    if (
      cancelled ||
      (e as { name?: string })?.name === "CancelledError" ||
      (e as { kind?: string })?.kind === "cancelled"
    ) {
      clearInterval(watcher);

      await db
        .from("cases")
        .update({
          status: "cancelled",
          status_message: "Cancelled by user",
          progress: 0,
          cancel_requested: false,
          error: null,
          // See matching note in setCase() above — must clear the lease
          // here too, or a cancellation that happens mid-report-chunk
          // leaves the same stale-lease trap behind.
          worker_lease_until: null,
        } as any)
        .eq("id", caseId);
      throw new CancelledError();
    }
  };

  const runChunk = async (
    name: ChunkName,
    sysSuffix: string,
    shape: string,
    maxTokens: number,
    extraContext?: string,
  ): Promise<Awaited<ReturnType<typeof callGroq>> | null> => {
    // Already resumed from a prior tick's cache — don't burn another AI
    // call re-deriving something we already have.
    if (chunkStatus[name].ok && chunkCache[name]) return null;
    // Backstop tripped: this exact call has already failed to complete
    // MAX_REPORT_CHECKPOINTS times. Retrying again would just reproduce the
    // same timeout — skip straight to the salvage/fallback path below
    // instead of burning another tick.
    if (forceFinalize) {
      chunkStatus[name].error = chunkStatus[name].error ?? "skipped — report checkpoint backstop reached";
      console.warn(`[report:chunk] ${name} skipped — checkpoint backstop reached, forcing finalization`);
      return null;
    }
    try {
      const res = await callGroq({
        apiKey,
        apiKeys,
        signal: ac.signal,
        // No task pin any more. The report prompt now fits inside Groq's
        // request budget (~9-10k input tokens), and Groq generates several
        // times faster than Gemini — which matters because a call has only
        // 26s before the provider timeout. Pinning to Gemini guaranteed the
        // slowest provider took every report chunk and timed out on all of
        // them. Gemini stays in the chain as fallback.
        systemInstruction: systemInstruction + "\n" + sysSuffix,
        userContent: extraContext ? `${shape}\n\n${extraContext}\n\n${sharedContext}` : `${shape}\n\n${sharedContext}`,
        json: true,
        temperature: 0.2,
        maxTokens,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsedChunk = parseJsonLoose<Record<string, any>>(res.text) ?? {};
      chunkParsedByName[name] = parsedChunk;
      chunkStatus[name].ok = true;
      await persistChunkCache(name);
      await logUsage(db, {
        userId,
        caseId,
        operation: `report.chunk.${name}`,
        model: res.model,
        provider: res.provider,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        totalTokens: res.totalTokens,
        latencyMs: res.latencyMs,
        success: true,
        keyIndex: res.keyIndex,
      });
      return res;
    } catch (e) {
      rethrowIfCheckpoint(e);
      await handleChunkCancel(e);
      const msg = e instanceof Error ? e.message : String(e);
      chunkStatus[name].error = msg;
      if (isGroqCooldownOrRateLimit(msg)) {
        const { CheckpointRequired } = await import("./pipeline-checkpoint.server");
        console.warn(`[report:chunk] Groq cooldown during ${name}; yielding for worker retry`);
        throw new CheckpointRequired("report", `Groq cooldown during ${name} chunk`);
      }
      console.warn(`[report:chunk] ${name} failed — ${msg.slice(0, 200)}`);
      return null;
    }
  };

  const memoSysSuffix = `You generate ONLY the legal_memorandum object in this call. ${isCriminalOrCivilRights ? "Constitutional/Brady/Miranda analyses ARE relevant when supported by the corpus." : "This is NOT criminal/civil-rights — focus on civil procedure, discovery, and dispositive motions. Do NOT manufacture constitutional issues."} IRAC format is mandatory for every legal_analysis entry. The executive summary, high-level risk assessment, and primary recommendations already exist — see CANONICAL REPORT CONTEXT below. Do not rewrite or restate them. Reference them by summary only. Your job is ONLY the legal memorandum: IRAC legal analysis, motion drafts, evidence appendix, risk matrix detail, and next actions specific to litigation execution.`;

  const intelSysSuffix =
    "You generate ONLY structured intelligence outputs (citations, evidence_index, contradictions, missing_evidence, constitutional_issues, motion_opportunities, cross_examination, strategy_recommendations, next_actions, case_strength_score, risk_score, score_rationale). Return the shape below and nothing else. The executive summary, high-level risk narrative, constitutional discussion, and contradiction/missing-evidence summaries already exist — see CANONICAL REPORT CONTEXT below. Do NOT restate them in prose form. Your job is ONLY structured data: turn the underlying findings into citations, scorecards, contradiction matrix entries, and evidence classifications. Numeric scores (case_strength_score, risk_score) are new — the canonical context has no numeric risk score yet, so you own computing it.";

  // --- STAGE 1: narrative runs alone first ---------------------------
  // Narrative owns the executive summary, facts/timeline, high-level risk,
  // and primary recommendation candidates. It has to finish before memo/
  // intelligence run so those passes can reference its output instead of
  // independently re-deriving the same executive summary, risk narrative,
  // and recommendation list (this was the actual cause of report
  // repetition — three mutually-blind parallel calls each answering the
  // same questions, not a problem with finding-level dedup).
  //
  // maxTokens raised from 6000/6000/4000: gpt-oss-120b is a reasoning model
  // and spends tokens on internal reasoning before writing the final JSON
  // content. At the old budgets it was reliably exhausting max_tokens on
  // reasoning alone (finish_reason=length, empty text) on every attempt,
  // which is deterministic given the same prompt — retries never succeeded.
  // 2026-07-27: output budgets cut (10000/10000/7000 → 4000/4000/3000).
  // A single call has 26s before the provider timeout fires; 10k output
  // tokens cannot be generated in 26s by any of the configured providers
  // except a warm Groq key, so on Gemini it timed out 100% of the time.
  const narrativeRes = await runChunk(
    "narrative",
    "You generate ONLY narrative prose sections in this call. Return the shape below and nothing else.",
    narrativeShape,
    4000,
  );

  // --- STAGE 2: memo + intelligence run sequentially, referencing narrative.
  // These are LLM-heavy report chunks. Keeping them sequential prevents a
  // single report from bursting multiple provider requests into a fresh/free
  // Gemini key at the same instant.
  const canonicalContext = buildCanonicalReportContext(chunkParsedByName.narrative ?? null);
  const canonicalContextBlock = serializeCanonicalContextForPrompt(canonicalContext);

  await runChunk("memo", memoSysSuffix, memoShape, 4000, canonicalContextBlock);
  await runChunk("intelligence", intelSysSuffix, intelShape, 3000, canonicalContextBlock);

  // `r` drives downstream logic (parsed, fallback banner). Anchor on narrative
  // since prose is the visible surface; memo/intelligence merge in below.
  // NOTE: gate on chunkStatus.*.ok, NOT on truthiness of the returned `r`/
  // `narrativeRes` value — a chunk resumed from the cache legitimately
  // returns null from runChunk (no fresh API call was made) while still
  // being a success. Treating a null return as failure here would
  // misclassify every cache-resumed narrative chunk as failed and trigger
  // unnecessary (and costly) split-group salvage calls.
  r = narrativeRes;
  if (!chunkStatus.narrative.ok) {
    const errs = [chunkStatus.narrative.error, chunkStatus.memo.error, chunkStatus.intelligence.error]
      .filter(Boolean)
      .join(" | ");
    reportLlmError = errs || "all report chunks failed";
    console.warn("[report:chunk] narrative chunk failed; entering split-group salvage", {
      caseId,
      reportLlmError,
    });
  }

  // Independent memo salvage: narrative succeeded but memo chunk failed.
  // Without this, legal_memorandum silently disappears from the report.
  if (chunkStatus.narrative.ok && !chunkStatus.memo.ok && !cancelled) {
    console.warn("[report:chunk] memo chunk failed but narrative ok — attempting isolated memo salvage");
    await runChunk("memo", memoSysSuffix, memoShape, 3000);
    if (chunkStatus.memo.ok) pipelineWarnings.push("legal_memorandum_recovered_by_salvage");
  }

  // Independent intelligence salvage: narrative succeeded but intel failed.
  if (chunkStatus.narrative.ok && !chunkStatus.intelligence.ok && !cancelled) {
    console.warn("[report:chunk] intelligence chunk failed but narrative ok — attempting isolated salvage");
    await runChunk(
      "intelligence",
      "You generate ONLY structured intelligence outputs. Return the shape below and nothing else.",
      intelShape,
      2500,
    );
    if (chunkStatus.intelligence.ok) pipelineWarnings.push("intelligence_recovered_by_salvage");
  }

  // ------------------------------------------------------------------
  // Split-group narrative recovery.
  // A single call demanding ~20 long-form sections is fragile — one
  // provider hiccup wipes out the entire narrative. When the monolithic
  // call fails, salvage what we can by asking for THREE smaller, focused
  // prose-only calls in parallel. Each independent group failure only
  // costs that group; the rest still render real LLM prose.
  // ------------------------------------------------------------------
  const salvagedProse: Record<string, string> = {};
  // Structured salvage — legal_memorandum is an object, not prose. Kept
  // separate so the prose merge loop below doesn't stringify it. When the
  // main call fails, prose recovery alone leaves `legal_memorandum` absent
  // from `parsed`, silently hiding the LegalMemorandumPanel. This 4th
  // salvage lane requests the memo shape directly and merges it back into
  // `parsed` before the final full_report spread.
  let salvagedMemo: Record<string, unknown> | null = null;
  let salvageAttempted = false;
  let salvageAnySuccess = false;
  // Gate on chunkStatus.narrative.ok, not on truthiness of `r`. `r` is
  // legitimately null when narrative resumed from the chunk cache (no
  // fresh API call was made this tick, per the cache-resume loop above),
  // which is a SUCCESS, not a failure. Gating on `!r` was misclassifying
  // every cache-resumed narrative as failed and triggering this expensive
  // 3-call split-group salvage unnecessarily — burning extra latency and
  // tokens on a narrative that already succeeded and didn't need recovery.
  if (!chunkStatus.narrative.ok && !cancelled) {
    salvageAttempted = true;
    const groups: Array<{ label: string; sections: string[] }> = [
      {
        label: "summary+overview",
        sections: ["executive_summary", "attorney_summary", "investigator_summary", "case_overview"],
      },
      {
        label: "facts+timeline",
        sections: ["facts", "timeline_summary", "risk_analysis", "recommendations"],
      },
      {
        label: "evidence+theory",
        sections: [
          "evidence_summary",
          "witness_analysis",
          "contradiction_report",
          "discovery_analysis",
          "prosecution_theory_report",
          "defense_theory_report",
        ],
      },
    ];
    const buildGroupPrompt = (sections: string[]) => {
      const shape = sections.map((k) => `    "${k}": string`).join(",\n");
      return `Return STRICT JSON with this exact shape. Every prose field must be a substantive narrative with inline citations like [DOC N p.M]. Omit a field only if the corpus genuinely does not support it (return an empty string in that case rather than skipping the key).

{
  "prose": {
${shape}
  }
}

${buildUserContent(0.17).split("PAGINATION RULES:")[1] ? "PAGINATION RULES:" + buildUserContent(0.17).split("PAGINATION RULES:")[1] : buildUserContent(0.17)}`;
    };

    // Dedicated legal_memorandum salvage prompt — same corpus, structured
    // object shape, no prose fields. Runs in parallel with the prose groups.
    const buildMemoPrompt = () => {
      const rest = buildUserContent(0.17);
      const paginationTail = rest.split("PAGINATION RULES:")[1]
        ? "PAGINATION RULES:" + rest.split("PAGINATION RULES:")[1]
        : rest;
      return `Return STRICT JSON with this exact shape — a court-ready IRAC legal memorandum derived from the corpus. Every fact and quote MUST carry an inline \`[DOC N p.M]\` pinpoint citation with a verbatim quote (<=200 chars). Omit rows you cannot cite; do not fabricate exhibits, pages, or quotes.

{
  "legal_memorandum": {
    "caption": { "title": string, "date": string, "re": string },
    "executive_summary": {
      "dispositive_recommendation": string,
      "case_strength": "Excellent"|"Strong"|"Moderate"|"Weak",
      "primary_risk": string,
      "urgent_actions": string[]
    },
    "statement_of_facts": {
      "undisputed": string[],
      "disputed": string[],
      "chronology": string[]
    },
    "legal_analysis": [
      { "issue": string, "rule": string, "application": string, "conclusion": string, "cited_evidence": string[] }
    ],
    "recommended_motions": [
      { "motion": string, "legal_standard": string, "factual_basis": string[], "likelihood": "High"|"Medium"|"Low", "draft_paragraph": string }
    ],
    "evidence_appendix": [
      { "exhibit": string, "description": string, "page": string, "key_quote": string, "proves": string, "admissibility_risk": "Low"|"Medium"|"High" }
    ],
    "risk_matrix": [
      { "risk": string, "probability": "High"|"Medium"|"Low", "impact": "Severe"|"Moderate"|"Minor", "mitigation": string }
    ],
    "next_actions": [
      { "action": string, "owner": "Attorney"|"Paralegal"|"Investigator"|"Expert"|"Client", "deadline": string, "priority": "Critical"|"High"|"Medium" }
    ]
  }
}

${paginationTail}`;
    };

    const groupResults: PromiseSettledResult<
      | {
          kind: "prose";
          group: { label: string; sections: string[] };
          res: Awaited<ReturnType<typeof callGroq>>;
        }
      | { kind: "memo"; res: Awaited<ReturnType<typeof callGroq>> }
    >[] = [];
    for (const g of groups) {
      try {
        const res = await callGroq({
          apiKey,
          apiKeys,
          signal: ac.signal,
          systemInstruction,
          userContent: buildGroupPrompt(g.sections),
          json: true,
          temperature: 0.2,
          maxTokens: 6000,
        });
        groupResults.push({ status: "fulfilled", value: { kind: "prose" as const, group: g, res } });
      } catch (reason) {
        groupResults.push({ status: "rejected", reason });
      }
    }
    try {
      const res = await callGroq({
        apiKey,
        apiKeys,
        signal: ac.signal,
        systemInstruction,
        userContent: buildMemoPrompt(),
        json: true,
        temperature: 0.2,
        maxTokens: 8000,
      });
      groupResults.push({ status: "fulfilled", value: { kind: "memo" as const, res } });
    } catch (reason) {
      groupResults.push({ status: "rejected", reason });
    }
    for (const gr of groupResults) {
      if (gr.status !== "fulfilled") {
        const msg = gr.reason instanceof Error ? gr.reason.message : String(gr.reason);
        console.warn(`[report:salvage] group failed — ${msg.slice(0, 200)}`);
        continue;
      }
      try {
        if (gr.value.kind === "memo") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsedMemo = parseJsonLoose<Record<string, any>>(gr.value.res.text) ?? {};
          const memoObj = (parsedMemo.legal_memorandum ?? parsedMemo) as Record<string, unknown>;
          if (memoObj && typeof memoObj === "object" && !Array.isArray(memoObj) && Object.keys(memoObj).length > 0) {
            salvagedMemo = memoObj;
            salvageAnySuccess = true;
          }
          await logUsage(db, {
            userId,
            caseId,
            operation: "report.salvage.memo",
            model: gr.value.res.model,
            provider: gr.value.res.provider,
            inputTokens: gr.value.res.inputTokens,
            outputTokens: gr.value.res.outputTokens,
            totalTokens: gr.value.res.totalTokens,
            latencyMs: gr.value.res.latencyMs,
            success: true,
            keyIndex: gr.value.res.keyIndex,
          });
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedGroup = parseJsonLoose<Record<string, any>>(gr.value.res.text) ?? {};
        const gp = (parsedGroup.prose ?? parsedGroup) as Record<string, unknown>;
        for (const k of gr.value.group.sections) {
          const v = gp[k];
          if (typeof v === "string" && v.trim().length >= 80) {
            salvagedProse[k] = v;
            salvageAnySuccess = true;
          }
        }
        await logUsage(db, {
          userId,
          caseId,
          operation: "report.salvage",
          model: gr.value.res.model,
          provider: gr.value.res.provider,
          inputTokens: gr.value.res.inputTokens,
          outputTokens: gr.value.res.outputTokens,
          totalTokens: gr.value.res.totalTokens,
          latencyMs: gr.value.res.latencyMs,
          success: true,
          keyIndex: gr.value.res.keyIndex,
        });
      } catch (e) {
        console.warn(
          `[report:salvage] parse failed for group ${gr.value.kind === "memo" ? "legal_memorandum" : gr.value.group.label}`,
          e,
        );
      }
    }
    console.info(
      `[report:salvage] recovered ${Object.keys(salvagedProse).length} prose section(s); memo=${!!salvagedMemo}; anySuccess=${salvageAnySuccess}`,
    );
  }

  clearInterval(watcher);

  await setCase(db, caseId, { status_message: "Assembling litigation package", progress: 85 });
  if (r) {
    await logUsage(db, {
      userId,
      caseId,
      operation: "report",
      model: r.model,
      provider: r.provider,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      latencyMs: r.latencyMs,
      success: true,
      keyIndex: r.keyIndex,
    });
  } else {
    await logUsage(db, {
      userId,
      caseId,
      operation: "report",
      model: MODEL,
      latencyMs: 0,
      success: false,
      error: reportLlmError ?? "report generation fallback",
    });
  }

  // Merge all successfully-parsed chunks into a single `parsed` object.
  // narrative → { prose: {...} }, memo → { legal_memorandum: {...} },
  // intelligence → { citations, evidence_index, ... }. Order chosen so
  // memo/intelligence never overwrite narrative prose keys.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: Record<string, any> = {
    ...(chunkParsedByName.intelligence ?? {}),
    ...(chunkParsedByName.memo ?? {}),
    ...(chunkParsedByName.narrative ?? {}),
  };
  const prose = (parsed.prose ?? {}) as Record<string, unknown>;

  // Single canonical recommendations list — replaces the six overlapping
  // lists (narrative prose, memo next_actions, memo recommended_motions,
  // intelligence next_actions, intelligence strategy_recommendations,
  // intelligence motion_opportunities) with one deduplicated, ID-referenced
  // set. The renderer should read `parsed.canonical_recommendations` going
  // forward instead of stitching the six raw fields together itself.
  parsed.canonical_recommendations = mergeCanonicalRecommendations({
    narrativeParsed: chunkParsedByName.narrative ?? null,
    memoParsed: chunkParsedByName.memo ?? null,
    intelParsed: chunkParsedByName.intelligence ?? null,
  });

  // --- Defense-in-depth: strip ungrounded standalone confidence figures ---
  // The system prompt already instructs the model never to state a
  // standalone confidence/strength/reliability number in prose unless it
  // matches a real computed score (see "NUMERIC SCORE DISCIPLINE" above),
  // but LLMs occasionally leak a number anyway (e.g. "high confidence
  // (91%)" with no corresponding 91 anywhere in the scored output). Prompt
  // instructions are not enforcement, so this pass deterministically
  // verifies every "NN/100", "NN%", or "NN out of 100"-style figure in the
  // prose against the actual computed scores available on `parsed`, and
  // replaces anything that isn't traceable to one of them.
  const collectKnownScoreNumbers = (p: Record<string, unknown>): Set<number> => {
    const nums = new Set<number>();
    const add = (v: unknown) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      nums.add(Math.round(v));
      // Confidence values are often expressed 0-1; also allow the
      // percentage form so "0.91" grounds a printed "91%".
      if (v > 0 && v <= 1) nums.add(Math.round(v * 100));
    };
    add(p.case_strength_score);
    add(p.risk_score);
    const scorecard = (p.deterministic_scorecard ?? {}) as Record<string, unknown>;
    for (const dim of Object.values(scorecard)) {
      if (dim && typeof dim === "object") add((dim as Record<string, unknown>).score);
    }
    // p.deterministic_scorecard is the LLM's OWN copy of scorecard-shaped
    // JSON, which is frequently absent — the real, authoritative per-
    // dimension scores (Chain of custody integrity: 29, Constitutional
    // compliance: 34, etc., shown in the Case Scorecard section) are
    // computed separately by computeDeterministicScorecard() and were never
    // fed into this whitelist at all. That meant every legitimate mention
    // of a real dimension score in prose ("the chain-of-custody score is
    // low (29/100)") was indistinguishable from a fabricated one and always
    // got overwritten with "well-supported"/"elevated" — the fallback text
    // was firing on TRUE numbers, not just hallucinated ones. Recomputing
    // it here (pure function over already-available findings/caseType) and
    // adding every real dimension score closes that gap.
    try {
      const det = computeDeterministicScorecard(findings, caseType);
      for (const dim of Object.values(det.dimensions)) add(dim?.score);
    } catch {
      /* best-effort — if this throws, fall through with whatever is already known */
    }
    const theories = Array.isArray(p.theories) ? (p.theories as Record<string, unknown>[]) : [];
    for (const t of theories) add(t?.confidence);
    const confidenceArrayKeys = [
      "contradictions",
      "missing_evidence",
      "procedural_issues",
      "key_findings",
      "constitutional_issues",
      "motion_opportunities",
    ];
    for (const key of confidenceArrayKeys) {
      const items = Array.isArray(p[key]) ? (p[key] as Record<string, unknown>[]) : [];
      for (const it of items) add(it?.confidence);
    }
    return nums;
  };
  const knownScoreNumbers = collectKnownScoreNumbers(parsed);
  // Pass 1: numbers with an explicit unit — "91/100", "91%", "91 out of 100".
  const UNIT_SCORE_RE = /\b(\d{1,3})\s*(?:\/\s*100|(?:out of)\s*100|%)/gi;
  // Pass 2: bare numbers near a scoring keyword with NO unit at all — e.g.
  // "the overall confidence in the case is 91" or "rated as 13". Real
  // reports show this exact shape (a fabricated confidence figure stated
  // as a plain number, not a percentage), so the unit-based pattern alone
  // misses it entirely. Lookbehind keeps the match to just the digits so
  // the surrounding sentence still reads naturally after replacement.
  // Captures the triggering keyword (group 1) alongside the number (group 2)
  // so the fallback replacement can match its grammar — "well-supported"
  // reads fine after "strength"/"reliability" but not after "risk", where it
  // produced sentences like "conviction risk of well-supported".
  const KEYWORD_NUMBER_RE =
    /(?<=\b(confidence|score|scored|strength|reliability|risk|rated)\b[^.\n\d]{0,25})\b(\d{1,3})\b/gi;
  const RISK_KEYWORDS = new Set(["risk", "rated"]);
  const SCORE_KEYWORD_RE = /\b(confidence|score|scored|strength|reliability|risk|rated)\b/gi;
  // UNIT_SCORE_RE has no keyword lookbehind of its own — most fabricated
  // figures in this app's prose are expressed with a "/100" unit (scores
  // are always framed that way elsewhere in the report), so THIS pass, not
  // the bare-number one below, is what actually catches sentences like
  // "conviction risk is low (18/100)". Scan backward from the match for the
  // nearest scoring keyword so its fallback word matches grammatically too —
  // otherwise only the bare-number pass was keyword-aware and the far more
  // common unit-suffixed case kept producing "risk ... (well-supported)".
  const fallbackForContext = (text: string, matchIndex: number): string => {
    const before = text.slice(Math.max(0, matchIndex - 30), matchIndex);
    SCORE_KEYWORD_RE.lastIndex = 0;
    let lastKeyword: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = SCORE_KEYWORD_RE.exec(before))) lastKeyword = m[1];
    return lastKeyword && RISK_KEYWORDS.has(lastKeyword.toLowerCase()) ? "elevated" : "well-supported";
  };
  const fallbackFor = (keyword: string): string =>
    RISK_KEYWORDS.has(keyword.toLowerCase()) ? "elevated" : "well-supported";
  // Citation-quote spans — "[DOC 4 p.1: 'I think that's him, but I'm not
  // 100% sure']" — must never be touched by this sanitizer. These are
  // verbatim evidence quotes verified against the corpus; a number inside
  // one (e.g. that "100%") is part of what a witness actually said, not a
  // model-generated confidence figure, and overwriting it produced the
  // genuinely bad outcome of the report MISQUOTING a witness statement
  // ("I'm not well-supported sure"). Backreference \1 requires the same
  // quote character to open and close, and requires the closer to sit
  // directly against "]" — which is what keeps this from stopping early at
  // a mid-quote apostrophe like "that's" or "I'm".
  const CITATION_QUOTE_RE = /\[DOC\s+\d+\s+p\.\d+:\s*(['"])[\s\S]*?\1\]/g;
  const protectedRanges = (text: string): Array<[number, number]> => {
    const ranges: Array<[number, number]> = [];
    CITATION_QUOTE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITATION_QUOTE_RE.exec(text))) ranges.push([m.index, m.index + m[0].length]);
    return ranges;
  };
  const insideAnyRange = (ranges: Array<[number, number]>, index: number): boolean =>
    ranges.some(([start, end]) => index >= start && index < end);
  const sanitizeOrphanedScores = (text: string): string => {
    if (!text) return text;
    const ranges = protectedRanges(text);
    let out = text.replace(UNIT_SCORE_RE, (match, numStr: string, offset: number) => {
      if (insideAnyRange(ranges, offset)) return match;
      const val = parseInt(numStr, 10);
      return knownScoreNumbers.has(val) ? match : fallbackForContext(text, offset);
    });
    out = out.replace(KEYWORD_NUMBER_RE, (match, keyword: string, numStr: string, offset: number) => {
      if (insideAnyRange(ranges, offset)) return match;
      const val = parseInt(numStr, 10);
      return knownScoreNumbers.has(val) ? match : fallbackFor(keyword);
    });
    return out;
  };
  for (const [k, v] of Object.entries(prose)) {
    if (typeof v === "string") prose[k] = sanitizeOrphanedScores(v);
  }

  // Merge any salvaged group prose from the split-group recovery. Salvaged
  // sections are LLM-authored, so they win over deterministic backfill below.
  for (const [k, v] of Object.entries(salvagedProse)) {
    if (typeof v === "string" && v.trim().length > 0) prose[k] = sanitizeOrphanedScores(v);
  }
  // Merge salvaged legal_memorandum into `parsed` so the final full_report
  // spread (line ~2621) picks it up. Only fill when the main call didn't
  // already produce one — never clobber a valid LLM-authored memo.
  if (salvagedMemo && (!parsed.legal_memorandum || typeof parsed.legal_memorandum !== "object")) {
    parsed.legal_memorandum = salvagedMemo;
  }

  // ONE fallback banner at the top of the report — never repeated per section.
  // Down-stream renderers surface `prose.fallback_banner` as a single
  // dismissable notice; individual sections render their own deterministic
  // content directly, without any prefix boilerplate.
  const narrativeFallback = !!reportLlmError && !salvageAnySuccess;
  const narrativePartial = !!reportLlmError && salvageAnySuccess;
  if (narrativeFallback) {
    prose.fallback_banner =
      "AI narrative generation was unavailable during this run due to a provider error. The sections below are assembled directly from verified findings and extracted documents — no interpretive prose. Attorney independent review is required before reliance.";
  } else if (narrativePartial) {
    prose.fallback_banner = `AI narrative generation partially failed during this run. ${Object.keys(salvagedProse).length} section(s) were recovered from smaller follow-up calls; the remainder are assembled directly from verified findings. Attorney independent review is required before reliance.`;
  }

  // Ensure the mutated prose (banner + salvaged sections) is reachable to
  // renderers via `full_report.prose`, even when the original parsed payload
  // had no `prose` key.
  parsed.prose = prose;
  // Structured metadata about narrative-generation status so downstream
  // renderers can scope the banner precisely to the failed sections instead
  // of blanket-covering the whole report.
  (parsed as Record<string, unknown>).narrative_status = {
    llm_error: reportLlmError ?? null,
    fully_failed: narrativeFallback,
    partially_failed: narrativePartial,
    salvaged_sections: Object.keys(salvagedProse),
    banner: (prose.fallback_banner as string | undefined) ?? null,
  };

  // Deterministic backfill: if the LLM returned an empty / unparseable prose
  // block, we still emit a defensible report assembled from the verified
  // findings and the deterministic scorecard rather than failing mid-report.
  const proseLooksEmpty = Object.values(prose).filter((v) => typeof v === "string" && v.trim().length > 0).length < 3;
  if (proseLooksEmpty) {
    const sevRank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 } as Record<string, number>;
    const top = [...findings].sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0)).slice(0, 10);
    const bullets = top.map((f) => `- (${f.severity}) ${f.title} — ${f.legal_significance ?? f.category}`).join("\n");
    const docLines = docIndex
      .map((d) => `- DOC ${d.doc_n}: ${d.filename} (${d.pages} page${d.pages === 1 ? "" : "s"})`)
      .join("\n");
    const agentLines = (agents ?? [])
      .map((a: any) => `- ${a.agent_type}: ${a.summary ?? a.status ?? "completed"}`)
      .join("\n");
    const timelineItems = Array.isArray((analysis as any)?.timeline) ? ((analysis as any).timeline as any[]) : [];
    // Timeline formatting: never emit a bare leading colon. Treat empty
    // strings as missing dates and drop the colon entirely rather than
    // rendering "- : Alarm" in a legal document.
    const timelineLines = timelineItems
      .slice(0, 20)
      .map((t) => {
        const rawDate = typeof t.date === "string" ? t.date.trim() : t.date;
        const label = t.event ?? t.description ?? JSON.stringify(t).slice(0, 180);
        return rawDate ? `- ${rawDate}: ${label}` : `- ${label}`;
      })
      .join("\n");
    const scoreLine = score
      ? `Overall confidence: ${(score as any).overall_confidence ?? "suppressed"}. Methodology: ${(score as any).methodology ?? "deterministic evidence-gated scoring"}.`
      : "Quantitative score unavailable.";
    // No per-section "sumLine" prefix. The single banner above says it once;
    // sections render only their own content.

    const locale = await getReportLocale(db, caseId);
    const { MX_PARTY_ROLES, resolveMxProfile } = await import("./execution/mx-pipeline");
    const partyRoles = MX_PARTY_ROLES[resolveMxProfile(caseType)];
    const ROLE_LABELS: Record<string, { es: string; en: string }> = {
      ministerio_publico: { es: "Ministerio Público", en: "Public Prosecutor" },
      defensa: { es: "Defensa", en: "Defense" },
      quejoso: { es: "Quejoso", en: "Petitioner (Quejoso)" },
      autoridad_responsable: { es: "Autoridad Responsable", en: "Responsible Authority" },
      trabajador: { es: "Trabajador", en: "Employee" },
      patron: { es: "Patrón", en: "Employer" },
      parte_actora: { es: "Parte Actora", en: "Plaintiff" },
      parte_demandada: { es: "Parte Demandada", en: "Defendant" },
      contribuyente: { es: "Contribuyente", en: "Taxpayer" },
      autoridad_fiscal: { es: "Autoridad Fiscal", en: "Tax Authority" },
      particular: { es: "Particular", en: "Private Party" },
      autoridad: { es: "Autoridad", en: "Authority" },
      apelante: { es: "Apelante", en: "Appellant" },
      apelado: { es: "Apelado", en: "Appellee" },
      ambas: { es: "Ambas Partes", en: "Both Parties" },
    };
    const roleLabel = (key: string) => ROLE_LABELS[key]?.[locale] ?? key;

    // Category-filtered finding lists so each section shows only relevant findings.
    // NOTE: filters on category_key (locale-independent machine token), not
    // category (the Mexican-Spanish display label attorneys see in the UI).
    // Filtering on `category` here previously matched nothing for MX cases,
    // since that column holds labels like "Testimonio de Testigo" rather
    // than the English tokens ("missing_evidence", "discovery_gap") this
    // list was written against — see classify.server.ts for the split.
    const byCategory = (cats: string[]) =>
      [...findings]
        .filter((f) => cats.includes(String((f as any).category_key ?? "")))
        .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0))
        .slice(0, 5)
        .map((f) => `- (${f.severity}) ${f.title} — ${(f as any).legal_significance ?? f.category}`)
        .join("\n");

    const byParty = (party: string) =>
      [...findings]
        .filter((f) => (f as any).affected_party === party || (f as any).affected_party === partyRoles.neutral)
        .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0))
        .slice(0, 5)
        .map((f) => `- (${f.severity}) ${f.title}`)
        .join("\n");

    const noContent =
      locale === "en"
        ? "No verified findings in this category. Upload additional source documents and re-run the pipeline."
        : "No se identificaron hallazgos verificados en esta categoría. Suba fuentes documentales adicionales y vuelva a ejecutar el proceso.";

    prose.executive_summary =
      prose.executive_summary ||
      (locale === "en"
        ? `This report identifies ${findings.length} verified finding(s) across ${docIndex.length} source document(s). The highest-priority issues requiring attorney attention:\n\n${bullets || noContent}`
        : `Este informe identifica ${findings.length} hallazgo(s) verificado(s) en ${docIndex.length} documento(s) fuente. Las cuestiones de mayor prioridad que requieren atención del abogado:\n\n${bullets || noContent}`);

    prose.attorney_summary =
      prose.attorney_summary ||
      (locale === "en"
        ? `Verified findings requiring attorney review (${findings.length} total):\n\n${bullets || noContent}`
        : `Hallazgos verificados que requieren revisión del abogado (${findings.length} en total):\n\n${bullets || noContent}`);

    prose.investigator_summary =
      prose.investigator_summary ||
      (locale === "en"
        ? `Agent analysis summary:\n${agentLines || "No agent output available."}\n\nTop verified findings:\n${bullets || noContent}`
        : `Resumen del análisis de agentes:\n${agentLines || "No hay resultados de agentes disponibles."}\n\nPrincipales hallazgos verificados:\n${bullets || noContent}`);

    prose.case_overview =
      prose.case_overview ||
      (locale === "en"
        ? `Case type: ${caseType}. Document corpus: ${docIndex.length} document(s) reviewed.\n${docLines || "No documents indexed."}\n\nVerified issues identified: ${findings.length}.`
        : `Materia: ${caseType}. Corpus documental: ${docIndex.length} documento(s) revisado(s).\n${docLines || "No hay documentos indexados."}\n\nCuestiones verificadas identificadas: ${findings.length}.`);

    prose.evidence_summary =
      prose.evidence_summary ||
      (locale === "en"
        ? `Evidence Inventory\n${docLines || "No extracted document index available."}`
        : `Inventario de Evidencia\n${docLines || "No hay índice de documentos extraídos disponible."}`);

    prose.timeline_summary =
      prose.timeline_summary ||
      (locale === "en"
        ? `Timeline Reconstruction\n${timelineLines || "No dated timeline events were extracted from the uploaded documents."}`
        : `Reconstrucción Cronológica\n${timelineLines || "No se extrajeron eventos cronológicos con fecha de los documentos proporcionados."}`);

    prose.contradiction_report =
      prose.contradiction_report ||
      (byCategory(["contradiction"])
        ? `${locale === "en" ? "Verified Contradictions" : "Contradicciones Verificadas"}\n${byCategory(["contradiction"])}`
        : locale === "en"
          ? "No verified factual contradictions survived evidence validation. This may reflect consistent accounts or insufficient document coverage."
          : "Ninguna contradicción fáctica verificada superó la validación de evidencia. Esto puede reflejar relatos consistentes o cobertura documental insuficiente.");

    prose.discovery_analysis =
      prose.discovery_analysis ||
      (byCategory(["missing_evidence", "discovery_gap"])
        ? `${locale === "en" ? "Discovery Gaps" : "Vacíos Probatorios"}\n${byCategory(["missing_evidence", "discovery_gap"])}`
        : locale === "en"
          ? "No verified discovery gaps were identified in the uploaded documents."
          : "No se identificaron vacíos probatorios verificados en los documentos proporcionados.");

    prose.missing_evidence_report =
      prose.missing_evidence_report ||
      (locale === "en"
        ? "Review the Evidence Coverage section for missing or unextracted documents. Upload additional materials and re-run the pipeline to expand this analysis."
        : "Consulte la sección de Cobertura de Evidencia para conocer los documentos faltantes o no extraídos. Suba materiales adicionales y vuelva a ejecutar el proceso para ampliar este análisis.");

    prose.procedural_issues_report =
      prose.procedural_issues_report ||
      (byCategory(["procedural"])
        ? `${locale === "en" ? "Procedural Issues" : "Cuestiones Procesales"}\n${byCategory(["procedural"])}`
        : locale === "en"
          ? "No verified procedural issues survived evidence validation."
          : "Ninguna cuestión procesal verificada superó la validación de evidencia.");

    prose.witness_analysis =
      prose.witness_analysis ||
      (byCategory(["witness"])
        ? `${locale === "en" ? "Witness Findings" : "Hallazgos de Testigos"}\n${byCategory(["witness"])}`
        : agentLines
          ? `${locale === "en" ? "Agent Summary" : "Resumen del Agente"}\n${agentLines}`
          : locale === "en"
            ? "No witness-specific findings were produced. Upload witness statements, depositions, or interview transcripts and re-run."
            : "No se generaron hallazgos específicos de testigos. Suba declaraciones de testigos, testimoniales o transcripciones de entrevistas y vuelva a ejecutar.");

    prose.prosecution_theory_report =
      prose.prosecution_theory_report ||
      (locale === "en"
        ? `${roleLabel(partyRoles.a)} Theory\nFindings that may support ${roleLabel(partyRoles.a)}:\n\n${byParty(partyRoles.a) || noContent}`
        : `Teoría de la ${roleLabel(partyRoles.a)}\nHallazgos que pueden respaldar a la ${roleLabel(partyRoles.a)}:\n\n${byParty(partyRoles.a) || noContent}`);

    prose.defense_theory_report =
      prose.defense_theory_report ||
      (locale === "en"
        ? `${roleLabel(partyRoles.b)} Theory\nFindings that may support ${roleLabel(partyRoles.b)}:\n\n${byParty(partyRoles.b) || noContent}`
        : `Teoría de la ${roleLabel(partyRoles.b)}\nHallazgos que pueden respaldar a la ${roleLabel(partyRoles.b)}:\n\n${byParty(partyRoles.b) || noContent}`);

    prose.alternative_theory_report =
      prose.alternative_theory_report ||
      (locale === "en"
        ? "Alternative Theory\nInsufficient verified evidence for alternative theory generation. Upload additional documents and re-run."
        : "Teoría Alternativa\nEvidencia verificada insuficiente para generar una teoría alternativa. Suba documentos adicionales y vuelva a ejecutar.");

    prose.risk_analysis =
      prose.risk_analysis || `${locale === "en" ? "Risk Analysis" : "Análisis de Riesgo"}\n${scoreLine}`;

    prose.facts =
      prose.facts ||
      (locale === "en"
        ? "Insufficient evidence to draft a facts narrative without verbatim source quotes."
        : "Evidencia insuficiente para redactar una narrativa de hechos sin citas textuales de la fuente.");

    prose.recommendations =
      prose.recommendations ||
      `${locale === "en" ? "Prioritized Recommendations" : "Recomendaciones Prioritarias"}\n${bullets || noContent}`;

    prose.score_breakdown =
      prose.score_breakdown ||
      "See deterministic scorecard in the full report payload — every dimension lists its baseline, contributors, and formula.";

    prose.appendix_sources =
      prose.appendix_sources || `Appendix Sources\n${docLines || "No source documents indexed."}`;
  }
  void salvageAttempted;

  const pick = (k: string) => (typeof prose[k] === "string" ? (prose[k] as string) : "");

  const docNToId = new Map(docIndex.map((d) => [d.doc_n, d.document_id]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolveCites = (arr: any): any => {
    if (!Array.isArray(arr)) return [];
    return arr.map((c) => {
      if (!c || typeof c !== "object") return c;
      const out = { ...c };
      if (typeof out.doc_n === "number" && !out.document_id) out.document_id = docNToId.get(out.doc_n) ?? null;
      if (Array.isArray(out.citations)) {
        out.citations = out.citations.map((cc: unknown) => {
          if (cc && typeof cc === "object") {
            const x = cc as Record<string, unknown>;
            if (typeof x.doc_n === "number" && !x.document_id) x.document_id = docNToId.get(x.doc_n as number) ?? null;
            return x;
          }
          return cc;
        });
      }
      return out;
    });
  };

  let citations = resolveCites(parsed.citations);
  // Backfill from findings whenever the LLM's citations array is thin, not
  // only when it is completely empty. A partial array (e.g. 2 entries when
  // the prose references far more sources) used to ship as-is, leaving the
  // "Appendix: Source Citations" section silently incomplete — the one
  // section whose entire purpose is letting a reviewer verify every claim.
  // Findings-derived rows are merged in and deduped by quote text so nothing
  // is shown twice. Mirrors the merge-not-replace fix already applied to
  // evidenceIndex just below.
  const findingsCitations = findings
    .flatMap((f: any, i) => {
      const refs = Array.isArray(f.evidence_refs) ? f.evidence_refs : [];
      return refs.slice(0, 3).map((ref: any, j: number) => ({
        id: `F${i + 1}-${j + 1}`,
        doc_n: typeof ref.doc_n === "number" ? ref.doc_n : null,
        document_id: ref.document_id ?? ref.doc_id ?? f.source_document_id ?? null,
        page: typeof ref.page === "number" ? ref.page : typeof f.source_page === "number" ? f.source_page : 1,
        quote: ref.quote ?? f.source_quote ?? "",
        topic: f.title ?? f.category ?? "Finding",
        finding_id: f.id ?? null,
      }));
    })
    .filter((c: any) => typeof c.quote === "string" && c.quote.trim().length > 0);
  if (!citations.length) {
    citations = findingsCitations;
  } else {
    const seenQuotes = new Set(
      citations.map((c: any) => (typeof c.quote === "string" ? c.quote.trim().toLowerCase() : "")).filter(Boolean),
    );
    const extra = findingsCitations.filter((c) => !seenQuotes.has(c.quote.trim().toLowerCase()));
    citations = citations.concat(extra);
  }
  let evidenceIndex = resolveCites(parsed.evidence_index);
  {
    // Backfill every document missing from the LLM's evidence_index, rather
    // than only substituting when the array is entirely empty. In practice
    // the model frequently returns a PARTIAL evidence_index — e.g. only the
    // one document tied to a flagged chain-of-custody or contradiction
    // finding — and silently omits the rest of the corpus. An "only if
    // empty" check let 3-of-4 real documents vanish from the Evidence Map
    // whenever the model produced even a single entry. Every ingested
    // document must appear in the map: LLM-authored entries are kept as-is,
    // and any doc_n not covered gets the same metadata-only placeholder the
    // old fully-empty fallback used.
    const coveredDocNs = new Set(
      evidenceIndex.map((e: any) => (typeof e?.doc_n === "number" ? e.doc_n : null)).filter((n: unknown) => n !== null),
    );
    const missing = docIndex.filter((d) => !coveredDocNs.has(d.doc_n));
    if (missing.length) {
      const placeholders = missing.map((d) => ({
        doc_n: d.doc_n,
        document_id: d.document_id,
        filename: d.filename,
        type: "source_document",
        role: "neutral",
        key_pages: Array.from({ length: Math.min(d.pages || 1, 5) }, (_, i) => i + 1),
        page_count: d.pages,
        summary: "",
        summary_source: "metadata_only",
        supports: [],
        undermines: [],
      }));
      evidenceIndex = [...evidenceIndex, ...placeholders].sort((a: any, b: any) => (a?.doc_n ?? 0) - (b?.doc_n ?? 0));
    }
  }

  const contradictionsRaw = resolveCites(parsed.contradictions);
  const missingEvidenceRaw = Array.isArray(parsed.missing_evidence) ? parsed.missing_evidence : [];
  const constIssuesRaw = isCriminalOrCivilRights ? resolveCites(parsed.constitutional_issues) : [];
  const motionsRaw = resolveCites(parsed.motion_opportunities);
  const crossExamRaw = Array.isArray(parsed.cross_examination) ? parsed.cross_examination : [];
  const strategy = Array.isArray(parsed.strategy_recommendations) ? parsed.strategy_recommendations : [];
  const nextActions = Array.isArray(parsed.next_actions)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parsed.next_actions as any[]).slice().sort((a, b) => (a?.order ?? 99) - (b?.order ?? 99))
    : [];

  // === Anti-hallucination validation pass ===
  // Every structured claim must cite a quote that actually exists in the
  // extracted corpus. Items whose quotes cannot be verified are dropped.
  await setCase(db, caseId, { status_message: "Validating evidence citations", progress: 90 });
  const { buildGroundingCorpus, verifyQuote } = await import("./intelligence/grounding.server");
  const { confidenceLabel } = await import("./intelligence/scoring.server");
  const { data: docsForReportGround } = await db
    .from("documents")
    .select("id,filename,extracted_text")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const reportCorpus = buildGroundingCorpus(
    (docsForReportGround ?? []).map((d) => ({
      id: d.id as string,
      filename: d.filename,
      extracted_text: d.extracted_text,
    })),
  );
  const verifyAndLabel = <T extends Record<string, unknown>>(
    arr: T[],
    quoteFields: Array<string | string[]>,
  ): Array<T & { quote_verified: boolean; confidence_label: string; insufficient_evidence?: true }> => {
    const out: Array<T & { quote_verified: boolean; confidence_label: string; insufficient_evidence?: true }> = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      // Collect every quote referenced anywhere on the item.
      const quotes: string[] = [];
      const pushFromPath = (path: string | string[]) => {
        const segs = Array.isArray(path) ? path : path.split(".");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cur: any = item;
        for (const s of segs) cur = cur?.[s];
        if (typeof cur === "string") quotes.push(cur);
      };
      for (const f of quoteFields) pushFromPath(f);
      // Always sweep .citations[].quote and top-level .quote. Also sweep
      // .evidence_refs[].quote — a second engine elsewhere in the pipeline
      // (buildPrompt for contradictions/missing_evidence/procedural_issues)
      // uses evidence_refs as its citation array name instead of citations.
      // Both shapes can end up in `parsed` after the intelligence/memo/
      // narrative chunk merge, and this sweep previously only recognized
      // one of them — so on any run where the evidence_refs-shaped version
      // won the merge, every item in that category had zero quotes found
      // here, failed verification, and the whole section (Contradiction
      // Analysis / Constitutional Analysis) silently disappeared from the
      // report with no indication anything had gone wrong.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cites = (item as any).citations;
      if (Array.isArray(cites)) {
        for (const c of cites) if (c && typeof c.quote === "string") quotes.push(c.quote);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evidenceRefs = (item as any).evidence_refs;
      if (Array.isArray(evidenceRefs)) {
        for (const c of evidenceRefs) if (c && typeof c.quote === "string") quotes.push(c.quote);
      }
      const verifiedCount = quotes.filter((q) => verifyQuote(q, reportCorpus)).length;
      const quote_verified = verifiedCount > 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conf = (item as any).confidence ?? (item as any).provenance?.confidence_adjusted;
      const label = confidenceLabel(typeof conf === "number" ? conf : quote_verified ? 0.7 : 0.2);
      if (!quote_verified) {
        // Drop entirely — never publish an unverifiable legal conclusion.
        continue;
      }
      out.push({
        ...item,
        quote_verified,
        confidence_label: label,
      });
    }
    return out;
  };

  const contradictions = verifyAndLabel(contradictionsRaw, [["document_a", "quote"], ["document_b", "quote"], "quote"]);
  // Dispute vs factual classifier — relabel each surviving item so the
  // renderer can split "Factual Contradictions" from "Disputed Issues".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of contradictions as any[]) {
    c.kind = classifyContradiction(c);
  }
  const constIssues = isCriminalOrCivilRights ? verifyAndLabel(constIssuesRaw, ["facts"]) : [];
  const motions = verifyAndLabel(motionsRaw, ["supporting_facts"]);
  const crossExam = crossExamRaw; // questions don't need quote-verification
  // Missing evidence is about *absence* — no corpus quote required, but flag confidence.
  const missingEvidence = (missingEvidenceRaw as Record<string, unknown>[]).map((m) => ({
    ...m,
    confidence_label: confidenceLabel(typeof (m as any).confidence === "number" ? (m as any).confidence : 0.6),
  }));

  // === Claim-Strength Guardrail ===========================================
  // Enforces: no generated sentence may make a stronger claim than its strongest
  // cited source. Adds Tier-5 legal-risk corroboration, intent-inference block,
  // evidence-type ceilings, source-span validation, and red-team rewrite.
  await setCase(db, caseId, { status_message: "Applying claim-strength guardrail", progress: 92 });
  const { enforceStructuredItems, enforceProse } = await import("./intelligence/claim-strength.server");
  const guardOpts = { corpus: reportCorpus, requireSupport: false };

  const contradictionsGuarded = enforceStructuredItems(contradictions, guardOpts);
  const motionsGuarded = enforceStructuredItems(motions, guardOpts);
  const constGuarded = enforceStructuredItems(constIssues, guardOpts);
  const missingGuarded = enforceStructuredItems(missingEvidence, guardOpts);

  // Apply to prose narrative fields where most hallucination risk lives.
  const proseGuardFields = [
    "executive_summary",
    "attorney_summary",
    "investigator_summary",
    "case_overview",
    "facts",
    "witness_analysis",
    "discovery_analysis",
    "procedural_issues_report",
    "prosecution_theory_report",
    "defense_theory_report",
    "alternative_theory_report",
    "risk_analysis",
    "score_breakdown",
    "recommendations",
    "evidence_summary",
    "timeline_summary",
    "contradiction_report",
    "missing_evidence_report",
  ];
  const proseAudit: Record<string, { softened: number; dropped: number }> = {};
  for (const f of proseGuardFields) {
    const v = prose[f];
    if (typeof v !== "string" || !v.trim()) continue;
    // appendNote:false — don't let enforceProse bake its own note into
    // every section. Totals are aggregated below and appended ONCE at the
    // end of the report instead of once per section.
    const r = enforceProse(v, { ...guardOpts, appendNote: false });
    prose[f] = r.text;
    proseAudit[f] = { softened: r.softenedCount, dropped: r.droppedCount };
  }

  // Single report-level guardrail note, built from the totals above,
  // appended once to whichever narrative section renders last
  // (Recommendations, falling back to Executive Summary), so the reader
  // sees it exactly once regardless of how many sections were touched.
  {
    const { formatGuardrailNote } = await import("./intelligence/claim-strength.server");
    const totalSoftened = Object.values(proseAudit).reduce((a, x) => a + x.softened, 0);
    const totalDropped = Object.values(proseAudit).reduce((a, x) => a + x.dropped, 0);
    if (totalSoftened > 0 || totalDropped > 0) {
      const noteTarget =
        typeof prose["recommendations"] === "string" && prose["recommendations"].trim()
          ? "recommendations"
          : "executive_summary";
      if (typeof prose[noteTarget] === "string") {
        prose[noteTarget] = `${prose[noteTarget]}\n\n${formatGuardrailNote(totalSoftened, totalDropped)}`;
      }
    }
  }

  // === Evidence Sufficiency Score + Secondary Validation + Length Caps ====
  // Sparse evidence MUST produce sparse reports. This block computes ESS,
  // strips any prose sentence that does not trace back to the corpus, and
  // hard-caps each section to the bin's maximum length.
  await setCase(db, caseId, { status_message: "Scoring evidence sufficiency", progress: 94 });
  const { computeESS, detectDocTypeSignals, validateProseAgainstCorpus, capNarrative } =
    await import("./intelligence/sufficiency.server");

  const extractedChars = (docsForReportGround ?? []).reduce(
    (n, d) => n + (typeof d.extracted_text === "string" ? d.extracted_text.length : 0),
    0,
  );
  const pageCountTotal = docIndex.reduce((n, d) => n + Math.max(1, d.pages || 1), 0);
  const corpusFullText = (docsForReportGround ?? []).map((d) => d.extracted_text ?? "").join("\n");
  // Count facts corroborated by ≥2 documents (heuristic: distinct doc ids on finding citations).
  let corroboratedCount = 0;
  for (const f of findings as Array<{ source_doc_ids?: unknown }>) {
    const ids = Array.isArray(f.source_doc_ids) ? f.source_doc_ids : [];
    if (new Set(ids).size >= 2) corroboratedCount += 1;
  }
  // Recalibration signals — high-weight doc types, charging documents, and
  // distinct document type breadth. These promote the case to Full Analysis
  // even when the raw character/fact metrics would otherwise land in
  // low/minimal bins (e.g. a concise but litigation-ready indictment).
  const docTypeSignals = detectDocTypeSignals(
    (docsForReportGround ?? []).map((d) => ({
      filename: (d as { filename?: string }).filename ?? null,
      extracted_text: (d as { extracted_text?: string }).extracted_text ?? null,
    })),
  );
  const ess = computeESS({
    documentCount: docIndex.length,
    pageCount: pageCountTotal,
    extractedChars,
    factCount: findings.length,
    contradictionCount: contradictionsGuarded.items.length,
    corroboratedCount,
    hasChargingDocument: docTypeSignals.hasChargingDocument,
    highWeightDocTypeCount: docTypeSignals.highWeightDocTypeCount,
    distinctDocTypeCount: docTypeSignals.distinctDocTypeCount,
  });

  // Secondary validator: drop sentences that can't be traced to the corpus.
  const validatorAudit: Record<string, { kept: number; dropped: number }> = {};
  for (const f of proseGuardFields) {
    const v = prose[f];
    if (typeof v !== "string" || !v.trim()) continue;
    if (!r) {
      validatorAudit[f] = { kept: v.split(/(?<=[.!?])\s+/).filter(Boolean).length, dropped: 0 };
      continue;
    }
    const validated = validateProseAgainstCorpus(v, corpusFullText);
    // Never allow validation to blank a section. If the validator removes the
    // whole section, keep an explicit evidence-limited version so PDF export is
    // still complete while the audit records the dropped sentences.
    prose[f] =
      validated.text ||
      capNarrative(v, 900, "Section preserved in abbreviated form after validation removed unsupported expansion.");
    validatorAudit[f] = { kept: validated.kept, dropped: validated.dropped };
  }

  // ESS-driven length caps per section.
  for (const f of proseGuardFields) {
    const v = prose[f];
    if (typeof v !== "string") continue;
    prose[f] = capNarrative(v, ess.maxCharsPerSection);
  }

  // If the LLM hallucinated constitutional issues into a civil case, suppress
  // the prose narrative as well so the report can't reintroduce them through
  // the markdown surface.
  //
  // IMPORTANT: this prose field previously came straight from `pick(...)` —
  // the model's own paragraph, verbatim, including any [DOC N p.N] citation
  // tags it invented. `constGuarded` (built above) is the ONLY citation-
  // verified source of truth for constitutional issues — every item in it
  // has already survived `verifyAndLabel` (quote must exist in the corpus)
  // and `enforceStructuredItems` (claim-strength guardrail). The struct and
  // the prose must never diverge, so the prose is now deterministically
  // rebuilt FROM the verified struct rather than passed through from the
  // model. An item that didn't survive verification cannot appear here,
  // full stop — there is no separate unverified channel left to leak it in.
  const buildConstitutionalProseFromStruct = (items: Array<Record<string, unknown>>): string => {
    if (!items.length) {
      return "No constitutional issues in the corpus survived citation verification. Any constitutional claims the model may have drafted lacked a quote that could be matched to the case documents and were withheld rather than published unverified.";
    }
    return items
      .map((it) => {
        const right = typeof it.right === "string" ? it.right : "";
        const amendment = typeof it.amendment === "string" ? it.amendment : "";
        const issue = typeof it.issue === "string" ? it.issue : "";
        const facts = typeof it.facts === "string" ? it.facts : "";
        const legalStandard = typeof it.legal_standard === "string" ? it.legal_standard : "";
        const likelyOutcome = typeof it.likely_outcome === "string" ? it.likely_outcome : "";
        const heading = [amendment, right].filter(Boolean).join(" — ") || issue || "Constitutional issue";
        const citations = Array.isArray(it.citations) ? it.citations : [];
        const citeTags = citations
          .filter((c): c is { doc_n?: number; page?: number } => !!c && typeof c === "object")
          .map((c) =>
            typeof c.doc_n === "number" ? `[DOC ${c.doc_n}${typeof c.page === "number" ? ` p.${c.page}` : ""}]` : null,
          )
          .filter((s): s is string => !!s)
          .join(" ");
        const parts = [
          `${heading}.`,
          issue && issue !== heading ? issue : "",
          facts,
          legalStandard ? `Legal standard: ${legalStandard}.` : "",
          likelyOutcome ? `Likely outcome: ${likelyOutcome}.` : "",
          citeTags,
        ].filter(Boolean);
        return parts.join(" ");
      })
      .join("\n\n");
  };
  const constProseOverride = isCriminalOrCivilRights
    ? buildConstitutionalProseFromStruct(constGuarded.items as Array<Record<string, unknown>>)
    : "Insufficient evidence to determine whether a constitutional issue exists. This case type does not implicate constitutional analysis.";

  // ===== SINGLE REPORT MODE (authoritative state) =====
  // One state, computed once, applied everywhere. A report is either FULL
  // or LIMITED — never both. Every section, score, footer, recommendation,
  // and export reflects the same value.
  // A suppressed case_scores row (PIPELINE_NOT_FINALIZED / CANONICAL_FINDINGS_EMPTY
  // / INVALID_PIPELINE_ORDER — see _runScoringInner) sets rationale.flags to a
  // non-empty array and never populates it on a real, successful scoring run.
  // If scoring itself was suppressed, the report must not independently invent
  // a case_strength_score/risk_score via the narrative LLM call below — fold
  // this into the single reportMode decision so every downstream consumer
  // (gatedScore, motionsFinal, scores_suppressed) inherits it automatically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoreFlags = (score as any)?.rationale?.flags;
  const scoreSuppressed = Array.isArray(scoreFlags) && scoreFlags.length > 0;
  // 2026-07-30 fix: this used to gate on `!r` (the raw narrativeRes return
  // value). That is exactly the anti-pattern flagged twice earlier in this
  // same function (see the comments above `r = narrativeRes` and above the
  // `!chunkStatus.narrative.ok` checks): `r`/`narrativeRes` legitimately
  // comes back `null` from `runChunk` whenever the narrative chunk resumed
  // from `report_chunk_cache` on a later worker tick — a SUCCESS, not a
  // failure. Any report whose "report" stage needed more than one worker
  // tick (routine for reasoning-model narrative generation — see
  // WORKER_INVOCATION_BUDGET_MS / MAX_REPORT_CHECKPOINTS) hit `!r` here and
  // was silently downgraded to LIMITED — scores, recommendations, and
  // theory sections suppressed — even when `ess` said the case fully
  // qualified for FULL analysis (fullAnalysisOverride/allowQuantitativeScores/
  // allowMotionGeneration all true). `chunkStatus.narrative.ok` is the
  // correct signal: true whether the chunk came from a fresh call or a
  // legitimate cache resume, false only on a real failure.
  const reportMode: "FULL" | "LIMITED" =
    !chunkStatus.narrative.ok ||
    !ess.allowQuantitativeScores ||
    !ess.allowMotionGeneration ||
    ess.bin === "minimal" ||
    scoreSuppressed
      ? "LIMITED"
      : "FULL";
  const isLimited = reportMode === "LIMITED";

  // Motion / scoring governance gates — in LIMITED mode, gated prose is
  // cleared entirely so suppressed content can never leak into the export.
  const motionsFinal = isLimited ? [] : motionsGuarded.items;
  if (isLimited) {
    // Fields gated in LIMITED mode are wiped — we skip generation rather
    // than soft-hiding. The export layer renders a single suppression line.
    prose["recommendations"] = "";
    prose["score_breakdown"] = "";
    prose["risk_analysis"] = "";
    prose["prosecution_theory_report"] = "";
    prose["defense_theory_report"] = "";
    prose["alternative_theory_report"] = "";

    // FIX: parsed.executive_summary is a STRUCTURED object (see the
    // "executive_summary" shape in the LLM output contract above —
    // { dispositive_recommendation, case_strength, primary_risk,
    // urgent_actions }). It flows into full_report via `...parsed` further
    // below, completely bypassing both this prose-wipe block (which only
    // touches the flat `prose[...]` narrative strings) and `gatedScore`
    // (which only nulls the top-level numeric `case_strength_score` /
    // `risk_score` fields). Until now, that meant a LIMITED report could
    // still show a case-strength verdict and a primary-risk line pulled
    // straight from the model, in every consumer that reads
    // `full_report.executive_summary` (report UI, Word memo export, PDF
    // memo export) — even while the numeric scorecard correctly showed
    // "suppressed". Null the score-bearing sub-fields here so every
    // downstream consumer's existing `if (exec.case_strength)` /
    // `if (exec.primary_risk)` guard naturally skips rendering them.
    if (parsed.executive_summary && typeof parsed.executive_summary === "object") {
      const execObj = parsed.executive_summary as Record<string, unknown>;
      execObj.case_strength = null;
      execObj.primary_risk = null;
      // dispositive_recommendation and urgent_actions are left intact:
      // they're procedural/action-oriented ("investigate X further"), not
      // a verdict on the merits, so they remain useful even in LIMITED mode.
    }

    // FIX (2nd instance of the same class of bug): `parsed.legal_memorandum`
    // is produced by an ENTIRELY SEPARATE LLM call (see the dedicated
    // memoSysSuffix prompt above — "You generate ONLY the legal_memorandum
    // object in this call"), merged into `parsed` via the salvage path, and
    // flows into `full_report.legal_memorandum` through the same `...parsed`
    // spread as executive_summary did. It was never touched by this
    // isLimited block, so a LIMITED-mode report could still carry a
    // fully-drafted Motion for Summary Judgment (with a ready-to-file
    // paragraph), a damages conclusion, IRAC legal_analysis, and a
    // duplicate case_strength/dispositive_recommendation inside
    // memo.executive_summary — every one of these is exactly the
    // "quantitative scorecards, motion drafting, theory selection, and
    // prioritized recommendations" the Executive Summary narrative tells
    // the reader was withheld. `caption`, `statement_of_facts`, and
    // `evidence_appendix` are left intact — they're verbatim/factual, not
    // inferred legal theory, and remain useful in LIMITED mode.
    if (parsed.legal_memorandum && typeof parsed.legal_memorandum === "object") {
      const memoObj = parsed.legal_memorandum as Record<string, unknown>;
      memoObj.recommended_motions = [];
      memoObj.risk_matrix = [];
      memoObj.legal_analysis = [];
      if (memoObj.executive_summary && typeof memoObj.executive_summary === "object") {
        const memoExec = memoObj.executive_summary as Record<string, unknown>;
        memoExec.case_strength = null;
        memoExec.primary_risk = null;
        memoExec.dispositive_recommendation = null; // this field routinely contains
        // a literal "File a Motion for X" instruction — motion drafting, not
        // procedural housekeeping, so unlike the top-level executive_summary
        // above, it is suppressed here rather than kept.
      }
    }
  }

  const clampScore = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
  const gatedScore = (v: unknown) => (isLimited ? null : clampScore(v));
  if (ess.insufficientEvidenceNotice) {
    prose["executive_summary"] = `${ess.insufficientEvidenceNotice}\n\n${prose["executive_summary"] ?? ""}`.trim();
  }

  // Legal-precision sweep: strip unsupported amplifications (e.g. neutral
  // "requests custody" being upgraded to "seeks SOLE custody") from every
  // prose field unless the amplified phrase appears verbatim in the corpus.
  for (const f of proseGuardFields) {
    const v = prose[f];
    if (typeof v !== "string") continue;
    prose[f] = stripUnsupportedAmplification(v, corpusFullText);
  }

  // Split contradictions vs disputed-issues for downstream renderers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allContradictions = contradictionsGuarded.items as any[];
  const { classifyContradictionQuality } = await import("./intelligence/dispute-classifier.server");
  for (const c of allContradictions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).contradiction_quality = classifyContradictionQuality({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      document_a: (c as any).document_a,
      document_b: (c as any).document_b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      title: (c as any).title,
      description: (c as any).description,
      nature: (c as any).nature,
    });
  }
  const factualContradictions = allContradictions.filter((c) => c.kind !== "disputed_issue");
  const disputedIssues = allContradictions.filter((c) => c.kind === "disputed_issue");

  // Per-sub-engine audit rows so the dashboard can prove each engine ran.
  const now = new Date().toISOString();
  const subRow = (
    engine: string,
    generated: number,
    accepted: number,
    suppressed_ess = 0,
    meta: Record<string, unknown> = {},
  ) => ({
    case_id: caseId,
    user_id: userId,
    engine,
    status: "completed" as const,
    started_at: now,
    ended_at: now,
    runtime_ms: 0,
    generated,
    accepted,
    rejected: Math.max(0, generated - accepted),
    suppressed_ess,
    suppressed_validator: 0,
    meta: meta as never,
  });
  const motionsSuppressed = ess.allowMotionGeneration ? 0 : motionsGuarded.items.length;
  const motionsAccepted = ess.allowMotionGeneration ? motionsGuarded.items.length : 0;
  const totalProseDropped = Object.values(validatorAudit).reduce((n, x) => n + (x?.dropped ?? 0), 0);
  await db.from("pipeline_engine_runs").insert([
    subRow(
      "theory",
      Array.isArray(theories) ? (theories as unknown[]).length : 0,
      Array.isArray(theories) ? (theories as unknown[]).length : 0,
    ),
    subRow(
      "strategy",
      Array.isArray(strategyRows) ? (strategyRows as unknown[]).length : 0,
      Array.isArray(strategyRows) ? (strategyRows as unknown[]).length : 0,
    ),
    subRow(
      "opportunity",
      Array.isArray(opps) ? (opps as unknown[]).length : 0,
      Array.isArray(opps) ? (opps as unknown[]).length : 0,
    ),
    subRow("motion", motionsRaw.length, motionsAccepted, motionsSuppressed, {
      gate: ess.allowMotionGeneration ? "open" : "ess_blocked",
    }),
    subRow("ess_validator", findings.length, findings.length, 0, {
      bin: ess.bin,
      score: ess.score,
      allowMotion: ess.allowMotionGeneration,
      allowScores: ess.allowQuantitativeScores,
    }),
    subRow(
      "claim_validator",
      contradictionsRaw.length + motionsRaw.length + constIssuesRaw.length,
      contradictionsGuarded.items.length + motionsGuarded.items.length + constGuarded.items.length,
      0,
      { prose_audit: proseAudit },
    ),
    subRow("report_validator", contradictionsRaw.length, contradictions.length, 0, {
      secondary_validator_dropped: totalProseDropped,
      validator_audit: validatorAudit,
    }),
    // The Contradiction Analysis section of the rendered report is built
    // from `factualContradictions` (the narrative LLM's own structured
    // "contradictions" output, post dispute-classification), NOT from
    // case_findings rows written by an "analyzer_contradictions" pass.
    //
    // FIX (2026-07-29): this used to write under the SAME engine name,
    // "contradictions", that deriveContradictions() (derived-engines.
    // server.ts) also writes to. Both are legitimate, different metrics —
    // deriveContradictions() counts real analyzer:contradiction rows in
    // case_findings; this counts the narrative writer's own structured
    // output — but sharing one ledger key meant whichever ran LAST won,
    // and since report generation runs after the analyzers stage, this
    // row would silently overwrite a correct nonzero deriveContradictions()
    // result with 0 whenever factualContradictions happened to be empty
    // (confirmed live: case 52d7797e — deriveContradictions() correctly
    // found 2 at 06:18:55, this row overwrote it with 0 at 06:26:09,
    // and the final report/dashboard read the latter). Renamed to a
    // distinct engine key; AGENT_ENGINE_MAP.contradictions in
    // statistics.server.ts now includes this new key alongside the
    // original two, so the Agent Statistics card still aggregates all
    // three sources (preserving the original fix's intent) without any
    // of them being able to clobber another.
    subRow("report_contradictions", contradictionsRaw.length, factualContradictions.length),
  ]);

  // NOTE: we intentionally do NOT flip the report_generator row to
  // "completed" here. The runEngine wrapper does that as the very last
  // step, AFTER reports.upsert has been confirmed. Marking it complete
  // early creates a window where the ledger says "done" but the report
  // row hasn't been written yet — and if the process is killed in that
  // window, the run appears successful while artifacts are missing.
  // buildEnginesSummary below will show report_generator as "running"
  // in the embedded snapshot, which is correct — the run isn't done
  // until this function returns.
  const enginesSummary = await buildEnginesSummary(db, caseId);

  const { buildAgentStatistics } = await import("./agents/statistics.server");
  const agentStatistics = await buildAgentStatistics(db, caseId);

  // --- CITATION VALIDATOR (Fix 2) ---
  // Regex-scan the merged report for [DOC N p.M] and verify every reference
  // resolves to a real (doc, page) pair from the extracted corpus. Orphaned
  // citations are logged as pipelineWarnings and stashed on the report so
  // attorneys see them in the audit appendix.
  const citationRegex = /\[DOC\s+(\d+)\s+p\.(\d+)\]/g;
  const reportJsonForAudit = JSON.stringify(parsed);
  const proseCitations = [...reportJsonForAudit.matchAll(citationRegex)];
  const orphanedCitations: string[] = [];
  for (const [, docNStr, pageStr] of proseCitations) {
    const docN = Number(docNStr);
    const page = Number(pageStr);
    const doc = docIndex.find((d) => d.doc_n === docN);
    if (!doc) {
      orphanedCitations.push(`[DOC ${docN} p.${page}] — document not found`);
    } else if (doc.pages < page) {
      orphanedCitations.push(`[DOC ${docN} p.${page}] — page ${page} exceeds ${doc.pages} pages`);
    }
  }
  if (orphanedCitations.length) {
    pipelineWarnings.push(`orphaned_citations:${orphanedCitations.length}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed as any)._citation_audit_prose = {
      orphaned: orphanedCitations.slice(0, 50),
      total_prose_citations: proseCitations.length,
      orphan_count: orphanedCitations.length,
    };
  }

  // --- FINDINGS COVERAGE GATE (Fix 3) ---
  // Mechanically verify every extracted finding id appears somewhere in the
  // final report. Uncovered findings are the "we missed the smoking gun"
  // failure mode; surface them explicitly so attorney review catches them.
  const findingIds = findings.map((f) => f.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  const uncoveredFindings = findingIds.filter((id) => !reportJsonForAudit.includes(id));
  if (uncoveredFindings.length) {
    pipelineWarnings.push(`uncovered_findings:${uncoveredFindings.length}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed as any)._coverage_gaps = uncoveredFindings.slice(0, 100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proseAny = (parsed.prose ?? {}) as Record<string, any>;
    if (typeof proseAny.coverage_summary !== "string" || proseAny.coverage_summary.trim().length === 0) {
      proseAny.coverage_summary = `Note: ${uncoveredFindings.length} extracted finding(s) were not incorporated into this report and require attorney review: ${uncoveredFindings.slice(0, 10).join(", ")}${uncoveredFindings.length > 10 ? ", …" : ""}.`;
      parsed.prose = proseAny;
    }
  }

  // Findings audit — aggregated across every validator + dedup pass in this
  // pipeline run. Computed here so it can appear synchronously inside the
  // report object literal below.
  const { readFindingsAudit } = await import("./intelligence/findings.server");
  const findingsAudit = readFindingsAudit(caseId);
  // INVARIANT: every cover/summary stat is derived from the FINAL rendered
  // list length, not carried forward from an earlier pipeline stage. The
  // audit accumulator only contributes suppression/reason breakdowns.
  const renderedFindingsCount = findings.length;
  const suppressedCount = Math.max(0, findingsAudit.suppressed);
  const totalGenerated = Math.max(findingsAudit.total_generated, renderedFindingsCount + suppressedCount);
  const findingsSummary = {
    total_generated: totalGenerated,
    displayed: renderedFindingsCount,
    suppressed: suppressedCount,
    duplicates_merged: findingsAudit.duplicates_merged,
    suppression_reasons: findingsAudit.suppression_reasons,
  };
  // Consistency assertion — logs (never throws) if a downstream renderer's
  // list length ever diverges from the summary. Catches the whole class of
  // "12 findings shown, only 4 rendered" bugs at build time.
  if (findingsSummary.displayed !== renderedFindingsCount) {
    console.warn("[report.audit] findings_summary.displayed !== rendered list length", {
      caseId,
      displayed: findingsSummary.displayed,
      rendered: renderedFindingsCount,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reportRow: any = {
    case_id: caseId,
    user_id: userId,
    // Stamp the language this report's content was generated in, so exports
    // (PDF/DOCX) render their template in the same language and historical
    // reports keep their original language if the case preference changes.
    generated_language: await getReportLocale(db, caseId),

    attorney_summary: pick("attorney_summary"),
    evidence_summary: pick("evidence_summary"),
    timeline_summary: pick("timeline_summary"),
    contradiction_report: pick("contradiction_report"),
    missing_evidence_report: pick("missing_evidence_report"),
    recommendations: pick("recommendations"),
    executive_summary: pick("executive_summary"),
    investigator_summary: pick("investigator_summary"),
    case_overview: pick("case_overview"),
    facts: pick("facts"),
    witness_analysis: pick("witness_analysis"),
    constitutional_issues: constProseOverride,
    discovery_analysis: pick("discovery_analysis"),
    procedural_issues_report: pick("procedural_issues_report"),
    prosecution_theory_report: pick("prosecution_theory_report"),
    defense_theory_report: pick("defense_theory_report"),
    alternative_theory_report: pick("alternative_theory_report"),
    risk_analysis: pick("risk_analysis"),
    score_breakdown: pick("score_breakdown"),
    appendix_sources: pick("appendix_sources"),
    // Full intelligence package — every engine output the platform produced
    full_report: {
      ...parsed,
      case_type: caseType,
      findings_summary: findingsSummary,
      coverage_report: await computeCoverage(db, caseId),
      deterministic_scorecard: computeDeterministicScorecard(
        findings as unknown as Parameters<typeof computeDeterministicScorecard>[0],
        caseType,
      ),
      // Layer 2 — deterministic legal intelligence algorithms. Pure functions,
      // no LLM. The AI layer interprets these signals; it does not invent them.
      deterministic_algorithms: await (async () => {
        try {
          const { runAlgorithmBundle } = await import("./intelligence/algorithms");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tl = Array.isArray((analysis as any)?.timeline) ? (analysis as any).timeline : [];
          // Derive Mexican procedural-remedy signals from the findings the
          // pipeline has already produced — no new AI call, no new upstream
          // data source, just mapping what's already there onto the real
          // Mexican tags. Keyword matching on title/description is a
          // deliberately conservative first pass (only fires on fairly
          // explicit language) — false negatives (missing a real signal)
          // are the safe failure mode here, not false positives.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const motionSignals = (findings as any[])
            .map((f) => {
              const cat = String(f.category ?? "").toLowerCase();
              const text = `${f.title ?? ""} ${f.description ?? ""}`.toLowerCase();
              const sev = (["low", "medium", "high", "critical"].includes(f.severity) ? f.severity : "medium") as
                | "low"
                | "medium"
                | "high"
                | "critical";
              if (cat === "chain_of_custody") return { tag: "cadena_custodia_rota", severity: sev };
              if (cat === "missing_evidence" || cat === "discovery_gap")
                return { tag: "descubrimiento_probatorio_incompleto", severity: sev };
              if (cat === "cumplimiento_procesal") {
                if (/vinculaci[oó]n a proceso/.test(text))
                  return { tag: "vinculacion_proceso_defectuosa", severity: sev };
                if (/control de detenci[oó]n|detenci[oó]n (ilegal|arbitraria)/.test(text))
                  return { tag: "control_detencion_defectuoso", severity: sev };
                if (/medidas? cautelares?/.test(text))
                  return { tag: "medidas_cautelares_desproporcionadas", severity: sev };
                if (/prueba il[ií]cita|il[ií]citamente obtenid/.test(text))
                  return { tag: "prueba_ilicita", severity: sev };
                return { tag: "defecto_procesal", severity: sev };
              }
              return null;
            })
            .filter((s): s is { tag: string; severity: "low" | "medium" | "high" | "critical" } => s !== null);
          return runAlgorithmBundle({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            evidence: (findings as any[]).map((f) => ({
              id: f.id,
              type: f.category,
              source_doc_ids: Array.isArray(f.source_doc_ids) ? f.source_doc_ids : [],
              ocr_confidence: typeof f.confidence === "number" ? f.confidence : undefined,
            })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            witnesses: ((witnesses ?? []) as any[]).map((w) => ({
              id: w.id,
              name: w.name,
              internal_consistency: typeof w.consistency_score === "number" ? w.consistency_score : undefined,
              contradictions: typeof w.contradiction_count === "number" ? w.contradiction_count : 0,
              bias_indicators: Array.isArray(w.bias_indicators) ? w.bias_indicators.length : 0,
            })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            timeline: tl.map((t: any) => ({ date: t.date, event: t.event ?? t.description })),
            motionSignals,
            risk: {
              unresolved_contradictions: factualContradictions.length,
              missing_evidence: missingGuarded.items.length,
              constitutional_issues: constGuarded.items.length,
              unfavorable_witnesses: ((witnesses ?? []) as any[]).filter(
                (w) => typeof w.credibility_risk === "number" && w.credibility_risk >= 60,
              ).length,
              procedural_defects: (findings as any[]).filter(
                (f) => String(f.category ?? "").toLowerCase() === "cumplimiento_procesal",
              ).length,
            },
          });
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      })(),
      timeline: await (async () => {
        try {
          const { data: rows } = await db
            .from("case_timeline_events" as never)
            .select("event_date, description, source_doc_ids, confidence, canonical_id")
            .eq("case_id", caseId)
            .is("superseded_by", null)
            .order("event_date", { ascending: true });
          const list = Array.isArray(rows) ? rows : [];
          if (list.length > 0) {
            return list.map((r: any) => ({
              date: r.event_date,
              event: r.description,
              description: r.description,
              source_doc_ids: r.source_doc_ids ?? [],
              confidence: r.confidence,
              canonical_id: r.canonical_id,
            }));
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tl = Array.isArray((analysis as any)?.timeline) ? (analysis as any).timeline : [];
          return tl;
        } catch {
          return [];
        }
      })(),
      intelligence: {
        consolidated_findings: findings,
        perspectives: perspectives ?? [],
        evidence_classifications: evidenceIntel ?? [],
        strategy_rows: strategyRows ?? [],
        witnesses: witnesses ?? [],
        theories: theories ?? [],
        opportunities: opps ?? [],
        trial_prep: trial ?? null,
        work_product: workProduct ?? [],
        agents: agents ?? [],
      },

      agent_statistics: agentStatistics,
      witness_profiles: await (async () => {
        try {
          const m = await import("./intelligence/report-augment.server");
          return await m.buildWitnessProfiles(db, caseId);
        } catch {
          return [];
        }
      })(),
      legal_issues: await (async () => {
        try {
          const m = await import("./intelligence/report-augment.server");
          return await m.buildLegalIssuesWithCaseLaw(db, caseId);
        } catch {
          return [];
        }
      })(),
      evidence_map_detail: await (async () => {
        try {
          const m = await import("./intelligence/evidence-map.server");
          return await m.buildEvidenceMap(db, caseId);
        } catch {
          return null;
        }
      })(),
      evidence_inventory: await (async () => {
        try {
          const m = await import("./intelligence/report-augment.server");
          return await m.buildEvidenceInventory(db, caseId);
        } catch {
          return [];
        }
      })(),
      attorney_work_product: await (async () => {
        try {
          const m = await import("./intelligence/report-augment.server");
          const [issues, profiles] = await Promise.all([
            m.buildLegalIssues(db, caseId),
            m.buildWitnessProfiles(db, caseId),
          ]);
          return await m.buildWorkProduct(db, caseId, {
            legalIssues: issues,
            witnessProfiles: profiles,
          });
        } catch {
          return null;
        }
      })(),
      validation: {
        report_llm_error: reportLlmError,
        // Same fix as reportMode above: `!r` is true on a legitimate
        // cache-resumed narrative chunk, which is not a fallback. Gate on
        // chunkStatus.narrative.ok instead so this diagnostic field only
        // reflects a REAL deterministic-fallback event.
        deterministic_fallback_used: !chunkStatus.narrative.ok,
        case_type: caseType,
        // --- QUALITY SIGNALS (Fix 5) ---
        // Queryable per-report metrics so quality trends over time can be
        // pulled from pipeline_engine_runs / reports.full_report without
        // reprocessing. All fields are cheap, deterministic, and side-effect
        // free — reading them never triggers additional LLM work.
        quality_signals: {
          chunk_success: {
            narrative: chunkStatus.narrative.ok,
            memo: chunkStatus.memo.ok,
            intelligence: chunkStatus.intelligence.ok,
          },
          chunk_success_rate:
            (Number(chunkStatus.narrative.ok) + Number(chunkStatus.memo.ok) + Number(chunkStatus.intelligence.ok)) / 3,
          chunk_errors: {
            narrative: chunkStatus.narrative.error ?? null,
            memo: chunkStatus.memo.error ?? null,
            intelligence: chunkStatus.intelligence.error ?? null,
          },
          citation_count: proseCitations.length,
          orphaned_citation_count: orphanedCitations.length,
          uncovered_finding_count: uncoveredFindings.length,
          legal_memorandum_present:
            !!parsed.legal_memorandum &&
            typeof parsed.legal_memorandum === "object" &&
            !Array.isArray(parsed.legal_memorandum),
          legal_memorandum_irac_complete: Array.isArray(parsed?.legal_memorandum?.legal_analysis)
            ? parsed.legal_memorandum.legal_analysis.every(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (i: any) =>
                  typeof i?.issue === "string" &&
                  i.issue.length > 0 &&
                  typeof i?.rule === "string" &&
                  i.rule.length > 0 &&
                  typeof i?.application === "string" &&
                  i.application.length > 0 &&
                  typeof i?.conclusion === "string" &&
                  i.conclusion.length > 0 &&
                  Array.isArray(i?.cited_evidence) &&
                  i.cited_evidence.length > 0,
              )
            : false,
          avg_prose_length: (() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = (parsed?.prose ?? {}) as Record<string, any>;
            const strs = Object.values(p).filter((v): v is string => typeof v === "string");
            if (!strs.length) return 0;
            return Math.round(strs.reduce((a, b) => a + b.length, 0) / strs.length);
          })(),
        },
        // --- REPORT QUALITY GATE (v2 competitive upgrade) ---
        // Deterministic 6-dimension score (0-100) computed over the
        // assembled report + quality_signals. Passed = score >= 70 with
        // zero critical issues. Surfaces to attorneys as a readiness badge
        // and to ops as a queryable trend metric.
        quality_gate: scoreReportQuality(
          parsed,
          {
            chunk_success: {
              narrative: chunkStatus.narrative.ok,
              memo: chunkStatus.memo.ok,
              intelligence: chunkStatus.intelligence.ok,
            },
            citation_count: proseCitations.length,
            orphaned_citation_count: orphanedCitations.length,
            uncovered_finding_count: uncoveredFindings.length,
            legal_memorandum_present:
              !!parsed.legal_memorandum &&
              typeof parsed.legal_memorandum === "object" &&
              !Array.isArray(parsed.legal_memorandum),
            legal_memorandum_irac_complete: Array.isArray(parsed?.legal_memorandum?.legal_analysis)
              ? parsed.legal_memorandum.legal_analysis.every(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (i: any) =>
                    typeof i?.issue === "string" &&
                    i.issue.length > 0 &&
                    typeof i?.rule === "string" &&
                    i.rule.length > 0 &&
                    typeof i?.application === "string" &&
                    i.application.length > 0 &&
                    typeof i?.conclusion === "string" &&
                    i.conclusion.length > 0 &&
                    Array.isArray(i?.cited_evidence) &&
                    i.cited_evidence.length > 0,
                )
              : false,
            avg_prose_length: (() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const p = (parsed?.prose ?? {}) as Record<string, any>;
              const strs = Object.values(p).filter((v): v is string => typeof v === "string");
              if (!strs.length) return 0;
              return Math.round(strs.reduce((a, b) => a + b.length, 0) / strs.length);
            })(),
          },
          findings.length,
        ),
        contradictions_input: contradictionsRaw.length,
        contradictions_verified: contradictions.length,
        contradictions_dropped: contradictionsRaw.length - contradictions.length,
        motions_input: motionsRaw.length,
        motions_verified: motions.length,
        motions_dropped: motionsRaw.length - motions.length,
        constitutional_input: constIssuesRaw.length,
        constitutional_verified: constIssues.length,
        constitutional_suppressed_by_case_type: !isCriminalOrCivilRights,
        policy:
          "Every conclusion in the structured report has at least one verbatim quote that was substring-matched against the extracted document corpus. Items that failed verification were dropped. Constitutional analysis is suppressed entirely when the detected case type does not implicate constitutional issues.",
        claim_strength_guardrail: {
          policy:
            "No generated sentence may make a stronger claim than its strongest cited source. Tier-5 legal-risk terms (lied, fabricated, fraud, conspiracy, etc.) require ≥2 corroborating corpus mentions or are automatically softened. Intent words (intentionally, knowingly, maliciously, etc.) are stripped unless the intent itself appears in the source. Evidence-type ceilings prevent witness testimony from supporting fabrication conclusions and audit logs from supporting intent conclusions.",
          contradictions: {
            softened: contradictionsGuarded.totalSoftened,
            dropped: contradictionsGuarded.totalDropped,
          },
          motions: { softened: motionsGuarded.totalSoftened, dropped: motionsGuarded.totalDropped },
          constitutional: {
            softened: constGuarded.totalSoftened,
            dropped: constGuarded.totalDropped,
          },
          missing_evidence: {
            softened: missingGuarded.totalSoftened,
            dropped: missingGuarded.totalDropped,
          },
          prose: proseAudit,
        },
        evidence_sufficiency: {
          policy:
            "Evidence Sufficiency Score (ESS) caps narrative length, gates motion generation, and gates quantitative scoring. Sparse corpora cannot produce rich reports. A secondary validator strips any prose sentence whose meaningful tokens do not appear in the extracted corpus.",
          ...ess,
          secondary_validator: validatorAudit,
          motions_suppressed_by_gate: ess.allowMotionGeneration ? 0 : motionsGuarded.items.length,
        },
        // Single authoritative report state — used by every consumer.
        report_mode: reportMode,
        // Three explicit counters used by every UI surface and export.
        finding_counters: {
          generated: findings.length,
          verified: findings.length,
          rendered: isLimited ? findings.length : findings.length,
        },
        // Findings Summary — cumulative per-pipeline-run audit exposing
        // total generated, verified/displayed, suppressed, and a per-reason
        // breakdown (no citation / duplicate / tautology / etc.). Rendered
        // on the Reports page as the "Findings Summary" section.
        findings_summary: findingsSummary,
      },
    } as unknown as J,
    citations: citations as J,
    evidence_index: evidenceIndex as J,
    contradictions_struct: factualContradictions as J,
    missing_evidence_struct: missingGuarded.items as J,
    constitutional_issues_struct: constGuarded.items as J,
    motion_opportunities: motionsFinal as J,
    cross_examination: isLimited ? ([] as unknown as J) : (crossExam as J),
    strategy_recommendations: isLimited ? ([] as unknown as J) : (strategy as J),
    next_actions: isLimited ? ([] as unknown as J) : (nextActions as J),
    case_strength_score: gatedScore(parsed.case_strength_score),
    risk_score: gatedScore(parsed.risk_score),
    scores_suppressed: isLimited,
    motions_suppressed: isLimited,
    engines_summary: enginesSummary as unknown as J,
    intelligence_version: INTELLIGENCE_VERSION,
    // Phase 4: which canonical_analysis.version this report was rendered
    // from. NULL when the flag is off or the raw-table fallback ran.
    canonical_version: canonicalVersion,
  };

  // Stash disputed-issues inside full_report (no dedicated column).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (reportRow.full_report as any).disputed_issues = disputedIssues;

  // STEP 2 directive — per-document Evidence Map, OCR coverage, and report
  // quality audit. All deterministic, all reconcilable against the persisted
  // findings + documents tables.
  try {
    const { buildEvidenceMap, buildOcrCoverage, buildReportQualityAudit } =
      await import("./intelligence/evidence-map.server");
    const { buildCanonicalTimeline } = await import("./intelligence/canonical-timeline.server");
    const { buildDocumentGraph } = await import("./intelligence/document-graph.server");
    const { buildCitationAudit } = await import("./intelligence/citation-audit.server");
    const [evidenceMap, ocrCoverage, qualityAudit, canonicalTimeline, documentGraph, citationAudit] = await Promise.all(
      [
        buildEvidenceMap(db, caseId),
        buildOcrCoverage(db, caseId),
        buildReportQualityAudit(db, caseId),
        buildCanonicalTimeline(db, caseId),
        buildDocumentGraph(db, caseId),
        buildCitationAudit(db, caseId),
      ],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).cross_document_graph = documentGraph;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).evidence_map = evidenceMap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).ocr_coverage = ocrCoverage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).canonical_timeline = canonicalTimeline;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).citation_audit = citationAudit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).citation_audit_appendix = citationAudit.appendix_markdown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valBlock = ((reportRow.full_report as any).validation ?? {}) as Record<string, unknown>;
    valBlock.report_quality = qualityAudit;
    valBlock.evidence_map_totals = evidenceMap.totals;
    valBlock.ocr_coverage = ocrCoverage;
    valBlock.canonical_timeline_totals = canonicalTimeline.totals;
    valBlock.cross_document_graph_totals = documentGraph.totals;
    valBlock.citation_audit = {
      total: citationAudit.total,
      supported: citationAudit.supported,
      quarantined: citationAudit.quarantined,
      supported_pct: citationAudit.supported_pct,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).validation = valBlock;

    // Priority 0/3/4 — incomplete citations QUARANTINE, they do NOT block.
    // Supported findings render normally; unsupported ones are surfaced in
    // the Citation Audit appendix. Only genuinely broken pipeline states
    // (failed OCR) count as blocking quality issues.
    const blockReasons: string[] = [];
    if (citationAudit.quarantined > 0) {
      pipelineWarnings.push(
        `citation_audit: ${citationAudit.quarantined}/${citationAudit.total} finding(s) quarantined — see Citation Audit appendix. supported=${citationAudit.supported_pct}%`,
      );
    }
    if (qualityAudit.total_findings > 0 && qualityAudit.fully_cited_pct < 100) {
      pipelineWarnings.push(
        `report_quality: ${qualityAudit.missing_citation}/${qualityAudit.total_findings} findings lack full citation (doc + page/refs + quote). fully_cited=${qualityAudit.fully_cited_pct}%`,
      );
    }
    if (ocrCoverage.total_documents > 0 && ocrCoverage.coverage_pct < 100) {
      pipelineWarnings.push(
        `ocr_coverage: ${ocrCoverage.extracted}/${ocrCoverage.total_documents} documents extracted (${ocrCoverage.coverage_pct}%) — ${ocrCoverage.failed} failed, ${ocrCoverage.pending} pending.`,
      );
      if (ocrCoverage.failed > 0) {
        blockReasons.push(`${ocrCoverage.failed} document(s) failed extraction/OCR.`);
      }
    }
    if (evidenceMap.totals.missing_evidence > 0) {
      pipelineWarnings.push(
        `evidence_map: ${evidenceMap.totals.missing_evidence}/${evidenceMap.totals.total} documents classified as missing_evidence (unreadable or empty).`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow as any).quality_blocked = blockReasons.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow as any).quality_block_reasons = blockReasons;
  } catch (e) {
    console.warn("[evidence-map/ocr/quality/citation-audit] failed:", e instanceof Error ? e.message : e);
  }

  // Finalization barrier (Sections 6 & 9): build canonical registry snapshot
  // and stamp it onto the report. Downstream readers (exports, public API,
  // dashboard "final" badges) MUST gate themselves on registry_state === "finalized".
  {
    const { buildRegistrySnapshot } = await import("./intelligence/canonical-id");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findingsForSnap = (findings as any[]).map((f) => ({
      title: f.title ?? "",
      source_module: f.source_module ?? "",

      metadata: (f.metadata ?? {}) as Record<string, unknown>,
    })) as unknown as import("./intelligence/types").NewFinding[];
    const snap = buildRegistrySnapshot({
      finalized: findingsForSnap,
      invalid: 0,
      warnings: pipelineWarnings,
    });
    const completeness = pipelineWarnings.length === 0 ? "complete" : "partial";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).registry = snap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).pipeline_warnings = pipelineWarnings;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).analysis_completeness = completeness;
  }

  // Practice Area Isolation: wipe fields that don't belong to this case's
  // legal framework. Universal modules (timeline, witnesses, contradictions,
  // findings, evidence) are always retained; practice-specific outputs are
  // scrubbed when they aren't part of the area's allowed module list.
  // Also stamps the case's active-domain set so exports filter consistently.
  {
    const { scrubReportForPracticeArea, normalizePracticeArea, buildCaseTypeManifest } =
      await import("./intelligence/practice-areas");
    const { resolveActivations } = await import("./intelligence/cross-domain.server");
    const area = normalizePracticeArea(caseType);
    const { activeDomains, activations } = await resolveActivations(db, caseId);
    scrubReportForPracticeArea(reportRow as unknown as Record<string, unknown>, area);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).practice_area = area;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).active_domains = Array.from(activeDomains);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).domain_activations = activations;

    const manifest = buildCaseTypeManifest(area, activeDomains);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).case_type_manifest = manifest;

    // Final Release Validation Gate — reconcile the manifest against actual
    // execution and work-product state. Writes a deterministic verdict to
    // full_report.release_gate; mismatches are appended to pipeline_warnings
    // so the audit trail records any drift between intent and outcome.
    try {
      const { reconcileManifest, summarizeReleaseGate } = await import("./intelligence/release-gate");
      const [{ data: engineRunsRows }, { data: actRows }, { data: wpRows }] = await Promise.all([
        db
          .from("pipeline_engine_runs")
          .select("engine,status,skipped_reason")
          .eq("case_id", caseId)
          .order("created_at", { ascending: true }),
        db
          .from("case_domain_activations")
          .select("domain,source,trigger_id,reason,evidence_finding_ids")
          .eq("case_id", caseId),
        db
          .from("case_work_product")
          .select("id,kind,title,body_markdown,error_message,skipped_reason")
          .eq("case_id", caseId),
      ]);
      const verdict = reconcileManifest({
        manifest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runs: ((engineRunsRows ?? []) as any[]).map((r) => ({
          engine: String(r.engine),
          status: String(r.status),
          skipped_reason: r.skipped_reason ?? null,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activations: ((actRows ?? []) as any[]).map((a) => ({
          domain: String(a.domain),
          source: String(a.source),
          trigger_id: a.trigger_id ?? null,
          reason: a.reason ?? null,
          evidence_finding_ids: Array.isArray(a.evidence_finding_ids) ? a.evidence_finding_ids : [],
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workProducts: ((wpRows ?? []) as any[]).map((w) => ({
          id: w.id,
          kind: w.kind ?? null,
          title: w.title ?? null,
          body_markdown: w.body_markdown ?? null,
          error_message: w.error_message ?? null,
          skipped_reason: w.skipped_reason ?? null,
        })),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reportRow.full_report as any).release_gate = verdict;
      if (!verdict.ok) {
        // 2026-07-31: reverted to warning-only per explicit direction. This
        // block previously also set quality_blocked=true, report_mode=
        // "LIMITED", and nulled out case_strength_score/recommendations/
        // risk_analysis/theory reports/legal_memorandum content whenever
        // ANY release-gate issue fired — including issue codes the gate's
        // own check comments admit are imprecise heuristics (e.g.
        // cross_domain_no_audit: "we can't map engine→domain perfectly").
        // Confirmed against a real case (ambiental + penal cross-domain,
        // case 7d50060f-...) that this blocked a report whose actual
        // content was correct — the manifest's cross-domain detection was
        // right, but a separate silent DB-write failure (now fixed in
        // cross-domain.server.ts) made the release gate's later re-query
        // see zero activation rows and treat that as a content-integrity
        // failure. release-gate.ts's own top-of-file comment describes the
        // intended behavior: "the pipeline never crashes on a release-gate
        // mismatch — it surfaces them so the audit trail records the
        // drift." Restoring that: the verdict and issues are still
        // recorded on full_report.release_gate and pipeline_warnings for
        // every case, so drift is never silently lost — it just no longer
        // retracts report content on its own.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const warns = ((reportRow.full_report as any).pipeline_warnings ?? []) as string[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (reportRow.full_report as any).pipeline_warnings = [...warns, ...summarizeReleaseGate(verdict)];
      }
    } catch {
      // Release-gate reconciliation must never break report generation.
    }
  }

  assertDbOk((await db.from("reports").upsert(reportRow, { onConflict: "case_id" })).error, "Failed to save report");

  // Immutable version snapshot — directive Phase 1.1.
  // Read back the persisted row so the snapshot reflects exactly what was
  // saved (version, change_log, quality_blocked, etc.).
  try {
    const { data: saved } = await db.from("reports").select("*").eq("case_id", caseId).maybeSingle();
    if (saved) {
      const { snapshotReportVersion } = await import("./intelligence/report-version.server");
      const savedAny = saved as unknown as Record<string, unknown>;
      const contradictions = Array.isArray(savedAny.contradictions_struct)
        ? (savedAny.contradictions_struct as unknown[]).length
        : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const valBlock = ((savedAny.full_report as any) ?? {}).validation ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ess = typeof (valBlock as any).ess === "number" ? (valBlock as any).ess : null;
      await snapshotReportVersion(db, {
        caseId,
        userId,
        version: Number(savedAny.version ?? 1) || 1,
        canonicalVersion:
          typeof savedAny.canonical_version === "number" ? (savedAny.canonical_version as number) : null,
        report: savedAny,
        changeLog: (savedAny.change_log as Record<string, unknown> | null) ?? null,
        meta: {
          documentCount:
            (await db.from("documents").select("id", { count: "exact", head: true }).eq("case_id", caseId)).count ?? 0,
          findingsCount:
            Number((savedAny.findings_count as number | undefined) ?? 0) ||
            ((
              await db
                .from("case_findings")
                .select("id", { count: "exact", head: true })
                .eq("case_id", caseId)
                .not("source_module", "like", PROJECTION_LIKE)
            ).count ??
              0),
          contradictionCount: contradictions,
          ess,
          score: typeof savedAny.case_strength_score === "number" ? (savedAny.case_strength_score as number) : null,
        },
      });
    }
  } catch (e) {
    console.warn("[report-version] snapshot failed:", e instanceof Error ? e.message : e);
  }

  // Report fully assembled and saved — the chunk resume cache has served
  // its purpose. Clear it so a future manual "Regenerate Report" doesn't
  // silently reuse stale chunk content from this run instead of producing
  // a fresh analysis.
  await clearChunkCache();

  await setCase(db, caseId, {
    status: "complete",
    status_message: "Litigation intelligence ready",
    progress: 100,
    report_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    error: null,
  });
  return {
    value: undefined,
    stats: {
      generated: contradictionsRaw.length + motionsRaw.length,
      accepted: factualContradictions.length + motionsFinal.length,
      suppressed_ess: motionsSuppressed + (ess.allowQuantitativeScores ? 0 : 1),
    },
  };
}
