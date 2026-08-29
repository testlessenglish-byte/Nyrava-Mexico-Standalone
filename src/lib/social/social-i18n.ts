/**
 * Comprehensive Care — Centralized Localization Helper for Enums and Field Values.
 * Converts raw database values into clean, professional Spanish or English text.
 */
export function localizedEnum(value: string | null | undefined, es: boolean): string {
  if (!value) return "—";
  const key = String(value).trim().toLowerCase();

  const labels: Record<string, [string, string]> = {
    // Risk levels & Urgencies
    unknown: ["Desconocido", "Unknown"],
    low: ["Baja", "Low"],
    normal: ["Normal", "Normal"],
    moderate: ["Moderado", "Moderate"],
    high: ["Alta", "High"],
    urgent: ["Urgente", "Urgent"],
    critical: ["Crítica", "Critical"],
    emergency: ["Emergencia", "Emergency"],

    // Case statuses
    intake: ["Recepción / Ingreso", "Intake"],
    assessment: ["Evaluación", "Assessment"],
    active: ["Activo", "Active"],
    monitoring: ["En monitoreo", "Monitoring"],
    pending_referral: ["Canalización pendiente", "Pending referral"],
    transferred: ["Transferido", "Transferred"],
    closed: ["Cerrado", "Closed"],
    reopened: ["Reabierto", "Reopened"],
    archived: ["Archivado", "Archived"],

    // Task & Goal statuses
    todo: ["Por hacer", "To do"],
    in_progress: ["En progreso", "In progress"],
    blocked: ["Bloqueado", "Blocked"],
    done: ["Completado/a", "Done"],
    completed: ["Completado/a", "Completed"],
    cancelled: ["Cancelado/a", "Cancelled"],

    // Roles
    case_manager: ["Gestor del caso", "Case manager"],
    supervisor: ["Supervisor/a", "Supervisor"],
    attorney: ["Abogado/a", "Attorney"],
    psychologist: ["Psicólogo/a", "Psychologist"],
    social_worker: ["Trabajador/a social", "Social worker"],
    organization_owner: ["Titular de la organización", "Organization owner"],
    program_director: ["Director/a de programa", "Program director"],
    case_management_supervisor: ["Supervisor/a de casos", "Case management supervisor"],
    legal_assistant: ["Asistente jurídico", "Legal assistant"],
    medical_professional: ["Profesional médico", "Medical professional"],
    referral_coordinator: ["Coordinador/a de canalizaciones", "Referral coordinator"],
    data_analyst: ["Analista de datos", "Data analyst"],
    auditor: ["Auditor/a", "Auditor"],
    read_only_reviewer: ["Revisor/a de solo lectura", "Read-only reviewer"],
    external_partner: ["Socio externo", "External partner"],

    // Record types & Confidentiality
    general_case_record: ["Expediente general del caso", "General case record"],
    social_work_record: ["Expediente de trabajo social", "Social work record"],
    legal_privileged_record: ["Expediente jurídico privilegiado", "Privileged legal record"],
    psychosocial_restricted_record: ["Expediente psicosocial restringido", "Restricted psychosocial record"],
    medical_restricted_record: ["Expediente médico restringido", "Restricted medical record"],
    child_protection_restricted_record: ["Expediente de protección infantil", "Restricted child-protection record"],
    standard: ["Estándar", "Standard"],
    restricted: ["Restringido", "Restricted"],
    highly_confidential: ["Altamente confidencial", "Highly confidential"],

    // Document lifecycle
    draft: ["Borrador", "Draft"],
    ready_for_review: ["Listo para revisión", "Ready for review"],
    finalized: ["Finalizado", "Finalized"],
    sent: ["Enviado", "Sent"],
    received: ["Recibido", "Received"],
    superseded: ["Sustituido", "Superseded"],

    // Community Support Categories
    financial_support: ["Apoyo económico", "Financial support"],
    food: ["Alimentos y despensa", "Food & groceries"],
    clothing: ["Ropa y calzado", "Clothing & footwear"],
    housing: ["Alojamiento y vivienda", "Housing & shelter"],
    school_supplies: ["Útiles escolares", "School supplies"],
    medical_health: ["Asistencia médica y salud", "Medical & health assistance"],
    transportation: ["Transporte", "Transportation"],
    furniture_household: ["Muebles y artículos del hogar", "Furniture & household items"],
    baby_supplies: ["Artículos para bebé", "Baby supplies"],
    employment: ["Asistencia para el empleo", "Employment assistance"],
    professional_services: ["Servicios profesionales", "Professional services"],
    other_material: ["Otro apoyo material", "Other material assistance"],

    // Community Support Scopes & Modes
    individual_case: ["Caso individual / Familia", "Individual case / Family"],
    organization_wide: ["Institucional / Todos los usuarios", "Organization-wide / All clients"],
    anonymous: ["Anónimo", "Anonymous"],
    first_name_only: ["Solo primer nombre", "First name only"],
    family_description: ["Descripción familiar", "Family description"],
    full_name: ["Nombre completo", "Full name"],

    // Community Support Lifecycle
    pending_approval: ["Pendiente de aprobación", "Pending approval"],
    approved: ["Aprobado", "Approved"],
    published: ["Publicado", "Published"],
    paused: ["Pausado", "Paused"],
    rejected: ["Rechazado", "Rejected"],

    // Delivery methods
    dropoff_organization: ["Entrega en la sede de la organización", "Drop off at organization"],
    collection_point: ["Punto de recolección autorizado", "Approved collection point"],
    arrange_pickup: ["Coordinar recolección a domicilio", "Arrange pickup"],
    contact_to_coordinate: ["Contactarme para coordinar", "Contact me to coordinate"],

    // Identity & Tax verification
    unverified: ["Sin verificar", "Unverified"],
    rfc_submitted: ["RFC registrado", "RFC submitted"],
    rfc_verified: ["RFC verificado", "RFC verified"],
    not_verified: ["Sin verificar", "Not verified"],
    not_tax_deductible: ["No deducible de impuestos", "Not tax deductible"],
    donataria_autorizada_claimed: ["Donataria Autorizada (en revisión)", "Donataria Autorizada (under review)"],
    donataria_autorizada_verified: ["Donataria Autorizada Verificada", "Verified Donataria Autorizada"],

    // Services
    social_work: ["Trabajo social", "Social work"],
    legal_assistance: ["Asistencia jurídica", "Legal assistance"],
    immigration_assistance: ["Asistencia migratoria", "Immigration assistance"],
    psychological_support: ["Apoyo psicológico", "Psychological support"],
    medical_referral: ["Canalización médica", "Medical referral"],
    child_protection: ["Protección infantil", "Child protection"],
    shelter_housing: ["Albergue y vivienda", "Shelter and housing"],
    food_assistance: ["Asistencia alimentaria", "Food assistance"],
    education: ["Educación", "Education"],
    documentation: ["Documentación", "Documentation"],
    family_reunification: ["Reunificación familiar", "Family reunification"],

    // Actions & Operations
    insert: ["Creación", "Creation"],
    update: ["Actualización", "Update"],
    delete: ["Eliminación", "Deletion"],
    access: ["Acceso", "Access"],
    preview: ["Vista previa", "Preview"],
    download: ["Descarga", "Download"],
    verified: ["Verificado", "Verified"],

    // Closure reasons
    services_completed: ["Servicios concluidos", "Services completed"],
    client_withdrew: ["Desistimiento del cliente", "Client withdrew"],
    unable_to_contact: ["Imposible contactar", "Unable to contact"],
    ineligible: ["No elegible", "Ineligible"],
    relocated: ["Reubicado/a", "Relocated"],
    duplicate_case: ["Caso duplicado", "Duplicate case"],
    other: ["Otro", "Other"],
  };

  if (labels[key]) {
    return es ? labels[key][0] : labels[key][1];
  }

  // Fallback: format snake_case nicely
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
