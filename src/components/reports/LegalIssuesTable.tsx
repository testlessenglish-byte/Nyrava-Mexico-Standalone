import { useState, useEffect } from "react";
import { useI18n } from "@/i18n";
import { Pager, ViewToggle, RowActions, useItemFlagActions, stableKey, type ItemFlags } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function LegalIssuesTable({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
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
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {t("reports.legalIssues.title", { count: notDeleted.length })}
        </p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.legalIssues.col.issue")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.legalIssues.col.indicator")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.evidenceMap.col.document")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.legalIssues.col.passage")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.legalIssues.col.nextStep")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.legalIssues.col.caseLaw")}</th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.col.actions")}</th>
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
                    <span className="text-muted-foreground">{t("common.dash")}</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <RowActions
                    view={view}
                    pending={pendingKey === `${section}:${r.__key}`}
                    onArchive={() => apply(section, r.__key, view === "archived" ? "active" : "archived")}
                    onDelete={() => {
                      if (window.confirm(t("reports.confirm.removeLegalIssue")))
                        apply(section, r.__key, "deleted");
                    }}
                  />
                </td>
              </tr>
            ))}
            {!pageIssues.length ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? t("reports.legalIssues.empty.archived") : t("reports.legalIssues.empty.active")}
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
