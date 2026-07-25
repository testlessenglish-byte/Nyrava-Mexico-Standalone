import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Gauge, Download, ChevronDown, ChevronRight } from "lucide-react";
import {
  buildCoverageMatrix,
  CAPABILITY_DIMENSIONS,
  CAPABILITY_LABELS_ES,
  STATUS_ICON,
  type CapabilityDimension,
  type CoverageStatus,
} from "@/lib/intelligence/mx-coverage";
import { useIsAdmin } from "@/hooks/use-roles";

/**
 * Admin — Legal Coverage Dashboard (Nyrava México).
 *
 * Visualizes the domain × capability matrix computed by
 * `src/lib/intelligence/mx-coverage.ts` against the live code registries.
 * Because the scoring is derived from the same modules the engines use, the
 * dashboard cannot go stale: adding a Mexican finding module or terminology
 * key immediately upgrades the corresponding cell.
 *
 * Access: super_admin / admin only (RBAC via `useIsAdmin`).
 */
export const Route = createFileRoute("/_authenticated/admin/legal-coverage")({
  head: () => ({ meta: [{ title: "Cobertura legal · Nyrava México" }] }),
  component: LegalCoveragePage,
});

const STATUS_TONES: Record<CoverageStatus, string> = {
  ready: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  missing: "bg-rose-500/10 text-rose-500 border-rose-500/30",
};

function LegalCoveragePage() {
  const { isAdmin, isLoading } = useIsAdmin();
  const rows = useMemo(() => buildCoverageMatrix(), []);
  const [wave, setWave] = useState<"all" | "deep" | "stub" | "future">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return <div className="p-10 text-muted-foreground">Cargando…</div>;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-sm text-muted-foreground">
        Acceso denegado — requiere rol de administrador.
      </div>
    );
  }

  const filtered = wave === "all" ? rows : rows.filter((r) => r.spec.wave === wave);
  const totals = rows.reduce(
    (acc, r) => {
      for (const dim of CAPABILITY_DIMENSIONS) {
        const s = r.cells[dim].status;
        acc[s] += 1;
      }
      return acc;
    },
    { ready: 0, partial: 0, missing: 0 } as Record<CoverageStatus, number>,
  );
  const globalScore = Math.round(
    (rows.reduce((s, r) => s + r.score, 0) / Math.max(1, rows.length)) * 100,
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nyrava-mx-legal-coverage-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Gauge className="mt-1 h-6 w-6 text-primary" />
          <div>
            <h1 className="font-display text-2xl font-semibold">Cobertura Legal México</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Matriz auditable de cada dominio jurídico × capacidad implementada.
              Los indicadores se calculan directamente contra los registros de
              código (<code className="rounded bg-muted px-1">practice-areas.ts</code>,{" "}
              <code className="rounded bg-muted px-1">legal-terms.ts</code>) — no
              es un tablero manual.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            ← Admin
          </Link>
          <button
            onClick={exportJson}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Exportar JSON
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <StatCard label="Puntaje global" value={`${globalScore}%`} tone="primary" />
        <StatCard label="Ready" value={String(totals.ready)} tone="emerald" />
        <StatCard label="Partial" value={String(totals.partial)} tone="amber" />
        <StatCard label="Missing" value={String(totals.missing)} tone="rose" />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Filtrar wave:</span>
        {(["all", "deep", "stub", "future"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWave(w)}
            className={`rounded-full border px-3 py-1 text-xs ${
              wave === w
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {w === "all" ? "Todos" : w === "deep" ? "Deep-build" : w === "stub" ? "Stub" : "Future"}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left">
              <th className="sticky left-0 z-10 bg-secondary/40 px-3 py-2 font-medium text-muted-foreground">Dominio</th>
              <th className="px-2 py-2 font-medium text-muted-foreground">Wave</th>
              <th className="px-2 py-2 font-medium text-muted-foreground">Puntaje</th>
              {CAPABILITY_DIMENSIONS.map((dim) => (
                <th key={dim} className="px-2 py-2 font-medium text-muted-foreground" title={CAPABILITY_LABELS_ES[dim]}>
                  <div className="rotate-[-20deg] whitespace-nowrap">{CAPABILITY_LABELS_ES[dim]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <>
                <tr
                  key={row.spec.code}
                  className="cursor-pointer border-t border-border hover:bg-muted/30"
                  onClick={() => setExpanded(expanded === row.spec.code ? null : row.spec.code)}
                >
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                    <div className="flex items-center gap-1">
                      {expanded === row.spec.code ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      {row.spec.label_es}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{row.spec.code}</div>
                  </td>
                  <td className="px-2 py-2">
                    <WaveBadge wave={row.spec.wave} />
                  </td>
                  <td className="px-2 py-2 tabular-nums">{Math.round(row.score * 100)}%</td>
                  {CAPABILITY_DIMENSIONS.map((dim) => (
                    <CellPill key={dim} status={row.cells[dim].status} />
                  ))}
                </tr>
                {expanded === row.spec.code && (
                  <tr className="border-t border-border bg-muted/20">
                    <td colSpan={3 + CAPABILITY_DIMENSIONS.length} className="px-4 py-4">
                      <DomainDetail row={row} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-full border ${STATUS_TONES.ready}`} /> ready ({STATUS_ICON.ready})
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-full border ${STATUS_TONES.partial}`} /> partial ({STATUS_ICON.partial})
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-full border ${STATUS_TONES.missing}`} /> missing ({STATUS_ICON.missing})
        </span>
      </div>
    </div>
  );
}

function CellPill({ status }: { status: CoverageStatus }) {
  return (
    <td className="px-2 py-2 text-center">
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${STATUS_TONES[status]}`}
        aria-label={status}
        title={status}
      >
        {STATUS_ICON[status]}
      </span>
    </td>
  );
}

function WaveBadge({ wave }: { wave: "deep" | "stub" | "future" }) {
  const map = {
    deep: "border-primary/40 bg-primary/10 text-primary",
    stub: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    future: "border-border bg-muted text-muted-foreground",
  } as const;
  const label = wave === "deep" ? "Deep" : wave === "stub" ? "Stub" : "Future";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${map[wave]}`}>{label}</span>;
}

function DomainDetail({ row }: { row: ReturnType<typeof buildCoverageMatrix>[number] }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Fundamentos requeridos</div>
        <ul className="mt-1 space-y-1 text-sm">
          {row.spec.required_laws.map((l) => (
            <li key={l}>· {l}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tipos de documento</div>
        <ul className="mt-1 space-y-1 text-sm">
          {row.spec.required_document_types.map((d) => (
            <li key={d}>· {d}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Notas por capacidad</div>
        <ul className="mt-1 space-y-1 text-xs">
          {CAPABILITY_DIMENSIONS.map((dim) => (
            <li key={dim} className="flex items-start gap-2">
              <span className="w-4 shrink-0">{STATUS_ICON[row.cells[dim].status]}</span>
              <span className="text-muted-foreground">
                <strong className="text-foreground">{CAPABILITY_LABELS_ES[dim]}:</strong>{" "}
                {row.cells[dim].note || "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {row.blocked_terms.length > 0 && (
        <div className="md:col-span-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Términos bloqueados ({row.blocked_terms.length})
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {row.blocked_terms.slice(0, 24).map((t: string) => (
              <span key={t} className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-0.5 text-[10px] text-rose-400">
                {t}
              </span>
            ))}
            {row.blocked_terms.length > 24 && (
              <span className="text-[10px] text-muted-foreground">+{row.blocked_terms.length - 24} más</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "primary" | "emerald" | "amber" | "rose" }) {
  const map = {
    primary: "border-primary/40 bg-primary/10 text-primary",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    rose: "border-rose-500/40 bg-rose-500/10 text-rose-500",
  } as const;
  return (
    <div className={`rounded-xl border p-4 ${map[tone]}`}>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] opacity-80">{label}</div>
    </div>
  );
}

// unused import guard for CapabilityDimension re-export symmetry
export type _CapabilityDimension = CapabilityDimension;
