import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Clock, Download } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, ModuleEmpty } from "@/components/modules/SuppressedNotice";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/timeline")({
  head: () => ({ meta: [{ title: "Constructor de Línea de Tiempo — Nyrava" }] }),
  component: TimelinePage,
});

type Event = { date: string | null; title: string; description?: string; source?: string };

function extractEvents(data: any, fallbackTitle: string): Event[] {
  const out: Event[] = [];
  const fr = (data?.report?.full_report ?? {}) as any;
  const sources = [fr.timeline, fr.events, fr.case_timeline].filter(Array.isArray);
  for (const arr of sources) {
    for (const ev of arr) {
      if (!ev) continue;
      out.push({
        date: ev.date ?? ev.when ?? ev.event_date ?? null,
        title: ev.title ?? ev.event ?? ev.name ?? fallbackTitle,
        description: ev.description ?? ev.detail ?? ev.summary,
        source: ev.source ?? ev.citation,
      });
    }
  }
  // Fallback: derive from findings with metadata dates
  for (const f of data?.findings ?? []) {
    const d = f?.metadata?.event_date ?? f?.metadata?.date;
    if (d) {
      out.push({ date: d, title: f.title, description: f.description, source: f.source_quote });
    }
  }
  return out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

function TimelinePage() {
  const { t } = useI18n();
  const { cases, activeId, isLoading } = useActiveCase();
  const [selected, setSelected] = useState<string | null>(null);
  const caseId = selected ?? activeId;
  const fetchCase = useServerFn(getCase);
  const { data, isLoading: caseLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId: caseId! } }),
    enabled: !!caseId,
  });

  const events = useMemo(() => (data ? extractEvents(data, t("mod.timeline.event")) : []), [data, t]);

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
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.timeline.loading")}</div>
            ) : events.length === 0 ? (
              <ModuleEmpty title={t("mod.timeline.empty.title")} hint={t("mod.timeline.empty.hint")} />
            ) : (
              <>
                <div className="flex justify-end">
                  <button onClick={exportJson} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-card/80">
                    <Download className="h-3.5 w-3.5" /> {t("mod.timeline.export")}
                  </button>
                </div>
                <ol className="relative space-y-3 border-l border-border pl-5">
                  {events.map((e, i) => (
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
              </>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
