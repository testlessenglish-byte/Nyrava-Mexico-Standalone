// Transaction Center — the inmobiliario materia's native workspace tab.
// Deliberately matches the existing case workspace's visual language
// (Card/Badge/Progress primitives, same spacing/typography scale as
// ScorecardTab/WitnessesTab in cases.$caseId.tsx) rather than introducing a
// new visual identity — the goal stated throughout this build is that an
// attorney can't tell where the platform ends and this practice area
// begins, so this intentionally does not look like a separate product.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Clock, AlertTriangle, XCircle, Paperclip } from "lucide-react";
import { VerificationItemWorkspace } from "@/components/realestate/VerificationItemWorkspace";
import { CasePartiesPanel } from "@/components/casework/CasePartiesPanel";
import {
  getTransactionCenter,
  updateClosingMilestone,

  type VerificationCategory,
  type VerificationItem,
} from "@/lib/real-estate.functions";

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
      {msg}
    </div>
  );
}

const CATEGORY_LABELS: Record<VerificationCategory, { es: string; en: string }> = {
  ownership: { es: "Propiedad", en: "Ownership" },
  registry: { es: "Registro Público", en: "Registry" },
  catastro: { es: "Catastro", en: "Cadastre" },
  predial: { es: "Predial", en: "Property tax" },
  water: { es: "Agua", en: "Water" },
  cfe: { es: "CFE", en: "Electricity" },
  hoa: { es: "Administración (HOA)", en: "HOA" },
  mortgage: { es: "Hipoteca", en: "Mortgage" },
  permits: { es: "Permisos", en: "Permits" },
  corporate_authority: { es: "Facultades corporativas", en: "Corporate authority" },
  environmental: { es: "Ambiental", en: "Environmental" },
};

const STATUS_META: Record<
  VerificationItem["status"],
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  verified: { label: "Verificado", icon: CheckCircle2, className: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  pending: { label: "Pendiente", icon: Clock, className: "text-amber-600 bg-amber-50 border-amber-200" },
  missing: { label: "Faltante", icon: XCircle, className: "text-muted-foreground bg-muted border-border" },
  issue_found: { label: "Problema detectado", icon: AlertTriangle, className: "text-red-600 bg-red-50 border-red-200" },
};

const MODE_LABEL: Record<VerificationItem["verification_mode"], string> = {
  connected: "Conectado",
  document: "Documento",
  manual: "Manual",
};

const VERIFICATION_CATEGORIES = Object.keys(CATEGORY_LABELS) as VerificationCategory[];

export function TransactionCenterPanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const queryKey = ["transaction-center", caseId];
  const [openCategory, setOpenCategory] = useState<VerificationCategory | null>(null);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getTransactionCenter({ data: { caseId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const setMilestoneFn = useServerFn(updateClosingMilestone);
  const milestoneM = useMutation({
    mutationFn: (args: { milestoneKey: string; percentComplete: number }) =>
      setMilestoneFn({ data: { caseId, milestoneKey: args.milestoneKey, percentComplete: args.percentComplete } }),
    onSuccess: invalidate,
  });




  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!data) return <Empty msg="No se pudo cargar el Centro de Transacción." />;

  const byCategory = new Map(data.verification.map((v) => [v.category, v]));

  return (
    <div className="space-y-4">
      {/* Closing Readiness — always visible, not buried in the report */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Preparación para el Cierre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-3xl font-semibold tabular-nums">
              {data.readiness === null ? "—" : `${data.readiness}%`}
            </div>
            <Progress value={data.readiness ?? 0} className="h-2 flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.milestones.map((m) => (
              <div key={m.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{m.label_es}</span>
                  <span className="tabular-nums text-muted-foreground">{m.percent_complete}%</span>
                </div>
                <Progress value={m.percent_complete} className="h-1.5" />
                <div className="mt-2 flex gap-1">
                  {[0, 50, 100].map((pct) => (
                    <Button
                      key={pct}
                      size="sm"
                      variant={m.percent_complete === pct ? "default" : "outline"}
                      className="h-6 flex-1 px-1 text-xs"
                      disabled={milestoneM.isPending}
                      onClick={() => milestoneM.mutate({ milestoneKey: m.milestone_key, percentComplete: pct })}
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Property Intelligence */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Inteligencia de la Propiedad</CardTitle>
        </CardHeader>
        <CardContent>
          {data.property ? (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Dirección", data.property.address],
                ["Municipio", data.property.municipality],
                ["Estado", data.property.state],
                ["Folio Real", data.property.folio_real],
                ["Cuenta Predial", data.property.cuenta_predial],
                ["Catastro", data.property.catastro_id],
                ["Comprador", data.property.buyer_name],
                ["Vendedor", data.property.seller_name],
                ["Notario", data.property.notary],
                ["Fecha de Cierre", data.property.closing_date],
                ["Comprador Extranjero", data.property.foreign_buyer ? "Sí" : "No"],
                ["Fideicomiso", data.property.fideicomiso ? "Sí" : "No"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Empty msg="Aún no se han capturado los datos de la propiedad." />
          )}
        </CardContent>
      </Card>

      {/* Verification Center — every category, three-mode honest about how status was produced */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Centro de Verificación</CardTitle>
          <p className="text-xs text-muted-foreground">
            Abre cualquier requisito para subir el documento, anotarlo, consultar a Nyrava Intelligence
            o redactar la solicitud a quien lo expide.
          </p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {VERIFICATION_CATEGORIES.map((cat) => {
            const item = byCategory.get(cat);
            const status = item?.status ?? "pending";
            const meta = STATUS_META[status];
            const Icon = meta.icon;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setOpenCategory(cat)}
                className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <div>
                  <div className="text-sm font-medium">{CATEGORY_LABELS[cat].es}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{MODE_LABEL[item?.verification_mode ?? "manual"]}</span>
                    {item?.evidence_document_id && (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3 w-3" /> 1
                      </span>
                    )}
                    {item?.notes ? <span>· con notas</span> : null}
                  </div>
                </div>
                <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </Badge>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {openCategory && (
        <VerificationItemWorkspace
          caseId={caseId}
          category={openCategory}
          categoryLabel={CATEGORY_LABELS[openCategory].es}
          item={byCategory.get(openCategory)}
          open
          onOpenChange={(v) => !v && setOpenCategory(null)}
          onChanged={invalidate}
        />
      )}


      {/* Core Parties panel, second mount point (one component, no duplication). */}
      <Card>
        <CardContent className="pt-6">
          <CasePartiesPanel caseId={caseId} embedded />
        </CardContent>
      </Card>
    </div>
  );
}
