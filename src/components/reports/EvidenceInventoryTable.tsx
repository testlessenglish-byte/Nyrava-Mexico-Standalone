import { useState, useEffect } from "react";
import { useI18n } from "@/i18n";
import { Pager, ViewToggle, RowActions, StatusPill, useItemFlagActions, stableKey, type ItemFlags } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EvidenceInventoryTable({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
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
          {t("reports.evidenceInventory.title", { count: notDeleted.length })}
        </p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceInventory.col.item")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceInventory.col.sourceDocument")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceInventory.col.whatItShows")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceInventory.col.supportsTheory")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceInventory.col.weaknessOrGap")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceInventory.col.whatIsNeeded")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.col.status")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.col.actions")}</th>
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
                      if (window.confirm(t("reports.confirm.removeEvidenceItem", { item: r.item })))
                        apply(section, r.__key, "deleted");
                    }}
                  />
                </td>
              </tr>
            ))}
            {!pageItems.length ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? t("reports.evidenceInventory.empty.archived") : t("reports.evidenceInventory.empty.active")}
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
