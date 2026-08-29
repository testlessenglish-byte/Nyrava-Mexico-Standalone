import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSubscriberDonationIdentity,
  saveSubscriberDonationIdentity,
  verifyConstanciaFallback,
} from "@/lib/account.functions";
import {
  ShieldCheck,
  Building2,
  User,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Lock,
  FileCheck,
  HelpCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  orgId: string;
  es?: boolean;
}

export function SubscriberDonationIdentitySection({ orgId, es = true }: Props) {
  const queryClient = useQueryClient();
  const getIdentityFn = useServerFn(getSubscriberDonationIdentity);
  const saveIdentityFn = useServerFn(saveSubscriberDonationIdentity);
  const verifyConstanciaFn = useServerFn(verifyConstanciaFallback);

  const [subscriberType, setSubscriberType] = useState<"individual" | "organization">("organization");
  const [legalName, setLegalName] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [rfc, setRfc] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [govIdType, setGovIdType] = useState<"ine" | "passport_mx" | "passport_foreign" | "residence_card_mx">("ine");
  const [govIdNumber, setGovIdNumber] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [directBankEnabled, setDirectBankEnabled] = useState(false);
  const [bankBeneficiaryName, setBankBeneficiaryName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankClabe, setBankClabe] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [showConstanciaModal, setShowConstanciaModal] = useState(false);
  const [constanciaRfc, setConstanciaRfc] = useState("");
  const [constanciaName, setConstanciaName] = useState("");
  const [constanciaCp, setConstanciaCp] = useState("");

  const identityQuery = useQuery({
    queryKey: ["subscriber-donation-identity", orgId],
    queryFn: () => getIdentityFn({ data: { orgId } }),
    enabled: Boolean(orgId),
  });

  useEffect(() => {
    if (identityQuery.data?.profile) {
      const p = identityQuery.data.profile;
      setSubscriberType(p.subscriberType || "organization");
      setLegalName(p.legalName || "");
      setRazonSocial(p.razonSocial || "");
      setRfc(p.rfc || "");
      setPostalCode(p.fiscalPostalCode || "");
      setGovIdType(p.governmentIdType || "ine");
      setExternalUrl(p.externalFundraisingUrl || "");
      setDirectBankEnabled(Boolean(p.directBankEnabled));
      setBankBeneficiaryName(p.bankBeneficiaryName || "");
      setBankName(p.bankName || "");
      setBankClabe(p.bankClabeMasked || "");
      setPrivacyAccepted(Boolean(p.privacyNoticeAcceptedAt));
    }
  }, [identityQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!privacyAccepted) {
        throw new Error(es ? "Debe aceptar el aviso de privacidad" : "You must accept the privacy notice");
      }
      return saveIdentityFn({
        data: {
          orgId,
          subscriberType,
          legalName: legalName.trim(),
          razonSocial: razonSocial.trim() || undefined,
          rfc: rfc.trim(),
          fiscalPostalCode: postalCode.trim(),
          governmentIdType: govIdType,
          governmentIdNumber: govIdNumber.trim() || undefined,
          externalFundraisingProvider: "gofundme",
          externalFundraisingUrl: externalUrl.trim() || undefined,
          directBankEnabled,
          bankBeneficiaryName: bankBeneficiaryName.trim() || undefined,
          bankName: bankName.trim() || undefined,
          bankClabe: bankClabe.trim() && !bankClabe.includes("•") ? bankClabe.trim() : undefined,
          privacyNoticeAccepted: true,
        },
      });
    },
    onSuccess: () => {
      toast.success(es ? "Identidad de donación guardada exitosamente" : "Donation identity saved successfully");
      queryClient.invalidateQueries({ queryKey: ["subscriber-donation-identity", orgId] });
      setGovIdNumber("");
    },
    onError: (err: any) => {
      toast.error(err.message || (es ? "Error al guardar información" : "Error saving donation info"));
    },
  });

  const constanciaMutation = useMutation({
    mutationFn: async () => {
      return verifyConstanciaFn({
        data: {
          orgId,
          constanciaRfc: constanciaRfc.trim(),
          constanciaLegalName: constanciaName.trim(),
          constanciaPostalCode: constanciaCp.trim(),
        },
      });
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(es ? "Constancia de Situación Fiscal validada con éxito" : "Tax status certificate verified successfully");
        setShowConstanciaModal(false);
        queryClient.invalidateQueries({ queryKey: ["subscriber-donation-identity", orgId] });
      } else {
        toast.error(res.message || (es ? "Discrepancia en validación" : "Verification mismatch"));
      }
    },
    onError: (err: any) => {
      toast.error(err.message || (es ? "Error validando constancia" : "Error validating certificate"));
    },
  });

  if (identityQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>{es ? "Cargando configuración de donaciones..." : "Loading donation setup..."}</span>
        </div>
      </div>
    );
  }

  if (identityQuery.error) {
    // If not primary subscriber (403), return null to keep hidden
    return null;
  }

  const profile = identityQuery.data?.profile;
  const isReady = profile?.financialDonationsReadiness === "verified_and_ready";

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-sm">
      {/* Header */}
      <div className="border-b border-border/60 bg-muted/20 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  {es ? "Información para Donaciones / Recaudación" : "Donation / Fundraising Information"}
                </h2>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  {es ? "Titular Principal" : "Primary Subscriber"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {es
                  ? "Configuración de identidad legal y destino financiero para Apoyo Comunitario y Donaciones."
                  : "Legal identity setup and financial destination for Community Support and Donations."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isReady ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {es ? "Verificado y Listo" : "Verified & Ready"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {es ? "Verificación Requerida" : "Verification Required"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* Zero credential guarantee alert */}
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <span className="font-semibold text-foreground">
              {es ? "Seguridad y Protección de Identidad:" : "Identity & Security Protection:"}
            </span>{" "}
            {es
              ? "Nyrava México nunca solicita ni almacena contraseñas bancarias, PINs, tokens o claves e.firma. Los fondos son canalizados directamente a través de recaudadores externos o transferencias directas sin custodia intermedia."
              : "Nyrava Mexico never requests or stores bank passwords, PINs, tokens, or e.firma keys. Funds are directed to external providers or direct accounts without intermediary custody."}
          </div>
        </div>

        {/* Form Grid */}
        <div className="grid gap-5 sm:grid-cols-2">
          {/* Subscriber Type */}
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-foreground">
              {es ? "Tipo de Titular" : "Subscriber Type"}
            </label>
            <div className="mt-2 flex gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="subType"
                  value="organization"
                  checked={subscriberType === "organization"}
                  onChange={() => setSubscriberType("organization")}
                  className="text-primary focus:ring-primary"
                />
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {es ? "Organización / Razón Social (Persona Moral)" : "Organization / Legal Entity"}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="subType"
                  value="individual"
                  checked={subscriberType === "individual"}
                  onChange={() => setSubscriberType("individual")}
                  className="text-primary focus:ring-primary"
                />
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {es ? "Individual (Persona Física)" : "Individual (Natural Person)"}
              </label>
            </div>
          </div>

          {/* Legal Name */}
          <div>
            <label className="text-xs font-medium text-foreground">
              {es ? "Nombre Legal del Titular *" : "Legal Name *"}
            </label>
            <input
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Ej. Juan Pérez López"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Razón Social */}
          <div>
            <label className="text-xs font-medium text-foreground">
              {es ? "Razón Social (Si aplica)" : "Organization Legal Name (If applicable)"}
            </label>
            <input
              type="text"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder="Ej. Fundación Apoyo Comunitario A.C."
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* RFC */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                {es ? "RFC con Homoclave *" : "Tax ID (RFC) *"}
              </label>
              {profile?.rfcVerificationStatus === "verified" ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {es ? "RFC Verificado" : "RFC Verified"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConstanciaModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <FileCheck className="h-3 w-3" />
                  {es ? "Validar con Constancia" : "Validate with Tax Certificate"}
                </button>
              )}
            </div>
            <input
              type="text"
              value={rfc}
              onChange={(e) => setRfc(e.target.value)}
              placeholder="Ej. XAXX010101000"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono uppercase text-foreground focus:border-primary focus:outline-none"
            />
            {profile?.rfcVerificationMethod && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {profile.rfcVerificationMethod}
              </p>
            )}
          </div>

          {/* Fiscal Postal Code */}
          <div>
            <label className="text-xs font-medium text-foreground">
              {es ? "Código Postal Fiscal (5 dígitos) *" : "Fiscal Postal Code (5 digits) *"}
            </label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="Ej. 06600"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Government ID Section */}
          <div className="rounded-lg border border-border/70 bg-muted/10 p-4 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <FileCheck className="h-4 w-4 text-primary" />
                {es ? "Verificación de Identidad Oficial" : "Official Government ID Verification"}
              </div>
              {profile?.idVerificationStatus === "verified" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {profile.governmentIdMasked || (es ? "Identificación Verificada" : "ID Verified")}
                </span>
              ) : (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  {es ? "Pendiente de verificación oficial" : "Official verification pending"}
                </span>
              )}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  {es ? "Tipo de Documento Oficial" : "Government ID Type"}
                </label>
                <select
                  value={govIdType}
                  onChange={(e: any) => setGovIdType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="ine">INE / Credencial para Votar (México)</option>
                  <option value="passport_mx">Pasaporte Mexicano</option>
                  <option value="passport_foreign">Pasaporte Extranjero</option>
                  <option value="residence_card_mx">Tarjeta de Residencia (INM)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  {es ? "Número o Folio de Identificación" : "ID Number / Identifier"}
                </label>
                <input
                  type="text"
                  value={govIdNumber}
                  onChange={(e) => setGovIdNumber(e.target.value)}
                  placeholder={profile?.governmentIdMasked ? es ? "(Oculto) Ingrese nuevo para cambiar" : "(Masked) Enter new to replace" : "Ej. ID / Clave de Elector"}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Financial Destination: External GoFundMe */}
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-foreground">
              {es ? "Enlace de Recaudación Externa (Recomendado: GoFundMe)" : "External Fundraiser URL (Recommended: GoFundMe)"}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://www.gofundme.com/f/mi-campana-solidaria"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
              />
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:bg-muted"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {es
                ? "Los donantes serán dirigidos a esta plataforma autorizada para realizar aportaciones con seguridad."
                : "Donors will be directed to this authorized platform to contribute securely."}
            </p>
          </div>

          {/* Direct Bank Option Toggle */}
          <div className="rounded-lg border border-border/70 bg-muted/10 p-4 sm:col-span-2">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-foreground">
                  {es ? "Transferencias Bancarias Directas (Opcional)" : "Direct Bank Transfers (Optional)"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {es
                    ? "Permite mostrar cuenta CLABE interbancaria exclusivamente a nombre del titular o institución verificada."
                    : "Allows showing interbank CLABE account exclusively in the verified name of the subscriber or institution."}
                </div>
              </div>
              <input
                type="checkbox"
                checked={directBankEnabled}
                onChange={(e) => setDirectBankEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
            </label>

            {directBankEnabled && (
              <div className="mt-4 grid gap-3 border-t border-border/50 pt-3 sm:grid-cols-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {es ? "Nombre del Beneficiario *" : "Beneficiary Name *"}
                  </label>
                  <input
                    type="text"
                    value={bankBeneficiaryName}
                    onChange={(e) => setBankBeneficiaryName(e.target.value)}
                    placeholder="Ej. Fundación Nyrava A.C."
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {es ? "Institución Bancaria" : "Bank Name"}
                  </label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Ej. BBVA México / Santander"
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {es ? "CLABE Interbancaria (18 dígitos) *" : "CLABE (18 digits) *"}
                  </label>
                  <input
                    type="text"
                    value={bankClabe}
                    onChange={(e) => setBankClabe(e.target.value)}
                    placeholder={profile?.bankClabeMasked ? profile.bankClabeMasked : "012180001234567890"}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Privacy Notice & Consent */}
        <div className="rounded-lg border border-border/80 bg-background/50 p-4 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            <span>
              {es ? (
                <>
                  He leído y acepto el{" "}
                  <span className="font-semibold text-foreground">
                    Aviso de Privacidad de Nyrava México para Apoyo Comunitario y Recaudación (v2026.1 ARCO)
                  </span>
                  . Reconozco que los datos de identidad serán utilizados únicamente para verificar al titular y posibilitar la recepción de donaciones conforme a la legislación mexicana.
                </>
              ) : (
                <>
                  I have read and accept the{" "}
                  <span className="font-semibold text-foreground">
                    Nyrava Mexico Privacy Notice for Community Support & Fundraising (v2026.1 ARCO)
                  </span>
                  . I acknowledge identity data is used solely to verify the subscriber and enable donations pursuant to Mexican law.
                </>
              )}
            </span>
          </label>
        </div>

        {/* Submit action */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={saveMutation.isPending || !privacyAccepted}
            onClick={() => saveMutation.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {es ? "Guardar Configuración de Donaciones" : "Save Donation Setup"}
          </button>
        </div>
      </div>

      {/* Constancia Verification Modal */}
      {showConstanciaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileCheck className="h-5 w-5 text-primary" />
              {es ? "Validar Constancia de Situación Fiscal" : "Validate Tax Status Certificate"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {es
                ? "Ingrese los datos exactos que constan en su Constancia emitida por el SAT para validar su identidad fiscal."
                : "Enter the exact values shown on your SAT-issued Tax Status Certificate to validate tax identity."}
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-foreground">{es ? "RFC en Constancia" : "RFC on Certificate"}</label>
                <input
                  type="text"
                  value={constanciaRfc}
                  onChange={(e) => setConstanciaRfc(e.target.value)}
                  placeholder="XAXX010101000"
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-mono uppercase text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-foreground">{es ? "Nombre o Razón Social en Constancia" : "Legal Name on Certificate"}</label>
                <input
                  type="text"
                  value={constanciaName}
                  onChange={(e) => setConstanciaName(e.target.value)}
                  placeholder="Ej. Fundación Nyrava A.C."
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-foreground">{es ? "Código Postal en Constancia" : "Postal Code on Certificate"}</label>
                <input
                  type="text"
                  value={constanciaCp}
                  onChange={(e) => setConstanciaCp(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="06600"
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConstanciaModal(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                {es ? "Cancelar" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={constanciaMutation.isPending || !constanciaRfc || !constanciaName || !constanciaCp}
                onClick={() => constanciaMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {constanciaMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {es ? "Validar y Cotejar" : "Validate & Match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
