import { describe, expect, it } from "vitest";
import {
  SOCIAL_CASE_STATUSES, SOCIAL_RECORD_TYPES, SOCIAL_RISK_LEVELS, SOCIAL_ROLES,
  assessmentInput, consentInput, maskIdentifier, normalizeSocialSearch,
  socialCaseInput, socialFamilyInput, socialPersonInput,
} from "../types";

describe("Atención Integral domain contracts",()=>{
  it("keeps the social lifecycle distinct from legal matter case types",()=>{
    expect(SOCIAL_CASE_STATUSES).toEqual(["intake","assessment","active","monitoring","pending_referral","transferred","closed","reopened","archived"]);
    expect(SOCIAL_CASE_STATUSES).not.toContain("generating_report");
  });
  it("covers every risk level without deriving risk from identity fields",()=>{
    expect(SOCIAL_RISK_LEVELS).toEqual(["unknown","low","moderate","high","critical"]);
    const person=socialPersonInput.parse({orgId:"11111111-1111-4111-8111-111111111111",legalName:"María López",aliases:[],languages:[],currentLocation:{},immigrationIdentifiers:{},unaccompaniedMinor:false,separatedMinor:false});
    expect(person).not.toHaveProperty("riskLevel");
  });
  it("normalizes accents, capitalization and spacing",()=>{
    expect(normalizeSocialSearch("  LÓPEZ,   María-José ")).toBe("lopez maria jose");
  });
  it("masks identity values except for the final four characters",()=>{
    expect(maskIdentifier("COMAR-12345678")).toBe("••••••••5678");
    expect(maskIdentifier("123")).toBe("••••");
  });
  it("validates individual registration with data minimization",()=>{
    const value=socialPersonInput.parse({orgId:"11111111-1111-4111-8111-111111111111",legalName:"Ana Pérez"});
    expect(value.aliases).toEqual([]);expect(value.immigrationIdentifiers).toEqual({});
    expect(()=>socialPersonInput.parse({orgId:"bad",legalName:"A"})).toThrow();
  });
  it("validates family registration and membership",()=>{
    const value=socialFamilyInput.parse({orgId:"11111111-1111-4111-8111-111111111111",familyName:"Familia A"});
    expect(value.memberIds).toEqual([]);
  });
  it("requires an individual or family for a social case",()=>{
    expect(()=>socialCaseInput.parse({orgId:"11111111-1111-4111-8111-111111111111",programId:"22222222-2222-4222-8222-222222222222",caseType:"social",serviceAreas:[],tags:[]})).toThrow();
  });
  it("requires evidence reasoning and an explanation for professional override",()=>{
    const base={socialCaseId:"11111111-1111-4111-8111-111111111111",riskLevel:"high",reason:"Observed immediate danger",answers:{},professionalOverride:true};
    expect(()=>assessmentInput.parse(base)).toThrow();
    expect(assessmentInput.parse({...base,overrideExplanation:"Professional review of current evidence"}).professionalOverride).toBe(true);
  });
  it("requires narrowly described consent scope",()=>{
    const value=consentInput.parse({orgId:"11111111-1111-4111-8111-111111111111",personId:"22222222-2222-4222-8222-222222222222",consentType:"interinstitutional",consentedByName:"Ana Pérez",permittedPurposes:["housing_referral"],permittedRecipients:["DIF"],permittedInformation:["name","contact"]});
    expect(value.permittedPurposes).toEqual(["housing_referral"]);
    expect(value.permittedInformation).not.toContain("*");
  });
  it("defines separate restricted record types",()=>{
    expect(SOCIAL_RECORD_TYPES).toContain("legal_privileged_record");
    expect(SOCIAL_RECORD_TYPES).toContain("psychosocial_restricted_record");
    expect(SOCIAL_RECORD_TYPES).toContain("medical_restricted_record");
    expect(new Set(SOCIAL_RECORD_TYPES).size).toBe(6);
  });
  it("defines all required capability roles",()=>{
    expect(SOCIAL_ROLES).toHaveLength(14);
    expect(SOCIAL_ROLES).toContain("external_partner");
    expect(SOCIAL_ROLES).toContain("data_analyst");
  });
});
