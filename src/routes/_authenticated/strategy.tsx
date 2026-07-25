import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Target } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, ModuleEmpty, SuppressedNotice } from "@/components/modules/SuppressedNotice";
import { isDeterministicFallback } from "@/lib/intelligence/canonical";

export const Route = createFileRoute("/_app/strategy")({
  head: () => ({ meta: [{ title: "Strategy Center — Nyrava" }] }),
  component: StrategyPage,
});

type Tab = "theories" | "attack" | "defense" | "opportunities";

function StrategyPage() {
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

  const theories = (data?.theories ?? []) as any[];
  const strategies = (data?.strategy ?? []) as any[];
  const opps = (data?.opportunities ?? []) as any[];
  const attack = strategies.filter((s) => /attack|prosecut/i.test(s.perspective));
  const defense = strategies.filter((s) => /defense|defend/i.test(s.perspective));
  const nonMotion = opps.filter((o) => !/motion/i.test(o.opportunity_type ?? ""));

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "theories", label: "Theories", count: theories.length },
    { id: "attack", label: "Attack", count: attack.length },
    { id: "defense", label: "Defense", count: defense.length },
    { id: "opportunities", label: "Opportunities", count: nonMotion.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<Target className="h-5 w-5" />}
        title="Strategy Center"
        subtitle="Theories, attack and defense strategy, and evidence-supported opportunities."
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">Loading cases…</div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">Loading strategy…</div>
            ) : (
              <>
                {detFallback ? <SuppressedNotice title="Limited analysis — narrative pass unavailable. Strategy below reflects evidence-grounded findings only; attorney review required." /> : null}
                {scoresSuppressed ? <SuppressedNotice title="Quantitative scoring suppressed" /> : null}
                <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card/60 p-1">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {t.label} <span className="ml-1 opacity-70">({t.count})</span>
                    </button>
                  ))}
                </div>
                <div className="grid gap-3">
                  {tab === "theories" && (theories.length === 0 ? (
                    <ModuleEmpty title="No theories generated" />
                  ) : theories.map((t) => (
                    <article key={t.id} className="rounded-xl border border-border bg-card/60 p-4">
                      <div className="flex items-baseline justify-between">
                        <h3 className="font-semibold capitalize">{t.theory_type?.replace(/_/g, " ")}</h3>
                        <span className="text-[11px] text-muted-foreground">conf {Math.round((t.confidence ?? 0) * 100)}%</span>
                      </div>
                      <p className="mt-2 text-sm">{t.narrative}</p>
                      {t.risk ? <p className="mt-2 text-xs text-amber-400">Risk: {t.risk}</p> : null}
                    </article>
                  )))}
                  {(tab === "attack" || tab === "defense") && (
                    (tab === "attack" ? attack : defense).length === 0 ? (
                      <ModuleEmpty title={`No ${tab} strategy generated`} />
                    ) : (tab === "attack" ? attack : defense).map((s) => (
                      <article key={s.id} className="rounded-xl border border-border bg-card/60 p-4">
                        <div className="flex items-baseline justify-between">
                          <h3 className="font-semibold capitalize">{s.perspective}</h3>
                          {!scoresSuppressed && s.case_strength_score != null ? (
                            <span className="text-[11px] text-muted-foreground">strength {s.case_strength_score}/100</span>
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
                    <ModuleEmpty title="No opportunities identified" />
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
