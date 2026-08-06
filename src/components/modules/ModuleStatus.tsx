import { Link } from "@tanstack/react-router";
import { Clock, Users, Gavel, FileSearch, Target, Bell, CheckCircle2, MinusCircle, Loader2, ShieldAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import type { ModuleKey, ModuleState, ModuleStatus } from "@/lib/modules/applicability";

const ICONS: Record<ModuleKey, typeof Clock> = {
  timeline: Clock,
  witness: Users,
  motion: Gavel,
  evidence: FileSearch,
  strategy: Target,
  deadlines: Bell,
};

const STATUS_ICON: Record<ModuleStatus, typeof Clock> = {
  active: CheckCircle2,
  none: MinusCircle,
  pending: Loader2,
  suppressed: ShieldAlert,
};

const STATUS_CLASS: Record<ModuleStatus, string> = {
  active: "text-primary",
  none: "text-muted-foreground",
  pending: "text-muted-foreground",
  suppressed: "text-amber-500",
};

/** Dashboard strip: every intelligence module and what it produced. */
export function ModuleStatusStrip({ states }: { states: ModuleState[] }) {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("mod.strip.title")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("mod.strip.subtitle")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {states.map((s) => {
          const Icon = ICONS[s.key];
          const SIcon = STATUS_ICON[s.status];
          return (
            <Link
              key={s.key}
              to={s.to}
              className="group flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3 transition-colors hover:border-primary/40"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{t(`mod.strip.${s.key}`)}</span>
                  {s.status === "active" ? (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums">{s.count}</span>
                  ) : null}
                  <SIcon className={`h-3.5 w-3.5 shrink-0 ${STATUS_CLASS[s.status]}`} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t(s.reasonKey)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Per-module explanation shown instead of a bare empty state — a module that
 * produced nothing must say why, not look broken.
 */
export function ModuleStateNotice({ state }: { state: ModuleState }) {
  const { t } = useI18n();
  const SIcon = STATUS_ICON[state.status];
  const tone =
    state.status === "suppressed"
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-dashed border-border bg-card/40";
  return (
    <div className={`rounded-xl border p-8 text-center ${tone}`}>
      <SIcon className={`mx-auto h-6 w-6 ${STATUS_CLASS[state.status]}`} />
      <p className="mt-2 text-sm font-medium">{t(`mod.state.${state.key}.headline.${state.status}`)}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{t(state.reasonKey)}</p>
    </div>
  );
}
