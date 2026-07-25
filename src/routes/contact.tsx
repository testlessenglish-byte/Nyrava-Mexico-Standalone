import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Mail, MapPin } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contacto · Nyrava Intelligence México" },
      { name: "description", content: "Contacta al equipo de Nyrava Intelligence México — programa cerrado para despachos e instituciones legales." },
      { property: "og:title", content: "Contacto · Nyrava México" },
      { property: "og:description", content: "Programa cerrado para despachos e instituciones legales en México." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-4xl px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Contacto
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          Programa <span className="font-editorial text-primary">cerrado.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          Nyrava Intelligence México opera bajo un programa de acceso cerrado con despachos
          e instituciones seleccionadas. Escríbenos para explorar una colaboración.
        </p>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="panel p-6">
            <Mail className="h-5 w-5 text-primary" />
            <h3 className="mt-3 font-display text-base font-semibold">Correo</h3>
            <p className="mt-1 text-sm text-muted-foreground">mexico@nyrava.legal</p>
          </div>
          <div className="panel p-6">
            <MapPin className="h-5 w-5 text-primary" />
            <h3 className="mt-3 font-display text-base font-semibold">Ubicación</h3>
            <p className="mt-1 text-sm text-muted-foreground">Ciudad de México · CDMX</p>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
