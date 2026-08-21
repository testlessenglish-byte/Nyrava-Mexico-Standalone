import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260821050000_resource_knowledge_network.sql"),"utf8");
const server=readFileSync(join(root,"src","lib","social.functions.ts"),"utf8");
const route=readFileSync(join(root,"src","routes","_authenticated","social.tsx"),"utf8");
const workspace=readFileSync(join(root,"src","components","social","SocialCaseWorkspace.tsx"),"utf8");
const ui=readFileSync(join(root,"src","components","social","ResourceKnowledgeNetwork.tsx"),"utf8");

describe("resource and institutional knowledge network",()=>{
  it("protects every new table with row-level security",()=>{
    for(const table of ["resource_service_categories","resource_verifications","resource_corrections","resource_internal_experiences","resource_knowledge_records","resource_knowledge_versions"]){
      expect(migration).toContain("alter table public."+table+" enable row level security");
    }
  });
  it("never accepts client identifiers in ordinary resource search",()=>{
    const search=migration.slice(migration.indexOf("function public.search_resource_network"),migration.indexOf("revoke all on function public.search_resource_network"));
    expect(search).not.toMatch(/p_(person|family|case|client|document)/);
    expect(search).toContain("location_confidential then null");
    expect(migration).toContain("revoke all on function public.search_resource_network");
  });
  it("supports geographic, coverage, service, urgency, language, population, cost and capacity filtering",()=>{
    for(const marker of ["p_state","p_municipality","p_latitude","p_radius_km","p_service","p_urgency","p_language","p_population","p_cost_type","p_availability","coverage_states","coverage_municipalities"]){
      expect(migration).toContain(marker);
    }
  });
  it("keeps internal institutional knowledge separate from directory results",()=>{
    expect(migration).toContain("resource_internal_experiences");
    const search=migration.slice(migration.indexOf("function public.search_resource_network"),migration.indexOf("revoke all on function public.search_resource_network"));
    expect(search).not.toContain("internal_notes");
    expect(migration).toContain("Organization-only operational knowledge; never include");
  });
  it("requires verification history and preserves unsuccessful referral states",()=>{
    expect(migration).toContain("resource_verifications");
    expect(migration).toContain("verify_resource");
    expect(migration).toContain("service_in_progress");
    expect(migration).toContain("unable_to_contact");
    expect(migration).toContain("'completed'");
  });
  it("wires directory, knowledge, administration, and case-aware recommendations",()=>{
    for(const marker of ['id:"resources"','id:"knowledge"','id:"resourceAdmin"','mode="resources"','mode="knowledge"','mode="admin"'])expect(route).toContain(marker);
    expect(workspace).toContain('id:"resources"');
    expect(workspace).toContain("CaseResourceRecommendations");
    expect(server).toContain("export const findResourcesForSocialCase");
  });
  it("renders stored enum values through bilingual labels",()=>{
    expect(workspace).toContain("function localizedEnum");
    for(const value of ["unknown","low","moderate","high","critical","service_in_progress"])expect(workspace).toContain(value);
    expect(ui).toContain('locale==="es"');
    expect(ui).toContain("Verificación vencida");
    expect(ui).toContain("No identifying information is sent");
  });
});
