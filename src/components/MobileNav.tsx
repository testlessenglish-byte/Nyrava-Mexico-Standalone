import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { NyravaLogo } from "./NyravaLogo";
import { cn } from "@/lib/utils";

export type MobileNavItem =
  | { label: string; to: string }
  | { label: string; href: string };

interface MobileNavProps {
  items: MobileNavItem[];
  children?: React.ReactNode;
  triggerClassName?: string;
}

/**
 * Hamburger + slide-out drawer for phones and tablets (below lg).
 * Mirrors the desktop nav items exactly so nothing is lost when the
 * horizontal nav is hidden at narrower widths.
 */
export function MobileNav({ items, children, triggerClassName = "" }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Abrir menú"
          className={cn(
            "grid h-10 w-10 place-items-center rounded-md border border-border text-foreground lg:hidden",
            triggerClassName,
          )}
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[85vw] max-w-xs flex-col gap-1 sm:max-w-sm">
        <div className="mb-4 flex items-center">
          <NyravaLogo size={32} withWordmark />
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((item) =>
            "to" in item ? (
              <SheetClose asChild key={item.label}>
                <Link
                  to={item.to as never}
                  className="rounded-md px-3 py-3 text-sm font-semibold tracking-[0.08em] text-foreground transition hover:bg-secondary"
                >
                  {item.label}
                </Link>
              </SheetClose>
            ) : (
              <SheetClose asChild key={item.label}>
                <a
                  href={item.href}
                  className="rounded-md px-3 py-3 text-sm font-semibold tracking-[0.08em] text-foreground transition hover:bg-secondary"
                >
                  {item.label}
                </a>
              </SheetClose>
            ),
          )}
        </nav>
        {children && <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">{children}</div>}
      </SheetContent>
    </Sheet>
  );
}
