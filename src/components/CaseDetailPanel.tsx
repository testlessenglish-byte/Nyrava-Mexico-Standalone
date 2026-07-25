import { ExternalLink, Quote, Scale, Landmark, CalendarDays, MapPin } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { CaseLawEntry } from "@/lib/intelligence/authority";

export type CaseDetailContext = {
  case_: CaseLawEntry;
  /** The motion this case is attached to, e.g. "Motion to Suppress Statements." */
  motionTitle: string;
  /** Deterministic significance text for the matched issue — real, not AI-generated. */
  significance: string | null;
  /** The case's jurisdiction, if the attorney set one on the case. */
  jurisdiction: string | null;
};

/**
 * Case detail side panel. Deliberately does NOT include an AI-written
 * "holding" or "case summary" — CourtListener's search API gives us a
 * case name, citation, court, date, and a real snippet of opinion text,
 * nothing more. Generating a holding would mean an LLM reading the full
 * opinion and summarizing it, which is real, separate work (and risky to
 * get wrong — a misstated holding is exactly the kind of thing an
 * attorney could get burned by). So this panel shows only what's real:
 * the actual excerpted language, and *why the deterministic rule engine*
 * flagged this issue for this motion.
 */
export function CaseDetailPanel({
  open,
  onOpenChange,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: CaseDetailContext | null;
}) {
  if (!context) return null;
  const { case_, motionTitle, significance, jurisdiction } = context;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-start gap-2 pr-6 text-base leading-snug">
            <Scale className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {case_.case_name}
          </SheetTitle>
          <SheetDescription>
            {[case_.citation, case_.court, case_.date_filed].filter(Boolean).join(" · ") || "Case law"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Metadata grid — all real fields from CourtListener */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {case_.court ? (
              <div className="flex items-start gap-1.5">
                <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-muted-foreground">Court</div>
                  <div className="font-medium text-foreground">{case_.court}</div>
                </div>
              </div>
            ) : null}
            {case_.date_filed ? (
              <div className="flex items-start gap-1.5">
                <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-muted-foreground">Date Filed</div>
                  <div className="font-medium text-foreground">{case_.date_filed}</div>
                </div>
              </div>
            ) : null}
            {jurisdiction ? (
              <div className="col-span-2 flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-muted-foreground">Case Jurisdiction</div>
                  <div className="font-medium text-foreground">{jurisdiction}</div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Why cited — the deterministic rule's real significance text */}
          {significance ? (
            <div className="rounded-lg border border-accent/20 bg-accent/[0.04] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                Why This Case Was Surfaced
              </div>
              <p className="mt-1.5 text-xs text-foreground/85">{significance}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Supports: <span className="text-foreground">{motionTitle}</span>
              </p>
            </div>
          ) : null}

          {/* Real excerpted opinion language */}
          {case_.snippet ? (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Quote className="h-3.5 w-3.5" />
                Excerpted Opinion Language
              </div>
              <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-xs italic text-foreground/80">
                {case_.snippet}
              </blockquote>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Verbatim excerpt returned by the case-law search index — not AI-generated.
              </p>
            </div>
          ) : null}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Nyrava does not generate an AI summary or holding for this opinion. Read the full opinion before
            relying on it — attorney review required.
          </p>

          <a
            href={case_.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted/40"
          >
            View Full Opinion
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default CaseDetailPanel;
