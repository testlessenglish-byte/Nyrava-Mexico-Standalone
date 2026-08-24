import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe,expect,it } from "vitest";

const root=process.cwd();
const account=readFileSync(join(root,"src","routes","_authenticated","account.tsx"),"utf8");
const server=readFileSync(join(root,"src","lib","social.functions.ts"),"utf8");
const migration=readFileSync(join(root,"supabase","migrations","20260822143000_social_organization_account.sql"),"utf8");

describe("organization team member controls",()=>{
  it("supports role changes without silently reactivating suspended members",()=>{
    expect(account).toContain('status:m.status==="suspended"?"suspended":"active"');
    expect(server).toContain('status:z.enum(["active","suspended","removed"])');
  });
  it("offers suspend, reactivate and audited removal controls",()=>{
    for(const label of ["Suspend","Reactivate","Remove"])expect(account).toContain(label);
    expect(account).toContain('status:"removed"');
    expect(migration).toContain("'member_'||p_status");
  });
  it("protects owners and requires active case reassignment before removal",()=>{
    expect(account).toContain('m.role!=="owner"');
    expect(account).toContain("Reassign cases before removal");
    expect(account).toContain("Number(m.assigned_cases??0)>0");
    expect(migration).toContain("Organization owner cannot be changed here");
  });
  it("revokes assignments when a member is suspended or removed",()=>{
    expect(migration).toContain("update public.social_case_assignments set active=false");
    expect(migration).toContain("update public.social_role_assignments set active=false");
    expect(migration).toContain("deleted_at=case when p_status='removed' then now() else null end");
  });
});
