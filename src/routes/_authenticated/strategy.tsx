import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Target } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, ModuleEmpty, SuppressedNotice } from "@/components/modules/SuppressedNotice";
import { isDeterministicFallback } from "@/lib/intelligence/canonical";
import { useI18n } from "@/i18n";
import { useTranslatedTexts } from "@/hooks/useTranslatedTexts";

export const Route = createFileRoute("/_authenticated/strategy")({
  head: () => ({ meta: [{ title: "Centro de Estrategia — Nyrava" }] }),
  component: StrategyPage,
});

type Tab = "theories" | "attack" | "defense" | "opportunities";

function StrategyPage() {
  const { t } = useI18n();
  const { cases, activeId, isLoading } = useActiveCase();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("theories");
  const caseId = selected ?? activeId;
  const fetchCase = useServerFn(getCase);
  const { data, isLoading: caseLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId: caseId! } }),
    enabled: !!caseId,
  });

  const report = data?.report as any;
  const scoresSuppressed = report?.scores_suppressed === true;
  const detFallback = isDeterministicFallback(report);

  const rawTheories = (data?.theories ?? []) as any[];
  const strategies = (data?.strategy ?? []) as any[];
  const rawOpps = (data?.opportunities ?? []) as any[];
  const rawAttack = strategies.filter((s) => /attack|prosecut/i.test(s.perspective));
  const rawDefense = strategies.filter((s) => /defense|defend/i.test(s.perspective));
  const rawNonMotion = rawOpps.filter((o) => !/motion/i.test(o.opportunity_type ?? ""));

  // Screen-reading translation only — never applied to the formal Report.
  // Only the currently active tab's items are translated, since only one
  // tab's content is visible at a time.
  const sourceLocale =
    (data?.case as { report_language?: string | null } | undefined)?.report_language === "en" ? "en" : "es";
  const { texts: translatedTheoryNarratives } = useTranslatedTexts(
    tab === "theories" ? rawTheories.map((th) => th.narrative ?? "") : [],
    sourceLocale,
  );
  const theories = rawTheories.map((th, i) => ({ ...th, narrative: translatedTheoryNarratives[i] || th.narrative }));

  const activePerspective = tab === "attack" ? rawAttack : tab === "defense" ? rawDefense : [];
  const { texts: translatedSummaries } = useTranslatedTexts(
    activePerspective.map((s) => s.summary ?? ""),
    sourceLocale,
  );
  const withTranslatedSummary = (list: any[]) =>
    list.map((s, i) => ({ ...s, summary: translatedSummaries[i] || s.summary }));
  const attack = tab === "attack" ? withTranslatedSummary(rawAttack) : rawAttack;
  const defense = tab === "defense" ? withTranslatedSummary(rawDefense) : rawDefense;

  const { texts: translatedOppFlat } = useTranslatedTexts(
    tab === "opportunities" ? rawNonMotion.flatMap((o) => [o.title, o.description]) : [],
    sourceLocale,
  );
  const nonMotion = rawNonMotion.map((o, i) => ({
    ...o,
    title: translatedOppFlat[i * 2] || o.title,
    description: translatedOppFlat[i * 2 + 1] || o.description,
  }));

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "theories", label: t("mod.strategy.tab.theories"), count: theories.length },
    { id: "attack", label: t("mod.strategy.tab.attack"), count: attack.length },
    { id: "defense", label: t("mod.strategy.tab.defense"), count: defense.length },
    { id: "opportunities", label: t("mod.strategy.tab.opportunities"), count: nonMotion.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<Target className="h-5 w-5" />}
        title={t("mod.strategy.title")}
        subtitle={t("mod.strategy.subtitle")}
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.loadingCases")}</div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.strategy.loading")}</div>
            ) : (
              <>
                {detFallback ? <SuppressedNotice title={t("mod.strategy.limited")} /> : null}
                {scoresSuppressed ? <SuppressedNotice title={t("mod.strategy.scoresSuppressed")} /> : null}
                <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card/60 p-1">
                  {tabs.map((tb) => (
                    <button
                      key={tb.id}
                      onClick={() => setTab(tb.id)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${tab === tb.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {tb.label} <span className="ml-1 opacity-70">({tb.count})</span>
                    </button>
                  ))}
                </div>
                <div className="grid gap-3">
                  {tab === "theories" && (theories.length === 0 ? (
                    <ModuleEmpty title={t("mod.strategy.empty.theories")} />
                  ) : theories.map((th) => (
                    <article key={th.id} className="rounded-xl border border-border bg-card/60 p-4">
                      <div className="flex items-baseline justify-between">
                        <h3 className="font-semibold capitalize">{th.theory_type?.replace(/_/g, " ")}</h3>
                        <span className="text-[11px] text-muted-foreground">{t("mod.conf")} {Math.round((th.confidence ?? 0) * 100)}%</span>
                      </div>
                      <p className="mt-2 text-sm">{th.narrative}</p>
                      {th.risk ? <p className="mt-2 text-xs text-amber-400">{t("mod.strategy.risk")}: {th.risk}</p> : null}
                    </article>
                  )))}
                  {(tab === "attack" || tab === "defense") && (
                    (tab === "attack" ? attack : defense).length === 0 ? (
                      <ModuleEmpty title={tab === "attack" ? t("mod.strategy.empty.attack") : t("mod.strategy.empty.defense")} />
                    ) : (tab === "attack" ? attack : defense).map((s) => (
                      <article key={s.id} className="rounded-xl border border-border bg-card/60 p-4">
                        <div className="flex items-baseline justify-between">
                          <h3 className="font-semibold capitalize">{s.perspective}</h3>
                          {!scoresSuppressed && s.case_strength_score != null ? (
                            <span className="text-[11px] text-muted-foreground">{t("mod.strategy.strength")} {s.case_strength_score}/100</span>
                          ) : null}
                        </div>
                        {s.summary ? <p className="mt-2 text-sm whitespace-pre-wrap">{s.summary}</p> : null}
                        {Array.isArray(s.next_actions) && s.next_actions.length > 0 ? (
                          <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-foreground/90">
                            {s.next_actions.slice(0, 8).map((a: any, i: number) => (
                              <li key={i}>{typeof a === "string" ? a : a.action ?? a.title ?? JSON.stringify(a)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))
                  )}
                  {tab === "opportunities" && (nonMotion.length === 0 ? (
                    <ModuleEmpty title={t("mod.strategy.empty.opportunities")} />
                  ) : nonMotion.map((o) => (
                    <article key={o.id} className="rounded-xl border border-border bg-card/60 p-4">
                      <div className="flex items-baseline justify-between">
                        <h3 className="font-semibold">{o.title}</h3>
                        <span className="text-[11px] uppercase text-muted-foreground">{o.opportunity_type}</span>
                      </div>
                      <p className="mt-2 text-sm">{o.description}</p>
                    </article>
                  )))}
                </div>
              </>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
