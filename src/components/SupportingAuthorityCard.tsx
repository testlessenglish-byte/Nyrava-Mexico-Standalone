import { Scale, ExternalLink, FileText, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { CaseLawEntry, SupportingAuthority } from "@/lib/intelligence/authority";

const LIKELIHOOD_STYLE: Record<string, string> = {
  High: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  Medium: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  Low: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  Unknown: "text-muted-foreground border-border bg-muted/20",
};

function StrengthStars({ stars }: { stars: number }) {
  return (
    <span className="tracking-tight text-accent" aria-label={`${stars} of 5`}>
      {"★".repeat(stars)}
      <span className="text-muted-foreground/30">{"★".repeat(5 - stars)}</span>
    </span>
  );
}

/**
 * Sits above the "Generate with Nyrava Intelligence" row in Motion Center.
 * Every number here traces to real data: CourtListener case law matched
 * to the motion's legal-issue type, and the evidence citations the
 * Opportunity engine already attached. Nothing is invented — if no case
 * law matched, the section says so instead of showing a fake count.
 */
export function SupportingAuthorityCard({
  authority,
  onSelectCase,
}: {
  authority: SupportingAuthority;
  /** Called when the attorney clicks a case name — opens the detail side panel in the parent. */
  onSelectCase?: (c: CaseLawEntry) => void;
}) {
  const { primaryIssue, significance, cases, evidence, strengthScore, strengthStars, likelihood } = authority;
  const hasAnything = !!primaryIssue || cases.length > 0 || evidence.length > 0;

  if (!hasAnything) return null;

  return (
    <div className="mt-2 rounded-lg border border-accent/20 bg-accent/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
          <Scale className="h-3.5 w-3.5" />
          Supporting Authority
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${LIKELIHOOD_STYLE[likelihood]}`}>
          Likelihood of Success · {likelihood}
        </span>
      </div>

      {primaryIssue ? (
        <p className="mt-2 text-xs text-foreground/80">
          <span className="font-medium text-foreground">Primary Issue: </span>
          {primaryIssue}
          {significance ? <span className="text-muted-foreground"> — {significance}</span> : null}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No matching legal-issue authority detected yet for this motion type.
        </p>
      )}

      {/* Strength meter */}
      <div className="mt-2.5 flex items-center gap-2.5">
        <StrengthStars stars={strengthStars} />
        <span className="text-xs text-muted-foreground">
          Authority Strength · <span className="font-medium text-foreground">{strengthScore}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent transition-all"
          style={{ width: `${strengthScore}%` }}
        />
      </div>

      {/* Counts row */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          {cases.length > 0 ? (
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <ShieldQuestion className="h-3.5 w-3.5 text-muted-foreground/60" />
          )}
          <span className="font-medium text-foreground">{cases.length}</span> case
          {cases.length === 1 ? "" : "s"} located
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{evidence.length}</span> evidence citation
          {evidence.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Case list */}
      {cases.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-border/50 pt-2.5">
          {cases.map((c, i) => (
            <li key={i} className="text-xs">
              <button
                type="button"
                onClick={() => onSelectCase?.(c)}
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-accent hover:underline"
              >
                {c.case_name}
              </button>
              <span className="ml-1.5 text-muted-foreground">
                {[c.citation, c.court, c.date_filed].filter(Boolean).join(" · ")}
              </span>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open on CourtListener"
                className="ml-1.5 inline-block align-middle text-muted-foreground/70 hover:text-accent"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      ) : primaryIssue ? (
        <p className="mt-2.5 border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
          No case law match found yet for this issue in the connected case-law index.
        </p>
      ) : null}
    </div>
  );
}

export default SupportingAuthorityCard;
