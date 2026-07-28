// Bilingual labels for the Core Platform capabilities (parties, tasks,
// calendar, communications). Vocabulary is Mexican; unknown keys degrade to a
// humanized form of the key so a new registry entry never renders blank.

type L = { es: string; en: string };

export const PARTY_ROLE_LABELS: Record<string, L> = {
  cliente: { es: "Cliente", en: "Client" },
  contraparte: { es: "Contraparte", en: "Opposing party" },
  abogado_contrario: { es: "Abogado contrario", en: "Opposing counsel" },
  co_abogado: { es: "Co-abogado", en: "Co-counsel" },
  juez: { es: "Juez", en: "Judge" },
  perito: { es: "Perito", en: "Expert" },
  testigo: { es: "Testigo", en: "Witness" },
  otro: { es: "Otro", en: "Other" },
  imputado: { es: "Imputado", en: "Accused" },
  victima: { es: "Víctima", en: "Victim" },
  ministerio_publico: { es: "Ministerio Público", en: "Ministerio Público" },
  ministerio_publico_federal: { es: "Ministerio Público Federal", en: "Federal Ministerio Público" },
  asesor_juridico: { es: "Asesor jurídico", en: "Victim's counsel" },
  policia: { es: "Policía", en: "Police" },
  defensor: { es: "Defensor", en: "Defense counsel" },
  actor: { es: "Actor", en: "Plaintiff" },
  demandado: { es: "Demandado", en: "Defendant" },
  tercero_interesado: { es: "Tercero interesado", en: "Interested third party" },
  acreedor: { es: "Acreedor", en: "Creditor" },
  deudor: { es: "Deudor", en: "Debtor" },
  aval: { es: "Aval", en: "Guarantor" },
  conyuge: { es: "Cónyuge", en: "Spouse" },
  menor: { es: "Menor", en: "Minor" },
  tutor: { es: "Tutor", en: "Guardian" },
  dif: { es: "DIF", en: "DIF" },
  albacea: { es: "Albacea", en: "Executor" },
  trabajador: { es: "Trabajador", en: "Worker" },
  patron: { es: "Patrón", en: "Employer" },
  sindicato: { es: "Sindicato", en: "Union" },
  centro_conciliacion: { es: "Centro de conciliación", en: "Conciliation center" },
  inspector: { es: "Inspector", en: "Inspector" },
  autoridad: { es: "Autoridad", en: "Authority" },
  particular: { es: "Particular", en: "Private party" },
  contribuyente: { es: "Contribuyente", en: "Taxpayer" },
  sat: { es: "SAT", en: "SAT" },
  quejoso: { es: "Quejoso", en: "Complainant" },
  autoridad_responsable: { es: "Autoridad responsable", en: "Responsible authority" },
  promovente: { es: "Promovente", en: "Petitioner" },
  autoridad_electoral: { es: "Autoridad electoral", en: "Electoral authority" },
  partido_politico: { es: "Partido político", en: "Political party" },
  ejidatario: { es: "Ejidatario", en: "Ejido member" },
  comisariado_ejidal: { es: "Comisariado ejidal", en: "Ejido board" },
  nucleo_agrario: { es: "Núcleo agrario", en: "Agrarian nucleus" },
  denunciante: { es: "Denunciante", en: "Complainant" },
  profepa: { es: "PROFEPA", en: "PROFEPA" },
  semarnat: { es: "SEMARNAT", en: "SEMARNAT" },
  comprador: { es: "Comprador", en: "Buyer" },
  vendedor: { es: "Vendedor", en: "Seller" },
  notario: { es: "Notario", en: "Notary" },
  corredor: { es: "Corredor", en: "Broker" },
  acreedor_hipotecario: { es: "Acreedor hipotecario", en: "Mortgage lender" },
  registro_publico: { es: "Registro Público", en: "Public registry" },
  municipio: { es: "Municipio", en: "Municipality" },
  escrow: { es: "Escrow", en: "Escrow" },
};

export const LIFECYCLE_LABELS: Record<string, L> = {
  intake: { es: "Recepción", en: "Intake" },
  working: { es: "En trabajo", en: "Working" },
  waiting_on_client: { es: "Esperando al cliente", en: "Waiting on client" },
  waiting_on_counterparty: { es: "Esperando a la contraparte", en: "Waiting on counterparty" },
  waiting_on_court: { es: "Esperando al juzgado", en: "Waiting on court" },
  waiting_on_authority: { es: "Esperando a la autoridad", en: "Waiting on authority" },
  waiting_on_ministerio_publico: { es: "Esperando al Ministerio Público", en: "Waiting on Ministerio Público" },
  waiting_on_hearing: { es: "Esperando audiencia", en: "Waiting on hearing" },
  waiting_on_conciliation: { es: "Esperando conciliación", en: "Waiting on conciliation" },
  waiting_on_buyer: { es: "Esperando al comprador", en: "Waiting on buyer" },
  waiting_on_seller: { es: "Esperando al vendedor", en: "Waiting on seller" },
  waiting_on_notary: { es: "Esperando al notario", en: "Waiting on notary" },
  waiting_on_registry: { es: "Esperando al Registro Público", en: "Waiting on registry" },
  waiting_on_municipality: { es: "Esperando al municipio", en: "Waiting on municipality" },
  ready_to_close: { es: "Listo para cerrar", en: "Ready to close" },
  closing_scheduled: { es: "Cierre agendado", en: "Closing scheduled" },
  in_trial: { es: "En juicio", en: "In trial" },
  sentenced: { es: "Sentenciado", en: "Sentenced" },
  judgment_issued: { es: "Sentencia dictada", en: "Judgment issued" },
  resolution_issued: { es: "Resolución emitida", en: "Resolution issued" },
  agreement_reached: { es: "Convenio alcanzado", en: "Agreement reached" },
  settlement_reached: { es: "Convenio alcanzado", en: "Settlement reached" },
  suspension_granted: { es: "Suspensión concedida", en: "Suspension granted" },
  closed: { es: "Cerrado", en: "Closed" },
  archived: { es: "Archivado", en: "Archived" },
};

export const TASK_STATUS_LABELS: Record<string, L> = {
  todo: { es: "Pendiente", en: "To do" },
  in_progress: { es: "En curso", en: "In progress" },
  blocked: { es: "Bloqueada", en: "Blocked" },
  done: { es: "Completada", en: "Done" },
  cancelled: { es: "Cancelada", en: "Cancelled" },
};

export const PRIORITY_LABELS: Record<string, L> = {
  low: { es: "Baja", en: "Low" },
  normal: { es: "Normal", en: "Normal" },
  high: { es: "Alta", en: "High" },
};

export const EVENT_TYPE_LABELS: Record<string, L> = {
  hearing: { es: "Audiencia", en: "Hearing" },
  filing: { es: "Presentación", en: "Filing" },
  meeting: { es: "Reunión", en: "Meeting" },
  closing: { es: "Cierre", en: "Closing" },
  deadline: { es: "Vencimiento", en: "Deadline" },
  other: { es: "Otro", en: "Other" },
};

export const CHANNEL_LABELS: Record<string, L> = {
  internal_note: { es: "Nota interna", en: "Internal note" },
  client: { es: "Cliente", en: "Client" },
  counterparty: { es: "Contraparte", en: "Counterparty" },
  court: { es: "Juzgado", en: "Court" },
  authority: { es: "Autoridad", en: "Authority" },
  notary: { es: "Notario", en: "Notary" },
  broker: { es: "Corredor", en: "Broker" },
  lender: { es: "Acreedor", en: "Lender" },
  registry: { es: "Registro Público", en: "Registry" },
  other: { es: "Otro", en: "Other" },
};

export const COMM_STATUS_LABELS: Record<string, L> = {
  draft: { es: "Borrador", en: "Draft" },
  pending_review: { es: "En revisión", en: "Pending review" },
  sent: { es: "Enviada", en: "Sent" },
  logged: { es: "Registrada", en: "Logged" },
};

export const DIRECTION_LABELS: Record<string, L> = {
  outbound: { es: "Saliente", en: "Outbound" },
  inbound: { es: "Entrante", en: "Inbound" },
  internal: { es: "Interna", en: "Internal" },
};

function humanize(key: string) {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function label(map: Record<string, L>, key: string, locale: string): string {
  const entry = map[key];
  if (!entry) return humanize(key);
  return locale === "en" ? entry.en : entry.es;
}
