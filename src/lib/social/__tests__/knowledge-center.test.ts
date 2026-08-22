import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const route=readFileSync(join(root,"src","routes","_authenticated","social.tsx"),"utf8");
const center=readFileSync(join(root,"src","components","social","KnowledgeCenter.tsx"),"utf8");
const server=readFileSync(join(root,"src","lib","social.functions.ts"),"utf8");
const migration=readFileSync(join(root,"supabase","migrations","20260822010000_social_knowledge_center.sql"),"utf8");

describe("Comprehensive Care Knowledge Center",()=>{
 it("does not render escaped layout tokens in the Comprehensive Care route",()=>{
   expect(route).not.toContain("\\n        {area");
   expect(route).not.toMatch(/>\\n(?:\\n)?</);
   expect(center).toContain('replace(/\\\\r\\\\n|\\\\n|\\\\r/g');
 });
 it("works independently from an open client case",()=>{
   expect(route).toContain('area==="knowledge"&&<KnowledgeCenter');
   expect(center).toContain("available without opening a case");
 });
 it("provides the requested search filters and categories",()=>{
   for(const x of ["Keyword","State","Municipality","Service area","Resource type","Authority","Language","Effective date","Approval status","User role","Current or archived"])expect(center).toContain(x);
   for(const x of ["immigration_refugees","child_protection","domestic_violence","consent_privacy","forms_templates","legal_updates"])expect(center).toContain(x);
 });
 it("governs publication, versions, corrections, and usage",()=>{
   for(const x of ["draft","pending_review","approved","published","revision_required","expired","archived"])expect(migration).toContain(x);
   expect(migration).toContain("resource_knowledge_versions");
   expect(migration).toContain("resource_knowledge_corrections");
   expect(migration).toContain("resource_knowledge_usage");
 });
 it("supports case actions without creating legal evidence",()=>{
   for(const x of ["attach_reference","add_required_form","create_checklist","create_task","start_referral","share_client_version","ask_talk_to_case"])expect(center).toContain(x);
   expect(migration).toContain("resource_knowledge_not_evidence");
   expect(server).toContain("legal_evidence:false");
   expect(center).toContain("never automatically becomes evidence");
 });
});
