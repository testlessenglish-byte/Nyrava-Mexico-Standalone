import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assessmentInput, carePlanInput, consentInput, referralInput,
  socialCaseInput, socialFamilyInput, socialPersonInput, socialSearchInput,
} from "@/lib/social/types";
import { z } from "zod";

const uuid=z.string().uuid();
type AuthContext={supabase:any;userId:string};
function ctx(context:unknown):AuthContext {
  const c=context as AuthContext;
  if(!c?.supabase||!c.userId) throw new Error("Sesión requerida / Signed-in session required");
  return c;
}
function fail(error:{message?:string}|null){if(error) throw new Error(error.message||"Social-care operation failed");}

export const getSocialWorkspace=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .handler(async({context})=>{
    const {supabase,userId}=ctx(context);
    const {data:organizations,error:orgError}=await supabase.from("organizations").select("id,name").order("name");
    fail(orgError);
    const orgIds=(organizations??[]).map((o:any)=>o.id);
    if(!orgIds.length) return {organizations:[],programs:[],offices:[],cases:[],people:[],alerts:[],stats:{active:0,critical:0,overdue:0,unverifiedReferrals:0},userId};
    const [programs,offices,cases,people,alerts,referrals,tasks]=await Promise.all([
      supabase.from("social_programs").select("id,org_id,name_es,name_en,case_prefix,active").in("org_id",orgIds).eq("active",true).order("name_es"),
      supabase.from("social_offices").select("id,org_id,name,location,active").in("org_id",orgIds).eq("active",true).order("name"),
      supabase.from("social_cases").select("id,org_id,program_id,case_number,case_type,status,priority,risk_level,last_activity_at,next_required_action,person_id,family_id,assigned_case_manager").in("org_id",orgIds).is("deleted_at",null).order("last_activity_at",{ascending:false}).limit(100),
      supabase.from("social_people").select("id,org_id,person_number,legal_name,preferred_name,telephone,email,consent_status,record_status").in("org_id",orgIds).is("deleted_at",null).order("updated_at",{ascending:false}).limit(100),
      supabase.from("social_alerts").select("id,org_id,social_case_id,alert_type,severity,title_es,title_en,due_at").in("org_id",orgIds).is("resolved_at",null).order("due_at",{ascending:true}).limit(100),
      supabase.from("social_referrals").select("id,status").in("org_id",orgIds).neq("status","completed"),
      supabase.from("social_tasks").select("id,status,due_at").in("org_id",orgIds).neq("status","done"),
    ]);
    [programs,offices,cases,people,alerts,referrals,tasks].forEach((r:any)=>fail(r.error));
    const now=Date.now();
    const caseRows=cases.data??[];
    return {
      organizations:organizations??[],programs:programs.data??[],offices:offices.data??[],
      cases:caseRows,people:people.data??[],alerts:alerts.data??[],userId,
      stats:{
        active:caseRows.filter((c:any)=>!["closed","archived","transferred"].includes(c.status)).length,
        critical:caseRows.filter((c:any)=>c.risk_level==="critical").length,
        overdue:(tasks.data??[]).filter((t:any)=>t.due_at&&new Date(t.due_at).getTime()<now).length,
        unverifiedReferrals:(referrals.data??[]).filter((r:any)=>["sent","received","appointment_scheduled","in_progress"].includes(r.status)).length,
      },
    };
  });

export const searchSocialRecords=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>socialSearchInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:rows,error}=await supabase.rpc("search_social_case_management",{
      p_org:data.orgId,p_query:data.query,p_status:data.status??null,
      p_risk:data.riskLevel??null,p_assignee:null,p_limit:data.limit,
    });
    fail(error); return rows??[];
  });

export const findPossibleSocialPeople=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({orgId:uuid,name:z.string().trim().min(2).max(240),dateOfBirth:z.string().date().optional(),phone:z.string().max(50).optional(),email:z.string().email().optional(),limit:z.number().int().min(1).max(20).default(10)}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:rows,error}=await supabase.rpc("find_possible_social_people",{
      p_org:data.orgId,p_name:data.name,p_date_of_birth:data.dateOfBirth??null,
      p_phone:data.phone??null,p_email:data.email??null,p_limit:data.limit,
    });
    fail(error);return rows??[];
  });

export const createSocialPerson=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>socialPersonInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:row,error}=await supabase.from("social_people").insert({
      org_id:data.orgId,person_number:null,legal_name:data.legalName,
      preferred_name:data.preferredName||null,aliases:data.aliases,
      date_of_birth:data.dateOfBirth||null,approximate_age:data.approximateAge??null,
      nationality:data.nationality||null,languages:data.languages,telephone:data.telephone||null,
      email:data.email||null,current_location:data.currentLocation,
      immigration_identifiers:data.immigrationIdentifiers,is_minor:data.isMinor??null,
      unaccompanied_minor:data.unaccompaniedMinor,separated_minor:data.separatedMinor,
      created_by:userId,
    }).select("id,person_number,legal_name").single();
    fail(error);return row;
  });

export const createSocialFamily=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>socialFamilyInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:family,error}=await supabase.rpc("create_social_family",{
      p_org:data.orgId,p_name:data.familyName,p_primary:data.primaryContactPersonId??null,
      p_location:data.currentLocation,p_members:data.memberIds,
    });
    fail(error);return family;
  });

export const createSocialCase=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>socialCaseInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:row,error}=await supabase.from("social_cases").insert({
      org_id:data.orgId,program_id:data.programId,case_number:null,
      person_id:data.personId??null,family_id:data.familyId??null,case_type:data.caseType,
      referral_source:data.referralSource||null,service_areas:data.serviceAreas,
      priority:data.priority,risk_level:data.riskLevel,
      confidentiality_level:data.confidentialityLevel,tags:data.tags,
      assigned_case_manager:userId,created_by:userId,
    }).select("id,case_number,status").single();
    fail(error);return row;
  });

export const getSocialCase=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const [caseRow,assessments,plans,interventions,referrals,tasks,appointments,documents,consents,transfers,closures,activity]=await Promise.all([
      supabase.from("social_cases").select("*").eq("id",data.caseId).single(),
      supabase.from("social_assessments").select("*,social_assessment_versions(*)").eq("social_case_id",data.caseId).order("assessment_date",{ascending:false}),
      supabase.from("social_care_plans").select("*,social_care_plan_versions(*,social_care_plan_goals(*))").eq("social_case_id",data.caseId).order("created_at",{ascending:false}),
      supabase.from("social_interventions").select("*").eq("social_case_id",data.caseId).order("occurred_at",{ascending:false}),
      supabase.from("social_referrals").select("*,social_referral_updates(*)").eq("social_case_id",data.caseId).order("created_at",{ascending:false}),
      supabase.from("social_tasks").select("*").eq("social_case_id",data.caseId).order("due_at",{ascending:true}),
      supabase.from("social_appointments").select("*").eq("social_case_id",data.caseId).order("scheduled_at",{ascending:true}),
      supabase.from("social_documents").select("id,title,document_type,record_type,sensitivity,current_version,checksum,mime_type,size_bytes,created_at").eq("social_case_id",data.caseId).is("deleted_at",null),
      supabase.from("social_consents").select("*,social_consent_versions(*)").order("created_at",{ascending:false}),
      supabase.from("social_case_transfers").select("*,social_case_transfer_items(*)").eq("social_case_id",data.caseId).order("created_at",{ascending:false}),
      supabase.from("social_case_closures").select("*").eq("social_case_id",data.caseId).order("closure_version",{ascending:false}),
      supabase.from("social_activity_events").select("id,actor_id,event_type,entity_type,entity_id,metadata,occurred_at").eq("social_case_id",data.caseId).order("occurred_at",{ascending:false}).limit(100),
    ]);
    [caseRow,assessments,plans,interventions,referrals,tasks,appointments,documents,consents,transfers,closures,activity].forEach((r:any)=>fail(r.error));
    const c=caseRow.data;
    const consentRows=(consents.data??[]).filter((x:any)=>x.person_id===c.person_id||x.family_id===c.family_id);
    return {case:c,assessments:assessments.data??[],plans:plans.data??[],interventions:interventions.data??[],referrals:referrals.data??[],tasks:tasks.data??[],appointments:appointments.data??[],documents:documents.data??[],consents:consentRows,transfers:transfers.data??[],closures:closures.data??[],activity:activity.data??[]};
  });

export const recordSocialAssessment=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>assessmentInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:existing,error:existingError}=await supabase.from("social_assessments")
      .select("id,current_version").eq("social_case_id",data.socialCaseId)
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    fail(existingError);
    if(existing){
      const {data:version,error}=await supabase.rpc("record_social_assessment",{
        p_assessment:existing.id,p_risk_level:data.riskLevel,p_evidence:data.evidenceObservations??null,
        p_reason:data.reason,p_protective_factors:data.protectiveFactors??null,
        p_immediate_actions:data.immediateActions??null,p_required_follow_up:data.requiredFollowUp??null,
        p_answers:data.answers,p_next_review:data.nextReviewDate??null,p_override:data.professionalOverride,
        p_override_explanation:data.overrideExplanation??null,
      });fail(error);return {assessmentId:existing.id,version};
    }
    const {data:assessmentId,error}=await supabase.rpc("create_social_assessment_initial",{
      p_case:data.socialCaseId,p_template:data.templateId??null,p_risk:data.riskLevel,
      p_evidence:data.evidenceObservations??null,p_reason:data.reason,
      p_protective:data.protectiveFactors??null,p_actions:data.immediateActions??null,
      p_follow_up:data.requiredFollowUp??null,p_answers:data.answers,
      p_review:data.nextReviewDate??null,p_override:data.professionalOverride,
      p_override_explanation:data.overrideExplanation??null,
    });fail(error);return {assessmentId,version:1};
  });

export const createSocialCarePlan=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>carePlanInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:planId,error}=await supabase.rpc("create_social_care_plan",{
      p_case:data.socialCaseId,p_summary:data.summary,p_status:data.status,p_goals:data.goals,
    });
    fail(error);return {planId,version:1};
  });

export const createSocialConsent=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>consentInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:consentId,error}=await supabase.rpc("create_social_consent",{
      p_org:data.orgId,p_person:data.personId??null,p_family:data.familyId??null,
      p_type:data.consentType,p_language:data.language,p_consented_by:data.consentedByName,
      p_guardian:data.guardianRepresentative??null,p_purposes:data.permittedPurposes,
      p_recipients:data.permittedRecipients,p_information:data.permittedInformation,
      p_restrictions:data.restrictions??null,p_expires:data.expiresAt??null,
      p_confirmation:{method:"recorded_in_app",confirmed_at:new Date().toISOString()},
    });
    fail(error);return {consentId,version:1};
  });

export const createSocialReferral=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>referralInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id,person_id,family_id").eq("id",data.socialCaseId).single();fail(caseError);
    const status=data.consentId?"draft":"awaiting_consent";
    const {data:row,error}=await supabase.from("social_referrals").insert({org_id:c.org_id,social_case_id:data.socialCaseId,referral_number:null,person_id:data.personId??c.person_id,family_id:data.familyId??c.family_id,receiving_institution_id:data.institutionId,service_requested:data.serviceRequested,reason:data.reason,urgency:data.urgency,consent_id:data.consentId??null,authorized_information:data.authorizedInformation,status,created_by:userId}).select("id,referral_number,status").single();fail(error);return row;
  });

export const revokeSocialConsent=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({consentId:uuid,reason:z.string().trim().min(3).max(1000)}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {error}=await supabase.from("social_consents").update({status:"revoked",revoked_at:new Date().toISOString()}).eq("id",data.consentId);fail(error);
    return {ok:true,reason:data.reason};
  });


const recordType=z.enum(["general_case_record","social_work_record","legal_privileged_record","psychosocial_restricted_record","medical_restricted_record","child_protection_restricted_record"]);

export const recordSocialIntervention=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({
    socialCaseId:uuid,occurredAt:z.string().datetime(),serviceType:z.string().trim().min(2).max(120),
    locationMethod:z.string().trim().max(240).optional(),reason:z.string().trim().min(2).max(5000),
    actionsTaken:z.string().trim().min(2).max(10000),outcome:z.string().trim().max(5000).optional(),
    followUpRequired:z.boolean().default(false),recordType:recordType.default("general_case_record"),
    confidentialityLevel:z.enum(["standard","confidential","restricted","highly_restricted"]).default("standard"),
    nextAppointment:z.string().datetime().optional(),
  }).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id,person_id,family_id").eq("id",data.socialCaseId).single();fail(caseError);
    const {data:row,error}=await supabase.from("social_interventions").insert({
      org_id:c.org_id,social_case_id:data.socialCaseId,person_id:c.person_id,family_id:c.family_id,
      occurred_at:data.occurredAt,service_type:data.serviceType,professional_id:userId,
      location_method:data.locationMethod??null,reason:data.reason,actions_taken:data.actionsTaken,
      outcome:data.outcome??null,follow_up_required:data.followUpRequired,record_type:data.recordType,
      confidentiality_level:data.confidentialityLevel,next_appointment:data.nextAppointment??null,
    }).select("id").single();fail(error);return row;
  });

export const upsertSocialTask=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({
    id:uuid.optional(),socialCaseId:uuid,title:z.string().trim().min(2).max(300),
    description:z.string().trim().max(4000).optional(),assigneeId:uuid.optional(),
    priority:z.enum(["low","normal","high","urgent"]).default("normal"),
    status:z.enum(["todo","in_progress","blocked","done","cancelled"]).default("todo"),
    dueAt:z.string().datetime().optional(),reminderAt:z.string().datetime().optional(),
    recurrence:z.record(z.string(),z.unknown()).optional(),
  }).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id").eq("id",data.socialCaseId).single();fail(caseError);
    const row={org_id:c.org_id,social_case_id:data.socialCaseId,title:data.title,description:data.description??null,assignee_id:data.assigneeId??userId,priority:data.priority,status:data.status,due_at:data.dueAt??null,reminder_at:data.reminderAt??null,recurrence:data.recurrence??null,completed_at:data.status==="done"?new Date().toISOString():null,created_by:userId};
    const q=data.id?supabase.from("social_tasks").update(row).eq("id",data.id):supabase.from("social_tasks").insert(row);
    const {data:saved,error}=await q.select("id,status,due_at").single();fail(error);return saved;
  });

export const closeSocialCase=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({
    caseId:uuid,reason:z.enum(["services_completed","client_withdrew","unable_to_contact","transferred","ineligible","relocated","duplicate_case","other"]),
    finalRisk:z.enum(["unknown","low","moderate","high","critical"]),
    summary:z.record(z.string(),z.unknown()).default({}),
  }).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);const {data:id,error}=await supabase.rpc("close_social_case",{p_case:data.caseId,p_reason:data.reason,p_final_risk:data.finalRisk,p_summary:data.summary});fail(error);return {closureId:id};
  });

export const reopenSocialCase=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid,reason:z.string().trim().min(3).max(2000)}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("reopen_social_case",{p_case:data.caseId,p_reason:data.reason});fail(error);return {ok:true};});

export const createSocialTransfer=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({
    socialCaseId:uuid,transferType:z.enum(["case_manager","office","service_team","external_organization","social_to_legal","legal_to_social"]),
    toUserId:uuid.optional(),toOfficeId:uuid.optional(),receivingOrgId:uuid.optional(),consentId:uuid.optional(),
    selectedInformation:z.record(z.string(),z.unknown()).default({}),restrictedInformation:z.record(z.string(),z.unknown()).default({}),
    summary:z.string().trim().min(3).max(10000),deadlines:z.array(z.unknown()).default([]),
  }).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id,assigned_case_manager").eq("id",data.socialCaseId).single();fail(caseError);
    const {data:row,error}=await supabase.from("social_case_transfers").insert({org_id:c.org_id,social_case_id:data.socialCaseId,transfer_type:data.transferType,from_user_id:c.assigned_case_manager,to_user_id:data.toUserId??null,to_office_id:data.toOfficeId??null,receiving_org_id:data.receivingOrgId??null,consent_id:data.consentId??null,selected_information:data.selectedInformation,restricted_information:data.restrictedInformation,transfer_summary:data.summary,deadlines:data.deadlines,status:"pending_approval",created_by:userId}).select("id,status").single();fail(error);return row;
  });

export const acceptSocialTransfer=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({transferId:uuid}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("accept_social_transfer",{p_transfer:data.transferId});fail(error);return {ok:true};});

export const linkSocialImmigrationMatter=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({
    socialCaseId:uuid,immigrationCaseId:uuid,consentId:uuid,
    permittedStatusFields:z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    sharedSocialFields:z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    sharedDocumentIds:z.array(uuid).max(100).default([]),
    nonRefoulementConcern:z.boolean().default(false),detentionDeportationRisk:z.boolean().default(false),
  }).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id").eq("id",data.socialCaseId).single();fail(caseError);
    const {data:row,error}=await supabase.from("social_immigration_links").insert({org_id:c.org_id,social_case_id:data.socialCaseId,immigration_case_id:data.immigrationCaseId,consent_id:data.consentId,permitted_status_fields:data.permittedStatusFields,shared_social_fields:data.sharedSocialFields,shared_document_ids:data.sharedDocumentIds,non_refoulement_concern:data.nonRefoulementConcern,detention_deportation_risk:data.detentionDeportationRisk,created_by:userId}).select("id").single();fail(error);return row;
  });

export const getSocialIndicators=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({orgId:uuid,from:z.string().date(),to:z.string().date(),programId:uuid.optional(),officeId:uuid.optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);const {data:rows,error}=await supabase.rpc("social_indicator_summary",{p_org:data.orgId,p_from:data.from,p_to:data.to,p_program:data.programId??null,p_office:data.officeId??null});fail(error);return rows??[];
  });

export const prepareSocialDocumentUpload=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({orgId:uuid,socialCaseId:uuid,recordType:recordType,fileName:z.string().trim().min(1).max(240)}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const safe=data.fileName.replace(/[^a-zA-Z0-9._-]+/g,"_");
    const path=`${data.orgId}/${data.socialCaseId}/${data.recordType}/${crypto.randomUUID()}-${safe}`;
    const {data:signed,error}=await supabase.storage.from("social-case-files").createSignedUploadUrl(path);fail(error);
    return {path,token:signed.token,signedUrl:signed.signedUrl};
  });
