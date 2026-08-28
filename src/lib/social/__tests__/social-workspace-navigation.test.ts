import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route=readFileSync(join(process.cwd(),"src","routes","_authenticated","social.tsx"),"utf8");
const workspace=readFileSync(join(process.cwd(),"src","components","social","SocialCaseWorkspace.tsx"),"utf8");

describe("Comprehensive Care Phase 5 workspace navigation",()=>{
  it("uses compact organization-level navigation",()=>{
    for(const label of ["Overview","Cases","Case Work","Tasks and Alerts","Documents and Consent","Team Activity","Organization Settings"]){
      expect(route).toContain(`en:"${label}"`);
    }
    expect(route).toContain("PRIMARY_AREAS");
    expect(route).toContain("CONTEXT_AREAS");
    expect(route).toContain("Tools and resources");
  });

  it("preserves contextual organization resources without exposing every case stage globally",()=>{
    for(const label of ["Resource Network","Knowledge Center","Institutional Indicators"]){
      expect(route).toContain(`en:"${label}"`);
    }
    expect(route).not.toContain('en:"Manage Resources"');
    expect(route).toContain('en:"Resource & Knowledge Administration"');
    expect(route).toContain("canAdministerResources");
    expect(route).toContain('area==="caseWork"');
    expect(route).toContain("Open an authorized case");
  });

  it("keeps the canonical case workspace tabs on one case id",()=>{
    for(const label of ["Summary","Intake","Risk","Care Plan","Interventions","Legal","Psychosocial","Referrals","Documents","Activity","Closure"]){
      expect(workspace).toContain(`en:"${label}"`);
    }
    expect(workspace).toContain("PRIMARY_TABS");
    expect(workspace).toContain("More case actions");
    expect(workspace).toContain("queryKey:[\"social-case\",caseId]");
    expect(workspace).toContain("<TalkToCareCase caseId={caseId}/>");
    expect(workspace).toContain("<CaseResourceRecommendations caseId={caseId}/>");
  });

  it("applies confidentiality defaults for legal and psychosocial work",()=>{
    expect(workspace).toContain('recordType:"legal_privileged_record"');
    expect(workspace).toContain('recordType:"psychosocial_restricted_record"');
    expect(workspace).toContain("Legal records remain privileged and require authorized access.");
    expect(workspace).toContain("Psychosocial records remain restricted to the authorized team.");
  });
});
