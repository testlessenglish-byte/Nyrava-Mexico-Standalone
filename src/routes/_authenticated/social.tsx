import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowRight, BriefcaseMedical, CalendarClock,
  CheckCircle2, ClipboardCheck, FileHeart, FileText, HeartHandshake,
  Loader2, Search, ShieldCheck, UserPlus, Users,
} from "lucide-react";
import { useI18n } from "@/i18n";
import {
  acknowledgeSocialAlert, createSocialCase, createSocialFamily, createSocialPerson,
  findPossibleSocialPeople, ensureSocialProgram, getSocialIndicators,
  getSocialWorkspace, searchSocialRecords,
} from "@/lib/social.functions";
import { EMERGENCY_GUIDANCE } from "@/lib/social/types";
import { SocialCaseWorkspace } from "@/components/social/SocialCaseWorkspace";

export const Route=createFileRoute("/_authenticated/social")({
  head:()=>({meta:[
    {title:"Atención Integral — Nyrava México"},
    {name:"description",content:"Gestión social integral, separada de los expedientes jurídicos migratorios."},
  ]}),
  component:SocialCarePage,
});

type Area="dashboard"|"people"|"families"|"cases"|"intake"|"assessments"|"plans"|"interventions"|"legal"|"psychosocial"|"referrals"|"tasks"|"documents"|"transfers"|"closure"|"indicators"|"activity"|"administration";
const AREAS:Array<{id:Area;es:string;en:string;icon:typeof Activity}>=[
  {id:"dashboard",es:"Resumen",en:"Overview",icon:Activity},
  {id:"people",es:"Personas",en:"People",icon:Users},
  {id:"families",es:"Familias",en:"Families",icon:HeartHandshake},
  {id:"cases",es:"Casos",en:"Cases",icon:FileHeart},
  {id:"intake",es:"Ingreso",en:"Intake",icon:UserPlus},
  {id:"assessments",es:"Evaluaciones de riesgo",en:"Risk assessments",icon:ClipboardCheck},
  {id:"plans",es:"Planes de atención",en:"Care plans",icon:CheckCircle2},
  {id:"interventions",es:"Intervenciones",en:"Interventions",icon:BriefcaseMedical},
  {id:"legal",es:"Servicios jurídicos",en:"Legal services",icon:ShieldCheck},
  {id:"psychosocial",es:"Servicios psicosociales",en:"Psychosocial services",icon:HeartHandshake},
  {id:"referrals",es:"Canalizaciones",en:"Referrals",icon:ArrowRight},
  {id:"tasks",es:"Tareas y alertas",en:"Tasks and alerts",icon:CalendarClock},
  {id:"documents",es:"Documentos y consentimiento",en:"Documents and consent",icon:FileText},
  {id:"transfers",es:"Transferencias",en:"Case transfers",icon:ArrowRight},
  {id:"closure",es:"Cierre de caso",en:"Case closure",icon:CheckCircle2},
  {id:"indicators",es:"Indicadores institucionales",en:"Institutional indicators",icon:Activity},
  {id:"activity",es:"Actividad del equipo",en:"Team activity",icon:Users},
  {id:"administration",es:"Administración",en:"Administration",icon:ShieldCheck},
];

function SocialCarePage(){
  const {locale}=useI18n(); const es=locale==="es"; const qc=useQueryClient();
  const workspaceFn=useServerFn(getSocialWorkspace);
  const createPersonFn=useServerFn(createSocialPerson);
  const createCaseFn=useServerFn(createSocialCase);
  const duplicateFn=useServerFn(findPossibleSocialPeople);
  const searchFn=useServerFn(searchSocialRecords);
  const ensureProgramFn=useServerFn(ensureSocialProgram);
  const createFamilyFn=useServerFn(createSocialFamily);
  const indicatorsFn=useServerFn(getSocialIndicators);
  const acknowledgeAlertFn=useServerFn(acknowledgeSocialAlert);
  const [area,setArea]=useState<Area>("dashboard");
  const [selectedCaseId,setSelectedCaseId]=useState("");
  const [orgId,setOrgId]=useState("");
  const [query,setQuery]=useState("");
  const [programSetup,setProgramSetup]=useState({nameEs:"Atención Integral",nameEn:"Comprehensive Care",prefix:"NYR-SOC"});
  const [family,setFamily]=useState({name:"",primaryId:"",memberIds:[] as string[]});
  const today=new Date().toISOString().slice(0,10);const yearStart=`${today.slice(0,4)}-01-01`;
  const [indicatorRange,setIndicatorRange]=useState({from:yearStart,to:today});
  const workspace=useQuery({queryKey:["social-workspace"],queryFn:()=>workspaceFn()});
  const resolvedOrg=orgId||workspace.data?.organizations?.[0]?.id||"";
  const programs=(workspace.data?.programs??[]).filter((p:any)=>p.org_id===resolvedOrg);
  const visibleCases=(workspace.data?.cases??[]).filter((c:any)=>c.org_id===resolvedOrg);
  const visiblePeople=(workspace.data?.people??[]).filter((p:any)=>p.org_id===resolvedOrg);
  const visibleFamilies=(workspace.data?.families??[]).filter((x:any)=>x.org_id===resolvedOrg);
  const visibleAlerts=(workspace.data?.alerts??[]).filter((x:any)=>x.org_id===resolvedOrg);
  const search=useMutation({
    mutationFn:()=>searchFn({data:{orgId:resolvedOrg,query,limit:50}}),
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const [person,setPerson]=useState({legalName:"",preferredName:"",telephone:"",email:"",nationality:""});
  const [caseDraft,setCaseDraft]=useState({programId:"",personId:"",caseType:"atencion_integral",priority:"normal" as "low"|"normal"|"high"|"urgent"});
  const duplicates=useMutation({
    mutationFn:()=>duplicateFn({data:{orgId:resolvedOrg,name:person.legalName,phone:person.telephone||undefined,email:person.email||undefined,limit:10}}),
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const createPersonMutation=useMutation({
    mutationFn:()=>createPersonFn({data:{orgId:resolvedOrg,legalName:person.legalName,preferredName:person.preferredName||undefined,telephone:person.telephone||undefined,email:person.email||undefined,nationality:person.nationality||undefined,aliases:[],languages:[],currentLocation:{},immigrationIdentifiers:{},unaccompaniedMinor:false,separatedMinor:false}}),
    onSuccess:(row:any)=>{toast.success(es?`Persona ${row.person_number} registrada`:`Person ${row.person_number} registered`);setPerson({legalName:"",preferredName:"",telephone:"",email:"",nationality:""});qc.invalidateQueries({queryKey:["social-workspace"]});},
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const createCaseMutation=useMutation({
    mutationFn:()=>createCaseFn({data:{orgId:resolvedOrg,programId:caseDraft.programId||programs[0]?.id,personId:caseDraft.personId,caseType:caseDraft.caseType,serviceAreas:[],priority:caseDraft.priority,riskLevel:"unknown",confidentialityLevel:"standard",tags:[]}}),
    onSuccess:(row:any)=>{toast.success(es?`Caso ${row.case_number} creado`:`Case ${row.case_number} created`);qc.invalidateQueries({queryKey:["social-workspace"]});setArea("cases");},
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const programMutation=useMutation({
    mutationFn:()=>ensureProgramFn({data:{orgId:resolvedOrg,...programSetup}}),
    onSuccess:()=>{toast.success(es?"Programa social actualizado":"Social program updated");qc.invalidateQueries({queryKey:["social-workspace"]});},
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const familyMutation=useMutation({
    mutationFn:()=>createFamilyFn({data:{orgId:resolvedOrg,familyName:family.name,primaryContactPersonId:family.primaryId||undefined,currentLocation:{},memberIds:family.memberIds}}),
    onSuccess:()=>{toast.success(es?"Familia registrada":"Family registered");setFamily({name:"",primaryId:"",memberIds:[]});qc.invalidateQueries({queryKey:["social-workspace"]});},
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const indicators=useQuery({queryKey:["social-indicators",resolvedOrg,indicatorRange],queryFn:()=>indicatorsFn({data:{orgId:resolvedOrg,from:indicatorRange.from,to:indicatorRange.to}}),enabled:area==="indicators"&&!!resolvedOrg});
  const acknowledgeMutation=useMutation({
    mutationFn:(id:string)=>acknowledgeAlertFn({data:{alertId:id,resolve:true}}),
    onSuccess:()=>{toast.success(es?"Alerta resuelta":"Alert resolved");qc.invalidateQueries({queryKey:["social-workspace"]});},
    onError:(e:unknown)=>toast.error(e instanceof Error?e.message:String(e)),
  });
  const stats=workspace.data?.stats;
  const filtered=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase("es-MX"); if(!q)return visibleCases;
    return visibleCases.filter((c:any)=>[c.case_number,c.case_type,c.status,c.risk_level].some(v=>String(v??"").toLocaleLowerCase("es-MX").includes(q)));
  },[visibleCases,query]);

  if(workspace.isLoading)return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>{es?"Cargando Atención Integral…":"Loading Comprehensive Care…"}</div>;
  if(selectedCaseId)return <div className="mx-auto max-w-[1600px] p-4 md:p-6"><SocialCaseWorkspace
    caseId={selectedCaseId}
    people={workspace.data?.people??[]}
    institutions={workspace.data?.institutions??[]}
    templates={workspace.data?.templates??[]}
    roleAssignments={workspace.data?.roleAssignments??[]}
    onClose={()=>{setSelectedCaseId("");void qc.invalidateQueries({queryKey:["social-workspace"]});}}
  /></div>;
  return <div className="mx-auto max-w-[1500px] p-4 md:p-6">
    <header className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="rounded-xl bg-primary/15 p-3 text-primary"><HeartHandshake className="h-6 w-6"/></div>
          <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-primary">Nyrava México</p>
            <h1 className="text-2xl font-semibold">{es?"Atención Integral y Gestión Social":"Comprehensive Care and Social Case Management"}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{es?"Área independiente de Derecho Migratorio, Refugio y Nacionalidad. Los vínculos jurídicos requieren autorización y consentimiento explícitos.":"A separate practice area from Immigration, Refugee and Nationality Law. Legal links require explicit authorization and consent."}</p>
          </div>
        </div>
        <select value={resolvedOrg} onChange={e=>setOrgId(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          {(workspace.data?.organizations??[]).map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
    </header>

    {!workspace.data?.organizations?.length&&<div className="mt-5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">{es?"Primero debe pertenecer a una organización activa.":"You must first belong to an active organization."}</div>}

    <div className="mt-5 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="h-fit rounded-xl border border-border bg-card p-2 lg:sticky lg:top-4">
        <nav className="max-h-[72vh] space-y-1 overflow-y-auto">
          {AREAS.map(a=>{const Icon=a.icon;return <button key={a.id} onClick={()=>setArea(a.id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${area===a.id?"bg-primary text-primary-foreground":"hover:bg-muted"}`}><Icon className="h-4 w-4"/>{es?a.es:a.en}</button>})}
        </nav>
      </aside>

      <main className="min-w-0">
        {area==="dashboard"&&<>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={es?"Casos activos":"Active cases"} value={stats?.active??0}/>
            <Metric label={es?"Riesgo crítico":"Critical risk"} value={stats?.critical??0} danger/>
            <Metric label={es?"Tareas vencidas":"Overdue tasks"} value={stats?.overdue??0}/>
            <Metric label={es?"Canalizaciones sin verificar":"Unverified referrals"} value={stats?.unverifiedReferrals??0}/>
          </div>
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4">
            <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-warning"/><div><p className="text-sm font-semibold">{es?"Guía de escalamiento":"Escalation guidance"}</p><p className="text-sm text-muted-foreground">{EMERGENCY_GUIDANCE[locale]}</p></div></div>
          </div>
          <CaseTable cases={visibleCases.slice(0,12)} es={es} onOpen={setSelectedCaseId}/>
        </>}

        {(area==="people"||area==="intake")&&<div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">{es?"Registrar persona":"Register person"}</h2>
            <p className="mb-4 text-xs text-muted-foreground">{es?"Capture únicamente los datos necesarios para el servicio.":"Collect only data necessary for the service."}</p>
            <div className="space-y-3">
              <Field label={es?"Nombre legal":"Legal name"} value={person.legalName} onChange={v=>setPerson({...person,legalName:v})}/>
              <Field label={es?"Nombre preferido":"Preferred name"} value={person.preferredName} onChange={v=>setPerson({...person,preferredName:v})}/>
              <Field label={es?"Teléfono":"Telephone"} value={person.telephone} onChange={v=>setPerson({...person,telephone:v})}/>
              <Field label="Email" type="email" value={person.email} onChange={v=>setPerson({...person,email:v})}/>
              <Field label={es?"Nacionalidad":"Nationality"} value={person.nationality} onChange={v=>setPerson({...person,nationality:v})}/>
              <button disabled={!resolvedOrg||person.legalName.trim().length<2||duplicates.isPending} onClick={()=>duplicates.mutate()} className="w-full rounded-lg border border-border px-3 py-2 text-sm"><Search className="mr-2 inline h-4 w-4"/>{es?"Buscar posibles duplicados":"Check possible duplicates"}</button>
              {(duplicates.data??[]).length>0&&<div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs"><strong>{es?"Revise antes de crear:":"Review before creating:"}</strong>{(duplicates.data??[]).map((d:any)=><div key={d.id}>{d.person_number} · {d.legal_name} ({Math.round(Number(d.similarity)*100)}%)</div>)}</div>}
              <button disabled={createPersonMutation.isPending||!resolvedOrg||person.legalName.trim().length<2} onClick={()=>createPersonMutation.mutate()} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">{createPersonMutation.isPending&&<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>}{es?"Registrar persona":"Register person"}</button>
            </div>
          </section>
          <PeopleTable people={visiblePeople} es={es}/>
        </div>}

        {area==="cases"&&<section>
          <div className="mb-4 rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 font-semibold">{es?"Abrir caso social":"Open social case"}</h2>
            {!programs.length?<p className="text-sm text-warning">{es?"Un administrador debe crear un programa social y su prefijo antes de abrir casos.":"An administrator must create a social program and case-number prefix before opening cases."}</p>:<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <select value={caseDraft.programId||programs[0]?.id||""} onChange={e=>setCaseDraft({...caseDraft,programId:e.target.value})} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">{programs.map((p:any)=><option key={p.id} value={p.id}>{es?p.name_es:p.name_en} · {p.case_prefix}</option>)}</select>
              <select value={caseDraft.personId} onChange={e=>setCaseDraft({...caseDraft,personId:e.target.value})} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">{es?"Seleccione persona":"Select person"}</option>{visiblePeople.map((p:any)=><option key={p.id} value={p.id}>{p.person_number} · {p.legal_name}</option>)}</select>
              <input value={caseDraft.caseType} onChange={e=>setCaseDraft({...caseDraft,caseType:e.target.value})} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" aria-label={es?"Tipo de caso":"Case type"}/>
              <select value={caseDraft.priority} onChange={e=>setCaseDraft({...caseDraft,priority:e.target.value as typeof caseDraft.priority})} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="normal">{es?"Prioridad normal":"Normal priority"}</option><option value="high">{es?"Alta":"High"}</option><option value="urgent">{es?"Urgente":"Urgent"}</option><option value="low">{es?"Baja":"Low"}</option></select>
              <button disabled={!caseDraft.personId||createCaseMutation.isPending} onClick={()=>createCaseMutation.mutate()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{createCaseMutation.isPending&&<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>}{es?"Crear folio":"Create case"}</button>
            </div>}
          </div>
          <div className="mb-4 flex flex-wrap gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={es?"Buscar por nombre, folio, teléfono, estado…":"Search name, ID, phone, status…"} className="min-w-[260px] flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"/><button onClick={()=>search.mutate()} disabled={!resolvedOrg||search.isPending} className="rounded-lg border border-border px-4 py-2 text-sm"><Search className="mr-2 inline h-4 w-4"/>{es?"Búsqueda amplia":"Broad search"}</button></div>
          {search.data&&<div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm">{es?"Resultados autorizados":"Authorized results"}: {search.data.length}</div>}
          <CaseTable cases={filtered} es={es} onOpen={setSelectedCaseId}/>
        </section>}

        {area==="intake"&&null}
        {area==="families"&&<div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">{es?"Registrar familia u hogar":"Register family or household"}</h2><p className="mb-4 text-xs text-muted-foreground">{es?"Cada integrante conserva su expediente individual y sus permisos.":"Each member keeps an individual record and permissions."}</p><div className="space-y-3"><Field label={es?"Nombre familiar":"Family name"} value={family.name} onChange={v=>setFamily({...family,name:v})}/><label className="block text-xs font-medium text-muted-foreground">{es?"Contacto principal":"Primary contact"}<select value={family.primaryId} onChange={e=>setFamily({...family,primaryId:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">—</option>{visiblePeople.map((p:any)=><option key={p.id} value={p.id}>{p.person_number} · {p.legal_name}</option>)}</select></label><div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2"><p className="mb-2 text-xs font-medium text-muted-foreground">{es?"Integrantes":"Members"}</p>{visiblePeople.map((p:any)=><label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={family.memberIds.includes(p.id)} onChange={e=>setFamily({...family,memberIds:e.target.checked?[...family.memberIds,p.id]:family.memberIds.filter(id=>id!==p.id)})}/>{p.person_number} · {p.legal_name}</label>)}</div><button disabled={!family.name||!family.memberIds.length||familyMutation.isPending} onClick={()=>familyMutation.mutate()} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{familyMutation.isPending&&<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>}{es?"Guardar familia":"Save family"}</button></div></section>
          <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead><tr className="bg-muted/50 text-left"><th className="px-4 py-3">{es?"Folio":"Number"}</th><th className="px-4 py-3">{es?"Familia":"Family"}</th><th className="px-4 py-3">{es?"Contacto":"Primary contact"}</th></tr></thead><tbody>{visibleFamilies.map((x:any)=><tr key={x.id} className="border-t border-border"><td className="px-4 py-3 font-mono">{x.family_number}</td><td className="px-4 py-3">{x.family_name}</td><td className="px-4 py-3">{visiblePeople.find((p:any)=>p.id===x.primary_contact_person_id)?.legal_name??"—"}</td></tr>)}{!visibleFamilies.length&&<tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">—</td></tr>}</tbody></table></div>
        </div>}
        {area==="assessments"&&<Empty title={es?"Evaluaciones versionadas":"Versioned assessments"} text={es?"Cada clasificación requiere evidencia, razón, factores protectores, acciones, seguimiento y fecha de revisión.":"Every classification requires evidence, reason, protective factors, actions, follow-up and a review date."}/>}
        {area==="plans"&&<Empty title={es?"Planes de atención":"Care plans"} text={es?"Las versiones aprobadas son inmutables y toda nueva revisión crea una versión adicional.":"Approved versions are immutable; every revision creates a new version."}/>}
        {area==="administration"&&<section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">{es?"Administración del programa":"Program administration"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{es?"Configure el nombre bilingüe y el prefijo inmutable de nuevos folios. Los folios existentes no cambian.":"Configure bilingual labels and the prefix for new immutable case numbers. Existing numbers never change."}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Nombre (ES)" value={programSetup.nameEs} onChange={v=>setProgramSetup({...programSetup,nameEs:v})}/>
            <Field label="Name (EN)" value={programSetup.nameEn} onChange={v=>setProgramSetup({...programSetup,nameEn:v})}/>
            <Field label={es?"Prefijo de folio":"Case prefix"} value={programSetup.prefix} onChange={v=>setProgramSetup({...programSetup,prefix:v.toUpperCase().replace(/[^A-Z0-9-]/g,"")})}/>
            <button disabled={!resolvedOrg||programMutation.isPending} onClick={()=>programMutation.mutate()} className="self-end rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{programMutation.isPending&&<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>}{es?"Guardar programa":"Save program"}</button>
          </div>
        </section>}
        {area==="tasks"&&<section className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">{es?"Alertas operativas":"Operational alerts"}</h2><div className="mt-3 space-y-2">{visibleAlerts.map((x:any)=><div key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className={x.severity==="critical"?"font-semibold text-destructive":"font-medium"}>{es?x.title_es:x.title_en}</p><p className="text-xs text-muted-foreground">{x.alert_type} · {x.due_at?new Date(x.due_at).toLocaleString():"—"}</p></div><button disabled={acknowledgeMutation.isPending} onClick={()=>acknowledgeMutation.mutate(x.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs">{es?"Resolver":"Resolve"}</button></div>)}{!visibleAlerts.length&&<p className="text-sm text-muted-foreground">{es?"No hay alertas pendientes.":"No pending alerts."}</p>}</div></section>}
        {area==="indicators"&&<section className="rounded-xl border border-border bg-card p-5"><div className="flex flex-wrap items-end gap-3"><div><h2 className="font-semibold">{es?"Indicadores institucionales":"Institutional indicators"}</h2><p className="text-xs text-muted-foreground">{es?"Solo agregados; grupos pequeños se suprimen automáticamente.":"Aggregates only; small groups are automatically suppressed."}</p></div><Field label={es?"Desde":"From"} type="date" value={indicatorRange.from} onChange={v=>setIndicatorRange({...indicatorRange,from:v})}/><Field label={es?"Hasta":"To"} type="date" value={indicatorRange.to} onChange={v=>setIndicatorRange({...indicatorRange,to:v})}/></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(indicators.data??[]).map((x:any,i:number)=><div key={x.id??i} className="rounded-lg border border-border p-4"><p className="text-xs uppercase text-muted-foreground">{x.name_es??x.indicator_code??x.code??(es?"Indicador":"Indicator")}</p><p className="mt-1 text-2xl font-semibold">{x.suppressed?(es?"Suprimido":"Suppressed"):(x.value??x.count??"—")}</p></div>)}{indicators.isLoading&&<Loader2 className="h-5 w-5 animate-spin"/>}{!indicators.isLoading&&!(indicators.data??[]).length&&<p className="text-sm text-muted-foreground">{es?"Sin datos agregados para el periodo.":"No aggregate data for this period."}</p>}</div></section>}
        {area==="activity"&&<section className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">{es?"Actividad del equipo":"Team activity"}</h2><div className="mt-3 space-y-2">{(workspace.data?.recentActivity??[]).filter((x:any)=>x.org_id===resolvedOrg).map((x:any)=><div key={x.id} className="rounded-lg border border-border p-3 text-sm">{new Date(x.occurred_at).toLocaleString()} · {x.event_type} · {x.entity_type}</div>)}</div></section>}
        {["interventions","legal","psychosocial","referrals","documents","transfers","closure"].includes(area)&&<OperationalArea area={area} es={es} cases={visibleCases}/>} 
      </main>
    </div>
  </div>;
}

function Metric({label,value,danger=false}:{label:string;value:number;danger?:boolean}){return <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-1 text-3xl font-semibold ${danger&&value>0?"text-destructive":""}`}>{value}</p></div>}
function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){return <label className="block text-xs font-medium text-muted-foreground">{label}<input type={type} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"/></label>}
function CaseTable({cases,es,onOpen}:{cases:any[];es:boolean;onOpen:(id:string)=>void}){return <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead><tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="px-4 py-3">{es?"Folio":"Case no."}</th><th className="px-4 py-3">{es?"Tipo":"Type"}</th><th className="px-4 py-3">{es?"Estado":"Status"}</th><th className="px-4 py-3">{es?"Riesgo":"Risk"}</th><th className="px-4 py-3">{es?"Última actividad":"Last activity"}</th><th className="px-4 py-3"></th></tr></thead><tbody>{cases.map(c=><tr key={c.id} className="border-t border-border"><td className="px-4 py-3 font-mono">{c.case_number}</td><td className="px-4 py-3">{c.case_type}</td><td className="px-4 py-3">{c.status}</td><td className={`px-4 py-3 ${c.risk_level==="critical"?"font-semibold text-destructive":""}`}>{c.risk_level}</td><td className="px-4 py-3 text-muted-foreground">{new Date(c.last_activity_at).toLocaleDateString()}</td><td className="px-4 py-3 text-right"><button type="button" onClick={()=>onOpen(c.id)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{es?"Abrir":"Open"}</button></td></tr>)}{!cases.length&&<tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{es?"Sin casos autorizados":"No authorized cases"}</td></tr>}</tbody></table></div>}
function PeopleTable({people,es}:{people:any[];es:boolean}){return <div className="overflow-x-auto rounded-xl border border-border bg-card"><table className="w-full text-sm"><thead><tr className="bg-muted/50 text-left"><th className="px-4 py-3">{es?"ID":"ID"}</th><th className="px-4 py-3">{es?"Persona":"Person"}</th><th className="px-4 py-3">{es?"Consentimiento":"Consent"}</th></tr></thead><tbody>{people.map(p=><tr key={p.id} className="border-t border-border"><td className="px-4 py-3 font-mono">{p.person_number}</td><td className="px-4 py-3">{p.legal_name}<span className="block text-xs text-muted-foreground">{p.preferred_name}</span></td><td className="px-4 py-3">{p.consent_status}</td></tr>)}</tbody></table></div>}
function Empty({title,text}:{title:string;text:string}){return <section className="rounded-xl border border-border bg-card p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{text}</p></section>}
function OperationalArea({area,es,cases}:{area:string;es:boolean;cases:any[]}){const labels:Record<string,[string,string,string,string]>={
interventions:["Intervenciones","Interventions","Registros estructurados por servicio y nivel de confidencialidad.","Structured records by service and confidentiality."],
legal:["Servicios jurídicos","Legal services","Las notas privilegiadas requieren permiso jurídico específico.","Privileged notes require specific legal permission."],
psychosocial:["Servicios psicosociales","Psychosocial services","Los expedientes clínicos completos permanecen restringidos.","Full clinical records remain restricted."],
referrals:["Canalizaciones","Referrals","Envío con consentimiento y verificación independiente del resultado.","Consent-gated sending and independently verified outcomes."],
tasks:["Tareas, alertas y citas","Tasks, alerts and appointments","Seguimiento de vencimientos, recurrencia y escalamiento.","Deadlines, recurrence and supervisor escalation."],
documents:["Documentos y consentimiento","Documents and consent","Originales privados, hash, versiones y descarga auditada.","Private originals, hashes, versions and audited downloads."],
transfers:["Transferencias","Transfers","Autoridad, consentimiento, selección y acuse de recibo.","Authority, consent, selection and receipt confirmation."],
closure:["Cierre y reapertura","Closure and reopening","Revisión supervisora; el caso cerrado queda de solo lectura.","Supervisor review; closed cases become read-only."],
indicators:["Indicadores institucionales","Institutional indicators","Datos agregados y supresión de grupos pequeños.","Aggregated data with small-group suppression."],
activity:["Actividad del Equipo","Team Activity","Libro de auditoría operativo, inmutable y sin contenido restringido.","Immutable operational audit ledger without restricted content."],
administration:["Administración","Administration","Programas, oficinas, roles, capacidades y acceso de soporte temporal.","Programs, offices, roles, capabilities and time-limited support access."],
};const l=labels[area]??["","","",""];return <Empty title={es?l[0]:l[1]} text={(es?l[2]:l[3])+` · ${cases.length} ${es?"casos visibles":"visible cases"}`}/>}
