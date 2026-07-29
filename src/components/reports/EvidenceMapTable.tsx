// Evidence Map — real documents table with real archive/delete against the
// documents table (as opposed to the generated-analysis sections, which key
// off report.item_flags).
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { archiveCaseDocument, deleteCaseDocument } from "@/lib/cases.functions";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { Th, Pager, ViewToggle, RowActions, useSort, type DocumentRow } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EvidenceMapTable({
  fullReport,
  documents,
  caseId,
}: {
  fullReport: any;
  documents: DocumentRow[];
  caseId?: string | null;
}) {
  const { t } = useI18n();
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
  // The evidence map persists canonical snake_case taxonomy keys
  // (carpeta_de_investigacion, testimonial, acusacion…); they are translated
  // here so the table follows the report language instead of rendering raw
  // English labels. Unknown/legacy values fall through as-is.
  const tv = (prefix: string, value?: string | null) => {
    if (!value) return t("common.dash");
    const key = `reports.evidenceMap.${prefix}.${value}`;
    const label = t(key);
    return label === key ? value : label;
  };
  const allRows = (documents ?? []).map((d) => {
    const m = metricsByFile.get(d.filename);
    return {
      id: d.id,
      filename: d.filename,
      document_type: tv("docType", m?.document_type),
      litigation_role: tv("role", m?.litigation_role),
      party: tv("party", m?.party),
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
      toast.error(t("reports.toast.archiveFailed", { error: e instanceof Error ? e.message : t("reports.error.unknown") }));
    } finally {
      setPendingId(null);
    }
  };

  const doDelete = async (id: string, filename: string) => {
    if (!caseId) return;
    if (!window.confirm(t("reports.confirm.deleteDocument", { filename }))) return;
    setPendingId(id);
    try {
      await deleteFn({ data: { caseId, documentId: id } });
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success(t("reports.toast.deleted", { filename }));
    } catch (e) {
      toast.error(t("reports.toast.deleteFailed", { error: e instanceof Error ? e.message : t("reports.error.unknown") }));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{t("reports.evidenceMap.title")}</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <Th label={t("reports.evidenceMap.col.document")} active={key === "filename"} dir={dir} onClick={() => toggle("filename")} />
              <Th label={t("reports.evidenceMap.col.type")} active={key === "document_type"} dir={dir} onClick={() => toggle("document_type")} />
              <Th
                label={t("reports.evidenceMap.col.litigationRole")}
                active={key === "litigation_role"}
                dir={dir}
                onClick={() => toggle("litigation_role")}
              />
              <Th label={t("reports.evidenceMap.col.party")} active={key === "party"} dir={dir} onClick={() => toggle("party")} />
              <Th label={t("reports.evidenceMap.col.pages")} active={key === "page_count"} dir={dir} onClick={() => toggle("page_count")} />
              <Th label={t("reports.evidenceMap.col.findings")} active={key === "finding_count"} dir={dir} onClick={() => toggle("finding_count")} />
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("reports.col.actions")}
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
                  {view === "archived" ? t("reports.evidenceMap.empty.archived") : t("reports.evidenceMap.empty.active")}
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
