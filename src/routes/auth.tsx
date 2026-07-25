import { createFileRoute, Link } from "@tanstack/react-router";
import { NyravaLogo } from "@/components/NyravaLogo";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acceso · Nyrava Intelligence México" },
      { name: "description", content: "Solicita acceso a Nyrava Intelligence México — la plataforma de inteligencia legal para el sistema jurídico mexicano." },
      { property: "og:title", content: "Acceso · Nyrava México" },
      { property: "og:description", content: "Solicita acceso al programa cerrado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="pointer-events-none absolute inset-0 divider-grid opacity-[0.35]" aria-hidden />
      <div className="relative w-full max-w-md">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </Link>
        <div className="panel p-8">
          <div className="flex flex-col items-center">
            <NyravaLogo size={56} />
            <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">
              Solicitar acceso
            </h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              El acceso a Nyrava Intelligence México se otorga por invitación.
              Habilitaremos la autenticación en una fase próxima.
            </p>
          </div>

          <div className="mt-8 space-y-3">
            <div className="rounded-md border border-border/70 bg-background/40 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Estado
              </div>
              <div className="mt-1 text-sm text-foreground">
                Autenticación en preparación · Fase 2
              </div>
            </div>
            <Link
              to="/contact"
              className="block w-full rounded-md bg-primary py-3 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
            >
              Contactar al equipo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
