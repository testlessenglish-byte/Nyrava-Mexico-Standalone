import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2, Download, FileText, Globe, Info, Loader2,
  Lock, Mail, Printer, Send, Shield, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import { localizedEnum } from "@/lib/social/social-i18n";
import {
  generateSocialAuditReportPdf,
  getSocialAuditReportPreview,
  sendSocialAuditReportEmail,
} from "@/lib/social.functions";

interface Props {
  caseId?: string;
  orgId: string;
  es: boolean;
  onClose: () => void;
}

export function GenerateReportModal({
  caseId,
  orgId,
  es,
  onClose,
}: Props) {
  const getPreviewFn = useServerFn(getSocialAuditReportPreview);
  const generatePdfFn = useServerFn(generateSocialAuditReportPdf);
  const sendEmailFn = useServerFn(sendSocialAuditReportEmail);

  const [scope, setScope] = useState<"individual_case" | "organization_wide" | "community_support" | "financial_activity" | "services_outcomes" | "full_audit">(
    caseId ? "individual_case" : "organization_wide"
  );
  const [period, setPeriod] = useState<"all_history" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom">("all_history");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [language, setLanguage] = useState<"es" | "en">(es ? "es" : "en");
  const [classification, setClassification] = useState<"internal" | "confidential" | "restricted" | "external_distribution">("confidential");

  const [generatedResult, setGeneratedResult] = useState<{
    reportId: string;
    checksum: string;
    pdfBase64: string;
    generatedAt: string;
  } | null>(null);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ recipient: "", subject: "" });

  const previewQuery = useQuery({
    queryKey: ["audit-report-preview", orgId, caseId, scope, period, startDate, endDate],
    queryFn: () => getPreviewFn({
      data: {
        orgId,
        caseId: scope === "individual_case" ? caseId : undefined,
        scope,
        period,
        startDate: period === "custom" ? startDate : undefined,
        endDate: period === "custom" ? endDate : undefined,
        language,
        classification,
      }
    }),
  });

  const generateM = useMutation({
    mutationFn: () => generatePdfFn({
      data: {
        orgId,
        caseId: scope === "individual_case" ? caseId : undefined,
        scope,
        period,
        startDate: period === "custom" ? startDate : undefined,
        endDate: period === "custom" ? endDate : undefined,
        language,
        classification,
      }
    }),
    onSuccess: (res) => {
      setGeneratedResult(res);
      toast.success(es ? "Informe de auditoría generado exitosamente" : "Audit report generated successfully");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sendEmailM = useMutation({
    mutationFn: () => sendEmailFn({
      data: {
        orgId,
        reportId: generatedResult?.reportId || "",
        recipientEmail: emailForm.recipient,
        subject: emailForm.subject || (es ? `Informe de Auditoría ${generatedResult?.reportId}` : `Audit Report ${generatedResult?.reportId}`),
      }
    }),
    onSuccess: () => {
      toast.success(es ? "Informe enviado por correo electrónico" : "Report sent via email");
      setShowEmailModal(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleDownloadPdf = () => {
    if (!generatedResult) return;
    const linkSource = `data:application/pdf;base64,${generatedResult.pdfBase64}`;
    const downloadLink = document.createElement("a");
    downloadLink.href = linkSource;
    downloadLink.download = `${generatedResult.reportId}.pdf`;
    downloadLink.click();
  };

  const handlePrintPdf = () => {
    if (!generatedResult) return;
    const blob = b64toBlob(generatedResult.pdfBase64, "application/pdf");
    const blobUrl = URL.createObjectURL(blob);
    const printWindow = window.open(blobUrl, "_blank");
    if (printWindow) {
      printWindow.focus();
      printWindow.print();
    }
  };

  function b64toBlob(b64Data: string, contentType = "", sliceSize = 512) {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  }

  const p = previewQuery.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-xs">
      <div className="flex h-full max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  {es ? "Generar Informe de Auditoría y Rendición de Cuentas" : "Generate Audit & Accountability Report"}
                </h3>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                  {es ? "Exclusivo Titular" : "Subscriber Only"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {es
                  ? "Emisión institucional en PDF a partir de registros canónicos almacenados, sin invención."
                  : "Institutional PDF generated strictly from stored canonical records, zero invention."}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-xs">
          {!generatedResult ? (
            <div className="space-y-4">
              {/* Scope & Period Grid */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block font-semibold text-foreground">
                  {es ? "Alcance del informe" : "Report scope"}
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  >
                    {caseId && <option value="individual_case">{es ? "Este expediente de caso" : "This case record"}</option>}
                    <option value="organization_wide">{es ? "Toda la organización (Todos los casos)" : "Organization-wide (All cases)"}</option>
                    <option value="community_support">{es ? "Apoyo comunitario y donaciones" : "Community support & donations"}</option>
                    <option value="financial_activity">{es ? "Actividad financiera y donaciones" : "Financial activity & donations"}</option>
                    <option value="services_outcomes">{es ? "Servicios y resultados" : "Services & outcomes"}</option>
                    <option value="full_audit">{es ? "Auditoría completa institucional" : "Full institutional audit"}</option>
                  </select>
                </label>

                <label className="block font-semibold text-foreground">
                  {es ? "Periodo reportado" : "Reporting period"}
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  >
                    <option value="all_history">{es ? "Historial completo" : "All history"}</option>
                    <option value="this_month">{es ? "Este mes" : "This month"}</option>
                    <option value="last_month">{es ? "El mes pasado" : "Last month"}</option>
                    <option value="this_quarter">{es ? "Este trimestre" : "This quarter"}</option>
                    <option value="this_year">{es ? "Este año" : "This year"}</option>
                    <option value="custom">{es ? "Rango de fechas personalizado" : "Custom date range"}</option>
                  </select>
                </label>
              </div>

              {/* Custom Date Range Picker */}
              {period === "custom" && (
                <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-border bg-muted/20 p-3">
                  <label className="block font-semibold text-foreground">
                    {es ? "Fecha inicial" : "Start date"}
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                    />
                  </label>
                  <label className="block font-semibold text-foreground">
                    {es ? "Fecha final" : "End date"}
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                    />
                  </label>
                </div>
              )}

              {/* Language & Classification Grid */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block font-semibold text-foreground">
                  {es ? "Idioma del informe PDF" : "PDF Report language"}
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  >
                    <option value="es">{es ? "Español (México)" : "Spanish (Mexico)"}</option>
                    <option value="en">{es ? "Inglés (English)" : "English"}</option>
                  </select>
                </label>

                <label className="block font-semibold text-foreground">
                  {es ? "Clasificación de confidencialidad" : "Confidentiality classification"}
                  <select
                    value={classification}
                    onChange={(e) => setClassification(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  >
                    <option value="confidential">{es ? "Confidencial — Propiedad del Titular" : "Confidential — Subscriber Property"}</option>
                    <option value="internal">{es ? "Interno — No público" : "Internal — Non-public"}</option>
                    <option value="restricted">{es ? "Restringido — Acceso controlado" : "Restricted — Controlled access"}</option>
                    <option value="external_distribution">{es ? "Aprobado para distribución externa" : "Approved for external distribution"}</option>
                  </select>
                </label>
              </div>

              {/* Pre-flight Preview Card */}
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-xs">
                <h4 className="font-bold text-foreground text-xs flex items-center justify-between">
                  <span>{es ? "Vista Previa de Registros Incluidos" : "Records Included Preview"}</span>
                  {previewQuery.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                </h4>

                {p?.summary ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <span className="text-[10px] text-muted-foreground">{es ? "Casos cubiertos" : "Cases covered"}</span>
                      <p className="font-bold text-foreground text-sm">{p.summary.casesCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <span className="text-[10px] text-muted-foreground">{es ? "Intervenciones" : "Interventions"}</span>
                      <p className="font-bold text-foreground text-sm">{p.summary.interventionsCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <span className="text-[10px] text-muted-foreground">{es ? "Canalizaciones" : "Referrals"}</span>
                      <p className="font-bold text-foreground text-sm">{p.summary.referralsCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <span className="text-[10px] text-muted-foreground">{es ? "Tareas operativas" : "Tasks"}</span>
                      <p className="font-bold text-foreground text-sm">{p.summary.tasksCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <span className="text-[10px] text-muted-foreground">{es ? "Campañas apoyo" : "Campaigns"}</span>
                      <p className="font-bold text-foreground text-sm">{p.summary.campaignsCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <span className="text-[10px] text-muted-foreground">{es ? "Donaciones recibidas" : "Donations received"}</span>
                      <p className="font-bold text-foreground text-sm">{p.summary.goodsReceivedCount}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">{es ? "Calculando registros canónicos..." : "Calculating canonical records..."}</p>
                )}

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                  <p className="font-semibold text-primary mb-0.5">
                    {es ? "REGLA CANÓNICA: CERO INVENCIÓN" : "CANONICAL RULE: ZERO INVENTION"}
                  </p>
                  <p>
                    {es
                      ? "El informe se genera de forma 100% determinista a partir de los registros canónicos. Los campos sin datos aparecerán explícitamente como 'No registrado' sin fabricar información."
                      : "The report is 100% deterministically rendered from canonical database records. Unrecorded fields will explicitly state 'Not recorded'."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Generated PDF Success State */
            <div className="space-y-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h4 className="text-base font-bold text-foreground">
                {es ? "Informe de Auditoría Generado y Almacenado" : "Audit Report Generated & Stored"}
              </h4>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                {es
                  ? `Se ha creado una instantánea inmutable con folio ${generatedResult.reportId} y verificación SHA-256.`
                  : `An immutable snapshot was created with ID ${generatedResult.reportId} and SHA-256 verification.`}
              </p>

              <div className="rounded-xl border border-border bg-card p-3 font-mono text-[11px] text-muted-foreground space-y-1">
                <div>Folio: <b className="text-foreground">{generatedResult.reportId}</b></div>
                <div className="truncate">Checksum: <span className="text-foreground">{generatedResult.checksum}</span></div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 font-bold text-primary-foreground shadow-xs hover:bg-primary/90"
                >
                  <Download className="h-4 w-4" />
                  {es ? "Descargar PDF" : "Download PDF"}
                </button>
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 font-semibold text-foreground hover:bg-muted"
                >
                  <Printer className="h-4 w-4" />
                  {es ? "Imprimir" : "Print"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmailModal(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 font-semibold text-foreground hover:bg-muted"
                >
                  <Mail className="h-4 w-4" />
                  {es ? "Enviar por correo" : "Email PDF"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 p-4">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Lock className="h-3.5 w-3.5 text-primary" />
            {es ? "Rendición de cuentas auditable e inmutable." : "Immutable auditable accountability."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold hover:bg-muted"
            >
              {generatedResult ? (es ? "Terminar" : "Finish") : (es ? "Cancelar" : "Cancel")}
            </button>
            {!generatedResult && (
              <button
                type="button"
                disabled={generateM.isPending}
                onClick={() => generateM.mutate()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-xs disabled:opacity-50"
              >
                {generateM.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <FileText className="h-3.5 w-3.5" />
                {es ? "Generar PDF Institucional" : "Generate Institutional PDF"}
              </button>
            )}
          </div>
        </div>

        {/* Email Dialog */}
        {showEmailModal && generatedResult && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-foreground">
                    {es ? "Enviar Informe por Correo Electrónico" : "Email Audit Report"}
                  </h4>
                </div>
                <button type="button" onClick={() => setShowEmailModal(false)}>
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <label className="block font-semibold text-foreground">
                  {es ? "Correo del destinatario" : "Recipient email"}
                  <input
                    type="email"
                    required
                    value={emailForm.recipient}
                    onChange={(e) => setEmailForm({ ...emailForm, recipient: e.target.value })}
                    placeholder="auditor@organizacion.mx"
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  />
                </label>

                <label className="block font-semibold text-foreground">
                  {es ? "Asunto del correo" : "Email subject"}
                  <input
                    type="text"
                    value={emailForm.subject}
                    onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                    placeholder={es ? `Informe de Auditoría ${generatedResult.reportId}` : `Audit Report ${generatedResult.reportId}`}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="rounded-lg border border-border px-4 py-2 hover:bg-muted"
                >
                  {es ? "Cancelar" : "Cancel"}
                </button>
                <button
                  type="button"
                  disabled={sendEmailM.isPending || !emailForm.recipient}
                  onClick={() => sendEmailM.mutate()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-xs disabled:opacity-50"
                >
                  {sendEmailM.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <Send className="h-3.5 w-3.5" />
                  {es ? "Enviar" : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
