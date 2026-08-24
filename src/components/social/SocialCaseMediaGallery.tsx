import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, ChevronLeft, ChevronRight, FileText, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { getSocialCaseMediaGallery, setSocialDocumentAiAccess } from "@/lib/social.functions";

type Props={caseId:string;documents:any[]};

export function SocialCaseMediaGallery({caseId,documents}:Props){
  const {locale}=useI18n();const es=locale==="es";const qc=useQueryClient();
  const galleryFn=useServerFn(getSocialCaseMediaGallery);
  const aiFn=useServerFn(setSocialDocumentAiAccess);
  const [index,setIndex]=useState(0);
  const gallery=useQuery({
    queryKey:["social-case-media",caseId],
    queryFn:()=>galleryFn({data:{caseId}}),
    staleTime:4*60*1000,
    retry:1,
  });
  const media=(gallery.data??[]) as any[];
  useEffect(()=>{if(index>=media.length)setIndex(Math.max(0,media.length-1));},[index,media.length]);
  const active=media[index];
  const ai=useMutation({
    mutationFn:(allowed:boolean)=>aiFn({data:{documentId:active.id,allowed}}),
    onSuccess:async(result)=>{
      toast.success(es?(result.allowed?"Disponible para IA del caso":"Acceso de IA retirado"):(result.allowed?"Available to case AI":"Case AI access removed"));
      await Promise.all([
        qc.invalidateQueries({queryKey:["social-case-media",caseId]}),
        qc.invalidateQueries({queryKey:["social-case",caseId]}),
      ]);
    },
    onError:(error:any)=>toast.error(error?.message??(es?"No se pudo actualizar el acceso":"Access could not be updated")),
  });
  const previous=()=>setIndex(value=>(value-1+media.length)%media.length);
  const next=()=>setIndex(value=>(value+1)%media.length);

  return <section className="space-y-4 rounded-xl border border-border bg-card p-4">
    <div>
      <h3 className="font-semibold">{es?"Visor multimedia del caso":"Case media viewer"}</h3>
      <p className="text-xs text-muted-foreground">{es?"Solo el responsable asignado y la dirección autorizada pueden ver estos archivos.":"Only the assigned worker and authorized managing partner can view these files."}</p>
    </div>
    {gallery.isLoading&&<div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>{es?"Preparando vista segura…":"Preparing secure preview…"}</div>}
    {gallery.isError&&<div role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><ShieldAlert className="mr-2 inline h-4 w-4"/>{gallery.error instanceof Error?gallery.error.message:(es?"No se pudo abrir el visor":"The viewer could not be opened")}</div>}
    {!gallery.isLoading&&!gallery.isError&&!media.length&&<div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">{es?"Suba una imagen, video o audio para verlo aquí.":"Upload an image, video, or audio file to view it here."}</div>}
    {active&&<div className="space-y-3">
      <div className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-xl bg-black">
        {active.mime_type?.startsWith("image/")&&<img src={active.signedUrl} alt={active.title} className="max-h-[32rem] w-full object-contain"/>}
        {active.mime_type?.startsWith("video/")&&<video key={active.signedUrl} src={active.signedUrl} controls preload="metadata" className="max-h-[32rem] w-full"/>}
        {active.mime_type?.startsWith("audio/")&&<audio key={active.signedUrl} src={active.signedUrl} controls preload="metadata" className="mx-10 w-full"/>}
        {media.length>1&&<><button type="button" aria-label={es?"Anterior":"Previous"} onClick={previous} className="absolute left-2 rounded-full bg-black/70 p-2 text-white"><ChevronLeft className="h-5 w-5"/></button><button type="button" aria-label={es?"Siguiente":"Next"} onClick={next} className="absolute right-2 rounded-full bg-black/70 p-2 text-white"><ChevronRight className="h-5 w-5"/></button></>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium">{active.title}</p><p className="text-xs text-muted-foreground">{index+1} / {media.length} · {active.mime_type}</p></div>
        <button type="button" disabled={ai.isPending} onClick={()=>ai.mutate(!active.extraction_authorized)} className="rounded-lg border border-primary px-3 py-2 text-xs text-primary disabled:opacity-50"><Bot className="mr-1 inline h-4 w-4"/>{active.extraction_authorized?(es?"Retirar acceso de IA":"Remove case AI access"):(es?"Autorizar IA del caso":"Authorize case AI")}</button>
      </div>
      {media.length>1&&<div className="flex gap-2 overflow-x-auto pb-1">{media.map((item:any,itemIndex:number)=><button type="button" key={item.id} onClick={()=>setIndex(itemIndex)} className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border ${itemIndex===index?"border-primary ring-2 ring-primary/20":"border-border"}`}>{item.mime_type?.startsWith("image/")?<img src={item.signedUrl} alt="" className="h-full w-full object-cover"/>:<span className="flex h-full items-center justify-center bg-muted px-1 text-center text-[10px]">{item.title}</span>}</button>)}</div>}
      <p className="rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">{es?"La autorización de IA se limita a este caso de Atención Integral. No envía el archivo al flujo de Inteligencia Legal.":"AI authorization is limited to this Comprehensive Care case. It does not send the file to the Legal Intelligence pipeline."}</p>
    </div>}
    <div className="border-t border-border pt-4">
      <h3 className="font-semibold">{es?"Documentos autorizados":"Authorized documents"}</h3>
      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{documents.length?documents.map(document=><div key={document.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-medium"><FileText className="mr-2 inline h-4 w-4 text-primary"/>{document.title}</p><p className="mt-1 text-xs text-muted-foreground">v{document.current_version} · {document.record_type}</p><p className="font-mono text-[10px] text-muted-foreground">{document.checksum?.slice(0,16)}{document.checksum?"…":""}</p></div>):<p className="py-5 text-center text-sm text-muted-foreground">—</p>}</div>
    </div>
  </section>;
}
