/**
 * Formats raw database activity event and entity identifiers
 * into clean, localized human-readable sentences.
 */

const ENTITY_LABELS: Record<string, [string, string]> = {
  social_cases: ["Expediente del caso", "Case record"],
  social_care_plans: ["Plan de atención integral", "Care plan"],
  social_care_plan_goals: ["Meta del plan de atención", "Care plan goal"],
  social_assessments: ["Evaluación de riesgo", "Risk assessment"],
  social_assessment_versions: ["Versión de evaluación de riesgo", "Risk assessment version"],
  social_interventions: ["Intervención de atención", "Care intervention"],
  social_referrals: ["Canalización a servicio externo", "External referral"],
  social_documents: ["Documento del caso", "Case document"],
  social_consents: ["Consentimiento informado", "Informed consent"],
  social_tasks: ["Tarea o cita operativa", "Task or appointment"],
  social_community_campaigns: ["Campaña de apoyo comunitario", "Community support campaign"],
  social_community_support_offers: ["Oferta de apoyo comunitario", "Community support offer"],
  social_audit_reports: ["Informe de auditoría", "Audit report"],
  social_people: ["Registro de persona / cliente", "Person / Client record"],
  social_families: ["Registro de familia vinculada", "Family record"],
  organization_members: ["Integrante del equipo", "Team member"],
  organizations: ["Configuración institucional", "Organization setup"],
};

const EVENT_ACTIONS: Record<string, [string, string]> = {
  insert: ["creado/a", "created"],
  update: ["actualizado/a", "updated"],
  delete: ["eliminado/a", "deleted"],
  member_invited: ["invitación enviada para", "invitation sent for"],
  member_activated: ["integrante activado/a:", "member activated:"],
  member_role_changed: ["rol modificado para", "role updated for"],
  status_change: ["estado actualizado de", "status changed for"],
  reassigned: ["reasignación de", "reassignment of"],
  report_generated: ["informe generado para", "report generated for"],
  community_campaign_published: ["publicación de", "published"],
  community_support_received: ["recepción registrada de", "received"],
  document_signed: ["firma registrada para", "signature recorded for"],
  assessment_completed: ["conclusión de", "completed"],
  care_plan_approved: ["aprobación de", "approved"],
};

export function formatActivityDescription(
  eventType: string,
  entityType: string,
  metadata?: Record<string, any> | null,
  es = true
): string {
  const langIdx = es ? 0 : 1;

  // Specific custom metadata labels if present
  if (metadata?.type === "COMMUNITY_SUPPORT_FULFILLED" && metadata.item) {
    return es
      ? `Apoyo comunitario recibido: ${metadata.item}`
      : `Community support received: ${metadata.item}`;
  }

  if (metadata?.title) {
    return es
      ? `${formatEntityLabel(entityType, es)}: ${metadata.title}`
      : `${formatEntityLabel(entityType, es)}: ${metadata.title}`;
  }

  const entity = ENTITY_LABELS[entityType]?.[langIdx] || entityType.replace(/_/g, " ");
  const action = EVENT_ACTIONS[eventType]?.[langIdx] || eventType.replace(/_/g, " ");

  if (eventType === "delete") {
    return es ? `${entity} eliminado/a` : `${entity} deleted`;
  }

  if (eventType === "insert") {
    return es ? `${entity} registrado/a` : `${entity} created`;
  }

  if (eventType === "update") {
    return es ? `${entity} actualizado/a` : `${entity} updated`;
  }

  return es ? `${action} · ${entity}` : `${action} · ${entity}`;
}

export function formatEntityLabel(entityType: string, es = true): string {
  const langIdx = es ? 0 : 1;
  return ENTITY_LABELS[entityType]?.[langIdx] || entityType.replace(/_/g, " ");
}

export function formatEventAction(eventType: string, es = true): string {
  const langIdx = es ? 0 : 1;
  return EVENT_ACTIONS[eventType]?.[langIdx] || eventType.replace(/_/g, " ");
}
