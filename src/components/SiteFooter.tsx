import { Link } from "@tanstack/react-router";
import { NyravaLogo } from "./NyravaLogo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <NyravaLogo size={42} withWordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Plataforma de Inteligencia Legal para el sistema jurídico mexicano.
            Un entorno unificado para organizar, analizar y desarrollar asuntos legales
            de principio a fin.
          </p>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            <span className="tag-bracket">Edición México · v0.1</span>
          </p>
        </div>
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Plataforma
          </h4>
          <ul className="mt-4 space-y-2 text-sm text-foreground/80">
            <li><Link to="/platform" className="hover:text-primary">Plataforma</Link></li>
            <li><Link to="/modules" className="hover:text-primary">Módulos de inteligencia</Link></li>
            <li><Link to="/security" className="hover:text-primary">Seguridad</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Legal
          </h4>
          <ul className="mt-4 space-y-2 text-sm text-foreground/80">
            <li><Link to="/privacy" className="hover:text-primary">Privacidad</Link></li>
            <li><Link to="/terms" className="hover:text-primary">Términos</Link></li>
            <li><Link to="/contact" className="hover:text-primary">Contacto</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} Nyrava Intelligence México. Todos los derechos reservados.</span>
          <span className="font-mono text-[10px] tracking-[0.16em]">CDMX · MÉXICO</span>
        </div>
      </div>
    </footer>
  );
}
