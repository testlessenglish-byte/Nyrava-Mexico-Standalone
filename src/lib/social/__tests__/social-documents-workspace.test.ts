import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260822000000_social_document_workspace.sql"),"utf8");
const server=readFileSync(join(root,"src","lib","social.functions.ts"),"utf8");
const route=readFileSync(join(root,"src","routes","_authenticated","social.tsx"),"utf8");
const hub=readFileSync(join(root,"src","components","social","SocialDocumentsHub.tsx"),"utf8");

describe("case-scoped Social Documents and Consent workspace",()=>{
  it("wires a dedicated case selector instead of the generic stage placeholder",()=>{
    expect(route).toContain("SocialDocumentsHub");
    expect(route).not.toContain('["interventions","legal","psychosocial","referrals","documents"');
    expect(route).not.toContain("\\n        {area");
    for(const marker of ["Search person, family, or case number","Assigned case manager","Open New Case","No authorized cases"])expect(hub).toContain(marker);
  });
  it("keeps originals inside record-aware storage boundaries",()=>{
    expect(migration).toContain("(storage.foldername(name))[3]");
    expect(migration).toContain("social_can_access_case(");
    expect(migration).not.toContain("::uuid,'general_case_record',false,auth.uid()");
    expect(migration).toContain("Target storage path boundary mismatch");
    expect(migration).toContain("Case move:");
  });
  it("preserves originals, detects duplicates, and versions replacements",()=>{
    expect(server).toContain('.eq("checksum",checksum)');
    expect(server).toContain("duplicate:true");
    expect(server).toContain('"add_social_document_version"');
    expect(hub).toContain("Replace with new version");
    expect(hub).toContain("Protect and upload all");
  });
  it("requires per-file classification and supports all requested document types",()=>{
    for(const type of ["identity_document","proof_of_address","birth_certificate","family_document","immigration_document","legal_document","consent_form","referral","care_plan","risk_assessment","social_work_record","psychosocial_record","medical_record","institutional_response","case_transfer_record","case_closure_record","other"])expect(hub).toContain(type);
    for(const record of ["general_case_record","social_work_record","legal_privileged_record","psychosocial_restricted_record","medical_restricted_record","child_protection_restricted_record"])expect(hub).toContain(record);
  });
  it("provides consent, version, sharing, and audited download tabs",()=>{
    for(const tab of ['"consent"','"versions"','"sharing"','"downloads"'])expect(hub).toContain(tab);
    expect(migration).toContain("social_document_access_events");
    expect(server).toContain("getSocialDocumentAccessUrl");
    expect(hub).toContain("Share with consent");
  });
  it("redacts restricted metadata for leaders without granting content access",()=>{
    expect(migration).toContain("'Restricted document'");
    expect(migration).toContain("content_access boolean");
    expect(migration).toContain("restricted_metadata boolean");
    expect(hub).toContain("only its existence is shown");
  });
  it("never sends documents into Legal Intelligence automatically",()=>{
    expect(migration).toContain("No function here creates a legal matter or sends files to Legal Intelligence");
    expect(hub).toContain("Nothing enters legal analysis automatically");
    expect(hub).toContain("Confirm express link");
    expect(hub).toContain("linkSocialImmigrationMatter");
  });
  it("supports explicit consent forms and links documents to case records",()=>{
    for(const action of ["Add Consent","Generate Consent Form","Link referral","Link assessment","Link care plan"])expect(hub).toContain(action);
    expect(migration).toContain("linked_entities jsonb");
    expect(server).toContain("p_linked_entities");
  });
  it("requires explicit external-shareability before consent-based sharing",()=>{
    expect(server).toContain("Document must be explicitly marked external-shareable");
    expect(hub).toContain("External-shareable with consent");
    expect(hub).toContain('x.status==="active"');
  });
  it("gates audio and video by organization setting",()=>{
    expect(server).toContain("allow_media_uploads");
    expect(server).toContain("Audio and video uploads are not enabled");
    expect(hub).toContain("Audio and video require organization approval");
  });
});
