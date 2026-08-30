import { useEffect, useMemo, useState } from "react";
import {
  Info,
  X,
  Upload,
  PlayCircle,
  Search,
  FileOutput,
  ShieldCheck,
  FileDown,
  Gavel,
  Target,
  MessageSquare,
  LifeBuoy,
  Lightbulb,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Circle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

// Renders the "Attorney Assistance" enterprise-UX panel that lives in the
// Case Workspace left sidebar, directly beneath the Downloads / Timestamps
// cards. Desktop-only (>=1200px): a compact "Need Help?" trigger renders on
// tablet, and nothing renders at all below that. All content is presentational
// guidance/status — it never performs case actions itself, only delegates to
// the callbacks the workspace page already has wired up (download handlers,
// tab switching), so no case logic lives in here.

type PipelineTimestamps = {
  extracted_at?: string | null;
  analysis_at?: string | null;
  agents_at?: string | null;
  scored_at?: string | null;
  theories_at?: string | null;
  opportunities_at?: string | null;
  trial_prep_at?: string | null;
  report_at?: string | null;
};

export type AttorneyAssistancePanelProps = {
  caseId: string;
  running: boolean;
  timestamps: PipelineTimestamps;
  hasReport: boolean;
  reportBlocked: boolean;
  onDownloadPdf: () => void;
  onOpenTab: (tab: string) => void;
};

const GETTING_STARTED_STEPS = [
  { icon: Upload, id: "upload" },
  { icon: PlayCircle, id: "run" },
  { icon: Search, id: "review" },
  { icon: FileOutput, id: "reports" },
  { icon: ShieldCheck, id: "verify" },
] as const;

const FAQ_IDS = ["duration", "refresh", "leave", "privacy", "regenerate"] as const;

const TIP_IDS = ["ocr", "naming", "discovery", "contradictions", "followup"] as const;

const KEYBOARD_TIPS = [
  { keys: "Ctrl / ⌘ + F", id: "find" },
  { keys: "Esc", id: "close" },
  { keys: "Tab", id: "move" },
  { keys: "Ctrl / ⌘ + Click", id: "newTab" },
] as const;

function stepState(done: boolean, running: boolean): "done" | "active" | "pending" {
  if (done) return "done";
  if (running) return "active";
  return "pending";
}

// Best-effort mapping of the eight pipeline stages onto the timestamps the
// workspace already tracks. Several intelligence stages share a timestamp
// with the phase they run alongside (e.g. OCR completes as part of
// extraction) — this is a status readout, not a second source of truth.
function useAnalysisSteps(ts: PipelineTimestamps, running: boolean) {
  return useMemo(
    () => [
      { key: "pipeline.stage.extraction", done: !!ts.extracted_at },
      { key: "assist.step.ocr", done: !!ts.extracted_at },
      { key: "pipeline.stage.evidence_intel", done: !!ts.analysis_at },
      { key: "pipeline.stage.timeline", done: !!ts.analysis_at },
      { key: "pipeline.stage.witness", done: !!ts.agents_at },
      { key: "pipeline.stage.constitutional", done: !!ts.theories_at },
      { key: "nav.motionIntelligence", done: !!ts.opportunities_at },
      { key: "pipeline.stage.report", done: !!ts.report_at },
    ],
    [ts, running],
  );
}

const PREF_KEY = "nyrava:assistance:pref"; // "shown" | "hidden"
const VISITS_KEY = "nyrava:assistance:visits";

function readVisitsAndBump(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = Number(window.localStorage.getItem(VISITS_KEY) ?? "0");
    const next = Number.isFinite(raw) ? raw + 1 : 1;
    window.localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

function readPref(): "shown" | "hidden" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    return v === "shown" || v === "hidden" ? v : null;
  } catch {
    return null;
  }
}

function writePref(v: "shown" | "hidden") {
  try {
    window.localStorage.setItem(PREF_KEY, v);
  } catch {
    /* ignore */
  }
}

function AssistanceBody({
  caseId,
  running,
  timestamps,
  hasReport,
  reportBlocked,
  onDownloadPdf,
  onOpenTab,
  openSection,
  setOpenSection,
}: AttorneyAssistancePanelProps & {
  openSection: string;
  setOpenSection: (v: string) => void;
}) {
  const { t } = useI18n();
  const steps = useAnalysisSteps(timestamps, running);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TIP_IDS.length);
    }, 9000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Accordion type="single" collapsible value={openSection} onValueChange={setOpenSection} className="w-full">
      <AccordionItem value="getting-started" className="border-border/60">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">{t("assist.gettingStarted")}</AccordionTrigger>
        <AccordionContent className="px-1">
          <ol className="space-y-3">
            {GETTING_STARTED_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.id} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                      {i + 1}
                    </span>
                    {i < GETTING_STARTED_STEPS.length - 1 && <span className="mt-1 h-full w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Icon className="h-3.5 w-3.5 text-accent" />
                      {t(`assist.step.${step.id}.title`)}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {t(`assist.step.${step.id}.body`)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="analysis-status" className="border-border/60">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">{t("assist.analysisStatus")}</AccordionTrigger>
        <AccordionContent className="px-1">
          <p className="text-xs leading-snug text-muted-foreground">
            {running ? t("assist.status.running") : t("assist.status.idle")}
          </p>
          <ul className="mt-3 space-y-1.5">
            {steps.map((s) => {
              const state = stepState(s.done, running && !s.done);
              return (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  {state === "done" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  {state === "active" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
                  {state === "pending" && <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
                  <span className={state === "pending" ? "text-muted-foreground" : "text-foreground"}>{t(s.key)}</span>
                </li>
              );
            })}
          </ul>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="reports-motions" className="border-border/60">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">
          {t("assist.reportsMotions")}
        </AccordionTrigger>
        <AccordionContent className="px-1">
          <p className="text-xs leading-snug text-muted-foreground">
            {t("assist.reports.body")}
          </p>
          <div className="mt-3 space-y-1.5">
            <QuickLink
              icon={FileDown}
              label={t("assist.link.pdf")}
              disabled={reportBlocked || !hasReport}
              onClick={onDownloadPdf}
            />

            <QuickLink icon={Gavel} label={t("nav.motionIntelligence")} onClick={() => onOpenTab("opportunities")} />
            <QuickLink icon={Target} label={t("nav.strategyCenter")} onClick={() => onOpenTab("strategy")} />
            <QuickLink icon={MessageSquare} label={t("assist.link.talk")} onClick={() => onOpenTab("chat")} />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="faq" className="border-border/60">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">
          {t("assist.faq")}
        </AccordionTrigger>
        <AccordionContent className="px-1">
          <div className="space-y-1">
            {FAQ_IDS.map((id, i) => (
              <div key={id} className="rounded-lg border border-border/60">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium text-foreground"
                >
                  {t(`assist.faq.${id}.q`)}
                  <ChevronMini open={openFaq === i} />
                </button>
                {openFaq === i && (
                  <p className="px-2.5 pb-2.5 text-xs leading-snug text-muted-foreground">
                    {t(`assist.faq.${id}.a`)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="tips" className="border-border/60">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">{t("assist.tips")}</AccordionTrigger>
        <AccordionContent className="px-1">
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <p className="text-xs leading-snug text-foreground">{t(`assist.tip.${TIP_IDS[tipIndex]}`)}</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="keyboard" className="border-border/60">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">{t("assist.keyboard")}</AccordionTrigger>
        <AccordionContent className="px-1">
          <ul className="space-y-1.5">
            {KEYBOARD_TIPS.map((k) => (
              <li key={k.keys} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{t(`assist.key.${k.id}`)}</span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {k.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="contact" className="border-none">
        <AccordionTrigger className="px-1 text-sm font-medium hover:no-underline">{t("assist.contact")}</AccordionTrigger>
        <AccordionContent className="px-1">
          <p className="text-xs leading-snug text-muted-foreground">{t("assist.contact.body")}</p>
          <Link
            to="/help"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            {t("assist.contact.cta")}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ChevronMini({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QuickLink({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/60 disabled:hover:bg-transparent"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
      {label}
    </button>
  );
}

export function AttorneyAssistancePanel(props: AttorneyAssistancePanelProps) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [openSection, setOpenSection] = useState("getting-started");

  useEffect(() => {
    const visits = readVisitsAndBump();
    const pref = readPref();
    if (pref === "shown") {
      setVisible(true);
    } else if (pref === "hidden") {
      setVisible(false);
    } else {
      // No explicit preference yet: auto-collapse once the attorney has
      // generated a report and returned to the workspace a few times —
      // by then they no longer need the onboarding guidance front and
      // center. First-time users get it expanded to "Getting Started".
      const autoCollapse = props.hasReport && visits >= 3;
      setVisible(!autoCollapse);
      setOpenSection(visits <= 1 ? "getting-started" : "");
    }
    setReady(true);
    // Only run once per mount — this reads a one-shot visit counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hide = () => {
    setVisible(false);
    writePref("hidden");
  };
  const show = () => {
    setVisible(true);
    writePref("shown");
  };

  if (!ready) return null;

  return (
    <>
      {/* Desktop (>=1200px): full panel or its collapsed "Show Guide" stub. */}
      <div className="hidden min-[1200px]:block">
        {visible ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-accent" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("assist.title")}
                </h2>
              </div>
              <button
                type="button"
                onClick={hide}
                aria-label={t("assist.collapse")}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2">
              <AssistanceBody {...props} openSection={openSection} setOpenSection={setOpenSection} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t("assist.hidden")}</span>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={show}>
                {t("assist.show")}
              </Button>
            </div>
          </div>
        )}

        {/* Sticky, always-available entry point regardless of collapse state. */}
        <button
          type="button"
          onClick={show}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
        >
          <LifeBuoy className="h-3.5 w-3.5" />
          {t("assist.needHelp")}
        </button>
      </div>

      {/* Tablet/mobile (<1200px): hidden completely, desktop-only feature. */}
    </>
  );
}

export default AttorneyAssistancePanel;
