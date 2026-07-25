import { Activity, ScanLine, Scale, ShieldCheck } from "lucide-react";

/**
 * Static enterprise-intelligence hero panel.
 * No live data — this is a visual dashboard mock that communicates
 * what the platform does at a glance.
 */
export function IntelligenceHeroPanel() {
  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 divider-grid opacity-40" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-30 animate-scan"
        style={{ background: "linear-gradient(180deg, transparent, oklch(0.82 0.13 195 / 0.25), transparent)" }}
        aria-hidden
      />

      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse-ring" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Intelligence OS · Sesión activa
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          MX-CDMX · 08:14:22
        </span>
      </div>

      {/* Stat grid */}
      <div className="relative mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Scale, label: "Casos activos", value: "128", tone: "text-primary" },
          { icon: Activity, label: "Documentos procesados", value: "4,812", tone: "text-success" },
          { icon: ScanLine, label: "Entidades extraídas", value: "26,340", tone: "text-warning" },
          { icon: ShieldCheck, label: "Autoridades citadas", value: "1,207", tone: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="stat-tile p-3">
            <s.icon className={`h-4 w-4 ${s.tone}`} />
            <div className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">
              {s.value}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Case list */}
      <div className="relative mt-4 rounded-md border border-border/60 bg-background/40">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Casos recientes
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-primary">EN VIVO</span>
        </div>
        <ul className="divide-y divide-border/50">
          {[
            { id: "MX-2026-0148", title: "Amparo indirecto · SCJN", tag: "Constitucional", tone: "text-primary" },
            { id: "MX-2026-0147", title: "Juicio ordinario mercantil", tag: "Mercantil", tone: "text-success" },
            { id: "MX-2026-0146", title: "Controversia laboral · JFCA", tag: "Laboral", tone: "text-warning" },
          ].map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2">
              <div className="flex flex-col">
                <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">{c.id}</span>
                <span className="text-sm text-foreground">{c.title}</span>
              </div>
              <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${c.tone}`}>
                {c.tag}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
