import { Link } from "@tanstack/react-router";
import { NyravaLogo } from "./NyravaLogo";

const NAV = [
  { label: "PLATAFORMA", to: "/platform" },
  { label: "MÓDULOS", to: "/modules" },
  { label: "SEGURIDAD", to: "/security" },
  { label: "CONTACTO", to: "/contact" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center">
          <NyravaLogo size={38} withWordmark />
        </Link>
        <nav className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            to="/auth"
            className="hidden text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition hover:text-foreground md:inline"
          >
            INICIAR SESIÓN
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-primary transition hover:bg-primary/20"
          >
            SOLICITAR ACCESO
          </Link>
        </div>
      </div>
    </header>
  );
}
