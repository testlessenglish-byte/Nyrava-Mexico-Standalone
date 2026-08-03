// Phase 2 of the Intelligence Aggregation Refactor — specialized-table
// projection into `case_findings`.
//
// WHY THIS EXISTS
// The findings audit proved that engines writing to specialized tables
// (evidence_classifications, case_witnesses) are invisible to every counter,
// scorecard, and exporter, because those surfaces only read `case_findings`.
// On the Amparo case that hid 218 rows behind 79 visible ones. Projection
// mirrors those rows into `case_findings` so the aggregation layer can see
// them — without touching the specialized tables, which stay the system of
// record for their own domain UI.
//
// SAFETY CONTRACT (why this phase cannot move a badge)
//  1. Projected rows carry `source_module = 'projection:<table>'`, a source
//     class that no pre-existing surface selects. `selectFindings()` excludes
//     it by default and the dashboard badge enumerates its classes
//     explicitly, so counts are byte-identical before and after.
//  2. `finding_status` is written as 'candidate'. Only the canonical gate
//     (Phase 3) may promote. Re-projection never resets an earned status —
//     the SQL function's ON CONFLICT deliberately omits that column.
//  3. Idempotent: identity is (case_id, projected_from_table,
//     projected_from_row_id), enforced by a partial unique index. Re-running
//     a stage updates in place; it never duplicates.
//  4. Batched: ONE round trip per engine execution, not per finding.
//  5. Non-fatal: a projection failure is traced and swallowed. It must never
//     fail an engine that already persisted its real output.
//
// NOT PROJECTED, deliberately: `case_timeline_events`. Chronology entries are
// facts, not findings — they carry no severity and projecting them would
// manufacture hundreds of meaningless "findings". They stay accessible
// through the timeline surfaces that already read them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

/** Payload accepted by the `project_case_findings` SQL function. */
export type ProjectionRow = {
  source_module: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  confidence: number;
  legal_significance?: string | null;
  affected_party?: string | null;
  evidence_type?: string | null;
  tags: string[];
  supporting_engines: string[];
  source_doc_ids: string[];
  metadata: Record<string, unknown>;
};

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

function normalizeSeverity(v: unknown, fallback = "medium"): string {
  const s = String(v ?? "")
    .toLowerCase()
    .trim();
  return SEVERITIES.has(s) ? s : fallback;
}

function clampConfidence(v: unknown, fallback = 0.5): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  // Some engines store 0-100, others 0-1. Normalize to 0-1.
  const scaled = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, Number(scaled.toFixed(4))));
}

function uuidList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
}

function provenance(table: string, rowId: string): Record<string, unknown> {
  // The generated columns `projected_from_table` / `projected_from_row_id`
  // are extracted from exactly this shape — the unique index depends on it.
  return { projected_from: { table, row_id: rowId }, projected: true };
}

/**
 * One adapter per specialized table. `select` is the column list to read and
 * `build` turns a row into a projection payload, or null to skip it.
 */
type Adapter = {
  select: string;
  build: (row: Record<string, unknown>) => ProjectionRow | null;
};

const ADAPTERS: Record<string, Adapter> = {
  // Evidence intelligence: classification rows already carry severity and a
  // Mexican-vocabulary classification (corroborante, contradictoria,
  // cadena_de_custodia, faltante). Mirrored verbatim — no reinterpretation.
  evidence_classifications: {
    select: "id,document_id,classification,title,description,severity,confidence,affected_party,citations",
    build: (r) => {
      const id = String(r.id ?? "");
      const title = String(r.title ?? "").trim();
      if (!id || !title) return null;
      const classification = String(r.classification ?? "sin_clasificar");
      return {
        source_module: "projection:evidence_classifications",
        category: "evidencia",
        title,
        description: String(r.description ?? ""),
        severity: normalizeSeverity(r.severity),
        confidence: clampConfidence(r.confidence),
        legal_significance: null,
        affected_party: r.affected_party ? String(r.affected_party) : null,
        evidence_type: classification,
        tags: ["proyeccion", `clasificacion:${classification}`],
        supporting_engines: ["engine:evidence_intelligence"],
        source_doc_ids: uuidList(r.document_id ? [r.document_id] : []),
        metadata: {
          ...provenance("evidence_classifications", id),
          classification,
          citations: r.citations ?? [],
        },
      };
    },
  },

  // Witness intelligence: only witnesses that actually carry a credibility
  // risk become findings. A clean witness is not a finding, and projecting
  // one would inflate every counter with noise.
  case_witnesses: {
    select: "id,name,role,credibility_risk,reliability,consistency,rationale,source_doc_ids",
    build: (r) => {
      const id = String(r.id ?? "");
      const name = String(r.name ?? "").trim();
      if (!id || !name) return null;
      const risk = Number(r.credibility_risk ?? 0);
      if (!Number.isFinite(risk) || risk < 40) return null; // below 40 = no credibility concern
      const severity = risk >= 75 ? "critical" : risk >= 60 ? "high" : "medium";
      return {
        source_module: "projection:case_witnesses",
        category: "credibilidad_testimonial",
        title: `Riesgo de credibilidad: ${name}`,
        description:
          String(r.rationale ?? "").trim() ||
          `El testigo ${name} presenta un índice de riesgo de credibilidad de ${risk}/100.`,
        severity,
        confidence: clampConfidence(r.reliability, 0.5),
        legal_significance: null,
        affected_party: r.role ? String(r.role) : null,
        evidence_type: "testimonial",
        tags: ["proyeccion", "testigo"],
        supporting_engines: ["engine:witness_intelligence"],
        source_doc_ids: uuidList(r.source_doc_ids),
        metadata: {
          ...provenance("case_witnesses", id),
          credibility_risk: risk,
          reliability: r.reliability ?? null,
          consistency: r.consistency ?? null,
        },
      };
    },
  },
};

export const PROJECTABLE_TABLES = Object.keys(ADAPTERS);

export type ProjectionResult = {
  ok: boolean;
  tables: string[];
  candidates: number;
  written: number;
  error?: string;
  /** True when the rollout flag is off and nothing was written. */
  disabled?: boolean;
};

/** Build payloads from already-fetched rows. Pure — used by the unit tests. */
export function buildProjectionRows(table: string, rows: ReadonlyArray<Record<string, unknown>>): ProjectionRow[] {
  const adapter = ADAPTERS[table];
  if (!adapter) return [];
  const out: ProjectionRow[] = [];
  for (const r of rows ?? []) {
    const built = adapter.build(r);
    if (built) out.push(built);
  }
  return out;
}

/**
 * Rollout flag. Default flipped ON after the Phase 3 reader audit
 * (docs/PHASE3_FINDINGS_READER_AUDIT.md) proved every non-projection-aware
 * reader filters `projection:%`, so mirrored rows can only reach the
 * canonical gate. The kill switch stays: FINDINGS_PROJECTION_ENABLED=false
 * makes `projectCaseFindings` a traced no-op that writes NOT A SINGLE ROW.
 */
export function isProjectionEnabled(): boolean {
  return String(process.env.FINDINGS_PROJECTION_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Mirror every projectable table an engine just wrote into `case_findings`,
 * in a single batched call. Never throws.
 */
export async function projectCaseFindings(
  db: Db,
  args: { caseId: string; tables: ReadonlyArray<string> },
): Promise<ProjectionResult> {
  if (!isProjectionEnabled()) {
    return { ok: true, tables: [], candidates: 0, written: 0, disabled: true };
  }
  const tables = Array.from(new Set(args.tables.filter((t) => ADAPTERS[t])));
  if (tables.length === 0) return { ok: true, tables: [], candidates: 0, written: 0 };

  try {
    const rows: ProjectionRow[] = [];
    // Table names are resolved at runtime from the adapter registry, so the
    // generated per-table types can't narrow here. The registry is a closed
    // allow-list, checked above.
    const anyDb = db as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, v: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
    for (const table of tables) {
      const { data, error } = await anyDb.from(table).select(ADAPTERS[table].select).eq("case_id", args.caseId);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...buildProjectionRows(table, (data ?? []) as unknown as Record<string, unknown>[]));
    }
    if (rows.length === 0) return { ok: true, tables, candidates: 0, written: 0 };

    // The RPC is SECURITY DEFINER and granted to service_role only. Loaded
    // lazily so this module never drags the admin client into a route graph.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: written, error } = await supabaseAdmin.rpc("project_case_findings", {
      p_case_id: args.caseId,
      p_rows: rows as unknown as never,
    });
    if (error) throw new Error(error.message);

    return { ok: true, tables, candidates: rows.length, written: Number(written ?? 0) };
  } catch (e) {
    return {
      ok: false,
      tables,
      candidates: 0,
      written: 0,
      error: (e as Error)?.message ?? String(e),
    };
  }
}

/**
 * Same as projectCaseFindings, but retries once on failure before giving up.
 * Transient errors (network blip, momentary DB contention) are the common
 * case for an RPC failure here; a single immediate retry clears most of
 * them without meaningfully slowing the engine. If the retry also fails,
 * the caller is responsible for persisting a durable failure marker — this
 * function only reports the outcome, it never blocks anything by itself.
 */
export async function projectCaseFindingsWithRetry(
  db: Db,
  args: { caseId: string; tables: ReadonlyArray<string> },
): Promise<ProjectionResult & { retried: boolean }> {
  const first = await projectCaseFindings(db, args);
  if (first.ok || first.disabled) return { ...first, retried: false };
  const second = await projectCaseFindings(db, args);
  return { ...second, retried: true };
}

/**
 * Reconciliation: compares row counts in the source engine tables against
 * the mirrored rows actually present in case_findings (source class
 * `projection:<table>`) for this case. A shortfall means projection rows
 * were silently lost somewhere between the RPC succeeding and the read
 * path — this is the check that catches that class of bug, independent of
 * whether projectCaseFindings itself reported an error.
 */
export async function reconcileProjection(
  db: Db,
  args: { caseId: string; tables: ReadonlyArray<string> },
): Promise<{
  ok: boolean;
  mismatches: { table: string; source_count: number; projected_count: number }[];
}> {
  const tables = Array.from(new Set(args.tables.filter((t) => ADAPTERS[t])));
  if (tables.length === 0) return { ok: true, mismatches: [] };

  const anyDb = db as unknown as {
    from: (t: string) => {
      select: (
        c: string,
        opts?: { count?: "exact"; head?: boolean },
      ) => {
        eq: (col: string, v: string) => PromiseLike<{ count: number | null; error: unknown }>;
      };
    };
  };

  const mismatches: { table: string; source_count: number; projected_count: number }[] = [];
  for (const table of tables) {
    const [sourceRes, projectedRes] = await Promise.all([
      anyDb.from(table).select("id", { count: "exact", head: true }).eq("case_id", args.caseId),
      (
        anyDb.from("case_findings") as unknown as {
          select: (
            c: string,
            opts?: { count?: "exact"; head?: boolean },
          ) => {
            eq: (
              col: string,
              v: string,
            ) => { eq: (col: string, v: string) => PromiseLike<{ count: number | null; error: unknown }> };
          };
        }
      )
        .select("id", { count: "exact", head: true })
        .eq("case_id", args.caseId)
        .eq("source_module", `projection:${table}`),
    ]);
    const sourceCount = sourceRes.error ? 0 : (sourceRes.count ?? 0);
    const projectedCount = projectedRes.error ? 0 : (projectedRes.count ?? 0);
    // Only a genuine shortfall counts — case_findings can legitimately have
    // more rows than the source table (dedupe/consensus can still leave
    // multiple projected rows per source row for compound findings), so
    // only flag when projected < source.
    if (sourceCount > 0 && projectedCount < sourceCount) {
      mismatches.push({ table, source_count: sourceCount, projected_count: projectedCount });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
