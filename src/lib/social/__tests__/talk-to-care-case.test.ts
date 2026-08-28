import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";
const root=process.cwd();
const server=readFileSync(join(root,"src","lib","social.functions.ts"),"utf8");
const ui=readFileSync(join(root,"src","components","social","TalkToCareCase.tsx"),"utf8");
const workspace=readFileSync(join(root,"src","components","social","SocialCaseWorkspace.tsx"),"utf8");
const migration=readFileSync(join(root,"supabase","migrations","20260822020000_talk_to_care_case.sql"),"utf8");
describe("Talk to Care Case",()=>{
 it("is case-scoped and permission-first",()=>{expect(workspace).toContain("TalkToCareCase caseId={caseId}");expect(server).toContain('.eq("id",data.caseId).single()');expect(server).toContain('"general_case_record"');for(const x of ["legal_privileged_record","psychosocial_restricted_record","medical_restricted_record","child_protection_restricted_record"])expect(server).toContain(x);});
 it("returns structured citations and deterministic health groups",()=>{for(const x of ["current_case_status","missing_or_incomplete","risks_requiring_review","recommended_next_steps","sources","health_check"])expect(server).toContain(x);for(const x of ["critical","action_required","incomplete","monitor","complete"])expect(ui+server).toContain(x);});
 it("requires preview and confirmation before actions",()=>{expect(migration).toContain("status in ('proposed','confirmed','cancelled')");expect(ui).toContain("Confirm action");expect(server).toContain("No material case state has changed");});
 it("keeps the answer visible and requires review before saving",()=>{expect(ui).toContain('role="status"');expect(ui).toContain("scrollIntoView");expect(ui).toContain("Review and save to case");expect(ui).toContain("Review follow-up before creating");expect(ui).toContain("recordSocialIntervention");expect(ui).toContain("upsertSocialTask");expect(ui).toContain('serviceType:"case_assistant_review"');});
 it("does not automatically mutate protected case decisions",()=>{expect(ui).toContain("does not change risk, consent, plans, referrals, or case status");expect(migration).toContain("Assistant output alone never mutates material case state");});
});
