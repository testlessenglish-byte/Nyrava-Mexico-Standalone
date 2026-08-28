// Comprehensive Care — Talk to Care Case reasoning layer. Server-only.
//
// Deterministic gap analysis over the already-authorized care-case bundle,
// plus an optional narrative answer produced with the admin-configured AI
// providers (ai_providers / user_ai_keys). Read-only: nothing here mutates
// case state.
//
// LOCALIZATION: every generated (explanatory) string below is produced in the
// caller's selected language. Stored client data — names, notes, titles,
// document types, statuses as entered — is never translated.

export type CareLang = "es" | "en";
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

/** Localized labels for record sources shown next to each health item. */
function sourceLabels(es: boolean) {
  return {
    intakes: es ? "Recepciones (intake)" : "Intakes",
    assessments: es ? "Evaluaciones de riesgo" : "Risk assessments",
    consents: es ? "Registros de consentimiento" : "Consent records",
    plans: es ? "Planes de atención" : "Care plans",
    intakeCase: es ? "Recepción / áreas de servicio del caso" : "Intake / case service areas",
    tasks: es ? "Tareas" : "Tasks",
    alerts: es ? "Alertas" : "Alerts",
    referrals: es ? "Canalizaciones" : "Referrals",
    requirements: es ? "Requisitos documentales" : "Document requirements",
    interventions: es ? "Intervenciones" : "Interventions",
    closures: es ? "Cierres" : "Closures",
    caseStatus: es ? "Estado del caso" : "Case status",
    closureReadiness: es ? "Preparación para el cierre" : "Closure readiness",
  };
}

export function buildCareHealth(x: CareBundle, language: CareLang = "en"): CareHealth {
  const es = language === "es";
  const L = (spanish: string, english: string) => (es ? spanish : english);
  const S = sourceLabels(es);
  const now = Date.now();
  const critical: HealthItem[] = [], actionRequired: HealthItem[] = [], incomplete: HealthItem[] = [], monitor: HealthItem[] = [], complete: HealthItem[] = [];
  const add = (bucket: HealthItem[], code: string, message: string, source: string, why?: string) => bucket.push({ code, message, source, ...(why ? { why } : {}) });
  const caseRef = L(`Caso ${x.case.case_number}`, `Case ${x.case.case_number}`);

  // Risk
  if (x.case.risk_level === "critical" || x.case.risk_level === "high")
    add(critical, "risk_review",
      L(`El riesgo registrado es ${x.case.risk_level === "critical" ? "crítico" : "alto"}; se requiere revisión profesional.`, `Current risk is ${x.case.risk_level}; professional review required.`),
      caseRef,
      L("El nivel de riesgo registrado en el caso es alto o crítico y ninguna reevaluación posterior lo sustituye.", "The recorded risk level on the case is high or critical and no lower reassessment supersedes it."));

  // Intake
  const intake = x.intakes?.[0];
  if (!intake) add(incomplete, "intake_missing",
    L("No hay una recepción (intake) vinculada a este caso.", "No intake record is linked to this case."), S.intakes,
    L("Atención Integral espera que todo caso se origine en una recepción completada.", "Comprehensive Care expects every case to originate from a completed intake."));
  else {
    const intakeRef = L(`Recepción ${intake.intake_number}`, `Intake ${intake.intake_number}`);
    if (intake.status !== "completed") add(actionRequired, "intake_incomplete",
      L(`La recepción ${intake.intake_number} sigue en estado "${intake.status}".`, `Intake ${intake.intake_number} is still "${intake.status}".`), intakeRef,
      L("La recepción nunca se marcó como completada, por lo que los datos de tamizaje pueden estar incompletos.", "The intake was never marked completed, so screening data may be partial."));
    if (!intake.presenting_needs?.length) add(incomplete, "intake_needs",
      L("La recepción no registra necesidades presentadas.", "Intake records no presenting needs."), intakeRef,
      L("Las necesidades presentadas orientan los objetivos del plan de atención; no se capturó ninguna.", "Presenting needs drive care-plan goals; none were captured."));
  }

  // Assessment
  const assessment = x.assessments[0];
  const assessmentRef = assessment ? L(`Evaluación ${assessment.id} v${assessment.current_version}`, `Assessment ${assessment.id} v${assessment.current_version}`) : S.assessments;
  if (!assessment) add(incomplete, "assessment_missing",
    L("No hay ninguna evaluación de riesgo registrada.", "No risk assessment is recorded."), S.assessments,
    L("Un caso no puede clasificarse sin al menos una evaluación registrada.", "A case cannot be triaged without at least one recorded assessment."));
  else if (now - new Date(assessment.assessment_date).getTime() > 30 * DAY) add(actionRequired, "assessment_stale",
    L("La evaluación de riesgo tiene más de 30 días.", "Risk assessment is older than 30 days."), assessmentRef,
    L("Las evaluaciones con más de 30 días ya no reflejan la situación actual.", "Assessments older than 30 days no longer reflect the current situation."));
  else add(complete, "assessment_current", L("La evaluación de riesgo está vigente.", "Risk assessment is current."), assessmentRef);

  // Consent
  const activeConsent = x.consents.find((v: any) => v.status === "active" && (!v.expires_at || new Date(v.expires_at).getTime() > now));
  if (!activeConsent) add(actionRequired, "consent",
    L("No hay consentimiento activo y vigente registrado.", "No active unexpired consent is recorded."), S.consents,
    L("Compartir información, canalizar y solicitar documentos requiere un consentimiento válido en el expediente.", "Information sharing, referrals and document requests require a valid consent on file."));
  else add(complete, "consent", L("Hay consentimiento activo registrado.", "Active consent is recorded."), L(`Consentimiento ${activeConsent.id}`, `Consent ${activeConsent.id}`));

  // Care plan + goal / intervention coverage
  const plan = x.plans[0];
  const planRef = plan ? L(`Plan de atención ${plan.id} v${plan.current_version}`, `Care plan ${plan.id} v${plan.current_version}`) : S.plans;
  const planShort = plan ? L(`Plan de atención ${plan.id}`, `Care plan ${plan.id}`) : S.plans;
  const goals: any[] = plan?.social_care_plan_versions?.flatMap((v: any) => v.social_care_plan_goals ?? []) ?? [];
  if (!plan) add(incomplete, "care_plan", L("No hay plan de atención registrado.", "No care plan is recorded."), S.plans,
    L("Las necesidades identificadas deben convertirse en un plan de atención.", "Identified needs must be converted into a care plan."));
  else if (!goals.length) add(incomplete, "care_goals_missing", L("El plan de atención no tiene objetivos.", "The care plan has no goals."), planRef,
    L("Un plan sin objetivos no puede monitorearse ni cerrarse.", "A plan without goals cannot be monitored or closed."));
  else {
    const open = goals.filter((g: any) => isOpen(g.status));
    add(open.length ? actionRequired : complete, "care_goals",
      open.length ? L(`${open.length} objetivos del plan siguen abiertos.`, `${open.length} care-plan goals remain open.`) : L("Los objetivos del plan de atención están completos.", "Care-plan goals are complete."),
      planRef,
      open.length ? L("Estos objetivos no han llegado a un estado completado o cancelado.", "These goals have not reached a completed or cancelled state.") : undefined);
    const covered = new Set(x.interventions.map((i: any) => i.care_plan_goal_id).filter(Boolean));
    const uncovered = open.filter((g: any) => !covered.has(g.id));
    if (uncovered.length) add(actionRequired, "goals_without_intervention",
      L(`${uncovered.length} objetivos abiertos del plan no tienen ninguna intervención registrada.`, `${uncovered.length} open care-plan goals have no intervention recorded.`), planShort,
      L("Un objetivo sin intervención vinculada significa que el servicio planeado no se prestó o no se documentó.", "A goal with no linked intervention means the planned service was never delivered or never documented."));
    const overdueGoals = open.filter((g: any) => g.target_date && new Date(g.target_date).getTime() < now);
    if (overdueGoals.length) add(actionRequired, "goals_overdue",
      L(`${overdueGoals.length} objetivos del plan rebasaron su fecha meta.`, `${overdueGoals.length} care-plan goals passed their target date.`), planShort,
      L("La fecha meta registrada en el objetivo ya pasó y el objetivo sigue abierto.", "The target date recorded on the goal is in the past and the goal is still open."));
  }

  // Unaddressed presenting needs
  const needs: string[] = [...(intake?.presenting_needs ?? []), ...(x.case.service_areas ?? [])].map((v: any) => String(v));
  if (needs.length && goals.length) {
    const goalText = goals.map((g: any) => String(g.goal ?? "").toLowerCase()).join(" | ");
    const unmet = [...new Set(needs)].filter((n) => n.length > 3 && !goalText.includes(n.toLowerCase().slice(0, Math.min(10, n.length))));
    if (unmet.length) add(incomplete, "needs_unaddressed",
      L(`Necesidades identificadas sin objetivo correspondiente en el plan: ${unmet.slice(0, 6).join(", ")}.`, `Identified needs with no matching care-plan goal: ${unmet.slice(0, 6).join(", ")}.`), S.intakeCase,
      L("Estas necesidades se registraron en la recepción o en el caso, pero ningún objetivo del plan las atiende.", "These needs were recorded at intake or on the case but no care-plan goal references them."));
  }

  // Tasks
  const openTasks = x.tasks.filter((t: any) => isOpen(t.status));
  const overdue = openTasks.filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now);
  if (overdue.length) add(actionRequired, "overdue_tasks",
    L(`${overdue.length} tareas están vencidas: ${overdue.slice(0, 5).map((t: any) => t.title).join("; ")}.`, `${overdue.length} tasks are overdue: ${overdue.slice(0, 5).map((t: any) => t.title).join("; ")}.`), S.tasks,
    L("La fecha de vencimiento registrada en estas tareas ya pasó y no están completadas.", "The due date recorded on these tasks has passed and they are not completed."));
  else add(complete, "tasks", L("No se encontraron tareas vencidas.", "No overdue tasks were found."), S.tasks);
  const unassigned = openTasks.filter((t: any) => !t.assignee_id);
  if (unassigned.length) add(monitor, "tasks_unassigned",
    L(`${unassigned.length} tareas abiertas no tienen persona asignada.`, `${unassigned.length} open tasks have no assignee.`), S.tasks,
    L("El trabajo sin asignar no tiene una persona profesional responsable.", "Unassigned work has no accountable professional."));

  // Alerts
  const openAlerts = (x.alerts ?? []).filter((a: any) => !a.resolved_at);
  if (openAlerts.length) add(openAlerts.some((a: any) => ["high", "critical"].includes(a.severity)) ? critical : actionRequired, "open_alerts",
    L(`${openAlerts.length} alertas sin resolver: ${openAlerts.slice(0, 4).map((a: any) => (es ? a.title_es ?? a.title_en : a.title_en ?? a.title_es) ?? a.alert_type).join("; ")}.`,
      `${openAlerts.length} unresolved alerts: ${openAlerts.slice(0, 4).map((a: any) => a.title_en ?? a.title_es ?? a.alert_type).join("; ")}.`), S.alerts,
    L("Estas alertas no tienen fecha de resolución registrada.", "These alerts have no resolved_at timestamp."));
  else add(complete, "alerts", L("No hay alertas sin resolver.", "No unresolved alerts."), S.alerts);

  // Referrals
  const awaiting = x.referrals.filter((v: any) => ["created", "sent", "pending", "awaiting_response"].includes(v.status));
  if (awaiting.length) add(actionRequired, "referrals",
    L(`${awaiting.length} canalizaciones esperan respuesta o seguimiento: ${awaiting.slice(0, 4).map((v: any) => `${v.referral_number} (${v.status})`).join("; ")}.`,
      `${awaiting.length} referrals await response or follow-up: ${awaiting.slice(0, 4).map((v: any) => `${v.referral_number} (${v.status})`).join("; ")}.`), S.referrals,
    L("Estas canalizaciones se enviaron pero no se ha registrado aceptación, rechazo ni conclusión.", "These referrals were sent but no acceptance, rejection or completion has been recorded."));
  else add(monitor, "referrals", L("No se detectó ninguna canalización sin respuesta.", "No unanswered referral was detected."), S.referrals);
  const staleReferrals = awaiting.filter((v: any) => now - new Date(v.updated_at ?? v.created_at).getTime() > 14 * DAY);
  if (staleReferrals.length) add(actionRequired, "referrals_stale",
    L(`${staleReferrals.length} canalizaciones no registran actualización en más de 14 días.`, `${staleReferrals.length} referrals have had no update in over 14 days.`), S.referrals,
    L("No se registró ninguna actualización de la canalización en las últimas dos semanas.", "No referral update was recorded in the last two weeks."));

  // Documents
  const missing = x.requirements.filter((v: any) => v.status === "missing");
  if (missing.length) add(incomplete, "documents",
    L(`Faltan ${missing.length} documentos requeridos: ${missing.slice(0, 5).map((v: any) => v.document_type).join(", ")}.`, `${missing.length} required documents are missing: ${missing.slice(0, 5).map((v: any) => v.document_type).join(", ")}.`), S.requirements,
    L("Estos requisitos documentales están configurados para el caso y siguen marcados como faltantes.", "These document requirements are configured for the case and still marked missing."));
  else add(complete, "documents", L("No falta ningún documento requerido configurado.", "No configured required document is missing."), S.requirements);
  const overdueDocs = x.requirements.filter((v: any) => v.status !== "received" && v.due_at && new Date(v.due_at).getTime() < now);
  if (overdueDocs.length) add(actionRequired, "documents_overdue",
    L(`${overdueDocs.length} requisitos documentales rebasaron su fecha límite.`, `${overdueDocs.length} document requirements passed their due date.`), S.requirements,
    L("La fecha límite del requisito pasó sin que se recibiera el documento.", "The requirement due date has passed without the document being received."));

  // Interventions / contact
  const followUps = x.interventions.filter((v: any) => v.follow_up_required);
  if (followUps.length) add(actionRequired, "intervention_followup",
    L(`${followUps.length} intervenciones están marcadas como que requieren seguimiento.`, `${followUps.length} interventions are flagged as requiring follow-up.`), S.interventions,
    L("El registro de intervención marca seguimiento requerido y ningún registro posterior lo cierra.", "The intervention record sets follow_up_required and no closing record supersedes it."));
  const last = x.interventions[0]?.occurred_at || x.case.last_activity_at;
  if (last && now - new Date(last).getTime() > 14 * DAY) add(actionRequired, "recent_contact",
    L("No hay intervención ni contacto registrado en los últimos 14 días.", "No intervention/contact is recorded in the last 14 days."), S.interventions,
    L("El contacto registrado más reciente es anterior a la ventana de revisión de 14 días.", "The most recent recorded contact is older than the 14-day review window."));
  else add(complete, "recent_contact", L("Hay actividad reciente registrada.", "Recent activity is recorded."), S.interventions);

  // Closure
  const closure = x.closures?.[0];
  if (x.case.status === "closed") {
    if (!closure) add(actionRequired, "closure_record",
      L("El caso está cerrado pero no existe un registro de cierre.", "The case is closed but no closure record exists."), S.closures,
      L("El cierre requiere un registro de cierre documentado.", "Closure requires a documented closure record."));
    else if (!closure.supervisor_approved_at) add(actionRequired, "closure_approval",
      L("El cierre no está aprobado por supervisión.", "Closure is not approved by a supervisor."), L(`Cierre v${closure.closure_version}`, `Closure v${closure.closure_version}`),
      L("El registro de cierre no tiene fecha de aprobación de supervisión.", "The closure record has no supervisor approval timestamp."));
    else add(monitor, "closure", L("El caso está cerrado y aprobado; verificar que permanezca en solo lectura.", "Case is closed and approved; verify read-only posture."), S.caseStatus);
  } else {
    const blockers = [...critical, ...actionRequired, ...incomplete].length;
    add(blockers ? monitor : complete, "closure_readiness",
      blockers ? L(`No está listo para cierre: ${blockers} elementos abiertos.`, `Not ready for closure: ${blockers} open items.`) : L("Ningún elemento abierto bloquea la revisión de cierre.", "No open items block closure review."),
      S.closureReadiness,
      blockers ? L("El cierre requiere resolver riesgos, objetivos, canalizaciones, documentos y tareas abiertos.", "Closure requires open risks, goals, referrals, documents and tasks to be resolved.") : undefined);
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

/** Localized statement prefixes used by both the model and the fallback. */
export const CARE_LABELS = {
  es: { fact: "HECHO DEL CASO", knowledge: "GUÍA DE CONOCIMIENTO", resource: "SUGERENCIA DE RECURSO", gaps: "BRECHAS IDENTIFICADAS", nextSteps: "PRÓXIMOS PASOS", why: "Motivo" },
  en: { fact: "CASE FACT", knowledge: "KNOWLEDGE GUIDANCE", resource: "RESOURCE SUGGESTION", gaps: "DETERMINISTIC GAPS", nextSteps: "NEXT STEPS", why: "Why" },
} as const;

/**
 * System prompt for the narrative answer, written in the user's language so
 * the model never drifts back to English labels or headings.
 */
export function careAssistantSystem(language: CareLang): string {
  const l = CARE_LABELS[language];
  if (language === "es") {
    return `Eres el asistente de Atención Integral de Nyrava México (Consultar Caso de Atención).
Eres un asistente de GESTIÓN DE CASOS SOCIALES, no un asistente de inteligencia jurídica.

IDIOMA OBLIGATORIO: responde ÍNTEGRAMENTE en español (registro profesional de trabajo social en México). Ninguna etiqueta, encabezado, viñeta ni frase puede quedar en inglés. Conserva textualmente los datos capturados por la persona usuaria (nombres, notas, títulos de documentos, números de expediente) sin traducirlos.

Reglas absolutas:
- Responde ÚNICAMENTE con base en el JSON de HECHOS DEL CASO, la lista de CONOCIMIENTO APROBADO y la lista de RECURSOS. Nunca inventes registros, fechas, nombres ni estados.
- Etiqueta cada afirmación con exactamente uno de estos prefijos:
  "${l.fact} —" para lo tomado del expediente de esta persona,
  "${l.knowledge} —" para lo tomado del Centro de Conocimiento aprobado,
  "${l.resource} —" para lo tomado de la Red de Recursos.
- Usa exclusivamente los encabezados "${l.gaps}:" y "${l.nextSteps}:" cuando estructures la respuesta.
- Nunca presentes una guía de conocimiento o un recurso como un hecho de la persona usuaria.
- Eres de SOLO LECTURA. Puedes recomendar acciones, pero indica claramente que no se modificó nada y que una persona profesional debe aprobar cualquier acción.
- Si los hechos no responden la pregunta, di con claridad qué información falta.
- Cuando se pregunte qué falta, usa deterministic_gaps como verdad de referencia y explica POR QUÉ cada punto cuenta como faltante.
- No diagnostiques, no confirmes acusaciones y no des asesoría jurídica.
- Sé breve, estructurado y usa viñetas cortas.`;
  }
  return `You are the Nyrava México Comprehensive Care case assistant (Talk to Care Case).
You are a SOCIAL CASE MANAGEMENT assistant, not a legal-intelligence assistant.

REQUIRED LANGUAGE: answer entirely in English. Keep user-entered data (names, notes, document titles, case numbers) exactly as stored; do not translate it.

Absolute rules:
- Answer ONLY from the CASE FACTS JSON, the APPROVED KNOWLEDGE list and the RESOURCE list provided. Never invent records, dates, names or statuses.
- Label every statement with exactly one prefix:
  "${l.fact} —" for anything taken from this client's record,
  "${l.knowledge} —" for anything from the approved Knowledge Center list,
  "${l.resource} —" for anything from the Resource Network list.
- Use only the headings "${l.gaps}:" and "${l.nextSteps}:" when structuring the answer.
- Never present knowledge guidance or a resource as a fact about the client.
- You are READ-ONLY. You may recommend an action, but state clearly that nothing was changed and that a professional must approve any action.
- If the facts do not answer the question, say plainly what data is absent.
- When asked what is missing, use deterministic_gaps as ground truth and explain WHY each item counts as missing.
- Do not diagnose, do not confirm allegations, do not give legal advice.
- Be concise, structured, and use short bullet points.`;
}

/** Backwards-compatible export (English baseline prompt). */
export const CARE_ASSISTANT_SYSTEM = careAssistantSystem("en");

export function buildDeterministicAnswer(health: CareHealth, language: CareLang): string {
  const l = CARE_LABELS[language];
  const es = language === "es";
  const gaps = [...health.critical, ...health.action_required, ...health.incomplete];
  if (!gaps.length) return `${l.fact} — ${es ? "Las reglas actuales no identifican brechas abiertas en este caso." : "Current rules identify no open gaps on this case."}`;
  return [
    `${l.fact} — ${es ? "Brechas identificadas en el expediente seleccionado:" : "Gaps identified on the selected case:"}`,
    ...gaps.map((g) => `• ${g.message}${g.why ? ` — ${l.why}: ${g.why}` : ""} (${g.source})`),
  ].join("\n");
}

/**
 * Safety net: if the model emits English structural labels while answering in
 * Spanish, rewrite the labels. Only structural labels are touched — never the
 * narrative body or any stored client data.
 */
export function localizeAssistantLabels(text: string, language: CareLang): string {
  if (language !== "es") return text;
  const l = CARE_LABELS.es;
  return text
    .replace(/\bCASE FACT\b/g, l.fact)
    .replace(/\bKNOWLEDGE GUIDANCE\b/g, l.knowledge)
    .replace(/\bRESOURCE SUGGESTION\b/g, l.resource)
    .replace(/\bDETERMINISTIC GAPS\b/g, l.gaps)
    .replace(/\bNEXT STEPS\b/g, l.nextSteps);
}
