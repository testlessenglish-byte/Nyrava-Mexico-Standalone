import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getMatter, MATTER_TYPE_LABEL, MATTER_STATUS_LABEL } from "@/lib/matters";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/matters/$id")({
  head: () => ({ meta: [{ title: "Asunto · Nyrava México" }] }),
  component: MatterDetail,
});

const TABS = [
  { id: "overview", label: "Resumen" },
  { id: "parties", label: "Partes" },
  { id: "timeline", label: "Línea de tiempo" },
  { id: "documents", label: "Documentos" },
  { id: "notes", label: "Notas" },
  { id: "tasks", label: "Tareas" },
  { id: "intelligence", label: "Inteligencia" },
] as const;

function MatterDetail() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const q = useQuery({ queryKey: ["matter", id], queryFn: () => getMatter(id) });
  const m = q.data;

  return (
    <AppShell title={m?.title ?? "Asunto"}>
      <Link to="/matters" className="mb-4 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a asuntos
      </Link>

      {!m ? (
        <div className="panel p-12 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : (
        <>
          <div className="panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {MATTER_TYPE_LABEL[m.matter_type]} · {m.jurisdiction ?? "sin jurisdicción"}
                </div>
                <h1 className="mt-1 font-display text-2xl font-semibold">{m.title}</h1>
                <div className="mt-1 text-sm text-muted-foreground">
                  Cliente: {m.client_name ?? "—"} · Ref: {m.reference_code ?? "—"}
                </div>
              </div>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-primary">
                {MATTER_STATUS_LABEL[m.status]}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-1 border-b border-border/60">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
                  tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-6 panel p-6">
            {tab === "overview" && (
              <div className="space-y-3 text-sm">
                <Row k="Tipo" v={MATTER_TYPE_LABEL[m.matter_type]} />
                <Row k="Área de práctica" v={m.practice_area ?? "—"} />
                <Row k="Jurisdicción" v={m.jurisdiction ?? "—"} />
                <Row k="Tribunal" v={m.court ?? "—"} />
                <Row k="Expediente" v={m.docket_number ?? "—"} />
                <Row k="Abierto" v={new Date(m.opened_at).toLocaleDateString("es-MX")} />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Descripción</div>
                  <p className="mt-1 text-foreground">{m.description ?? "Sin descripción."}</p>
                </div>
              </div>
            )}
            {tab !== "overview" && (
              <EmptyState label={TABS.find((t) => t.id === tab)!.label} />
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-border/40 py-2 last:border-0">
      <div className="w-40 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-12 text-center">
      <div className="font-display text-lg font-semibold text-foreground">{label}</div>
      <p className="mt-2 text-sm text-muted-foreground">
        Este módulo estará disponible en la próxima fase. El esquema y los permisos ya están listos.
      </p>
    </div>
  );
}
