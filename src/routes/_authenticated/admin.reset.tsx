// /admin/reset — "Factory Reset Case Data".
//
// Repeatable, super-admin-only wipe of operational legal data (uploads,
// documents, findings, analyses, reports, pipeline/background jobs) across
// object storage and the database. Platform configuration — users, orgs,
// roles, subscriptions, AI providers/keys, Mexican legal corpus, connectors,
// app settings — is intentionally never touched.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Database, HardDrive, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { factoryResetCaseData, previewFactoryReset } from "@/lib/factory-reset.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/admin/reset")({
  head: () => ({
    meta: [
      { title: "Reinicio de datos — Nyrava México" },
      {
        name: "description",
        content:
          "Herramienta de administración para reiniciar los datos operativos de casos sin afectar la configuración de la plataforma.",
      },
      { property: "og:title", content: "Reinicio de datos — Nyrava México" },
      {
        property: "og:description",
        content: "Reinicia expedientes, evidencia y análisis conservando usuarios, configuración y corpus legal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FactoryResetPage,
});

function FactoryResetPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const preview = useServerFn(previewFactoryReset);
  const runReset = useServerFn(factoryResetCaseData);

  const [includeDemo, setIncludeDemo] = useState(true);
  const [includeAudit, setIncludeAudit] = useState(false);
  const [includeAiUsage, setIncludeAiUsage] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["factoryResetPreview"],
    queryFn: () => preview(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      runReset({ data: { includeDemo, includeAudit, includeAiUsage, confirm: "RESET" as const } }),
    onSuccess: (result) => {
      const rows = Object.values(result.deletedRows ?? {}).reduce((a, b) => a + Number(b), 0);
      const files = Object.values(result.deletedFiles ?? {}).reduce((a, b) => a + Number(b), 0);
      toast.success(t("admin.reset.toast.done", { rows: String(rows), files: String(files) }));
      setConfirmText("");
      queryClient.invalidateQueries();
      refetch();
    },
    onError: (e: unknown) => {
      toast.error(t("admin.reset.toast.failed", { error: e instanceof Error ? e.message : String(e) }));
    },
  });

  const totalRows = Object.values(data?.tables ?? {}).reduce((a, b) => a + b, 0);
  const totalFiles = Object.values(data?.buckets ?? {}).reduce((a, b) => a + b, 0);
  const armed = confirmText.trim().toUpperCase() === "RESET" && !mutation.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-10">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Trash2 className="h-5 w-5 text-destructive" />
          {t("admin.reset.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("admin.reset.subtitle")}</p>
      </header>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <PreviewCard
          icon={<Database className="h-4 w-4" />}
          title={t("admin.reset.preview.rows")}
          total={totalRows}
          loading={isLoading}
          entries={data?.tables ?? {}}
          emptyLabel={t("admin.reset.preview.clean")}
        />
        <PreviewCard
          icon={<HardDrive className="h-4 w-4" />}
          title={t("admin.reset.preview.files")}
          total={totalFiles}
          loading={isLoading}
          entries={data?.buckets ?? {}}
          emptyLabel={t("admin.reset.preview.clean")}
        />
      </section>

      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("admin.reset.options.title")}
        </h2>
        <div className="space-y-3">
          <Option
            checked={includeDemo}
            onChange={setIncludeDemo}
            label={t("admin.reset.options.demo")}
            hint={t("admin.reset.options.demo.hint")}
          />
          <Option
            checked={includeAudit}
            onChange={setIncludeAudit}
            label={t("admin.reset.options.audit")}
            hint={t("admin.reset.options.audit.hint")}
          />
          <Option
            checked={includeAiUsage}
            onChange={setIncludeAiUsage}
            label={t("admin.reset.options.aiUsage")}
            hint={t("admin.reset.options.aiUsage.hint")}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t("admin.reset.preserved.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("admin.reset.preserved.body")}</p>
      </section>

      <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
        <div className="mb-3 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("admin.reset.warning")}</p>
        </div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="reset-confirm">
          {t("admin.reset.confirm.label")}
        </label>
        <Input
          id="reset-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="RESET"
          className="max-w-xs font-mono"
          autoComplete="off"
        />
        <Button
          variant="destructive"
          className="mt-4"
          disabled={!armed}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("admin.reset.running")}
            </>
          ) : (
            <>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("admin.reset.cta")}
            </>
          )}
        </Button>
      </section>
    </div>
  );
}

function Option({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function PreviewCard({
  icon,
  title,
  total,
  loading,
  entries,
  emptyLabel,
}: {
  icon: React.ReactNode;
  title: string;
  total: number;
  loading: boolean;
  entries: Record<string, number>;
  emptyLabel: string;
}) {
  const rows = Object.entries(entries).filter(([, n]) => n > 0);
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </span>
        <span className="text-2xl font-semibold tabular-nums">{loading ? "…" : total}</span>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {loading ? null : rows.length === 0 ? (
          <li>{emptyLabel}</li>
        ) : (
          rows.map(([name, n]) => (
            <li key={name} className="flex justify-between gap-4">
              <span className="font-mono">{name}</span>
              <span className="tabular-nums">{n}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
