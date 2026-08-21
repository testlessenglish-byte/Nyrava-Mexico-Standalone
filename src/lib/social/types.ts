import { z } from "zod";

export const SOCIAL_CASE_STATUSES = [
  "intake","assessment","active","monitoring","pending_referral",
  "transferred","closed","reopened","archived",
] as const;
export const SOCIAL_RISK_LEVELS = ["unknown","low","moderate","high","critical"] as const;
export const SOCIAL_RECORD_TYPES = [
  "general_case_record","social_work_record","legal_privileged_record",
  "psychosocial_restricted_record","medical_restricted_record",
  "child_protection_restricted_record",
] as const;
export const SOCIAL_ROLES = [
  "organization_owner","program_director","case_management_supervisor",
  "case_manager","social_worker","attorney","legal_assistant","psychologist",
  "medical_professional","referral_coordinator","data_analyst","auditor",
  "read_only_reviewer","external_partner",
] as const;

export type SocialCaseStatus = (typeof SOCIAL_CASE_STATUSES)[number];
export type SocialRiskLevel = (typeof SOCIAL_RISK_LEVELS)[number];
export type SocialRecordType = (typeof SOCIAL_RECORD_TYPES)[number];

const optionalText = z.string().trim().max(500).optional().nullable();
export const socialPersonInput = z.object({
  orgId: z.string().uuid(),
  legalName: z.string().trim().min(2).max(240),
  preferredName: z.string().trim().max(160).optional(),
  aliases: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  dateOfBirth: z.string().date().optional(),
  approximateAge: z.number().int().min(0).max(130).optional(),
  nationality: optionalText,
  languages: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  telephone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  currentLocation: z.record(z.string(), z.unknown()).default({}),
  immigrationIdentifiers: z.record(z.string(), z.string().max(200)).default({}),
  isMinor: z.boolean().optional(),
  unaccompaniedMinor: z.boolean().default(false),
  separatedMinor: z.boolean().default(false),
});

export const socialFamilyInput = z.object({
  orgId: z.string().uuid(),
  familyName: z.string().trim().min(1).max(240),
  primaryContactPersonId: z.string().uuid().optional(),
  currentLocation: z.record(z.string(), z.unknown()).default({}),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
});

export const socialCaseInput = z.object({
  orgId: z.string().uuid(),
  programId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  caseType: z.string().trim().min(2).max(120),
  referralSource: z.string().trim().max(300).optional(),
  serviceAreas: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  priority: z.enum(["low","normal","high","urgent"]).default("normal"),
  riskLevel: z.enum(SOCIAL_RISK_LEVELS).default("unknown"),
  confidentialityLevel: z.enum(["standard","confidential","restricted","highly_restricted"]).default("standard"),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
}).refine((v) => Boolean(v.personId || v.familyId), {
  message: "A person or family is required",
});

export const socialSearchInput = z.object({
  orgId: z.string().uuid(),
  query: z.string().trim().max(240).default(""),
  status: z.enum(SOCIAL_CASE_STATUSES).optional(),
  riskLevel: z.enum(SOCIAL_RISK_LEVELS).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const assessmentInput = z.object({
  socialCaseId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  riskLevel: z.enum(SOCIAL_RISK_LEVELS),
  evidenceObservations: z.string().trim().max(10000).optional(),
  reason: z.string().trim().min(3).max(5000),
  protectiveFactors: z.string().trim().max(5000).optional(),
  immediateActions: z.string().trim().max(5000).optional(),
  requiredFollowUp: z.string().trim().max(5000).optional(),
  nextReviewDate: z.string().date().optional(),
  answers: z.record(z.string(), z.unknown()).default({}),
  professionalOverride: z.boolean().default(false),
  overrideExplanation: z.string().trim().max(2000).optional(),
}).refine((v) => !v.professionalOverride || Boolean(v.overrideExplanation), {
  message: "Override explanation is required",
});

export const carePlanInput = z.object({
  socialCaseId: z.string().uuid(),
  summary: z.string().trim().min(3).max(10000),
  status: z.enum(["draft","active","under_review","completed","partially_completed","cancelled","superseded"]).default("draft"),
  goals: z.array(z.object({
    identifiedNeed: z.string().trim().min(1).max(2000),
    goal: z.string().trim().min(1).max(2000),
    plannedAction: z.string().trim().min(1).max(4000),
    targetDate: z.string().date().optional(),
    priority: z.enum(["low","normal","high","urgent"]).default("normal"),
    expectedOutcome: z.string().trim().max(2000).optional(),
    reviewDate: z.string().date().optional(),
  })).min(1).max(100),
});

export const referralInput = z.object({
  socialCaseId: z.string().uuid(),
  institutionId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  serviceRequested: z.string().trim().min(2).max(1000),
  reason: z.string().trim().min(2).max(4000),
  urgency: z.enum(["low","normal","high","urgent"]).default("normal"),
  consentId: z.string().uuid().optional(),
  authorizedInformation: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
});

export const consentInput = z.object({
  orgId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  consentType: z.string().trim().min(2).max(120),
  language: z.string().trim().min(2).max(20).default("es"),
  consentedByName: z.string().trim().min(2).max(240),
  guardianRepresentative: z.string().trim().max(240).optional(),
  permittedPurposes: z.array(z.string().trim().min(1).max(120)).max(50),
  permittedRecipients: z.array(z.string().trim().min(1).max(200)).max(100),
  permittedInformation: z.array(z.string().trim().min(1).max(120)).max(100),
  restrictions: z.string().trim().max(5000).optional(),
  expiresAt: z.string().datetime().optional(),
}).refine((v) => Boolean(v.personId || v.familyId), { message: "A person or family is required" });

export function maskIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const compact=value.replace(/\s+/g,"");
  if (compact.length<=4) return "••••";
  return `${"•".repeat(Math.min(8,compact.length-4))}${compact.slice(-4)}`;
}

export function normalizeSocialSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g," ").trim();
}

export const EMERGENCY_GUIDANCE = {
  es: "Esta herramienta apoya la valoración profesional; no sustituye servicios de emergencia ni el criterio de personal capacitado.",
  en: "This tool supports professional assessment; it does not replace emergency services or trained professional judgment.",
} as const;
