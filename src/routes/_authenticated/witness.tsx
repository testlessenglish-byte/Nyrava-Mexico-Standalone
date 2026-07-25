import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Users } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, ModuleEmpty } from "@/components/modules/SuppressedNotice";

export const Route = createFileRoute("/_authenticated/witness")({
  head: () => ({ meta: [{ title: "Witness Intelligence — Nyrava" }] }),
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<Users className="h-5 w-5" />}
        title="Witness Intelligence"
        subtitle="Per-witness reliability, bias, consistency, corroboration, and impeachment opportunities."
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">Loading cases…</div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">Loading witnesses…</div>
            ) : witnesses.length === 0 ? (
              <ModuleEmpty title="No witnesses identified yet" hint="Run witness intelligence on this case." />
            ) : (
              <>
                {credibilityAgent?.summary ? (
                  <div className="rounded-xl border border-border bg-card/60 p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Credibility analysis</p>
                    <p className="mt-1.5 text-sm">{credibilityAgent.summary}</p>
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
                        <Bar label="Reliability" value={w.reliability} />
                        <Bar label="Consistency" value={w.consistency} />
                        <Bar label="Corroboration" value={w.corroboration} />
                        <Bar label="Bias risk" value={w.bias} />
                        <Bar label="Observation" value={w.observation_opportunity} />
                        <Bar label="Credibility risk" value={w.credibility_risk} />
                      </div>
                      {Array.isArray(w.cross_exam_questions) && w.cross_exam_questions.length > 0 ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-semibold text-primary">Cross-examination questions ({w.cross_exam_questions.length})</summary>
                          <ul className="mt-2 space-y-1.5 text-xs text-foreground/90">
                            {w.cross_exam_questions.slice(0, 8).map((q: any, i: number) => (
                              <li key={i} className="rounded bg-background/60 p-2">{typeof q === "string" ? q : q.question ?? JSON.stringify(q)}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {Array.isArray(w.impeachment_questions) && w.impeachment_questions.length > 0 ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-amber-400">Impeachment ({w.impeachment_questions.length})</summary>
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
