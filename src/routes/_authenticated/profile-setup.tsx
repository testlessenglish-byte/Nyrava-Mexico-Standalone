// Beta-tester profile intake. Beta accounts get the full product, so we ask
// for a real professional identity once before they reach the workspace.
// The layout redirects here while `complete` is false.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { NyravaLogo } from "@/components/NyravaLogo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getProfileSetupStatus, completeProfileSetup } from "@/lib/account.functions";

export const Route = createFileRoute("/_authenticated/profile-setup")({
  head: () => ({
    meta: [
      { title: "Completa tu perfil profesional · Nyrava México" },
      {
        name: "description",
        content:
          "Registra tu despacho, cargo y materia de práctica para activar tu acceso beta a Nyrava México.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ProfileSetupPage,
});

const ESTADOS = [
  "Aguascalientes","Baja California","Baja California Sur","Campeche","Chiapas","Chihuahua",
  "Ciudad de México","Coahuila","Colima","Durango","Estado de México","Guanajuato","Guerrero",
  "Hidalgo","Jalisco","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca","Puebla","Querétaro",
  "Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco","Tamaulipas","Tlaxcala","Veracruz",
  "Yucatán","Zacatecas","Federal / Nacional",
];

const inputCls =
  "mt-1 w-full rounded-md border border-border/70 bg-background/60 px-3 py-2.5 text-sm focus:border-primary focus:outline-none";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

function ProfileSetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statusFn = useServerFn(getProfileSetupStatus);
  const saveFn = useServerFn(completeProfileSetup);

  const { data: status, isLoading } = useQuery({
    queryKey: ["profile-setup-status"],
    queryFn: () => statusFn(),
  });

  const [form, setForm] = useState({
    full_name: "",
    firm_name: "",
    title: "",
    state_practice: "",
    practice_focus: "",
    cedula_profesional: "",
    phone: "",
    years_experience: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (status?.values) setForm((f) => ({ ...f, ...status.values }));
  }, [status]);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await saveFn({ data: form });
      await qc.invalidateQueries({ queryKey: ["profile-setup-status"] });
      toast.success("Perfil completo — acceso beta activo.");
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No fue posible guardar tu perfil.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center px-6 py-14">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex justify-center">
          <NyravaLogo size={56} />
        </div>
        <div className="panel p-8">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em]">
              Acceso beta · Nyrava México
            </span>
          </div>
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">
            Completa tu perfil profesional
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu cuenta beta tiene acceso completo a la plataforma: Habla con tus Casos, análisis de
            casos y casos de prueba. Antes de comenzar, registra tus datos profesionales — así cada
            análisis queda atribuido a un litigante identificado.
          </p>

          <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Nombre completo" required>
                <input
                  required
                  value={form.full_name}
                  onChange={(e) => set("full_name", e.target.value)}
                  placeholder="Lic. María Fernanda Gómez"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Despacho o institución" required>
              <input
                required
                value={form.firm_name}
                onChange={(e) => set("firm_name", e.target.value)}
                placeholder="Gómez & Asociados"
                className={inputCls}
              />
            </Field>
            <Field label="Cargo" required>
              <input
                required
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Socia · Litigio"
                className={inputCls}
              />
            </Field>
            <Field label="Entidad de práctica" required>
              <select
                required
                value={form.state_practice}
                onChange={(e) => set("state_practice", e.target.value)}
                className={inputCls}
              >
                <option value="">Selecciona…</option>
                {ESTADOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Materia principal" required>
              <input
                required
                value={form.practice_focus}
                onChange={(e) => set("practice_focus", e.target.value)}
                placeholder="Amparo, Civil, Laboral…"
                className={inputCls}
              />
            </Field>
            <Field label="Cédula profesional">
              <input
                value={form.cedula_profesional}
                onChange={(e) => set("cedula_profesional", e.target.value)}
                placeholder="Opcional"
                className={inputCls}
              />
            </Field>
            <Field label="Teléfono de contacto">
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="Opcional"
                className={inputCls}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Años de ejercicio">
                <input
                  value={form.years_experience}
                  onChange={(e) => set("years_experience", e.target.value)}
                  placeholder="Opcional — p. ej. 12"
                  className={inputCls}
                />
              </Field>
            </div>

            {err && (
              <div className="sm:col-span-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {err}
              </div>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar y entrar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
