// Agent statistics — internal pipeline names are mapped to the same
// human-readable, localized agent labels used on the Dashboard's pipeline
// grid (agent.*.name), never surfaced as raw agent keys/IDs.
import { useState, useEffect } from "react";
import { useI18n } from "@/i18n";
import { Pager, ViewToggle, RowActions, useItemFlagActions, stableKey, type ItemFlags } from "./shared";

// Exact-match on the agent definition's display name (src/lib/agents/types.ts)
// to the localized agent.*.name key used everywhere else in the app.
const AGENT_NAME_TO_KEY: Record<string, string> = {
  "Intake & File Manager": "agent.intake.name",
  "OCR & Document Extraction": "agent.ocr.name",
  "Entity Extraction": "agent.entities.name",
  "Timeline Reconstruction": "agent.timeline.name",
  "Evidence Analysis": "agent.evidence.name",
  "Contradiction Detection": "agent.contradictions.name",
  "Legal Research": "agent.legal.name",
  "Risk Assessment": "agent.risk.name",
  "Report Writer": "agent.report.name",
  "Quality Assurance": "agent.qa.name",
  "Judge Agent": "agent.judge.name",
  "Hallucination Detection": "agent.hallucination.name",
  "Master Orchestrator": "agent.orchestrator.name",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AgentStatsTable({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
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
  const withKeys = allRows.map((r) => ({
    ...r,
    displayName: AGENT_NAME_TO_KEY[r.agent_name] ? t(AGENT_NAME_TO_KEY[r.agent_name]) : r.agent_name,
    __key: stableKey([r.agent_name]),
  }));
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
        <p className="text-xs font-semibold uppercase text-muted-foreground">{t("reports.agentStats.title")}</p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.agentStats.col.agent")}
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.agentStats.col.primaryFunction")}
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.col.status")}
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.agentStats.col.generated")}
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.agentStats.col.verified")}
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.agentStats.col.suppressed")}
              </th>
              <th className="border-b border-border px-2 py-1 text-right text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.agentStats.col.suppressionRate")}
              </th>
              <th className="border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                {t("reports.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.__key} className="border-b border-border/60">
                <td className="px-2 py-1 font-medium">{r.displayName}</td>
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
                      if (window.confirm(t("reports.confirm.removeAgent", { name: r.displayName })))
                        apply(section, r.__key, "deleted");
                    }}
                  />
                </td>
              </tr>
            ))}
            {!pageRows.length ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">
                  {view === "archived" ? t("reports.agentStats.empty.archived") : t("reports.agentStats.empty.active")}
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
          <div className="text-muted-foreground">{t("reports.agentStats.summary.executed")}</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{withGen}</div>
          <div className="text-muted-foreground">{t("reports.agentStats.summary.withGenerated")}</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-primary">{withVis}</div>
          <div className="text-muted-foreground">{t("reports.agentStats.summary.withVisible")}</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{allSupp}</div>
          <div className="text-muted-foreground">{t("reports.agentStats.summary.allSuppressed")}</div>
        </div>
      </div>
    </div>
  );
}
