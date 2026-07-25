import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, type ReactNode } from "react";
import { FileText, FileDown, FileJson, FileType, ExternalLink } from "lucide-react";
import { getCase, archiveCaseDocument, deleteCaseDocument, setReportItemFlag } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, ModuleEmpty, SuppressedNotice } from "@/components/modules/SuppressedNotice";
import { isDeterministicFallback } from "@/lib/intelligence/canonical";
import { downloadJson, downloadPdf, downloadDocx, type CaseExportData } from "@/lib/export";
import { toast } from "sonner";
import { LegalMemorandumPanel, type LegalMemorandum } from "@/components/LegalMemorandumPanel";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Nyrava" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { cases, activeId, isLoading } = useActiveCase();
  const [selected, setSelected] = useState<string | null>(null);
  const caseId = selected ?? activeId;
  const fetchCase = useServerFn(getCase);
  const { data, isLoading: caseLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId: caseId! } }),
    enabled: !!caseId,
  });

  const report = data?.report as any;
  const name = (data?.case as any)?.name ?? "case";
  const scoresSuppressed = report?.scores_suppressed === true;
  const motionsSuppressed = report?.motions_suppressed === true;
  const detFallback = isDeterministicFallback(report);
  const engines = (report?.engines_summary ?? {}) as Record<string, any>;
  const reportMode: "FULL" | "LIMITED" | null =
    report?.report_mode === "FULL" || report?.report_mode === "LIMITED" ? report.report_mode : null;
  const modeLabel = reportMode === "FULL" ? "Full Case Analysis" : reportMode === "LIMITED" ? "Limited Analysis" : null;

  const run = (fn: () => void, label: string) => {
    try {
      fn();
    } catch (e) {
      toast.error(`${label} failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<FileText className="h-5 w-5" />}
        title="Reports"
        subtitle="Generate and download evidence-grounded reports in PDF, DOCX, or JSON."
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          Loading cases…
        </div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
                Loading report…
              </div>
            ) : !report ? (
              <ModuleEmpty title="No report generated yet" hint="Open this case and run the Report stage." />
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{name}</h2>
                        {modeLabel ? (
                          <span
                            className={
                              reportMode === "FULL"
                                ? "rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                                : "rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                            }
                          >
                            {modeLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Generated {new Date(report.updated_at ?? report.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: caseId }}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open workspace <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  {Object.keys(engines).length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(engines).map(([k, v]: [string, any]) => (
                        <span
                          key={k}
                          className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {k}: {v?.status ?? "—"}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {detFallback ? (
                  <SuppressedNotice title="Limited analysis — narrative pass unavailable. Findings are evidence-grounded but incomplete; attorney review required." />
                ) : null}
                {scoresSuppressed ? <SuppressedNotice title="Quantitative scores suppressed" /> : null}
                {motionsSuppressed ? <SuppressedNotice title="Motion recommendations suppressed" /> : null}

                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    onClick={() => run(() => downloadPdf(data as CaseExportData, name), "PDF")}
                    className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 hover:bg-card/80"
                  >
                    <FileDown className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Download PDF</span>
                  </button>
                  <button
                    onClick={() => run(() => downloadDocx(data as CaseExportData, name), "DOCX")}
                    className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 hover:bg-card/80"
                  >
                    <FileType className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Download DOCX</span>
                  </button>
                  <button
                    onClick={() => run(() => downloadJson(data as CaseExportData, name), "JSON")}
                    className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 hover:bg-card/80"
                  >
                    <FileJson className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Download JSON</span>
                  </button>
                </div>

                {(() => {
                  const fs = (report?.full_report as any)?.findings_summary as
                    | {
                        total_generated?: number;
                        displayed?: number;
                        suppressed?: number;
                        duplicates_merged?: number;
                        suppression_reasons?: Record<string, number>;
                      }
                    | undefined;
                  if (!fs) return null;
                  const reasons = fs.suppression_reasons ?? {};
                  const labels: Record<string, string> = {
                    duplicate: "Duplicate",
                    tautology_or_trivial: "Trivial / tautology",
                    no_supporting_evidence_in_corpus: "No citation in corpus",
                    violation_claim_without_proof: "Violation without proof",
                    criminal_terminology_in_civil_case: "Criminal terms in civil case",
                    missing_citation_for_strict_claim: "Missing citation (strict)",
                  };
                  const rows = Object.entries(reasons).filter(([, v]) => (v ?? 0) > 0);
                  return (
                    <div className="rounded-xl border border-border bg-card/60 p-4">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Findings summary</p>
                      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                        <div>
                          <div className="text-2xl font-semibold">{fs.total_generated ?? 0}</div>
                          <div className="text-xs text-muted-foreground">Total generated</div>
                        </div>
                        <div>
                          <div className="text-2xl font-semibold text-primary">{fs.displayed ?? 0}</div>
                          <div className="text-xs text-muted-foreground">Verified &amp; displayed</div>
                        </div>
                        <div>
                          <div className="text-2xl font-semibold">{fs.suppressed ?? 0}</div>
                          <div className="text-xs text-muted-foreground">Suppressed</div>
                        </div>
                      </div>
                      {rows.length > 0 ? (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-xs font-medium text-muted-foreground">Suppression breakdown</p>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {rows.map(([k, v]) => (
                              <li key={k} className="flex justify-between">
                                <span>{labels[k] ?? k}</span>
                                <span className="tabular-nums text-muted-foreground">{v}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {report.executive_summary ? (
                  <div className="rounded-xl border border-border bg-card/60 p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Executive summary</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{report.executive_summary}</p>
                  </div>
                ) : null}

                <LegalMemorandumPanel
                  memo={
                    (report?.full_report as { legal_memorandum?: LegalMemorandum } | null)?.legal_memorandum ?? null
                  }
                  caseName={name}
                />

                <EvidenceMapTable
                  fullReport={report?.full_report}
                  documents={(data?.documents ?? []) as DocumentRow[]}
                  caseId={caseId}
                />
                <AgentStatsTable fullReport={report?.full_report} caseId={caseId} itemFlags={report?.item_flags} />
                <WitnessProfiles fullReport={report?.full_report} caseId={caseId} itemFlags={report?.item_flags} />
                <LegalIssuesTable fullReport={report?.full_report} caseId={caseId} itemFlags={report?.item_flags} />
                <ContradictionsBreakdown
                  fullReport={report?.full_report}
                  caseId={caseId}
                  itemFlags={report?.item_flags}
                />
                <EvidenceInventoryTable
                  fullReport={report?.full_report}
                  caseId={caseId}
                  itemFlags={report?.item_flags}
                />
                <OpportunityReviewSection
                  fullReport={report?.full_report}
                  caseId={caseId}
                  itemFlags={report?.item_flags}
                />
                <AttorneyWorkProduct fullReport={report?.full_report} caseId={caseId} itemFlags={report?.item_flags} />
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------- Task 5: Evidence Map sortable table ----------
type SortDir = "asc" | "desc";
function useSort<T>(rows: T[], initial: keyof T) {
  const [key, setKey] = useState<keyof T>(initial);
  const [dir, setDir] = useState<SortDir>("asc");
  const sorted = [...rows].sort((a, b) => {
    const av = a[key] as unknown as string | number;
    const bv = b[key] as unknown as string | number;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
  const toggle = (k: keyof T) => {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setKey(k);
      setDir("asc");
    }
  };
  return { rows: sorted, key, dir, toggle };
}

function Th({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th
      onClick={onClick}
      className="cursor-pointer border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
    >
      {label}
      {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

// ---------- Shared archive/delete infrastructure ----------
// Real DB row for Evidence Map (documents table has real ids + archived_at).
type DocumentRow = { id: string; filename: string; archived_at: string | null };

// The other report tables (Evidence Inventory, Legal Issues, Contradictions,
// Agent Stats, Witness Profiles) are generated analysis text inside
// report.full_report — there is no row of their own to key off. itemFlags
// comes straight from reports.item_flags (server-persisted, shared by every
// user viewing the case) and is keyed by a stable hash of each item's
// identifying fields, computed the same way on every render.
type ItemFlags = Record<string, Record<string, "archived" | "deleted">> | null | undefined;

function stableKey(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => String(p ?? "")).join("||");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// Cross-examination outlines are generated per witness mention, so the same
// person can show up multiple times under slightly different strings
// ("Detective Raymond Ortiz", "Detective Ortiz", "Detective Ortiz's"). Group
// those under one card instead of rendering near-duplicate blocks: strip a
// trailing possessive, collapse whitespace, and compare case-insensitively.
function normalizeWitnessKey(name: string): string {
  return name
    .trim()
    .replace(/['’]s$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function dedupeCrossExams(
  list: Array<{ witness: string; topics: string[] }>,
): Array<{ witness: string; topics: string[] }> {
  const groups = new Map<string, { witness: string; topics: string[] }>();
  for (const c of list) {
    const key = normalizeWitnessKey(c.witness);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { witness: c.witness, topics: [...c.topics] });
      continue;
    }
    // Prefer the fuller name (e.g. "Detective Raymond Ortiz" over "Detective Ortiz's") for display.
    if (c.witness.length > existing.witness.length) existing.witness = c.witness;
    for (const t of c.topics) {
      if (!existing.topics.includes(t)) existing.topics.push(t);
    }
  }
  return Array.from(groups.values());
}

// Mutation helper for the generic item_flags sections. Calls the server,
// then invalidates the case query so `report.item_flags` (and therefore
// every table reading it) refreshes from the source of truth.
function useItemFlagActions(caseId: string | null | undefined) {
  const setFlag = useServerFn(setReportItemFlag);
  const queryClient = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const apply = async (
    section:
      | "evidence_inventory"
      | "legal_issues"
      | "contradictions"
      | "agent_statistics"
      | "witness_profiles"
      | "case_opportunities"
      | "attorney_work_product",
    itemKey: string,
    flag: "active" | "archived" | "deleted",
  ) => {
    if (!caseId) return;
    const pk = `${section}:${itemKey}`;
    setPendingKey(pk);
    try {
      await setFlag({ data: { caseId, section, itemKey, flag } });
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
    } catch (e) {
      toast.error(`Update failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setPendingKey(null);
    }
  };

  return { apply, pendingKey };
}

function ViewToggle({
  view,
  onChange,
  activeCount,
  archivedCount,
}: {
  view: "active" | "archived";
  onChange: (v: "active" | "archived") => void;
  activeCount: number;
  archivedCount: number;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 p-0.5 text-xs">
      <button
        onClick={() => onChange("active")}
        className={`rounded-md px-2 py-1 ${view === "active" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        Active ({activeCount})
      </button>
      <button
        onClick={() => onChange("archived")}
        className={`rounded-md px-2 py-1 ${view === "archived" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        Archived ({archivedCount})
      </button>
    </div>
  );
}

function RowActions({
  view,
  pending,
  onArchive,
  onDelete,
}: {
  view: "active" | "archived";
  pending: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={onArchive}
        className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-background/60 disabled:opacity-40"
      >
        {view === "archived" ? "Unarchive" : "Archive"}
      </button>
      <button
        disabled={pending}
        onClick={onDelete}
        className="rounded border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  );
}

function Pager({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
}: {
  page: number;
  setPage: (n: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  total: number;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded border border-border bg-background/60 px-1.5 py-1 text-xs"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span>
          {start + 1}–{Math.min(start + pageSize, total)} of {total}
        </span>
        <button
          onClick={() => setPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------- Shared list variant of the archive/delete + pagination pattern ----------
// Used by sections (Case Opportunities, Attorney Work Product) that render several
// independent sub-lists rather than one table. Each sub-list gets its own
// Active/Archived toggle and its own pager, but all persist through the same
// report.item_flags[section] map — callers must give each item a __key that's
// unique within that section (prefix by sub-list name if needed).
function ArchivableList<T extends { __key: string }>({
  title,
  items,
  section,
  caseId,
  flags,
  renderItem,
  emptyText,
  pageSize: initialPageSize = 10,
}: {
  title: string;
  items: T[];
  section: "case_opportunities" | "attorney_work_product";
  caseId?: string | null;
  flags: Record<string, "archived" | "deleted">;
  renderItem: (item: T) => ReactNode;
  emptyText: string;
  pageSize?: number;
}) {
  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const notDeleted = items.filter((i) => flags[i.__key] !== "deleted");
  const viewItems = notDeleted.filter((i) =>
    view === "archived" ? flags[i.__key] === "archived" : flags[i.__key] !== "archived",
  );
  const archivedCount = notDeleted.filter((i) => flags[i.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, items.length]);

  if (!items.length) return null;

  const totalPages = Math.max(1, Math.ceil(viewItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = viewItems.slice(start, start + pageSize);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          {title} ({notDeleted.length})
        </p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <ul className="mt-1 space-y-2">
        {pageItems.map((item) => (
          <li key={item.__key} className="rounded border border-border bg-background/40 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">{renderItem(item)}</div>
              <RowActions
                view={view}
                pending={pendingKey === `${section}:${item.__key}`}
                onArchive={() => apply(section, item.__key, view === "archived" ? "active" : "archived")}
                onDelete={() => {
                  if (window.confirm("Remove this item from the report view?")) apply(section, item.__key, "deleted");
                }}
              />
            </div>
          </li>
        ))}
        {!pageItems.length ? (
          <li className="list-none text-xs text-muted-foreground">
            {view === "archived" ? "No archived items." : emptyText}
          </li>
        ) : null}
      </ul>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={viewItems.length} />
    </div>
  );
}

// ---------- Task 5: Evidence Map — real documents table, real archive/delete ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EvidenceMapTable({
  fullReport,
  documents,
  caseId,
}: {
  fullReport: any;
  documents: DocumentRow[];
  caseId?: string | null;
}) {
  const em = fullReport?.evidence_map_detail;
  const metricsByFile = new Map(
    (
      (em?.documents ?? []) as Array<{
        filename: string;
        document_type: string;
        litigation_role: string;
        party: string;
        page_count: number;
        finding_count: number;
        contradiction_count: number;
      }>
    ).map((d) => [d.filename, d]),
  );

  // documents (real DB rows, with id + archived_at) is the source of truth
  // for which rows exist and their archive state; evidence_map_detail (report
  // JSON) only supplies the descriptive metrics, joined in by filename.
  const allRows = (documents ?? []).map((d) => {
    const m = metricsByFile.get(d.filename);
    return {
      id: d.id,
      filename: d.filename,
      document_type: m?.document_type ?? "—",
      litigation_role: m?.litigation_role ?? "—",
      party: m?.party ?? "—",
      page_count: m?.page_count ?? 0,
      finding_count: m?.finding_count ?? 0,
      archived: !!d.archived_at,
    };
  });

  const archiveFn = useServerFn(archiveCaseDocument);
  const deleteFn = useServerFn(deleteCaseDocument);
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = allRows.filter((r) => (view === "archived" ? r.archived : !r.archived));
  const { rows, key, dir, toggle } = useSort(filtered, "filename" as keyof (typeof filtered)[number]);

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, allRows.length]);

  if (!allRows.length) return null;

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const archivedCount = allRows.filter((r) => r.archived).length;
  const activeCount = allRows.length - archivedCount;

  const doArchive = async (id: string, archived: boolean) => {
    if (!caseId) return;
    setPendingId(id);
    try {
      await archiveFn({ data: { caseId, documentId: id, archived } });
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
    } catch (e) {
      toast.error(`Archive failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setPendingId(null);
    }
  };

  const doDelete = async (id: string, filename: string) => {
    if (!caseId) return;
    if (!window.confirm(`Permanently delete "${filename}"? This removes the file from the case and cannot be undone.`))
      return;
    setPendingId(id);
    try {
      await deleteFn({ data: { caseId, documentId: id } });
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success(`Deleted ${filename}`);
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Evidence map</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <Th label="Document" active={key === "filename"} dir={dir} onClick={() => toggle("filename")} />
              <Th label="Type" active={key === "document_type"} dir={dir} onClick={() => toggle("document_type")} />
              <Th
                label="Litigation Role"
                active={key === "litigation_role"}
                dir={dir}
                onClick={() => toggle("litigation_role")}
              />
              <Th label="Party" active={key === "party"} dir={dir} onClick={() => toggle("party")} />
              <Th label="Pages" active={key === "page_count"} dir={dir} onClick={() => toggle("page_count")} />
              <Th label="Findings" active={key === "finding_count"} dir={dir} onClick={() => toggle("finding_count")} />
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="px-2 py-1">{r.filename}</td>
                <td className="px-2 py-1">{r.document_type}</td>
                <td className="px-2 py-1">{r.litigation_role}</td>
                <td className="px-2 py-1">{r.party}</td>
                <td className="px-2 py-1 tabular-nums">{r.page_count}</td>
                <td className="px-2 py-1 tabular-nums">{r.finding_count}</td>
                <td className="px-2 py-1">
                  <RowActions
                    view={view}
                    pending={pendingId === r.id}
                    onArchive={() => doArchive(r.id, view !== "archived")}
                    onDelete={() => doDelete(r.id, r.filename)}
                  />
                </td>
              </tr>
            ))}
            {!pageRows.length ? (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? "No archived documents." : "No documents."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={rows.length} />
    </div>
  );
}

// ---------- Task 6: Agent statistics table ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentStatsTable({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "agent_statistics" as const;
  const stats = fullReport?.agent_statistics;
  const allRows = (stats?.rows ?? []) as Array<{
    agent_name: string;
    primary_function: string;
    status: string;
    findings_generated: number;
    visible_findings: number;
    findings_suppressed: number;
    suppression_rate: number;
  }>;
  const flags = itemFlags?.[section] ?? {};
  const withKeys = allRows.map((r) => ({ ...r, __key: stableKey([r.agent_name]) }));
  const notDeleted = withKeys.filter((r) => flags[r.__key] !== "deleted");

  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const rows = notDeleted.filter((r) =>
    view === "archived" ? flags[r.__key] === "archived" : flags[r.__key] !== "archived",
  );

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, allRows.length]);

  if (!allRows.length) return null;

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const archivedCount = notDeleted.filter((r) => flags[r.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  const visibleForSummary = notDeleted.filter((r) => flags[r.__key] !== "archived");
  const total = visibleForSummary.length;
  const withGen = visibleForSummary.filter((r) => r.findings_generated > 0).length;
  const withVis = visibleForSummary.filter((r) => r.visible_findings > 0).length;
  const allSupp = visibleForSummary.filter((r) => r.findings_generated > 0 && r.visible_findings === 0).length;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Agent statistics</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Agent
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Primary Function
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Status
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                Generated
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                Verified
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                Suppressed
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                Suppr. Rate
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.__key} className="border-b border-border/60">
                <td className="px-2 py-1 font-medium">{r.agent_name}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.primary_function}</td>
                <td className="px-2 py-1">{r.status}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.findings_generated}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.visible_findings}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.findings_suppressed}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.suppression_rate}%</td>
                <td className="px-2 py-1">
                  <RowActions
                    view={view}
                    pending={pendingKey === `${section}:${r.__key}`}
                    onArchive={() => apply(section, r.__key, view === "archived" ? "active" : "archived")}
                    onDelete={() => {
                      if (window.confirm(`Remove "${r.agent_name}" from this report view?`))
                        apply(section, r.__key, "deleted");
                    }}
                  />
                </td>
              </tr>
            ))}
            {!pageRows.length ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? "No archived agents." : "No agents."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={rows.length} />
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4 border-t border-border pt-3">
        <div>
          <div className="text-lg font-semibold">{total}</div>
          <div className="text-muted-foreground">Agents executed</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{withGen}</div>
          <div className="text-muted-foreground">With generated findings</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-primary">{withVis}</div>
          <div className="text-muted-foreground">With visible findings</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{allSupp}</div>
          <div className="text-muted-foreground">All findings suppressed</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Task 7: Witness profiles ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WitnessProfiles({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "witness_profiles" as const;
  const allProfiles = (fullReport?.witness_profiles ?? []) as Array<{
    name: string;
    role: string;
    key_statements: string[];
    credibility_supports: string[];
    credibility_risks: string[];
    bias_indicators: string[];
    impeachment_opportunities: string[];
    direct_questions: string[];
    cross_questions: string[];
  }>;
  const flags = itemFlags?.[section] ?? {};
  const withKeys = allProfiles.map((w) => ({ ...w, __key: stableKey([w.name, w.role]) }));
  const notDeleted = withKeys.filter((w) => flags[w.__key] !== "deleted");

  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const profiles = notDeleted.filter((w) =>
    view === "archived" ? flags[w.__key] === "archived" : flags[w.__key] !== "archived",
  );

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, allProfiles.length]);

  if (!allProfiles.length) return null;

  const totalPages = Math.max(1, Math.ceil(profiles.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageProfiles = profiles.slice(start, start + pageSize);
  const archivedCount = notDeleted.filter((w) => flags[w.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Witness profiles ({notDeleted.length})</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 space-y-3">
        {pageProfiles.map((w) => (
          <details key={w.__key} className="rounded-lg border border-border bg-background/40 p-3">
            <summary className="flex flex-wrap items-center justify-between gap-2 cursor-pointer text-sm font-medium">
              <span>
                {w.name}{" "}
                <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {w.role}
                </span>
              </span>
              <span onClick={(e) => e.preventDefault()}>
                <RowActions
                  view={view}
                  pending={pendingKey === `${section}:${w.__key}`}
                  onArchive={() => apply(section, w.__key, view === "archived" ? "active" : "archived")}
                  onDelete={() => {
                    if (window.confirm(`Remove "${w.name}" from this report view?`)) apply(section, w.__key, "deleted");
                  }}
                />
              </span>
            </summary>
            <div className="mt-2 space-y-2 text-xs">
              {w.key_statements.length ? <Section title="Key statements" items={w.key_statements} /> : null}
              {w.credibility_supports.length ? (
                <Section title="Supports reliability" items={w.credibility_supports} />
              ) : null}
              {w.credibility_risks.length ? <Section title="Risks to credibility" items={w.credibility_risks} /> : null}
              {w.bias_indicators.length ? <Section title="Bias indicators" items={w.bias_indicators} /> : null}
              {w.impeachment_opportunities.length ? (
                <Section title="Impeachment opportunities" items={w.impeachment_opportunities} />
              ) : null}
              <Section title="Suggested direct examination" items={w.direct_questions} />
              <Section title="Suggested cross examination" items={w.cross_questions} />
            </div>
          </details>
        ))}
        {!pageProfiles.length ? (
          <p className="text-xs text-muted-foreground">
            {view === "archived" ? "No archived witnesses." : "No witnesses."}
          </p>
        ) : null}
      </div>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={profiles.length} />
    </div>
  );
}

// ---------- Task 8: Legal issues ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LegalIssuesTable({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "legal_issues" as const;
  const allIssues = (fullReport?.legal_issues ?? []) as Array<{
    issue: string;
    indicator: string;
    document: string;
    quote: string;
    significance: string;
    next_step: string;
    case_law?: Array<{
      case_name: string;
      citation: string | null;
      court: string | null;
      date_filed: string | null;
      url: string;
      snippet: string;
    }>;
  }>;
  const flags = itemFlags?.[section] ?? {};
  const withKeys = allIssues.map((r) => ({ ...r, __key: stableKey([r.issue, r.document, r.quote]) }));
  const notDeleted = withKeys.filter((r) => flags[r.__key] !== "deleted");

  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const issues = notDeleted.filter((r) =>
    view === "archived" ? flags[r.__key] === "archived" : flags[r.__key] !== "archived",
  );

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, allIssues.length]);

  if (!allIssues.length) return null;

  const totalPages = Math.max(1, Math.ceil(issues.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageIssues = issues.slice(start, start + pageSize);
  const archivedCount = notDeleted.filter((r) => flags[r.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Legal issues ({notDeleted.length})</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Issue
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Indicator
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Document
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Passage
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Next step
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Case law
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageIssues.map((r) => (
              <tr key={r.__key} className="border-b border-border/60 align-top">
                <td className="px-2 py-1 font-medium">{r.issue}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.indicator}</td>
                <td className="px-2 py-1">{r.document}</td>
                <td className="px-2 py-1">
                  <em className="text-muted-foreground">"{r.quote}"</em>
                  <div className="mt-1 text-[11px] text-muted-foreground">{r.significance}</div>
                </td>
                <td className="px-2 py-1">{r.next_step}</td>
                <td className="px-2 py-1">
                  {r.case_law && r.case_law.length > 0 ? (
                    <ul className="space-y-1">
                      {r.case_law.map((c, i) => (
                        <li key={i}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            {c.case_name}
                          </a>
                          {c.citation ? <span className="text-muted-foreground"> — {c.citation}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <RowActions
                    view={view}
                    pending={pendingKey === `${section}:${r.__key}`}
                    onArchive={() => apply(section, r.__key, view === "archived" ? "active" : "archived")}
                    onDelete={() => {
                      if (window.confirm(`Remove this legal issue from the report view?`))
                        apply(section, r.__key, "deleted");
                    }}
                  />
                </td>
              </tr>
            ))}
            {!pageIssues.length ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? "No archived issues." : "No legal issues."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={issues.length} />
    </div>
  );
}

// ---------- Task 4: Contradictions with quality breakdown ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ContradictionsBreakdown({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "contradictions" as const;
  const allList = (fullReport?.contradictions ?? []) as Array<{
    title?: string;
    description?: string;
    contradiction_quality?: string;
  }>;
  const flags = itemFlags?.[section] ?? {};
  const withKeys = allList.map((c) => ({ ...c, __key: stableKey([c.title, c.description]) }));
  const notDeleted = withKeys.filter((c) => flags[c.__key] !== "deleted");

  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const list = notDeleted.filter((c) =>
    view === "archived" ? flags[c.__key] === "archived" : flags[c.__key] !== "archived",
  );

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, allList.length]);

  if (!allList.length) return null;

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);
  const archivedCount = notDeleted.filter((c) => flags[c.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  const visibleForCounts = notDeleted.filter((c) => flags[c.__key] !== "archived");
  const counts = visibleForCounts.reduce<Record<string, number>>((acc, c) => {
    const k = c.contradiction_quality ?? "Direct Contradiction";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Contradictions ({notDeleted.length})</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="rounded-full border border-border bg-background/60 px-2 py-0.5">
            {k}: <span className="tabular-nums font-medium">{v}</span>
          </span>
        ))}
      </div>
      <ul className="mt-3 space-y-2 text-xs">
        {pageList.map((c) => (
          <li key={c.__key} className="rounded border border-border bg-background/40 p-2">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{c.title ?? "Contradiction"}</span>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {c.contradiction_quality ?? "Direct Contradiction"}
                </span>
                <RowActions
                  view={view}
                  pending={pendingKey === `${section}:${c.__key}`}
                  onArchive={() => apply(section, c.__key, view === "archived" ? "active" : "archived")}
                  onDelete={() => {
                    if (window.confirm(`Remove this contradiction from the report view?`))
                      apply(section, c.__key, "deleted");
                  }}
                />
              </div>
            </div>
            {c.description ? <p className="mt-1 text-muted-foreground">{c.description}</p> : null}
          </li>
        ))}
        {!pageList.length ? (
          <li className="text-center text-muted-foreground">
            {view === "archived" ? "No archived contradictions." : "No contradictions."}
          </li>
        ) : null}
      </ul>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={list.length} />
    </div>
  );
}

// ---------- Task 9: Evidence Inventory ----------
function StatusPill({ s }: { s: "complete" | "partial" | "missing" }) {
  const cfg =
    s === "complete"
      ? { icon: "✅", label: "Complete", cls: "border-primary/40 bg-primary/10 text-primary" }
      : s === "partial"
        ? { icon: "⚠️", label: "Partial", cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-600" }
        : { icon: "❌", label: "Missing", cls: "border-destructive/40 bg-destructive/10 text-destructive" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EvidenceInventoryTable({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "evidence_inventory" as const;
  const allItems = (fullReport?.evidence_inventory ?? []) as Array<{
    item: string;
    source_document: string;
    what_it_shows: string;
    supports_theory: string;
    weakness_or_gap: string;
    what_is_needed: string;
    status: "complete" | "partial" | "missing";
    status_note: string;
  }>;
  const flags = itemFlags?.[section] ?? {};
  const withKeys = allItems.map((r) => ({ ...r, __key: stableKey([r.item, r.source_document]) }));
  const notDeleted = withKeys.filter((r) => flags[r.__key] !== "deleted");

  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const items = notDeleted.filter((r) =>
    view === "archived" ? flags[r.__key] === "archived" : flags[r.__key] !== "archived",
  );

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, allItems.length]);

  if (!allItems.length) return null;

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const archivedCount = notDeleted.filter((r) => flags[r.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Evidence inventory ({notDeleted.length})
        </p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Evidence Item
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Source Document
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                What It Shows
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Supports Theory
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Weakness / Gap
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                What Is Needed
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Status
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r) => (
              <tr key={r.__key} className="border-b border-border/60 align-top">
                <td className="px-2 py-1 font-medium">{r.item}</td>
                <td className="px-2 py-1">{r.source_document}</td>
                <td className="px-2 py-1">{r.what_it_shows}</td>
                <td className="px-2 py-1">{r.supports_theory}</td>
                <td className="px-2 py-1">{r.weakness_or_gap}</td>
                <td className="px-2 py-1">{r.what_is_needed}</td>
                <td className="px-2 py-1">
                  <StatusPill s={r.status} />
                  <div className="mt-1 text-[10px] text-muted-foreground">{r.status_note}</div>
                </td>
                <td className="px-2 py-1">
                  <RowActions
                    view={view}
                    pending={pendingKey === `${section}:${r.__key}`}
                    onArchive={() => apply(section, r.__key, view === "archived" ? "active" : "archived")}
                    onDelete={() => {
                      if (window.confirm(`Remove "${r.item}" from the report view?`))
                        apply(section, r.__key, "deleted");
                    }}
                  />
                </td>
              </tr>
            ))}
            {!pageItems.length ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? "No archived items." : "No evidence items."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={items.length} />
    </div>
  );
}

// ---------- Task 10: Attorney Work Product ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OpportunityReviewSection({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "case_opportunities" as const;
  const flags = itemFlags?.[section] ?? {};
  const allOpportunities = (fullReport?.intelligence?.opportunities ?? []) as Array<{
    title?: string;
    description?: string;
    opportunity_type?: string;
    finding_type?: string | null;
    counter_response?: string | null;
    confidence?: number | null;
    citations?: Array<{ quote?: string; document_id?: string | null; page?: number | null }> | null;
  }>;
  if (!allOpportunities.length) return null;

  const verified = allOpportunities
    .filter(
      (o) =>
        o.finding_type !== "AI_THEORY" && !String(o.opportunity_type ?? "").startsWith("requires_attorney_review:"),
    )
    .map((o) => ({ ...o, __key: `verified:${stableKey([o.title, o.description])}` }));
  const potential = allOpportunities
    .filter(
      (o) => o.finding_type === "AI_THEORY" || String(o.opportunity_type ?? "").startsWith("requires_attorney_review:"),
    )
    .map((o) => ({ ...o, __key: `potential:${stableKey([o.title, o.description])}` }));

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Case opportunities</p>
      <div className="mt-3 space-y-5">
        {verified.length ? (
          <ArchivableList
            title="Verified opportunities"
            items={verified}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText="No verified opportunities."
            renderItem={(o) => (
              <>
                <div className="font-medium text-sm">{o.title}</div>
                <div className="text-xs text-muted-foreground">{o.description}</div>
                {(o.citations ?? []).slice(0, 1).map((c, j) => (
                  <div key={j} className="mt-1 text-[10px] text-muted-foreground">
                    Quote: “{c.quote}”{c.page ? ` · p.${c.page}` : ""}
                  </div>
                ))}
              </>
            )}
          />
        ) : null}
        {potential.length ? (
          <ArchivableList
            title="Potential opportunities requiring attorney review"
            items={potential}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText="No potential opportunities."
            renderItem={(o) => (
              <>
                <div className="font-medium text-sm">{o.title}</div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">{o.description}</div>
                {o.counter_response ? (
                  <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">{o.counter_response}</div>
                ) : null}
              </>
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AttorneyWorkProduct({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const section = "attorney_work_product" as const;
  const flags = itemFlags?.[section] ?? {};
  const wp = fullReport?.attorney_work_product as
    | {
        case_strategy?: string;
        strengths?: Array<{ text: string; citation: string }>;
        weaknesses?: Array<{ text: string; citation: string }>;
        motion_opportunities?: Array<{ motion: string; basis: string; source_document: string }>;
        trial_themes?: string[];
        cross_examination_outlines?: Array<{ witness: string; topics: string[] }>;
        jury_themes?: string[];
      }
    | undefined;
  if (!wp) return null;

  const strengths = (wp.strengths ?? []).map((s) => ({ ...s, __key: `strength:${stableKey([s.text, s.citation])}` }));
  const weaknesses = (wp.weaknesses ?? []).map((s) => ({ ...s, __key: `weakness:${stableKey([s.text, s.citation])}` }));
  const motions = (wp.motion_opportunities ?? []).map((m) => ({
    ...m,
    __key: `motion:${stableKey([m.motion, m.basis, m.source_document])}`,
  }));
  const crossExams = dedupeCrossExams(wp.cross_examination_outlines ?? []).map((c) => ({
    ...c,
    __key: `xexam:${stableKey([c.witness, ...c.topics])}`,
  }));

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Attorney work product</p>
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Case strategy</p>
          <p className="mt-1 text-sm">{wp.case_strategy}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ArchivableList
            title="Strengths"
            items={strengths}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText="No defense-favorable findings yet."
            renderItem={(s) => (
              <div className="text-xs">
                {s.text} <span className="text-muted-foreground">{s.citation}</span>
              </div>
            )}
          />
          <ArchivableList
            title="Weaknesses"
            items={weaknesses}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText="No prosecution-favorable findings yet."
            renderItem={(s) => (
              <div className="text-xs">
                {s.text} <span className="text-muted-foreground">{s.citation}</span>
              </div>
            )}
          />
        </div>
        <ArchivableList
          title="Motion opportunities"
          items={motions}
          section={section}
          caseId={caseId}
          flags={flags}
          emptyText="No motions surfaced from Legal Issues."
          renderItem={(m) => (
            <>
              <div className="font-medium text-xs">{m.motion}</div>
              <div className="text-xs text-muted-foreground">{m.basis}</div>
              <div className="text-[10px] text-muted-foreground">Source: {m.source_document}</div>
            </>
          )}
        />
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Trial themes</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {(wp.trial_themes ?? []).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
        <ArchivableList
          title="Cross-examination outlines"
          items={crossExams}
          section={section}
          caseId={caseId}
          flags={flags}
          emptyText="No witnesses with impeachment material identified."
          renderItem={(c) => (
            <>
              <div className="font-medium text-xs">{c.witness}</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {c.topics.map((t, j) => (
                  <li key={j}>{t}</li>
                ))}
              </ul>
            </>
          )}
        />
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Jury themes (voir dire / opening)</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {(wp.jury_themes ?? []).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
