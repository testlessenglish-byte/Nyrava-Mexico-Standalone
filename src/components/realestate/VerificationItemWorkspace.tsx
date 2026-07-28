// Per-item verification workspace. Opened from the Centro de Verificación
// grid: an attorney can change the status, attach or replace the supporting
// instrument, annotate it, ask Nyrava Intelligence about that specific
// requirement, and draft the request letter to whoever holds the record —
// all without leaving the Transaction Center.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, Upload, Download, Link2, Sparkles, Send, FileText, Trash2, Save,
} from "lucide-react";
import {
  upsertVerificationItem,
  uploadVerificationDocument,
  listVerificationDocuments,
  type VerificationCategory,
  type VerificationItem,
} from "@/lib/real-estate.functions";
import { askCaseAi, getDocumentDownloadUrl } from "@/lib/cases.functions";
import { upsertCaseCommunication } from "@/lib/casework.functions";

type Status = VerificationItem["status"];

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: "pending", label: "Pendiente" },
  { value: "verified", label: "Verificado" },
  { value: "issue_found", label: "Problema detectado" },
  { value: "missing", label: "Faltante" },
];

/** What each requirement is, and who normally holds it — used for the AI
 *  prompt and the pre-drafted request letter. */
export const CATEGORY_GUIDE: Record<
  VerificationCategory,
  { doc: string; holder: string; channel: string }
> = {
  ownership: { doc: "escritura pública de propiedad y cadena de título", holder: "el notario público", channel: "notary" },
  registry: { doc: "certificado de libertad de gravamen y folio real", holder: "el Registro Público de la Propiedad", channel: "registry" },
  catastro: { doc: "cédula catastral y plano catastral", holder: "la oficina de Catastro municipal", channel: "authority" },
  predial: { doc: "constancia de no adeudo del impuesto predial", holder: "la Tesorería municipal", channel: "authority" },
  water: { doc: "constancia de no adeudo del servicio de agua", holder: "el organismo operador de agua", channel: "authority" },
  cfe: { doc: "último recibo y constancia de no adeudo de CFE", holder: "la Comisión Federal de Electricidad", channel: "authority" },
  hoa: { doc: "constancia de no adeudo de cuotas de mantenimiento y reglamento del condominio", holder: "la administración del condominio", channel: "other" },
  mortgage: { doc: "certificado de cancelación de hipoteca o saldo insoluto", holder: "la institución acreedora", channel: "lender" },
  permits: { doc: "licencias de construcción, uso de suelo y permisos municipales", holder: "la autoridad municipal de desarrollo urbano", channel: "authority" },
  corporate_authority: { doc: "poder notarial vigente y acta constitutiva del vendedor", holder: "el representante legal del vendedor", channel: "counterparty" },
  environmental: { doc: "manifestación de impacto ambiental y resolutivos de PROFEPA/SEMARNAT", holder: "la autoridad ambiental competente", channel: "authority" },
};

export function VerificationItemWorkspace({
  caseId,
  category,
  categoryLabel,
  item,
  open,
  onOpenChange,
  onChanged,
}: {
  caseId: string;
  category: VerificationCategory;
  categoryLabel: string;
  item: VerificationItem | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const guide = CATEGORY_GUIDE[category];

  const save = useServerFn(upsertVerificationItem);
  const uploadFn = useServerFn(uploadVerificationDocument);
  const listDocs = useServerFn(listVerificationDocuments);
  const askFn = useServerFn(askCaseAi);
  const downloadFn = useServerFn(getDocumentDownloadUrl);
  const commFn = useServerFn(upsertCaseCommunication);

  const [notes, setNotes] = useState(item?.notes ?? "");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [requestBody, setRequestBody] = useState(
    `Por medio del presente y en representación de mi cliente, solicito atentamente se expida ${guide.doc} respecto del inmueble objeto de la operación, a fin de integrar el expediente de due diligence y proceder al cierre.\n\nQuedo a sus órdenes para cualquier aclaración.`,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: docs } = useQuery({
    queryKey: ["verification-docs", caseId],
    queryFn: () => listDocs({ data: { caseId } }),
    enabled: open,
  });

  const attached = docs?.find((d) => d.id === item?.evidence_document_id) ?? null;

  const refresh = () => {
    onChanged();
    void qc.invalidateQueries({ queryKey: ["verification-docs", caseId] });
  };

  const mSave = useMutation({
    mutationFn: (patch: Partial<{ status: Status; notes: string | null; evidence_document_id: string | null }>) =>
      save({
        data: {
          caseId,
          category,
          status: patch.status ?? item?.status ?? "pending",
          verification_mode:
            patch.evidence_document_id !== undefined
              ? patch.evidence_document_id
                ? "document"
                : "manual"
              : (item?.verification_mode ?? "manual"),
          notes: patch.notes !== undefined ? patch.notes : (item?.notes ?? null),
          evidence_document_id:
            patch.evidence_document_id !== undefined
              ? patch.evidence_document_id
              : (item?.evidence_document_id ?? null),
        },
      }),
    onSuccess: () => {
      refresh();
      toast.success("Actualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mUpload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("caseId", caseId);
      fd.append("category", category);
      fd.append("file", file);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (uploadFn as any)({ data: fd });
    },
    onSuccess: () => {
      refresh();
      toast.success("Documento adjuntado — se está extrayendo su texto.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mAsk = useMutation({
    mutationFn: (q: string) => askFn({ data: { caseId, question: q } }),
    onSuccess: (res: { answer?: string }) => setAnswer(res?.answer ?? "—"),
    onError: (e: Error) => toast.error(e.message),
  });

  const mRequest = useMutation({
    mutationFn: () =>
      commFn({
        data: {
          caseId,
          channel: guide.channel,
          direction: "outbound" as const,
          subject: `Solicitud — ${categoryLabel}${recipient ? ` (${recipient})` : ""}`,
          body: requestBody.trim(),
          status: "pending_review" as const,
        },
      }),
    onSuccess: () => {
      toast.success("Solicitud registrada en Comunicaciones para su revisión.");
      void qc.invalidateQueries({ queryKey: ["case-communications", caseId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const askAbout = (prompt: string) => {
    setAnswer(null);
    mAsk.mutate(prompt);
  };

  const download = async () => {
    if (!attached) return;
    try {
      const { url } = await downloadFn({ data: { caseId, documentId: attached.id } });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{categoryLabel}</SheetTitle>
          <SheetDescription>
            Documento esperado: {guide.doc}. Normalmente lo expide {guide.holder}.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status */}
          <section className="space-y-2">
            <h4 className="text-sm font-medium">Estatus</h4>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => (
                <Button
                  key={s.value}
                  size="sm"
                  variant={(item?.status ?? "pending") === s.value ? "default" : "outline"}
                  disabled={mSave.isPending}
                  onClick={() => mSave.mutate({ status: s.value })}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </section>

          <Separator />

          {/* Document */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium">Documento de soporte</h4>
            {attached ? (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{attached.filename}</div>
                    <Badge variant="outline" className="mt-1 text-xs">{attached.status}</Badge>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={download}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mSave.isPending}
                    onClick={() => mSave.mutate({ evidence_document_id: null })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aún no hay un documento vinculado a este requisito.
              </p>
            )}

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) mUpload.mutate(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={mUpload.isPending} onClick={() => fileRef.current?.click()}>
                {mUpload.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                {attached ? "Reemplazar documento" : "Subir documento"}
              </Button>
            </div>

            {(docs?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="h-3 w-3" /> Vincular un documento ya cargado en el expediente
                </div>
                <select
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  value={item?.evidence_document_id ?? ""}
                  onChange={(e) =>
                    mSave.mutate({ evidence_document_id: e.target.value || null })
                  }
                >
                  <option value="">— Ninguno —</option>
                  {docs!.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          <Separator />

          {/* Notes */}
          <section className="space-y-2">
            <h4 className="text-sm font-medium">Notas y observaciones</h4>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones del abogado sobre este requisito, discrepancias detectadas, compromisos del vendedor…"
            />
            <Button size="sm" variant="outline" disabled={mSave.isPending} onClick={() => mSave.mutate({ notes })}>
              <Save className="mr-1 h-3.5 w-3.5" /> Guardar notas
            </Button>
          </section>

          <Separator />

          {/* AI assistance */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1 text-sm font-medium">
              <Sparkles className="h-4 w-4" /> Asistencia de Nyrava Intelligence
            </h4>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={mAsk.isPending}
                onClick={() =>
                  askAbout(
                    `Respecto del requisito "${categoryLabel}" en esta operación inmobiliaria: revisa los documentos del expediente y dime si ${guide.doc} ya obra en autos, qué falta, y qué riesgos jurídicos existen si se cierra sin ello. Cita los documentos.`,
                  )
                }
              >
                Revisar este requisito
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={mAsk.isPending}
                onClick={() =>
                  askAbout(
                    `Elabora la lista de pasos y requisitos para obtener ${guide.doc} ante ${guide.holder} conforme a la legislación mexicana aplicable a esta operación, incluyendo plazos estimados.`,
                  )
                }
              >
                ¿Cómo lo obtengo?
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Pregunta a Nyrava sobre este requisito…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && question.trim()) askAbout(`[${categoryLabel}] ${question.trim()}`);
                }}
              />
              <Button
                size="sm"
                disabled={mAsk.isPending || !question.trim()}
                onClick={() => askAbout(`[${categoryLabel}] ${question.trim()}`)}
              >
                {mAsk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            {mAsk.isPending && (
              <p className="text-xs text-muted-foreground">Analizando el expediente…</p>
            )}
            {answer && (
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">
                {answer}
              </div>
            )}
          </section>

          <Separator />

          {/* Request to a third party */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1 text-sm font-medium">
              <Send className="h-4 w-4" /> Solicitar el documento
            </h4>
            <p className="text-xs text-muted-foreground">
              Se registra en Comunicaciones del caso como salida pendiente de revisión y firma del abogado.
            </p>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={`Destinatario (p. ej. ${guide.holder})`}
            />
            <Textarea rows={5} value={requestBody} onChange={(e) => setRequestBody(e.target.value)} />
            <Button
              size="sm"
              disabled={mRequest.isPending || !requestBody.trim()}
              onClick={() => mRequest.mutate()}
            >
              {mRequest.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 h-3.5 w-3.5" />
              )}
              Registrar solicitud
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
