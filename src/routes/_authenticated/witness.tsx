import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Users } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader } from "@/components/modules/SuppressedNotice";
import { ModuleStateNotice } from "@/components/modules/ModuleStatus";
import { computeModuleStates, selectWitnessSignals } from "@/lib/modules/applicability";
import { useI18n } from "@/i18n";
import { useTranslatedTexts } from "@/hooks/useTranslatedTexts";

export const Route = createFileRoute("/_authenticated/witness")({
  head: () => ({ meta: [{ title: "Inteligencia de Testigos — Nyrava" }] }),
  component: WitnessPage,
});

function Bar({ label, value }: { label: string; value: number | null | undefined }) {
  const v = value ?? 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>{v}/100</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </div>
    </div>
  );
}

function WitnessPage() {
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

  const witnesses = (data?.witnesses ?? []) as any[];
  const credibilityAgent = (data?.agents ?? []).find((a: any) => a.agent_type === "witness_credibility");
  // Witness profiles are the primary output, but the credibility agent often
  // produces reliability findings on a case with no formal witness roster.
  // Those must be surfaced instead of showing a bare "no witnesses" wall.
  const rawSignals = data ? selectWitnessSignals(data) : [];
  const state = data ? computeModuleStates(data).find((m) => m.key === "witness")! : null;

  // Screen-reading translation only — never applied to the formal Report.
  const sourceLocale =
    (data?.case as { report_language?: string | null } | undefined)?.report_language === "en" ? "en" : "es";
  const { texts: translatedSignalFlat } = useTranslatedTexts(
    rawSignals.flatMap((f: any) => [f.title ?? "", f.description ?? ""]),
    sourceLocale,
  );
  const signals = rawSignals.map((f: any, i: number) => ({
    ...f,
    title: translatedSignalFlat[i * 2] || f.title,
    description: f.description ? translatedSignalFlat[i * 2 + 1] || f.description : f.description,
  }));
  const { texts: translatedCredibility } = useTranslatedTexts(
    [credibilityAgent?.summary ?? ""],
    sourceLocale,
  );
  const credibilitySummary = credibilityAgent?.summary ? translatedCredibility[0] || credibilityAgent.summary : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<Users className="h-5 w-5" />}
        title={t("mod.witness.title")}
        subtitle={t("mod.witness.subtitle")}
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.loadingCases")}</div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.witness.loading")}</div>
            ) : witnesses.length === 0 ? (
              <div className="space-y-4">
                {state ? <ModuleStateNotice state={state} /> : null}
                {signals.length > 0 ? (
                  <section className="space-y-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("mod.witness.signals", { count: signals.length })}
                    </h2>
                    {signals.slice(0, 25).map((f: any) => (
                      <article key={f.id} className="rounded-xl border border-border bg-card/60 p-4">
                        <h3 className="text-sm font-semibold">{f.title}</h3>
                        {f.description ? (
                          <p className="mt-1 text-sm text-foreground/90">{f.description}</p>
                        ) : null}
                        {f.source_quote ? (
                          <p className="mt-2 text-xs italic text-muted-foreground">{f.source_quote}</p>
                        ) : null}
                      </article>
                    ))}
                  </section>
                ) : null}
              </div>
            ) : (
              <>
                {credibilitySummary ? (
                  <div className="rounded-xl border border-border bg-card/60 p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">{t("mod.witness.credibility")}</p>
                    <p className="mt-1.5 text-sm">{credibilitySummary}</p>
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  {witnesses.map((w) => (
                    <article key={w.id} className="rounded-xl border border-border bg-card/60 p-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-semibold">{w.name}</h3>
                        {w.role ? <span className="text-xs text-muted-foreground">{w.role}</span> : null}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Bar label={t("mod.witness.reliability")} value={w.reliability} />
                        <Bar label={t("mod.witness.consistency")} value={w.consistency} />
                        <Bar label={t("mod.witness.corroboration")} value={w.corroboration} />
                        <Bar label={t("mod.witness.bias")} value={w.bias} />
                        <Bar label={t("mod.witness.observation")} value={w.observation_opportunity} />
                        <Bar label={t("mod.witness.credibilityRisk")} value={w.credibility_risk} />
                      </div>
                      {Array.isArray(w.cross_exam_questions) && w.cross_exam_questions.length > 0 ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-semibold text-primary">{t("mod.witness.crossExam", { count: w.cross_exam_questions.length })}</summary>
                          <ul className="mt-2 space-y-1.5 text-xs text-foreground/90">
                            {w.cross_exam_questions.slice(0, 8).map((q: any, i: number) => (
                              <li key={i} className="rounded bg-background/60 p-2">{typeof q === "string" ? q : q.question ?? JSON.stringify(q)}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {Array.isArray(w.impeachment_questions) && w.impeachment_questions.length > 0 ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-amber-400">{t("mod.witness.impeachment", { count: w.impeachment_questions.length })}</summary>
                          <ul className="mt-2 space-y-1.5 text-xs text-foreground/90">
                            {w.impeachment_questions.slice(0, 8).map((q: any, i: number) => (
                              <li key={i} className="rounded bg-background/60 p-2">{typeof q === "string" ? q : q.question ?? JSON.stringify(q)}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              </>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
