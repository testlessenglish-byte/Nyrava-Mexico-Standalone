import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Lock, ShieldCheck, KeyRound, Database, FileKey, Eye } from "lucide-react";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Seguridad · Nyrava Intelligence México" },
      { name: "description", content: "Seguridad de grado gubernamental: cifrado, aislamiento por cliente, RLS, auditoría y confidencialidad para despachos legales en México." },
      { property: "og:title", content: "Seguridad — Nyrava México" },
      { property: "og:description", content: "Seguridad y confidencialidad para despachos e instituciones legales." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecurityPage,
});

const PILLARS = [
  { icon: Lock, name: "Cifrado extremo a extremo", desc: "Datos en reposo y en tránsito con cifrado AES-256 y TLS 1.3." },
  { icon: ShieldCheck, name: "Aislamiento por cliente", desc: "Cada despacho opera en un espacio lógico segregado con RLS estricta." },
  { icon: KeyRound, name: "Control de acceso granular", desc: "Roles, permisos por caso y auditoría completa de acciones." },
  { icon: Database, name: "Residencia de datos", desc: "Infraestructura dedicada; opciones de residencia regional." },
  { icon: FileKey, name: "Confidencialidad legal", desc: "Cumplimiento con secreto profesional y protección de datos LFPDPPP." },
  { icon: Eye, name: "Auditoría continua", desc: "Registro inmutable de actividad y revisiones periódicas." },
];

function SecurityPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Seguridad
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          Seguridad de grado <span className="font-editorial text-primary">gubernamental.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          Los datos de un asunto legal son de los más sensibles que existen. Nyrava
          Intelligence México está diseñada bajo estándares de seguridad exigidos por
          despachos corporativos, instituciones financieras y organismos gubernamentales.
        </p>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.name} className="panel p-6">
              <p.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 font-display text-base font-semibold">{p.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
