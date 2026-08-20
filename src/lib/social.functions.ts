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
    const {supabase,userId}=ctx(context);
    const {data:family,error}=await supabase.from("social_families").insert({
      org_id:data.orgId,family_number:null,family_name:data.familyName,
      primary_contact_person_id:data.primaryContactPersonId??null,
      current_location:data.currentLocation,created_by:userId,
    }).select("id,family_number,family_name").single();
    fail(error);
    if(data.memberIds.length){
      const {error:memberError}=await supabase.from("social_family_members").insert(data.memberIds.map((personId)=>({
        org_id:data.orgId,family_id:family.id,person_id:personId,
      })));
      fail(memberError);
    }
    return family;
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
    const {supabase,userId}=ctx(context);
    const {data:caseRow,error:caseError}=await supabase.from("social_cases").select("id,org_id").eq("id",data.socialCaseId).single();fail(caseError);
    const {data:existing,error:existingError}=await supabase.from("social_assessments").select("id,current_version").eq("social_case_id",data.socialCaseId).order("created_at",{ascending:false}).limit(1).maybeSingle();fail(existingError);
    if(existing){
      const {data:version,error}=await supabase.rpc("record_social_assessment",{
        p_assessment:existing.id,p_risk_level:data.riskLevel,p_evidence:data.evidenceObservations??null,
        p_reason:data.reason,p_protective_factors:data.protectiveFactors??null,
        p_immediate_actions:data.immediateActions??null,p_required_follow_up:data.requiredFollowUp??null,
        p_answers:data.answers,p_next_review:data.nextReviewDate??null,p_override:data.professionalOverride,
        p_override_explanation:data.overrideExplanation??null,
      });fail(error);return {assessmentId:existing.id,version};
    }
    const {data:assessment,error}=await supabase.from("social_assessments").insert({
      org_id:caseRow.org_id,social_case_id:data.socialCaseId,template_id:data.templateId??null,
      assessor_id:userId,risk_level:data.riskLevel,professional_override:data.professionalOverride,
      override_explanation:data.overrideExplanation??null,next_review_date:data.nextReviewDate??null,
    }).select("id").single();fail(error);
    const {error:versionError}=await supabase.from("social_assessment_versions").insert({
      org_id:caseRow.org_id,assessment_id:assessment.id,version:1,
      evidence_observations:data.evidenceObservations??null,reason:data.reason,
      protective_factors:data.protectiveFactors??null,immediate_actions:data.immediateActions??null,
      required_follow_up:data.requiredFollowUp??null,answers:data.answers,
      risk_level:data.riskLevel,created_by:userId,
    });fail(versionError);
    return {assessmentId:assessment.id,version:1};
  });

export const createSocialCarePlan=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>carePlanInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:caseRow,error:caseError}=await supabase.from("social_cases").select("org_id,family_id").eq("id",data.socialCaseId).single();fail(caseError);
    const {data:plan,error}=await supabase.from("social_care_plans").insert({org_id:caseRow.org_id,social_case_id:data.socialCaseId,family_id:caseRow.family_id,status:data.status,created_by:userId}).select("id").single();fail(error);
    const {data:version,error:versionError}=await supabase.from("social_care_plan_versions").insert({org_id:caseRow.org_id,care_plan_id:plan.id,version:1,summary:data.summary,status:data.status,submitted_by:userId}).select("id").single();fail(versionError);
    const {error:goalError}=await supabase.from("social_care_plan_goals").insert(data.goals.map((g)=>({org_id:caseRow.org_id,care_plan_version_id:version.id,identified_need:g.identifiedNeed,goal:g.goal,planned_action:g.plannedAction,target_date:g.targetDate??null,priority:g.priority,expected_outcome:g.expectedOutcome??null,review_date:g.reviewDate??null,status:"draft"})));fail(goalError);
    return {planId:plan.id,version:1};
  });

export const createSocialConsent=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>consentInput.parse(d))
  .handler(async({data,context})=>{
    const {supabase,userId}=ctx(context);
    const {data:consent,error}=await supabase.from("social_consents").insert({org_id:data.orgId,person_id:data.personId??null,family_id:data.familyId??null,consent_type:data.consentType,status:"active",expires_at:data.expiresAt??null,created_by:userId}).select("id").single();fail(error);
    const {error:versionError}=await supabase.from("social_consent_versions").insert({org_id:data.orgId,consent_id:consent.id,version:1,language:data.language,consented_by_name:data.consentedByName,guardian_representative:data.guardianRepresentative??null,permitted_purpose:data.permittedPurposes,permitted_recipients:data.permittedRecipients,permitted_information:data.permittedInformation,restrictions:data.restrictions??null,confirmation:{method:"recorded_in_app",confirmed_at:new Date().toISOString()},created_by:userId});fail(versionError);
    return {consentId:consent.id,version:1};
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
