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
    const empty={organizations:[],programs:[],offices:[],cases:[],people:[],families:[],alerts:[],institutions:[],templates:[],roleAssignments:[],recentActivity:[],stats:{active:0,critical:0,overdue:0,unverifiedReferrals:0},userId};
    if(!orgIds.length)return empty;
    const [programs,offices,cases,people,families,alerts,referrals,tasks,institutions,templates,roleAssignments,recentActivity]=await Promise.all([
      supabase.from("social_programs").select("id,org_id,name_es,name_en,case_prefix,active,settings").in("org_id",orgIds).eq("active",true).order("name_es"),
      supabase.from("social_offices").select("id,org_id,name,address,active").in("org_id",orgIds).eq("active",true).order("name"),
      supabase.from("social_cases").select("id,org_id,program_id,case_number,case_type,status,priority,risk_level,last_activity_at,next_required_action,person_id,family_id,assigned_case_manager,supervising_manager,service_areas,confidentiality_level,consent_status").in("org_id",orgIds).is("deleted_at",null).order("last_activity_at",{ascending:false}).limit(250),
      supabase.from("social_people").select("id,org_id,person_number,legal_name,preferred_name,telephone,email,consent_status,record_status").in("org_id",orgIds).is("deleted_at",null).order("updated_at",{ascending:false}).limit(250),
      supabase.from("social_families").select("id,org_id,family_number,family_name,primary_contact_person_id,assigned_case_manager,current_location").in("org_id",orgIds).is("deleted_at",null).order("updated_at",{ascending:false}).limit(250),
      supabase.from("social_alerts").select("id,org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,acknowledged_at").in("org_id",orgIds).is("resolved_at",null).order("due_at",{ascending:true}).limit(250),
      supabase.from("social_referrals").select("id,status").in("org_id",orgIds).neq("status","completed"),
      supabase.from("social_tasks").select("id,status,due_at").in("org_id",orgIds).neq("status","done"),
      supabase.from("social_institutions").select("id,org_id,name,institution_type,services,active").or(`org_id.is.null,org_id.in.(${orgIds.join(",")})`).eq("active",true).order("name"),
      supabase.from("social_assessment_templates").select("id,org_id,code,version,name_es,name_en,schema").or(`org_id.is.null,org_id.in.(${orgIds.join(",")})`).eq("active",true).order("name_es"),
      supabase.from("social_role_assignments").select("id,org_id,user_id,role,scope_type,scope_id,active,ends_at").in("org_id",orgIds).eq("active",true),
      supabase.from("social_activity_events").select("id,org_id,social_case_id,actor_id,event_type,entity_type,occurred_at").in("org_id",orgIds).order("occurred_at",{ascending:false}).limit(100),
    ]);
    [programs,offices,cases,people,families,alerts,referrals,tasks,institutions,templates,roleAssignments,recentActivity].forEach((r:any)=>fail(r.error));
    const now=Date.now();const caseRows=cases.data??[];
    return {
      organizations:organizations??[],programs:programs.data??[],offices:offices.data??[],
      cases:caseRows,people:people.data??[],families:families.data??[],alerts:alerts.data??[],
      institutions:institutions.data??[],templates:templates.data??[],
      roleAssignments:roleAssignments.data??[],recentActivity:recentActivity.data??[],userId,
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
    const {supabase}=ctx(context);
    const {data:row,error}=await supabase.rpc("create_social_person",{
      p_org:data.orgId,p_legal_name:data.legalName,p_preferred_name:data.preferredName??null,
      p_aliases:data.aliases,p_date_of_birth:data.dateOfBirth??null,
      p_approximate_age:data.approximateAge??null,p_nationality:data.nationality??null,
      p_languages:data.languages,p_telephone:data.telephone??null,p_email:data.email||null,
      p_current_location:data.currentLocation,p_immigration_identifiers:data.immigrationIdentifiers,
      p_is_minor:data.isMinor??null,p_unaccompanied_minor:data.unaccompaniedMinor,
      p_separated_minor:data.separatedMinor,
    });
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
    const {supabase}=ctx(context);
    const {data:row,error}=await supabase.rpc("create_social_case",{
      p_org:data.orgId,p_program:data.programId,p_person:data.personId??null,
      p_family:data.familyId??null,p_case_type:data.caseType,
      p_referral_source:data.referralSource??null,p_service_areas:data.serviceAreas,
      p_priority:data.priority,p_risk_level:data.riskLevel,
      p_confidentiality_level:data.confidentialityLevel,p_tags:data.tags,
    });
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
  .inputValidator((d:unknown)=>z.object({orgId:uuid,socialCaseId:uuid,recordType:recordType,fileName:z.string().trim().min(1).max(240),mimeType:z.string().trim().max(200).optional(),sizeBytes:z.number().int().positive().max(104857600).optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:socialCase,error:caseError}=await supabase.from("social_cases")
      .select("org_id").eq("id",data.socialCaseId).single();
    fail(caseError);
    if(!socialCase?.org_id||socialCase.org_id!==data.orgId) throw new Error("Case does not belong to the selected organization");
    const allowed=["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/jpeg","image/png","image/webp","image/tiff","application/zip"];
    const media=["audio/mpeg","audio/wav","audio/mp4","video/mp4","video/quicktime","video/webm"];
    if(data.mimeType&&!allowed.includes(data.mimeType)&&!media.includes(data.mimeType)) throw new Error("Unsupported Social document format");
    if(data.mimeType&&media.includes(data.mimeType)){
      const {data:programs,error:settingsError}=await supabase.from("social_programs").select("settings").eq("org_id",data.orgId).eq("active",true);fail(settingsError);
      if(!(programs??[]).some((p:any)=>p.settings?.allow_media_uploads===true)) throw new Error("Audio and video uploads are not enabled for this organization");
    }
    const safe=data.fileName.replace(/[^a-zA-Z0-9._-]+/g,"_");
    const path=`${socialCase.org_id}/${data.socialCaseId}/${data.recordType}/${crypto.randomUUID()}-${safe}`;
    const {data:signed,error}=await supabase.storage.from("social-case-files").createSignedUploadUrl(path);fail(error);
    return {path,token:signed.token,signedUrl:signed.signedUrl};
  });


export const ensureSocialProgram=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({
    orgId:uuid,nameEs:z.string().trim().min(2).max(160).default("Atención Integral"),
    nameEn:z.string().trim().min(2).max(160).default("Comprehensive Care"),
    prefix:z.string().trim().regex(/^[A-Z0-9-]{2,20}$/).default("NYR-SOC"),
  }).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:program,error}=await supabase.rpc("ensure_social_program_for_org",{
      p_org:data.orgId,p_name_es:data.nameEs,p_name_en:data.nameEn,p_prefix:data.prefix,
    });fail(error);return program;
  });


export const approveSocialCarePlan=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({planId:uuid,version:z.number().int().min(1)}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("approve_social_care_plan",{p_plan:data.planId,p_version:data.version});fail(error);return {ok:true};});

export const assignSocialCaseManager=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid,userId:uuid,role:z.enum(["case_manager","supervisor","attorney","psychologist","social_worker"])}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("assign_social_case_manager",{p_case:data.caseId,p_user:data.userId,p_role:data.role});fail(error);return {ok:true};});

export const sendSocialReferral=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({referralId:uuid,purpose:z.string().trim().min(2).max(240),sharedFields:z.record(z.string(),z.unknown()),expiresAt:z.string().datetime().optional()}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("send_social_referral",{p_referral:data.referralId,p_purpose:data.purpose,p_shared_fields:data.sharedFields,p_expires:data.expiresAt??null});fail(error);return {ok:true};});

export const verifySocialReferralResult=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({referralId:uuid,result:z.string().trim().min(2).max(5000),response:z.string().trim().max(5000).optional(),closureReason:z.string().trim().max(1000).optional()}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("verify_social_referral_result",{p_referral:data.referralId,p_result:data.result,p_response:data.response??null,p_closure_reason:data.closureReason??null});fail(error);return {ok:true};});

export const advanceSocialTransfer=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({transferId:uuid,action:z.enum(["approve","send","reject"])}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("advance_social_transfer",{p_transfer:data.transferId,p_action:data.action});fail(error);return {ok:true};});

export const refreshSocialAlerts=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {data:created,error}=await supabase.rpc("refresh_social_case_alerts",{p_case:data.caseId});fail(error);return {created:created??0};});

export const acknowledgeSocialAlert=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({alertId:uuid,resolve:z.boolean().default(false)}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const now=new Date().toISOString();const {error}=await supabase.from("social_alerts").update({acknowledged_at:now,...(data.resolve?{resolved_at:now}:{})}).eq("id",data.alertId);fail(error);return {ok:true};});

export const createSocialAppointment=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({socialCaseId:uuid,title:z.string().trim().min(2).max(300),scheduledAt:z.string().datetime(),durationMinutes:z.number().int().min(5).max(1440).optional(),locationMethod:z.string().trim().max(300).optional(),personId:uuid.optional()}).parse(d))
  .handler(async({data,context})=>{const {supabase,userId}=ctx(context);const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id,person_id").eq("id",data.socialCaseId).single();fail(caseError);const {data:row,error}=await supabase.from("social_appointments").insert({org_id:c.org_id,social_case_id:data.socialCaseId,person_id:data.personId??c.person_id,title:data.title,scheduled_at:data.scheduledAt,duration_minutes:data.durationMinutes??null,location_method:data.locationMethod??null,professional_id:userId,status:"scheduled",created_by:userId}).select("id").single();fail(error);return row;});

export const finalizeSocialDocumentUpload=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({socialCaseId:uuid,path:z.string().min(20).max(1000),title:z.string().trim().min(1).max(300),documentType:z.string().trim().max(120).optional(),recordType:recordType,sensitivity:z.enum(["standard","confidential","restricted","highly_restricted"]).default("confidential"),consentId:uuid.optional(),extractionAuthorized:z.boolean().default(false),mimeType:z.string().trim().max(200).optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:c,error:caseError}=await supabase.from("social_cases").select("person_id,family_id").eq("id",data.socialCaseId).single();fail(caseError);
    const {data:file,error:downloadError}=await supabase.storage.from("social-case-files").download(data.path);fail(downloadError);
    const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest("SHA-256",bytes);
    const checksum=Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");
    const {data:duplicate,error:duplicateError}=await supabase.from("social_documents").select("id,title,current_version").eq("social_case_id",data.socialCaseId).eq("checksum",checksum).is("deleted_at",null).maybeSingle();fail(duplicateError);
    if(duplicate){await supabase.storage.from("social-case-files").remove([data.path]);return {documentId:duplicate.id,checksum,size:file.size,duplicate:true,duplicateTitle:duplicate.title};}
    const {data:documentId,error}=await supabase.rpc("register_social_document",{p_case:data.socialCaseId,p_person:c.person_id,p_family:c.family_id,p_title:data.title,p_document_type:data.documentType??null,p_record_type:data.recordType,p_sensitivity:data.sensitivity,p_consent:data.consentId??null,p_storage_path:data.path,p_checksum:checksum,p_mime:data.mimeType||file.type||null,p_size:file.size,p_extraction_authorized:data.extractionAuthorized});
    fail(error);return {documentId,checksum,size:file.size,duplicate:false};
  });


const socialRole=z.enum(["organization_owner","program_director","case_management_supervisor","case_manager","social_worker","attorney","legal_assistant","psychologist","medical_professional","referral_coordinator","data_analyst","auditor","read_only_reviewer","external_partner"]);

export const upsertSocialRoleAssignment=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({orgId:uuid,userId:uuid,role:socialRole,scopeType:z.enum(["organization","program","office","case"]).default("organization"),scopeId:uuid.optional(),endsAt:z.string().datetime().optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    let existing=supabase.from("social_role_assignments").select("id").eq("org_id",data.orgId).eq("user_id",data.userId).eq("role",data.role).eq("scope_type",data.scopeType);
    existing=data.scopeId?existing.eq("scope_id",data.scopeId):existing.is("scope_id",null);
    const {data:row,error:lookupError}=await existing.maybeSingle();fail(lookupError);
    if(row?.id){const {error}=await supabase.from("social_role_assignments").update({active:true,ends_at:data.endsAt??null,assigned_by:userId}).eq("id",row.id);fail(error);return {id:row.id};}
    const {data:created,error}=await supabase.from("social_role_assignments").insert({org_id:data.orgId,user_id:data.userId,role:data.role,scope_type:data.scopeType,scope_id:data.scopeId??null,active:true,ends_at:data.endsAt??null,assigned_by:userId}).select("id").single();fail(error);return created;
  });

export const grantSocialRecordAccess=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid,userId:uuid,recordType:recordType,canWrite:z.boolean().default(false),reason:z.string().trim().min(5).max(1000),expiresAt:z.string().datetime().optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:c,error:caseError}=await supabase.from("social_cases").select("org_id").eq("id",data.caseId).single();fail(caseError);
    const {data:row,error}=await supabase.from("social_record_grants").insert({org_id:c.org_id,social_case_id:data.caseId,user_id:data.userId,record_type:data.recordType,can_read:true,can_write:data.canWrite,expires_at:data.expiresAt??null,granted_by:userId,reason:data.reason}).select("id").single();fail(error);return row;
  });

export const shareSocialDocument=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({documentId:uuid,receivingOrgId:uuid,consentId:uuid,purpose:z.string().trim().min(2).max(300),expiresAt:z.string().datetime().optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:document,error:documentError}=await supabase.from("social_documents").select("org_id").eq("id",data.documentId).single();fail(documentError);
    const {data:row,error}=await supabase.from("social_document_shares").insert({org_id:document.org_id,document_id:data.documentId,receiving_org_id:data.receivingOrgId,consent_id:data.consentId,purpose:data.purpose,expires_at:data.expiresAt??null,created_by:userId}).select("id").single();fail(error);return row;
  });


const resourceSearchInput=z.object({
  query:z.string().trim().max(200).optional(),state:z.string().trim().max(10).optional(),municipality:z.string().trim().max(120).optional(),
  latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),radiusKm:z.number().positive().max(1000).optional(),
  service:z.string().trim().max(100).optional(),urgency:z.enum(["standard","urgent","emergency"]).optional(),
  population:z.string().trim().max(100).optional(),language:z.string().trim().max(80).optional(),
  costType:z.enum(["free","sliding_scale","paid","public_coverage","unknown"]).optional(),availability:z.string().trim().max(60).optional(),
});

export const searchResourceNetwork=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>resourceSearchInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:rows,error}=await supabase.rpc("search_resource_network",{
      p_query:data.query||null,p_state:data.state||null,p_municipality:data.municipality||null,
      p_latitude:data.latitude??null,p_longitude:data.longitude??null,p_radius_km:data.radiusKm??null,
      p_service:data.service||null,p_urgency:data.urgency||null,p_population:data.population||null,
      p_language:data.language||null,p_cost_type:data.costType||null,p_availability:data.availability||null,p_limit:60,
    });
    fail(error);return rows??[];
  });

export const findResourcesForSocialCase=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid,service:z.string().trim().max(100).optional(),urgency:z.enum(["standard","urgent","emergency"]).optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const {data:c,error:caseError}=await supabase.from("social_cases").select("id,org_id,service_areas,risk_level,person_id,family_id").eq("id",data.caseId).single();fail(caseError);
    const {data:person,error:personError}=await supabase.from("social_people").select("current_location,languages,nationality").eq("id",c.person_id).maybeSingle();
    if(personError&&personError.code!=="PGRST116")fail(personError);
    const location=(person?.current_location??{}) as Record<string,unknown>;
    const service=data.service||c.service_areas?.[0]||undefined;
    const urgency=data.urgency||(c.risk_level==="critical"?"emergency":c.risk_level==="high"?"urgent":"standard");
    const {data:rows,error}=await supabase.rpc("search_resource_network",{
      p_query:null,p_state:typeof location.state_code==="string"?location.state_code:null,
      p_municipality:typeof location.municipality==="string"?location.municipality:null,
      p_latitude:typeof location.latitude==="number"?location.latitude:null,p_longitude:typeof location.longitude==="number"?location.longitude:null,
      p_radius_km:null,p_service:service??null,p_urgency:urgency,p_population:null,
      p_language:Array.isArray(person?.languages)?person.languages[0]??null:null,p_cost_type:null,p_availability:null,p_limit:25,
    });
    fail(error);
    return {recommendations:rows??[],context:{service,urgency,locationUsed:Boolean(location.state_code||location.municipality)},notice:"Recommendations are ranked from authorized case fields. Staff must review eligibility, availability, consent, and final suitability."};
  });

export const getResourceNetworkMetadata=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .handler(async({context})=>{
    const {supabase}=ctx(context);
    const [categories,knowledge,organizations]=await Promise.all([
      supabase.from("resource_service_categories").select("id,org_id,code,name_es,name_en,description_es,description_en,sort_order").eq("active",true).order("sort_order"),
      supabase.from("resource_knowledge_records").select("id,org_id,title_es,title_en,summary_es,summary_en,knowledge_type,service_categories,state_codes,municipality,population_tags,source_url,document_path,version,approval_status,effective_at,review_due_at,internal_only,updated_at").order("updated_at",{ascending:false}).limit(250),
      supabase.from("organizations").select("id,name").order("name"),
    ]);
    fail(categories.error);fail(knowledge.error);fail(organizations.error);
    return {categories:categories.data??[],knowledge:knowledge.data??[],organizations:organizations.data??[]};
  });

const resourceAdminInput=z.object({
  id:uuid.optional(),orgId:uuid.nullable().optional(),officialName:z.string().trim().min(2).max(240),institutionType:z.string().trim().min(2).max(100),
  description:z.string().trim().max(3000).optional(),services:z.array(z.string().trim().min(1).max(100)).max(50).default([]),stateCode:z.string().trim().max(10).optional(),
  municipality:z.string().trim().max(120).optional(),address:z.string().trim().max(500).optional(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),
  phone:z.string().trim().max(80).optional(),whatsapp:z.string().trim().max(80).optional(),email:z.string().email().optional().or(z.literal("")),website:z.string().url().optional().or(z.literal("")),
  languages:z.array(z.string()).max(30).default([]),populations:z.array(z.string()).max(50).default([]),eligibility:z.string().max(3000).optional(),requiredDocuments:z.array(z.string()).max(50).default([]),
  costType:z.enum(["free","sliding_scale","paid","public_coverage","unknown"]).default("unknown"),appointmentRequired:z.boolean().default(false),walkInAvailable:z.boolean().default(false),
  emergencyAvailable:z.boolean().default(false),remoteAvailable:z.boolean().default(false),referralMethods:z.array(z.string()).max(30).default([]),coverageLevels:z.array(z.string()).max(10).default([]),
  capacityStatus:z.string().max(60).default("unknown"),locationConfidential:z.boolean().default(false),publicNotes:z.string().max(3000).optional(),internalNotes:z.string().max(5000).optional(),
});

export const saveResourceInstitution=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>resourceAdminInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const payload={org_id:data.orgId??null,name:data.officialName,official_name:data.officialName,institution_type:data.institutionType,description:data.description||null,services:data.services,
      state_code:data.stateCode||null,municipality:data.municipality||null,address:data.address||null,latitude:data.latitude??null,longitude:data.longitude??null,phone:data.phone||null,whatsapp:data.whatsapp||null,
      email:data.email||null,website:data.website||null,languages:data.languages,populations:data.populations,eligibility:data.eligibility||null,required_documents:data.requiredDocuments,cost_type:data.costType,
      appointment_required:data.appointmentRequired,walk_in_available:data.walkInAvailable,emergency_available:data.emergencyAvailable,remote_available:data.remoteAvailable,
      referral_methods:data.referralMethods,coverage_levels:data.coverageLevels,capacity_status:data.capacityStatus,location_confidential:data.locationConfidential,
      public_notes:data.publicNotes||null,internal_notes:data.internalNotes||null,active:true,updated_at:new Date().toISOString()};
    const query=data.id?supabase.from("social_institutions").update(payload).eq("id",data.id):supabase.from("social_institutions").insert(payload);
    const {data:row,error}=await query.select("id,official_name,status").single();fail(error);return row;
  });

export const verifyResourceInstitution=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({institutionId:uuid,status:z.enum(["verified","verification_due","unverified","temporarily_unavailable","at_capacity","closed","archived"]),source:z.string().trim().min(2).max(500),evidenceUrl:z.string().url().optional().or(z.literal("")),notes:z.string().max(2000).optional(),nextVerificationAt:z.string().datetime().optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);const {data:id,error}=await supabase.rpc("verify_resource",{p_institution:data.institutionId,p_status:data.status,p_source:data.source,p_evidence_url:data.evidenceUrl||null,p_notes:data.notes||null,p_next_verification:data.nextVerificationAt||null});fail(error);return {verificationId:id};
  });

export const submitResourceCorrection=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({institutionId:uuid,orgId:uuid.nullable().optional(),fieldName:z.string().max(100).optional(),suggestedValue:z.string().max(2000).optional(),reason:z.string().trim().min(5).max(2000)}).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);const {data:row,error}=await supabase.from("resource_corrections").insert({institution_id:data.institutionId,org_id:data.orgId??null,field_name:data.fieldName||null,suggested_value:data.suggestedValue||null,reason:data.reason,submitted_by:userId}).select("id,status").single();fail(error);return row;
  });

export const saveResourceKnowledge=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({id:uuid.optional(),orgId:uuid.nullable().optional(),titleEs:z.string().trim().min(2).max(240),titleEn:z.string().trim().min(2).max(240),summaryEs:z.string().max(5000).optional(),summaryEn:z.string().max(5000).optional(),knowledgeType:z.enum(["procedure","protocol","manual","form","legal_update","service_guide","institution_note"]),serviceCategories:z.array(z.string()).max(50).default([]),stateCodes:z.array(z.string()).max(40).default([]),sourceUrl:z.string().url().optional().or(z.literal("")),approvalStatus:z.enum(["draft","in_review","approved","retired"]).default("draft"),reviewDueAt:z.string().datetime().optional()}).parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);const payload={org_id:data.orgId??null,title_es:data.titleEs,title_en:data.titleEn,summary_es:data.summaryEs||null,summary_en:data.summaryEn||null,knowledge_type:data.knowledgeType,service_categories:data.serviceCategories,state_codes:data.stateCodes,source_url:data.sourceUrl||null,approval_status:data.approvalStatus,review_due_at:data.reviewDueAt||null,created_by:userId,approved_by:data.approvalStatus==="approved"?userId:null,approved_at:data.approvalStatus==="approved"?new Date().toISOString():null,updated_at:new Date().toISOString()};
    const query=data.id?supabase.from("resource_knowledge_records").update(payload).eq("id",data.id):supabase.from("resource_knowledge_records").insert(payload);
    const {data:row,error}=await query.select("id,version,approval_status").single();fail(error);return row;
  });



export const getSocialDocumentWorkspace=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({caseId:uuid}).parse(d))
  .handler(async({data,context})=>{
    const {supabase}=ctx(context);
    const caseRow=await supabase.from("social_cases").select("id,org_id,case_number,status,risk_level,assigned_case_manager,consent_status,person_id,family_id,program_id").eq("id",data.caseId).single();fail(caseRow.error);
    const c=caseRow.data;
    const [person,family,inventory,consents,shares,events,versions,referrals,assessments,plans]=await Promise.all([
      c.person_id?supabase.from("social_people").select("id,legal_name,preferred_name,consent_status").eq("id",c.person_id).maybeSingle():Promise.resolve({data:null,error:null}),
      c.family_id?supabase.from("social_families").select("id,family_name,family_number").eq("id",c.family_id).maybeSingle():Promise.resolve({data:null,error:null}),
      supabase.rpc("social_document_inventory",{p_case:data.caseId}),
      supabase.from("social_consents").select("*,social_consent_versions(*)").or([c.person_id?`person_id.eq.${c.person_id}`:null,c.family_id?`family_id.eq.${c.family_id}`:null].filter(Boolean).join(",")).order("created_at",{ascending:false}),
      supabase.from("social_document_shares").select("*").eq("org_id",c.org_id).order("created_at",{ascending:false}),
      supabase.from("social_document_access_events").select("*").eq("social_case_id",data.caseId).order("occurred_at",{ascending:false}).limit(300),
      supabase.from("social_document_versions").select("*").eq("org_id",c.org_id).order("created_at",{ascending:false}),
      supabase.from("social_referrals").select("id,referral_number,status,service_requested").eq("social_case_id",data.caseId).order("created_at",{ascending:false}),
      supabase.from("social_assessments").select("id,risk_level,assessment_date").eq("social_case_id",data.caseId).order("assessment_date",{ascending:false}),
      supabase.from("social_care_plans").select("id,status,created_at").eq("social_case_id",data.caseId).order("created_at",{ascending:false}),
    ]);
    [person,family,inventory,consents,shares,events,versions,referrals,assessments,plans].forEach((x:any)=>fail(x.error));
    const docs=inventory.data??[];const ids=new Set(docs.map((x:any)=>x.id));
    return {case:c,person:person.data,family:family.data,documents:docs,
      consents:consents.data??[],shares:(shares.data??[]).filter((x:any)=>ids.has(x.document_id)),
      events:events.data??[],versions:(versions.data??[]).filter((x:any)=>ids.has(x.document_id)),
      referrals:referrals.data??[],assessments:assessments.data??[],plans:plans.data??[]};
  });

export const updateSocialDocumentMetadata=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({documentId:uuid,title:z.string().trim().min(1).max(300),documentType:z.string().trim().min(1).max(120),recordType:recordType,sensitivity:z.enum(["standard","confidential","restricted","highly_restricted"]),description:z.string().max(3000).optional(),tags:z.array(z.string().trim().min(1).max(80)).max(50).default([]),status:z.enum(["active","superseded","archived"]),classificationStatus:z.enum(["suggested","classified","needs_review"]),expiresAt:z.string().datetime().optional(),externalShareable:z.boolean().default(false),linkedEntities:z.record(z.string(),z.unknown()).default({})}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("update_social_document_metadata",{p_document:data.documentId,p_title:data.title,p_document_type:data.documentType,p_record_type:data.recordType,p_sensitivity:data.sensitivity,p_description:data.description??null,p_tags:data.tags,p_status:data.status,p_classification_status:data.classificationStatus,p_expires_at:data.expiresAt??null,p_external_shareable:data.externalShareable,p_linked_entities:data.linkedEntities});fail(error);return {ok:true};});

export const finalizeSocialDocumentVersionUpload=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({documentId:uuid,path:z.string().min(20).max(1000),notes:z.string().trim().min(2).max(1000),mimeType:z.string().max(200).optional()}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const downloaded=await supabase.storage.from("social-case-files").download(data.path);fail(downloaded.error);const file=downloaded.data;const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest("SHA-256",bytes);const checksum=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");const {data:version,error}=await supabase.rpc("add_social_document_version",{p_document:data.documentId,p_storage_path:data.path,p_checksum:checksum,p_mime:data.mimeType||file.type||null,p_size:file.size,p_notes:data.notes});fail(error);return {version,checksum,size:file.size};});

export const getSocialDocumentAccessUrl=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({documentId:uuid,action:z.enum(["preview","download"]),reason:z.string().trim().max(500).optional()}).parse(d))
  .handler(async({data,context})=>{const {supabase,userId}=ctx(context);const document=await supabase.from("social_documents").select("id,org_id,social_case_id,current_version,storage_path,title").eq("id",data.documentId).single();fail(document.error);const signed=await supabase.storage.from("social-case-files").createSignedUrl(document.data.storage_path,120,{download:data.action==="download"?document.data.title:undefined});fail(signed.error);const event=await supabase.from("social_document_access_events").insert({org_id:document.data.org_id,social_case_id:document.data.social_case_id,document_id:document.data.id,version:document.data.current_version,action:data.action,reason:data.reason??null,actor_id:userId});fail(event.error);return {url:signed.data.signedUrl,expiresIn:120};});

export const moveSocialDocument=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({documentId:uuid,targetCaseId:uuid,reason:z.string().trim().min(3).max(1000)}).parse(d))
  .handler(async({data,context})=>{const {supabase}=ctx(context);const {error}=await supabase.rpc("move_social_document",{p_document:data.documentId,p_target_case:data.targetCaseId,p_reason:data.reason});fail(error);return {ok:true};});
