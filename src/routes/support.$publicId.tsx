import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2, DollarSign, ExternalLink, Globe, Heart, HeartHandshake,
  Info, Loader2, Lock, Package, Send, ShieldCheck, Sparkles, User,
} from "lucide-react";
import { toast } from "sonner";
import { localizedEnum } from "@/lib/social/social-i18n";
import {
  getPublicCommunitySupportCampaign,
  submitPublicCommunitySupportOffer,
} from "@/lib/social.functions";

export const Route = createFileRoute("/support/$publicId")({
  head: () => ({
    meta: [
      { title: "Apoyo Comunitario Solidario · Nyrava México" },
      { name: "description", content: "Campaña de asistencia comunitaria y apoyo solidario verificado en Nyrava México." },
      { property: "og:title", content: "Campaña de Apoyo Comunitario · Nyrava México" },
      { property: "og:description", content: "Aportaciones en especie, servicios y ayuda solidaria para familias y personas en situación prioritaria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicSupportPage,
});

function PublicSupportPage() {
  const { publicId } = Route.useParams();
  const [es, setEs] = useState(true);
  const [activeForm, setActiveForm] = useState<"goods" | "service" | null>(null);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  const getPublicFn = useServerFn(getPublicCommunitySupportCampaign);
  const submitOfferFn = useServerFn(submitPublicCommunitySupportOffer);

  const campaignQuery = useQuery({
    queryKey: ["public-support-campaign", publicId],
    queryFn: () => getPublicFn({ data: { publicSlug: publicId } }),
  });

  const [form, setForm] = useState({
    itemDescription: "",
    quantity: "",
    donorName: "",
    donorEmail: "",
    donorPhone: "",
    deliveryMethod: "dropoff_organization" as any,
    notes: "",
  });

  const submitOfferM = useMutation({
    mutationFn: () => submitOfferFn({
      data: {
        publicSlug: publicId,
        offerType: activeForm === "goods" ? "goods" : "service",
        categories: campaignQuery.data?.categories || [],
        itemDescription: form.itemDescription,
        quantity: form.quantity || undefined,
        donorName: form.donorName,
        donorEmail: form.donorEmail || undefined,
        donorPhone: form.donorPhone || undefined,
        deliveryMethod: form.deliveryMethod,
        notes: form.notes || undefined,
      }
    }),
    onSuccess: () => {
      setSubmittedSuccess(true);
      toast.success(es ? "¡Gracias! Su oferta de apoyo ha sido registrada." : "Thank you! Your support offer has been received.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const campaign = campaignQuery.data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/20 to-background text-foreground antialiased selection:bg-primary/20">
      {/* Top Navigation Header */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-md sticky top-0 z-20">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold shadow-xs">
              <HeartHandshake className="h-4 w-4" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-sm text-foreground">NYRAVA</span>
              <span className="ml-1 text-[11px] font-semibold text-primary uppercase">
                {es ? "Apoyo Comunitario" : "Community Support"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEs(!es)}
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted"
            >
              {es ? "English" : "Español"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Campaign Container */}
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 space-y-8">
        {campaignQuery.isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm">{es ? "Cargando campaña de apoyo..." : "Loading support campaign..."}</p>
          </div>
        )}

        {campaignQuery.isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
            <Info className="mx-auto h-10 w-10 text-destructive" />
            <h2 className="mt-3 text-lg font-bold text-foreground">
              {es ? "Campaña no disponible" : "Campaign unavailable"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {es
                ? "Esta campaña de apoyo no existe o ha sido cerrada por la organización."
                : "This support campaign does not exist or has been closed by the organizing entity."}
            </p>
          </div>
        )}

        {campaign && (
          <div className="space-y-6">
            {/* Organizing Entity Badge */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {es ? "Organizado por:" : "Organized by:"}
                </p>
                <h3 className="text-base font-bold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {campaign.organizationName}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {campaign.locationDisplay}
                </span>
                {campaign.taxDeductibleStatus === "donataria_autorizada_verified" && (
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600">
                    {es ? "Donataria Autorizada (Deducible)" : "Tax-Deductible Authorized"}
                  </span>
                )}
              </div>
            </div>

            {/* Campaign Headline & Public Story */}
            <div className="space-y-4 rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-rose-500/15 px-2.5 py-0.5 text-xs font-bold text-rose-600 uppercase">
                  {es ? "Solicitud de Apoyo" : "Support Request"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(campaign.publishedAt).toLocaleDateString()}
                </span>
              </div>

              <h1 className="text-2xl font-extrabold text-foreground sm:text-3xl">
                {campaign.title}
              </h1>

              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                {campaign.publicDescription}
              </p>

              {/* Categories Needed */}
              <div className="border-t border-border pt-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {es ? "Apoyo y artículos requeridos:" : "Help & items needed:"}
                </h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {campaign.categories.map((cat: string) => (
                    <span key={cat} className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
                      {localizedEnum(cat, es)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Cards: Donate Money / Donate Goods / Offer Services */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Financial Support Card */}
              {campaign.financialFundraiserUrl ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 flex flex-col justify-between space-y-3 sm:col-span-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="flex items-center gap-1.5 font-bold text-emerald-700 text-sm">
                        <DollarSign className="h-4 w-4" />
                        {es ? "Apoyo Económico Directo (GoFundMe)" : "Direct Financial Support (GoFundMe)"}
                      </span>
                      <p className="text-xs text-muted-foreground mt-1">
                        {es
                          ? "Las aportaciones económicas se procesan de forma segura a través de la campaña oficial en GoFundMe."
                          : "Financial donations are securely processed through the official GoFundMe campaign."}
                      </p>
                    </div>
                  </div>

                  <a
                    href={campaign.financialFundraiserUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-xs hover:bg-emerald-700 transition"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {es ? "Donar en GoFundMe" : "Donate on GoFundMe"}
                  </a>
                </div>
              ) : null}

              {/* Goods Donation Card */}
              <div className="rounded-2xl border border-border bg-card p-5 flex flex-col justify-between space-y-3">
                <div>
                  <Package className="h-6 w-6 text-primary mb-2" />
                  <h4 className="font-bold text-foreground text-sm">
                    {es ? "Donar Alimentos o Artículos" : "Donate Food or Supplies"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {es
                      ? "Despensa, ropa, calzado, muebles, artículos escolares o para bebé."
                      : "Groceries, clothing, footwear, furniture, school or baby supplies."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveForm("goods");
                    setSubmittedSuccess(false);
                  }}
                  className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/20 transition"
                >
                  {es ? "Puedo donar artículos →" : "I can donate supplies →"}
                </button>
              </div>

              {/* Professional Services Card */}
              <div className="rounded-2xl border border-border bg-card p-5 flex flex-col justify-between space-y-3">
                <div>
                  <Sparkles className="h-6 w-6 text-violet-500 mb-2" />
                  <h4 className="font-bold text-foreground text-sm">
                    {es ? "Ofrecer Servicios o Asistencia" : "Offer Assistance or Services"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {es
                      ? "Asistencia legal, psicológica, transporte, mudanza, médica o empleo."
                      : "Legal, psychological, transport, moving, medical, or job assistance."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveForm("service");
                    setSubmittedSuccess(false);
                  }}
                  className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-xs font-bold text-violet-600 hover:bg-violet-500/20 transition"
                >
                  {es ? "Ofrecer asistencia →" : "Offer assistance →"}
                </button>
              </div>
            </div>

            {/* Donor Offer Submission Form */}
            {activeForm && (
              <div className="rounded-3xl border border-primary/40 bg-card p-6 sm:p-8 shadow-md space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-300">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    {activeForm === "goods" ? <Package className="h-5 w-5 text-primary" /> : <Sparkles className="h-5 w-5 text-violet-500" />}
                    {activeForm === "goods"
                      ? (es ? "Formulario de Donación Material" : "Supply Donation Form")
                      : (es ? "Formulario de Asistencia / Servicios" : "Assistance / Service Offer Form")}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveForm(null)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {es ? "Cerrar" : "Close"}
                  </button>
                </div>

                {submittedSuccess ? (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-2">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
                    <h4 className="text-base font-bold text-foreground">
                      {es ? "¡Muchas gracias por su apoyo!" : "Thank you very much for your support!"}
                    </h4>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                      {es
                        ? "La organización ha recibido sus datos y se comunicará con usted para coordinar la entrega de forma segura."
                        : "The organizing entity has received your details and will reach out to safely coordinate delivery."}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveForm(null);
                        setSubmittedSuccess(false);
                      }}
                      className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                    >
                      {es ? "Volver a la campaña" : "Return to campaign"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4 text-xs">
                    <label className="block font-semibold text-foreground">
                      {activeForm === "goods"
                        ? (es ? "¿Qué artículo(s) puede donar?" : "What item(s) can you donate?")
                        : (es ? "¿Qué tipo de asistencia o servicio ofrece?" : "What assistance or service are you offering?")}
                      <input
                        type="text"
                        required
                        value={form.itemDescription}
                        onChange={(e) => setForm({ ...form, itemDescription: e.target.value })}
                        placeholder={activeForm === "goods" ? (es ? "e.g. 2 paquetes de despensa básica, ropa de niño talla 6" : "e.g. 2 food packages, children clothes size 6") : (es ? "e.g. Asesoría jurídica gratuita, transporte en vehículo" : "e.g. Pro-bono legal consultation, vehicle transport")}
                        className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                      />
                    </label>

                    {activeForm === "goods" && (
                      <label className="block font-semibold text-foreground">
                        {es ? "Cantidad estimada" : "Estimated quantity"}
                        <input
                          type="text"
                          value={form.quantity}
                          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                          placeholder="e.g. 2 cajas / 5 piezas"
                          className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                        />
                      </label>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block font-semibold text-foreground">
                        {es ? "Su nombre" : "Your name"}
                        <input
                          type="text"
                          required
                          value={form.donorName}
                          onChange={(e) => setForm({ ...form, donorName: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                        />
                      </label>

                      <label className="block font-semibold text-foreground">
                        {es ? "Correo electrónico" : "Email address"}
                        <input
                          type="email"
                          value={form.donorEmail}
                          onChange={(e) => setForm({ ...form, donorEmail: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block font-semibold text-foreground">
                        {es ? "Teléfono o WhatsApp" : "Phone or WhatsApp"}
                        <input
                          type="tel"
                          value={form.donorPhone}
                          onChange={(e) => setForm({ ...form, donorPhone: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                        />
                      </label>

                      <label className="block font-semibold text-foreground">
                        {es ? "Método preferido de entrega" : "Preferred delivery method"}
                        <select
                          value={form.deliveryMethod}
                          onChange={(e) => setForm({ ...form, deliveryMethod: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                        >
                          <option value="dropoff_organization">{es ? "Entregar en la sede de la organización" : "Drop off at organization"}</option>
                          <option value="collection_point">{es ? "Punto de recolección autorizado" : "Approved collection point"}</option>
                          <option value="arrange_pickup">{es ? "Coordinar recolección a domicilio" : "Arrange pickup"}</option>
                          <option value="contact_to_coordinate">{es ? "Contactarme para coordinar" : "Contact me to coordinate"}</option>
                        </select>
                      </label>
                    </div>

                    <label className="block font-semibold text-foreground">
                      {es ? "Notas adicionales u horarios de disponibilidad" : "Additional notes or availability"}
                      <textarea
                        rows={2}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground"
                      />
                    </label>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setActiveForm(null)}
                        className="rounded-xl border border-border px-4 py-2 hover:bg-muted"
                      >
                        {es ? "Cancelar" : "Cancel"}
                      </button>
                      <button
                        type="button"
                        disabled={submitOfferM.isPending || !form.itemDescription || !form.donorName}
                        onClick={() => submitOfferM.mutate()}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 font-bold text-primary-foreground shadow-xs disabled:opacity-50"
                      >
                        {submitOfferM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                        <Send className="h-4 w-4" />
                        {es ? "Enviar oferta de apoyo" : "Submit support offer"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-muted/20 py-8 text-center text-xs text-muted-foreground mt-12">
        <div className="mx-auto max-w-3xl px-4 space-y-2">
          <p className="flex items-center justify-center gap-1.5 font-semibold">
            <Lock className="h-3.5 w-3.5 text-primary" />
            {es ? "Protección de privacidad garantizada por Nyrava." : "Privacy protection guaranteed by Nyrava."}
          </p>
          <p className="text-[11px]">
            {es
              ? "Las solicitudes de apoyo comunitario son gestionadas y validadas por organizaciones acreditadas. Los datos personales sensibles permanecen estrictamente confidenciales."
              : "Community support requests are managed and verified by authorized entities. Sensitive personal data remains strictly confidential."}
          </p>
        </div>
      </footer>
    </div>
  );
}
