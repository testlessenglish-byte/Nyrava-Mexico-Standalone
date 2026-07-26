import { useState, useEffect } from "react";
import { useI18n } from "@/i18n";
import { Pager, ViewToggle, RowActions, Section, useItemFlagActions, stableKey, type ItemFlags } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function WitnessProfiles({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
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
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {t("reports.witnessProfiles.title", { count: notDeleted.length })}
        </p>
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
                    if (window.confirm(t("reports.confirm.removeWitness", { name: w.name })))
                      apply(section, w.__key, "deleted");
                  }}
                />
              </span>
            </summary>
            <div className="mt-2 space-y-2 text-xs">
              {w.key_statements.length ? <Section title={t("reports.witnessProfiles.keyStatements")} items={w.key_statements} /> : null}
              {w.credibility_supports.length ? (
                <Section title={t("reports.witnessProfiles.supportsReliability")} items={w.credibility_supports} />
              ) : null}
              {w.credibility_risks.length ? <Section title={t("reports.witnessProfiles.risksToCredibility")} items={w.credibility_risks} /> : null}
              {w.bias_indicators.length ? <Section title={t("reports.witnessProfiles.biasIndicators")} items={w.bias_indicators} /> : null}
              {w.impeachment_opportunities.length ? (
                <Section title={t("reports.witnessProfiles.impeachmentOpportunities")} items={w.impeachment_opportunities} />
              ) : null}
              <Section title={t("reports.witnessProfiles.directExam")} items={w.direct_questions} />
              <Section title={t("reports.witnessProfiles.crossExam")} items={w.cross_questions} />
            </div>
          </details>
        ))}
        {!pageProfiles.length ? (
          <p className="text-xs text-muted-foreground">
            {view === "archived" ? t("reports.witnessProfiles.empty.archived") : t("reports.witnessProfiles.empty.active")}
          </p>
        ) : null}
      </div>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={profiles.length} />
    </div>
  );
}
