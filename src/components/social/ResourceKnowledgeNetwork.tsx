import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BookOpen, MapPin, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import {
  findResourcesForSocialCase, getResourceNetworkMetadata, saveResourceInstitution,
  saveResourceKnowledge, searchResourceNetwork, submitResourceCorrection,
  verifyResourceInstitution,
} from "@/lib/social.functions";

type Mode="resources"|"knowledge"|"admin";
type Option={value:string;label:string};
const csv=(v:string)=>v.split(",").map(x=>x.trim()).filter(Boolean);
const option=(value:string,es:boolean):string=>{
  const values:Record<string,[string,string]>={
    verified:["Verificado","Verified"],verification_due:["Verificación vencida","Verification due"],unverified:["Sin verificar","Unverified"],
    temporarily_unavailable:["No disponible temporalmente","Temporarily unavailable"],at_capacity:["Sin cupo","At capacity"],closed:["Cerrado","Closed"],archived:["Archivado","Archived"],
    free:["Gratuito","Free"],sliding_scale:["Cuota variable","Sliding scale"],paid:["De pago","Paid"],public_coverage:["Cobertura pública","Public coverage"],unknown:["Por confirmar","To be confirmed"],
    standard:["Estándar","Standard"],urgent:["Urgente","Urgent"],emergency:["Emergencia","Emergency"],
    service_match:["Coincide con el servicio","Service match"],geographic_match:["Coincide con la zona","Geographic match"],language_match:["Coincide con el idioma","Language match"],
    population_match:["Atiende a esta población","Population match"],emergency_available:["Atención de emergencia","Emergency service"],verified_resource:["Recurso verificado","Verified resource"],
  };const x=values[value];return x?(es?x[0]:x[1]):value.replaceAll("_"," ");
};
const opts=(values:string[],es:boolean):Option[]=>values.map(value=>({value,label:option(value,es)}));

export function ResourceKnowledgeNetwork({mode,orgId}:{mode:Mode;orgId?:string}){
  const {locale}=useI18n();const es=locale==="es";const metaFn=useServerFn(getResourceNetworkMetadata);
  const meta=useQuery({queryKey:["resource-network-meta"],queryFn:()=>metaFn()});
  if(mode==="knowledge")return <Knowledge es={es} rows={meta.data?.knowledge??[]}/>;
  if(mode==="admin")return <Admin es={es} orgId={orgId??meta.data?.organizations?.[0]?.id}/>;
  return <Directory es={es} categories={meta.data?.categories??[]}/>;
}

function Directory({es,categories}:{es:boolean;categories:any[]}){
  const searchFn=useServerFn(searchResourceNetwork);
  const [form,setForm]=useState({query:"",state:"",municipality:"",service:"",urgency:"",population:"",language:"",costType:"",availability:""});
  const [filters,setFilters]=useState(form);
  const results=useQuery({queryKey:["resource-network",filters],queryFn:()=>searchFn({data:Object.fromEntries(Object.entries(filters).filter(([,v])=>v))})});
  return <section className="space-y-4"><Panel>
    <h2 className="flex items-center gap-2 text-lg font-semibold"><MapPin className="h-5 w-5 text-primary"/>{es?"Red de Recursos y Directorio Institucional":"Resource and Institutional Directory"}</h2>
    <p className="text-sm text-muted-foreground">{es?"La búsqueda ordinaria nunca envía datos de personas o casos.":"Ordinary search never sends person or case data."}</p>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Field label={es?"Nombre o palabra clave":"Name or keyword"} value={form.query} onChange={v=>setForm({...form,query:v})}/>
      <Field label={es?"Estado":"State"} value={form.state} onChange={v=>setForm({...form,state:v})}/>
      <Field label={es?"Municipio":"Municipality"} value={form.municipality} onChange={v=>setForm({...form,municipality:v})}/>
      <Select label={es?"Servicio":"Service"} value={form.service} onChange={v=>setForm({...form,service:v})} options={categories.map((x:any)=>({value:x.code,label:es?x.name_es:x.name_en}))}/>
      <Select label={es?"Urgencia":"Urgency"} value={form.urgency} onChange={v=>setForm({...form,urgency:v})} options={opts(["standard","urgent","emergency"],es)}/>
      <Field label={es?"Población":"Population"} value={form.population} onChange={v=>setForm({...form,population:v})}/>
      <Field label={es?"Idioma":"Language"} value={form.language} onChange={v=>setForm({...form,language:v})}/>
      <Select label={es?"Costo":"Cost"} value={form.costType} onChange={v=>setForm({...form,costType:v})} options={opts(["free","sliding_scale","paid","public_coverage","unknown"],es)}/>
    </div><button onClick={()=>setFilters({...form})} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"><Search className="mr-2 inline h-4 w-4"/>{es?"Buscar recursos":"Search resources"}</button>
  </Panel>{results.isLoading&&<p>{es?"Buscando…":"Searching…"}</p>}<div className="space-y-3">{(results.data??[]).map((r:any)=><Resource key={r.id} row={r} es={es}/>)}</div>
  {!results.isLoading&&!(results.data??[]).length&&<Panel><p className="text-sm text-muted-foreground">{es?"No se encontraron recursos.":"No resources found."}</p></Panel>}</section>;
}

function Resource({row:r,es}:{row:any;es:boolean}){
  const correctFn=useServerFn(submitResourceCorrection);const [reason,setReason]=useState("");
  const correct=useMutation({mutationFn:()=>correctFn({data:{institutionId:r.id,reason}}),onSuccess:()=>{toast.success(es?"Corrección enviada":"Correction submitted");setReason("");},onError:(e:any)=>toast.error(e.message)});
  const stale=r.next_verification_at&&new Date(r.next_verification_at)<new Date();
  return <Panel><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{r.official_name}</h3><p className="text-sm text-muted-foreground">{r.institution_type} · {[r.municipality,r.state_code].filter(Boolean).join(", ")}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{stale?option("verification_due",es):option(r.status,es)}</span></div>
  {r.description&&<p className="text-sm">{r.description}</p>}<div className="flex flex-wrap gap-1">{(r.services??[]).map((x:string)=><span key={x} className="rounded bg-muted px-2 py-1 text-xs">{x}</span>)}</div>
  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><p>{es?"Costo":"Cost"}: {option(r.cost_type,es)}</p><p>{es?"Cupo":"Capacity"}: {option(r.capacity_status,es)}</p><p>{es?"Idiomas":"Languages"}: {(r.languages??[]).join(", ")||"—"}</p><p>{es?"Documentos":"Documents"}: {(r.required_documents??[]).join(", ")||"—"}</p></div>
  {!!r.match_explanation?.length&&<p className="text-xs text-primary">{r.match_explanation.map((x:string)=>option(x,es)).join(" · ")}</p>}
  <div className="flex flex-wrap gap-3 text-xs">{r.phone&&<a className="text-primary underline" href={"tel:"+r.phone}>{r.phone}</a>}{r.whatsapp&&<a className="text-primary underline" href={"https://wa.me/"+String(r.whatsapp).replace(/\D/g,"")} target="_blank" rel="noreferrer">WhatsApp</a>}{r.website&&<a className="text-primary underline" href={r.website} target="_blank" rel="noreferrer">{es?"Sitio web":"Website"}</a>}</div>
  <details><summary className="cursor-pointer text-xs">{es?"Informar una corrección":"Report a correction"}</summary><div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm" value={reason} onChange={e=>setReason(e.target.value)}/><button disabled={reason.length<5} onClick={()=>correct.mutate()} className="rounded border border-border px-3 text-xs">{es?"Enviar":"Submit"}</button></div></details></Panel>;
}

function Knowledge({es,rows}:{es:boolean;rows:any[]}){
  const [query,setQuery]=useState("");const visible=rows.filter(r=>(r.title_es+" "+r.title_en+" "+(r.summary_es??"")+" "+(r.summary_en??"")).toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-4"><Panel><h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5 text-primary"/>{es?"Centro de Conocimiento":"Knowledge Center"}</h2><p className="text-sm text-muted-foreground">{es?"Procedimientos, protocolos, manuales, formularios y actualizaciones aprobadas.":"Approved procedures, protocols, manuals, forms, and updates."}</p><Field label={es?"Buscar":"Search"} value={query} onChange={setQuery}/></Panel><div className="grid gap-3 lg:grid-cols-2">{visible.map(r=><Panel key={r.id}><h3 className="font-semibold">{es?r.title_es:r.title_en}</h3><p className="text-sm text-muted-foreground">{es?r.summary_es:r.summary_en}</p><p className="text-xs">v{r.version} · {option(r.approval_status,es)}</p>{r.source_url&&<a href={r.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{es?"Abrir fuente":"Open source"}</a>}</Panel>)}</div></section>;
}

function Admin({es,orgId}:{es:boolean;orgId?:string}){
  const qc=useQueryClient();const saveFn=useServerFn(saveResourceInstitution);const verifyFn=useServerFn(verifyResourceInstitution);const knowledgeFn=useServerFn(saveResourceKnowledge);
  const [tab,setTab]=useState<"resource"|"verify"|"knowledge">("resource");
  const [r,setR]=useState({name:"",type:"",description:"",services:"",state:"",municipality:"",address:"",phone:"",whatsapp:"",email:"",website:"",languages:"es",populations:"",eligibility:"",documents:"",cost:"unknown",coverage:"municipal",methods:"phone",internalNotes:""});
  const [v,setV]=useState({id:"",status:"verified",source:"",evidence:"",next:""});
  const [k,setK]=useState({titleEs:"",titleEn:"",summaryEs:"",summaryEn:"",type:"procedure",categories:"",states:"",source:"",status:"draft",review:""});
  const saved=()=>{toast.success(es?"Guardado":"Saved");void qc.invalidateQueries({queryKey:["resource-network"]});};
  const save=useMutation({mutationFn:()=>saveFn({data:{orgId:orgId??null,officialName:r.name,institutionType:r.type,description:r.description,services:csv(r.services),stateCode:r.state,municipality:r.municipality,address:r.address,phone:r.phone,whatsapp:r.whatsapp,email:r.email,website:r.website,languages:csv(r.languages),populations:csv(r.populations),eligibility:r.eligibility,requiredDocuments:csv(r.documents),costType:r.cost as any,coverageLevels:csv(r.coverage),referralMethods:csv(r.methods),internalNotes:r.internalNotes,appointmentRequired:false,walkInAvailable:false,emergencyAvailable:false,remoteAvailable:false,locationConfidential:false,capacityStatus:"unknown"}}),onSuccess:saved,onError:(e:any)=>toast.error(e.message)});
  const verify=useMutation({mutationFn:()=>verifyFn({data:{institutionId:v.id,status:v.status as any,source:v.source,evidenceUrl:v.evidence,nextVerificationAt:v.next?new Date(v.next).toISOString():undefined}}),onSuccess:saved,onError:(e:any)=>toast.error(e.message)});
  const knowledge=useMutation({mutationFn:()=>knowledgeFn({data:{orgId:orgId??null,titleEs:k.titleEs,titleEn:k.titleEn,summaryEs:k.summaryEs,summaryEn:k.summaryEn,knowledgeType:k.type as any,serviceCategories:csv(k.categories),stateCodes:csv(k.states),sourceUrl:k.source,approvalStatus:k.status as any,reviewDueAt:k.review?new Date(k.review).toISOString():undefined}}),onSuccess:saved,onError:(e:any)=>toast.error(e.message)});
  const button=(id:typeof tab,name:string)=><button onClick={()=>setTab(id)} className={"rounded px-3 py-2 text-xs "+(tab===id?"bg-primary text-primary-foreground":"border border-border")}>{name}</button>;
  return <section className="space-y-4"><Panel><h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-primary"/>{es?"Administración de recursos y conocimiento":"Resource and knowledge administration"}</h2><div className="flex gap-2">{button("resource",es?"Recursos":"Resources")}{button("verify",es?"Verificación":"Verification")}{button("knowledge",es?"Conocimiento":"Knowledge")}</div></Panel>
  {tab==="resource"&&<Panel><div className="grid gap-3 md:grid-cols-2"><Field label={es?"Nombre oficial":"Official name"} value={r.name} onChange={x=>setR({...r,name:x})}/><Field label={es?"Tipo de institución":"Institution type"} value={r.type} onChange={x=>setR({...r,type:x})}/><Field label={es?"Descripción":"Description"} value={r.description} onChange={x=>setR({...r,description:x})}/><Field label={es?"Servicios (separados por coma)":"Services (comma-separated)"} value={r.services} onChange={x=>setR({...r,services:x})}/><Field label={es?"Estado":"State"} value={r.state} onChange={x=>setR({...r,state:x})}/><Field label={es?"Municipio":"Municipality"} value={r.municipality} onChange={x=>setR({...r,municipality:x})}/><Field label={es?"Domicilio":"Address"} value={r.address} onChange={x=>setR({...r,address:x})}/><Field label={es?"Teléfono":"Telephone"} value={r.phone} onChange={x=>setR({...r,phone:x})}/><Field label="WhatsApp" value={r.whatsapp} onChange={x=>setR({...r,whatsapp:x})}/><Field label="Email" value={r.email} onChange={x=>setR({...r,email:x})}/><Field label={es?"Sitio web":"Website"} value={r.website} onChange={x=>setR({...r,website:x})}/><Field label={es?"Idiomas":"Languages"} value={r.languages} onChange={x=>setR({...r,languages:x})}/><Field label={es?"Poblaciones":"Populations"} value={r.populations} onChange={x=>setR({...r,populations:x})}/><Field label={es?"Elegibilidad":"Eligibility"} value={r.eligibility} onChange={x=>setR({...r,eligibility:x})}/><Field label={es?"Documentos requeridos":"Required documents"} value={r.documents} onChange={x=>setR({...r,documents:x})}/><Field label={es?"Notas internas (nunca compartidas)":"Internal notes (never shared)"} value={r.internalNotes} onChange={x=>setR({...r,internalNotes:x})}/></div><button disabled={r.name.length<2||r.type.length<2||save.isPending} onClick={()=>save.mutate()} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">{es?"Guardar recurso":"Save resource"}</button></Panel>}
  {tab==="verify"&&<Panel><div className="grid gap-3 md:grid-cols-2"><Field label={es?"ID del recurso":"Resource ID"} value={v.id} onChange={x=>setV({...v,id:x})}/><Select label={es?"Estado":"Status"} value={v.status} onChange={x=>setV({...v,status:x})} options={opts(["verified","verification_due","unverified","temporarily_unavailable","at_capacity","closed","archived"],es)}/><Field label={es?"Fuente":"Source"} value={v.source} onChange={x=>setV({...v,source:x})}/><Field label={es?"Evidencia URL":"Evidence URL"} value={v.evidence} onChange={x=>setV({...v,evidence:x})}/><Field label={es?"Próxima verificación":"Next verification"} type="date" value={v.next} onChange={x=>setV({...v,next:x})}/></div><button disabled={!v.id||v.source.length<2||verify.isPending} onClick={()=>verify.mutate()} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">{es?"Registrar verificación":"Record verification"}</button></Panel>}
  {tab==="knowledge"&&<Panel><div className="grid gap-3 md:grid-cols-2"><Field label={es?"Título en español":"Spanish title"} value={k.titleEs} onChange={x=>setK({...k,titleEs:x})}/><Field label={es?"Título en inglés":"English title"} value={k.titleEn} onChange={x=>setK({...k,titleEn:x})}/><Field label={es?"Resumen en español":"Spanish summary"} value={k.summaryEs} onChange={x=>setK({...k,summaryEs:x})}/><Field label={es?"Resumen en inglés":"English summary"} value={k.summaryEn} onChange={x=>setK({...k,summaryEn:x})}/><Field label={es?"Categorías":"Categories"} value={k.categories} onChange={x=>setK({...k,categories:x})}/><Field label={es?"Estados":"States"} value={k.states} onChange={x=>setK({...k,states:x})}/><Field label={es?"Fuente URL":"Source URL"} value={k.source} onChange={x=>setK({...k,source:x})}/></div><button disabled={k.titleEs.length<2||k.titleEn.length<2||knowledge.isPending} onClick={()=>knowledge.mutate()} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">{es?"Guardar conocimiento":"Save knowledge"}</button></Panel>}</section>;
}

export function CaseResourceRecommendations({caseId}:{caseId:string}){
  const {locale}=useI18n();const es=locale==="es";const findFn=useServerFn(findResourcesForSocialCase);const [service,setService]=useState("");const [urgency,setUrgency]=useState("");const [run,setRun]=useState(false);
  const found=useQuery({queryKey:["case-resources",caseId,service,urgency],queryFn:()=>findFn({data:{caseId,service:service||undefined,urgency:(urgency||undefined) as any}}),enabled:run});
  return <section className="space-y-4"><Panel><h3 className="font-semibold">{es?"Buscar recursos para esta persona":"Find Resources for This Client"}</h3><p className="text-sm text-muted-foreground">{es?"Los datos autorizados solo ordenan resultados; no se envía información identificable. El personal toma la decisión final.":"Authorized data only ranks results; no identifying information is sent. Staff makes the final decision."}</p><div className="grid gap-3 md:grid-cols-3"><Field label={es?"Servicio":"Service"} value={service} onChange={setService}/><Select label={es?"Urgencia":"Urgency"} value={urgency} onChange={setUrgency} options={opts(["standard","urgent","emergency"],es)}/><button onClick={()=>setRun(true)} className="self-end rounded bg-primary px-4 py-2 text-sm text-primary-foreground"><Search className="mr-2 inline h-4 w-4"/>{es?"Obtener recomendaciones":"Get recommendations"}</button></div></Panel>{found.data&&<div className="rounded border border-warning/30 bg-warning/10 p-3 text-xs"><AlertTriangle className="mr-2 inline h-4 w-4"/>{es?"Verifique elegibilidad, cupo, consentimiento y documentos. Enviar no equivale a un resultado exitoso.":"Verify eligibility, capacity, consent, and documents. Sending does not equal a successful outcome."}</div>}{(found.data?.recommendations??[]).map((x:any)=><Resource key={x.id} row={x} es={es}/>)}</section>;
}

function Panel({children}:{children:React.ReactNode}){return <div className="space-y-3 rounded-xl border border-border bg-card p-5">{children}</div>}
function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){return <label className="block text-xs font-medium text-muted-foreground">{label}<input type={type} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"/></label>}
function Select({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:Option[]}){return <label className="block text-xs font-medium text-muted-foreground">{label}<select value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">—</option>{options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>}
