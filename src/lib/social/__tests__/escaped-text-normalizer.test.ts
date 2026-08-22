import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";
const root=process.cwd();
const route=readFileSync(join(root,"src","routes","_authenticated","social.tsx"),"utf8");
const guard=readFileSync(join(root,"src","components","social","EscapedTextNormalizer.tsx"),"utf8");
const workspace=readFileSync(join(root,"src","components","social","SocialCaseWorkspace.tsx"),"utf8");
const socialFunctions=readFileSync(join(root,"src","lib","social.functions.ts"),"utf8");
describe("Comprehensive Care escaped-token rendering",()=>{
 it("normalizes initial and dynamically rendered text across the whole area",()=>{
   expect(route).toContain("data-social-care-root");
   expect(route).toContain("<EscapedTextNormalizer/>");
   expect(guard).toContain("MutationObserver");
   expect(guard).toContain("characterData");
 });
 it("turns escape sequences into real whitespace instead of hiding with CSS",()=>{
   expect(guard).toContain('.replace(/\\\\r\\\\n|\\\\n|\\\\r/g,"\\n")');
   expect(guard).not.toContain("display:none");
   expect(guard).not.toContain("visibility");
 });
 it("contains no literal layout escapes in the case workspace",()=>{
   expect(workspace).not.toMatch(/\\\\[nrt]/);
 });
 it("queries only columns present on care-plan goals",()=>{
   expect(socialFunctions).not.toContain("social_care_plan_goals(id,status,goal,target_date,assigned_to)");
   expect(socialFunctions).toContain("social_care_plan_goals(id,status,goal,target_date)");
 });
 it("does not alter code, inputs, or editable text",()=>{
   for(const tag of ["CODE","PRE","SCRIPT","STYLE","TEXTAREA","INPUT"])expect(guard).toContain(tag);
 });
});
