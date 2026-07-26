import { useState, useEffect } from "react";
import { useI18n } from "@/i18n";
import { Pager, ViewToggle, RowActions, useItemFlagActions, stableKey, type ItemFlags } from "./shared";

const QUALITY_KEY: Record<string, string> = {
  "Direct Contradiction": "reports.contradictions.quality.direct",
  "Partial Contradiction": "reports.contradictions.quality.partial",
  "Timeline Discrepancy": "reports.contradictions.quality.timeline",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ContradictionsBreakdown({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
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

  const defaultQuality = t("reports.contradictions.quality.direct");
  const qualityLabel = (q?: string) => (q && QUALITY_KEY[q] ? t(QUALITY_KEY[q]) : q || defaultQuality);

  const visibleForCounts = notDeleted.filter((c) => flags[c.__key] !== "archived");
  const counts = visibleForCounts.reduce<Record<string, number>>((acc, c) => {
    const k = qualityLabel(c.contradiction_quality);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {t("reports.contradictions.title", { count: notDeleted.length })}
        </p>
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
              <span className="font-medium">{c.title ?? t("reports.contradictions.untitled")}</span>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {qualityLabel(c.contradiction_quality)}
                </span>
                <RowActions
                  view={view}
                  pending={pendingKey === `${section}:${c.__key}`}
                  onArchive={() => apply(section, c.__key, view === "archived" ? "active" : "archived")}
                  onDelete={() => {
                    if (window.confirm(t("reports.confirm.removeContradiction")))
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
            {view === "archived" ? t("reports.contradictions.empty.archived") : t("reports.contradictions.empty.active")}
          </li>
        ) : null}
      </ul>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={list.length} />
    </div>
  );
}
