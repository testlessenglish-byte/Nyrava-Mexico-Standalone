import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, ExternalLink,
  Eye, Globe, Heart, HeartHandshake, Info, Loader2, Lock,
  Package, PauseCircle, PlayCircle, Plus, QrCode, Send, Share2,
  Shield, ShieldAlert, ShieldCheck, Sparkles, User, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { localizedEnum } from "@/lib/social/social-i18n";
import {
  approveAndPublishCommunityCampaign, createCommunitySupportRequest,
  getSocialCommunitySupportWorkspace, recordCommunitySupportReceived,
  saveSubscriberFundraisingProfile, updateCommunityCampaignStatus,
} from "@/lib/social.functions";

interface Props {
  caseId: string;
  orgId: string;
  es: boolean;
  onClose: () => void;
}

export function CommunitySupportModal({
  caseId,
  orgId,
  es,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const getWorkspaceFn = useServerFn(getSocialCommunitySupportWorkspace);
  const createRequestFn = useServerFn(createCommunitySupportRequest);
  const publishFn = useServerFn(approveAndPublishCommunityCampaign);
  const updateStatusFn = useServerFn(updateCommunityCampaignStatus);
  const saveProfileFn = useServerFn(saveSubscriberFundraisingProfile);
  const recordReceivedFn = useServerFn(recordCommunitySupportReceived);

  const [activeTab, setActiveTab] = useState<"case" | "org" | "profile">("case");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    scope: "individual_case" as "individual_case" | "organization_wide",
    title: "",
    publicDescription: "",
    internalNeedDetails: "",
    categories: ["food", "clothing"] as string[],
    urgency: "normal" as "low" | "normal" | "high" | "critical",
    identityMode: "anonymous" as "anonymous" | "first_name_only" | "family_description" | "full_name",
    displayName: "",
    location: "",
    fundraiserUrl: "",
    targetAmount: "" as string,
  });

  // Profile Form State
  const [profileForm, setProfileForm] = useState({
    legalName: "",
    accountType: "organization" as "individual" | "organization",
    rfc: "",
    state: "",
    adminName: "",
    email: "",
    phone: "",
    campaignUrl: "",
    donatariaClaimed: false,
  });

  const workspaceQuery = useQuery({
    queryKey: ["social-community-support", caseId],
    queryFn: async () => {
      const res = await getWorkspaceFn({ data: { caseId } });
      if (res.fundraisingProfile) {
        setProfileForm({
          legalName: res.fundraisingProfile.legal_name || "",
          accountType: res.fundraisingProfile.account_type || "organization",
          rfc: res.fundraisingProfile.rfc || "",
          state: res.fundraisingProfile.state || "",
          adminName: res.fundraisingProfile.responsible_admin_name || "",
          email: res.fundraisingProfile.contact_email || "",
          phone: res.fundraisingProfile.contact_phone || "",
          campaignUrl: res.fundraisingProfile.external_campaign_url || "",
          donatariaClaimed: res.fundraisingProfile.tax_deductible_status?.includes("donataria"),
        });
      }
      if (res.defaultDraft && !formData.title) {
        setFormData((prev) => ({
          ...prev,
          title: res.defaultDraft.title,
          publicDescription: res.defaultDraft.publicDescription,
          categories: res.defaultDraft.supportCategories,
          displayName: res.defaultDraft.publicDisplayName,
          location: res.defaultDraft.locationDisplay,
          urgency: res.defaultDraft.urgency,
        }));
      }
      return res;
    },
  });

  const createRequestM = useMutation({
    mutationFn: () => createRequestFn({
      data: {
        caseId: formData.scope === "individual_case" ? caseId : undefined,
        campaignScope: formData.scope,
        title: formData.title,
        publicDescription: formData.publicDescription,
        internalNeedDetails: formData.internalNeedDetails || undefined,
        supportCategories: formData.categories,
        urgency: formData.urgency,
        publicIdentityMode: formData.identityMode,
        publicDisplayName: formData.displayName || undefined,
        locationDisplay: formData.location || undefined,
        financialFundraiserUrl: formData.fundraiserUrl || undefined,
        financialTargetAmount: formData.targetAmount ? Number(formData.targetAmount) : undefined,
      }
    }),
    onSuccess: (res) => {
      toast.success(
        res.status === "published"
          ? (es ? "Campaña comunitaria publicada con éxito" : "Community campaign published successfully")
          : (es ? "Solicitud de apoyo enviada a revisión del titular" : "Support request submitted for subscriber review")
      );
      setShowCreateForm(false);
      void qc.invalidateQueries({ queryKey: ["social-community-support", caseId] });
      void qc.invalidateQueries({ queryKey: ["social-case", caseId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const publishM = useMutation({
    mutationFn: (campaignId: string) => publishFn({
      data: {
        campaignId,
        title: formData.title || workspaceQuery.data?.activeCampaign?.title,
        publicDescription: formData.publicDescription || workspaceQuery.data?.activeCampaign?.public_description,
        publicIdentityMode: formData.identityMode,
        publicDisplayName: formData.displayName || workspaceQuery.data?.activeCampaign?.public_display_name,
        locationDisplay: formData.location || workspaceQuery.data?.activeCampaign?.location_display,
        supportCategories: formData.categories.length ? formData.categories : workspaceQuery.data?.activeCampaign?.support_categories,
        urgency: formData.urgency,
        financialFundraiserUrl: formData.fundraiserUrl || workspaceQuery.data?.activeCampaign?.financial_fundraiser_url,
        financialTargetAmount: formData.targetAmount ? Number(formData.targetAmount) : workspaceQuery.data?.activeCampaign?.financial_target_amount,
      }
    }),
    onSuccess: () => {
      toast.success(es ? "Campaña aprobada y publicada" : "Campaign approved and published");
      setShowPreviewModal(false);
      void qc.invalidateQueries({ queryKey: ["social-community-support", caseId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatusM = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "close" | "reject" }) => updateStatusFn({
      data: { campaignId: id, action }
    }),
    onSuccess: () => {
      toast.success(es ? "Estado de la campaña actualizado" : "Campaign status updated");
      void qc.invalidateQueries({ queryKey: ["social-community-support", caseId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveProfileM = useMutation({
    mutationFn: () => saveProfileFn({
      data: {
        orgId,
        legalName: profileForm.legalName,
        accountType: profileForm.accountType,
        rfc: profileForm.rfc,
        state: profileForm.state,
        responsibleAdminName: profileForm.adminName,
        contactEmail: profileForm.email,
        contactPhone: profileForm.phone,
        externalCampaignUrl: profileForm.campaignUrl,
        donatariaClaimed: profileForm.donatariaClaimed,
      }
    }),
    onSuccess: () => {
      toast.success(es ? "Perfil de recaudación y RFC guardados" : "Fundraising & RFC profile saved");
      void qc.invalidateQueries({ queryKey: ["social-community-support", caseId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const recordReceivedM = useMutation({
    mutationFn: (offerId: string) => recordReceivedFn({
      data: { offerId, caseId }
    }),
    onSuccess: () => {
      toast.success(es ? "Apoyo recibido registrado e integrado al expediente" : "Support received recorded and integrated to case");
      void qc.invalidateQueries({ queryKey: ["social-community-support", caseId] });
      void qc.invalidateQueries({ queryKey: ["social-case", caseId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const data = workspaceQuery.data;
  const activeCampaign = data?.activeCampaign;
  const isSubscriber = data?.isSubscriber ?? false;
  const offers = data?.offers ?? [];

  const publicUrl = activeCampaign
    ? `${typeof window !== "undefined" ? window.location.origin : "https://mexico.nyrava.com"}/support/${activeCampaign.public_slug}`
    : "";

  const handleCopy = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopiedLink(true);
    toast.success(es ? "Enlace público copiado al portapapeles" : "Public link copied to clipboard");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleShare = (platform: "whatsapp" | "facebook" | "email") => {
    if (!activeCampaign) return;
    const title = encodeURIComponent(activeCampaign.title);
    const url = encodeURIComponent(publicUrl);
    const desc = encodeURIComponent(activeCampaign.public_description.slice(0, 160) + "...");

    if (platform === "whatsapp") {
      window.open(`https://api.whatsapp.com/send?text=${title}%20-%20${url}`, "_blank");
    } else if (platform === "facebook") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank");
    } else if (platform === "email") {
      window.open(`mailto:?subject=${title}&body=${desc}%0A%0A${url}`, "_blank");
    }
  };

  const allCategories = [
    { key: "financial_support", label_es: "Apoyo económico (GoFundMe)", label_en: "Financial support (GoFundMe)" },
    { key: "food", label_es: "Alimentos y despensa", label_en: "Food & groceries" },
    { key: "clothing", label_es: "Ropa y calzado", label_en: "Clothing & footwear" },
    { key: "housing", label_es: "Alojamiento y vivienda", label_en: "Housing & shelter" },
    { key: "school_supplies", label_es: "Útiles escolares", label_en: "School supplies" },
    { key: "medical_health", label_es: "Asistencia médica y salud", label_en: "Medical & health assistance" },
    { key: "transportation", label_es: "Transporte", label_en: "Transportation" },
    { key: "furniture_household", label_es: "Muebles y artículos del hogar", label_en: "Furniture & household items" },
    { key: "baby_supplies", label_es: "Artículos para bebé", label_en: "Baby supplies" },
    { key: "employment", label_es: "Asistencia para el empleo", label_en: "Employment assistance" },
    { key: "professional_services", label_es: "Servicios profesionales", label_en: "Professional services" },
    { key: "other_material", label_es: "Otro apoyo material", label_en: "Other material assistance" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-background/60 p-0 sm:p-4 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl sm:rounded-2xl sm:border">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <HeartHandshake className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  {es ? "Apoyo Comunitario y Recaudación" : "Community Support & Fundraising"}
                </h3>
                {isSubscriber ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                    {es ? "Titular / Administrador" : "Account Owner / Admin"}
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                    {es ? "Gestor de Caso (Solicitud)" : "Caseworker (Request Only)"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {es
                  ? "Gestión de apoyo social, donaciones materiales y recaudación externa autorizada."
                  : "Community assistance, material donations, and authorized external fundraising."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-border bg-muted/20 px-5 py-2 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("case")}
            className={`rounded-lg px-3 py-1.5 transition ${activeTab === "case" ? "bg-card text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"}`}
          >
            {es ? "Campaña de este caso" : "This Case Campaign"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("org")}
            className={`rounded-lg px-3 py-1.5 transition ${activeTab === "org" ? "bg-card text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"}`}
          >
            {es ? "Campañas institucionales" : "Organization Campaigns"} ({data?.orgCampaigns?.length || 0})
          </button>
          {isSubscriber && (
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`rounded-lg px-3 py-1.5 transition ${activeTab === "profile" ? "bg-card text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"}`}
            >
              {es ? "Perfil fiscal y GoFundMe" : "Fundraising & RFC Profile"}
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6 text-xs">
          {workspaceQuery.isLoading && (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="mt-2">{es ? "Cargando información de apoyo..." : "Loading support data..."}</p>
            </div>
          )}

          {activeTab === "case" && data && (
            <div className="space-y-6">
              {!activeCampaign && !showCreateForm ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                  <Heart className="mx-auto h-10 w-10 text-muted-foreground/60" />
                  <h4 className="mt-3 text-sm font-bold text-foreground">
                    {es ? "No hay campaña de apoyo activa para este caso" : "No active support campaign for this case"}
                  </h4>
                  <p className="mx-auto mt-1 max-w-md text-muted-foreground">
                    {isSubscriber
                      ? (es
                          ? "Como titular de la cuenta, puede crear y publicar una campaña pública protegida para este caso o para la organización."
                          : "As account owner, you can create and publish a protected public campaign for this case or organization.")
                      : (es
                          ? "Puede identificar una necesidad de apoyo comunitario y enviar la solicitud para revisión del titular."
                          : "You can identify a support need and submit a request for the account owner's review.")}
                  </p>

                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-xs"
                    >
                      <Plus className="h-4 w-4" />
                      {isSubscriber ? (es ? "Crear y Publicar Campaña" : "Create & Publish Campaign") : (es ? "Solicitar Apoyo Comunitario" : "Request Community Support")}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Active Campaign Card */}
              {activeCampaign && !showCreateForm && (
                <div className="space-y-5 rounded-2xl border border-border bg-background p-5 shadow-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                          activeCampaign.lifecycle_status === "published"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : activeCampaign.lifecycle_status === "pending_approval"
                            ? "bg-amber-500/15 text-amber-600"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {localizedEnum(activeCampaign.lifecycle_status, es)}
                        </span>
                        <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {localizedEnum(activeCampaign.urgency, es)}
                        </span>
                      </div>
                      <h4 className="mt-2 text-base font-bold text-foreground">
                        {activeCampaign.title}
                      </h4>
                      <p className="text-muted-foreground mt-0.5">
                        {activeCampaign.public_display_name || (es ? "Familia en Atención" : "Family in Care")} · {activeCampaign.location_display}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {activeCampaign.lifecycle_status === "published" && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowShareModal(true)}
                            className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-medium text-primary hover:bg-primary/20"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            {es ? "Compartir" : "Share"}
                          </button>
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {es ? "Ver página pública" : "View Public Page"}
                          </a>
                        </>
                      )}

                      {isSubscriber && activeCampaign.lifecycle_status === "pending_approval" && (
                        <button
                          type="button"
                          onClick={() => setShowPreviewModal(true)}
                          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {es ? "Revisar y Publicar" : "Review & Publish"}
                        </button>
                      )}

                      {isSubscriber && activeCampaign.lifecycle_status === "published" && (
                        <button
                          type="button"
                          onClick={() => updateStatusM.mutate({ id: activeCampaign.id, action: "pause" })}
                          className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-medium text-amber-600 hover:bg-amber-500/20"
                        >
                          <PauseCircle className="h-3.5 w-3.5" />
                          {es ? "Pausar" : "Pause"}
                        </button>
                      )}

                      {isSubscriber && activeCampaign.lifecycle_status === "paused" && (
                        <button
                          type="button"
                          onClick={() => updateStatusM.mutate({ id: activeCampaign.id, action: "resume" })}
                          className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-600 hover:bg-emerald-500/20"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          {es ? "Reanudar" : "Resume"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Public vs Internal Description */}
                  <div className="space-y-3">
                    <div>
                      <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wide">
                        {es ? "Descripción pública protegida (visible a donantes)" : "Protected public description (visible to donors)"}
                      </span>
                      <p className="mt-1 rounded-lg border border-border bg-card p-3 text-foreground leading-relaxed">
                        {activeCampaign.public_description}
                      </p>
                    </div>

                    {activeCampaign.internal_need_details && (
                      <div>
                        <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wide flex items-center gap-1">
                          <Lock className="h-3 w-3 text-amber-500" />
                          {es ? "Detalles internos del caso (no compartidos públicamente)" : "Internal case details (NOT shared publicly)"}
                        </span>
                        <p className="mt-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-muted-foreground">
                          {activeCampaign.internal_need_details}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Categories Pills */}
                  <div>
                    <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wide">
                      {es ? "Categorías de apoyo solicitadas" : "Requested support categories"}
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(activeCampaign.support_categories || []).map((cat: string) => (
                        <span key={cat} className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                          {localizedEnum(cat, es)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Financial Link Status */}
                  {activeCampaign.financial_fundraiser_url && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Globe className="h-5 w-5 text-emerald-600" />
                        <div>
                          <p className="font-bold text-foreground">
                            {es ? "Campaña de recaudación en GoFundMe activa" : "Active GoFundMe campaign linked"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate max-w-md">
                            {activeCampaign.financial_fundraiser_url}
                          </p>
                        </div>
                      </div>
                      <a
                        href={activeCampaign.financial_fundraiser_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
                      >
                        {es ? "Abrir GoFundMe" : "Open GoFundMe"}
                      </a>
                    </div>
                  )}

                  {/* Donor Offers & Pledges Inbox */}
                  <div className="border-t border-border pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="font-bold text-foreground flex items-center gap-1.5">
                        <Package className="h-4 w-4 text-primary" />
                        {es ? "Buzón de Donaciones y Asistencia Recibida" : "Donation & Support Offers Inbox"}
                      </h5>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono">
                        {offers.length} {es ? "ofertas" : "offers"}
                      </span>
                    </div>

                    {offers.length === 0 ? (
                      <p className="rounded-lg border border-border/60 bg-muted/10 p-3 text-center text-muted-foreground">
                        {es ? "Aún no se han recibido ofertas de donación para esta campaña." : "No donation offers received yet for this campaign."}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {offers.map((offer: any) => (
                          <div key={offer.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-foreground text-xs">
                                {offer.item_description} ({offer.quantity || "1"})
                              </span>
                              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                                offer.status === "received" ? "bg-emerald-500/15 text-emerald-600" : "bg-blue-500/15 text-blue-600"
                              }`}>
                                {offer.status === "received" ? (es ? "Entregado / Recibido" : "Received") : (es ? "Pendiente de entrega" : "Pending delivery")}
                              </span>
                            </div>

                            <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                              <div>{es ? "Donante" : "Donor"}: <b className="text-foreground">{offer.donor_name}</b></div>
                              <div>{es ? "Contacto" : "Contact"}: <b className="text-foreground">{offer.donor_email || offer.donor_phone || "—"}</b></div>
                              <div className="sm:col-span-2">{es ? "Método" : "Method"}: <b className="text-foreground">{localizedEnum(offer.delivery_method, es)}</b></div>
                              {offer.notes && <div className="sm:col-span-2 text-foreground/80 italic">"{offer.notes}"</div>}
                            </div>

                            {offer.status !== "received" && (
                              <div className="flex justify-end pt-1">
                                <button
                                  type="button"
                                  disabled={recordReceivedM.isPending}
                                  onClick={() => recordReceivedM.mutate(offer.id)}
                                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                >
                                  {recordReceivedM.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                  <Check className="h-3 w-3" />
                                  {es ? "Marcar como recibido e integrar al caso" : "Mark as received & log to case"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Create / Edit Form */}
              {showCreateForm && (
                <div className="space-y-4 rounded-2xl border border-primary/30 bg-card p-5">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      {isSubscriber ? (es ? "Configurar Campaña Comunitaria" : "Configure Community Campaign") : (es ? "Solicitar Apoyo para el Caso" : "Request Support for Case")}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {es ? "Cancelar" : "Cancel"}
                    </button>
                  </div>

                  <div className="space-y-3">
                    <label className="block font-semibold text-foreground">
                      {es ? "Título de la campaña" : "Campaign title"}
                      <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder={es ? "e.g. Apoyo para una familia en Mérida" : "e.g. Support for a family in Mérida"}
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                      />
                    </label>

                    <label className="block font-semibold text-foreground">
                      {es ? "Descripción pública protegida (visible a donantes)" : "Public-safe description (visible to donors)"}
                      <p className="text-[10px] text-muted-foreground font-normal">
                        {es ? "No incluya nombres completos, direcciones particulares ni datos legales sensibles." : "Do not include full names, private addresses, or sensitive legal notes."}
                      </p>
                      <textarea
                        rows={3}
                        value={formData.publicDescription}
                        onChange={(e) => setFormData({ ...formData, publicDescription: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                      />
                    </label>

                    <label className="block font-semibold text-foreground">
                      {es ? "Detalles internos del caso (no compartidos)" : "Internal case details (NOT shared)"}
                      <textarea
                        rows={2}
                        value={formData.internalNeedDetails}
                        onChange={(e) => setFormData({ ...formData, internalNeedDetails: e.target.value })}
                        placeholder={es ? "Detalles para revisión del supervisor..." : "Details for supervisor review..."}
                        className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                      />
                    </label>

                    <div className="space-y-1.5">
                      <span className="font-semibold text-foreground">
                        {es ? "Categorías de apoyo necesarias" : "Needed support categories"}
                      </span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {allCategories.map((c) => {
                          const checked = formData.categories.includes(c.key);
                          return (
                            <label key={c.key} className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) setFormData({ ...formData, categories: [...formData.categories, c.key] });
                                  else setFormData({ ...formData, categories: formData.categories.filter((x) => x !== c.key) });
                                }}
                                className="rounded"
                              />
                              {es ? c.label_es : c.label_en}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block font-semibold text-foreground">
                        {es ? "Urgencia" : "Urgency"}
                        <select
                          value={formData.urgency}
                          onChange={(e) => setFormData({ ...formData, urgency: e.target.value as any })}
                          className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                        >
                          <option value="low">{es ? "Baja" : "Low"}</option>
                          <option value="normal">{es ? "Normal" : "Normal"}</option>
                          <option value="high">{es ? "Alta" : "High"}</option>
                          <option value="critical">{es ? "Crítica" : "Critical"}</option>
                        </select>
                      </label>

                      <label className="block font-semibold text-foreground">
                        {es ? "Identidad pública" : "Public identity"}
                        <select
                          value={formData.identityMode}
                          onChange={(e) => setFormData({ ...formData, identityMode: e.target.value as any })}
                          className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                        >
                          <option value="anonymous">{es ? "Anónimo (Recomendado)" : "Anonymous (Recommended)"}</option>
                          <option value="family_description">{es ? "Descripción familiar" : "Family description"}</option>
                          <option value="first_name_only">{es ? "Solo primer nombre" : "First name only"}</option>
                          <option value="full_name">{es ? "Nombre completo" : "Full name"}</option>
                        </select>
                      </label>
                    </div>

                    {isSubscriber && (
                      <label className="block font-semibold text-foreground">
                        {es ? "Enlace de campaña GoFundMe (Opcional para donaciones económicas)" : "GoFundMe campaign URL (Optional for financial donations)"}
                        <input
                          type="url"
                          value={formData.fundraiserUrl}
                          onChange={(e) => setFormData({ ...formData, fundraiserUrl: e.target.value })}
                          placeholder="https://gofundme.com/f/ejemplo"
                          className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                        />
                      </label>
                    )}

                    <div className="flex justify-end gap-2 pt-3 border-t border-border">
                      <button
                        type="button"
                        onClick={() => setShowCreateForm(false)}
                        className="rounded-lg border border-border px-4 py-2 hover:bg-muted"
                      >
                        {es ? "Cancelar" : "Cancel"}
                      </button>
                      <button
                        type="button"
                        disabled={createRequestM.isPending || !formData.title || !formData.publicDescription}
                        onClick={() => createRequestM.mutate()}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-xs disabled:opacity-50"
                      >
                        {createRequestM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                        {isSubscriber ? (es ? "Crear y Publicar" : "Create & Publish") : (es ? "Enviar para Aprobación" : "Submit for Approval")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Org-wide campaigns tab */}
          {activeTab === "org" && data && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-foreground">
                    {es ? "Campañas Institucionales / Organización" : "Organization-Wide Campaigns"}
                  </h4>
                  <p className="text-muted-foreground text-[11px]">
                    {es
                      ? "Campañas generales no vinculadas a un caso individual específico."
                      : "General campaigns not tied to a single individual case."}
                  </p>
                </div>
                {isSubscriber && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, scope: "organization_wide" }));
                      setShowCreateForm(true);
                      setActiveTab("case");
                    }}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {es ? "Nueva campaña general" : "New general campaign"}
                  </button>
                )}
              </div>

              {data.orgCampaigns.length === 0 ? (
                <div className="rounded-xl border border-border bg-muted/20 p-8 text-center text-muted-foreground">
                  <Globe className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-2">{es ? "No hay campañas institucionales registradas." : "No organization-wide campaigns recorded."}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.orgCampaigns.map((c: any) => (
                    <div key={c.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h5 className="font-bold text-foreground text-sm">{c.title}</h5>
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                          {localizedEnum(c.lifecycle_status, es)}
                        </span>
                      </div>
                      <p className="text-muted-foreground line-clamp-2">{c.public_description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Profile & RFC Tab */}
          {activeTab === "profile" && isSubscriber && (
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <div>
                <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {es ? "Perfil Fiscal y Configuración de Recaudación" : "Fiscal Profile & Fundraising Configuration"}
                </h4>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  {es
                    ? "Configuración exclusiva del titular de la cuenta. El RFC valida la identidad institucional para recaudación externa."
                    : "Account owner only configuration. RFC validates institutional identity for external fundraising."}
                </p>
              </div>

              <div className="space-y-3">
                <label className="block font-semibold text-foreground">
                  {es ? "Razón Social o Nombre Legal" : "Legal entity name"}
                  <input
                    type="text"
                    value={profileForm.legalName}
                    onChange={(e) => setProfileForm({ ...profileForm, legalName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block font-semibold text-foreground">
                    {es ? "RFC de la Organización / Titular" : "RFC identifier"}
                    <input
                      type="text"
                      value={profileForm.rfc}
                      onChange={(e) => setProfileForm({ ...profileForm, rfc: e.target.value })}
                      placeholder="e.g. ABC120345XYZ"
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs font-mono uppercase"
                    />
                  </label>

                  <label className="block font-semibold text-foreground">
                    {es ? "Estado / Entidad Federativa" : "State"}
                    <input
                      type="text"
                      value={profileForm.state}
                      onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block font-semibold text-foreground">
                    {es ? "Administrador responsable" : "Responsible administrator"}
                    <input
                      type="text"
                      value={profileForm.adminName}
                      onChange={(e) => setProfileForm({ ...profileForm, adminName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                    />
                  </label>

                  <label className="block font-semibold text-foreground">
                    {es ? "Correo de contacto" : "Contact email"}
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                    />
                  </label>
                </div>

                <label className="block font-semibold text-foreground">
                  {es ? "Enlace de campaña GoFundMe institucional" : "Organization GoFundMe campaign URL"}
                  <input
                    type="url"
                    value={profileForm.campaignUrl}
                    onChange={(e) => setProfileForm({ ...profileForm, campaignUrl: e.target.value })}
                    placeholder="https://gofundme.com/f/organizacion-ejemplo"
                    className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs"
                  />
                </label>

                <label className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profileForm.donatariaClaimed}
                    onChange={(e) => setProfileForm({ ...profileForm, donatariaClaimed: e.target.checked })}
                    className="mt-0.5 rounded"
                  />
                  <div>
                    <span className="font-bold text-foreground">
                      {es ? "Contamos con autorización de Donataria Autorizada (SAT)" : "We hold Donataria Autorizada authorization (SAT)"}
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      {es
                        ? "Solo active esta casilla si su organización cuenta con oficio vigente publicado en el Anexo 14 del DOF. La etiqueta de donación deducible requiere verificación."
                        : "Only check this if your organization has active authorization published in DOF Annex 14. Tax-deductible badges require verification."}
                    </p>
                  </div>
                </label>

                <div className="flex justify-end pt-3 border-t border-border">
                  <button
                    type="button"
                    disabled={saveProfileM.isPending || !profileForm.legalName}
                    onClick={() => saveProfileM.mutate()}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-xs disabled:opacity-50"
                  >
                    {saveProfileM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {es ? "Guardar perfil fiscal" : "Save Fiscal Profile"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 p-4">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Lock className="h-3.5 w-3.5 text-primary" />
            {es ? "Privacidad del caso garantizada: los datos sensibles nunca son públicos." : "Case privacy guaranteed: sensitive data is never public."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted"
          >
            {es ? "Cerrar" : "Close"}
          </button>
        </div>

        {/* Share Dialog Modal */}
        {showShareModal && activeCampaign && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Share2 className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-foreground">
                    {es ? "Compartir Campaña Comunitaria" : "Share Community Campaign"}
                  </h4>
                </div>
                <button type="button" onClick={() => setShowShareModal(false)}>
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {es ? "Comparta el enlace público seguro para recibir apoyo y donaciones:" : "Share the secure public link to receive support and donations:"}
                </p>

                <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-2">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    className="flex-1 bg-transparent text-xs text-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                  >
                    {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedLink ? (es ? "Copiado" : "Copied") : (es ? "Copiar" : "Copy")}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleShare("whatsapp")}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20"
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShare("facebook")}
                    className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-center text-xs font-semibold text-blue-600 hover:bg-blue-500/20"
                  >
                    Facebook
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShare("email")}
                    className="rounded-xl border border-border bg-card p-3 text-center text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    {es ? "Correo" : "Email"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Public Preview Before Publish Modal */}
        {showPreviewModal && activeCampaign && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-foreground">
                    {es ? "Vista Previa Pública de Seguridad" : "Public Safety Preview"}
                  </h4>
                </div>
                <button type="button" onClick={() => setShowPreviewModal(false)}>
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
                  <p className="font-bold text-emerald-700">{es ? "INFORMACIÓN PÚBLICA PERMITIDA:" : "ALLOWED PUBLIC DATA:"}</p>
                  <p className="text-foreground"><b>{activeCampaign.title}</b></p>
                  <p className="text-muted-foreground">{activeCampaign.public_description}</p>
                </div>

                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                  <p className="font-bold text-destructive">{es ? "DATOS PROTEGIDOS NUNCA EXPUESTOS:" : "PROTECTED DATA NEVER EXPOSED:"}</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                    <li>{es ? "Número de expediente ni UUID de caso" : "Case number and internal UUID"}</li>
                    <li>{es ? "Dirección particular o ubicación de albergue" : "Residential address or shelter location"}</li>
                    <li>{es ? "Evaluación de riesgo y factores críticos" : "Risk assessment and critical factors"}</li>
                    <li>{es ? "Notas psicológicas y jurídicas" : "Psychosocial and legal notes"}</li>
                    <li>{es ? "Identidad de menores de edad" : "Minor children's identifying information"}</li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="rounded-lg border border-border px-4 py-2 hover:bg-muted"
                >
                  {es ? "Cancelar" : "Cancel"}
                </button>
                <button
                  type="button"
                  disabled={publishM.isPending}
                  onClick={() => publishM.mutate(activeCampaign.id)}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-xs"
                >
                  {publishM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {es ? "Aprobar y Publicar Campaña" : "Approve & Publish Campaign"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
