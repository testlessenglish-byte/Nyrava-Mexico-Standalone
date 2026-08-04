// =============================================================================
// MEXICAN PLAZO / PRESCRIPCIÓN ENGINE — pure module.
//
// Computes statutory deadlines (plazos) and limitation periods
// (prescripción/caducidad) for a Mexican matter from its dated procedural
// events. Correctly distinguishes días hábiles (business days — Mon-Fri,
// excluding Mexican federal holidays) from días naturales (calendar days),
// per the applicable statute. Deterministic — no model calls.
// =============================================================================

import type { MxPipelineProfile } from "../execution/mx-pipeline";

export type DayType = "habiles" | "naturales";
export type DeadlineStatus = "vigente" | "por_vencer" | "vencido";
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** A dated procedural fact the deadline engine reasons from. */
export type MxCaseEvent = {
  id: string;
  /** Trigger type, e.g. "notificacion_acto_reclamado", "emplazamiento". */
  type: string;
  /** ISO date (YYYY-MM-DD) the event occurred. */
  date: string;
  /** Optional numeric metadata used by variable-length rules (e.g. pena máxima en años). */
  metadata?: Record<string, number>;
};

export type MxDeadlineInput = {
  materia: MxPipelineProfile;
  events: readonly MxCaseEvent[];
  /** Date the deadlines are evaluated as of. Defaults to "today". ISO date. */
  asOf?: string;
};

export type MxDeadline = {
  id: string;
  label_es: string;
  label_en: string;
  authority: string;
  /** Event this deadline was computed from. */
  trigger_event_id: string;
  trigger_event_type: string;
  /** ISO date the term starts running. */
  start_date: string;
  day_type: DayType;
  days: number;
  /** ISO date the deadline falls on. */
  due_date: string;
  days_remaining: number;
  status: DeadlineStatus;
  risk_level: RiskLevel;
  /** Spanish explanation of the statutory basis and computation. */
  basis: string;
};

// -----------------------------------------------------------------------------
// Calendar helpers
// -----------------------------------------------------------------------------

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year: number, month: number /* 0-indexed */, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

/**
 * Mexican federal statutory holidays (Ley Federal del Trabajo Art. 74) for a
 * given year, as ISO date strings. Covers the fixed and "n-th Monday" civic
 * holidays; the sexennial Dec 1 transition is intentionally omitted as it is
 * not a recurring annual fixture.
 */
export function mexicanFederalHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  holidays.add(toIso(new Date(Date.UTC(year, 0, 1)))); // 1 enero
  holidays.add(toIso(nthWeekdayOfMonth(year, 1, 1, 1))); // primer lunes de febrero (Art. 123)
  holidays.add(toIso(nthWeekdayOfMonth(year, 2, 1, 3))); // tercer lunes de marzo (Benito Juárez)
  holidays.add(toIso(new Date(Date.UTC(year, 4, 1)))); // 1 mayo
  holidays.add(toIso(new Date(Date.UTC(year, 8, 16)))); // 16 septiembre
  holidays.add(toIso(nthWeekdayOfMonth(year, 10, 1, 3))); // tercer lunes de noviembre (Revolución)
  holidays.add(toIso(new Date(Date.UTC(year, 11, 25)))); // 25 diciembre
  return holidays;
}

function isBusinessDay(date: Date, holidayCache: Map<number, Set<string>>): boolean {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const year = date.getUTCFullYear();
  if (!holidayCache.has(year)) holidayCache.set(year, mexicanFederalHolidays(year));
  return !holidayCache.get(year)!.has(toIso(date));
}

/** Add `days` días hábiles to `start`, skipping weekends and federal holidays. */
export function addBusinessDays(start: Date, days: number): Date {
  const holidayCache = new Map<number, Set<string>>();
  let cur = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
    if (isBusinessDay(cur, holidayCache)) remaining--;
  }
  return cur;
}

/** Add `days` días naturales (calendar days) to `start`. */
export function addNaturalDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Días hábiles elapsed between two dates (positive if `to` is after `from`). */
function businessDaysBetween(from: Date, to: Date): number {
  const holidayCache = new Map<number, Set<string>>();
  const sign = to.getTime() >= from.getTime() ? 1 : -1;
  let cur = new Date(from);
  let count = 0;
  let guard = 0;
  while (cur.getTime() !== to.getTime() && guard < 100000) {
    cur = new Date(cur.getTime() + sign * 24 * 60 * 60 * 1000);
    if (isBusinessDay(cur, holidayCache)) count += sign;
    guard++;
  }
  return count;
}

function naturalDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

// -----------------------------------------------------------------------------
// Deadline rule catalogue
// -----------------------------------------------------------------------------

type DeadlineRule = {
  id: string;
  label_es: string;
  label_en: string;
  authority: string;
  triggerEventType: string;
  dayType: DayType;
  /** Fixed day count, or a function of the triggering event for variable terms. */
  days: number | ((event: MxCaseEvent) => number);
  basis: (days: number) => string;
};

const RULES: Record<MxPipelineProfile, readonly DeadlineRule[]> = {
  amparo: [
    {
      id: "plazo_demanda_amparo",
      label_es: "Plazo para promover demanda de amparo",
      label_en: "Term to file the amparo claim",
      authority: "Ley de Amparo Art. 17",
      triggerEventType: "notificacion_acto_reclamado",
      dayType: "habiles",
      days: 15,
      basis: (d) => `15 días hábiles contados a partir del día siguiente a la notificación del acto reclamado (Ley de Amparo Art. 17), sin contar los días inhábiles.`,
    },
    {
      id: "plazo_recurso_revision_amparo",
      label_es: "Plazo para recurso de revisión en amparo",
      label_en: "Term to file the amparo review appeal",
      authority: "Ley de Amparo Art. 86",
      triggerEventType: "sentencia_amparo",
      dayType: "habiles",
      days: 10,
      basis: () => `10 días hábiles contados a partir de la notificación de la sentencia de amparo (Ley de Amparo Art. 86).`,
    },
    {
      id: "plazo_recurso_queja",
      label_es: "Plazo para recurso de queja",
      label_en: "Term to file the amparo complaint appeal (queja)",
      authority: "Ley de Amparo Art. 98",
      triggerEventType: "acto_recurrible_queja",
      dayType: "habiles",
      days: 5,
      basis: () => `5 días hábiles contados a partir de la notificación del acuerdo recurrible en queja (Ley de Amparo Art. 98).`,
    },
  ],
  penal: [
    {
      id: "plazo_control_detencion",
      label_es: "Plazo constitucional para resolver la situación jurídica",
      label_en: "Constitutional term to resolve the detainee's legal status",
      authority: "CPEUM Art. 19",
      triggerEventType: "puesta_disposicion",
      dayType: "naturales",
      days: 3,
      basis: () => `72 horas (3 días naturales) contadas desde la puesta a disposición del imputado ante el juez, prorrogables a 144 horas a solicitud del imputado (CPEUM Art. 19).`,
    },
    {
      id: "prescripcion_penal",
      label_es: "Prescripción de la acción penal",
      label_en: "Statute of limitations on the criminal action",
      authority: "Código Penal Federal Art. 105",
      triggerEventType: "hecho_delictivo",
      dayType: "naturales",
      days: (event) => {
        const anios = event.metadata?.pena_maxima_anios ?? 3;
        return Math.max(anios, 3) * 365;
      },
      basis: () => `Plazo de prescripción equivalente al término medio aritmético de la pena de prisión aplicable, con un mínimo de tres años (Código Penal Federal Art. 105).`,
    },
    {
      id: "plazo_apelacion_penal",
      label_es: "Plazo para apelar la sentencia penal",
      label_en: "Term to appeal the criminal judgment",
      authority: "CNPP Art. 471",
      triggerEventType: "notificacion_sentencia",
      dayType: "habiles",
      days: 5,
      basis: () => `5 días hábiles contados a partir de la notificación de la sentencia (CNPP Art. 471).`,
    },
  ],
  fiscal: [
    {
      id: "plazo_recurso_revocacion",
      label_es: "Plazo para recurso de revocación",
      label_en: "Term to file the administrative revocation appeal",
      authority: "CFF Art. 121",
      triggerEventType: "notificacion_resolucion_determinante",
      dayType: "habiles",
      days: 30,
      basis: () => `30 días hábiles contados a partir de la notificación de la resolución determinante del crédito fiscal (CFF Art. 121).`,
    },
    {
      id: "plazo_juicio_contencioso",
      label_es: "Plazo para demanda de juicio contencioso administrativo",
      label_en: "Term to file the contentious administrative claim",
      authority: "LFPCA Art. 13",
      triggerEventType: "notificacion_resolucion_determinante",
      dayType: "habiles",
      days: 30,
      basis: () => `30 días hábiles contados a partir de la notificación de la resolución impugnada (LFPCA Art. 13).`,
    },
    {
      id: "plazo_garantia_interes_fiscal",
      label_es: "Plazo para garantizar el interés fiscal",
      label_en: "Term to guarantee the tax interest",
      authority: "CFF Art. 141, 144",
      triggerEventType: "notificacion_resolucion_determinante",
      dayType: "habiles",
      days: 30,
      basis: () => `30 días hábiles para garantizar el interés fiscal y suspender el procedimiento administrativo de ejecución (CFF Art. 141 y 144).`,
    },
  ],
  laboral: [
    {
      id: "prescripcion_laboral_general",
      label_es: "Prescripción general de acciones laborales",
      label_en: "General statute of limitations for labor actions",
      authority: "LFT Art. 516",
      triggerEventType: "hecho_generador",
      dayType: "naturales",
      days: 365,
      basis: () => `Un año contado a partir del día siguiente a la fecha en que la obligación sea exigible (LFT Art. 516).`,
    },
    {
      id: "prescripcion_accion_despido",
      label_es: "Prescripción de la acción por despido",
      label_en: "Statute of limitations for the wrongful-termination action",
      authority: "LFT Art. 518",
      triggerEventType: "fecha_despido",
      dayType: "naturales",
      days: 60,
      basis: () => `Dos meses (60 días naturales) contados a partir del día siguiente a la fecha de la separación (LFT Art. 518).`,
    },
    {
      id: "plazo_amparo_laudo",
      label_es: "Plazo de amparo directo contra el laudo",
      label_en: "Term for direct amparo against the labor award",
      authority: "Ley de Amparo Art. 17",
      triggerEventType: "notificacion_laudo",
      dayType: "habiles",
      days: 15,
      basis: () => `15 días hábiles contados a partir de la notificación del laudo (Ley de Amparo Art. 17).`,
    },
  ],
  civil: [
    {
      id: "plazo_contestacion_demanda",
      label_es: "Plazo para contestar la demanda",
      label_en: "Term to answer the complaint",
      authority: "CNPCyF Art. 279",
      triggerEventType: "emplazamiento",
      dayType: "habiles",
      days: 9,
      basis: () => `9 días hábiles contados a partir del emplazamiento (CNPCyF Art. 279).`,
    },
    {
      id: "caducidad_instancia_civil",
      label_es: "Caducidad de la instancia",
      label_en: "Lapse of the instance for inactivity",
      authority: "CNPCyF Art. 141",
      triggerEventType: "ultima_actuacion",
      dayType: "naturales",
      days: 120,
      basis: () => `120 días naturales de inactividad procesal de las partes producen la caducidad de la instancia (CNPCyF Art. 141).`,
    },
    {
      id: "prescripcion_ordinaria_civil",
      label_es: "Prescripción positiva ordinaria",
      label_en: "Ordinary limitation period",
      authority: "CCF Art. 1159",
      triggerEventType: "hecho_generador",
      dayType: "naturales",
      days: 3650,
      basis: () => `10 años contados a partir de que la obligación pudo exigirse (CCF Art. 1159).`,
    },
  ],
  familiar: [
    {
      id: "plazo_contestacion_familiar",
      label_es: "Plazo para contestar la demanda familiar",
      label_en: "Term to answer the family claim",
      authority: "CNPCyF Art. 619",
      triggerEventType: "emplazamiento",
      dayType: "habiles",
      days: 9,
      basis: () => `9 días hábiles contados a partir del emplazamiento (CNPCyF Art. 619).`,
    },
  ],
  mercantil: [
    {
      id: "plazo_oposicion_excepciones",
      label_es: "Plazo para oponer excepciones",
      label_en: "Term to raise defenses",
      authority: "Código de Comercio Art. 1399",
      triggerEventType: "emplazamiento",
      dayType: "habiles",
      days: 9,
      basis: () => `9 días hábiles contados a partir del emplazamiento en el juicio ejecutivo mercantil (Código de Comercio Art. 1399).`,
    },
    {
      id: "prescripcion_cambiaria",
      label_es: "Prescripción cambiaria",
      label_en: "Negotiable-instrument limitation period",
      authority: "LGTOC Art. 165",
      triggerEventType: "vencimiento_titulo",
      dayType: "naturales",
      days: 1095,
      basis: () => `3 años contados a partir del vencimiento del título de crédito (LGTOC Art. 165).`,
    },
  ],
  administrativo: [
    {
      id: "plazo_recurso_revision_administrativo",
      label_es: "Plazo para recurso de revisión administrativo",
      label_en: "Term to file the administrative review appeal",
      authority: "LFPA Art. 86",
      triggerEventType: "notificacion_acto_administrativo",
      dayType: "habiles",
      days: 15,
      basis: () => `15 días hábiles contados a partir de la notificación del acto administrativo (LFPA Art. 86).`,
    },
    {
      id: "plazo_juicio_contencioso_administrativo",
      label_es: "Plazo para juicio contencioso administrativo",
      label_en: "Term to file the contentious administrative claim",
      authority: "LFPCA Art. 13",
      triggerEventType: "notificacion_acto_administrativo",
      dayType: "habiles",
      days: 30,
      basis: () => `30 días hábiles contados a partir de la notificación del acto impugnado (LFPCA Art. 13).`,
    },
  ],
  derechos_humanos: [
    {
      id: "plazo_queja_cndh",
      label_es: "Plazo para presentar queja ante la CNDH",
      label_en: "Term to file a complaint with the CNDH",
      authority: "Ley de la CNDH Art. 26",
      triggerEventType: "hecho_violatorio",
      dayType: "naturales",
      days: 365,
      basis: () => `Un año contado a partir de que se hubiera iniciado la ejecución de los hechos violatorios, salvo violaciones graves (Ley de la CNDH Art. 26).`,
    },
  ],
  apelacion: [
    {
      id: "plazo_apelacion",
      label_es: "Plazo para interponer el recurso de apelación",
      label_en: "Term to file the appeal",
      authority: "CNPP Art. 471 / código procesal local",
      triggerEventType: "notificacion_sentencia",
      dayType: "habiles",
      days: 5,
      basis: () => `5 días hábiles contados a partir de la notificación de la sentencia recurrida (CNPP Art. 471; el código procesal local puede prever un plazo distinto).`,
    },
  ],
  // Deliberately empty. This engine computes STATUTORY plazos/prescripción
  // for litigation, triggered by procedural events (notificación,
  // emplazamiento, etc.). A closing has no such statutory clock — its dates
  // (closing date, ISAI payment window, RPP inscription) are contractual or
  // administrative, tracked via `closing_milestones` (see the integration
  // plan), not this engine. If a real estate matter ever needs a genuine
  // statutory deadline rule here, it has become a dispute — i.e. civil, not
  // inmobiliario — same principle as the empty MX_MOTION_TYPES entry.
  inmobiliario: [],
  // 2026-08-04: new profile (see execution/mx-pipeline.ts). Deliberately
  // conservative rather than guessed: the Ley Agraria's internal day-counts
  // (citación previa a la audiencia de ley, etc.) are not stated here
  // because this module computes deadlines deterministically and asserts
  // them as fact — a wrong day-count here is as much a hazard as a
  // fabricated case citation elsewhere in this build-out, and unlike the
  // civil/laboral/fiscal terms already in this file, the exact current
  // figure needs verification against the Ley Agraria's current text before
  // being encoded as a rule. Notably, juicio agrario is generally NOT
  // subject to caducidad de la instancia by inactivity the way civil
  // procedure is (the law's protective character toward campesinos/
  // ejidatarios cuts the other way) — so no analog of civil's
  // caducidad_instancia_civil rule belongs here either.
  agrario: [],
};

export function deadlineRules(materia: MxPipelineProfile): readonly DeadlineRule[] {
  return RULES[materia];
}

function resolveDays(rule: DeadlineRule, event: MxCaseEvent): number {
  return typeof rule.days === "function" ? rule.days(event) : rule.days;
}

function computeStatusAndRisk(daysRemaining: number, dayType: DayType): { status: DeadlineStatus; risk_level: RiskLevel } {
  if (daysRemaining < 0) return { status: "vencido", risk_level: "critical" };
  const warningWindow = dayType === "habiles" ? 5 : 10;
  if (daysRemaining <= warningWindow) return { status: "por_vencer", risk_level: "high" };
  const mediumWindow = dayType === "habiles" ? 15 : 30;
  if (daysRemaining <= mediumWindow) return { status: "vigente", risk_level: "medium" };
  return { status: "vigente", risk_level: "low" };
}

/**
 * Compute every applicable statutory deadline for a matter's dated events.
 * Pure function: same input always yields the same output (modulo `asOf`).
 */
export function computeMxDeadlines(input: MxDeadlineInput): MxDeadline[] {
  const rules = deadlineRules(input.materia);
  const asOf = input.asOf ? toDate(input.asOf) : new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));

  const deadlines: MxDeadline[] = [];
  for (const rule of rules) {
    const matchingEvents = input.events.filter((e) => e.type === rule.triggerEventType);
    for (const event of matchingEvents) {
      const start = toDate(event.date);
      const days = resolveDays(rule, event);
      const due = rule.dayType === "habiles" ? addBusinessDays(start, days) : addNaturalDays(start, days);
      const days_remaining = rule.dayType === "habiles" ? businessDaysBetween(asOf, due) : naturalDaysBetween(asOf, due);
      const { status, risk_level } = computeStatusAndRisk(days_remaining, rule.dayType);

      deadlines.push({
        id: `${rule.id}:${event.id}`,
        label_es: rule.label_es,
        label_en: rule.label_en,
        authority: rule.authority,
        trigger_event_id: event.id,
        trigger_event_type: event.type,
        start_date: event.date,
        day_type: rule.dayType,
        days,
        due_date: toIso(due),
        days_remaining,
        status,
        risk_level,
        basis: rule.basis(days),
      });
    }
  }

  return deadlines.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
}

// -----------------------------------------------------------------------------
// Best-effort corpus event extraction
// -----------------------------------------------------------------------------

/**
 * Keyword patterns (accent/case-insensitive) that evidence a given trigger
 * event type occurred, used to locate a nearby date in the corpus when no
 * explicit case-event ledger exists yet.
 */
const TRIGGER_KEYWORDS: Record<string, readonly string[]> = {
  notificacion_acto_reclamado: ["notificacion del acto reclamado", "se le notifico", "notificado el acto reclamado"],
  sentencia_amparo: ["sentencia que concede el amparo", "sentencia que niega el amparo", "sentencia de amparo"],
  acto_recurrible_queja: ["acuerdo recurrible en queja", "recurso de queja"],
  puesta_disposicion: ["puesta a disposicion"],
  hecho_delictivo: ["hechos delictivos", "fecha de los hechos"],
  notificacion_sentencia: ["notificacion de la sentencia", "se notifico la sentencia"],
  notificacion_resolucion_determinante: ["resolucion determinante", "notificacion de la resolucion"],
  hecho_generador: ["hecho generador", "fecha en que se genero la obligacion"],
  fecha_despido: ["fecha de despido", "separacion del trabajo", "fecha de rescision"],
  notificacion_laudo: ["notificacion del laudo", "se notifico el laudo"],
  emplazamiento: ["emplazamiento", "cedula de notificacion", "razon actuarial"],
  ultima_actuacion: ["ultima actuacion", "ultima promocion"],
  vencimiento_titulo: ["fecha de vencimiento", "vencimiento del titulo"],
  notificacion_acto_administrativo: ["notificacion del acto administrativo", "notificacion personal"],
  hecho_violatorio: ["hechos violatorios", "fecha de los hechos violatorios"],
};

const SPANISH_MONTHS: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

/** Find and normalize the first date-like token near a corpus offset, or null. */
function findNearbyDate(corpusText: string, normalizedCorpus: string, at: number): string | null {
  const window = corpusText.slice(Math.max(0, at - 120), at + 200);
  const numeric = window.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (numeric) {
    const [, d, m, y] = numeric;
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const iso = window.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const spanish = normalize(window).match(
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/,
  );
  if (spanish) {
    const [, d, monthName, y] = spanish;
    return `${y}-${SPANISH_MONTHS[monthName]}-${d.padStart(2, "0")}`;
  }
  return null;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Best-effort extraction of dated `MxCaseEvent`s from raw corpus text, used
 * when no explicit case-event ledger exists. For each trigger event type
 * used by the materia's deadline rules, scans for its evidencing keywords
 * and, if a date is found nearby, emits an event. Purely heuristic —
 * conservative by design: no match, no invented event.
 */
export function extractMxEventsFromCorpus(materia: MxPipelineProfile, corpusText: string): MxCaseEvent[] {
  const hay = normalize(corpusText ?? "");
  if (!hay.trim()) return [];

  const triggerTypes = new Set(deadlineRules(materia).map((r) => r.triggerEventType));
  const events: MxCaseEvent[] = [];
  let seq = 0;
  for (const type of triggerTypes) {
    const keywords = TRIGGER_KEYWORDS[type] ?? [];
    for (const kw of keywords) {
      const at = hay.indexOf(normalize(kw));
      if (at < 0) continue;
      const date = findNearbyDate(corpusText, hay, at);
      if (!date) continue;
      events.push({ id: `corpus:${type}:${seq++}`, type, date });
      break;
    }
  }
  return events;
}
