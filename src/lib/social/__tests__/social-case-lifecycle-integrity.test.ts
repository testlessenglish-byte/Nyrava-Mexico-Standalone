import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration=readFileSync(join(process.cwd(),"supabase","migrations","20260823030000_care_case_lifecycle_integrity.sql"),"utf8");
const server=readFileSync(join(process.cwd(),"src","lib","social.functions.ts"),"utf8");
const workspace=readFileSync(join(process.cwd(),"src","components","social","SocialCaseWorkspace.tsx"),"utf8");

describe("Comprehensive Care Phase 6 lifecycle integrity",()=>{
  it("prevents a completed-services closure with unfinished case work",()=>{
    expect(migration).toContain("Services cannot be marked completed while work remains");
    expect(migration).toContain("v_incomplete_goals");
    expect(migration).toContain("v_pending_referrals");
    expect(migration).toContain("v_open_tasks");
    expect(migration).toContain("'case_closed'");
  });

  it("requires and snapshots closure accountability fields",()=>{
    expect(migration).toContain("client notification, document disposition, and retention status are required");
    expect(migration).toContain("p_summary->>'client_notification'");
    expect(migration).toContain("p_summary->>'document_disposition'");
    expect(migration).toContain("p_summary->>'retention_status'");
  });

  it("enforces protected service records on the server",()=>{
    expect(server).toContain('const legalServices=new Set(["legal_assistance","immigration_assistance","institutional_advocacy"])');
    expect(server).toContain('recordType:"legal_privileged_record"');
    expect(server).toContain('recordType:"psychosocial_restricted_record"');
    expect(server).toContain('confidentialityLevel:"highly_restricted"');
  });

  it("shows closure readiness and preserves the authorized reopening workflow",()=>{
    expect(workspace).toContain("closureBlockerCount");
    expect(workspace).toContain("Outstanding work before services can be completed");
    expect(workspace).toContain("Client notification");
    expect(workspace).toContain("Document disposition");
    expect(workspace).toContain("Retention status");
    expect(workspace).toContain("Reopen preserving closure");
  });
});
