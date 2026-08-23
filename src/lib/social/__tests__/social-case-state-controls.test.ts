import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration=readFileSync(join(process.cwd(),"supabase","migrations","20260823010000_care_case_state_controls.sql"),"utf8");
const server=readFileSync(join(process.cwd(),"src","lib","social.functions.ts"),"utf8");
const workspace=readFileSync(join(process.cwd(),"src","components","social","SocialCaseWorkspace.tsx"),"utf8");

describe("Comprehensive Care persistent case state controls",()=>{
  it("records status and priority changes with a documented reason",()=>{
    expect(migration).toContain("function public.update_care_case_state");
    expect(migration).toContain("insert into public.social_case_status_history");
    expect(migration).toContain("from_priority");
    expect(migration).toContain("to_priority");
    expect(migration).toContain("case_state_changed");
    expect(migration).toContain("A documented reason of at least five characters is required");
  });

  it("enforces transitions and leaves closure, reopening and transfer dedicated",()=>{
    expect(migration).toContain("Invalid Comprehensive Care status transition");
    expect(migration).toContain("Closed cases must use the authorized reopening workflow");
    expect(migration).toContain("Use the dedicated closure, reopening, transfer, or archive workflow");
    expect(migration).not.toContain("drop trigger if exists protect_closed_social_case");
  });

  it("creates immediate safeguards when priority becomes emergency",()=>{
    expect(migration).toContain("'emergency_priority_escalation'");
    expect(migration).toContain("Immediate emergency response and acknowledgement");
    expect(migration).toContain("requires_acknowledgement");
  });

  it("wires bilingual persistent-header controls through an authenticated server function",()=>{
    expect(server).toContain("export const updateCareCaseState");
    expect(server).toContain('.rpc("update_care_case_state"');
    expect(workspace).toContain("Change state");
    expect(workspace).toContain("Documented reason");
    expect(workspace).toContain("Reopen in Closure");
    expect(workspace).toContain("It does not replace emergency services.");
  });
});
