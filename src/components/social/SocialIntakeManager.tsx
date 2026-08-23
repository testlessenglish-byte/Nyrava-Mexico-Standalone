import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowRight, ClipboardList, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import {
  completeSocialIntake,
  createSocialIntake,
  getSocialIntakes,
  openCareCaseFromIntake,
} from "@/lib/social.functions";

type Props={
  orgId:string;
  programs:any[];
  people:any[];
  families:any[];
  members:any[];
  onCaseOpened:(caseId:string)=>void;
};

const split=(value:string)=>value.split(",").map(x=>x.trim()).filter(Boolean);

function message(error:unknown){
  if(error instanceof Error&&error.message)return error.message;
  return typeof error==="string"?error:"Intake operation failed";
}

export function SocialIntakeManager({orgId,programs,people,families,members,onCaseOpened}:Props){
  const {locale}=useI18n();const es=locale==="es";const qc=useQueryClient();
  const listFn=useServerFn(getSocialIntakes);
  const createFn=useServerFn(createSocialIntake);
  const completeFn=useServerFn(completeSocialIntake);
  const openFn=useServerFn(openCareCaseFromIntake);
  const query=useQuery({
    queryKey:["social-intakes",orgId],
    queryFn:()=>listFn({data:{orgId}}),
    enabled:Boolean(orgId),
  });
  const [draft,setDraft]=useState({
    programId:"",personId:"",familyId:"",source:"direct",summary:"",
    needs:"",assignedUserId:"",
  });
  const [selectedId,setSelectedId]=useState("");
  const [decision,setDecision]=useState({
    disposition:"refer_only",reason:"",caseType:"individual",
    priority:"standard",assignedUserId:"",
  });
  const refresh=()=>qc.invalidateQueries({queryKey:["social-intakes",orgId]});
  const createM=useMutation({
    mutationFn:()=>createFn({data:{
      orgId,programId:draft.programId||programs[0]?.id,personId:draft.personId,
      familyId:draft.familyId||undefined,source:draft.source as any,
      summary:draft.summary,presentingNeeds:split(draft.needs),
      assignedUserId:draft.assignedUserId||undefined,
    }}),
    onSuccess:()=>{toast.success(es?"Ingreso registrado":"Intake recorded");setDraft({...draft,personId:"",familyId:"",summary:"",needs:""});void refresh();},
    onError:(e:unknown)=>toast.error(message(e)),
  });
  const completeM=useMutation({
    mutationFn:()=>completeFn({data:{
      intakeId:selectedId,disposition:decision.disposition as any,reason:decision.reason,
    }}),
    onSuccess:()=>{toast.success(es?"Ingreso concluido":"Intake completed");setSelectedId("");setDecision({...decision,reason:""});void refresh();},
    onError:(e:unknown)=>toast.error(message(e)),
  });
  const openM=useMutation({
    mutationFn:()=>openFn({data:{
      intakeId:selectedId,caseType:decision.caseType as any,
      priority:decision.priority as any,
      assignedUserId:decision.assignedUserId||undefined,
    }}),
    onSuccess:(row:any)=>{toast.success(es?`Caso ${row.case_number} abierto desde ingreso`:`Case ${row.case_number} opened from intake`);void refresh();onCaseOpened(row.id);},
    onError:(e:unknown)=>toast.error(message(e)),
  });
  const rows=query.data??[];
  const selected=useMemo(()=>rows.find((x:any)=>x.id===selectedId),[rows,selectedId]);
  const activeMembers=members.filter((m:any)=>m.status==="active");
  const personName=(id:string)=>people.find((p:any)=>p.id===id)?.legal_name??id.slice(0,8);

  if(!programs.length)return <section className="rounded-xl border border-warning/40 bg-warning/10 p-5"><div className="flex gap-2"><AlertTriangle className="h-5 w-5 text-warning"/><p className="text-sm">{es?"Primero active un programa de Atención Integral.":"Activate a Comprehensive Care program first."}</p></div></section>;

  return <div className="space-y-4">
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-3"><ClipboardList className="mt-0.5 h-5 w-5 text-primary"/><div><h2 className="font-semibold">{es?"Nuevo ingreso":"New intake"}</h2><p className="text-xs text-muted-foreground">{es?"El ingreso registra la evaluación inicial. No crea un caso automáticamente.":"Intake records the initial review. It does not automatically create a case."}</p></div></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">{es?"Persona registrada":"Registered person"}<select value={draft.personId} onChange={e=>setDraft({...draft,personId:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">—</option>{people.map((p:any)=><option key={p.id} value={p.id}>{p.person_number} · {p.legal_name}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">{es?"Familia opcional":"Optional family"}<select value={draft.familyId} onChange={e=>setDraft({...draft,familyId:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">—</option>{families.map((f:any)=><option key={f.id} value={f.id}>{f.family_number} · {f.family_name}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">{es?"Canal de ingreso":"Intake source"}<select value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{["direct","phone","email","walk_in","outreach","referral","emergency","other"].map(v=><option key={v} value={v}>{v.replaceAll("_"," ")}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">{es?"Profesional responsable":"Assigned professional"}<select value={draft.assignedUserId} onChange={e=>setDraft({...draft,assignedUserId:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">—</option>{activeMembers.map((m:any)=><option key={m.user_id} value={m.user_id}>{m.name} · {m.role}</option>)}</select></label>
      </div>
      <label className="mt-3 block text-xs font-medium text-muted-foreground">{es?"Resumen inicial":"Initial summary"}<textarea value={draft.summary} onChange={e=>setDraft({...draft,summary:e.target.value})} className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/></label>
      <label className="mt-3 block text-xs font-medium text-muted-foreground">{es?"Necesidades identificadas (separadas por comas)":"Presenting needs (comma separated)"}<input value={draft.needs} onChange={e=>setDraft({...draft,needs:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/></label>
      <button type="button" disabled={!draft.personId||draft.summary.trim().length<3||createM.isPending} onClick={()=>createM.mutate()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{createM.isPending&&<Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>}{es?"Guardar ingreso":"Save intake"}</button>
    </section>

    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">{es?"Ingresos autorizados":"Authorized intakes"}</h2>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2">{es?"Folio":"Number"}</th><th>{es?"Persona":"Person"}</th><th>{es?"Estado":"Status"}</th><th>{es?"Disposición":"Disposition"}</th><th></th></tr></thead><tbody>{rows.map((row:any)=><tr key={row.id} className="border-b border-border/60"><td className="py-3 font-mono text-xs">{row.intake_number}</td><td>{personName(row.person_id)}</td><td>{row.status}</td><td>{row.disposition}</td><td className="text-right">{row.status!=="completed"&&<button type="button" onClick={()=>{setSelectedId(row.id);setDecision({...decision,assignedUserId:row.assigned_to??""});}} className="rounded-lg border border-border px-3 py-1.5 text-xs">{es?"Resolver":"Resolve"}</button>}{row.social_case_id&&<button type="button" onClick={()=>onCaseOpened(row.social_case_id)} className="ml-2 text-xs text-primary underline">{es?"Abrir caso":"Open case"}</button>}</td></tr>)}</tbody></table>{query.isLoading&&<p className="py-6 text-center text-sm text-muted-foreground">{es?"Cargando…":"Loading…"}</p>}{!query.isLoading&&!rows.length&&<p className="py-6 text-center text-sm text-muted-foreground">{es?"No hay ingresos registrados.":"No intakes recorded."}</p>}</div>
    </section>

    {selected&&<section className="rounded-xl border border-primary/25 bg-primary/5 p-5">
      <h2 className="font-semibold">{es?"Resolver ingreso":"Resolve intake"} · <span className="font-mono text-sm">{selected.intake_number}</span></h2>
      <p className="mt-1 text-sm text-muted-foreground">{selected.summary}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-medium text-muted-foreground">{es?"Tipo de caso":"Case type"}<select value={decision.caseType} onChange={e=>setDecision({...decision,caseType:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{["individual","minor_child","family"].map(v=><option key={v} value={v}>{v.replaceAll("_"," ")}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">{es?"Prioridad":"Priority"}<select value={decision.priority} onChange={e=>setDecision({...decision,priority:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{["standard","urgent","emergency"].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">{es?"Asignar a":"Assign to"}<select value={decision.assignedUserId} onChange={e=>setDecision({...decision,assignedUserId:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">—</option>{activeMembers.map((m:any)=><option key={m.user_id} value={m.user_id}>{m.name} · {m.role}</option>)}</select></label>
      </div>
      {decision.priority==="emergency"&&<p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{es?"La prioridad de emergencia crea alertas y tareas inmediatas; no sustituye servicios de emergencia.":"Emergency priority creates immediate alerts and tasks; it does not replace emergency services."}</p>}
      <button type="button" disabled={openM.isPending||(decision.caseType==="family"&&!selected.family_id)} onClick={()=>openM.mutate()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><ArrowRight className="mr-2 inline h-4 w-4"/>{es?"Abrir y asignar caso":"Open and assign case"}</button>
      <div className="mt-5 border-t border-border pt-4">
        <div className="grid gap-3 md:grid-cols-[260px_1fr]"><label className="text-xs font-medium text-muted-foreground">{es?"Otra disposición":"Other disposition"}<select value={decision.disposition} onChange={e=>setDecision({...decision,disposition:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">{["refer_only","information_only","ineligible","duplicate","no_follow_up"].map(v=><option key={v} value={v}>{v.replaceAll("_"," ")}</option>)}</select></label><label className="text-xs font-medium text-muted-foreground">{es?"Razón documentada":"Documented reason"}<input value={decision.reason} onChange={e=>setDecision({...decision,reason:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/></label></div>
        <button type="button" disabled={decision.reason.trim().length<3||completeM.isPending} onClick={()=>completeM.mutate()} className="mt-3 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{es?"Concluir sin abrir caso":"Complete without opening case"}</button>
      </div>
    </section>}
  </div>;
}
