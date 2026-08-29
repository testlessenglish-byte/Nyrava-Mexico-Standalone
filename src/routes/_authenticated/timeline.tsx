import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Clock, Download } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader } from "@/components/modules/SuppressedNotice";
import { ModuleStateNotice } from "@/components/modules/ModuleStatus";
import { computeModuleStates, selectTimelineEvents } from "@/lib/modules/applicability";
import { useI18n } from "@/i18n";
import { useTranslatedTexts } from "@/hooks/useTranslatedTexts";
import { NyravaPagination } from "@/components/common/NyravaPagination";

export const Route = createFileRoute("/_authenticated/timeline")({
  head: () => ({ meta: [{ title: "Constructor de Línea de Tiempo — Nyrava" }] }),
  component: TimelinePage,
});

type Event = { date: string | null; title: string; description?: string | null; source?: string | null };

function TimelinePage() {
  const { t, locale } = useI18n();
  const es = locale === "es";
  const { cases, activeId, isLoading } = useActiveCase();
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const caseId = selected ?? activeId;
  const fetchCase = useServerFn(getCase);
  const { data, isLoading: caseLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId: caseId! } }),
    enabled: !!caseId,
  });

  const rawEvents = useMemo<Event[]>(() => (data ? selectTimelineEvents(data) : []), [data]);
  const state = useMemo(
    () => (data ? computeModuleStates(data).find((m) => m.key === "timeline")! : null),
    [data],
  );

  // Screen-reading translation only — never applied to the formal Report.
  const sourceLocale =
    (data?.case as { report_language?: string | null } | undefined)?.report_language === "en" ? "en" : "es";
  const { texts: translatedFlat } = useTranslatedTexts(
    rawEvents.flatMap((e) => [e.title, e.description ?? ""]),
    sourceLocale,
  );
  const events: Event[] = rawEvents.map((e, i) => ({
    ...e,
    title: translatedFlat[i * 2] || e.title,
    description: e.description ? translatedFlat[i * 2 + 1] || e.description : e.description,
  }));

  const pagedEvents = events.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `timeline-${(data?.case as any)?.name ?? "case"}.json`;
    a.click();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<Clock className="h-5 w-5" />}
        title={t("mod.timeline.title")}
        subtitle={t("mod.timeline.subtitle")}
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.loadingCases")}</div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={(id) => { setSelected(id); setPage(1); }} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.timeline.loading")}</div>
            ) : events.length === 0 && state ? (
              <ModuleStateNotice state={state} />
            ) : (
              <>
                <div className="flex justify-end">
                  <button onClick={exportJson} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-card/80">
                    <Download className="h-3.5 w-3.5" /> {t("mod.timeline.export")}
                  </button>
                </div>
                <ol className="relative space-y-3 border-l border-border pl-5">
                  {pagedEvents.map((e, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
                      <div className="rounded-xl border border-border bg-card/60 p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="font-semibold leading-tight">{e.title}</h3>
                          <span className="text-xs text-muted-foreground">{e.date ?? t("mod.timeline.dateUnknown")}</span>
                        </div>
                        {e.description ? <p className="mt-1.5 text-sm text-foreground/90">{e.description}</p> : null}
                        {e.source ? <p className="mt-2 text-xs italic text-muted-foreground">{t("mod.timeline.source")}: {e.source}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
                {events.length > 0 && (
                  <NyravaPagination
                    page={page}
                    pageSize={pageSize}
                    total={events.length}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                    es={es}
                  />
                )}
              </>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
