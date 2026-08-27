Warning: truncated output (original token count: 146756)
Total output lines: 10133

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
import { ENGINE, engineForStage } from "./execution/canonical";
import { callGroq, parseJsonLoose, type GroqContent } from "./groq.server";
import type { ProviderType } from "./ai/providers/types";

import { mexicoLock, getReportLocale, groundingContract } from "@/lib/mexico-lock";
import { sha256Hex } from "./hash.server";
import { buildStorageKey, sanitizeStorageFilename } from "@/lib/security/filename";
import { validateUpload, logRejectedUpload } from "@/lib/security/file-validation";
import {
  addFindings,
  addGatedFindings,
  clearFindingsByModule,
  normalizeLlmFindings,
  normalizeReportWriterFindings,
  enforceRemedyLegalAuthorityGate,
  listFindings,
} from "./intelligence/findings.server";
import {
  extractPdf,
  extractDocx,
  extractXlsx,
  extractCsv,
  extractPlainText,
} from "./intelligence/extract.server";
import {
  computeDeterministicScorecard,
  computePenalPerspectiveScores,
} from "./intelligence/scoring.server";
import { parseResolutivos } from "./intelligence/resolutivo-parser";
import { computeCoverage } from "./intelligence/coverage.server";
import {
  runEngine,
  clearEngineRuns,
  buildEnginesSummary,
  finalizeEnginesSummaryForEmbed,
} from "./intelligence/engine-audit.server";
import {
  classifyContradiction,
  stripUnsupportedAmplification,
} from "./intelligence/dispute-classifier.server";
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
import { consolidateFindings } from "@/lib/intelligence/finding-dedupe";
import {
  judicialHierarchyInstructions,
  judicialHierarchySchemaFragment,
  auditClassificationSchemaFragment,
} from "@/lib/intelligence/finding-taxonomy";

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
const NON_EVIDENTIARY_FILENAME =
  /^(00[_-]?)?answer[_-]?key|ground[_-]?truth|solution[_-]?(key|sheet)|^read[_-]?me\b/i;

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
function revisionIdentity(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = (dot > 0 ? filename.slice(0, dot) : filename)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return stem
    .replace(/\s*\(\d+\)\s*$/g, "")
    .replace(/(?:[\s._-]+(?:copy|copia|revised|revision|rev|version|final|v)\s*\d*)+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type UploadResult = {
  uploaded: number;
  skipped: number;
  excludedNonEvidentiary: string[];
  uploadedDocumentIds: string[];
  revisedDocuments: Array<{
    documentId: string;
    priorDocumentId: string;
    revisionRootDocumentId: string;
    version: number;
  }>;
};

export async function uploadFiles(opts: {
  db: Db;
  caseId: string;
  userId: string;
  uploads: Array<{ name: string; bytes: Uint8Array }>;
  // 'case_corpus' (default): ordinary evidence, read by every full-pipeline
  // analysis engine (see listCorpusDocuments below). 'revision_context':
  // uploaded via Talk-to-Case — still extracted so the chat AI and the
  // finding-patch generator can read it, but excluded from the analysis
  // corpus until a user explicitly promotes it (promoteRevisionDocument in
  // cases.functions.ts). See migration 20260813224813_document_evidence_scope.
  evidenceScope?: "case_corpus" | "revision_context";
}): Promise<UploadResult> {
  const { db, caseId, userId, uploads: rawUploads, evidenceScope = "case_corpus" } = opts;
  const { sha256Hex } = await import("./hash.server");
  const uploads = expandZipsAndFiles(rawUploads);

  let uploaded = 0;
  let skipped = 0;
  const excludedNonEvidentiary: string[] = [];
  const uploadedDocumentIds: string[] = [];
  const revisedDocuments: UploadResult["revisedDocuments"] = [];

  // Build the version candidates once. Exact duplicates remain content-hash
  // based; filename normalization is used only after hashes differ, so a
  // revised file is preserved instead of replacing its predecessor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorRows, error: priorError } = await (db as any)
    .from("documents")
    .select("id,filename,content_hash,metadata,created_at")
    .eq("case_id", caseId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (priorError) {
    throw new Error("Failed to inspect existing documents: " + priorError.message);
  }

  type PriorDocument = {
    id: string;
    filename: string;
    content_hash: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  };
  const knownDocuments = ((priorRows ?? []) as PriorDocument[]).slice();

  for (const file of uploads) {
    if (isNonEvidentiaryFilename(file.name)) {
      excludedNonEvidentiary.push(file.name);
      continue;
    }

    const contentHash = await sha256Hex(file.bytes);
    const exactDuplicate = knownDocuments.find((doc) => doc.content_hash === contentHash);
    if (exactDuplicate) {
      skipped += 1;
      continue;
    }

    const identity = revisionIdentity(file.name);
    const revisionCandidates = identity
      ? knownDocuments.filter((doc) => revisionIdentity(doc.filename) === identity)
      : [];
    const priorRevision = revisionCandidates.at(-1) ?? null;
    const priorMetadata = priorRevision?.metadata ?? {};
    const priorVersion = Number(priorMetadata.revision_version ?? 1);
    const revisionVersion = priorRevision ? Math.max(1, priorVersion) + 1 : 1;
    const revisionRootDocumentId = priorRevision
      ? String(priorMetadata.revision_root_document_id ?? priorRevision.id)
      : null;

    const mimeType = inferMimeType(file.name);

    // Phase 1 hardening: server-side signature validation (obvious mismatches
    // only) and sanitized storage keys for NEW objects. Existing objects are
    // never renamed. Size/ZIP limits are enforced upstream and unchanged.
    const validation = validateUpload({ filename: file.name, bytes: file.bytes });
    if (!validation.ok) {
      logRejectedUpload({
        filename: sanitizeStorageFilename(file.name),
        sizeBytes: file.bytes.byteLength,
        declaredMime: mimeType,
        result: validation,
        caseId,
        userId,
      });
      throw new Error('Rejected "' + file.name + '": ' + validation.message);
    }

    const storagePath = buildStorageKey({
      prefixes: [userId, caseId],
      uniqueId: crypto.randomUUID(),
      filename: file.name,
    });

    const { error: uploadError } = await db.storage
      .from("case-files")
      .upload(storagePath, file.bytes, {
        contentType: mimeType,
        upsert: false,
      });
    if (uploadError) {
      throw new Error('Failed to upload "' + file.name + '": ' + uploadError.message);
    }

    const metadata = {
      uploaded_at: new Date().toISOString(),
      uploaded_by: userId,
      original_filename: file.name,
      revision_identity: identity || null,
      revision_version: revisionVersion,
      revision_of_document_id: priorRevision?.id ?? null,
      revision_root_document_id: revisionRootDocumentId,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (db as any)
      .from("documents")
      .insert({
        case_id: caseId,
        user_id: userId,
        filename: file.name,
        content_hash: contentHash,
        mime_type: mimeType,
        size_bytes: file.bytes.byteLength,
        storage_path: storagePath,
        status: "pending",
        evidence_scope: evidenceScope,
        metadata,
      })
      .select("id,created_at")
      .single();
    if (insertError || !inserted?.id) {
      await db.storage.from("case-files").remove([storagePath]);
      throw new Error(
        'Failed to record "' + file.name + '": ' + (insertError?.message ?? "missing id"),
      );
    }

    uploaded += 1;
    uploadedDocumentIds.push(String(inserted.id));
    if (priorRevision && revisionRootDocumentId) {
      revisedDocuments.push({
        documentId: String(inserted.id),
        priorDocumentId: priorRevision.id,
        revisionRootDocumentId,
        version: revisionVersion,
      });
    }
    knownDocuments.push({
      id: String(inserted.id),
      filename: file.name,
      content_hash: contentHash,
      metadata,
      created_at: String(inserted.created_at ?? new Date().toISOString()),
    });
  }

  return {
    uploaded,
    skipped,
    excludedNonEvidentiary,
    uploadedDocumentIds,
    revisedDocuments,
  };
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
    const terminalStatuses = new Set([
      "complete",
      "released",
      "needs_revision",
      "failed",
      "cancelled",
    ]);
    const shouldExtendLease =
      statusValue === "intelligence_running" && !terminalStatuses.has(statusValue);
    if (shouldExtendLease) {
      withHeartbeat.worker_lease_until = new Date(
        Date.now() + RUNNER_LEASE_EXTENSION_MS,
      ).toISOString();
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

  let penalRoutingContextPromise:
    | Promise<{
        penal: boolean;
        mode: import("./intelligence/case-analysis-mode").CaseAnalysisMode;
        prerequisites: import("./intelligence/penal-engine-prerequisites").PenalEnginePrerequisites;
      }>
    | null = null;

  const getPenalRoutingContext = () => {
    penalRoutingContextPromise ??= (async () => {
      const [{ resolveCaseIdentity }, { getCaseAnalysisMode }, prerequisiteModule] =
        await Promise.all([
          import("./intelligence/case-classification.server"),
          import("./intelligence/case-analysis-mode"),
          import("./intelligence/penal-engine-prerequisites"),
        ]);
      const [identity, mode, docsResult, classificationResult] = await Promise.all([
        resolveCaseIdentity(supabase, caseId),
        getCaseAnalysisMode(supabase, caseId),
        supabase.from("documents").select("extracted_text").eq("case_id", caseId),
        (supabase as any)
          .from("case_classification_evidence")
          .select("value,source_quote,conflicting_values")
          .eq("case_id", caseId)
          .eq("field", "concluded_status")
          .maybeSingle(),
      ]);
      const corpusText = (docsResult.data ?? [])
        .map((row) => String((row as { extracted_text?: string | null }).extracted_text ?? ""))
        .join("\n");
      const prerequisites = prerequisiteModule.detectPenalEnginePrerequisites(corpusText);
      prerequisites.hasOpenSubsequentProceeding =
        prerequisiteModule.classificationSupportsOpenProceeding(classificationResult.data);
      return {
        penal: identity.caseType === "penal" || identity.underlyingMateria === "penal",
        mode,
        prerequisites,
      };
    })();
    return penalRoutingContextPromise;
  };

  const clearNotApplicableStageArtifacts = async (stage: string) => {
    const tableByStage: Record<string, string> = {
      theories: "case_theories",
      opportunities: "case_opportunities",
      strategy: "case_strategy",
      litigation_strategy_center: "case_strategy_center",
      work_product: "case_work_product",
      witness: "case_witnesses",
    };
    const table = tableByStage[stage];
    if (table) await (supabase as any).from(table).delete().eq("case_id", caseId);
    if (stage === "discovery") {
      await supabase
        .from("case_findings")
        .delete()
        .eq("case_id", caseId)
        .like("source_module", "engine:discovery%");
    }
  };

  const runPenalModeGatedStage = async (
    stage: string,
    engine: string,
    execute: () => Promise<unknown>,
  ) => {
    const context = await getPenalRoutingContext();
    if (context.penal) {
      const { penalEngineApplicability } =
        await import("./intelligence/penal-engine-prerequisites");
      const decision = penalEngineApplicability(stage, context.mode, context.prerequisites);
      if (!decision.run) {
        await clearNotApplicableStageArtifacts(stage);
        const reason = `skipped_not_applicable:${decision.reason ?? "prerequisites_not_met"}`;
        await audit.recordSkipped(supabase, {
          caseId,
          userId,
          engine: engine as never,
          reason,
        });
        return { skipped: true, status: "skipped_not_applicable", reason };
      }
    }
    return persist.runCatalogedEngine(
      supabase,
      { caseId, userId, engine: engine as never },
      execute,
    );
  };

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
      engine?: string;
    }
  > = {
    extraction: { run: () => pipe.runExtraction(baseArgs) },
    agents: { run: () => pipe.runAgents(baseArgs) },
    analyzers: { run: () => pipe.runAnalyzers(baseArgs) },
    scoring: { run: () => pipe.runScoring(baseArgs), engine: ENGINE.scoring },
    jurisdiction_intel: {
      run: () =>
        withStageTimeout(
          "jurisdiction_intel",
          () =>
            persist.runCatalogedEngine(
              supabase,
              { caseId, userId, engine: ENGINE.jurisdiction_intel },
              async () => {
                const { runJurisdictionIntelligence } =
                  await import("@/lib/intelligence/jurisdiction-intel.server");
                const value = await runJurisdictionIntelligence({ db: supabase, caseId });
                return {
                  value,
                  stats: { generated: 1, accepted: 1, rows_written: 1, db_write_confirmed: true },
                };
              },
            ),
          { caseId, userId },
        ),
    },

    procedural_compliance: {
      run: () =>
        persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.procedural_compliance },
          async () => {
            const { runProceduralCompliance } =
              await import("@/lib/intelligence/procedural-compliance.server");
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
          },
        ),
    },
    legal_qa: {
      run: () =>
        withStageTimeout(
          "legal_qa",
          () =>
            persist.runCatalogedEngine(
              supabase,
              { caseId, userId, engine: ENGINE.legal_qa },
              async () => {
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
              },
            ),
          { caseId, userId },
        ),
    },

    report: { run: () => pipe.runReport(baseArgs), engine: ENGINE.report },
    timeline: { run: () => runTimelineAudit({ supabase, userId, caseId }) },
    evidence_map: {
      run: () =>
        persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.evidence_map },
          async () => {
            const m = await import("@/lib/intelligence/evidence-map.server");
            const em = await m.buildEvidenceMap(supabase, caseId);
            return {
              value: em,
              stats: {
                generated: em.totals.total,
                accepted: em.totals.total - em.totals.missing_evidence,
              },
            };
          },
        ),
    },
    contradictions: {
      run: () =>
        persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.contradictions },
          async () => {
            const d = await import("@/lib/intelligence/derived-engines.server");
            const result = await d.deriveContradictions(supabase, caseId);
            await updateCase(
              { contradiction_at: new Date().toISOString() },
              "pipeline.contradictions",
            );
            return result;
          },
        ),
    },
    // Task-9/10 stat plumbing: engines whose output is a mix of LLM + deterministic
    // templates now return real generated/accepted/rejected counts. Row counts come
    // from the target case_* tables (source of truth), audit numbers come from the
    // engine's own return value where available. Meta.source labels the pipeline
    // ("llm" | "template" | "hybrid") so the UI stops showing 0/0/0 for engines
    // that produced legitimate deterministic output.
    witness: {
      run: () =>
        runPenalModeGatedStage(
          "witness",
          ENGINE.witness,
          async () => {
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
          },
        ),
    },
    evidence_intel: {
      run: () =>
        persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.evidence_intel },
          async () => {
            const value = (await lit.runEvidenceIntelEngine(baseArgs)) as {
              classifications?: number;
              promoted_findings?: number;
              promotion_gate?: unknown;
              promotion_mode?: unknown;
              promotion_corpus?: unknown;
            };
            const gen = value.classifications ?? 0;
            const acc = value.promoted_findings ?? gen;
            await updateCase(
              { evidence_intel_at: new Date().toISOString() },
              "pipeline.evidence_intel",
            );
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
          },
        ),
    },
    constitutional: {
      // PRACTICE-AREA GATE: this stage previously ran unconditionally for
      // every case type, which is what produced the release-gate
      // "silent_activation:constitutional_compliance" failure — the engine
      // ran to completion (with a stub value) even when the manifest listed
      // it under skipped_engines. Mirrors the same gate already used in
      // runAgents() and ensureRequiredEngines() above.
      run: async () => {
        const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE } =
          await import("./intelligence/practice-areas");
        const { getActiveDomains } = await import("./intelligence/cross-domain.server");
        const { recordSkipped } = await import("./intelligence/engine-audit.server");
        const { resolveCaseIdentity } = await import("./intelligence/case-classification.server");
        const { isUsableForLegalReasoning } = await import("./intelligence/case-identity");

        const identity = await resolveCaseIdentity(supabase, caseId);
        if (!isUsableForLegalReasoning(identity) && !identity.caseType) {
          // No verified/attorney-locked/declared materia at all — never
          // guess "general_civil" (see the Verified Case Identity fix).
          const reason =
            identity.status === "conflict" ? "case_identity_conflict" : "case_identity_unverified";
          await recordSkipped(supabase, { caseId, userId, engine: ENGINE.constitutional as never, reason });
          return { skipped: true, reason };
        }
        const area = String(identity.caseType);
        const activeDomains = await getActiveDomains(supabase, caseId);

        if (!isAnalyzerAllowed(area, "constitutional_compliance", activeDomains)) {
          await recordSkipped(supabase, {
            caseId,
            userId,
            engine: ENGINE.constitutional as never,
            reason: SKIP_REASON_NOT_APPLICABLE,
          });
          return { skipped: true, reason: SKIP_REASON_NOT_APPLICABLE };
        }

        return persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.constitutional },
          async () => ({
            value: { derived_from: "analyzers+agents" },
          }),
        );
      },
    },
    discovery: {
      run: () =>
        runPenalModeGatedStage(
          "discovery",
          ENGINE.discovery,
          async () => {
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
          },
        ),
    },
    perspectives: {
      run: () =>
        persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.perspectives },
          async () => {
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
          },
        ),
    },
    theories: {
      run: () =>
        runPenalModeGatedStage(
          "theories",
          ENGINE.theories,
          async () => {
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
          },
        ),
    },
    opportunities: {
      run: () =>
        runPenalModeGatedStage(
          "opportunities",
          ENGINE.opportunities,
          async () => {
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
          },
        ),
    },
    strategy: {
      run: () =>
        runPenalModeGatedStage(
          "strategy",
          ENGINE.strategy,
          async () => {
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
          },
        ),
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
        runPenalModeGatedStage(
          "litigation_strategy_center",
          ENGINE.litigation_strategy_center,
          async () => {
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
          },
        ),
    },
    work_product: {
      run: () =>
        runPenalModeGatedStage(
          "work_product",
          ENGINE.work_product,
          async () => {
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
          },
        ),
    },
    hallucination: {
      run: () =>
        persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: ENGINE.hallucination },
          async () => ({
            value: await hal.runHallucinationReview({ db: supabase, caseId }),
          }),
        ),
    },
    multi_agent: {
      run: async () =>
        audit.runEngine(supabase, { caseId, userId, engine: ENGINE.multi_agent }, async () => {
          const { runMultiAgentPipeline } = await import("@/lib/agents/orchestrator.server");
          const result = await runMultiAgentPipeline({
            db: supabase,
            userId,
            caseId,
            apiKey,
            apiKeys: keys,
            // Preliminary pass only. The release decision is made after the
            // completed report exists, by runFinalReleaseReview().
            deferRelease: true,
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
              meta: {
                run_id: result.runId,
                released: null,
                preliminary_released: result.released,
                release_deferred: true,
              },
            },
          };
        }),
    },
  };

  // Dependency graph — derived from CANONICAL_STAGES so there is exactly
  // one place that defines stage dependencies platform-wide.
  const { CANONICAL_STAGES } = await import("@/lib/execution/canonical");
  const DEPENDS_ON = Object.fromEntries(
    CANONICAL_STAGES.map((s) => [s.key, [...s.dependsOn]]),
  ) as Record<PipelineStageKey, PipelineStageKey[]>;
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
  const {
    withCheckpointScope,
    budgetFor,
    WORKER_INVOCATION_BUDGET_MS,
    CHECKPOINT_SAFETY_BUFFER_MS,
  } = await import("./pipeline-checkpoint.server");
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
      throw new Error(
        `failed to read pipeline_engine_runs history for resume: ${priorErr.message}`,
      );
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
        const engineFor = engineForStage;
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
            const next =
              ((cur as { report_checkpoint_count?: number } | null)?.report_checkpoint_count ?? 0) +
              1;
            await (supabase as any)
              .from("cases")
              .update({ report_checkpoint_count: next })
              .eq("id", caseId);
            trace("report.checkpoint_count", { count: next });
          } catch (cntErr) {
            console.warn("[pipeline] failed to increment report_checkpoint_count", cntErr);
          }
        }
        trace("stage.checkpoint", { stage: s.key, runtime_ms: Date.now() - stageStart });
        try {
          await prog.emitEvent(
            supabase,
            caseId,
            s.key,
            `${s.label} checkpointed — will resume on next worker tick`,
            {
              level: "warn",
            },
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
  const provider = (args.provider ?? "groq") as
    | "groq"
    | "openai"
    | "gemini"
    | "anthropic"
    | "openrouter";
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
  /**
   * Wipe the engine-run ledger before this pass. TRUE only for a genuinely
   * fresh execution. On a checkpoint RESUME this must stay false: clearing
   * the ledger erases every terminal row the resume clamp reads, so the
   * runner concludes nothing has completed, clamps the resume point back to
   * `extraction`, re-runs the whole pipeline, checkpoints again, and loops
   * forever without ever finishing scoring/report.
   */
  clearPriorRuns?: boolean;
}) {
  const { db, caseId, userId, apiKey, apiKeys, clearPriorRuns = true } = args;
  await setCase(db, caseId, {
    status: "extracting",
    status_message: "Extracting evidence",
    progress: 5,
    error: null,
  });
  // Fresh pipeline pass — clear prior engine audit so the dashboard reflects
  // this run only.
  if (clearPriorRuns) await clearEngineRuns(db, caseId);
  return runEngine(db, { caseId, userId, engine: ENGINE.extraction }, async () => {
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
    // Atomic claim: only proceed if the row isn't currently being processed by
    // another worker. A row can be stuck at status "extracting" forever if a
    // prior attempt hung mid-download and the worker was killed before it
    // could write a terminal status (confirmed in production: a plain-text
    // file's download never resolved, the run stalled, and every subsequent
    // Resume silently skipped that document forever because its status was
    // still "extracting" — `.neq("status","extracting")` never matches a
    // stuck row). Also allow reclaiming a stale claim: once
    // last_extraction_attempt_at is old enough that a genuinely in-flight
    // attempt would have hit its own DOWNLOAD_TIMEOUT_MS/stage timeout by
    // now, it's safe to assume the prior attempt died without updating the
    // row, not that it's still running.
    const STALE_CLAIM_MS = 5 * 60_000;
    const staleBeforeIso = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { data: claimed } = await db
      .from("documents")
      .update({
        status: "extracting",
        error: null,
        last_extraction_attempt_at: new Date().toISOString(),
      })
      .eq("id", d.id)
      .or(`status.neq.extracting,last_extraction_attempt_at.lt.${staleBeforeIso}`)
      .select("id")
      .maybeSingle();
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      // Storage downloads have no client-side timeout of their own — wrap so
      // a hung network call fails this ONE document (caught below, marked
      // failed, retry_count incremented) instead of consuming the whole
      // stage's timeout budget on a single stuck file and blocking every
      // other document behind it.
      const DOWNLOAD_TIMEOUT_MS = 30_000;
      const { data: blob, error: dlErr } = await Promise.race([
        db.storage.from("case-files").download(d.storage_path!),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Storage download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)),
            DOWNLOAD_TIMEOUT_MS,
          ),
        ),
      ]);
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
        const parsed = parseJsonLoose<{ text?: string; metadata?: unknown; entities?: unknown }>(
          r.text,
        );
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
            entities: Array.isArray(entities)
              ? (entities as Array<{ type?: string; value?: string }>)
              : null,
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
          console.warn(
            "[image_intel] second pass failed for",
            d.id,
            imgErr instanceof Error ? imgErr.message : imgErr,
          );
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
      await db
        .from("documents")
        .select("error")
        .eq("case_id", caseId)
        .eq("status", "failed")
        .limit(1)
        .maybeSingle()
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
      message:
        "No failed documents eligible for retry (either none failed or max retries reached).",
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

// Excludes 'revision_context' documents (uploaded via Talk-to-Case — see
// migration 20260813224813_document_evidence_scope) from every full-pipeline
// analysis engine's document read, so a document a user attaches
// mid-conversation cannot silently become part of the case's permanent
// analytical record until explicitly promoted. Repeated inline at each
// corpus-consuming query (this file's buildCorpus, plus evidence-map.server.ts,
// litigation.server.ts, shared-brief.server.ts) rather than a shared query
// builder, matching this codebase's existing per-call-site filter style.
// Extraction itself, and Talk-to-Case's own chat context / finding-patch
// grounding, intentionally do NOT apply this filter — a revision_context
// document must still be extracted and still be readable by the chat AI,
// just excluded from full-case analysis.
async function buildCorpus(db: Db, caseId: string) {
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,extracted_text,metadata,entities,status,evidence_scope")
    .eq("case_id", caseId)
    // Analysis corpus only — revision_context documents (Talk-to-Case
    // attachments not yet promoted) are excluded, see listCorpusDocuments.
    .neq("evidence_scope", "revision_context")
    // Secondary sort on `id` — see the identical note in
    // shared-brief.server.ts's loadCorpus(). This is the doc_n numbering
    // ("DOCUMENT N" headers) analyzers/agents prompts use; it must stay
    // deterministic and aligned with every other independent re-query of
    // the same documents, or a cited doc_n silently resolves to the wrong
    // document later.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
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
// Agents carry a much smaller non-corpus prompt than the analyzers (2.7K vs
// 4.9K chars of overhead) and each agent re-reads the whole corpus, so batch
// COUNT is what dominated their wall clock: witness_credibility alone ran 8
// sequential batches. A larger ceiling packs the same corpus into roughly half
// as many calls. `packingCharBudget` still clamps this down to what the
// narrowest usable provider accepts, and a 413 still auto-splits at runtime.
// ROLLBACK: set this back to ANALYZER_CORPUS_BUDGET_CHARS.
const AGENT_CORPUS_BUDGET_CHARS = 120_000;
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
  return runEngine(db, { caseId, userId, engine: ENGINE.analyzers }, async () =>
    _runAnalyzersInner(args),
  );
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

  // VERIFIED CASE IDENTITY — never a raw cases.case_type read here. The
  // analyzer stage is not an optional practice-area gate (unlike e.g. the
  // constitutional_compliance stage above), so an unverified classification
  // must not skip it outright — that would break analysis for the many
  // cases that simply haven't been through a CONFIRMED classification pass
  // yet. Instead: verified/attorney-locked identities are used normally;
  // an unverified-but-declared value is used as before (no regression) but
  // the run is flagged so the report renderer can surface the uncertainty;
  // only a genuinely unknown identity (no value at all) falls back to a
  // neutral, explicitly-flagged default — never a silently guessed materia.
  const { resolveCaseIdentity } = await import("./intelligence/case-classification.server");
  const { isUsableForLegalReasoning } = await import("./intelligence/case-identity");
  const analyzerIdentity = await resolveCaseIdentity(db, caseId);
  const analyzerIdentityVerified = isUsableForLegalReasoning(analyzerIdentity);
  // "civil" is a real, valid Mexican materia — used only as the last-resort
  // schema fallback so the analyzer's JSON schema (party-role enum,
  // practice-area label below) can still be built when identity resolution
  // found nothing at all. The prior fallback here, "general_civil", is a
  // scoring-dimension dictionary key from a different module, never a
  // recognized materia — normalizePracticeArea/mxPartyRoleEnum throw for
  // any unrecognized value, which crashed this stage outright for every
  // case with no declared/confirmed/locked materia yet (confirmed live on
  // ADR-4640-2017-180212: "Materia desconocida en normalizePracticeArea:
  // 'general_civil'"). unverified_classification below still honestly
  // flags every run that took this fallback.
  const analyzerArea = String(analyzerIdentity.caseType ?? "civil");
  // Kept separate from analyzerArea: the practice-area POLICY filter further
  // below (isFindingAllowed) must never treat this schema-generation
  // fallback as if it were a real classification — an unverified/unknown
  // identity must keep degrading to universal-only findings here, exactly
  // like every other Tier 1 policy consumer (see findings.server.ts).
  const analyzerPolicyArea = analyzerIdentity.caseType ?? null;
  const analyzerDomains = await getActiveDomains(db, caseId);
  const analyzerAreaLabel = PRACTICE_AREA_LABELS[normalizePracticeArea(analyzerArea)];
  const analyzerLocaleForPreamble = await getReportLocale(db, caseId);
  const { getCaseAnalysisMode, getCaseAnalysisObjective, getAuditClassificationInstructions, getProceduralTypeLock } =
    await import("./intelligence/case-analysis-mode");
  const analyzerCaseAnalysisMode = await getCaseAnalysisMode(db, caseId);
  const analyzerCaseAnalysisObjective = getCaseAnalysisObjective(
    analyzerCaseAnalysisMode,
    analyzerLocaleForPreamble,
  );
  // §3 (report-quality audit): the six-state audit_classification taxonomy
  // is already in every agent's schema unconditionally — getCaseAnalysisObjective
  // already carries these instructions for completed-case modes, so this is
  // only needed standalone when it returned null (ongoing mode).
  const analyzerAuditClassificationInstructions = analyzerCaseAnalysisObjective
    ? null
    : getAuditClassificationInstructions(analyzerLocaleForPreamble);
  const { resolveVerifiedProceedingType: resolveVerifiedProceedingTypeForAnalyzer } =
    await import("./intelligence/case-classification.server");
  const analyzerVerifiedProceedingType = await resolveVerifiedProceedingTypeForAnalyzer(db, caseId);
  const analyzerProceduralTypeLock = getProceduralTypeLock(
    analyzerVerifiedProceedingType,
    analyzerLocaleForPreamble,
  );
  // Talk to Case as a case-state update, not just another document — see
  // case-state-reconciliation.server.ts. null (no-op) when this case has no
  // Talk-to-Case clarification document.
  const { hasCaseStateUpdateDocs, getCaseStateUpdateNotice } =
    await import("./intelligence/case-state-reconciliation.server");
  const { data: analyzerDocFilenames } = await db
    .from("documents")
    .select("filename")
    .eq("case_id", caseId);
  const analyzerCaseStateUpdateNotice = getCaseStateUpdateNotice(
    hasCaseStateUpdateDocs((analyzerDocFilenames ?? []) as never),
    analyzerLocaleForPreamble,
  );
  const analyzerPreamble =
    `${mexicoLock(analyzerLocaleForPreamble)}\n` +
    `${groundingContract(analyzerLocaleForPreamble)}\n` +
    (analyzerProceduralTypeLock ? `${analyzerProceduralTypeLock}\n` : "") +
    (analyzerCaseStateUpdateNotice ? `${analyzerCaseStateUpdateNotice}\n` : "") +
    (analyzerCaseAnalysisObjective ? `${analyzerCaseAnalysisObjective}\n` : "") +
    (analyzerAuditClassificationInstructions ? `${analyzerAuditClassificationInstructions}\n` : "") +
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
  const jhFragment = judicialHierarchySchemaFragment();
  const auditClassificationFragment = auditClassificationSchemaFragment();

  const buildPrompt = (corpusText: string) =>
    `Return STRICT JSON. EVERY item in contradictions, missing_evidence, procedural_issues, and key_findings MUST include an evidence_refs array of { doc_id?: string, doc_n?: number, quote: string (verbatim from corpus, <=200 chars) }. Every "legal_significance" value must explain the legal consequence of the fact (why it matters), not just restate the fact itself.

CRITICAL: every string VALUE in this JSON (title, description, legal_significance, potential_impact, rule) MUST be written entirely in ${analyzerLocale === "en" ? "English" : "Spanish"} — regardless of what language the underlying source documents/corpus are written in. Never carry over English from an English-language source document (e.g. a WhatsApp message, bank statement, or email quoted in the corpus) into these fields; translate the legal analysis, only verbatim quotes inside evidence_refs may stay in their original language since they must match the source exactly.

${judicialHierarchyInstructions()}

{
  "timeline": [ { "date": string, "event": string, "source_document": string } ],
  "contradictions": [ { "title": string, "description": string, "documents": string[], "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "potential_impact": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, ${jhFragment}, ${auditClassificationFragment}, "evidence_refs": [ { "doc_n": number, "quote": string } ] } ],
  "missing_evidence": [ { "title": string, "description": string, "severity": "low"|"medium"|"high"|"critical", "confidence": number, "legal_significance": string, "affected_party": ${mxPartyRoleEnum(analyzerArea)}, "evidence_refs": [ { "doc_n": number, "quote"…96756 tokens truncated…if (typeof value !== "string" || !isFalsePersonalNoticeTheory(value)) continue;
      prose[key] = value.split(/(?<=[.!?])\s+|\n+/g).filter((sentence) => !isFalsePersonalNoticeTheory(sentence)).join(" ").trim();
    }
  }
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
    hasOnlyIncompleteJudicialPublication:
      docTypeSignals.hasOnlyIncompleteJudicialPublication,
    // CONFIRMED LIVE (ADR5829/2025): omitting this made a "minimal" bin
    // unconditionally prepend the English insufficientEvidenceNotice onto a
    // Spanish executive_summary, tripping QA's language-drift check ("Report
    // language drift (es): Evidence.") and forcing the case to
    // needs_revision on every "strict"/completed-case run whose corpus
    // landed in the minimal bin.
    locale: reportLocaleForNotice,
  });

  const allowReportMotionGeneration = reportCaseAnalysisMode === "concluded_audit" ? false : ess.allowMotionGeneration;

  // ESS-driven per-finding constraint (report-quality audit, 2026-08-14,
  // ADR-2239-2018-180906): "modo LIMITADO" already suppresses the CASE-LEVEL
  // score/recommendations further below, but that never reached individual
  // findings — a finding could still carry DIRECT_EVIDENCE status and a
  // 90%+ confidence badge from a corpus too thin to support that certainty.
  // applyEssConstraint (evidence-gate.server.ts) is a pure downgrade;
  // PERSISTED here (not just displayed-capped) so every consumer — this
  // report, the live case UI, Talk-to-Case — reads the same constrained
  // values without needing its own separate ESS-awareness. Best-effort: a
  // write failure must never block report generation, matching every other
  // supplementary write in this pipeline.
  if (ess.bin === "minimal" || ess.bin === "low") {
    const { applyEssConstraint, rewriteAbsenceWording } = await import(
      "./intelligence/evidence-gate.server"
    );
    for (const f of findings as unknown as Array<{
      id: string;
      finding_type: "DIRECT_EVIDENCE" | "EVIDENCE_BASED_INFERENCE" | "AI_THEORY" | null;
      confidence: number | null;
      severity: string | null;
      description: string | null;
    }>) {
      const result = applyEssConstraint(
        { finding_type: f.finding_type, confidence: f.confidence, severity: f.severity },
        ess.bin,
      );
      // Defense in depth alongside the generation-time prompt instruction
      // (see the "no se identificó en el/los documento(s)..." addition to
      // every finding-generation prompt above) — LLM compliance with a
      // wording instruction is never guaranteed.
      const rewrittenDescription = rewriteAbsenceWording(f.description, ess.bin);
      const descriptionChanged = rewrittenDescription !== f.description;
      if (!result.downgraded && !descriptionChanged) continue;
      f.finding_type = result.finding_type;
      f.confidence = result.confidence;
      f.severity = result.severity;
      f.description = rewrittenDescription;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from("case_findings")
          .update({
            finding_type: result.finding_type,
            confidence: result.confidence,
            severity: result.severity,
            ...(descriptionChanged ? { description: rewrittenDescription } : {}),
          })
          .eq("id", f.id);
      } catch (err) {
        console.error("[ess-constraint] failed to persist finding downgrade", f.id, err);
      }
    }
  }

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
      capNarrative(
        v,
        900,
        "Section preserved in abbreviated form after validation removed unsupported expansion.",
      );
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
        const heading =
          [amendment, right].filter(Boolean).join(" — ") || issue || "Constitutional issue";
        const citations = Array.isArray(it.citations) ? it.citations : [];
        const citeTags = citations
          .filter((c): c is { doc_n?: number; page?: number } => !!c && typeof c === "object")
          .map((c) =>
            typeof c.doc_n === "number"
              ? `[DOC ${c.doc_n}${typeof c.page === "number" ? ` p.${c.page}` : ""}]`
              : null,
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
    ess.bin === "minimal" ||
    scoreSuppressed
      ? "LIMITED"
      : "FULL";
  const isLimited = reportMode === "LIMITED";

  // Motion / scoring governance gates — in LIMITED mode, gated prose is
  // cleared entirely so suppressed content can never leak into the export.
  const motionsFinal = isLimited || !allowReportMotionGeneration ? [] : motionsGuarded.items;
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
    prose["executive_summary"] =
      `${ess.insufficientEvidenceNotice}\n\n${prose["executive_summary"] ?? ""}`.trim();
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

  // CANONICAL RECONCILIATION — Design §02/§10 P0: close the one real bypass.
  // Everything above this line (contradictions/missing_evidence/
  // constitutional_issues) is already quote-verified (verifyAndLabel) and
  // claim-strength-guarded (enforceStructuredItems) — the same content that
  // is about to be written into reports.full_report below. Until now, that
  // was the ONLY thing that happened to it: it never became a case_findings
  // row, so nothing that trusts addFindings()'s TRUST CONTRACT choke point
  // (the findings tab, the hallucination pass, Talk-to-Case, canonical-id's
  // own dedup/reconciliation) could see this content existed — confirmed as
  // the root cause of a real case (ADR 5829/2025) where the report showed a
  // contradiction the findings tab had no record of. Routed through
  // addGatedFindings exactly like every other producer; best-effort and
  // non-throwing, since a routing failure must never block the attorney
  // from receiving the report itself.
  try {
    // Canonical Reconciliation Design (2026-08-16), P2 — every OTHER
    // producer that routes through this choke point clears its own prior
    // findings before writing fresh ones on each pipeline run (see
    // `clearFindingsByModule(db, caseId, "analyzer:")` above and
    // `agent:${t}` in the agents stage) — the report-writer routing added in
    // P0 never got the same treatment. Without it, a report regenerated
    // after new evidence (a very normal workflow) re-derives fresh, non-
    // deterministic LLM prose on each run; dedupSemantically only merges a
    // new row into an old one when they cross its title-similarity bar, so a
    // rephrased contradiction/missing-evidence/constitutional-issue item
    // across two runs could silently accumulate as a near-duplicate row
    // instead of being cleanly replaced.
    await clearFindingsByModule(db, caseId, "report_writer:");
    const {
      contradictionRows,
      missingEvidenceRows,
      constitutionalRows,
      motionOpportunityRows,
      strategyRecommendationRows,
      nextActionRows,
      crossExaminationRows,
    } = normalizeReportWriterFindings({
      caseId,
      userId,
      contradictions: allContradictions,
      missingEvidence: missingGuarded.items,
      constitutionalIssues: constGuarded.items,
      // P2 (2026-08-16): the same intelShape chunk's remaining 4 fields —
      // P0 only routed the first 3. `isLimited`/`motionsFinal` are already
      // resolved above this point (reportMode gating, ~line 7716) so these
      // respect the exact same LIMITED-mode suppression the report body
      // itself uses — a suppressed motion/strategy/next-action must not
      // reappear as a findings-tab row just because it was cleared from the
      // report prose.
      motionOpportunities: isLimited ? [] : motionsFinal,
      strategyRecommendations: isLimited ? [] : strategy,
      nextActions: isLimited ? [] : nextActions,
      crossExamination: isLimited ? [] : crossExam,
      docNToId,
    });
    if (contradictionRows.length) {
      await addGatedFindings(db, caseId, contradictionRows);
    }
    if (constitutionalRows.length) {
      await addGatedFindings(db, caseId, constitutionalRows);
    }
    if (missingEvidenceRows.length) {
      // Absence-of-evidence claims structurally cannot carry a citation —
      // same exemption analyzer's own "analyzer:missing" findings use.
      await addGatedFindings(db, caseId, missingEvidenceRows, { exemptCitation: true });
    }
    // Motion/strategy/next-action/cross-examination content is advisory —
    // recommendations, not factual claims — so it structurally cannot carry
    // the same kind of verbatim-quote citation a contradiction can. Only
    // motion_opportunity items sometimes carry real citations (routed
    // normally when they do); the other three exempt unconditionally.
    if (motionOpportunityRows.length) {
      await addGatedFindings(db, caseId, motionOpportunityRows, { exemptCitation: true });
    }
    if (strategyRecommendationRows.length) {
      await addGatedFindings(db, caseId, strategyRecommendationRows, { exemptCitation: true });
    }
    if (nextActionRows.length) {
      await addGatedFindings(db, caseId, nextActionRows, { exemptCitation: true });
    }
    if (crossExaminationRows.length) {
      await addGatedFindings(db, caseId, crossExaminationRows, { exemptCitation: true });
    }
  } catch (err) {
    console.error("[report:reconciliation] failed to route intelligence-chunk output through addGatedFindings", {
      caseId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
  const motionsSuppressed = allowReportMotionGeneration ? 0 : motionsGuarded.items.length;
  const motionsAccepted = allowReportMotionGeneration ? motionsGuarded.items.length : 0;
  const totalProseDropped = Object.values(validatorAudit).reduce(
    (n, x) => n + (x?.dropped ?? 0),
    0,
  );
  // FIX (2026-08-16): these three used to write under "theory"/"strategy"/
  // "opportunity" — the SAME engine keys engines.server.ts's
  // runTheoryEngine/runStrategyEngine/runOpportunityEngine already write to
  // (via runCatalogedEngine, canonical.ts's CANONICAL_STAGES). Report
  // generation runs AFTER those real engines, so buildEnginesSummary's
  // documented last-wins-by-created_at behavior meant this row always
  // silently overwrote the real engine's row — including its real
  // runtime_ms and generated/rejected counts — with this local, unrelated
  // "did the report-writer's own intelligence chunk carry theories/
  // strategy/opportunities" count. Confirmed live on a real case
  // (ADR-4640-2017): engines_summary.theory/opportunity showed
  // status="completed", runtime_ms=0, generated=0 with no error — indistinguishable
  // from "never ran" — while the real engines had already run
  // (case_theories/case_opportunities correctly reflect the real,
  // separately-gated 0-theory outcome, not this ledger artifact). Exact same
  // bug class already fixed once in this file for "contradictions" vs
  // "report_contradictions" below — renamed the same way instead of
  // reusing the real engine's key. AGENT_ENGINE_MAP.legal (statistics.
  // server.ts) updated alongside so the "legal" 13-agent panel still counts
  // these rows as executed.
  await db.from("pipeline_engine_runs").insert([
    subRow(
      "report_theory",
      Array.isArray(theories) ? (theories as unknown[]).length : 0,
      Array.isArray(theories) ? (theories as unknown[]).length : 0,
    ),
    subRow(
      "report_strategy",
      Array.isArray(strategyRows) ? (strategyRows as unknown[]).length : 0,
      Array.isArray(strategyRows) ? (strategyRows as unknown[]).length : 0,
    ),
    subRow(
      "report_opportunity",
      Array.isArray(opps) ? (opps as unknown[]).length : 0,
      Array.isArray(opps) ? (opps as unknown[]).length : 0,
    ),
    subRow("motion", motionsRaw.length, motionsAccepted, motionsSuppressed, {
      gate: allowReportMotionGeneration ? "open" : reportCaseAnalysisMode === "concluded_audit" ? "concluded_audit_blocked" : "ess_blocked",
    }),
    subRow("ess_validator", findings.length, findings.length, 0, {
      bin: ess.bin,
      score: ess.score,
      allowMotion: allowReportMotionGeneration,
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

  // NOTE: we intentionally do NOT flip the REAL pipeline_engine_runs
  // report_generator row to "completed" here — see below. The runEngine
  // wrapper does that as the very last step, AFTER reports.upsert has been
  // confirmed. Marking the real ledger row complete early would create a
  // window where the ledger says "done" but the report row hasn't been
  // written yet — and if the process is killed in that window, the run
  // appears successful while artifacts are missing. That's correct and
  // untouched below.
  // finalizeEnginesSummaryForEmbed patches ONLY this embedded display copy's
  // report_generator entry to "completed" — the real ledger row's deferred
  // flip above is untouched. See that function's doc comment for why this
  // half is safe and why leaving it unpatched was showing every completed
  // report as still "generating" on the Reports page forever.
  const enginesSummary = finalizeEnginesSummaryForEmbed(await buildEnginesSummary(db, caseId));

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
  const findingIds = findings
    .map((f) => f.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const uncoveredFindings = findingIds.filter((id) => !reportJsonForAudit.includes(id));
  if (uncoveredFindings.length) {
    pipelineWarnings.push(`uncovered_findings:${uncoveredFindings.length}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed as any)._coverage_gaps = uncoveredFindings.slice(0, 100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proseAny = (parsed.prose ?? {}) as Record<string, any>;
    if (
      typeof proseAny.coverage_summary !== "string" ||
      proseAny.coverage_summary.trim().length === 0
    ) {
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
  const totalGenerated = Math.max(
    findingsAudit.total_generated,
    renderedFindingsCount + suppressedCount,
  );
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

  // Canonical Reconciliation Design (2026-08-16), P2 §10 — the per-dimension
  // scoring stage (above, ~line 4918) already reconciles the LLM's own
  // dimension_breakdowns against computeDeterministicScorecard: deterministic
  // is authoritative, the LLM value is comparison-only, and a MODEL_DISAGREEMENT
  // flag fires when they diverge by more than SCORE_DISAGREEMENT_THRESHOLD.
  // The report-writer's own top-level case_strength_score (a SEPARATE, LATER
  // LLM call, self-reported with no grounding beyond "sound plausible") never
  // got the same treatment — both numbers render in the same report with
  // nothing ever comparing them. Deliberately narrow: only case_strength_score
  // gets a deterministic counterpart here (the mean of this same scorecard's
  // per-dimension scores, already computed just below) — risk_score has no
  // clean deterministic equivalent anywhere in this codebase, so this does
  // NOT fabricate one for it.
  const reportDeterministicScorecard = computeDeterministicScorecard(
    findings as unknown as Parameters<typeof computeDeterministicScorecard>[0],
    caseType,
  );
  const reportDimScores = Object.values(reportDeterministicScorecard.dimensions)
    .map((d) => d.score)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const reportCaseStrengthScoreRaw = gatedScore(parsed.case_strength_score);
  const {
    computeCaseStrengthDisagreement,
    reconcileCaseStrengthScore,
    SCORE_DISAGREEMENT_THRESHOLD: reportScoreDisagreementThreshold,
  } = await import("./intelligence/case-state.server");
  const {
    deterministic: reportDeterministicStrength,
    delta: reportCaseStrengthDelta,
    disagreement: reportCaseStrengthDisagreement,
  } = computeCaseStrengthDisagreement(reportCaseStrengthScoreRaw, reportDimScores);
  // FIX (2026-08-17): case_strength_score was persisted as the raw,
  // self-reported LLM number even though a deterministic counterpart (the
  // mean of this report's own per-dimension scorecard, computed just above)
  // was available. The MODEL_DISAGREEMENT flag this same call computes was
  // informational only — score_consistency is never read by any UI/export
  // renderer — so a case_strength_score that disagreed with
  // case_scores.overall_confidence by 16+ points rendered right alongside
  // it, both looking equally authoritative, with nothing actually
  // reconciling them. Confirmed live across three case runs (dashboard
  // "Overall confidence"/"Case quality" cards and case_strength_score all
  // showing different numbers for the same report). reconcileCaseStrengthScore
  // (case-state.server.ts) applies the same "deterministic overrides LLM"
  // rule case_scores' own dimensions already enforce.
  const reportCaseStrengthScore = reconcileCaseStrengthScore(
    reportCaseStrengthScoreRaw,
    reportDeterministicStrength,
  );

  const reportGeneratedLanguage = await getReportLocale(db, caseId);
  const reportIsPenal =
    isCriminalCaseType(caseType) || isCriminalCaseType(reportUnderlyingMateria);
  const reportPenalPerspectiveScores = reportIsPenal
    ? computePenalPerspectiveScores(
        findings as unknown as Parameters<typeof computePenalPerspectiveScores>[0],
      )
    : null;
  const reportRiskScore = reportIsPenal
    ? gatedScore(reportPenalPerspectiveScores!.reversal_risk.score)
    : gatedScore(parsed.risk_score);
  const { enforceRiskNarrative } = await import("./score-bands");
  const reportRiskConsistency =
    typeof reportRiskScore === "number"
      ? enforceRiskNarrative(
          reportRiskScore,
          pick("risk_analysis"),
          reportGeneratedLanguage === "en" ? "en" : "es",
        )
      : {
          text: pick("risk_analysis"),
          rewritten: false,
          band: null,
        };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reportRow: any = {
    case_id: caseId,
    user_id: userId,
    // Stamp the language this report's content was generated in, so exports
    // (PDF/DOCX) render their template in the same language and historical
    // reports keep their original language if the case preference changes.
    generated_language: reportGeneratedLanguage,

    attorney_summary: pick("attorney_summary"),
    evidence_summary: pick("evidence_summary"),
    timeline_summary: pick("timeline_summary"),
    contradiction_report: pick("contradiction_report"),
    missing_evidence_report: pick("missing_evidence_report"),
    recommendations: pick("recommendations"),
    executive_summary: penalOutcomeHeading
      ? `${penalOutcomeHeading}\n\n${pick("executive_summary")}`
      : pick("executive_summary"),
    investigator_summary: pick("investigator_summary"),
    case_overview: penalOutcomeHeading
      ? `${penalOutcomeHeading}\n\n${pick("case_overview")}`
      : pick("case_overview"),
    facts: pick("facts"),
    witness_analysis: pick("witness_analysis"),
    constitutional_issues: constProseOverride,
    discovery_analysis: pick("discovery_analysis"),
    procedural_issues_report: pick("procedural_issues_report"),
    prosecution_theory_report: pick("prosecution_theory_report"),
    defense_theory_report: pick("defense_theory_report"),
    alternative_theory_report: pick("alternative_theory_report"),
    risk_analysis: reportRiskConsistency.text,
    score_breakdown: pick("score_breakdown"),
    appendix_sources: pick("appendix_sources"),
    // Full intelligence package — every engine output the platform produced
    full_report: {
      ...parsed,
      case_type: caseType,
      case_analysis_mode: reportCaseAnalysisMode,
      penal_disposition: penalDisposition,
      penal_perspective_scores: reportPenalPerspectiveScores,
      risk_consistency: {
        authoritative_score: reportRiskScore,
        band: reportRiskConsistency.band,
        narrative_rewritten: reportRiskConsistency.rewritten,
      },
      findings_summary: findingsSummary,
      coverage_report: await computeCoverage(db, caseId),
      deterministic_scorecard: reportDeterministicScorecard,
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
              const sev = (
                ["low", "medium", "high", "critical"].includes(f.severity) ? f.severity : "medium"
              ) as "low" | "medium" | "high" | "critical";
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
            .filter(
              (s): s is { tag: string; severity: "low" | "medium" | "high" | "critical" } =>
                s !== null,
            );
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
              internal_consistency:
                typeof w.consistency_score === "number" ? w.consistency_score : undefined,
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
            caseType,
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
            (Number(chunkStatus.narrative.ok) +
              Number(chunkStatus.memo.ok) +
              Number(chunkStatus.intelligence.ok)) /
            3,
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
          allowMotionGeneration: allowReportMotionGeneration,
          secondary_validator: validatorAudit,
          motions_suppressed_by_gate: allowReportMotionGeneration ? 0 : motionsGuarded.items.length,
        },
        // Canonical Reconciliation Design (2026-08-16), P2 — visibility for
        // resolveReportCaseType's conflict override: when true, the report's
        // materia (`case_type` above) was NOT the attorney's manually-locked
        // value, because that locked value actively disagreed with CONFIRMED
        // classification evidence (see case-classification.server.ts's
        // resolveCaseIdentity, status "conflict"). The report instead used
        // the same neutral-detection fallback resolveCaseType uses when
        // nothing is locked at all — an attorney reviewing this report
        // should re-confirm the case type given the underlying conflict.
        materia_classification: {
          case_type: caseType,
          identity_conflict: reportMateriaConflict,
          policy: reportMateriaConflict
            ? "The attorney-locked case type disagreed with CONFIRMED classification evidence from the corpus. This report was generated using the corpus-detected materia instead of the locked value — review the case type before relying on materia-specific sections (constitutional analysis, motion catalogue, scoring dimensions)."
            : "No classification conflict detected.",
        },
        // Canonical Reconciliation Design (2026-08-16), P2 — mirrors the
        // per-dimension MODEL_DISAGREEMENT mechanism (case_scores stage,
        // ~line 4918) for the single top-level case_strength_score, which
        // never had an equivalent check: deterministic_scorecard above is
        // authoritative for every dimension; case_strength_score is a
        // separate, later, self-reported LLM number. score_deterministic is
        // the mean of this same scorecard's per-dimension scores — the same
        // 0-100 scale case_strength_score claims to be on. risk_score has no
        // deterministic counterpart anywhere in this codebase, so it is NOT
        // compared here rather than inventing one.
        score_consistency: {
          // FIX (2026-08-17): case_strength_score here used to be the
          // ALREADY-RECONCILED value (reconcileCaseStrengthScore overrides
          // it to match case_strength_score_deterministic whenever both
          // exist) — so a real disagreement showed as "65, deterministic 65,
          // delta 10," internally contradictory to anyone reading this
          // diagnostic object directly. case_strength_score_llm_raw is the
          // actual pre-reconciliation self-reported number the delta was
          // computed against; case_strength_score is what was actually
          // persisted (post-reconciliation, i.e. always == the deterministic
          // value when both exist).
          case_strength_score: reportCaseStrengthScore,
          case_strength_score_llm_raw: reportCaseStrengthScoreRaw,
          case_strength_score_deterministic:
            typeof reportDeterministicStrength === "number"
              ? Math.round(reportDeterministicStrength)
              : null,
          delta: typeof reportCaseStrengthDelta === "number" ? Math.round(reportCaseStrengthDelta) : null,
          disagreement_threshold: reportScoreDisagreementThreshold,
          flags: reportCaseStrengthDisagreement ? ["MODEL_DISAGREEMENT"] : [],
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
    case_strength_score: reportCaseStrengthScore,
    risk_score: reportRiskScore,
    scores_suppressed: isLimited,
    motions_suppressed: isLimited,
    // FIX (2026-08-04): reports.report_mode and reports.findings_count are
    // real top-level columns (see migration 20260710001630) that a database
    // trigger (tg_mirror_reports_to_canonical) mirrors into
    // canonical_analysis on every write -- but this upsert only ever set
    // `report_mode` nested inside full_report.audit.report_mode, never as
    // its own column, so both columns (and their canonical_analysis mirror)
    // stayed permanently null even on a fully-populated report. Confirmed on
    // a live case: full report content, scores_suppressed/motions_suppressed
    // correctly false, but report_mode/findings_count null on the row.
    report_mode: reportMode,
    findings_count: findings.length,
    engines_summary: enginesSummary as unknown as J,
    intelligence_version: INTELLIGENCE_VERSION,
    // Phase 4: which canonical_analysis.version this report was rendered
    // from. NULL when the flag is off or the raw-table fallback ran.
    canonical_version: canonicalVersion,
    // Continuous Legal Intelligence Phase C (§15): the latest DEPLOYED
    // intelligence_versions.version for this user at generation time, or
    // null if none has ever been deployed — distinct from
    // intelligence_version above (the pipeline/engine tag). Forensic
    // reproducibility: this report's validation-rule behavior stays
    // pinned to this number even after a later version deploys.
    adaptive_intelligence_version: await (
      await import("./intelligence/validation-rules.server")
    ).getCurrentIntelligenceVersion(db, userId),
  };

  // Stash disputed-issues inside full_report (no dedicated column).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (reportRow.full_report as any).disputed_issues = disputedIssues;

  // Goal-first layer — the report must OPEN by answering the attorney's
  // primary question for this materia, with decision support attached.
  // Deterministic: assembled only from verified findings/gaps already above.
  try {
    const { buildObjectiveBlock } = await import("./reporting/objective");
    const { count: docsTotal } = await db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId);
    const objective = buildObjectiveBlock({
      caseType,
      locale: (await getReportLocale(db, caseId)) === "en" ? "en" : "es",
      findings: findings as unknown as Parameters<typeof buildObjectiveBlock>[0]["findings"],
      contradictions: factualContradictions.length,
      missingEvidence: missingGuarded.items as unknown as Parameters<
        typeof buildObjectiveBlock
      >[0]["missingEvidence"],
      scores: {
        strength: reportCaseStrengthScore,
        risk: reportRiskScore,
        suppressed: isLimited,
      },
      documentsTotal: docsTotal ?? 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow.full_report as any).objective = objective;
  } catch (e) {
    console.warn("[report] objective block failed", e);
  }

  // STEP 2 directive — per-document Evidence Map, OCR coverage, and report
  // quality audit. All deterministic, all reconcilable against the persisted
  // findings + documents tables.
  try {
    const { buildEvidenceMap, buildOcrCoverage, buildReportQualityAudit } =
      await import("./intelligence/evidence-map.server");
    const { buildCanonicalTimeline } = await import("./intelligence/canonical-timeline.server");
    const { buildDocumentGraph } = await import("./intelligence/document-graph.server");
    const { buildCitationAudit } = await import("./intelligence/citation-audit.server");
    const [
      evidenceMap,
      ocrCoverage,
      qualityAudit,
      canonicalTimeline,
      documentGraph,
      citationAudit,
    ] = await Promise.all([
      buildEvidenceMap(db, caseId),
      buildOcrCoverage(db, caseId),
      buildReportQualityAudit(db, caseId),
      buildCanonicalTimeline(db, caseId),
      buildDocumentGraph(db, caseId),
      buildCitationAudit(db, caseId),
    ]);
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

    // FIX (2026-08-16, "quarantine/rendering disconnect"): citationAudit just
    // above is computed from case_findings — a completely different, LATER
    // pass than the one that built canonical_recommendations/next_actions/
    // strategy_recommendations near the top of this function (~6800 lines
    // earlier) directly from raw, ungated LLM chunk output. Those lists have
    // no way to know a title they contain was just quarantined for having
    // ZERO supporting citation. Confirmed live on two consecutive real cases
    // (ADR-4640-2017, ADR-2239-2018): "Preparar recurso de revisión ante la
    // SCJN." was quarantined here (reason: missing_all) yet still rendered as
    // a High/Critical-priority action item, because nothing downstream of
    // this point ever consulted citationAudit's decision. Filtering happens
    // HERE — the first point in the function where citationAudit actually
    // exists — rather than trying to move citation_audit earlier, since it
    // itself depends on case_findings rows the report-writer routing step
    // (normalizeReportWriterFindings/addGatedFindings) only finishes writing
    // moments before this. motion_opportunities is NOT included here — it
    // already goes through verifyAndLabel + enforceStructuredItems
    // (motionsGuarded) earlier and is quote-verified, a stronger guarantee
    // than this title-match check.
    if (citationAudit.quarantined > 0) {
      const { filterQuarantinedRecommendations } = await import("./intelligence/report-recommendations");
      const quarantinedTitles = citationAudit.quarantined_findings.map((f) => f.title).filter(Boolean);
      const fr = reportRow.full_report as Record<string, unknown>;
      let removedCount = 0;
      if (Array.isArray(fr.canonical_recommendations)) {
        const { items, removed } = filterQuarantinedRecommendations(
          fr.canonical_recommendations as Array<{ title?: unknown }>,
          quarantinedTitles,
          (i) => String(i?.title ?? ""),
        );
        fr.canonical_recommendations = items;
        removedCount += removed.length;
      }
      // FIX (2026-08-17): reports.next_actions/strategy_recommendations are
      // SEPARATE top-level columns (line ~8713-8714), assigned directly from
      // the same raw pre-quarantine `nextActions`/`strategy` variables — not
      // derived from full_report.next_actions/full_report.strategy_recommendations.
      // The nested full_report copies below were correctly filtered, but the
      // top-level columns — what reports.tsx's PDF/DOCX/UI actually render —
      // were never touched, so a quarantined item filtered out of the nested
      // copy still rendered via its top-level sibling. Confirmed live: on a
      // real ADR-4640-2017 run, "Presentar recurso de revisión" (quarantined,
      // reason: missing_all) was correctly absent from full_report.strategy_recommendations
      // but still rendered in the PDF's "Recomendaciones Estratégicas" table,
      // sourced from the unfiltered top-level column. Same fix, both places.
      if (Array.isArray(fr.next_actions) || Array.isArray(reportRow.next_actions)) {
        const { items, removed } = filterQuarantinedRecommendations(
          (Array.isArray(fr.next_actions) ? fr.next_actions : reportRow.next_actions ?? []) as Array<{
            action?: unknown;
          }>,
          quarantinedTitles,
          (i) => String(i?.action ?? ""),
        );
        fr.next_actions = items;
        reportRow.next_actions = items;
        removedCount += removed.length;
      }
      if (Array.isArray(fr.strategy_recommendations) || Array.isArray(reportRow.strategy_recommendations)) {
        const { items, removed } = filterQuarantinedRecommendations(
          (Array.isArray(fr.strategy_recommendations)
            ? fr.strategy_recommendations
            : reportRow.strategy_recommendations ?? []) as Array<{ title?: unknown }>,
          quarantinedTitles,
          (i) => String(i?.title ?? ""),
        );
        fr.strategy_recommendations = items;
        reportRow.strategy_recommendations = items;
        removedCount += removed.length;
      }
      // FIX (2026-08-17): legal_memorandum.next_actions is a THIRD, separate
      // "action items" array (schema: {action, owner, deadline, priority} —
      // no citation field of its own) sourced from the same raw report-writer
      // output, also never consulted citationAudit. Confirmed live on the
      // same case: "Preparar y presentar el recurso de revisión." (matching
      // the same quarantined finding) rendered here too.
      const memoNextActions = (fr.legal_memorandum as Record<string, unknown> | undefined)?.next_actions;
      if (Array.isArray(memoNextActions)) {
        const { items, removed } = filterQuarantinedRecommendations(
          memoNextActions as Array<{ action?: unknown }>,
          quarantinedTitles,
          (i) => String(i?.action ?? ""),
        );
        (fr.legal_memorandum as Record<string, unknown>).next_actions = items;
        removedCount += removed.length;
      }
      if (removedCount > 0) {
        pipelineWarnings.push(
          `quarantine_propagation: ${removedCount} recommendation(s)/action(s) removed — matched a citation_audit-quarantined finding (zero supporting citation).`,
        );
      }
    }

    // FIX (2026-08-16, "quarantine/rendering disconnect" bug report, item 3):
    // legal_memorandum.legal_analysis is the one major structured section
    // that never passed through ANY citation/claim verification (see
    // legal-memorandum-grounding.ts's header for the full trace of why).
    // Confirmed live: a legal_analysis entry cited "[DOC 1 p.12]" for a
    // specific statute number ("artículo 61 de la Ley de Amparo") that does
    // not appear anywhere in the source, on page 12 or otherwise. Checked
    // here against the REAL per-page text (document_pages), reusing
    // checkClaimEvidenceRelevance — already calibrated against two real
    // failure cases from this exact case family — rather than the coarser
    // whole-document orphaned-citations scan below, which only checks that
    // the (doc, page) pair exists, not that the page supports the claim.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legalAnalysisArr = (reportRow.full_report as any).legal_memorandum?.legal_analysis;
    // FIX (2026-08-17): recommended_motions is the sibling section a
    // pipeline-wide sweep found had ZERO verification of any kind — unlike
    // motion_opportunities (verifyAndLabel + claim-strength guardrail),
    // draft_paragraph is explicitly prompted as "a ready-to-file paragraph,"
    // the single most directly exploitable field in the whole
    // legal_memorandum. See gateRecommendedMotions's doc comment
    // (legal-memorandum-grounding.ts) for the two checks it applies.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recommendedMotionsArr = (reportRow.full_report as any).legal_memorandum?.recommended_motions;
    // FIX (2026-08-17): evidence_appendix/statement_of_facts are the last two
    // legal_memorandum sections the same sweep found ungated. evidence_appendix
    // has a key_quote field (checked against the whole corpus, same standard
    // as recommended_motions' factual_basis — its schema has no doc_n to pin a
    // page-specific check to). statement_of_facts entries are the attorney's
    // own paraphrased restatement of a fact, not verbatim quotes — see
    // gateStatementOfFacts's doc comment for why checkClaimEvidenceRelevance
    // (topical overlap) is the right tool there instead of verifyQuote.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evidenceAppendixArr = (reportRow.full_report as any).legal_memorandum?.evidence_appendix;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statementOfFactsObj = (reportRow.full_report as any).legal_memorandum?.statement_of_facts;
    const hasLegalAnalysis = Array.isArray(legalAnalysisArr) && legalAnalysisArr.length > 0;
    const hasRecommendedMotions = Array.isArray(recommendedMotionsArr) && recommendedMotionsArr.length > 0;
    const hasEvidenceAppendix = Array.isArray(evidenceAppendixArr) && evidenceAppendixArr.length > 0;
    const hasStatementOfFacts = statementOfFactsObj && typeof statementOfFactsObj === "object";
    if (hasEvidenceAppendix) {
      const { gateEvidenceAppendix } = await import("./intelligence/legal-memorandum-grounding");
      const { items, droppedCount } = gateEvidenceAppendix(evidenceAppendixArr, verifyQuote, reportCorpus);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reportRow.full_report as any).legal_memorandum.evidence_appendix = items;
      if (droppedCount > 0) {
        pipelineWarnings.push(
          `legal_memorandum_grounding: ${droppedCount} evidence_appendix entr${droppedCount === 1 ? "y" : "ies"} dropped — key_quote does not exist in the real corpus.`,
        );
      }
    }
    if (hasLegalAnalysis || hasRecommendedMotions || hasStatementOfFacts) {
      const { data: pageRows } = await db
        .from("document_pages")
        .select("document_id,page,text")
        .eq("case_id", caseId);
      const idToDocN = new Map([...docNToId.entries()].map(([n, id]) => [id, n]));
      const pageTextByKey = new Map<string, string>();
      for (const row of pageRows ?? []) {
        const docN = idToDocN.get(row.document_id as string);
        if (docN != null && typeof row.text === "string") {
          pageTextByKey.set(`${docN}:${row.page}`, row.text);
        }
      }
      if (pageTextByKey.size > 0) {
        const { gateLegalAnalysis, gateRecommendedMotions, gateStatementOfFacts } = await import(
          "./intelligence/legal-memorandum-grounding"
        );
        if (hasLegalAnalysis) {
          const { items, droppedCount } = gateLegalAnalysis(legalAnalysisArr, pageTextByKey);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reportRow.full_report as any).legal_memorandum.legal_analysis = items;
          if (droppedCount > 0) {
            pipelineWarnings.push(
              `legal_memorandum_grounding: ${droppedCount} legal_analysis entr${droppedCount === 1 ? "y" : "ies"} dropped — cited a real (doc, page) pair whose actual text does not support the claim.`,
            );
          }
        }
        if (hasRecommendedMotions) {
          const { items, droppedCount } = gateRecommendedMotions(
            recommendedMotionsArr,
            pageTextByKey,
            verifyQuote,
            reportCorpus,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reportRow.full_report as any).legal_memorandum.recommended_motions = items;
          if (droppedCount > 0) {
            pipelineWarnings.push(
              `legal_memorandum_grounding: ${droppedCount} recommended_motion(s) dropped — no verified factual_basis or an ungrounded citation.`,
            );
          }
        }
        if (hasStatementOfFacts) {
          const { checkClaimEvidenceRelevance } = await import("./intelligence/claim-evidence-relevance");
          const { statementOfFacts, droppedCount } = gateStatementOfFacts(
            statementOfFactsObj,
            pageTextByKey,
            checkClaimEvidenceRelevance,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reportRow.full_report as any).legal_memorandum.statement_of_facts = statementOfFacts;
          if (droppedCount > 0) {
            pipelineWarnings.push(
              `legal_memorandum_grounding: ${droppedCount} statement_of_facts entr${droppedCount === 1 ? "y" : "ies"} dropped — cited page has no topical relationship to the claim.`,
            );
          }
        }
      }
    }

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
    // report-quality-gate.ts's scoreReportQuality() result (spread into
    // full_report.quality_gate via `...parsed` above) was computed and
    // persisted but never read anywhere else in the codebase — confirmed by
    // grep, the only occurrence of "quality_gate" before this line was its
    // own write site. Surface it as a warning, the same non-blocking
    // pattern as citation_audit/report_quality/ocr_coverage/evidence_map
    // just above. Deliberately NOT added to blockReasons: its own header
    // comment says the 70-point threshold and dimension weights are
    // hand-picked, not calibrated against real attorney outcomes yet — the
    // same kind of premature-blocking risk that forced release-gate.ts's
    // 2026-07-31 revert to warning-only after it wrongly blocked a correct
    // report. Making the score visible now is the safe, valuable step;
    // promoting it to blocking is a separate, later decision that needs
    // real calibration data first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qualityGate = (reportRow.full_report as any)?.quality_gate as
      | { score?: number; passed?: boolean; critical_issues?: string[] }
      | undefined;
    if (qualityGate && !qualityGate.passed) {
      const issues = qualityGate.critical_issues ?? [];
      pipelineWarnings.push(
        `quality_gate: score ${qualityGate.score ?? "?"}/100, below the 70-point readiness threshold` +
          (issues.length > 0
            ? ` — ${issues.join("; ")}`
            : " — see full_report.quality_gate for detail"),
      );
    }
    // Canonical Reconciliation Design (2026-08-16), P3 §10 — the same prose-
    // walking case-type-leak scan that already exists (prerender-
    // validate.server.ts's validateBeforeRender) only ever ran against
    // canonical_analysis, an additive shadow projection that is NOT what
    // this report row's own content — reportRow/full_report, what
    // export.ts/the report UI actually render — gets checked against.
    // validateRenderedReport is the same approach pointed at the real
    // content, plus a Spanish criminal-institution denylist. Same non-
    // blocking pattern as quality_gate immediately above: this is real,
    // valuable visibility; promoting specific leak types to blocking is a
    // separate, later decision.
    try {
      const { validateRenderedReport } = await import("@/lib/canonical/prerender-validate.server");
      const renderedQaIssues = validateRenderedReport(
        reportRow as unknown as Record<string, unknown>,
        caseType,
        reportUnderlyingMateria,
      );
      const renderedQaCritical = renderedQaIssues.filter((i) => i.severity === "critical");
      if (renderedQaCritical.length > 0) {
        pipelineWarnings.push(
          `rendered_report_qa: ${renderedQaCritical.length} critical issue(s) — ${renderedQaCritical
            .slice(0, 5)
            .map((i) => `${i.code} at ${i.section}`)
            .join("; ")}` + (renderedQaCritical.length > 5 ? "; …" : ""),
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reportRow.full_report as any).rendered_qa = {
        policy:
          "Scans the actual rendered report content (not the separate canonical_analysis projection) for unresolved template tokens and case-type-inappropriate terminology, including a Spanish criminal-institution denylist. Informational — does not block report generation.",
        issue_count: renderedQaIssues.length,
        critical_count: renderedQaCritical.length,
        issues: renderedQaIssues.slice(0, 50),
      };
    } catch (e) {
      console.warn(
        "[rendered-report-qa] failed:",
        e instanceof Error ? e.message : e,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow as any).quality_blocked = blockReasons.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reportRow as any).quality_block_reasons = blockReasons;
  } catch (e) {
    console.warn(
      "[evidence-map/ocr/quality/citation-audit] failed:",
      e instanceof Error ? e.message : e,
    );
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
      const { reconcileManifest, summarizeReleaseGate } =
        await import("./intelligence/release-gate");
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
        (reportRow.full_report as any).pipeline_warnings = [
          ...warns,
          ...summarizeReleaseGate(verdict),
        ];
      }
    } catch {
      // Release-gate reconciliation must never break report generation.
    }
  }

  // Independent QA layer statuses. A passing citation audit cannot
  // overwrite a rendering or release failure (and vice versa); each layer
  // preserves its own result and evidence count.
  try {
    const {
      auditPenalProceduralSemantics,
      buildPenalQaStatuses,
    } = await import("./intelligence/penal-qa-status");
    const { data: hallucinationRun } = await db
      .from("pipeline_engine_runs")
      .select("status")
      .eq("case_id", caseId)
      .eq("engine", ENGINE.hallucination)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fullReport = reportRow.full_report as Record<string, any>;
    const citationQa = fullReport.citation_audit as
      | { quarantined?: number }
      | undefined;
    const renderedQa = fullReport.rendered_qa as
      | { critical_count?: number }
      | undefined;
    const releaseQa = fullReport.release_gate as
      | { issues?: unknown[]; ok?: boolean }
      | undefined;
    fullReport.qa_statuses = buildPenalQaStatuses({
      applicable: reportIsPenal,
      citationQuarantined:
        typeof citationQa?.quarantined === "number" ? citationQa.quarantined : null,
      hallucinationEngineStatus:
        typeof hallucinationRun?.status === "string" ? hallucinationRun.status : null,
      classificationConflicts: reportMateriaConflict ? 1 : 0,
      proceduralSemanticIssues: auditPenalProceduralSemantics(
        findings as unknown as Parameters<typeof auditPenalProceduralSemantics>[0],
      ),
      renderedCriticalIssues:
        typeof renderedQa?.critical_count === "number" ? renderedQa.critical_count : null,
      releaseGateIssues: Array.isArray(releaseQa?.issues)
        ? releaseQa.issues.length
        : releaseQa?.ok === true
          ? 0
          : null,
      qualityBlocked: Boolean(reportRow.quality_blocked),
    });
  } catch (qaStatusError) {
    console.warn(
      "[penal-qa-status] independent QA status build failed:",
      qaStatusError instanceof Error ? qaStatusError.message : qaStatusError,
    );
  }

  // Execution identity + stale-row eviction.
  // `reports` is keyed by case_id, so an upsert would otherwise MERGE this
  // run's columns into the row written by the previous execution — leaving
  // whichever columns this run didn't write (and the old report id) intact.
  // When the persisted row belongs to a different execution, delete it first
  // so the new report is a clean insert with its own id.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caseRow } = await (db as any)
      .from("cases")
      .select("execution_id")
      .eq("id", caseId)
      .maybeSingle();
    const executionId = (caseRow as { execution_id?: string | null } | null)?.execution_id ?? null;
    if (executionId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prior } = await (db as any)
        .from("reports")
        .select("id,execution_id")
        .eq("case_id", caseId)
        .maybeSingle();
      const priorExec = (prior as { execution_id?: string | null } | null)?.execution_id ?? null;
      if (prior && priorExec !== executionId) {
        await db.from("report_versions").delete().eq("case_id", caseId);
        await db.from("reports").delete().eq("case_id", caseId);
      }
      reportRow.execution_id = executionId;
    }
  } catch (execErr) {
    console.warn(
      `[pipeline.report] execution stamping skipped for case ${caseId}: ${
        execErr instanceof Error ? execErr.message : String(execErr)
      }`,
    );
  }

  assertDbOk(
    (await db.from("reports").upsert(reportRow, { onConflict: "case_id" })).error,
    "Failed to save report",
  );

  // If this run followed Add Evidence, calculate the delta now: the new
  // report is persisted, while report_versions still points at the baseline
  // captured before the upload. Doing this in the pipeline avoids the old
  // client race that finalized the change log immediately after queueing.
  try {
    const { finalizeReportChangeLogForCase } = await import("./cases.functions");
    await finalizeReportChangeLogForCase(db, caseId);
  } catch (changeLogError) {
    console.warn(
      "[report-change-log] automatic finalization skipped:",
      changeLogError instanceof Error ? changeLogError.message : changeLogError,
    );
  }

  // Immutable version snapshot — directive Phase 1.1.
  // Read back the persisted row so the snapshot reflects exactly what was
  // saved (version, change_log, quality_blocked, etc.).
  try {
    const { data: saved } = await db
      .from("reports")
      .select("*")
      .eq("case_id", caseId)
      .maybeSingle();
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
          typeof savedAny.canonical_version === "number"
            ? (savedAny.canonical_version as number)
            : null,
        report: savedAny,
        changeLog: (savedAny.change_log as Record<string, unknown> | null) ?? null,
        meta: {
          documentCount:
            (
              await db
                .from("documents")
                .select("id", { count: "exact", head: true })
                .eq("case_id", caseId)
            ).count ?? 0,
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
          score:
            typeof savedAny.case_strength_score === "number"
              ? (savedAny.case_strength_score as number)
              : null,
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
    // A saved report is still a DRAFT until the post-report agents approve
    // it. Never expose an intermediate "complete / ready" state between the
    // report write and runFinalReleaseReview().
    status: "reporting",
    status_message: "Report saved — final release review in progress",
    progress: 99,
    report_at: null,
    completed_at: null,
    error: null,
  });

  // ---- Final release review — the last step of the pipeline -------------
  // The completed report is now generated, saved and snapshotted. Only now
  // may a release decision be made: the release-gate agents (report, QA,
  // judge, hallucination) re-run against the saved report and write the
  // case's final status exactly once. Report generation above deliberately
  // never assigns "released"/"needs_revision" — generating a report and
  // approving a report are two separate actions. Infrastructure failures
  // here must not undo a successfully generated report, so this is
  // non-fatal.
  try {
    const { runFinalReleaseReview } = await import("@/lib/agents/orchestrator.server");
    const review = await runFinalReleaseReview({
      db,
      caseId,
      userId,
      apiKey,
      apiKeys: apiKeys ?? [apiKey],
    });
    if (!review.reviewed || review.status === "failed") {
      await setCase(db, caseId, {
        status: "needs_revision",
        status_message: "Final release review could not inspect the saved report — draft blocked.",
        progress: 99,
        report_at: null,
        completed_at: null,
        error: review.errors.join("; ").slice(0, 2000),
      });
    }
    console.info(`[final-release] case ${caseId} → ${review.status} (released=${review.released})`);
  } catch (e) {
    console.warn("[final-release] review failed after report generation", e);
    const message = e instanceof Error ? e.message : String(e);
    await setCase(db, caseId, {
      status: "needs_revision",
      status_message: "Final release review failed — report remains a blocked draft.",
      progress: 99,
      report_at: null,
      completed_at: null,
      error: `Final release review failed: ${message}`.slice(0, 2000),
    });
  }

  // ---- Completed Case Audit / Outcome Assessment -------------------------
  // Additive final layer, gated to case_analysis_mode !== "ongoing" (a no-op
  // for every existing case and every ongoing case — see
  // completed-case-audit.server.ts's own early return). Reads the findings/
  // score/report this pipeline just finished producing; never reprocesses
  // documents, never re-runs an analyzer or agent, never touches an existing
  // stage. Purely additive and non-fatal — a failure here must never undo a
  // successfully generated and released report.
  try {
    const { runCompletedCaseAudit } =
      await import("@/lib/intelligence/completed-case-audit.server");
    const audit = await runCompletedCaseAudit(db, caseId, userId, apiKey);
    if (audit) {
      console.info(
        `[completed-case-audit] case ${caseId} → ${audit.overall_position} (${audit.favorable_pct}% favorable, confidence=${audit.confidence})`,
      );
    }
  } catch (e) {
    console.warn("[completed-case-audit] audit failed after final release review", e);
  }

  return {
    value: undefined,
    stats: {
      generated: contradictionsRaw.length + motionsRaw.length,
      accepted: factualContradictions.length + motionsFinal.length,
      suppressed_ess: motionsSuppressed + (ess.allowQuantitativeScores ? 0 : 1),
    },
  };
}

// Test-only visibility. _runReportInner is otherwise module-private;
// exported under this name so the multi-agent release-gate guard can be
// exercised directly against a fake db, without invoking the full report
// assembly this function otherwise performs.
export { _runReportInner as __test__runReportInner };

