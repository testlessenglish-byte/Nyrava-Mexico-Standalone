// Comprehensive Care — Talk to Care Case reasoning layer. Server-only.
//
// Deterministic gap analysis over the already-authorized care-case bundle,
// plus an optional narrative answer produced with the admin-configured AI
// providers (ai_providers / user_ai_keys). Read-only: nothing here mutates
// case state.

export type CareBundle = Record<string, any>;

export interface HealthItem { code: string; message: string; source: string; why?: string }
export interface CareHealth {
  critical: HealthItem[];
  action_required: HealthItem[];
  incomplete: HealthItem[];
  monitor: HealthItem[];
  complete: HealthItem[];
  generated_at: string;
}

const DAY = 86400000;
const isOpen = (s: string) => !["completed", "cancelled", "closed", "done"].includes(String(s ?? "").toLowerCase());

export function buildCareHealth(x: CareBundle): CareHealth {
  const now = Date.now();
  const critical: HealthItem[] = [], actionRequired: HealthItem[] = [], incomplete: HealthItem[] = [], monitor: HealthItem[] = [], complete: HealthItem[] = [];
  const add = (bucket: HealthItem[], code: string, message: string, source: string, why?: string) => bucket.push({ code, message, source, ...(why ? { why } : {}) });

  // Risk
  if (x.case.risk_level === "critical" || x.case.risk_level === "high")
    add(critical, "risk_review", `Current risk is ${x.case.risk_level}; professional review required.`, `Case ${x.case.case_number}`, "The recorded risk level on the case is high or critical and no lower reassessment supersedes it.");

  // Intake
  const intake = x.intakes?.[0];
  if (!intake) add(incomplete, "intake_missing", "No intake record is linked to this case.", "Intakes", "Comprehensive Care expects every case to originate from a completed intake.");
  else {
    if (intake.status !== "completed") add(actionRequired, "intake_incomplete", `Intake ${intake.intake_number} is still "${intake.status}".`, `Intake ${intake.intake_number}`, "The intake was never marked completed, so screening data may be partial.");
    if (!intake.presenting_needs?.length) add(incomplete, "intake_needs", "Intake records no presenting needs.", `Intake ${intake.intake_number}`, "Presenting needs drive care-plan goals; none were captured.");
  }

  // Assessment
  const assessment = x.assessments[0];
  if (!assessment) add(incomplete, "assessment_missing", "No risk assessment is recorded.", "Risk assessments", "A case cannot be triaged without at least one recorded assessment.");
  else if (now - new Date(assessment.assessment_date).getTime() > 30 * DAY) add(actionRequired, "assessment_stale", "Risk assessment is older than 30 days.", `Assessment ${assessment.id} v${assessment.current_version}`, "Assessments older than 30 days no longer reflect the current situation.");
  else add(complete, "assessment_current", "Risk assessment is current.", `Assessment ${assessment.id} v${assessment.current_version}`);

  // Consent
  const activeConsent = x.consents.find((v: any) => v.status === "active" && (!v.expires_at || new Date(v.expires_at).getTime() > now));
  if (!activeConsent) add(actionRequired, "consent", "No active unexpired consent is recorded.", "Consent records", "Information sharing, referrals and document requests require a valid consent on file.");
  else add(complete, "consent", "Active consent is recorded.", `Consent ${activeConsent.id}`);

  // Care plan + goal / intervention coverage
  const plan = x.plans[0];
  const goals: any[] = plan?.social_care_plan_versions?.flatMap((v: any) => v.social_care_plan_goals ?? []) ?? [];
  if (!plan) add(incomplete, "care_plan", "No care plan is recorded.", "Care plans", "Identified needs must be converted into a care plan.");
  else if (!goals.length) add(incomplete, "care_goals_missing", "The care plan has no goals.", `Care plan ${plan.id} v${plan.current_version}`, "A plan without goals cannot be monitored or closed.");
  else {
    const open = goals.filter((g: any) => isOpen(g.status));
    add(open.length ? actionRequired : complete, "care_goals", open.length ? `${open.length} care-plan goals remain open.` : "Care-plan goals are complete.", `Care plan ${plan.id} v${plan.current_version}`, open.length ? "These goals have not reached a completed or cancelled state." : undefined);
    const covered = new Set(x.interventions.map((i: any) => i.care_plan_goal_id).filter(Boolean));
    const uncovered = open.filter((g: any) => !covered.has(g.id));
    if (uncovered.length) add(actionRequired, "goals_without_intervention", `${uncovered.length} open care-plan goals have no intervention recorded.`, `Care plan ${plan.id}`, "A goal with no linked intervention means the planned service was never delivered or never documented.");
    const overdueGoals = open.filter((g: any) => g.target_date && new Date(g.target_date).getTime() < now);
    if (overdueGoals.length) add(actionRequired, "goals_overdue", `${overdueGoals.length} care-plan goals passed their target date.`, `Care plan ${plan.id}`, "The target date recorded on the goal is in the past and the goal is still open.");
  }

  // Unaddressed presenting needs
  const needs: string[] = [...(intake?.presenting_needs ?? []), ...(x.case.service_areas ?? [])].map((v: any) => String(v));
  if (needs.length && goals.length) {
    const goalText = goals.map((g: any) => String(g.goal ?? "").toLowerCase()).join(" | ");
    const unmet = [...new Set(needs)].filter((n) => n.length > 3 && !goalText.includes(n.toLowerCase().slice(0, Math.min(10, n.length))));
    if (unmet.length) add(incomplete, "needs_unaddressed", `Identified needs with no matching care-plan goal: ${unmet.slice(0, 6).join(", ")}.`, "Intake / case service areas", "These needs were recorded at intake or on the case but no care-plan goal references them.");
  }

  // Tasks
  const openTasks = x.tasks.filter((t: any) => isOpen(t.status));
  const overdue = openTasks.filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now);
  if (overdue.length) add(actionRequired, "overdue_tasks", `${overdue.length} tasks are overdue: ${overdue.slice(0, 5).map((t: any) => t.title).join("; ")}.`, "Tasks", "The due date recorded on these tasks has passed and they are not completed.");
  else add(complete, "tasks", "No overdue tasks were found.", "Tasks");
  const unassigned = openTasks.filter((t: any) => !t.assignee_id);
  if (unassigned.length) add(monitor, "tasks_unassigned", `${unassigned.length} open tasks have no assignee.`, "Tasks", "Unassigned work has no accountable professional.");

  // Alerts
  const openAlerts = (x.alerts ?? []).filter((a: any) => !a.resolved_at);
  if (openAlerts.length) add(openAlerts.some((a: any) => ["high", "critical"].includes(a.severity)) ? critical : actionRequired, "open_alerts", `${openAlerts.length} unresolved alerts: ${openAlerts.slice(0, 4).map((a: any) => a.title_es ?? a.title_en ?? a.alert_type).join("; ")}.`, "Alerts", "These alerts have no resolved_at timestamp.");
  else add(complete, "alerts", "No unresolved alerts.", "Alerts");

  // Referrals
  const awaiting = x.referrals.filter((v: any) => ["created", "sent", "pending", "awaiting_response"].includes(v.status));
  if (awaiting.length) add(actionRequired, "referrals", `${awaiting.length} referrals await response or follow-up: ${awaiting.slice(0, 4).map((v: any) => `${v.referral_number} (${v.status})`).join("; ")}.`, "Referrals", "These referrals were sent but no acceptance, rejection or completion has been recorded.");
  else add(monitor, "referrals", "No unanswered referral was detected.", "Referrals");
  const staleReferrals = awaiting.filter((v: any) => now - new Date(v.updated_at ?? v.created_at).getTime() > 14 * DAY);
  if (staleReferrals.length) add(actionRequired, "referrals_stale", `${staleReferrals.length} referrals have had no update in over 14 days.`, "Referrals", "No referral update was recorded in the last two weeks.");

  // Documents
  const missing = x.requirements.filter((v: any) => v.status === "missing");
  if (missing.length) add(incomplete, "documents", `${missing.length} required documents are missing: ${missing.slice(0, 5).map((v: any) => v.document_type).join(", ")}.`, "Document requirements", "These document requirements are configured for the case and still marked missing.");
  else add(complete, "documents", "No configured required document is missing.", "Document requirements");
  const overdueDocs = x.requirements.filter((v: any) => v.status !== "received" && v.due_at && new Date(v.due_at).getTime() < now);
  if (overdueDocs.length) add(actionRequired, "documents_overdue", `${overdueDocs.length} document requirements passed their due date.`, "Document requirements", "The requirement due date has passed without the document being received.");

  // Interventions / contact
  const followUps = x.interventions.filter((v: any) => v.follow_up_required);
  if (followUps.length) add(actionRequired, "intervention_followup", `${followUps.length} interventions are flagged as requiring follow-up.`, "Interventions", "The intervention record sets follow_up_required and no closing record supersedes it.");
  const last = x.interventions[0]?.occurred_at || x.case.last_activity_at;
  if (last && now - new Date(last).getTime() > 14 * DAY) add(actionRequired, "recent_contact", "No intervention/contact is recorded in the last 14 days.", "Interventions", "The most recent recorded contact is older than the 14-day review window.");
  else add(complete, "recent_contact", "Recent activity is recorded.", "Interventions");

  // Closure
  const closure = x.closures?.[0];
  if (x.case.status === "closed") {
    if (!closure) add(actionRequired, "closure_record", "The case is closed but no closure record exists.", "Closures", "Closure requires a documented closure record.");
    else if (!closure.supervisor_approved_at) add(actionRequired, "closure_approval", "Closure is not approved by a supervisor.", `Closure v${closure.closure_version}`, "The closure record has no supervisor approval timestamp.");
    else add(monitor, "closure", "Case is closed and approved; verify read-only posture.", "Case status");
  } else {
    const blockers = [...critical, ...actionRequired, ...incomplete].length;
    add(blockers ? monitor : complete, "closure_readiness", blockers ? `Not ready for closure: ${blockers} open items.` : "No open items block closure review.", "Closure readiness", blockers ? "Closure requires open risks, goals, referrals, documents and tasks to be resolved." : undefined);
  }

  return { critical, action_required: actionRequired, incomplete, monitor, complete, generated_at: new Date().toISOString() };
}

/** Deterministic fact sheet handed to the model. Contains no restricted records. */
export function buildFactSheet(x: CareBundle, health: CareHealth) {
  return {
    case: { number: x.case.case_number, type: x.case.case_type, status: x.case.status, priority: x.case.priority, risk_level: x.case.risk_level, consent_status: x.case.consent_status, service_areas: x.case.service_areas, opened_at: x.case.opened_at, last_activity_at: x.case.last_activity_at, next_required_action: x.case.next_required_action, closure_date: x.case.closure_date },
    person: x.person ? { number: x.person.person_number, consent_status: x.person.consent_status } : null,
    intake: x.intakes?.[0] ? { number: x.intakes[0].intake_number, status: x.intakes[0].status, presenting_needs: x.intakes[0].presenting_needs, disposition: x.intakes[0].disposition } : null,
    assessments: x.assessments.slice(0, 3),
    care_plan: x.plans[0] ?? null,
    interventions: x.interventions.slice(0, 15),
    tasks: x.tasks,
    alerts: x.alerts ?? [],
    referrals: x.referrals,
    documents: x.documents.map((d: any) => ({ title: d.title, type: d.document_type, created_at: d.created_at })),
    document_requirements: x.requirements,
    consents: x.consents,
    recent_activity: (x.activity ?? []).slice(0, 20),
    closure: x.closures?.[0] ?? null,
    deterministic_gaps: [...health.critical, ...health.action_required, ...health.incomplete],
  };
}

export const CARE_ASSISTANT_SYSTEM = `You are the Nyrava México Comprehensive Care case assistant (Talk to Care Case).
You are a SOCIAL CASE MANAGEMENT assistant, not a legal-intelligence assistant.

Absolute rules:
- Answer ONLY from the CASE FACTS JSON, the APPROVED KNOWLEDGE list and the RESOURCE list provided. Never invent records, dates, names or statuses.
- Label every statement with exactly one prefix:
  "CASE FACT —" for anything taken from this client's record,
  "KNOWLEDGE GUIDANCE —" for anything from the approved Knowledge Center list,
  "RESOURCE SUGGESTION —" for anything from the Resource Network list.
- Never present knowledge guidance or a resource as a fact about the client.
- You are READ-ONLY. You may recommend an action, but state clearly that nothing was changed and that a professional must approve any action.
- If the facts do not answer the question, say plainly what data is absent.
- When asked what is missing, use deterministic_gaps as ground truth and explain WHY each item counts as missing.
- Do not diagnose, do not confirm allegations, do not give legal advice.
- Be concise, structured, and use short bullet points.`;

export function buildDeterministicAnswer(health: CareHealth, language: "es" | "en"): string {
  const gaps = [...health.critical, ...health.action_required, ...health.incomplete];
  const es = language === "es";
  if (!gaps.length) return es ? "CASE FACT — Las reglas actuales no identifican brechas abiertas en este caso." : "CASE FACT — Current rules identify no open gaps on this case.";
  return [es ? "CASE FACT — Brechas identificadas en el expediente seleccionado:" : "CASE FACT — Gaps identified on the selected case:", ...gaps.map((g) => `• ${g.message}${g.why ? ` — ${es ? "Motivo" : "Why"}: ${g.why}` : ""} (${g.source})`)].join("\n");
}
