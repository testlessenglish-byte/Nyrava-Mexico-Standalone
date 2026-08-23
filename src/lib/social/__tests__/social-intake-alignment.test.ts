import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration=readFileSync(join(process.cwd(),"supabase","migrations","20260823000000_care_intake_assignment_integrity.sql"),"utf8");
const server=readFileSync(join(process.cwd(),"src","lib","social.functions.ts"),"utf8");
const route=readFileSync(join(process.cwd(),"src","routes","_authenticated","social.tsx"),"utf8");
const component=readFileSync(join(process.cwd(),"src","components","social","SocialIntakeManager.tsx"),"utf8");

describe("Comprehensive Care intake and assignment alignment",()=>{
  it("creates a separate, protected intake domain without duplicating organizations or cases",()=>{
    expect(migration).toContain("create table if not exists public.social_intakes");
    expect(migration).toContain("alter table public.social_intakes enable row level security");
    expect(migration).toContain("function public.create_social_intake");
    expect(migration).toContain("function public.complete_social_intake");
    expect(migration).toContain("function public.open_care_case_from_intake");
    expect(migration).not.toContain("create table if not exists public.organizations");
    expect(migration).not.toContain("create table if not exists public.social_cases");
  });

  it("keeps intake separate until an explicit disposition",()=>{
    expect(migration).toContain("disposition text not null default 'pending'");
    expect(migration).toContain("Use the intake-to-case workflow when opening a case");
    expect(migration).toContain("public.create_and_assign_care_case");
    expect(migration).toContain("'intake_converted_to_case'");
    expect(component).toContain("It does not automatically create a case.");
    expect(component).toContain("Complete without opening case");
  });

  it("canonicalizes assignments and prevents multiple active primary roles",()=>{
    expect(migration).toContain("assignment_role = 'primary_case_manager'");
    expect(migration).toContain("new.assignment_role := 'case_manager'");
    expect(migration).toContain("social_case_assignments_one_active_role");
    expect(migration).toContain("where active and assignment_role in ('case_manager', 'supervisor')");
  });

  it("uses authenticated server operations and replaces the fake Intake screen",()=>{
    for(const marker of ["getSocialIntakes","createSocialIntake","completeSocialIntake","openCareCaseFromIntake"]){
      expect(server).toContain(`export const ${marker}`);
    }
    expect(route).toContain("SocialIntakeManager");
    expect(route).not.toContain('area==="intake"&&null');
    expect(component).toContain("Open and assign case");
  });
});
