import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NyravaLogo } from "@/components/NyravaLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { createOrganization, setCurrentOrgId } from "@/lib/workspace";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Configurar organización · Nyrava México" }] }),
  component: OnboardingPage,
});

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || `org-${Date.now()}`;
}

function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
      const org = await createOrganization({ name, slug });
      setCurrentOrgId(org.id);
      await qc.invalidateQueries({ queryKey: ["memberships"] });
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common.error.generic"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="absolute right-6 top-6"><LanguageSwitcher /></div>
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><NyravaLogo size={56} /></div>
        <div className="panel p-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("onboarding.body")}</p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("onboarding.field.name")}
              </span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("onboarding.field.placeholder")}
                className="mt-1 w-full rounded-md border border-border/70 bg-background/60 px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
              />
            </label>
            {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}
            <button
              type="submit"
              disabled={loading || !name}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("onboarding.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
