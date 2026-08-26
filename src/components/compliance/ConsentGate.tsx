import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { getPrivacyConsentStatus, acceptPrivacyConsents } from "@/lib/compliance.functions";
import { useI18n } from "@/i18n";

/**
 * Blocking-but-gentle acknowledgement of the active Aviso de Privacidad.
 * Shown once per privacy-notice version, in the authenticated shell. It does
 * not sign anyone out, delete anything, or change any permission: existing
 * accounts, teams and cases stay exactly as they are.
 */
export function ConsentGate() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const status = useServerFn(getPrivacyConsentStatus);
  const accept = useServerFn(acceptPrivacyConsents);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["privacy-consent-status"],
    queryFn: () => status({} as never),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!data?.required) return null;

  const es = lang !== "en";

  async function confirm() {
    setError(null);
    setSaving(true);
    try {
      await accept({ data: { language: es ? "es" : "en", source: "consent_gate" } });
      await qc.invalidateQueries({ queryKey: ["privacy-consent-status"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible registrar el acuse.");
    } finally {
      setSaving(false);
    }
  }

  const items = es
    ? [
        "El tratamiento de mis datos personales de identificación, contacto, perfil profesional y facturación.",
        "El tratamiento de datos personales sensibles contenidos en los expedientes y evidencia que yo cargue, respecto de los cuales declaro contar con la base legal o el consentimiento del titular.",
        "El tratamiento asistido por inteligencia artificial de los documentos de mis expedientes para extracción, análisis y generación de reportes.",
        "La remisión de datos a encargados y su tratamiento fuera del territorio nacional, principalmente en los Estados Unidos de América.",
      ]
    : [
        "Processing of my identification, contact, professional profile and billing data.",
        "Processing of sensitive personal data contained in the case files and evidence I upload, for which I confirm I have a lawful basis or the data subject's consent.",
        "AI-assisted processing of my case documents for extraction, analysis and report generation.",
        "Transfer to processors and processing outside Mexico, principally in the United States.",
      ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="panel max-h-[90vh] w-full max-w-lg overflow-auto p-6">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            {es ? "Aviso de Privacidad" : "Privacy Notice"}
          </span>
        </div>
        <h2 className="mt-3 font-display text-xl font-semibold tracking-tight">
          {es ? "Actualizamos nuestro Aviso de Privacidad" : "We updated our Privacy Notice"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {es
            ? "Antes de continuar, confirma que has leído el Aviso de Privacidad vigente y que autorizas el tratamiento descrito. Tu cuenta, tu equipo y tus expedientes no se modifican."
            : "Before continuing, confirm you have read the current Privacy Notice and authorize the processing described. Your account, team and case files are unchanged."}
        </p>

        <ul className="mt-4 space-y-2 rounded-md border border-border/60 bg-background/50 p-4 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span>
            {es ? "He leído y acepto el " : "I have read and accept the "}
            <Link to="/privacy" target="_blank" className="text-primary hover:underline">
              {es ? "Aviso de Privacidad" : "Privacy Notice"}
            </Link>
            {es ? ` (versión ${data.version?.version ?? ""}).` : ` (version ${data.version?.version ?? ""}).`}
          </span>
        </label>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <button
          onClick={confirm}
          disabled={!checked || saving}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {es ? "Acepto y continúo" : "Accept and continue"}
        </button>
      </div>
    </div>
  );
}
