import { NyravaLogo } from "./NyravaLogo";
import { Landmark, ShieldCheck, FileLock2 } from "lucide-react";

// Restrained capability strip. We do not claim SOC 2 / ISO / HIPAA or any
// certification we have not obtained. Copy describes app behavior only.
const items = [
  {
    icon: NyravaLogo,
    title: "Nyrava Powered Intelligence\u2122",
    subtitle: "Proprietary Legal Intelligence",
    isLogo: true,
  },
  { icon: Landmark, title: "Evidence-Grounded", subtitle: "Cited to source documents" },
  { icon: ShieldCheck, title: "Attorney Work Product", subtitle: "Private to your workspace" },
  { icon: FileLock2, title: "Access Controlled", subtitle: "Row-level data isolation" },
];

export function TrustStrip() {
  return (
    <div className="border-t border-border bg-card/40 backdrop-blur">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-6 py-5 md:grid-cols-4">
        {items.map((it) => (
          <div key={it.title} className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-card/60">
              {it.isLogo ? <NyravaLogo size={22} /> : <it.icon className="h-4 w-4 text-primary" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-foreground">{it.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{it.subtitle}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
