// Case opportunities — findings that either verified evidence-grounded lines
// of argument, or theories flagged as requiring attorney review before use.
import { useI18n } from "@/i18n";
import { ArchivableList, stableKey, type ItemFlags } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OpportunityReviewSection({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
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
      <p className="text-xs font-semibold uppercase text-muted-foreground">{t("reports.opportunities.title")}</p>
      <div className="mt-3 space-y-5">
        {verified.length ? (
          <ArchivableList
            title={t("reports.opportunities.verified.title")}
            items={verified}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText={t("reports.opportunities.verified.empty")}
            renderItem={(o) => (
              <>
                <div className="font-medium text-sm">{o.title}</div>
                <div className="text-xs text-muted-foreground">{o.description}</div>
                {(o.citations ?? []).slice(0, 1).map((c, j) => (
                  <div key={j} className="mt-1 text-[10px] text-muted-foreground">
                    {t("reports.opportunities.quote", { quote: c.quote ?? "" })}
                    {c.page ? t("reports.opportunities.page", { page: c.page }) : ""}
                  </div>
                ))}
              </>
            )}
          />
        ) : null}
        {potential.length ? (
          <ArchivableList
            title={t("reports.opportunities.potential.title")}
            items={potential}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText={t("reports.opportunities.potential.empty")}
            renderItem={(o) => (
              <>
                <div className="font-medium text-sm">{o.title}</div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">{o.description}</div>
                {o.counter_response ? (
                  <div className="mt-1 text-[10px] text-amber-300">{o.counter_response}</div>
                ) : null}
              </>
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
