import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getCurrentOrgId } from "@/lib/workspace";
import {
  listMatters, createMatter, MATTER_TYPES, MATTER_TYPE_LABEL, MATTER_STATUS_LABEL,
  type MatterType,
} from "@/lib/matters";
import { Loader2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/matters")({
  head: () => ({ meta: [{ title: "Asuntos · Nyrava México" }] }),
  component: MattersPage,
});

function MattersPage() {
  const orgId = getCurrentOrgId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["matters", orgId], queryFn: () => listMatters(orgId!), enabled: !!orgId });

  const [title, setTitle] = useState("");
  const [type, setType] = useState<MatterType>("litigation");
  const [client, setClient] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createMatter({ org_id: orgId!, title, matter_type: type, client_name: client || undefined, jurisdiction: jurisdiction || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matters", orgId] });
      setOpen(false); setTitle(""); setClient(""); setJurisdiction(""); setType("litigation");
    },
  });

  return (
    <AppShell title="Asuntos legales">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Sistema general de matter management — litigios, contratos, asesorías, cumplimiento y más.</p>
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground hover:brightness-110"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo asunto
        </button>
      </div>

      {open && (
        <div className="mb-6 panel p-6">
          <h3 className="font-display text-base font-semibold">Nuevo asunto</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Título">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </Field>
            <Field label="Tipo">
              <select value={type} onChange={(e) => setType(e.target.value as MatterType)} className="w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none">
                {MATTER_TYPES.map((t) => <option key={t} value={t} className="bg-background">{MATTER_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Cliente">
              <input value={client} onChange={(e) => setClient(e.target.value)} className="w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </Field>
            <Field label="Jurisdicción">
              <input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="CDMX, Federal, Jalisco…" className="w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              disabled={!title || create.isPending}
              onClick={() => create.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button onClick={() => setOpen(false)} className="rounded-md border border-border/70 px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground">Cancelar</button>
          </div>
          {create.error && <div className="mt-3 text-xs text-destructive">{(create.error as Error).message}</div>}
        </div>
      )}

      <div className="panel overflow-hidden">
        {q.isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : (q.data ?? []).length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Aún no hay asuntos.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background/40 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Jurisdicción</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {(q.data ?? []).map((m) => (
                <tr key={m.id} className="hover:bg-background/40">
                  <td className="px-4 py-3">
                    <Link to="/matters/$id" params={{ id: m.id }} className="font-medium text-foreground hover:text-primary">
                      {m.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{MATTER_TYPE_LABEL[m.matter_type]}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.client_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.jurisdiction ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary">
                      {MATTER_STATUS_LABEL[m.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
